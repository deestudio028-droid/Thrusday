// Where a scene happens, and what is in the air: a sky at any hour, the ground under it, a
// room, a table seen from above, weather, sparkles, and the paper notes words are written on.
// A place fills the frame and a little past it, so a camera can move over it.

const SKY = {
  day: { base: "#9fd3f0", bands: ["#b7e0f4", "#8ecae9"], cloud: "#ffffff" },
  dusk: { base: "#f2a98a", bands: ["#f7c9a0", "#e08a86"], cloud: "#fbe3d2" },
  night: { base: "#272b6f", bands: ["#30378a", "#1f235e"], cloud: "#4b5199" },
  dawn: { base: "#f6c6c0", bands: ["#fbe0c8", "#e9a9b8"], cloud: "#fff4ea" },
};
/** The hour the last sky was drawn at, which the ground under it takes its light from. */
let HOUR = "day";
const bleed = () => {
  const m = X.g.getTransform();
  const k = Math.hypot(m.a, m.b) || 1;
  // What the frame shows, in the coordinates drawn in, with room around it
  const inv = m.inverse();
  const pts = [
    [0, 0],
    [X.W, 0],
    [0, X.H],
    [X.W, X.H],
  ].map(([x, y]) => [
    inv.a * x + inv.c * y + inv.e,
    inv.b * x + inv.d * y + inv.f,
  ]);
  const pad = 80 / k;
  return {
    x0: Math.min(...pts.map((p) => p[0])) - pad,
    x1: Math.max(...pts.map((p) => p[0])) + pad,
    y0: Math.min(...pts.map((p) => p[1])) - pad,
    y1: Math.max(...pts.map((p) => p[1])) + pad,
  };
};

/**
 * The sky, filling the frame. o: time ('day', 'dusk', 'night', 'dawn'), color (its base),
 * sun ([x, y] or false), moon ([x, y] or false), stars (count), clouds (count).
 */
function sky(o = {}) {
  const seed = nextSeed(o);
  const time = SKY[o.time] ? o.time : "day";
  HOUR = time;
  const P = SKY[time];
  const b = bleed();
  const base = o.color ?? P.base;
  if (!X.dry) {
    X.g.fillStyle = tex(base);
    X.g.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
  }
  // Torn bands laid across it, lighter and darker
  const bands = o.color ? [shade(base, 0.12), shade(base, -0.1)] : P.bands;
  bands.forEach((c, k) => {
    const y0 = X.H * (0.24 + k * 0.3);
    const pts = [];
    for (let x = b.x0; x <= b.x1 + 60; x += 60)
      pts.push([x, y0 + (noise(x * 0.004, seed + k) - 0.5) * 70]);
    pts.push([b.x1 + 60, b.y1 + 400], [b.x0, b.y1 + 400]);
    paper(pts, c, {
      seed: seed + 10 + k,
      rim: 2.4,
      jag: 2.4,
      wob: 3,
      shadow: 6,
      step: 6,
    });
  });
  const stars = o.stars ?? (time === "night" ? 40 : 0);
  for (let i = 0; i < stars; i++) {
    const sx = lerp(b.x0, b.x1, hash(i, seed + 201));
    const sy = lerp(b.y0, X.H * 0.62, hash(i, seed + 202));
    const r = 6 + hash(i, seed + 203) * 9;
    const tw = 0.78 + 0.22 * Math.sin(X.T * 2.6 + i);
    if (hash(i, seed + 204) < 0.62)
      blob(star(sx, sy, r * tw, 5, 0.46, hash(i, 5)), "#f8d65c", {
        seed: seed + i,
      });
    else {
      const q = r * 0.7 * tw;
      crayon(
        [
          [sx - q, sy],
          [sx + q, sy],
        ],
        3,
        "#e9e4ff",
        { shine: false, seed: seed + i * 2 },
      );
      crayon(
        [
          [sx, sy - q],
          [sx, sy + q],
        ],
        3,
        "#e9e4ff",
        { shine: false, seed: seed + i * 3 },
      );
    }
  }
  const moon = o.moon ?? (time === "night" ? [X.W * 0.8, X.H * 0.16] : false);
  if (moon) {
    X.g.save();
    X.g.translate(moon[0], moon[1]);
    X.g.rotate(-0.35);
    paper(
      [
        ...arc(0, 0, 62, 62, -PI * 0.62, PI * 0.62, 36),
        ...arc(-26, 0, 50, 54, PI * 0.5, -PI * 0.5, 30),
      ],
      "#f6e9c6",
      { seed: seed + 30, rim: 1.4, shadow: 12, shadowAlpha: 0.25 },
    );
    X.g.restore();
  }
  const sun =
    o.sun ??
    (time === "day"
      ? [X.W * 0.82, X.H * 0.17]
      : time === "dusk" || time === "dawn"
        ? [X.W * 0.3, X.H * 0.55]
        : false);
  if (sun) {
    const c = time === "day" ? "#f7c948" : "#f08a4b";
    if (!X.dry) {
      const gl = X.g.createRadialGradient(
        sun[0],
        sun[1],
        40,
        sun[0],
        sun[1],
        260,
      );
      gl.addColorStop(0, "rgba(255,240,190,0.45)");
      gl.addColorStop(1, "rgba(255,240,190,0)");
      X.g.fillStyle = gl;
      X.g.fillRect(sun[0] - 270, sun[1] - 270, 540, 540);
    }
    paper(ellipse(sun[0], sun[1], 70, 70, 40), c, {
      seed: seed + 31,
      rim: 2,
      shadow: 6,
    });
  }
  const clouds = o.clouds ?? (time === "night" ? 0 : 3);
  for (let i = 0; i < clouds; i++) {
    const span = b.x1 - b.x0 + 400;
    const cx =
      b.x0 -
      200 +
      ((hash(i, seed + 40) * span + X.T * (14 + 10 * hash(i, seed + 41))) %
        span);
    const cy = X.H * (0.1 + 0.3 * hash(i, seed + 42));
    paper(cloud(cx, cy, 70 + hash(i, seed + 43) * 50, 6, i), P.cloud, {
      seed: seed + 50 + i,
      rim: 2,
      shadow: 5,
    });
  }
}

const GROUND = {
  day: {
    hills: ["#8cc084", "#6fae6b", "#5a9a5c"],
    sea: "#4ea3d8",
    sand: "#f1d9a6",
    road: "#8d8f9c",
    house: ["#f4ecd9", "#f6c9a8", "#cfe3f0"],
    roof: ["#c9452c", "#3a6ea5", "#6b4430"],
    city: ["#9fb4cc", "#b7c6d8", "#8aa0ba"],
    snow: "#f5f7fb",
    win: "#bfe0f6",
  },
  dusk: {
    hills: ["#b98a7a", "#9c7070", "#7e5c68"],
    sea: "#7d78b0",
    sand: "#e6b98c",
    road: "#7a6f7c",
    house: ["#e8c3a8", "#d9a58e", "#c9a2a8"],
    roof: ["#9a3a3a", "#5a4a7a", "#5a3a30"],
    city: ["#8d7390", "#a2819a", "#7a6284"],
    snow: "#f1dce0",
    win: "#f8d65c",
  },
  night: {
    hills: ["#2c3179", "#252a6a", "#1d215a"],
    sea: "#23306e",
    sand: "#4b4f86",
    road: "#2a2c55",
    house: ["#363d93", "#2c3179", "#3a3f8a"],
    roof: ["#1f235e", "#252a6a", "#1a1d52"],
    city: ["#2c3179", "#363d93", "#252a6a"],
    snow: "#aab0d8",
    win: "#f8d65c",
  },
};
GROUND.dawn = GROUND.dusk;

/**
 * The ground from `y` down, lit by the last sky's hour. kind: hills, field, town, city, sea,
 * beach, snow, road. o: y (default three quarters down), color.
 */
function ground(kind, o = {}) {
  const seed = nextSeed(o);
  const P = GROUND[o.time ?? HOUR] ?? GROUND.day;
  const b = bleed();
  const y = o.y ?? X.H * 0.74;
  const night = (o.time ?? HOUR) === "night";
  const strip = (y0, amp, c, k, step = 60) => {
    const pts = [];
    for (let x = b.x0 - 60; x <= b.x1 + 60; x += step)
      pts.push([x, y0 + (noise(x * 0.003, seed + k) - 0.5) * amp]);
    pts.push([b.x1 + 60, b.y1 + 200], [b.x0 - 60, b.y1 + 200]);
    paper(pts, c, { seed: seed + k, rim: 2.4, shadow: 8, step: 6 });
  };
  if (kind === "hills" || kind === "field") {
    const c = o.color
      ? [shade(o.color, 0.15), o.color, shade(o.color, -0.12)]
      : P.hills;
    if (kind === "hills") {
      strip(y - 140, 220, c[0], 1, 90);
      strip(y - 50, 140, c[1], 2, 80);
    }
    strip(y + 30, 40, c[2], 3);
    if (kind === "field")
      for (let i = 0; i < 26; i++) {
        const fx = lerp(b.x0, b.x1, hash(i, seed + 9));
        const fy = y + 70 + hash(i, seed + 10) * (b.y1 - y - 90);
        blob(
          ellipse(fx, fy, 7, 7, 10),
          night ? "#8f96d6" : ["#fff6ea", "#f8d65c", "#f27caa"][i % 3],
        );
      }
  } else if (kind === "town" || kind === "city") {
    const rows = kind === "city" ? 2 : 2;
    for (let r = 0; r < rows; r++) {
      let x = b.x0 - 40;
      let i = 0;
      const base = y + 40 + r * 40;
      while (x < b.x1 + 40) {
        const k = seed + r * 100 + i;
        const w =
          kind === "city" ? 110 + hash(i, k) * 120 : 120 + hash(i, k) * 90;
        const h =
          kind === "city"
            ? (r ? 150 : 260) + hash(i, k + 1) * (r ? 160 : 300)
            : (r ? 110 : 170) + hash(i, k + 1) * 110;
        const roof =
          kind === "town" && hash(i, k + 2) < 0.75
            ? 50 + hash(i, k + 3) * 70
            : 0;
        const wall = kind === "city" ? P.city[i % 3] : P.house[(i + r) % 3];
        const top = base - h;
        const pts = [
          [x, b.y1 + 200],
          [x, top],
        ];
        if (roof) pts.push([x + w / 2, top - roof]);
        pts.push([x + w, top], [x + w, b.y1 + 200]);
        paper(pts, r ? wall : shade(wall, night ? -0.12 : -0.06), {
          seed: k + 5,
          rim: 2,
          shadow: 8,
        });
        if (roof)
          paper(
            [
              [x - 8, top + 4],
              [x + w / 2, top - roof - 4],
              [x + w + 8, top + 4],
            ],
            P.roof[i % 3],
            { seed: k + 6, rim: 2, shadow: 5 },
          );
        const cols = w > 180 ? 3 : 2;
        const rowsW = Math.max(1, Math.floor((h - 60) / 80));
        for (let q = 0; q < rowsW; q++)
          for (let c = 0; c < cols; c++) {
            const lit = night ? hash(q * 7 + c, k + 7) < 0.6 : false;
            blob(
              rect(
                x + (c + 0.5) * (w / cols) - 16,
                top + 36 + q * 76,
                32,
                40,
                3,
              ),
              lit ? "#f8d65c" : night ? "#1a1d52" : P.win,
              { seed: k + 20 + q * 7 + c },
            );
          }
        x +=
          w +
          (kind === "town"
            ? 30 + hash(i, k + 8) * 90
            : -4 + hash(i, k + 8) * 16);
        i++;
      }
    }
    strip(y + 150, 10, night ? "#1d215a" : "#9aa0a8", 4);
  } else if (kind === "sea" || kind === "beach") {
    const sea = o.color ?? P.sea;
    strip(y - 20, 6, shade(sea, 0.12), 1, 120);
    for (let k = 0; k < 3; k++) {
      const pts = [];
      const yy = y + 20 + k * 38;
      for (let x = b.x0 - 60; x <= b.x1 + 60; x += 30)
        pts.push([
          x,
          yy + Math.sin(x * 0.012 + X.T * (1.2 + k * 0.3) + k) * (6 + k * 3),
        ]);
      pts.push([b.x1 + 60, b.y1 + 200], [b.x0 - 60, b.y1 + 200]);
      paper(pts, shade(sea, -0.06 * k), {
        seed: seed + 3 + k,
        rim: 2,
        shadow: 5,
        step: 6,
      });
    }
    if (kind === "beach") {
      const pts = [];
      for (let x = b.x0 - 60; x <= b.x1 + 60; x += 40)
        pts.push([x, y + 150 + Math.sin(x * 0.006 + X.T * 0.9) * 10]);
      pts.push([b.x1 + 60, b.y1 + 200], [b.x0 - 60, b.y1 + 200]);
      paper(pts, P.sand, { seed: seed + 9, rim: 3, shadow: 6, step: 6 });
      for (let i = 0; i < 6; i++)
        blob(
          star(
            lerp(b.x0, b.x1, hash(i, seed + 11)),
            y + 210 + hash(i, seed + 12) * 90,
            10,
            5,
            0.5,
            i,
          ),
          "#f08a4b",
          { seed: seed + 40 + i },
        );
    }
  } else if (kind === "snow") {
    const c = o.color ?? P.snow;
    strip(y - 60, 160, shade(c, -0.05), 1, 90);
    strip(y + 30, 60, c, 2);
  } else if (kind === "road") {
    strip(y - 30, 40, (o.color && shade(o.color, 0.1)) ?? P.hills[0], 1);
    const ry = y + 60;
    paper(
      [
        [b.x0 - 60, ry],
        [b.x1 + 60, ry],
        [b.x1 + 60, ry + 170],
        [b.x0 - 60, ry + 170],
      ],
      P.road,
      { seed: seed + 2, rim: 2, shadow: 6 },
    );
    for (let x = b.x0 - 60; x < b.x1 + 60; x += 160)
      blob(rect(x, ry + 78, 80, 12, 4), "#f4ecd9", {
        seed: seed + Math.round(x),
      });
    strip(ry + 200, 20, o.color ?? P.hills[2], 3);
  } else
    throw new Error(
      `No ground "${kind}". The grounds: hills, field, town, city, sea, beach, snow, road.`,
    );
}

/**
 * A room, filling the frame: a wall, a floor from `y` down, and a window showing the hour.
 * o: wall, floor, y, window ('day', 'dusk', 'night' or false), curtains, lamp, frames, shelf.
 */
function room(o = {}) {
  const seed = nextSeed(o);
  const b = bleed();
  const y = o.y ?? X.H * 0.8;
  const wall = o.wall ?? "#f3c350";
  const floor = o.floor ?? "#c99560";
  if (!X.dry) {
    X.g.fillStyle = tex(wall);
    X.g.fillRect(b.x0, b.y0, b.x1 - b.x0, y - b.y0 + 4);
  }
  // A skirting board and the floorboards
  paper(
    [
      [b.x0 - 40, y - 8],
      [b.x1 + 40, y - 8],
      [b.x1 + 40, b.y1 + 100],
      [b.x0 - 40, b.y1 + 100],
    ],
    floor,
    { seed: seed + 1, rim: 2.4, shadow: 10 },
  );
  for (let k = 1; k < 6; k++)
    crayon(
      dense(
        [
          [b.x0, y + k * 50 + k * k * 4],
          [b.x1, y + k * 50 + k * k * 4],
        ],
        80,
      ),
      3,
      shade(floor, -0.22),
      { shine: false, seed: seed + 2 + k },
    );
  const win = o.window ?? "day";
  const W = X.W;
  if (win) {
    const wx = o.windowAt ?? W * 0.62;
    const ww = Math.min(W * 0.26, 520);
    const wh = ww * 0.9;
    const wy = y - wh - X.H * 0.22;
    const P = SKY[win] ?? SKY.day;
    paper(rect(wx - 14, wy - 14, ww + 28, wh + 28, 4), o.frame ?? "#f4ecd9", {
      seed: seed + 3,
      rim: 2.4,
      shadow: 12,
    });
    if (!X.dry) {
      X.g.save();
      X.g.beginPath();
      X.g.rect(wx, wy, ww, wh);
      X.g.clip();
      X.g.fillStyle = tex(P.base);
      X.g.fillRect(wx, wy, ww, wh);
    }
    if (win === "night") {
      for (let i = 0; i < 8; i++)
        blob(
          star(
            wx + hash(i, seed) * ww,
            wy + hash(i, seed + 1) * wh * 0.7,
            6 + hash(i, seed + 2) * 5,
          ),
          "#f8d65c",
          { seed: seed + 60 + i },
        );
      paper(
        arc(
          wx + ww * 0.75,
          wy + wh * 0.25,
          26,
          26,
          -PI * 0.6,
          PI * 0.6,
          20,
        ).concat(
          arc(
            wx + ww * 0.75 - 10,
            wy + wh * 0.25,
            20,
            22,
            PI * 0.5,
            -PI * 0.5,
            16,
          ),
        ),
        "#f6e9c6",
        { seed: seed + 5, rim: 1, shadow: 4 },
      );
    } else {
      paper(
        cloud(wx + ww * 0.3 + ((X.T * 8) % ww), wy + wh * 0.3, 44),
        P.cloud,
        { seed: seed + 6, rim: 1.4, shadow: 3 },
      );
      if (win === "day")
        paper(ellipse(wx + ww * 0.8, wy + wh * 0.22, 30, 30), "#f7c948", {
          seed: seed + 7,
          rim: 1.4,
          shadow: 3,
        });
    }
    paper(
      [
        [wx, wy + wh],
        [wx, wy + wh * 0.72],
        [wx + ww * 0.4, wy + wh * 0.6],
        [wx + ww, wy + wh * 0.75],
        [wx + ww, wy + wh],
      ],
      (GROUND[win] ?? GROUND.day).hills[1],
      { seed: seed + 8, rim: 1.4, shadow: 3 },
    );
    if (!X.dry) X.g.restore();
    crayon(
      [
        [wx + ww / 2, wy],
        [wx + ww / 2, wy + wh],
      ],
      12,
      o.frame ?? "#f4ecd9",
      { seed: seed + 9 },
    );
    crayon(
      [
        [wx, wy + wh / 2],
        [wx + ww, wy + wh / 2],
      ],
      12,
      o.frame ?? "#f4ecd9",
      { seed: seed + 10 },
    );
    if (o.curtains !== false) {
      const c = o.curtains ?? "#ee8da3";
      for (const side of [0, 1]) {
        const cx = side ? wx + ww + 30 : wx - 30;
        const d = side ? 1 : -1;
        paper(
          [
            [cx - d * 70, wy - 50],
            [cx + d * 50, wy - 50],
            [cx + d * 30, wy + wh * 0.5],
            [cx + d * 60, wy + wh + 40],
            [cx - d * 70, wy + wh + 40],
          ],
          c,
          { seed: seed + 11 + side, rim: 2.4, shadow: 9 },
        );
      }
    }
  }
  if (o.frames !== false) {
    const fx = W * 0.2;
    const fy = y - X.H * 0.55;
    [
      [fx, fy, 130, 100, "#8fb6e8"],
      [fx + 170, fy + 30, 90, 110, "#f6b3c5"],
    ].forEach(([x0, y0, w, h, c], i) => {
      paper(rect(x0, y0, w, h, 2), "#8a5a3c", {
        seed: seed + 20 + i,
        rim: 1.8,
        shadow: 8,
      });
      paper(rect(x0 + 10, y0 + 10, w - 20, h - 20, 0), c, {
        seed: seed + 22 + i,
        rim: 0,
        shadow: 0,
      });
      blob(
        ellipse(x0 + w / 2, y0 + h * 0.62, w * 0.22, h * 0.2),
        "rgba(255,255,255,0.55)",
        { seed: seed + 24 + i },
      );
    });
  }
  if (o.lamp) {
    const lx = typeof o.lamp === "number" ? o.lamp : W * 0.1;
    if (!X.dry) {
      const gl = X.g.createRadialGradient(lx, y - 330, 20, lx, y - 330, 420);
      gl.addColorStop(0, "rgba(255,238,190,0.45)");
      gl.addColorStop(1, "rgba(255,238,190,0)");
      X.g.fillStyle = gl;
      X.g.fillRect(lx - 430, y - 760, 860, 860);
    }
    crayon(
      [
        [lx, y],
        [lx, y - 300],
      ],
      8,
      "#5a4034",
      { seed: seed + 30 },
    );
    paper(
      [
        [lx - 60, y - 290],
        [lx + 60, y - 290],
        [lx + 36, y - 390],
        [lx - 36, y - 390],
      ],
      "#fbe7b5",
      { seed: seed + 31, rim: 2, shadow: 6 },
    );
  }
}

/** A table seen from above, filling the frame: things are laid on it. o: color, cloth. */
function desk(o = {}) {
  const seed = nextSeed(o);
  const b = bleed();
  const c = o.color ?? "#cc9158";
  if (!X.dry) {
    X.g.fillStyle = tex(c);
    X.g.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
  }
  for (let k = 0; k < 12; k++) {
    const yy = b.y0 + (k + 0.5) * ((b.y1 - b.y0) / 12);
    crayon(
      dense(
        [
          [b.x0, yy],
          [lerp(b.x0, b.x1, 0.4), yy + (hash(k, seed) - 0.5) * 20],
          [b.x1, yy - 8],
        ],
        80,
      ),
      4,
      shade(c, -0.2),
      { shine: false, seed: seed + k },
    );
  }
  if (o.cloth)
    paper(rect(X.W * 0.14, X.H * 0.1, X.W * 0.72, X.H * 0.8, 6), o.cloth, {
      seed: seed + 20,
      rim: 3,
      shadow: 14,
    });
}
/** Plain paper filling the frame. */
function plain(color) {
  nextSeed();
  if (X.dry) return;
  const b = bleed();
  X.g.fillStyle = tex(color ?? X.colors.paper);
  X.g.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
}

// ---------------------------------------------------------------- what is in the air
/** Snow, rain, petals or leaves falling over the frame; `amount` 0..1. */
function weather(kind, amount = 0.6, o = {}) {
  const seed = nextSeed(o);
  const b = bleed();
  const n = Math.round(amount * 90);
  const t = X.T;
  const hgt = b.y1 - b.y0 + 100;
  for (let i = 0; i < n; i++) {
    const speed = kind === "rain" ? 900 : kind === "snow" ? 70 : 110;
    const x0 = lerp(b.x0, b.x1, hash(i, seed + 1));
    const y =
      b.y0 -
      50 +
      ((hash(i, seed + 2) * hgt + t * speed * (0.7 + 0.6 * hash(i, seed + 3))) %
        hgt);
    const x = x0 + (kind === "rain" ? -y * 0.12 : Math.sin(t * 1.3 + i) * 30);
    if (kind === "rain")
      crayon(
        [
          [x, y],
          [x - 8, y + 34],
        ],
        3,
        "rgba(190,215,255,0.7)",
        { shine: false, seed: seed + i },
      );
    else if (kind === "snow")
      blob(
        ellipse(x, y, 5 + hash(i, seed + 4) * 6, 5 + hash(i, seed + 4) * 6, 10),
        "#ffffff",
        { seed: seed + i },
      );
    else {
      const c =
        o.color ??
        (kind === "leaves"
          ? ["#e58a3a", "#c9452c", "#f2c14e"][i % 3]
          : ["#f7b6c8", "#fbd3de", "#ffffff"][i % 3]);
      X.g.save();
      X.g.translate(x, y);
      X.g.rotate(t * (1 + hash(i, seed + 5)) + i);
      blob(kind === "leaves" ? ellipse(0, 0, 12, 6, 10) : heart(0, 0, 8), c, {
        seed: seed + i,
      });
      X.g.restore();
    }
  }
}
/** Little stars bursting out from (x, y) as `u` goes 0 to 1. o: n, radius, color. */
function sparkles(x, y, u, o = {}) {
  const seed = nextSeed(o);
  if (u <= 0 || u >= 1) return;
  const n = o.n ?? 12;
  const rad = o.radius ?? 200;
  for (let i = 0; i < n; i++) {
    const a = hash(i, seed) * TAU;
    const d = rad * (0.4 + 0.6 * hash(i, seed + 1)) * easeOut(u * 1.2);
    const s =
      (8 + hash(i, seed + 2) * 16) *
      Math.sin(PI * clamp(u * 1.15 - hash(i, seed + 3) * 0.15));
    if (s <= 0) continue;
    X.g.save();
    X.g.translate(x + Math.cos(a) * d, y + Math.sin(a) * d);
    X.g.rotate(u * 2 + i);
    blob(star(0, 0, s, 4, 0.3, 0), i % 3 ? (o.color ?? "#fff6c8") : "#f8d65c", {
      seed: seed + i,
    });
    X.g.restore();
  }
}
/** Lines flying out from (x, y) as `u` goes 0 to 1: a pop, a surprise. o: n, radius, color. */
function burst(x, y, u, o = {}) {
  const seed = nextSeed(o);
  if (u <= 0 || u >= 1) return;
  const n = o.n ?? 8;
  const r1 = o.radius ?? 90;
  const r0 = r1 * 0.4;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + (o.turn ?? 0);
    const p = easeOut(u);
    const q = easeIn(u);
    crayon(
      [
        [x + Math.cos(a) * lerp(r0, r1, q), y + Math.sin(a) * lerp(r0, r1, q)],
        [
          x + Math.cos(a) * lerp(r0, r1 * 1.25, p),
          y + Math.sin(a) * lerp(r0, r1 * 1.25, p),
        ],
      ],
      o.width ?? 6,
      o.color ?? X.colors.ink,
      { shine: false, seed: seed + i },
    );
  }
}
/** Paper confetti falling over the whole frame as `u` goes 0 to 1. o: n, colors. */
function confetti(u, o = {}) {
  const seed = nextSeed(o);
  if (u <= 0) return;
  const cols = o.colors ?? [
    "#e0463f",
    "#3a80ef",
    "#f8d65c",
    "#f27caa",
    "#18a896",
    "#7a68dd",
  ];
  const n = o.n ?? 70;
  for (let i = 0; i < n; i++) {
    const x = X.W * hash(i, seed) + Math.sin(u * 8 + i) * 30;
    const y =
      -60 +
      (X.H + 160) * (u * (0.8 + 0.5 * hash(i, seed + 1))) -
      hash(i, seed + 2) * 300;
    if (y < -60 || y > X.H + 60) continue;
    X.g.save();
    X.g.translate(x, y);
    X.g.rotate(u * 9 * (hash(i, seed + 3) - 0.5) * 4);
    X.g.scale(1, Math.cos(u * 14 + i));
    blob(rect(-9, -5, 18, 10, 2), cols[i % cols.length], { seed: seed + i });
    X.g.restore();
  }
}
/** Hearts floating up from (x, y) as `u` goes 0 to 1. o: n, color, spread. */
function hearts(x, y, u, o = {}) {
  const seed = nextSeed(o);
  if (u <= 0 || u >= 1) return;
  const n = o.n ?? 6;
  for (let i = 0; i < n; i++) {
    const q = clamp(u * 1.3 - hash(i, seed) * 0.3);
    if (q <= 0 || q >= 1) continue;
    const hx =
      x +
      (hash(i, seed + 1) - 0.5) * (o.spread ?? 160) +
      Math.sin(q * 6 + i) * 16;
    const hy = y - q * (o.rise ?? 260);
    X.g.save();
    X.g.globalAlpha *= Math.sin(q * PI);
    paper(heart(hx, hy, 16 + hash(i, seed + 2) * 14), o.color ?? "#e0463f", {
      seed: seed + i,
      rim: 1.6,
      shadow: 4,
    });
    X.g.restore();
  }
}
/** Fireworks bursting over a night sky as `u` goes 0 to 1. o: n, colors. */
function fireworks(u, o = {}) {
  const seed = nextSeed(o);
  const cols = o.colors ?? [
    "#f8d65c",
    "#f27caa",
    "#8fd6ff",
    "#fff6c8",
    "#9ee6a4",
  ];
  const n = o.n ?? 5;
  for (let i = 0; i < n; i++) {
    const t0 = hash(i, seed) * 0.6;
    const q = clamp((u - t0) / 0.4);
    if (q <= 0 || q >= 1) continue;
    const cx = X.W * (0.15 + 0.7 * hash(i, seed + 1));
    const cy = X.H * (0.15 + 0.3 * hash(i, seed + 2));
    const c = cols[i % cols.length];
    const r = (110 + hash(i, seed + 3) * 90) * easeOut(q);
    X.g.save();
    X.g.globalAlpha *= 1 - q ** 2;
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * TAU + i;
      crayon(
        [
          [cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55 + q * 20],
          [cx + Math.cos(a) * r, cy + Math.sin(a) * r + q * 30],
        ],
        5,
        c,
        { shine: false, seed: seed + i * 20 + k },
      );
    }
    X.g.restore();
  }
}

// ---------------------------------------------------------------- paper to write on
/**
 * A piece of torn paper, its middle at (x, y). o: w, h, color, tape (true), rot, lined.
 */
function card(x, y, o = {}) {
  const seed = nextSeed(o);
  const w = o.w ?? 800;
  const h = o.h ?? 400;
  X.g.save();
  X.g.translate(x, y);
  X.g.rotate(o.rot ?? (hash(seed, 1) - 0.5) * 0.05);
  paper(rect(-w / 2, -h / 2, w, h, 4), o.color ?? X.colors.card, {
    seed,
    rim: 4,
    jag: 2.6,
    wob: 3.5,
    shadow: 22,
    script: o.script ? "rgba(90,70,60,0.12)" : undefined,
  });
  if (o.lined) {
    X.g.save();
    X.g.globalAlpha *= 0.5;
    for (let yy = -h / 2 + 90; yy < h / 2 - 20; yy += 80)
      crayon(
        dense(
          [
            [-w / 2 + 12, yy],
            [w / 2 - 12, yy],
          ],
          60,
        ),
        2.4,
        "#8fb6e8",
        { shine: false, jitter: 0.8, seed: seed + yy },
      );
    X.g.restore();
  }
  if (o.tape !== false) {
    for (const side of [-1, 1]) {
      X.g.save();
      X.g.translate(side * (w / 2 - 70), -h / 2 + 6);
      X.g.rotate(side * 0.45);
      paper(rect(-60, -16, 120, 32, 1), "rgba(246,236,205,0.85)", {
        seed: seed + 3 + side,
        rim: 0,
        shadow: 0,
        jag: 3,
      });
      X.g.restore();
    }
  }
  X.g.restore();
}
