import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { runInNewContext } from "node:vm";

const { codeOf, kitScript, page } = await import(
  "../skills/artifact/runtime/motion/page.mjs"
);
const SKILL = join(import.meta.dirname, "..", "skills", "artifact");
const SCRIPT = join(SKILL, "scripts", "motion.mjs");
const EXAMPLE = await readFile(
  join(SKILL, "templates", "motion", "birthday.js"),
  "utf8",
);

// A workspace of its own: the kit script finds it from where it runs
const home = await mkdtemp(join(tmpdir(), "thursday-motion-"));
after(() => rm(home, { recursive: true, force: true }));
await mkdir(join(home, "projects"));
await writeFile(join(home, "pnpm-workspace.yaml"), "");

/** motion.mjs run as a bot's shell runs it, in the test's workspace. */
const run = (...args: string[]) =>
  spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: home,
    encoding: "utf8",
    env: { ...process.env, THURSDAY_ARTIFACTS: "artifacts" },
  });

type M = { a: number; b: number; c: number; d: number; e: number; f: number };
const mul = (m: M, n: M): M => ({
  a: m.a * n.a + m.c * n.b,
  b: m.b * n.a + m.d * n.b,
  c: m.a * n.c + m.c * n.d,
  d: m.b * n.c + m.d * n.d,
  e: m.a * n.e + m.c * n.f + m.e,
  f: m.b * n.e + m.d * n.f + m.f,
});
const matrix = (m: M) => ({
  ...m,
  inverse() {
    const det = m.a * m.d - m.b * m.c;
    return matrix({
      a: m.d / det,
      b: -m.b / det,
      c: -m.c / det,
      d: m.a / det,
      e: (m.c * m.f - m.d * m.e) / det,
      f: (m.b * m.e - m.a * m.f) / det,
    });
  },
  transformPoint: (p: { x: number; y: number }) => ({
    x: m.a * p.x + m.c * p.y + m.e,
    y: m.b * p.x + m.d * p.y + m.f,
  }),
});

/**
 * A canvas that draws nothing but keeps its transforms, so the kit's words land where a
 * browser would put them; letters are measured half as wide as they are tall.
 */
function fakeCanvas() {
  let m: M = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const stack: M[] = [];
  let font = "64px Hand";
  const ctx = new Proxy(
    {
      save: () => stack.push(m),
      restore: () => {
        m = stack.pop() ?? m;
      },
      translate: (x: number, y: number) => {
        m = mul(m, { a: 1, b: 0, c: 0, d: 1, e: x, f: y });
      },
      scale: (x: number, y: number) => {
        m = mul(m, { a: x, b: 0, c: 0, d: y, e: 0, f: 0 });
      },
      rotate: (r: number) => {
        m = mul(m, {
          a: Math.cos(r),
          b: Math.sin(r),
          c: -Math.sin(r),
          d: Math.cos(r),
          e: 0,
          f: 0,
        });
      },
      setTransform: (
        a: number,
        b: number,
        c: number,
        d: number,
        e: number,
        f: number,
      ) => {
        m = typeof a === "object" ? (a as M) : { a, b, c, d, e, f };
      },
      getTransform: () => matrix(m),
      measureText: (s: string) => ({
        width:
          [...s].length *
          Number.parseFloat(/(\d+(\.\d+)?)px/.exec(font)?.[1] ?? "64") *
          0.5,
      }),
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
      }),
      createImageData: (w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
      }),
      createPattern: () => ({}),
      createRadialGradient: () => ({ addColorStop() {} }),
      createLinearGradient: () => ({ addColorStop() {} }),
    } as Record<string, unknown>,
    {
      get: (t, k: string) => (k in t ? t[k] : k === "font" ? font : () => {}),
      set: (t, k: string, v) => {
        if (k === "font") font = v;
        else t[k] = v;
        return true;
      },
    },
  );
  return { width: 0, height: 0, getContext: () => ctx, style: {} };
}

/** The film's code run with the kit, as the page runs it to render; its FILM once laid out. */
async function laidOut(code: string) {
  const main = fakeCanvas();
  const window: Record<string, unknown> = { addEventListener() {} };
  const context = {
    window,
    location: { search: "?render" },
    document: {
      title: "",
      getElementById: () => main,
      createElement: () => fakeCanvas(),
      fonts: { load: async () => [], ready: Promise.resolve() },
      body: { classList: { add() {} } },
    },
    // No picture loads here: each says so, as a missing file does in a browser
    Image: class {
      onerror: (() => void) | null = null;
      set src(_: string) {
        setTimeout(() => this.onerror?.(), 0);
      }
    },
    Path2D: class {
      moveTo() {}
      lineTo() {}
    },
    DOMPoint: class {
      constructor(
        public x = 0,
        public y = 0,
      ) {}
    },
    performance,
    URLSearchParams,
    requestAnimationFrame: () => 0,
  };
  runInNewContext(kitScript(), context);
  // The kit hands `film` to the page's window; the film's code calls it by name
  runInNewContext(code, { ...context, film: window.film });
  for (let i = 0; i < 200 && !window.FILM; i++)
    await new Promise((r) => setTimeout(r, 5));
  assert.ok(window.FILM, "the film was never laid out");
  // Made in the page's own realm: copied into this one to compare
  return JSON.parse(JSON.stringify(window.FILM)) as {
    duration: number;
    seed: number;
    faces: { kind: string; x: number; y: number; r: number; tall: number }[];
    width: number;
    height: number;
    scenes: { t0: number; t1: number; enter: string }[];
    cues: { at: number; kind: string }[];
    errors: { scene: number; message: string }[];
    problems: string[];
    words: {
      text: string;
      x0: number;
      x1: number;
      y0: number;
      y1: number;
      at: number;
      sceneLen: number;
    }[];
  };
}

test("the example film runs every scene, its words inside the frame and read in time", async () => {
  const film = await laidOut(EXAMPLE);
  assert.deepEqual(film.problems, []);
  assert.deepEqual(film.errors, []);
  assert.equal(film.scenes.length, 6);
  assert.ok(film.duration > 20 && film.duration < 45);
  // Scenes follow one another with no gap
  film.scenes.slice(1).forEach((s, i) => assert.equal(s.t0, film.scenes[i].t1));
  assert.ok(film.words.length >= 6);
  // Every face is known to the checks: 3 + 3 + 1 + 2 people in scenes 2, 3, 4 and 6
  assert.equal(film.faces.filter((f) => f.kind === "person").length, 9);
  for (const w of film.words) {
    assert.ok(w.x0 >= 0 && w.x1 <= film.width, `"${w.text}" is off the frame`);
    assert.ok(w.y0 >= 0 && w.y1 <= film.height, `"${w.text}" is off the frame`);
    assert.ok(
      w.at < w.sceneLen,
      `"${w.text}" is still being written as its scene ends`,
    );
  }
  // The pops, pens and changes of scene it asked for are heard, in order
  const kinds = new Set(film.cues.map((c) => c.kind));
  for (const k of ["write", "pop", "sparkle", "rustle"])
    assert.ok(kinds.has(k), k);
  assert.deepEqual(
    film.cues.map((c) => c.at),
    [...film.cues.map((c) => c.at)].sort((a, b) => a - b),
  );
});

test("a scene that throws is named with its scene, and a wrong setting with its field", async () => {
  const film = await laidOut(`film({ mood: "sad", size: "800x600", scenes: [
    { seconds: 3, draw(d) { d.sky({ time: "day" }); } },
    { seconds: 3, enter: "spin", draw(d) { d.person("nobody", 100, 100, 400); } },
    { seconds: 3, draw(d) { d.thing("unicorn", 100, 100, 100); } },
  ] });`);
  assert.equal(film.problems.length, 3);
  assert.match(film.problems.join("\n"), /size "800x600"/);
  assert.match(film.problems.join("\n"), /mood "sad"/);
  assert.match(film.problems.join("\n"), /scene 2: enter "spin"/);
  assert.deepEqual(
    film.errors.map((e) => e.scene),
    [2, 3],
  );
  assert.match(film.errors[0].message, /No one called "nobody" in the cast/);
  assert.match(film.errors[1].message, /No thing "unicorn"/);
});

test("a film with no scenes, or a picture from elsewhere, is refused with why, not thrown", async () => {
  const film = await laidOut(
    `film({ scenes: [], images: { us: "https://example.com/us.jpg", ok: "pictures/us.jpg" } });`,
  );
  assert.match(film.problems.join("\n"), /give at least one scene/);
  assert.match(
    film.problems.join("\n"),
    /The picture "us" is https:\/\/example\.com\/us\.jpg/,
  );
  assert.doesNotMatch(film.problems.join("\n"), /"ok" is/);
});

test("the music fills the film, is not silent, and is the same for the same seed", async () => {
  const film = await laidOut(EXAMPLE);
  const code = await readFile(
    join(SKILL, "runtime", "motion", "score.js"),
    "utf8",
  );
  const compose = runInNewContext(`${code}\ncomposeScore`, {
    Math,
    Float32Array,
  });
  const one = compose(film, 8000);
  const two = compose(film, 8000);
  assert.equal(one.left.length, Math.ceil((film.duration + 0.05) * 8000));
  let loud = 0;
  for (let i = 0; i < one.left.length; i++) {
    assert.ok(Number.isFinite(one.left[i]) && Math.abs(one.left[i]) <= 1);
    loud = Math.max(loud, Math.abs(one.left[i]));
  }
  assert.ok(loud > 0.5);
  assert.deepEqual(one.left.slice(0, 4000), two.left.slice(0, 4000));
  const other = compose({ ...film, seed: film.seed + 1 }, 8000);
  assert.notDeepEqual(other.left.slice(0, 40000), one.left.slice(0, 40000));
});

test("the page holds the film's code whole, and nothing in it closes the page's script", () => {
  const code = `film({ scenes: [{ seconds: 3, draw(d) { d.write("</script><b>", 960, 300); } }] });\n`;
  const html = page(code, 'A "film" & <more>');
  assert.equal((html.match(/<\/script>/g) ?? []).length, 2);
  assert.match(html, /<title>A &quot;film&quot; &amp; &lt;more&gt;<\/title>/);
  assert.equal(codeOf(html), code);
  assert.equal(codeOf("<html></html>"), null);
});

test("put refuses a file that is not a film, before writing anything", () => {
  const got = run("put", "demo", join(SKILL, "SKILL.md"));
  assert.equal(got.status, 1);
  assert.match(got.stderr, /does not call film/);
  const usage = run();
  assert.equal(usage.status, 1);
  assert.match(usage.stderr, /put <name\|path> <film\.js>/);
});
