// The paper and the crayon everything in a film is drawn with: crayon-textured colours, shapes
// cut out of paper with a torn white rim and a soft shadow, crayon lines, and handwriting that
// writes itself. Everything here is a function of the frame alone: the same frame draws the
// same picture, so a film renders the same every time.
//
// One state, `X`, is the frame being drawn: film.js sets it before each scene draws.

const PI = Math.PI;
const TAU = PI * 2;
const X = {
  g: null, // the canvas drawn on
  W: 1920,
  H: 1080,
  t: 0, // seconds into the scene
  T: 0, // seconds into the film
  len: 1, // the scene's seconds
  boil: 0, // which of five redraws the lines are on: drawings tremble on twos
  dry: false, // a pass that only listens for sounds and words, drawing nothing
  n: 0, // the draw call counter: each call's tear and wobble stay its own
  colors: null,
  cues: null, // sounds heard in this pass: [second in film, kind, length]
  words: null, // words written in this pass, for the checks
  faces: null, // faces drawn in this pass, for the checks: words must not cover them
  images: {},
};

// ---------------------------------------------------------------- numbers
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, u) => a + (b - a) * u;
const smooth = (x) => ((x = clamp(x)), x * x * (3 - 2 * x));
const inOut = (x) => (
  (x = clamp(x)), x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2
);
const easeOut = (x) => ((x = clamp(x)), 1 - (1 - x) ** 3);
const easeIn = (x) => ((x = clamp(x)), x * x * x);
/** Past 1 and back: how a thing lands when it is dropped or popped. */
const back = (x, s = 1.7) => (
  (x = clamp(x)), 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2
);
function hash(a, b = 0) {
  let h =
    Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^
    Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
const noise = (x, s) => {
  const i = Math.floor(x);
  const f = x - i;
  return lerp(hash(i, s), hash(i + 1, s), f * f * (3 - 2 * f));
};
/** A seed for the next thing drawn: the same thing, drawn in the same order, keeps its own. */
const nextSeed = (o) => o?.seed ?? 97 + X.n++ * 7919;
/**
 * A drawing made of drawings counts as one: whatever it draws inside (a blink this frame,
 * none the next) never moves the seeds of what is drawn after it.
 */
const sealed = (fn) =>
  function (...a) {
    const n0 = X.n;
    try {
      return fn.apply(this, a);
    } finally {
      X.n = n0 + 1;
    }
  };
/**
 * A part drawn only some of the time (a flame until it is blown out, a blink) takes no seed
 * from what is drawn after it.
 */
function quiet(fn) {
  const n0 = X.n;
  try {
    fn();
  } finally {
    X.n = n0;
  }
}

// ---------------------------------------------------------------- colour
const rgbOf = (hex) => {
  const h = String(hex).replace("#", "");
  const n = parseInt(
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h.slice(0, 6),
    16,
  );
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const hexOf = ([r, g, b]) =>
  `#${[r, g, b]
    .map((v) =>
      Math.round(clamp(v, 0, 255))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
/** `hex` moved toward white (k > 0) or black (k < 0). */
const shade = (hex, k) =>
  hexOf(rgbOf(hex).map((v) => (k > 0 ? v + (255 - v) * k : v * (1 + k))));
const mixColor = (a, b, u) => {
  const A = rgbOf(a);
  const B = rgbOf(b);
  return hexOf(A.map((v, i) => lerp(v, B[i], u)));
};
const isHex = (c) =>
  typeof c === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c);

// ---------------------------------------------------------------- crayon textures
// A colour laid down in crayon: short waxy dabs a little lighter and darker than it, and the
// paper's tooth showing through. One tile per colour, made the first time it is asked for.
const TEX = new Map();
function makeTex(hex, script) {
  const S = 384;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const x = c.getContext("2d");
  x.fillStyle = hex;
  x.fillRect(0, 0, S, S);
  const [r, g, b] = rgbOf(hex);
  const seed = r * 7 + g * 131 + b * 1031;
  const lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255;
  const str = 1 - 0.65 * lum ** 2;
  for (let i = 0; i < 440; i++) {
    const px = hash(i, seed) * S;
    const py = hash(i, seed + 1) * S;
    const len = 14 + hash(i, seed + 2) * 50;
    const wd = 4 + hash(i, seed + 3) * 10;
    const v = hash(i, seed + 4) * 2 - 1;
    const k = v > 0 ? 0.3 * v * str : 0;
    const d = v < 0 ? 1 + 0.2 * v * str : 1;
    x.fillStyle = `rgba(${Math.round((r + (255 - r) * k) * d)},${Math.round((g + (248 - g) * k) * d)},${Math.round((b + (228 - b) * k) * d)},${0.22 + 0.3 * hash(i, seed + 6)})`;
    const ang = (hash(i, seed + 5) - 0.5) * 0.35;
    for (const dx of [-S, 0, S])
      for (const dy of [-S, 0, S]) {
        const X0 = px + dx;
        const Y0 = py + dy;
        if (X0 < -len || X0 > S + len || Y0 < -len || Y0 > S + len) continue;
        x.save();
        x.translate(X0, Y0);
        x.rotate(ang);
        x.beginPath();
        x.roundRect(-len / 2, -wd / 2, len, wd, wd / 2);
        x.fill();
        x.restore();
      }
  }
  if (script) {
    // Rows of tiny scribbled writing, like newsprint in a collage
    x.strokeStyle = script;
    x.lineWidth = 1.1;
    x.lineCap = "round";
    for (let row = 10; row < S; row += 15) {
      let px = hash(row, seed + 7) * -40;
      while (px < S) {
        const wl = 14 + hash(Math.floor(px), row) * 46;
        x.beginPath();
        for (let q = 0; q <= wl; q += 1.5) {
          const y = row + Math.sin(q * 1.1 + px) * 2.2;
          q ? x.lineTo(px + q, y) : x.moveTo(px + q, y);
        }
        x.stroke();
        px += wl + 7 + hash(row, Math.floor(px)) * 8;
      }
    }
  }
  const id = x.getImageData(0, 0, S, S);
  const dd = id.data;
  for (let p = 0, i = 0; p < dd.length; p += 4, i++) {
    let nv = (hash(i, seed + 9) - 0.5) * 14;
    if (hash(i, seed + 10) < 0.035) nv += 22;
    dd[p] = clamp(dd[p] + nv, 0, 255);
    dd[p + 1] = clamp(dd[p + 1] + nv, 0, 255);
    dd[p + 2] = clamp(dd[p + 2] + nv, 0, 255);
  }
  x.putImageData(id, 0, 0);
  return x.createPattern(c, "repeat");
}
/** A colour as crayon on paper; anything that is not #rgb or #rrggbb is used as it is. */
function tex(color, script) {
  if (!isHex(color)) return color;
  const key = script ? `${color}|${script}` : color;
  if (!TEX.has(key)) TEX.set(key, makeTex(color, script));
  return TEX.get(key);
}

// ---------------------------------------------------------------- shapes, as lists of points
const ellipse = (cx, cy, rx, ry = rx, n = 0) => {
  n = n || Math.max(20, Math.ceil((rx + ry) * 0.3));
  const o = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    o.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return o;
};
const rect = (x, y, w, h, r = 0) => {
  r = Math.min(r, w / 2, h / 2);
  if (r <= 0)
    return [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ];
  const o = [];
  const cs = [
    [x + w - r, y + r, -PI / 2],
    [x + w - r, y + h - r, 0],
    [x + r, y + h - r, PI / 2],
    [x + r, y + r, PI],
  ];
  for (const [cx, cy, a0] of cs)
    for (let k = 0; k <= 6; k++) {
      const a = a0 + (k / 6) * (PI / 2);
      o.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  return o;
};
const star = (cx, cy, r, n = 5, inner = 0.45, rot = -PI / 2) => {
  const o = [];
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i * PI) / n;
    const q = i % 2 ? r * inner : r;
    o.push([cx + Math.cos(a) * q, cy + Math.sin(a) * q]);
  }
  return o;
};
const cloud = (cx, cy, r, bumps = 7, ph = 0) => {
  const o = [];
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * TAU;
    const q = r * (0.82 + 0.26 * Math.abs(Math.sin((a * bumps) / 2 + ph)));
    o.push([cx + Math.cos(a) * q, cy + Math.sin(a) * q * 0.8]);
  }
  return o;
};
/** A heart `r` wide from its middle, its point at the bottom. */
const heart = (cx, cy, r) => {
  const o = [];
  for (let i = 0; i < 60; i++) {
    const t = (i / 60) * TAU;
    o.push([
      cx + (r * 16 * Math.sin(t) ** 3) / 16,
      cy -
        (r *
          (13 * Math.cos(t) -
            5 * Math.cos(2 * t) -
            2 * Math.cos(3 * t) -
            Math.cos(4 * t))) /
          16,
    ]);
  }
  return o;
};
const arc = (cx, cy, rx, ry, a0, a1, n = 0) => {
  n = n || Math.max(8, Math.ceil(Math.abs(a1 - a0) * 9));
  const o = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    o.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return o;
};
/** A smooth curve through the points. */
const curve = (...P) => {
  if (P.length === 1 && Array.isArray(P[0][0])) P = P[0];
  const o = [];
  const n = P.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = P[Math.max(0, i - 1)];
    const p1 = P[i];
    const p2 = P[i + 1];
    const p3 = P[Math.min(n - 1, i + 2)];
    for (let k = 0; k < 8; k++) {
      const t = k / 8;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (j) =>
        0.5 *
        (2 * p1[j] +
          (-p0[j] + p2[j]) * t +
          (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 +
          (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3);
      o.push([f(0), f(1)]);
    }
  }
  o.push(P[n - 1]);
  return o;
};
/** Points `step` apart along a line. */
function dense(P, step) {
  const o = [P[0]];
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1];
    const b = P[i];
    const k = Math.max(
      1,
      Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step),
    );
    for (let j = 1; j <= k; j++)
      o.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
  }
  return o;
}
/** The outline of a line `w` thick with round ends: an arm, a leg, a stem. */
function tube(P, w) {
  const L = [];
  const R = [];
  const n = P.length;
  const nrm = [];
  for (let i = 0; i < n; i++) {
    const a = P[Math.max(0, i - 1)];
    const b = P[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l;
    ty /= l;
    nrm.push([-ty, tx]);
    L.push([P[i][0] - (ty * w) / 2, P[i][1] + (tx * w) / 2]);
    R.push([P[i][0] + (ty * w) / 2, P[i][1] - (tx * w) / 2]);
  }
  const out = [...L];
  const ae = Math.atan2(nrm[n - 1][1], nrm[n - 1][0]);
  for (let k = 1; k < 8; k++) {
    const a = ae - (PI * k) / 8;
    out.push([
      P[n - 1][0] + (Math.cos(a) * w) / 2,
      P[n - 1][1] + (Math.sin(a) * w) / 2,
    ]);
  }
  for (let i = n - 1; i >= 0; i--) out.push(R[i]);
  const as = Math.atan2(nrm[0][1], nrm[0][0]);
  for (let k = 1; k < 8; k++) {
    const a = as - PI - (PI * k) / 8;
    out.push([
      P[0][0] + (Math.cos(a) * w) / 2,
      P[0][1] + (Math.sin(a) * w) / 2,
    ]);
  }
  return out;
}
const move = (P, dx, dy) => P.map(([x, y]) => [x + dx, y + dy]);

// ---------------------------------------------------------------- torn paper
function resample(pts, step) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const k = Math.max(
      1,
      Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step),
    );
    for (let j = 0; j < k; j++)
      out.push([
        a[0] + ((b[0] - a[0]) * j) / k,
        a[1] + ((b[1] - a[1]) * j) / k,
      ]);
  }
  return out;
}
function trace(g, arr) {
  g.beginPath();
  g.moveTo(arr[0], arr[1]);
  for (let i = 2; i < arr.length; i += 2) g.lineTo(arr[i], arr[i + 1]);
  g.closePath();
}
/**
 * A shape cut out of paper: filled with `color` in crayon, a torn white rim around it and a
 * soft shadow under it. o: rim (px, 0 for none), shadow (px, 0 for none), rimColor, seed.
 */
function paper(pts, color, o = {}) {
  const seed = nextSeed(o);
  if (X.dry || pts.length < 3) return;
  const g = X.g;
  const rim = o.rim ?? 3;
  const jag = o.jag ?? 1.5;
  const wob = o.wob ?? 2.2;
  const step = o.step ?? 4;
  const rs = resample(pts, step);
  const n = rs.length;
  let A = 0;
  for (let i = 0; i < n; i++) {
    const a = rs[i];
    const b = rs[(i + 1) % n];
    A += a[0] * b[1] - b[0] * a[1];
  }
  const sg = A > 0 ? 1 : -1;
  const inner = new Float32Array(n * 2);
  const outer = new Float32Array(n * 2);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const p = rs[i];
    const a = rs[(i - 1 + n) % n];
    const b = rs[(i + 1) % n];
    const tx = b[0] - a[0];
    const ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    const nx = (sg * ty) / l;
    const ny = (-sg * tx) / l;
    s += step;
    const lo = (noise(s * 0.02, seed * 7 + X.boil * 131) - 0.5) * wob;
    const j = (hash(i, seed * 13 + X.boil * 977) - 0.5) * jag;
    const rw =
      rim > 0
        ? rim * (0.2 + 1.5 * noise(s * 0.017, seed * 3 + 11) ** 1.6) +
          hash(i, seed * 5 + X.boil * 31) * rim * 0.8
        : 0;
    inner[i * 2] = p[0] + nx * (lo + j * 0.5);
    inner[i * 2 + 1] = p[1] + ny * (lo + j * 0.5);
    outer[i * 2] = p[0] + nx * (lo + rw + j);
    outer[i * 2 + 1] = p[1] + ny * (lo + rw + j);
  }
  g.save();
  const sh = o.shadow ?? 7;
  if (sh > 0) {
    g.shadowColor = `rgba(20,14,48,${o.shadowAlpha ?? 0.3})`;
    // Shadows are in pixels, whatever the zoom: taken from how big one unit is drawn
    const k = Math.hypot(g.getTransform().a, g.getTransform().b) || 1;
    g.shadowBlur = sh * k;
    g.shadowOffsetY = sh * 0.45 * k;
  }
  trace(g, outer);
  g.fillStyle = rim > 0 ? (o.rimColor ?? X.colors.rim) : tex(color, o.script);
  g.fill();
  g.restore();
  if (rim > 0) {
    trace(g, inner);
    g.fillStyle = tex(color, o.script);
    g.fill();
  }
}
/**
 * A crayon line through the points: wobbly, trembling on twos, a lighter streak down its
 * middle. o: dash ([on, off]), shine (false for none), seed.
 */
function crayon(P, w, color, o = {}) {
  const sd = nextSeed(o);
  if (X.dry || P.length < 2) return;
  const g = X.g;
  const j = o.jitter ?? w * 0.14;
  g.save();
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = tex(color);
  g.lineWidth = w;
  if (o.dash) g.setLineDash(o.dash);
  g.beginPath();
  P.forEach((p, i) => {
    const x = p[0] + (hash(i, sd + X.boil * 7) - 0.5) * j;
    const y = p[1] + (hash(i, sd + 1 + X.boil * 7) - 0.5) * j;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  });
  g.stroke();
  if (o.shine !== false && !o.dash && w > 3) {
    g.globalAlpha *= 0.22;
    g.strokeStyle = "#fff";
    g.lineWidth = w * 0.32;
    g.translate(-w * 0.12, -w * 0.14);
    g.stroke();
  }
  g.restore();
}
/** A flat crayon fill with no rim or shadow: eyes, cheeks, windows, dots. */
function blob(P, color, o = {}) {
  const sd = nextSeed(o);
  if (X.dry || P.length < 3) return;
  const g = X.g;
  const j = o.jitter ?? 1.2;
  g.fillStyle = tex(color);
  g.beginPath();
  P.forEach((p, i) => {
    const x = p[0] + (hash(i, sd + X.boil * 5) - 0.5) * j;
    const y = p[1] + (hash(i, sd + 2 + X.boil * 5) - 0.5) * j;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  });
  g.closePath();
  g.fill();
}

// ---------------------------------------------------------------- handwriting
// Written in the film's hand (a handwriting font carried in the page): each letter a little
// tilted and off the line, in crayon, and written left to right as the pen reaches it.
const HAND = '"Hand", "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';
const LINES = new Map();
function fontOf(size, o) {
  return `${o.weight ?? ""} ${size}px ${o.font ?? HAND}`.trim();
}
/** What a reader takes as one letter: a Hangul syllable, an accented letter, a whole emoji. */
const SEGMENTER =
  typeof Intl !== "undefined" && Intl.Segmenter
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;
const graphemes = (s) =>
  SEGMENTER ? [...SEGMENTER.segment(s)].map((g) => g.segment) : [...s];
// Scripts whose letters join, stack or reorder (Hebrew, Arabic, the scripts of India and
// South-east Asia): a line of them is written whole, as the font shapes it, never a letter
// at a time. Hebrew and Arabic run right to left.
const JOINED = /[֐-ࣿऀ-෿฀-࿿က-႟ក-៿יִ-﷿ﹰ-﻿]/;
const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const PICTURE = /\p{Extended_Pictographic}/u;
/** `text` broken into lines no wider than `width`: at spaces, or anywhere in a word too long. */
function wrap(text, size, width, o) {
  const key = `${text}|${size}|${width}|${o.font ?? ""}|${o.weight ?? ""}`;
  if (LINES.has(key)) return LINES.get(key);
  const g = X.g;
  g.save();
  g.font = fontOf(size, o);
  const wide = (s) => g.measureText(s).width;
  const out = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const word of para.split(/(\s+)/)) {
      if (!word) continue;
      const next = line + word;
      if (!width || wide(next.trimEnd()) <= width || !line.trim()) {
        line = next;
        // A word wider than the line alone is broken wherever it runs out
        while (
          width &&
          wide(line.trimEnd()) > width &&
          graphemes(line).length > 1
        ) {
          const chars = graphemes(line);
          let k = chars.length - 1;
          while (k > 1 && wide(chars.slice(0, k).join("")) > width) k--;
          out.push(chars.slice(0, k).join(""));
          line = chars.slice(k).join("");
        }
      } else {
        out.push(line.trimEnd());
        line = word.trimStart();
      }
    }
    out.push(line.trimEnd());
  }
  const lines = out.map((s) => {
    const chars = graphemes(s);
    if (JOINED.test(s))
      return { whole: s, rtl: RTL.test(s), chars, xs: [], w: wide(s) };
    const xs = [];
    let x = 0;
    for (const ch of chars) {
      xs.push(x);
      x += wide(ch) * 0.98;
    }
    return { chars, xs, w: x };
  });
  g.restore();
  LINES.set(key, lines);
  return lines;
}
/**
 * Writes `text` with its middle (or left, or right edge) at x and its first line's baseline
 * at y. `p` 0..1 is how much the pen has written. Returns the box it takes.
 */
function handText(text, x, y, o = {}) {
  const size = o.size ?? 64;
  const lh = size * (o.lineHeight ?? 1.25);
  const lines = wrap(text, size, o.width, o);
  const total = lines.reduce((a, l) => a + l.chars.length, 0);
  const w = Math.max(0, ...lines.map((l) => l.w));
  const h = lh * (lines.length - 1) + size;
  const align = o.align ?? "center";
  const left = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
  const box = { x: left, y: y - size * 0.85, w, h, lines: lines.length };
  if (X.dry) return box;
  const g = X.g;
  const seed = o.seed ?? 7;
  let budget = (o.p ?? 1) * total;
  g.save();
  g.font = fontOf(size, o);
  g.textBaseline = "alphabetic";
  g.textAlign = "left";
  const fill = tex(o.color ?? X.colors.ink);
  g.fillStyle = fill;
  g.strokeStyle = fill;
  g.lineWidth = size * (o.bold ?? 0.035);
  g.lineJoin = "round";
  let k = 0;
  lines.forEach((l, li) => {
    const lx =
      align === "center" ? x - l.w / 2 : align === "right" ? x - l.w : x;
    const ly = y + li * lh;
    if (l.whole) {
      // Written whole, uncovered in the direction it is read
      const n = l.chars.length;
      const part = clamp(budget / Math.max(1, n));
      budget -= n;
      k += n;
      if (part <= 0) return;
      g.save();
      g.translate(lx, ly);
      g.rotate((hash(li, seed) - 0.5) * 0.03);
      g.direction = l.rtl ? "rtl" : "ltr";
      if (part < 1) {
        const cw = (l.w + size * 0.2) * part;
        g.beginPath();
        g.rect(
          l.rtl ? l.w + size * 0.1 - cw : -size * 0.1,
          -size * 1.3,
          cw,
          size * 1.8,
        );
        g.clip();
      }
      g.fillText(l.whole, 0, 0);
      if (o.bold !== 0) g.strokeText(l.whole, 0, 0);
      g.restore();
      return;
    }
    l.chars.forEach((ch, ci) => {
      k++;
      if (budget <= 0 || !ch.trim()) {
        budget -= 1;
        return;
      }
      const part = Math.min(1, budget);
      budget -= 1;
      const i = k * 31 + li;
      const rot =
        (hash(i, seed) - 0.5) * 0.09 + (hash(i, seed + X.boil) - 0.5) * 0.015;
      const dy = (hash(i, seed + 2) - 0.5) * 0.07 * size;
      const s = 1 + (hash(i, seed + 3) - 0.5) * 0.08;
      const cw = g.measureText(ch).width;
      g.save();
      g.translate(lx + l.xs[ci] + cw / 2, ly + dy);
      g.rotate(rot);
      g.scale(s, s);
      if (part < 1) {
        // The letter the pen is on, revealed as far as it has got
        g.beginPath();
        g.rect(
          -cw / 2 - size * 0.1,
          -size * 1.2,
          (cw + size * 0.2) * part,
          size * 1.6,
        );
        g.clip();
      }
      g.fillText(ch, -cw / 2, 0);
      // An emoji keeps its own colours: no crayon outline around it
      if (o.bold !== 0 && !PICTURE.test(ch)) g.strokeText(ch, -cw / 2, 0);
      g.restore();
    });
  });
  g.restore();
  return box;
}

// ---------------------------------------------------------------- what the checks hear
/** A sound at `at` seconds into the scene, heard once however many frames ask for it. */
function cue(kind, at, len) {
  if (!X.cues || !Number.isFinite(at)) return;
  X.cues.push([X.T - X.t + at, kind, len ?? 0]);
}
/** Where a word landed on the screen, for the checks: off the frame, or too small to read. */
function heard(text, box, size, at) {
  if (!X.words) return;
  const m = X.g.getTransform();
  const pts = [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x, box.y + box.h],
    [box.x + box.w, box.y + box.h],
  ].map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  X.words.push({
    text: String(text),
    size: size * Math.hypot(m.a, m.b),
    x0: Math.min(...xs),
    x1: Math.max(...xs),
    y0: Math.min(...ys),
    y1: Math.max(...ys),
    at,
  });
}
/** Where a face is on the screen, and how tall the one it belongs to stands, for the checks. */
function faced(kind, x, y, r, tall) {
  if (!X.faces) return;
  const m = X.g.getTransform();
  const k = Math.hypot(m.a, m.b);
  X.faces.push({
    kind,
    x: m.a * x + m.c * y + m.e,
    y: m.b * x + m.d * y + m.f,
    r: r * k,
    tall: tall * k,
  });
}
