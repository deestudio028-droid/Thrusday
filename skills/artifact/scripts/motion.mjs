#!/usr/bin/env node
// A motion video: a short hand-drawn film, its scenes written as code that draws them with a
// kit of paper and crayon (people, things, places, handwriting), timed to music made for it.
// It plays in the app and is made into an mp4 frame by frame.
//
//   node motion.mjs put <name|path> <film.js>      the film's code into the video, checked
//   node motion.mjs get <name|path> <film.js>      the film's code as it is now, into <file>
//   node motion.mjs shots <name|path> [--at 1,2.5]  moments of every scene, all on one picture
//   node motion.mjs render <name|path> [--draft]    <name>.mp4 beside it, with its music
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { serveFolder } from "../../browser/scripts/serve.mjs";
import { apart, parseArgs } from "../../browser/scripts/session.mjs";
import { page, codeOf as readCode } from "../runtime/motion/page.mjs";
import {
  ARTIFACTS,
  NAME,
  Stop,
  shown,
  WORKSPACE,
} from "../runtime/shell/workspace.mjs";
import { findFfmpeg } from "./media.mjs";

const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(SKILL, "scripts", "motion.mjs");
const RUNTIME = join(SKILL, "runtime", "motion");

// Pictures averaged into each frame of the finished video, spread across the shutter's half
// turn: what makes a fast move blur the way a camera's does. A draft takes one.
const SUBFRAMES = 4;
// Tabs drawing at once: past this the browser's one compositor is the limit
const MOST_TABS = 4;
// Frames drawn and encoded at a time, so the pictures on disk never outgrow one piece
const PIECE_S = 4;
// Seconds a page is given to lay its film out (fonts, pictures, a pass over every scene)
// before a script stops waiting; a film whose code threw first is not waited for at all
const WAIT_S = 60;
/**
 * In the browser: waits until the film is laid out, or its code threw before film() was
 * called, and gives back what the page has.
 */
const ready = async (tab, ms) => {
  await tab
    .waitForFunction(
      () => window.READY || (window.THROWN?.length && !window.FILM_CALLED),
      null,
      { timeout: ms },
    )
    .catch(() => {});
  return tab.evaluate(() => ({
    film: window.FILM ?? null,
    thrown: window.THROWN ?? [],
  }));
};
/** A film that did not run, or ran with problems, stops shots and render with why. */
function runs(got, file, name) {
  const bad = [
    ...got.thrown,
    ...(got.film?.problems ?? []),
    ...(got.film?.errors ?? []).map((e) => `Scene ${e.scene}: ${e.message}`),
  ];
  if (!got.film || bad.length)
    throw new Stop(
      `${shown(file)} does not run as it is:\n- ${bad.join("\n- ") || "film() was never called"}\nFix its code, then: node ${SCRIPT} put ${name} <film.js>`,
    );
  return got.film;
}

// Letters a viewer reads in a second of handwriting, before a scene is too quick for its words
const READ_PER_S = 12;
// The smallest handwriting that reads on a phone, in pixels of a 1080-high frame
const SMALLEST = 30;
// How tall the tallest person in a scene must stand, in pixels of a 1080-high frame, for their
// face to read on a phone
const SMALLEST_PERSON = 330;

/** `<name>/<name>.html` in the bot's artifacts folder: the film, with its pictures beside it. */
function fileFor(name) {
  if (!name || !NAME.test(name))
    throw new Stop(
      `${name ? `"${name}" is not` : "Give"} a video name: letters, numbers, - and _ only.`,
    );
  return join(ARTIFACTS, name, `${name}.html`);
}

/** A video named, or pointed at by its folder or its file (one another bot handed over). */
function videoAt(arg, { made = true } = {}) {
  if (!arg) throw new Stop("Give a video name, or the path to one.");
  let file;
  if (!/[/\\]|\.html$/i.test(arg)) file = fileFor(arg);
  else {
    const path = resolve(arg);
    file =
      existsSync(path) && statSync(path).isDirectory()
        ? join(path, `${basename(path)}.html`)
        : path;
  }
  if (made && !existsSync(file))
    throw new Stop(
      `No video ${shown(file)}. Write its film and make it with: node ${SCRIPT} put <name> <film.js>`,
    );
  return file;
}

/** The film as the page lays it out: its length, scenes, sounds, and what went wrong. */
async function look(file, { w, h } = { w: 1920, h: 1080 }) {
  const served = await serveFolder(dirname(file));
  const url = `${served.url(basename(file))}?render`;
  try {
    return await apart((inPage) =>
      inPage(
        async (page, { url, w, h, ms }, { ready }) => {
          const tab = await page.context().newPage();
          await tab.setViewportSize({ width: w, height: h });
          await tab.goto(url, { waitUntil: "load" });
          const got = await ready(tab, ms);
          await tab.close();
          return got;
        },
        { url, w, h, ms: WAIT_S * 1000 },
        { ready },
      ),
    );
  } finally {
    served.close();
  }
}

/** What a viewer would trip on: words off the frame, too small, or gone before they are read. */
function notes(film) {
  const out = [];
  const seen = new Set();
  const k = 1080 / Math.min(film.width, film.height);
  for (const w of film.words) {
    const say = (line) => {
      const key = `${w.scene}|${w.text}|${line.slice(0, 20)}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(line);
    };
    const words = w.text.length > 28 ? `${w.text.slice(0, 28)}…` : w.text;
    const off = [
      w.x0 < -4 && "left",
      w.x1 > film.width + 4 && "right",
      w.y0 < -4 && "top",
      w.y1 > film.height + 4 && "bottom",
    ].filter(Boolean);
    if (off.length)
      say(
        `Scene ${w.scene}: "${words}" runs off the ${off.join(" and ")} of the frame: move it in, make it smaller, or give it a width to wrap in.`,
      );
    if (w.size * k < SMALLEST)
      say(
        `Scene ${w.scene}: "${words}" is ${Math.round(w.size)}px, too small to read on a phone: ${Math.ceil(SMALLEST / k)}px or more.`,
      );
    if (w.at > w.sceneLen - 0.1)
      say(
        `Scene ${w.scene}: "${words}" is still being written when the scene ends: start it earlier, or give the scene more seconds.`,
      );
    else {
      const need = [...w.text].length / READ_PER_S;
      if (w.sceneLen - w.at < need)
        say(
          `Scene ${w.scene}: "${words}" leaves ${(w.sceneLen - w.at).toFixed(1)}s to read it once written, and needs ${need.toFixed(1)}s: give the scene more seconds.`,
        );
    }
  }
  // Words over a face hide it
  for (const w of film.words)
    for (const f of film.faces.filter((f) => f.scene === w.scene)) {
      const nx = Math.max(w.x0, Math.min(f.x, w.x1));
      const ny = Math.max(w.y0, Math.min(f.y, w.y1));
      if (Math.hypot(f.x - nx, f.y - ny) < f.r * 0.75) {
        const words = w.text.length > 28 ? `${w.text.slice(0, 28)}…` : w.text;
        const line = `Scene ${w.scene}: "${words}" covers a face (the ${f.kind} at ${Math.round(f.x)}, ${Math.round(f.y)}): move the words above or beside them.`;
        if (!out.includes(line)) out.push(line);
      }
    }
  const scenes = [...new Set(film.faces.map((f) => f.scene))];
  for (const scene of scenes) {
    const people = film.faces.filter(
      (f) => f.scene === scene && f.kind === "person",
    );
    if (!people.length) continue;
    const tallest = Math.max(...people.map((f) => f.tall)) * k;
    if (tallest < SMALLEST_PERSON)
      out.push(
        `Scene ${scene}: its people are at most ${Math.round(tallest / k)}px tall, too small to see their faces: make who it is about ${Math.ceil(SMALLEST_PERSON / k)}px or taller, or move the camera in.`,
      );
  }
  return out;
}

async function put(name, from) {
  if (!from || !existsSync(from))
    throw new Stop(
      `Give the file the film is written in: node ${SCRIPT} put ${name ?? "<name>"} <film.js>`,
    );
  const file = videoAt(name, { made: false });
  const code = readFileSync(from, "utf8");
  if (!/\bfilm\s*\(/.test(code))
    throw new Stop(
      `${from} does not call film({...}). Start from ${shown(join(SKILL, "templates", "motion", "birthday.js"))}.`,
    );
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, page(code, basename(file, ".html")));
  const got = await look(file);
  const film = got.film;
  if (!film)
    throw new Stop(
      `${shown(file)} was written, but its code did not run:\n- ${got.thrown.join("\n- ") || "film() was never called"}\nFix it and put it again.`,
    );
  const bad = [
    ...film.problems,
    ...film.errors.map(
      (e) =>
        `Scene ${e.scene}, at ${e.at}s${e.line ? ` (line ${e.line} of the film's code)` : ""}: ${e.message}`,
    ),
    ...got.thrown.filter(
      (t) => !film.errors.some((e) => t.includes(e.message)),
    ),
  ];
  const secs = film.duration;
  if (bad.length)
    throw new Stop(
      `${shown(file)} was written, but these must be fixed; put it again after:\n- ${bad.join("\n- ")}`,
    );
  console.log(
    `${shown(file)}: ${film.scenes.length} scene(s), ${secs.toFixed(1)}s, ${film.mood} at ${film.bpm} bpm, ${film.cues.length} sound(s). It plays when opened. Look at it: node ${SCRIPT} shots ${name}`,
  );
  for (const line of notes(film)) console.log(line);
}

function get(name, to) {
  const file = videoAt(name);
  if (!to)
    throw new Stop(
      `Give the file to write the film's code into: node ${SCRIPT} get ${name} <film.js>`,
    );
  const code = readCode(readFileSync(file, "utf8"));
  if (code === null)
    throw new Stop(
      `${shown(file)} is not a motion video, or it was written over whole. Make it again from its code: node ${SCRIPT} put <name> <film.js>`,
    );
  writeFileSync(to, code.endsWith("\n") ? code : `${code}\n`);
  console.log(
    `The film's code of ${shown(file)} is in ${to}. Change it there, then: node ${SCRIPT} put ${name} ${to}`,
  );
}

/** Moments of every scene, as one picture to look at. */
async function shots(name, ...rest) {
  const file = videoAt(name);
  const opts = parseArgs(rest);
  const out = join(WORKSPACE, "scratch", `${basename(file, ".html")}-shots`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const served = await serveFolder(dirname(file));
  const url = `${served.url(basename(file))}?render`;
  const asked =
    typeof opts.at === "string"
      ? opts.at.split(",").map(Number).filter(Number.isFinite)
      : null;
  try {
    const got = await apart((inPage) =>
      inPage(
        async (page, { url, out, asked, ms }, { ready }) => {
          const tab = await page.context().newPage();
          await tab.setViewportSize({ width: 1920, height: 1080 });
          await tab.goto(url, { waitUntil: "load" });
          const got = await ready(tab, ms);
          const film = got.film;
          if (
            !film ||
            got.thrown.length ||
            film.problems.length ||
            film.errors.length
          )
            return { not: got };
          await tab.setViewportSize({ width: film.width, height: film.height });
          // Each scene a third in, two thirds in, and as it ends
          const times =
            asked ??
            film.scenes.flatMap((s) => {
              const len = s.t1 - s.t0;
              return [0.3, 0.62, 0.94].map((k) => s.t0 + len * k);
            });
          const jpgs = [];
          for (const [i, t] of times.entries()) {
            await tab.evaluate(
              (n) => window.frame(n, 1),
              Math.round(t * film.fps),
            );
            await tab.locator("#film").screenshot({
              path: `${out}/shot-${String(i + 1).padStart(2, "0")}.png`,
            });
            jpgs.push(
              (
                await tab
                  .locator("#film")
                  .screenshot({ type: "jpeg", quality: 70 })
              ).toString("base64"),
            );
          }
          const wide = film.width >= film.height;
          const cols = wide ? 3 : 6;
          const cell = wide ? 520 : 250;
          const cells = jpgs
            .map(
              (j, i) =>
                `<figure><figcaption>${i + 1} · ${times[i].toFixed(1)}s</figcaption><img src="data:image/jpeg;base64,${j}"></figure>`,
            )
            .join("");
          await tab.setViewportSize({
            width: cols * (cell + 16) + 32,
            height: 800,
          });
          await tab.setContent(
            `<!doctype html><style>body{margin:0;background:#e8e8e8}#sheet{display:inline-grid;grid-template-columns:repeat(${cols},${cell}px);gap:18px 16px;padding:16px}figure{margin:0}figcaption{font:600 15px/1.4 system-ui,sans-serif;color:#1b1b1b;padding-bottom:5px}img{display:block;width:${cell}px;box-shadow:0 0 0 1px #0002}</style><div id="sheet">${cells}</div>`,
          );
          await tab.evaluate(async () => {
            for (const i of document.images) await i.decode().catch(() => {});
          });
          await tab.locator("#sheet").screenshot({ path: `${out}/sheet.png` });
          await tab.close();
          return { times, scenes: film.scenes.length };
        },
        { url, out, asked, ms: WAIT_S * 1000 },
        { ready },
      ),
    );
    if (got.not) runs(got.not, file, name);
    console.log(
      `${got.times.length} picture(s) of ${got.scenes} scene(s) in ${shown(out)}; all of them on one: ${shown(join(out, "sheet.png"))}. Look at that one: is every word inside the frame and easy to read, is each scene one clear moment, does it end on the moment that matters?`,
    );
  } finally {
    served.close();
  }
}

/** 16-bit stereo WAV of the film's music, made by the same code the player plays. */
function music(film, to) {
  const code = readFileSync(join(RUNTIME, "score.js"), "utf8");
  const composeScore = runInNewContext(`${code}\ncomposeScore`, {
    Math,
    Float32Array,
  });
  const made = composeScore(film, 48000);
  const n = made.left.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(made.rate, 24);
  buf.writeUInt32LE(made.rate * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, made.left[i]));
    const r = Math.max(-1, Math.min(1, made.right[i]));
    buf.writeInt16LE(Math.round(l * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(r * 32767), 46 + i * 4);
  }
  writeFileSync(to, buf);
}

async function render(name, ...rest) {
  const file = videoAt(name);
  const opts = parseArgs(rest);
  const draft = Boolean(opts.draft);
  const dir = dirname(file);
  const ffmpeg = findFfmpeg(WORKSPACE, Stop);
  const sub = draft ? 1 : SUBFRAMES;
  const tabs = Math.max(1, Math.min(MOST_TABS, availableParallelism() - 1));
  const work = mkdtempSync(join(dir, `.${basename(file, ".html")}-frames-`));
  const out = file.replace(/\.html$/, ".mp4");
  const served = await serveFolder(dir, { take: work });
  const url = `${served.url(basename(file))}?render`;
  const began = Date.now();
  try {
    const made = await apart(async (inPage) => {
      const film = await inPage(
        async (page, { url, tabs, ms }, { ready }) => {
          const ctx = page.context();
          let got = null;
          for (let k = 0; k < tabs; k++) {
            const tab = await ctx.newPage();
            await tab.setViewportSize({ width: 1920, height: 1080 });
            await tab.goto(url, { waitUntil: "load" });
            got = await ready(tab, ms);
            if (!got.film) return got;
          }
          // This render's own tabs: another script's in the same browser are left alone
          for (const tab of ctx.pages().filter((p) => p.url() === url))
            await tab.setViewportSize({
              width: got.film.width,
              height: got.film.height,
            });
          return got;
        },
        { url, tabs, ms: WAIT_S * 1000 },
        { ready },
      ).then((got) => runs(got, file, name));
      const frames = Math.round(film.duration * film.fps);
      const per = Math.max(1, Math.round(PIECE_S * film.fps));
      const pieces = [];
      let encoding = null;
      for (let f0 = 0; f0 < frames; f0 += per) {
        const f1 = Math.min(frames, f0 + per);
        await inPage(
          async (page, { url, from, to, sub }) => {
            const tabs = page
              .context()
              .pages()
              .filter((p) => p.url() === url);
            const share = Math.ceil((to - from) / tabs.length);
            // Each tab draws its share and hands each frame back to the script as a jpeg
            await Promise.all(
              tabs.map((tab, k) =>
                tab.evaluate(
                  async ([a, b, sub]) => {
                    const canvas = document.getElementById("film");
                    for (let n = a; n < b; n++) {
                      window.frame(n, sub);
                      // toDataURL, not toBlob: a tab in the background runs toBlob late
                      const b64 = canvas
                        .toDataURL("image/jpeg", 0.94)
                        .slice("data:image/jpeg;base64,".length);
                      const jpeg = Uint8Array.from(atob(b64), (c) =>
                        c.charCodeAt(0),
                      );
                      const sent = await fetch(
                        `/__take/f${String(n).padStart(7, "0")}.jpg`,
                        { method: "POST", body: jpeg },
                      );
                      if (!sent.ok) throw new Error(`frame ${n} was not taken`);
                    }
                  },
                  [from + k * share, Math.min(to, from + (k + 1) * share), sub],
                ),
              ),
            );
          },
          { url, from: f0, to: f1, sub },
        );
        // Encoded while the next piece is drawn; one at a time, beside the browser
        await encoding;
        encoding = encodePiece(ffmpeg, { work, f0, f1, fps: film.fps, draft });
        // Its failure is met where it is awaited, not as an unhandled rejection before that
        encoding.catch(() => {});
        pieces.push(encoding);
        process.stdout.write(
          `drawn ${(f1 / film.fps).toFixed(1)}s of ${film.duration.toFixed(1)}s\n`,
        );
      }
      return { film, pieces: await Promise.all(pieces) };
    });
    const wav = join(work, "music.wav");
    music(made.film, wav);
    finish(ffmpeg, {
      pieces: made.pieces,
      wav,
      work,
      out,
      film: made.film,
      dir,
    });
    const secs = made.film.duration;
    const mb = (statSync(out).size / 1024 / 1024).toFixed(1);
    console.log(
      `Made ${shown(out)}${draft ? " (a draft: no motion blur)" : ""}: ${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, "0")} long, ${made.film.width}x${made.film.height}, ${mb} MB, in ${Math.round((Date.now() - began) / 1000)}s. Hand back this path.`,
    );
  } finally {
    served.close();
    rmSync(work, { recursive: true, force: true });
  }
}

/** One piece of frames into a video of its own, and its pictures deleted. */
function encodePiece(ffmpeg, { work, f0, f1, fps, draft }) {
  const file = join(work, `piece-${String(f0).padStart(7, "0")}.mp4`);
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-framerate",
    String(fps),
    "-start_number",
    String(f0),
    "-i",
    join(work, "f%07d.jpg"),
    "-frames:v",
    String(f1 - f0),
    "-c:v",
    "libx264",
    "-preset",
    draft ? "veryfast" : "fast",
    "-crf",
    draft ? "22" : "19",
    "-pix_fmt",
    "yuv420p",
    file,
  ];
  return new Promise((done, failed) => {
    const run = spawn(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"] });
    let said = "";
    run.stderr.on("data", (d) => {
      said += d;
    });
    run.on("close", (code) => {
      if (code !== 0)
        return failed(new Stop(`ffmpeg could not encode the frames:\n${said}`));
      for (let i = f0; i < f1; i++)
        rmSync(join(work, `f${String(i).padStart(7, "0")}.jpg`), {
          force: true,
        });
      done(file);
    });
  });
}

/** The pieces joined, and the music under them. */
function finish(ffmpeg, { pieces, wav, work, out, film, dir }) {
  const list = join(work, "pieces.txt");
  writeFileSync(
    list,
    pieces.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
  );
  const made = spawnSync(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      list,
      "-i",
      wav,
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      "-t",
      film.duration.toFixed(3),
      out,
    ],
    { encoding: "utf8" },
  );
  if (made.status !== 0)
    throw new Stop(`ffmpeg could not make the video:\n${made.stderr}`);
  // A render before this one left its pictures if it was stopped
  for (const f of readdirSync(dir))
    if (
      f.startsWith(`.${basename(out, ".mp4")}-frames-`) &&
      join(dir, f) !== work
    )
      rmSync(join(dir, f), { recursive: true, force: true });
}

const commands = { put, get, shots, render };
const [command, ...rest] = process.argv.slice(2);
try {
  if (!commands[command])
    throw new Stop(
      "Usage: motion.mjs put <name|path> <film.js> | get <name|path> <film.js> | shots <name|path> [--at 1,2.5] | render <name|path> [--draft]",
    );
  await commands[command](...rest);
} catch (error) {
  // A `Stop` is a line for the reader, not a stack
  if (!(error instanceof Stop)) throw error;
  console.error(error.message);
  process.exit(1);
}
