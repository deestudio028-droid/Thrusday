// The film: scenes drawn by the bot's code with the kit, one after another on the music's
// beat, changing through a transition, played in the page and drawn frame by frame for the
// mp4. `film({...})` is the one name the bot's code is given.

const TRANSITION_S = 0.7;
const ENTERS = ["fade", "cut", "tear", "slide", "page", "iris", "zoom"];
const MOODS = {
  tender: { bpm: 76 },
  warm: { bpm: 84 },
  playful: { bpm: 112 },
  nostalgic: { bpm: 72 },
  celebratory: { bpm: 120 },
};
const SIZES = {
  "1920x1080": [1920, 1080],
  "1080x1920": [1080, 1920],
  "1080x1080": [1080, 1080],
};
const SOUND_KINDS = [
  "pop",
  "write",
  "sparkle",
  "whoosh",
  "thump",
  "chime",
  "clap",
  "boing",
  "rustle",
  "blow",
  "shutter",
];

const Q = new URLSearchParams(location.search);
const RENDER = Q.has("render");
const canvas = document.getElementById("film");
// Rendering headless, drawn on the processor: faster there than a graphics card emulated
const CPU = RENDER ? { willReadFrequently: true } : undefined;
const g0 = canvas.getContext("2d", CPU);
let F = null; // the film, laid out
const layers = [];
const layer = (i) => {
  if (!layers[i]) {
    const c = document.createElement("canvas");
    c.width = F.w;
    c.height = F.h;
    layers[i] = c;
  }
  return layers[i];
};

// ---------------------------------------------------------------- what a scene draws with
/** The scene's own clock and the kit, bound to the frame being drawn: one for the film. */
let D = null;
function makeD() {
  const d = {
    get t() {
      return X.t;
    },
    get len() {
      return X.len;
    },
    get u() {
      return clamp(X.t / X.len);
    },
    get T() {
      return X.T;
    },
    get beat() {
      return X.t / F.spb;
    },
    get pulse() {
      return Math.exp(-((X.t / F.spb) % 1) * 5);
    },
    W: F.w,
    H: F.h,
    get ctx() {
      return X.g;
    },
    // time
    at: (a, b) => inOut(b > a ? (X.t - a) / (b - a) : X.t >= a ? 1 : 0),
    lin: (a, b) => clamp(b > a ? (X.t - a) / (b - a) : X.t >= a ? 1 : 0),
    pop(a, dur = 0.4) {
      cue("pop", a);
      return X.t < a ? 0 : back((X.t - a) / dur, 2.2);
    },
    drop(a, dur = 0.5) {
      cue("thump", a + dur * 0.8);
      const q = clamp((X.t - a) / dur);
      return q < 0.8
        ? easeIn(q / 0.8)
        : 1 - Math.sin(((q - 0.8) / 0.2) * PI) * 0.06;
    },
    move: (from, to, a, b) =>
      lerp(from, to, inOut(b > a ? (X.t - a) / (b - a) : 1)),
    moving: (a, b) => X.t >= a && X.t < b,
    wave: (speed = 1, amount = 1) => Math.sin(X.T * speed * TAU) * amount,
    sound(kind, at, len) {
      if (!SOUND_KINDS.includes(kind))
        throw new Error(
          `No sound "${kind}". The sounds: ${SOUND_KINDS.join(", ")}.`,
        );
      cue(kind, at, len);
    },
    // the camera and groups
    camera(x, y, zoom = 1, rot = 0) {
      X.g.translate(F.w / 2, F.h / 2);
      X.g.scale(zoom, zoom);
      X.g.rotate(rot);
      X.g.translate(-x, -y);
    },
    group: sealed((o, fn) => {
      X.g.save();
      X.g.translate(o.x ?? 0, o.y ?? 0);
      if (o.rot) X.g.rotate(o.rot);
      const s = o.scale ?? 1;
      if (s !== 1) X.g.scale(s, s);
      if (o.alpha !== undefined) X.g.globalAlpha *= clamp(o.alpha);
      try {
        if (s > 0.001 && (o.alpha === undefined || o.alpha > 0.001)) fn();
      } finally {
        X.g.restore();
      }
    }),
    shake(amount = 10) {
      X.g.translate(Math.sin(X.T * 53) * amount, Math.cos(X.T * 47) * amount);
    },
    // places
    sky: sealed(sky),
    ground: sealed(ground),
    room: sealed(room),
    desk: sealed(desk),
    plain: sealed(plain),
    weather: sealed(weather),
    // who and what
    person: sealed((who, x, y, size, o) => {
      const def = typeof who === "string" ? F.cast[who] : who;
      if (!def)
        throw new Error(
          `No one called "${who}" in the cast. The cast: ${Object.keys(F.cast).join(", ") || "none"}.`,
        );
      return person(def, x, y, size, {
        ...o,
        seed: o?.seed ?? F.castSeed[who],
      });
    }),
    her: sealed(her),
    bot: sealed(bot),
    dog: sealed(dog),
    cat: sealed(cat),
    thing: sealed(thing),
    photo: sealed((name, x, y, size, o = {}) => {
      if (!F.images[name])
        throw new Error(
          `No picture called "${name}". The pictures: ${Object.keys(F.images).join(", ") || "none"}.`,
        );
      return thing("photo", x, y, size, { ...o, image: name });
    }),
    card: sealed(card),
    // what happens at a second in the scene
    sparkles(x, y, at, o = {}) {
      cue("sparkle", at);
      sealed(sparkles)(x, y, (X.t - at) / (o.dur ?? 0.9), o);
    },
    burst(x, y, at, o = {}) {
      sealed(burst)(x, y, (X.t - at) / (o.dur ?? 0.35), o);
    },
    hearts(x, y, at, o = {}) {
      sealed(hearts)(x, y, (X.t - at) / (o.dur ?? 2), o);
    },
    confetti(at, o = {}) {
      cue("pop", at);
      sealed(confetti)((X.t - at) / (o.dur ?? 3), o);
    },
    fireworks(at, o = {}) {
      sealed(fireworks)((X.t - at) / (o.dur ?? 3), o);
    },
    // words
    write(text, x, y, o = {}) {
      return writeOn(text, x, y, o);
    },
    note(text, x, y, o = {}) {
      return noteOn(text, x, y, o, false);
    },
    bubble(text, x, y, o = {}) {
      return noteOn(text, x, y, o, true);
    },
    // paper and crayon, for anything the kit has not got
    paper: (pts, color, o) => paper(pts, color, o),
    crayon: (pts, w, color, o) => crayon(pts, w, color, o),
    fill: (pts, color, o) => blob(pts, color, o),
    ellipse,
    rect,
    star,
    heart,
    cloud,
    arc,
    curve,
    tube,
    shade,
    mix: mixColor,
    ease: { inOut, out: easeOut, in: easeIn, back },
  };
  return d;
}

/** When the pen starts and how long it takes: `at` a second, or [start, end]. */
function penTime(text, at, o) {
  if (Array.isArray(at)) return [at[0], Math.max(at[0] + 0.05, at[1])];
  const start = at ?? 0;
  const n = [...String(text)].length;
  // Letters a second the pen writes at, unless told
  return [start, start + Math.max(0.35, n / (o.speed ?? 16))];
}
function writeOn(text, x, y, o) {
  const [a, b] = penTime(text, o.at, o);
  cue("write", a, b - a);
  const p = clamp((X.t - a) / (b - a));
  const box = handText(text, x, y, {
    ...o,
    p,
    seed: o.seed ?? 7 + [...String(text)].length,
  });
  heard(text, box, o.size ?? 64, b);
  return box;
}
/** Words on a torn note (or in a speech bubble) that pops up, then is written on. */
function noteOn(text, x, y, o, isBubble) {
  const size = o.size ?? 56;
  const [a, b] = penTime(
    text,
    (Array.isArray(o.at) ? o.at[0] : (o.at ?? 0)) + 0.25,
    o,
  );
  const lines = wrap(text, size, o.width ?? F.w * 0.6, o);
  const w = Math.max(...lines.map((l) => l.w)) + size * 1.6;
  const h = size * 1.25 * (lines.length - 1) + size * 2;
  const s = X.t < a - 0.25 ? 0 : back((X.t - (a - 0.25)) / 0.35, 2.2);
  cue("pop", a - 0.25);
  cue("write", a, b - a);
  const seed = nextSeed(o);
  const rot = o.rot ?? (hash(seed, 1) - 0.5) * 0.06;
  X.g.save();
  X.g.translate(x, y);
  X.g.rotate(rot);
  X.g.scale(Math.max(0.0001, s), Math.max(0.0001, s));
  const col = o.color ?? (isBubble ? "#ffffff" : X.colors.card);
  if (isBubble && o.to) {
    // The tail points toward where the words come from, out of the bubble's edge
    const ang = Math.atan2(o.to[1] - y, o.to[0] - x) - rot;
    const edge = (a2, k) => [
      Math.cos(a2) * w * 0.52 * k,
      Math.sin(a2) * h * 0.55 * k,
    ];
    const reach = Math.min(
      Math.hypot(o.to[0] - x, o.to[1] - y) / Math.max(1, s),
      Math.hypot(w, h) * 0.5 + size * 1.2,
    );
    paper(
      [
        edge(ang - 0.22, 0.9),
        [Math.cos(ang) * reach, Math.sin(ang) * reach],
        edge(ang + 0.22, 0.9),
      ],
      col,
      { seed: seed + 1, rim: 2.6 },
    );
  }
  paper(
    isBubble
      ? ellipse(0, 0, w * 0.58, h * 0.62, 60)
      : rect(-w / 2, -h / 2, w, h, 6),
    col,
    { seed, rim: 3.2, shadow: 12 },
  );
  if (!isBubble && o.tape !== false) {
    X.g.save();
    X.g.translate(0, -h / 2 + 4);
    X.g.rotate((hash(seed, 2) - 0.5) * 0.2);
    paper(
      rect(-Math.min(90, w * 0.25), -15, Math.min(180, w * 0.5), 30, 1),
      "rgba(246,236,205,0.85)",
      { seed: seed + 2, rim: 0, shadow: 0, jag: 3 },
    );
    X.g.restore();
  }
  const p = clamp((X.t - a) / (b - a));
  const box = handText(text, 0, -h / 2 + size * 1.25, {
    ...o,
    size,
    color: o.ink ?? X.colors.ink,
    width: o.width ?? F.w * 0.6,
    p,
    seed: seed + 5,
  });
  heard(text, { ...box, y: -h / 2, h }, size, b);
  X.g.restore();
  return { x: x - w / 2, y: y - h / 2, w, h };
}

// ---------------------------------------------------------------- the film laid out
// What the film's code threw outside any scene, for put to name: a film that throws before it
// calls film() is never laid out, and put stops waiting for it at once
window.THROWN = [];
window.addEventListener("error", (e) => window.THROWN.push(String(e.message)));
window.film = (def) => {
  if (F) throw new Error("film() was called twice: one film to a page.");
  window.FILM_CALLED = true;
  const problems = [];
  const size = SIZES[def.size ?? "1920x1080"];
  if (!size)
    problems.push(
      `size "${def.size}" is not one of ${Object.keys(SIZES).join(", ")}.`,
    );
  const mood = MOODS[def.mood ?? "warm"] ? (def.mood ?? "warm") : null;
  if (!mood)
    problems.push(
      `mood "${def.mood}" is not one of ${Object.keys(MOODS).join(", ")}.`,
    );
  const bpm = def.bpm ?? MOODS[mood ?? "warm"].bpm;
  const spb = 60 / bpm;
  const scenes = Array.isArray(def.scenes) ? def.scenes : [];
  if (!scenes.length) problems.push("scenes: give at least one scene.");
  let beat = 0;
  const laid = scenes.map((s, i) => {
    if (typeof s?.draw !== "function")
      problems.push(`scene ${i + 1} has no draw(d) function.`);
    const secs = Number(s?.seconds ?? 3);
    if (!(secs > 0))
      problems.push(`scene ${i + 1}: seconds must be a number above 0.`);
    const enter = i === 0 ? "cut" : (s?.enter ?? def.enter ?? "fade");
    if (!ENTERS.includes(enter))
      problems.push(
        `scene ${i + 1}: enter "${enter}" is not one of ${ENTERS.join(", ")}.`,
      );
    // Each scene lasts whole beats, so every change of scene lands on the music's beat
    const beats = Math.max(2, Math.round(secs / spb));
    const out = {
      i,
      draw: s?.draw,
      enter,
      beats,
      b0: beat,
      t0: beat * spb,
      t1: (beat + beats) * spb,
      big: Boolean(s?.big),
    };
    beat += beats;
    return out;
  });
  // The last card holds a beat longer while the music comes to rest
  const hold = 2;
  const total = (beat + hold) * spb;
  if (laid.length) laid[laid.length - 1].t1 = total;
  const elsewhere = (src) =>
    /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(String(src)) && !/^data:/i.test(src);
  for (const [name, src] of Object.entries(def.images ?? {}))
    if (elsewhere(src))
      problems.push(
        `The picture "${name}" is ${src}: a picture from elsewhere cannot go into the mp4. Save it in the film's folder and name it by its path there, like "pictures/${name}.jpg".`,
      );
  const cast = def.cast ?? {};
  const castSeed = Object.fromEntries(
    Object.keys(cast).map((k, i) => [k, 7001 + i * 97]),
  );
  const [w, h] = size ?? [1920, 1080];
  F = {
    title: def.title ?? document.title,
    w,
    h,
    fps: 30,
    bpm,
    spb,
    mood: mood ?? "warm",
    seed: Number(def.seed ?? 1),
    scenes: laid,
    duration: total,
    totalBeats: beat + hold,
    cast,
    castSeed,
    // Only pictures from the film's folder are loaded: one from elsewhere is refused above
    images: Object.fromEntries(
      Object.entries(def.images ?? {}).filter(([, src]) => !elsewhere(src)),
    ),
    colors: {
      paper: "#fbf6ea",
      ink: "#2b3a67",
      card: "#f8f0dc",
      rim: "#fdf8ec",
      ...(def.colors ?? {}),
    },
    problems,
  };
  start().catch((error) => {
    F.problems.push(String(error?.message ?? error));
    window.FILM = { ...(window.FILM ?? info([])), problems: F.problems };
    window.READY = true;
  });
};

function info(cues) {
  return {
    title: F.title,
    width: F.w,
    height: F.h,
    fps: F.fps,
    bpm: F.bpm,
    mood: F.mood,
    seed: F.seed,
    duration: F.duration,
    totalBeats: F.totalBeats,
    scenes: F.scenes.map((s) => ({
      t0: s.t0,
      t1: s.t1,
      b0: s.b0,
      beats: s.beats,
      enter: s.enter,
      big: s.big,
    })),
    cues,
    errors: F.errors ?? [],
    problems: F.problems,
    words: F.words ?? [],
    faces: F.faces ?? [],
  };
}

async function start() {
  canvas.width = F.w;
  canvas.height = F.h;
  await document.fonts.load('64px "Hand"', "가Aa").catch(() => {});
  await document.fonts.ready;
  const loads = Object.entries(F.images).map(
    ([name, src]) =>
      new Promise((done) => {
        const img = new Image();
        img.onload = () => {
          X.images[name] = img;
          done();
        };
        img.onerror = () => {
          F.problems.push(
            `The picture "${name}" (${src}) did not load: put it in the film's folder.`,
          );
          done();
        };
        img.src = src;
      }),
  );
  await Promise.all(loads);
  F.errors = [];
  F.words = [];
  F.faces = [];
  const cues = listen();
  window.FILM = info(cues);
  if (F.problems.length || !F.scenes.length) {
    window.READY = true;
    return;
  }
  if (!RENDER) player();
  else paintAt(0, g0);
  window.READY = true;
}

/**
 * A pass over the whole film that draws nothing: the sounds its scenes ask for, where its
 * words land, and what throws.
 */
function listen() {
  const heardCues = [];
  const seen = new Set();
  X.dry = true;
  X.cues = [];
  for (const s of F.scenes) {
    const len = s.t1 - s.t0;
    X.words = [];
    for (let t = 0; t < len; t += 0.1)
      drawScene(s, t, layer(0).getContext("2d"));
    // Words and faces as they stand once the scene has settled
    X.words = [];
    X.faces = [];
    drawScene(s, len - 0.05, layer(0).getContext("2d"));
    for (const w of X.words)
      F.words.push({ scene: s.i + 1, ...w, sceneLen: len });
    for (const f of X.faces) F.faces.push({ scene: s.i + 1, ...f });
  }
  for (const [at, kind, len] of X.cues) {
    const key = `${kind}|${Math.round(at * 20)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    heardCues.push({ at, kind, len });
  }
  // The changes of scene make their own sounds
  for (const s of F.scenes.slice(1)) {
    const kind = {
      tear: "rustle",
      page: "rustle",
      slide: "whoosh",
      zoom: "whoosh",
      iris: "pop",
    }[s.enter];
    if (kind) heardCues.push({ at: s.t0, kind, len: 0 });
  }
  X.dry = false;
  X.cues = null;
  X.words = null;
  X.faces = null;
  return heardCues.sort((a, b) => a.at - b.at);
}

function drawScene(s, t, g) {
  X.g = g;
  X.W = F.w;
  X.H = F.h;
  X.t = t;
  X.T = s.t0 + t;
  X.len = s.t1 - s.t0;
  X.n = 0;
  X.colors = F.colors;
  // A ground drawn with no sky before it is lit by day, whatever the frame before drew
  HOUR = "day";
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (!X.dry) {
    g.globalAlpha = 1;
    g.fillStyle = tex(F.colors.paper);
    g.fillRect(0, 0, F.w, F.h);
  }
  try {
    D ??= makeD();
    s.draw(D);
  } catch (error) {
    if (!F.errors.some((e) => e.scene === s.i + 1))
      F.errors.push({
        scene: s.i + 1,
        at: Number(t.toFixed(2)),
        message: String(error?.message ?? error),
        line: lineOf(error),
      });
    if (!X.dry) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = "rgba(160,20,20,0.85)";
      g.fillRect(0, F.h - 90, F.w, 90);
      g.fillStyle = "#fff";
      g.font = "32px sans-serif";
      g.fillText(`Scene ${s.i + 1}: ${error?.message ?? error}`, 30, F.h - 35);
    }
  }
  g.restore();
}
/** The line of the film's code an error came from, where the browser says. */
function lineOf(error) {
  const m = /film-code[^:]*:(\d+)/.exec(String(error?.stack ?? ""));
  // The script's first line is the empty one after its tag
  return m ? Number(m[1]) - 1 : null;
}

// ---------------------------------------------------------------- one frame
function paintAt(time, g, post = true) {
  const t = clamp(time, 0, F.duration - 1e-6);
  const i = Math.max(
    0,
    F.scenes.findIndex((s) => t >= s.t0 && t < s.t1),
  );
  const s = F.scenes[i];
  const local = t - s.t0;
  const prev = F.scenes[i - 1];
  const D = Math.min(TRANSITION_S, (s.t1 - s.t0) * 0.5);
  if (!prev || s.enter === "cut" || local >= D) {
    drawScene(s, local, g);
  } else {
    const q = inOut(local / D);
    const A = layer(1);
    const B = layer(2);
    drawScene(prev, t - prev.t0, A.getContext("2d"));
    drawScene(s, local, B.getContext("2d"));
    transition(s.enter, q, A, B, g, s.i);
  }
  if (post) grain(g, Math.round(t * F.fps));
}

/** From the scene before (A) to this one (B), `q` of the way. */
function transition(kind, q, A, B, g, seed) {
  const W = F.w;
  const H = F.h;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  if (kind === "fade") {
    g.drawImage(A, 0, 0);
    g.globalAlpha = q;
    g.drawImage(B, 0, 0);
  } else if (kind === "slide") {
    g.drawImage(A, -q * W * 0.35, 0);
    g.save();
    g.shadowColor = "rgba(20,14,48,0.35)";
    g.shadowBlur = 40;
    g.drawImage(B, (1 - q) * W, 0);
    g.restore();
  } else if (kind === "zoom") {
    g.save();
    g.translate(W / 2, H / 2);
    const z = 1 + q * 1.6;
    g.scale(z, z);
    g.drawImage(A, -W / 2, -H / 2);
    g.restore();
    g.save();
    g.globalAlpha = smooth(q * 1.4);
    g.translate(W / 2, H / 2);
    const z2 = 0.8 + 0.2 * q;
    g.scale(z2, z2);
    g.drawImage(B, -W / 2, -H / 2);
    g.restore();
  } else if (kind === "iris") {
    g.drawImage(A, 0, 0);
    const r = easeIn(q) * Math.hypot(W, H) * 0.55;
    g.save();
    g.beginPath();
    const n = 90;
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * TAU;
      const rr = r * (1 + (hash(k % n, seed) - 0.5) * 0.06);
      k
        ? g.lineTo(W / 2 + Math.cos(a) * rr, H / 2 + Math.sin(a) * rr)
        : g.moveTo(W / 2 + Math.cos(a) * rr, H / 2 + Math.sin(a) * rr);
    }
    g.closePath();
    g.shadowColor = "rgba(20,14,48,0.35)";
    g.shadowBlur = 30;
    g.fillStyle = "#fdf8ec";
    g.fill();
    g.clip();
    g.drawImage(B, 0, 0);
    g.restore();
  } else if (kind === "page") {
    // The old page folds away to the left, the new one under it
    g.drawImage(B, 0, 0);
    const w = W * (1 - q);
    g.save();
    g.shadowColor = "rgba(20,14,48,0.4)";
    g.shadowBlur = 50;
    g.shadowOffsetX = 20;
    g.drawImage(A, 0, 0, W * (1 - q), H, 0, 0, w, H);
    g.restore();
    const sh = g.createLinearGradient(w - 80, 0, w, 0);
    sh.addColorStop(0, "rgba(0,0,0,0)");
    sh.addColorStop(1, "rgba(0,0,0,0.18)");
    g.fillStyle = sh;
    g.fillRect(w - 80, 0, 80, H);
  } else {
    // tear: the old scene is torn away along a ragged line that crosses the frame
    g.drawImage(B, 0, 0);
    const x0 = lerp(-W * 0.25, W * 1.15, q);
    const pts = [];
    for (let k = 0; k <= 40; k++) {
      const y = (H * k) / 40;
      pts.push([
        x0 +
          (y - H / 2) * 0.35 +
          (hash(k, seed + 3) - 0.5) * 34 +
          (noise(k * 0.4, seed) - 0.5) * 60,
        y,
      ]);
    }
    g.save();
    g.beginPath();
    g.moveTo(W + 10, -10);
    for (const [x, y] of pts) g.lineTo(x, y);
    g.lineTo(W + 10, H + 10);
    g.closePath();
    g.shadowColor = "rgba(20,14,48,0.35)";
    g.shadowBlur = 24;
    g.fillStyle = "#fdf8ec";
    g.fill();
    g.restore();
    g.save();
    g.beginPath();
    g.moveTo(W + 10, -10);
    for (const [x, y] of pts)
      g.lineTo(x + 7 + hash(Math.round(y), seed) * 6, y);
    g.lineTo(W + 10, H + 10);
    g.closePath();
    g.clip();
    g.drawImage(A, 0, 0);
    g.restore();
  }
  g.restore();
}

let GRAIN = null;
/** Paper grain over everything, moving on twos, and a soft vignette. */
function grain(g, f) {
  if (!GRAIN) {
    const c = document.createElement("canvas");
    c.width = c.height = 384;
    const x = c.getContext("2d");
    const d = x.createImageData(384, 384);
    for (let i = 0; i < d.data.length; i += 4) {
      const v = 128 + (hash(i, 7) - 0.5) * 90 + (hash(i >> 3, 8) - 0.5) * 40;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
      d.data[i + 3] = 255;
    }
    x.putImageData(d, 0, 0);
    GRAIN = g.createPattern(c, "repeat");
  }
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 0.08;
  g.globalCompositeOperation = "overlay";
  const hold = Math.floor(f / 2);
  g.translate(
    -Math.floor(hash(hold, 1) * 384),
    -Math.floor(hash(hold, 2) * 384),
  );
  g.fillStyle = GRAIN;
  g.fillRect(0, 0, F.w + 384, F.h + 384);
  g.restore();
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  const v = g.createRadialGradient(
    F.w / 2,
    F.h / 2,
    Math.min(F.w, F.h) * 0.45,
    F.w / 2,
    F.h / 2,
    Math.hypot(F.w, F.h) * 0.62,
  );
  v.addColorStop(0, "rgba(30,15,40,0)");
  v.addColorStop(1, "rgba(30,15,40,0.22)");
  g.fillStyle = v;
  g.fillRect(0, 0, F.w, F.h);
  g.restore();
}

/**
 * Frame `n` as the mp4 takes it: `sub` pictures across half the frame's time averaged, a
 * camera's motion blur, never reaching across a cut into the next scene.
 */
window.frame = (n, sub = 1) => {
  const t = n / F.fps;
  X.boil = Math.floor(n / 2) % 5;
  if (sub <= 1) {
    paintAt(t, g0);
    return;
  }
  const s =
    F.scenes.find((x) => t >= x.t0 && t < x.t1) ??
    F.scenes[F.scenes.length - 1];
  // Each picture is drawn on the page's own canvas and averaged into a layer beside it
  const acc = layer(3).getContext("2d", CPU);
  for (let k = 0; k < sub; k++) {
    const tk = clamp(
      t + ((k + 0.5) / sub - 0.5) * (0.5 / F.fps),
      s.t0,
      s.t1 - 1e-4,
    );
    paintAt(tk, g0, false);
    acc.globalAlpha = 1 / (k + 1);
    acc.drawImage(canvas, 0, 0);
  }
  g0.save();
  g0.setTransform(1, 0, 0, 1, 0, 0);
  g0.globalAlpha = 1;
  g0.drawImage(layer(3), 0, 0);
  g0.restore();
  // The paper's grain and the vignette over the finished frame, once
  grain(g0, n);
};

// ---------------------------------------------------------------- the player
function player() {
  document.body.classList.add("play");
  const btn = document.getElementById("play");
  const bar = document.getElementById("scrub");
  const fill = document.getElementById("scrub-fill");
  const time = document.getElementById("time");
  let playing = false;
  let from = 0; // film second playing started from
  let began = 0; // clock when it started
  let audio = null;
  let source = null;
  let buffer = null;
  const clock = () => (audio ? audio.currentTime : performance.now() / 1000);
  const now = () =>
    playing ? Math.min(F.duration, from + clock() - began) : from;
  const fmt = (s) =>
    `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  // The music is made once the first frame shows, so pressing play does not wait for it
  let made = null;
  const compose = () => {
    if (!made && typeof composeScore === "function")
      made = composeScore(window.FILM, 48000);
  };
  setTimeout(compose, 300);
  const sound = () => {
    if (buffer) return;
    try {
      compose();
      audio = new AudioContext({ sampleRate: made.rate });
      buffer = audio.createBuffer(2, made.left.length, made.rate);
      buffer.copyToChannel(made.left, 0);
      buffer.copyToChannel(made.right, 1);
    } catch {
      audio = null;
    }
  };
  const stopSound = () => {
    try {
      source?.stop();
    } catch {}
    source = null;
  };
  const play = () => {
    if (from >= F.duration - 0.05) from = 0;
    sound();
    stopSound();
    if (audio && buffer) {
      audio.resume();
      source = audio.createBufferSource();
      source.buffer = buffer;
      source.connect(audio.destination);
      source.start(0, from);
    }
    began = clock();
    playing = true;
    btn.classList.add("on");
  };
  const pause = () => {
    from = now();
    playing = false;
    stopSound();
    btn.classList.remove("on");
  };
  btn.onclick = () => (playing ? pause() : play());
  canvas.onclick = btn.onclick;
  const seekTo = (e) => {
    const r = bar.getBoundingClientRect();
    const was = playing;
    if (was) pause();
    from = clamp((e.clientX - r.left) / r.width) * F.duration;
    if (was) play();
  };
  bar.onpointerdown = (e) => {
    seekTo(e);
    bar.setPointerCapture(e.pointerId);
    bar.onpointermove = seekTo;
  };
  bar.onpointerup = () => {
    bar.onpointermove = null;
  };
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      btn.onclick();
    }
  });
  const loop = () => {
    const t = now();
    if (playing && t >= F.duration) pause();
    X.boil = Math.floor(t * F.fps * 0.5) % 5;
    paintAt(t, g0);
    fill.style.width = `${(t / F.duration) * 100}%`;
    time.textContent = `${fmt(t)} / ${fmt(F.duration)}`;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
