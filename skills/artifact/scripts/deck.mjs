#!/usr/bin/env node
// A deck the make_deck tool made, carried on: printed as a PDF, or made into a video that
// reads itself. The deck's own file draws both — the PDF is that file printed, a slide a
// sheet, and the video is every slide as it draws it, held for as long as the voice read
// over it runs — so the deck, its PDF and its video never disagree.
//
//   node deck.mjs pdf <name | path>                <deck>.pdf beside it, a slide a sheet
//   node deck.mjs video <name | path> <audio>...   <deck>.mp4 beside it: one audio file a
//                                                  slide, in slide order
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { deckIn, H, W } from "../runtime/deck/data.mjs";
import {
  ARTIFACTS,
  NAME,
  Stop,
  shown,
  WORKSPACE,
} from "../runtime/shell/workspace.mjs";
import { duration, findFfmpeg } from "./media.mjs";

// Silence after each slide's voice before the next slide turns
const PAUSE_S = 0.6;
const FPS = 30;

const USAGE =
  "Usage: deck.mjs pdf <name | path> | video <name | path> <audio>... (one audio file a slide, in slide order)";

/** The shipped skills, which hold the camera and the browser this works through. */
function skills() {
  const at = process.env.THURSDAY_SKILLS;
  if (!at)
    throw new Stop(
      "THURSDAY_SKILLS is not set: run this from a bot's shell, where it names the shipped skills.",
    );
  return at;
}

/**
 * A deck named — its folder under your artifacts, as make_deck names it — or given by its
 * path, as make_deck handed it back: a path is read from the workspace root.
 */
function openDeck(arg) {
  if (!arg)
    throw new Stop(
      `Give the deck: its name, or its path as make_deck handed it back. ${USAGE}`,
    );
  let file;
  if (/[/\\]|\.html$/i.test(arg)) {
    const path = resolve(WORKSPACE, arg);
    file = /\.html$/i.test(path) ? path : join(path, `${basename(path)}.html`);
  } else {
    if (!NAME.test(arg))
      throw new Stop(
        `"${arg}" is not a deck name: letters, numbers, - and _ only.`,
      );
    file = join(ARTIFACTS, arg, `${arg}.html`);
  }
  if (!existsSync(file))
    throw new Stop(
      `No deck at ${shown(file)}. Give its name, or its path as make_deck handed it back.`,
    );
  const deck = deckIn(readFileSync(file, "utf8"));
  if (!Array.isArray(deck?.slides))
    throw new Stop(
      `${shown(file)} is not a deck the make_deck tool made, so this cannot carry it on.`,
    );
  return { file, slides: deck.slides.length };
}

/**
 * The deck printed to `<deck>.pdf` beside it, one slide a sheet at the slide's own size, by
 * the artifact skill's camera in a browser of its own — the job's may be a window on the
 * user's screen — loaded and checked the way the video's frames are.
 */
function pdf(arg) {
  const deck = openDeck(arg);
  const out = deck.file.replace(/\.html$/i, ".pdf");
  const done = spawnSync(
    process.execPath,
    [
      join(skills(), "artifact", "runtime", "render.mjs"),
      deck.file,
      "--shot",
      "--size",
      `${W}x${H}`,
      "--pdf",
      out,
      "--apart",
      "--strict",
    ],
    { encoding: "utf8" },
  );
  if (done.status !== 0)
    throw new Stop(
      `${done.stdout}${done.stderr}`.trim().split("\n").at(-1) ||
        "The deck could not be printed.",
    );
  const mb = (statSync(out).size / 1024 / 1024).toFixed(1);
  console.log(
    `Made ${shown(out)}: ${deck.slides} slides, one a sheet, ${mb} MB. Hand back this path.`,
  );
}

/**
 * Every slide shot as the deck draws it and held for as long as its voice runs, joined
 * into `<deck>.mp4` beside it, h264 in yuv420p, which every phone plays; the voices then
 * move into `voices/` beside the deck, numbered by slide.
 */
function video(arg, audio) {
  const deck = openDeck(arg);
  const render = join(skills(), "artifact", "runtime", "render.mjs");
  const voices = audio.map((file) => resolve(WORKSPACE, file));
  if (!voices.length)
    throw new Stop(
      `Give one audio file a slide, in slide order, after the deck: ${deck.slides} of them.`,
    );
  const missing = voices.filter((file) => !existsSync(file));
  if (missing.length)
    throw new Stop(`No such audio: ${missing.map(shown).join(", ")}`);
  if (voices.length !== deck.slides)
    throw new Stop(
      `The deck has ${deck.slides} slides and ${voices.length} audio files came: give one a slide, in slide order.`,
    );
  const ffmpeg = findFfmpeg(WORKSPACE, Stop);
  const lengths = voices.map((file) => duration(ffmpeg, file, Stop) + PAUSE_S);

  const out = deck.file.replace(/\.html$/i, ".mp4");
  const frames = mkdtempSync(
    join(dirname(deck.file), `.${basename(deck.file, ".html")}-frames-`),
  );
  try {
    const drawn = spawnSync(
      process.execPath,
      [
        render,
        deck.file,
        "--shot",
        // A slide that does not come out this size did not fit, and stops the run
        "--size",
        `${W}x${H}`,
        "--out",
        frames,
        "--name",
        "slide",
        // Never in the job's own browser, which may be a window on their screen
        "--apart",
        // A slide whose picture did not load is not made into video
        "--strict",
      ],
      { encoding: "utf8" },
    );
    if (drawn.status !== 0)
      throw new Stop(`${drawn.stdout}${drawn.stderr}`.trim());
    const pngs = readdirSync(frames)
      .filter((file) => file.endsWith(".png"))
      .sort()
      .map((file) => join(frames, file));
    if (pngs.length !== voices.length)
      throw new Stop(
        `${pngs.length} slide(s) were drawn and ${voices.length} audio file(s) came: give one a slide, in slide order.`,
      );

    const inputs = [];
    const chains = [];
    let joined = "";
    pngs.forEach((png, i) => {
      const s = lengths[i].toFixed(3);
      // A still read twice a second and repeated in the filter: decoding the png at the
      // full frame rate is most of the time otherwise
      const t = (lengths[i] + 1).toFixed(3);
      inputs.push("-loop", "1", "-framerate", "2", "-t", t, "-i", png);
      chains.push(
        `[${i}:v]fps=${FPS},trim=duration=${s},setpts=PTS-STARTPTS,format=yuv420p,setsar=1[v${i}]`,
        `[${pngs.length + i}:a]aformat=sample_rates=48000:channel_layouts=stereo,apad=whole_dur=${s}[a${i}]`,
      );
      joined += `[v${i}][a${i}]`;
    });
    for (const voice of voices) inputs.push("-i", voice);
    const made = spawnSync(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        ...inputs,
        "-filter_complex",
        `${chains.join(";")};${joined}concat=n=${pngs.length}:v=1:a=1[v][a]`,
        "-map",
        "[v]",
        "-map",
        "[a]",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-tune",
        "stillimage",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-r",
        `${FPS}`,
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-movflags",
        "+faststart",
        out,
      ],
      { encoding: "utf8" },
    );
    if (made.status !== 0)
      throw new Stop(`ffmpeg could not join the slides:\n${made.stderr}`);
  } finally {
    rmSync(frames, { recursive: true, force: true });
  }
  const kept = keepVoices(deck.file, voices);
  const secs = Math.round(lengths.reduce((a, b) => a + b, 0));
  const mb = (statSync(out).size / 1024 / 1024).toFixed(1);
  console.log(
    `Made ${shown(out)}: ${voices.length} slides, ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")} long, ${W}x${H}, ${mb} MB. Hand back this path.`,
  );
  console.log(
    `The voices are copied into ${shown(kept)}/slide-01… in slide order, kept for a slide said again later; the files you gave stay where they were.`,
  );
}

/**
 * The voices, copied into `voices/` beside the deck and numbered by slide, so a slide said
 * again later has the others to go with it. Copied, never moved: a voice may be a recording
 * the user made, and what else `voices/` holds stays. Staged first, so no slide's voice is
 * written over another's part way; the stage goes, whatever happens.
 */
function keepVoices(file, voices) {
  const dir = join(dirname(file), "voices");
  mkdirSync(dir, { recursive: true });
  const stage = mkdtempSync(join(dirname(file), ".voices-"));
  try {
    const names = voices.map((voice, i) => {
      const name = `slide-${String(i + 1).padStart(2, "0")}${extname(voice)}`;
      copyFileSync(voice, join(stage, name));
      return name;
    });
    for (const name of names) renameSync(join(stage, name), join(dir, name));
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
  return dir;
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === "pdf") pdf(rest[0]);
  else if (command === "video") video(rest[0], rest.slice(1));
  else throw new Stop(USAGE);
} catch (error) {
  // A `Stop` is a line for the caller, not a stack
  if (!(error instanceof Stop)) throw error;
  console.error(error.message);
  process.exit(1);
}
