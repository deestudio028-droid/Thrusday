// Who is in a film: people cut out of paper (any skin, hair, clothes and age, in a pose and
// with a face), Thursday herself (a little blue sun made of letters), her bots, a dog, a cat.
// All stand on (x, y): x their middle, y where their feet touch the ground.

const SKINS = {
  light: "#f3cfae",
  fair: "#ecb793",
  tan: "#d69a6c",
  brown: "#a86b43",
  deep: "#6e4429",
};
const HAIRS = {
  black: "#2b2226",
  brown: "#6b4430",
  blond: "#e8bf62",
  red: "#b84a2a",
  grey: "#c7c3be",
  white: "#eeeae4",
};
const INK = "#221f3f";

/** Body measures for an age, in units of a grown-up 1000 tall. */
const BODY = {
  adult: { R: 150, neck: -590, hip: -300, sw: 120, leg: 64 },
  elder: { R: 150, neck: -575, hip: -300, sw: 122, leg: 64 },
  child: { R: 168, neck: -455, hip: -225, sw: 100, leg: 58 },
};

/**
 * Where the hands go in a pose, from each shoulder, in arm lengths (A) and head radii (R):
 * [left hand, right hand], each [x, y], and the feet. `t` moves the poses that move.
 */
function poseHands(pose, B, t, facing) {
  const A = (B.hip - B.neck) * 1.02;
  const f = facing;
  const headY = B.neck - B.R * 0.9;
  const sway = Math.sin(t * 7);
  const down = [
    [-0.16 * A, 0.94 * A],
    [0.16 * A, 0.94 * A],
  ];
  switch (pose) {
    case "wave":
      return [down[0], [0.5 * A + sway * 0.14 * A, -0.9 * A]];
    case "cheer":
      return [
        [-0.55 * A, -0.9 * A + sway * 0.05 * A],
        [0.55 * A, -0.9 * A - sway * 0.05 * A],
      ];
    case "hold":
      return [
        [0.45 * A, 0.62 * A],
        [-0.45 * A, 0.62 * A],
      ];
    case "give":
      return [
        [0.55 * A + f * 0.35 * A, 0.45 * A],
        [-0.55 * A + f * 0.35 * A, 0.45 * A],
      ];
    case "hug":
      return f > 0
        ? [
            [0.95 * A, 0.4 * A],
            [0.75 * A, 0.3 * A],
          ]
        : [
            [-0.75 * A, 0.3 * A],
            [-0.95 * A, 0.4 * A],
          ];
    case "point":
      return f > 0
        ? [down[0], [1.0 * A, -0.12 * A]]
        : [[-1.0 * A, -0.12 * A], down[1]];
    case "clap": {
      const o = 0.12 * A + 0.1 * A * Math.abs(Math.sin(t * 9));
      return [
        [0.72 * A - o, 0.5 * A],
        [-0.72 * A + o, 0.5 * A],
      ];
    }
    case "heart": {
      // Arms up over the head, hands meeting on top: a heart made of arms
      const top = headY - B.R * 1.05 - (B.neck + 40);
      return [
        [B.sw - 30, top],
        [-B.sw + 30, top],
      ];
    }
    case "cheeks":
      return [
        [B.sw - 15 - B.R * 0.72, headY + B.R * 0.35 - (B.neck + 40)],
        [-B.sw + 15 + B.R * 0.72, headY + B.R * 0.35 - (B.neck + 40)],
      ];
    case "think":
      return [
        [0.55 * A, 0.62 * A],
        [-B.sw + 15 + B.R * 0.35, headY + B.R * 0.85 - (B.neck + 40)],
      ];
    case "shrug":
      return [
        [-0.75 * A, 0.3 * A],
        [0.75 * A, 0.3 * A],
      ];
    case "walk": {
      const s = Math.sin(t * 6.5);
      return [
        [-0.16 * A + s * 0.28 * A, 0.9 * A],
        [0.16 * A + s * 0.28 * A, 0.9 * A],
      ];
    }
    case "sit":
      return [
        [0.3 * A, 0.95 * A + 90],
        [-0.3 * A, 0.95 * A + 90],
      ];
    default:
      return down;
  }
}
/** An elbow between a shoulder and a hand, bent away from the body. */
function elbowOf(S, H, A, side) {
  const dx = H[0] - S[0];
  const dy = H[1] - S[1];
  const d = Math.hypot(dx, dy) || 1;
  const half = Math.min(d / 2, A / 2);
  const h = Math.sqrt(Math.max(0, (A / 2) ** 2 - half ** 2));
  const mx = S[0] + dx / 2;
  const my = S[1] + dy / 2;
  const px = -dy / d;
  const py = dx / d;
  const a = [mx + px * h, my + py * h];
  const b = [mx - px * h, my - py * h];
  return a[0] * side > b[0] * side ? a : b;
}

const FACES = {
  smile: ["open", "smile"],
  happy: ["happy", "grin"],
  laugh: ["happy", "laugh"],
  surprised: ["wide", "o"],
  sad: ["sad", "frown"],
  cry: ["shut", "wobble", "tears"],
  teary: ["happy", "smile", "tears"],
  sleepy: ["shut", "flat"],
  calm: ["shut", "smile"],
  wink: ["wink", "grin"],
  love: ["hearts", "grin"],
  talk: ["open", "talk"],
  worried: ["worried", "wobble"],
  proud: ["shut", "grin"],
};

/** The face on a head `R` across, its middle at (0, 0). */
function faceOf(R, o, t, age) {
  const k = R / 100;
  const [eyes, mouth, extra] = FACES[o.face ?? "smile"] ?? FACES.smile;
  const look = o.look ?? [0, 0];
  // Everyone blinks now and then, each on their own time
  const every = 3.1 + hash(o.seed ?? 1, 30) * 1.6;
  const u = (t + hash(o.seed ?? 1, 31) * every) % every;
  const blink = eyes === "open" && u < 0.14 ? Math.sin((u / 0.14) * PI) : 0;
  for (const side of [-1, 1]) {
    blob(
      ellipse(side * 60 * k, 34 * k, 17 * k, 12 * k, 16),
      `rgba(242,120,130,${o.blush ?? 0.5})`,
    );
    const ex = side * 36 * k + look[0] * 6 * k;
    const ey = 6 * k + look[1] * 5 * k;
    const e =
      eyes === "wink" && side === 1 ? "happy" : eyes === "wink" ? "open" : eyes;
    if (e === "open" || e === "wide" || e === "worried") {
      const s = e === "wide" ? 1.25 : 1;
      const h = 13 * s * (1 - 0.85 * blink);
      blob(ellipse(ex, ey, 10 * s * k, h * k, 16), INK);
      if (blink < 0.5)
        blob(
          ellipse(ex + 3.5 * k, ey - 4.5 * k, 3.6 * k, 3.8 * k, 8),
          "#ffffff",
          { jitter: 0.4 },
        );
      if (e === "wide")
        crayon(
          arc(side * 36 * k, -22 * k, 14 * k, 7 * k, PI * 1.15, PI * 1.85),
          4.5 * k,
          INK,
          { shine: false },
        );
      if (e === "worried")
        crayon(
          [
            [side * 22 * k, -20 * k],
            [side * 50 * k, -12 * k],
          ],
          4.5 * k,
          INK,
          { shine: false },
        );
    } else if (e === "happy") {
      crayon(
        arc(ex, ey + 6 * k, 11 * k, 10 * k, PI * 1.1, PI * 1.9),
        5 * k,
        INK,
        { shine: false },
      );
    } else if (e === "sad") {
      blob(ellipse(ex, ey + 3 * k, 8 * k, 10 * k, 14), INK);
      crayon(
        [
          [side * 22 * k, -16 * k],
          [side * 50 * k, -24 * k],
        ],
        4.5 * k,
        INK,
        { shine: false },
      );
    } else if (e === "hearts") {
      blob(heart(ex, ey - 2 * k, 15 * k), "#e0463f");
    } else {
      crayon(
        arc(ex, ey - 2 * k, 11 * k, 8 * k, PI * 0.1, PI * 0.9),
        5 * k,
        INK,
        { shine: false },
      );
    }
    if (age === "elder" && e !== "wide") {
      crayon(
        [
          [side * 56 * k, 0],
          [side * 66 * k, -5 * k],
        ],
        2.6 * k,
        "rgba(120,70,60,0.55)",
        { shine: false },
      );
      crayon(
        [
          [side * 56 * k, 8 * k],
          [side * 66 * k, 12 * k],
        ],
        2.6 * k,
        "rgba(120,70,60,0.55)",
        { shine: false },
      );
    }
  }
  if (extra === "tears") {
    // Tears run down both cheeks, one after another
    for (const side of [-1, 1])
      for (let i = 0; i < 2; i++) {
        const q = (t * 0.9 + i * 0.5 + (side > 0 ? 0.25 : 0)) % 1;
        const tx = side * 48 * k;
        const ty = 18 * k + q * 42 * k;
        blob(
          [...arc(tx, ty, 6 * k, 7 * k, 0, PI, 8), [tx, ty - 13 * k]],
          `rgba(120,190,245,${Math.sin(q * PI) * 0.95})`,
        );
      }
  }
  const my = 44 * k;
  if (mouth === "smile")
    crayon(
      arc(0, my - 8 * k, 13 * k, 9 * k, PI * 0.15, PI * 0.85),
      4.5 * k,
      INK,
      { shine: false },
    );
  else if (mouth === "grin") {
    blob(arc(0, my - 6 * k, 17 * k, 16 * k, 0, PI, 14), "#8d2a35");
    blob(arc(0, my + 5 * k, 8 * k, 4 * k, 0, TAU, 10), "#f07c8a", {
      jitter: 0.5,
    });
  } else if (mouth === "laugh") {
    const open = 0.8 + 0.2 * Math.abs(Math.sin(t * 12));
    blob(arc(0, my - 8 * k, 22 * k, 24 * k * open, 0, PI, 16), "#8d2a35");
    blob(arc(0, my + 8 * k, 10 * k, 5 * k, 0, TAU, 10), "#f07c8a", {
      jitter: 0.5,
    });
  } else if (mouth === "flat")
    crayon(
      [
        [-9 * k, my],
        [9 * k, my + k],
      ],
      4.5 * k,
      INK,
      { shine: false },
    );
  else if (mouth === "o") blob(ellipse(0, my, 7 * k, 9 * k, 12), "#8d2a35");
  else if (mouth === "frown")
    crayon(
      arc(0, my + 6 * k, 12 * k, 8 * k, PI * 1.15, PI * 1.85),
      4.5 * k,
      INK,
      { shine: false },
    );
  else if (mouth === "wobble")
    crayon(
      Array.from({ length: 7 }, (_, i) => [
        (-15 + i * 5) * k,
        my + (i % 2 ? -2 : 2) * k,
      ]),
      4 * k,
      INK,
      { shine: false },
    );
  else if (mouth === "talk") {
    const v = 0.5 + 0.5 * Math.sin(t * 19) * Math.sin(t * 7.3);
    blob(ellipse(0, my, 10 * k, (3 + v * 9) * k, 14), "#8d2a35");
  }
}

/** Hair behind the head (and for long hair, behind the shoulders). */
function hairBack(style, R, color, seed) {
  const o = { seed: seed + 1, rim: 3 };
  if (style === "bald" || style === "none") return;
  if (style === "long")
    paper(rect(-1.22 * R, -1.28 * R, 2.44 * R, 3.25 * R, R), color, o);
  else if (style === "bob")
    paper(rect(-1.24 * R, -1.28 * R, 2.48 * R, 2.12 * R, R), color, o);
  else if (style === "curly")
    paper(cloud(0, -0.12 * R, 1.3 * R, 11, 0.3), color, o);
  else if (style === "spiky")
    paper(star(0, -0.25 * R, 1.3 * R, 9, 0.8, -PI / 2), color, o);
  else paper(ellipse(0, -0.14 * R, 1.1 * R, 1.06 * R, 40), color, o);
  if (style === "bun")
    paper(ellipse(0, -1.2 * R, 0.46 * R, 0.4 * R, 26), color, {
      seed: seed + 2,
      rim: 2.4,
    });
  if (style === "ponytail")
    paper(
      tube(
        curve([0.7 * R, -0.9 * R], [1.35 * R, -0.3 * R], [1.3 * R, 0.7 * R]),
        0.42 * R,
      ),
      color,
      { seed: seed + 3, rim: 2.4 },
    );
  if (style === "pigtails")
    for (const side of [-1, 1])
      paper(ellipse(side * 1.22 * R, 0.25 * R, 0.34 * R, 0.5 * R, 24), color, {
        seed: seed + 4 + side,
        rim: 2.4,
      });
}
/** Hair over the forehead. */
function hairFront(style, R, color, seed, age) {
  const o = { seed: seed + 9, rim: 1.6, shadow: 5 };
  if (style === "bald" || style === "none") {
    if (age === "elder")
      for (const side of [-1, 1])
        paper(
          ellipse(side * 0.98 * R, -0.12 * R, 0.2 * R, 0.34 * R, 18),
          color,
          { seed: seed + 10 + side, rim: 1.2 },
        );
    return;
  }
  const cap = arc(0, 0.02 * R, 1.07 * R, 1.07 * R, PI * 1.03, PI * 1.97, 30);
  let edge;
  if (style === "curly") {
    edge = [];
    for (let i = 0; i <= 8; i++) {
      const x = R * (1.02 - (2.04 * i) / 8);
      edge.push([x, -0.42 * R + (i % 2 ? -0.14 * R : 0)]);
    }
  } else if (style === "spiky")
    edge = [
      [1.02 * R, -0.3 * R],
      [0.6 * R, -0.5 * R],
      [0.45 * R, -0.28 * R],
      [0.1 * R, -0.55 * R],
      [-0.15 * R, -0.3 * R],
      [-0.5 * R, -0.52 * R],
      [-0.7 * R, -0.3 * R],
      [-1.02 * R, -0.28 * R],
    ];
  else if (style === "short")
    edge = [
      [1.02 * R, -0.28 * R],
      [0.62 * R, -0.52 * R],
      [0.1 * R, -0.62 * R],
      [-0.46 * R, -0.5 * R],
      [-0.8 * R, -0.3 * R],
      [-1.03 * R, -0.18 * R],
    ];
  else
    edge = curve(
      [1.02 * R, -0.18 * R],
      [0.78 * R, -0.36 * R],
      [0.5 * R, -0.34 * R],
      [0.2 * R, -0.46 * R],
      [-0.12 * R, -0.4 * R],
      [-0.42 * R, -0.48 * R],
      [-0.72 * R, -0.38 * R],
      [-1.04 * R, -0.16 * R],
    );
  paper([...cap, ...edge], color, o);
}
function hatOf(hat, R, color, seed) {
  if (!hat) return;
  const c =
    color ??
    {
      party: "#f27caa",
      cap: "#3a80ef",
      beanie: "#e05a4c",
      crown: "#f8d65c",
      grad: "#2b2d42",
    }[hat];
  if (hat === "party") {
    const top = [0.15 * R, -2.05 * R];
    paper([[-0.42 * R, -0.95 * R], top, [0.62 * R, -0.9 * R]], c, {
      seed,
      rim: 2.4,
    });
    for (let i = 0; i < 3; i++)
      blob(
        ellipse(
          lerp(-0.25 * R, 0.4 * R, i / 2) + 0.05 * R,
          lerp(-1.1 * R, -1.6 * R, (i % 2) * 0.6 + i * 0.2),
          0.08 * R,
        ),
        "#fff6c8",
      );
    paper(ellipse(top[0], top[1], 0.14 * R), "#f8d65c", {
      seed: seed + 1,
      rim: 1.4,
    });
  } else if (hat === "cap") {
    paper(arc(0, -0.45 * R, 1.08 * R, 0.8 * R, PI, TAU, 20), c, {
      seed,
      rim: 2.4,
    });
    paper(
      rect(-0.2 * R, -0.62 * R, 1.55 * R, 0.24 * R, 0.12 * R),
      shade(c, -0.2),
      { seed: seed + 1, rim: 2 },
    );
  } else if (hat === "beanie") {
    paper(arc(0, -0.5 * R, 1.08 * R, 0.85 * R, PI, TAU, 20), c, {
      seed,
      rim: 2.4,
    });
    paper(
      rect(-1.12 * R, -0.66 * R, 2.24 * R, 0.3 * R, 0.1 * R),
      shade(c, -0.15),
      { seed: seed + 1, rim: 2 },
    );
    paper(ellipse(0, -1.38 * R, 0.2 * R), "#fbf6ea", {
      seed: seed + 2,
      rim: 1.6,
    });
  } else if (hat === "crown") {
    paper(
      [
        [-0.7 * R, -0.75 * R],
        [-0.75 * R, -1.45 * R],
        [-0.38 * R, -1.1 * R],
        [0, -1.55 * R],
        [0.38 * R, -1.1 * R],
        [0.75 * R, -1.45 * R],
        [0.7 * R, -0.75 * R],
      ],
      c,
      { seed, rim: 2.4 },
    );
    blob(ellipse(0, -1.0 * R, 0.1 * R), "#e0463f");
  } else if (hat === "grad") {
    paper(rect(-0.62 * R, -1.05 * R, 1.24 * R, 0.36 * R, 0.08 * R), c, {
      seed,
      rim: 2,
    });
    paper(
      [
        [-1.25 * R, -1.1 * R],
        [0, -1.45 * R],
        [1.25 * R, -1.1 * R],
        [0, -0.82 * R],
      ],
      c,
      { seed: seed + 1, rim: 2.4 },
    );
    crayon(
      curve([0.1 * R, -1.12 * R], [0.8 * R, -1.02 * R], [0.95 * R, -0.62 * R]),
      0.05 * R,
      "#f8d65c",
      { shine: false },
    );
    blob(ellipse(0.95 * R, -0.55 * R, 0.07 * R, 0.12 * R), "#f8d65c");
  }
}

/**
 * A person standing with their feet at (x, y), `size` tall if grown up (a child is shorter,
 * the same size given). `who`: { skin, hair, hairStyle, top, bottom, skirt, shoes, age,
 * glasses, beard, hat }. o: pose, face, look, blush, walk (true: legs and arms swing), flip,
 * facing (1 right, -1 left), holding(x, y), hat. Returns where their head, mouth and hands
 * are, in the same coordinates as x and y.
 */
function person(who, x, y, size, o = {}) {
  const seed = nextSeed(o);
  return personAt(who, x, y, size, o, seed);
}
function personAt(who, x, y, size, o, seed) {
  const age = BODY[who.age] ? who.age : "adult";
  const B = BODY[age];
  const R = B.R;
  const s = size / 1000;
  const skin = SKINS[who.skin] ?? who.skin ?? SKINS.fair;
  const hair =
    HAIRS[who.hair] ?? who.hair ?? (age === "elder" ? HAIRS.grey : HAIRS.black);
  const style = who.hairStyle ?? (age === "elder" ? "short" : "short");
  const top = who.top ?? "#e05a4c";
  const bottom = who.bottom ?? "#3b4a7a";
  const shoes = who.shoes ?? "#4a3a3a";
  const pose = o.pose ?? "stand";
  const t = X.T + hash(seed, 3) * 10;
  const facing = o.facing ?? 1;
  const walking = pose === "walk" || o.walk;
  const step = walking ? Math.sin(t * 6.5) : 0;
  // A walk bobs; standing still, they breathe
  const bob = walking
    ? -Math.abs(Math.cos(t * 6.5)) * 14
    : Math.sin(t * 2.1) * 5;
  const sitting = pose === "sit";
  const hipY = sitting ? B.hip + 130 : B.hip;
  const neckY = (sitting ? B.neck + 130 : B.neck) + bob;
  const headY = neckY - R * 0.9;
  const g = X.g;
  const out = {};
  const toWorld = (px, py) => [x + px * s * (o.flip ? -1 : 1), y + py * s];
  out.head = toWorld(0, headY);
  out.top = toWorld(0, headY - R * 1.15);
  out.mouth = toWorld(0, headY + R * 0.44);
  g.save();
  g.translate(x, y);
  g.scale(s * (o.flip ? -1 : 1), s);
  // Hair that falls behind the shoulders goes first
  if (style === "long") {
    g.save();
    g.translate(0, headY);
    hairBack(style, R, hair, seed);
    g.restore();
  }
  // Legs, or a skirt with legs under it
  const feet = sitting
    ? [
        [-70, hipY + 30, -95, hipY - 10],
        [70, hipY + 30, 95, hipY - 10],
      ]
    : [
        [-50 + step * 10, -30 - Math.max(0, step) * 40],
        [50 - step * 10, -30 - Math.max(0, -step) * 40],
      ];
  const legColor = who.skirt ? skin : bottom;
  for (const [i, side] of [-1, 1].entries()) {
    const f = feet[i];
    const hip = [side * 45, hipY - 20];
    const P = sitting ? [hip, [f[2], f[3]], [f[0], -30]] : [hip, [f[0], f[1]]];
    paper(tube(P, B.leg), legColor, {
      seed: seed + 20 + i,
      rim: 2.2,
      shadow: 4,
    });
    const fx = sitting ? f[0] : f[0];
    const fy = sitting ? -30 : f[1];
    paper(ellipse(fx + side * 10, fy + 12, 50, 26, 20), shoes, {
      seed: seed + 22 + i,
      rim: 2,
      shadow: 4,
    });
  }
  // The body
  paper(
    rect(-B.sw + 5, hipY - 60, 2 * B.sw - 10, 70, 24),
    who.skirt ? top : bottom,
    { seed: seed + 30, rim: 2.4 },
  );
  paper(rect(-B.sw, neckY + 12, 2 * B.sw, hipY - neckY - 30, 58), top, {
    seed: seed + 31,
    rim: 3,
  });
  if (who.skirt) {
    const sk = typeof who.skirt === "string" ? who.skirt : bottom;
    paper(
      [
        [-B.sw + 8, hipY - 60],
        [B.sw - 8, hipY - 60],
        [B.sw + 50, hipY + 110],
        [-B.sw - 50, hipY + 110],
      ],
      sk,
      { seed: seed + 32, rim: 2.6 },
    );
  }
  crayon(
    arc(0, neckY + 18, 34, 26, PI * 0.15, PI * 0.85, 10),
    5,
    shade(top, -0.3),
    { shine: false },
  );
  paper(rect(-26, neckY - 20, 52, 50, 12), skin, {
    seed: seed + 33,
    rim: 0,
    shadow: 0,
  });
  // Arms and hands, then what they hold in front of them; arms that reach over the head go
  // behind it, bent out around it
  const shoulders = [
    [-B.sw + 18, neckY + 50],
    [B.sw - 18, neckY + 50],
  ];
  const A = (B.hip - B.neck) * 1.02;
  const hands = poseHands(pose, B, t, facing * (o.flip ? -1 : 1)).map(
    (h, i) => [shoulders[i][0] + h[0], shoulders[i][1] + h[1]],
  );
  const overHead = pose === "heart";
  const arms = () =>
    hands.forEach((h, i) => {
      const side = i ? 1 : -1;
      const el = overHead
        ? [side * R * 1.6, headY - R * 0.35]
        : elbowOf(shoulders[i], h, A, side);
      paper(tube([shoulders[i], el, h], R * 0.36), top, {
        seed: seed + 50 + i,
        rim: 2.4,
        shadow: 5,
      });
    });
  if (overHead) arms();
  // The head
  {
    g.save();
    g.translate(0, headY);
    const tilt =
      (o.tilt ?? 0) +
      (FACES[o.face]?.[1] === "laugh" ? Math.sin(t * 14) * 0.03 : 0);
    g.rotate(tilt);
    if (style !== "long") hairBack(style, R, hair, seed);
    for (const side of [-1, 1])
      paper(ellipse(side * R * 0.98, R * 0.1, R * 0.17, R * 0.23, 16), skin, {
        seed: seed + 40 + side,
        rim: 1.4,
        shadow: 3,
      });
    paper(ellipse(0, 0, R, R * 0.97, 56), skin, { seed: seed + 42, rim: 2.6 });
    if (who.beard) {
      const bc = typeof who.beard === "string" ? who.beard : hair;
      paper(
        [
          ...arc(0, 0.05 * R, 0.95 * R, 0.95 * R, PI * 0.02, PI * 0.98, 20),
          [-0.5 * R, 0.35 * R],
          [0, 0.3 * R],
          [0.5 * R, 0.35 * R],
        ],
        bc,
        { seed: seed + 43, rim: 1.2, shadow: 2 },
      );
    }
    quiet(() => faceOf(R, { ...o, seed }, t, age));
    hairFront(style, R, hair, seed, age);
    if (who.glasses) {
      const gc = typeof who.glasses === "string" ? who.glasses : INK;
      for (const side of [-1, 1])
        crayon(
          arc(side * 0.36 * R, 0.07 * R, 0.21 * R, 0.19 * R, 0, TAU, 24),
          0.035 * R,
          gc,
          { shine: false },
        );
      crayon(
        [
          [-0.15 * R, 0.04 * R],
          [0.15 * R, 0.04 * R],
        ],
        0.035 * R,
        gc,
        { shine: false },
      );
    }
    hatOf(o.hat ?? who.hat, R, o.hatColor ?? who.hatColor, seed + 60);
    g.restore();
  }
  if (!overHead) arms();
  out.hands = hands.map(([hx, hy]) => toWorld(hx, hy));
  hands.forEach(([hx, hy], i) =>
    paper(ellipse(hx, hy, R * 0.2, R * 0.18, 20), skin, {
      seed: seed + 55 + i,
      rim: 2,
      shadow: 4,
    }),
  );
  g.restore();
  if (o.holding) {
    const [a, b] = out.hands;
    o.holding((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  }
  faced(
    "person",
    out.head[0],
    out.head[1],
    R * s * 1.1,
    (R * 1.15 - headY) * s,
  );
  return out;
}

// ---------------------------------------------------------------- Thursday
// Her face and her rays are made of letters: a small stroke font for the few she is made of.
const GLY = {};
(() => {
  const d = (x, y) => [
    [x, y - 0.035],
    [x + 0.012, y + 0.035],
  ];
  const L = (...p) => p;
  const bowl = () => arc(0.42, -0.5, 0.42, 0.5, -0.12 * PI, -1.9 * PI);
  const def = {
    a: [0.84, [bowl(), L([0.84, -1], [0.84, 0])]],
    c: [0.8, [arc(0.42, -0.5, 0.42, 0.5, -0.22 * PI, -1.78 * PI)]],
    e: [
      0.86,
      [
        [
          [0.04, -0.52],
          [0.86, -0.52],
          ...arc(0.43, -0.5, 0.43, 0.5, 0, -1.74 * PI),
        ],
      ],
    ],
    h: [
      0.78,
      [
        L([0, -1.75], [0, 0]),
        curve(
          [0, -0.6],
          [0.2, -0.94],
          [0.45, -1],
          [0.72, -0.85],
          [0.78, -0.5],
          [0.78, 0],
        ),
      ],
    ],
    k: [
      0.78,
      [
        L([0, -1.75], [0, 0]),
        L([0.72, -1], [0.04, -0.42]),
        L([0.28, -0.62], [0.78, 0]),
      ],
    ],
    m: [
      1.1,
      [
        L([0, -1], [0, 0]),
        curve(
          [0, -0.62],
          [0.15, -0.95],
          [0.32, -1],
          [0.5, -0.85],
          [0.55, -0.55],
          [0.55, 0],
        ),
        curve(
          [0.55, -0.62],
          [0.7, -0.95],
          [0.87, -1],
          [1.05, -0.85],
          [1.1, -0.55],
          [1.1, 0],
        ),
      ],
    ],
    n: [
      0.78,
      [
        L([0, -1], [0, 0]),
        curve(
          [0, -0.6],
          [0.2, -0.94],
          [0.45, -1],
          [0.72, -0.85],
          [0.78, -0.5],
          [0.78, 0],
        ),
      ],
    ],
    o: [0.9, [arc(0.45, -0.5, 0.45, 0.5, -PI / 2, -PI / 2 - TAU - 0.12)]],
    q: [0.84, [bowl(), L([0.84, -1], [0.84, 0.72])]],
    s: [
      0.7,
      [
        curve(
          [0.66, -0.88],
          [0.4, -1],
          [0.12, -0.9],
          [0.12, -0.66],
          [0.4, -0.52],
          [0.66, -0.36],
          [0.66, -0.1],
          [0.38, 0],
          [0.04, -0.1],
        ),
      ],
    ],
    u: [
      0.78,
      [
        curve(
          [0, -1],
          [0, -0.4],
          [0.12, -0.08],
          [0.4, 0],
          [0.66, -0.1],
          [0.78, -0.4],
        ),
        L([0.78, -1], [0.78, 0]),
      ],
    ],
    v: [0.8, [L([0, -1], [0.4, 0], [0.8, -1])]],
    w: [1.1, [L([0, -1], [0.27, 0], [0.55, -0.72], [0.83, 0], [1.1, -1])]],
    x: [0.75, [L([0, -1], [0.75, 0]), L([0.75, -1], [0, 0])]],
    y: [
      0.85,
      [
        L([0, -1], [0.42, -0.05]),
        curve([0.85, -1], [0.55, -0.1], [0.36, 0.44], [0.2, 0.66], [0, 0.62]),
      ],
    ],
    "?": [
      0.74,
      [
        curve(
          [0.04, -1.35],
          [0.3, -1.7],
          [0.68, -1.62],
          [0.72, -1.28],
          [0.42, -1],
          [0.38, -0.5],
        ),
        d(0.38, -0.08),
      ],
    ],
    ".": [0.2, [d(0.08, -0.06)]],
    ",": [0.2, [L([0.14, -0.12], [0.02, 0.24])]],
    "-": [0.62, [L([0, -0.5], [0.62, -0.5])]],
    ":": [0.2, [d(0.1, -0.9), d(0.1, -0.08)]],
    ";": [0.2, [d(0.12, -0.9), L([0.14, -0.12], [0.02, 0.24])]],
    "=": [0.7, [L([0, -0.72], [0.7, -0.72]), L([0, -0.32], [0.7, -0.32])]],
    "+": [0.7, [L([0.35, -0.88], [0.35, -0.12]), L([0, -0.5], [0.7, -0.5])]],
    "*": [
      0.7,
      [
        L([0.35, -0.95], [0.35, -0.15]),
        L([0.02, -0.75], [0.68, -0.35]),
        L([0.02, -0.35], [0.68, -0.75]),
      ],
    ],
  };
  for (const [ch, [w, strokes]] of Object.entries(def))
    GLY[ch] = { w, s: strokes.map((st) => dense(st, 0.07)) };
})();
function glyphPath(path, ch, x, y, s, rot = 0) {
  const gl = GLY[ch];
  if (!gl) return;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  for (const st of gl.s)
    st.forEach(([u, v], k) => {
      const px = (u - gl.w / 2) * s;
      const py = (v + 0.5) * s;
      const Xx = x + px * cr - py * sr;
      const Yy = y + px * sr + py * cr;
      k ? path.lineTo(Xx, Yy) : path.moveTo(Xx, Yy);
    });
}
const RAMP = [
  [".", ","],
  [",", ":"],
  [";", "-"],
  ["=", "+"],
  ["*", "?"],
  ["c", "v"],
  ["o", "x"],
  ["s", "y"],
  ["e", "a"],
  ["k", "w"],
  ["q", "h"],
  ["n", "m"],
];
const RAYSET = [
  ["o", "x", "s", "a", "e", "w", "m", "n"],
  ["c", "v", "x", "o", "u"],
  ["*", "+", "="],
  [".", ",", ":"],
];
const HER_CELLS = (() => {
  const side = 11;
  const cells = [];
  for (let r = 0; r < side; r++)
    for (let q = 0; q < side; q++) {
      const x = (q + 0.5) / side - 0.5;
      const y = (r + 0.5) / side - 0.5;
      const d = Math.hypot(x, y) * 2;
      const seed = r * 131 + q;
      if (d + (hash(seed, 1) - 0.5) * 0.2 > 0.9) continue;
      cells.push({ x, y, d, seed });
    }
  return cells;
})();
/**
 * Thursday, her middle at (x, y), `r` her radius. o: face ('open', 'happy', 'wink',
 * 'closed'), rays (0..1), glow, look, clap (0..1, with hands: true), color.
 */
function her(x, y, r, o = {}) {
  nextSeed(o);
  faced("her", x, y, r * 1.1, r * 2);
  if (X.dry) return { head: [x, y], top: [x, y - r * 1.3] };
  const g = X.g;
  const t = X.T;
  const R = r;
  const blue = o.color ?? "#3a80ef";
  const rays = o.rays ?? 1;
  const face = o.face ?? "open";
  const look = o.look ?? [0, 0];
  g.save();
  g.translate(x, y);
  g.rotate(o.tilt ?? Math.sin(t * 1.6) * 0.05);
  if ((o.glow ?? 1) > 0) {
    const gr = g.createRadialGradient(0, 0, R * 0.6, 0, 0, R * 2.6);
    gr.addColorStop(0, `rgba(255,236,170,${0.34 * (o.glow ?? 1)})`);
    gr.addColorStop(1, "rgba(255,236,170,0)");
    g.fillStyle = gr;
    g.fillRect(-R * 2.7, -R * 2.7, R * 5.4, R * 5.4);
  }
  if (rays > 0.01) {
    const path = new Path2D();
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * TAU + t * 0.12;
      for (let m = 0; m < (k % 2 ? 3 : 4); m++) {
        const rad =
          R *
          (1.24 + m * 0.21 + 0.03 * Math.sin(t * 3 + k)) *
          lerp(0.6, 1, rays);
        const turn = Math.floor(t / 0.6 + hash(k * 7 + m, 3) * 3);
        const band = RAYSET[m];
        const ch = band[Math.floor(hash(k * 7 + m, turn) * band.length)];
        glyphPath(
          path,
          ch,
          Math.cos(a) * rad,
          Math.sin(a) * rad,
          R * [0.15, 0.13, 0.11, 0.09][m] * Math.min(rays, 1.15),
          a + PI / 2,
        );
      }
    }
    g.save();
    g.globalAlpha *= clamp(rays * 1.5);
    g.strokeStyle = o.rayColor ?? "#e5762c";
    g.lineWidth = R * 0.035;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.stroke(path);
    g.restore();
  }
  const clap = o.clap ?? 0;
  const drawHands = () => {
    for (const side of [-1, 1]) {
      g.save();
      g.translate(
        side * lerp(R * 1.02, R * 0.16, clap),
        lerp(R * 0.42, R * 0.62, clap),
      );
      g.rotate(side * lerp(0.5, 1.3, clap));
      paper(ellipse(0, 0, R * 0.2, R * 0.15), blue, {
        seed: 70 + side,
        rim: 2,
        shadow: 4,
      });
      g.restore();
    }
  };
  if (o.hands && clap < 0.5) drawHands();
  paper(ellipse(0, 0, R, R, 72), blue, {
    seed: 61,
    rim: 3.4,
    wob: 2.4,
    shadow: 10,
  });
  const path = new Path2D();
  const pitch = ((R * 2) / 11) * 0.95;
  for (const c of HER_CELLS) {
    const turn = Math.floor(t / 0.6 + hash(c.seed, 3) * 4);
    const wave = 0.5 + 0.5 * Math.sin(c.x * 7 + c.y * 5 + turn * 0.9);
    const lv = clamp((1 - c.d ** 1.3) * (0.55 + 0.45 * wave), 0, 0.999);
    const band = RAMP[1 + (Math.floor(lv * 11) % 11)];
    glyphPath(
      path,
      band[Math.floor(hash(c.seed, turn) * band.length)],
      c.x * R * 1.9,
      c.y * R * 1.9 - pitch * 0.2,
      pitch * 0.46,
      (hash(c.seed, 5) - 0.5) * 0.3,
    );
  }
  g.save();
  g.globalAlpha *= 0.5;
  g.strokeStyle = "#eef5ff";
  g.lineWidth = R * 0.03;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.stroke(path);
  g.restore();
  const every = 2.9;
  const bu = (t + 1.3) % every;
  const blink = face === "open" && bu < 0.14 ? Math.sin((bu / 0.14) * PI) : 0;
  for (const side of [-1, 1]) {
    g.save();
    g.translate(
      side * R * 0.3 + look[0] * R * 0.08,
      -R * 0.02 + look[1] * R * 0.05,
    );
    blob(
      ellipse(0, R * 0.22, R * 0.11, R * 0.07, 20),
      "rgba(246,128,150,0.75)",
    );
    const f =
      face === "wink" && side === 1 ? "happy" : face === "wink" ? "open" : face;
    if (f === "open" && blink < 0.6) {
      blob(ellipse(0, 0, R * 0.075, R * 0.1 * (1 - blink), 20), INK);
      blob(ellipse(R * 0.025, -R * 0.035, R * 0.028, R * 0.03, 10), "#ffffff", {
        jitter: 0.5,
      });
    } else if (f === "happy") {
      crayon(
        arc(0, R * 0.03, R * 0.075, R * 0.07, PI * 1.05, PI * 1.95),
        R * 0.04,
        INK,
        { shine: false },
      );
    } else {
      crayon(
        arc(0, -R * 0.03, R * 0.075, R * 0.06, PI * 0.1, PI * 0.9),
        R * 0.04,
        INK,
        { shine: false },
      );
    }
    g.restore();
  }
  const mo = o.mouth ?? 0.3;
  g.save();
  g.translate(look[0] * R * 0.06, R * 0.2 + look[1] * R * 0.04);
  g.beginPath();
  g.moveTo(-R * 0.13, 0);
  g.quadraticCurveTo(0, R * (0.12 + mo * 0.3), R * 0.13, 0);
  if (mo > 0.35) {
    g.closePath();
    g.fillStyle = INK;
    g.fill();
  } else {
    g.lineWidth = R * 0.04;
    g.lineCap = "round";
    g.strokeStyle = INK;
    g.stroke();
  }
  g.restore();
  if (o.hands && clap >= 0.5) drawHands();
  g.restore();
  return { head: [x, y], top: [x, y - R * 1.3] };
}

// ---------------------------------------------------------------- her bots
const BOTS = {
  teal: "#18a896",
  pink: "#f27caa",
  purple: "#7a68dd",
  orange: "#e5762c",
  yellow: "#f2c14e",
  blue: "#3a80ef",
};
const BOT_SHAPES = new Map();
/**
 * A bot, a soft square blob with two tall eyes, standing on (x, y), `size` tall. `color` a
 * name (teal, pink, purple, orange, yellow, blue) or a colour. o: eyes ('happy'), look,
 * squash (-1..1), arms ([[x, y], [x, y]] from its middle), glasses.
 */
function bot(color, x, y, size, o = {}) {
  const seed = nextSeed(o);
  const col = BOTS[color] ?? color ?? BOTS.teal;
  const r = size / 2;
  const key = `${Math.round(hash(rgbOf(col)[0], rgbOf(col)[2]) * 1000)}_${Math.round(r)}`;
  if (!BOT_SHAPES.has(key)) {
    const bs = Number(key.split("_")[0]);
    const hs = [2, 3, 4].map((k) => ({
      k,
      a: (hash(bs, k) - 0.5) * (0.2 / k),
      p: hash(bs, k + 9) * TAU,
    }));
    const pts = [];
    for (let i = 0; i < 80; i++) {
      const a = (i / 80) * TAU;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const sq = (Math.abs(c) ** 4 + Math.abs(s) ** 4) ** -0.25;
      const q =
        (0.92 + 0.12 * (sq - 1)) *
        (1 + hs.reduce((v, h) => v + h.a * Math.sin(h.k * a + h.p), 0));
      pts.push([c * q * r, s * q * r * 0.94]);
    }
    BOT_SHAPES.set(key, pts);
  }
  const out = { head: [x, y - r], top: [x, y - 2 * r] };
  faced("bot", x, y - r, r, size);
  if (X.dry) return out;
  const g = X.g;
  const t = X.T;
  g.save();
  g.translate(x, y - r * 1.05);
  const sq = o.squash ?? 0;
  g.translate(0, r * 0.95);
  g.scale(1 + sq * 0.22, 1 - sq * 0.22);
  g.translate(0, -r * 0.95);
  g.rotate(o.tilt ?? 0);
  for (const side of [-1, 1])
    paper(ellipse(side * r * 0.38, r * 0.9, r * 0.2, r * 0.13, 18), col, {
      seed: seed + side,
      rim: 1.6,
      shadow: 3,
    });
  paper(BOT_SHAPES.get(key), col, { seed, rim: 3, shadow: 8 });
  const every = 2.3 + hash(seed, 30) * 1.4;
  const u = (t + hash(seed, 31) * every) % every;
  const shut =
    o.eyes === "happy" ? 1 : u < 0.16 ? Math.sin((u / 0.16) * PI) : 0;
  const look = o.look ?? [0, 0];
  for (const side of [-1, 1]) {
    const ex = side * r * 0.3 + look[0] * r * 0.1;
    const ey = -r * 0.1 + look[1] * r * 0.08;
    if (o.eyes === "happy")
      crayon(
        arc(ex, ey + r * 0.08, r * 0.12, r * 0.12, PI * 1.1, PI * 1.9),
        r * 0.09,
        "#ffffff",
        { shine: false },
      );
    else {
      const ew = r * 0.2;
      const eh = r * 0.38 * (1 - 0.88 * shut);
      blob(rect(ex - ew / 2, ey - eh / 2, ew, eh, ew / 2), "#ffffff", {
        jitter: 0.8,
      });
    }
    if (o.glasses)
      crayon(arc(ex, ey, r * 0.24, r * 0.24, 0, TAU, 24), r * 0.05, INK, {
        shine: false,
      });
  }
  if (o.arms)
    o.arms.forEach((tip, i) => {
      if (!tip) return;
      const side = i ? 1 : -1;
      const sh = [side * r * 0.78, r * 0.2];
      const mid = [
        lerp(sh[0], tip[0], 0.5) + side * r * 0.12,
        lerp(sh[1], tip[1], 0.5) + r * 0.1,
      ];
      paper(tube([sh, mid, tip], r * 0.2), col, {
        seed: seed + 40 + i,
        rim: 1.8,
        shadow: 3,
      });
    });
  g.restore();
  return out;
}

// ---------------------------------------------------------------- animals
/** A dog sitting, facing us, its paws at (x, y), `size` tall. o: color, ear, wag, face. */
function dog(x, y, size, o = {}) {
  const seed = nextSeed(o);
  faced("dog", x, y - size * 0.68, size * 0.3, size);
  if (X.dry) return { head: [x, y - size * 0.7], top: [x, y - size] };
  const g = X.g;
  const t = X.T + hash(seed, 2) * 5;
  const c = o.color ?? "#d9a066";
  const ear = o.ear ?? shade(c, -0.35);
  const s = size / 100;
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  const wag = Math.sin(t * (o.wag === false ? 0 : 12)) * 0.5;
  crayon(curve([22, -18], [42, -30 + wag * 8], [50 + wag * 10, -48]), 9, c, {
    seed: seed + 1,
  });
  paper(ellipse(0, -28, 30, 30, 26), c, { seed: seed + 2, rim: 2 });
  paper(ellipse(0, -8, 24, 10, 16), shade(c, 0.35), {
    seed: seed + 3,
    rim: 1.4,
    shadow: 2,
  });
  g.translate(0, -68);
  for (const side of [-1, 1]) {
    g.save();
    g.translate(side * 25, -8);
    g.rotate(side * (0.25 + Math.sin(t * 3) * 0.05));
    paper(ellipse(0, 12, 11, 22, 18), ear, { seed: seed + 4 + side, rim: 1.4 });
    g.restore();
  }
  paper(ellipse(0, 0, 28, 25, 30), c, { seed: seed + 6, rim: 2.2 });
  paper(ellipse(0, 10, 15, 11, 18), shade(c, 0.45), {
    seed: seed + 7,
    rim: 0,
    shadow: 0,
  });
  blob(ellipse(0, 5, 5.5, 4.2, 12), INK);
  const happy = o.face === "happy";
  for (const side of [-1, 1]) {
    if (happy)
      crayon(arc(side * 11, -4, 5, 4, PI * 1.1, PI * 1.9), 2.4, INK, {
        shine: false,
      });
    else blob(ellipse(side * 11, -5, 3.6, 4.4, 10), INK);
  }
  if (o.tongue !== false) blob(ellipse(0, 18, 4, 6, 10), "#f07c8a");
  g.restore();
  return { head: [x, y - size * 0.68], top: [x, y - size * 0.95] };
}
/** A cat sitting, facing us, on (x, y), `size` tall. o: color, face. */
function cat(x, y, size, o = {}) {
  const seed = nextSeed(o);
  faced("cat", x, y - size * 0.62, size * 0.26, size);
  if (X.dry) return { head: [x, y - size * 0.7], top: [x, y - size] };
  const g = X.g;
  const t = X.T + hash(seed, 2) * 5;
  const c = o.color ?? "#6d6a75";
  const s = size / 100;
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  const sw = Math.sin(t * 2.2) * 0.4;
  crayon(
    curve(
      [16, -8],
      [40, -12 + sw * 10],
      [48, -36 + sw * 20],
      [40, -54 + sw * 24],
    ),
    8,
    c,
    { seed: seed + 1 },
  );
  paper(ellipse(0, -24, 26, 25, 24), c, { seed: seed + 2, rim: 2 });
  g.translate(0, -62);
  paper(
    [
      [-24, -8],
      [-20, -34],
      [-6, -16],
    ],
    c,
    { seed: seed + 3, rim: 1.4 },
  );
  paper(
    [
      [24, -8],
      [20, -34],
      [6, -16],
    ],
    c,
    { seed: seed + 4, rim: 1.4 },
  );
  paper(ellipse(0, 0, 24, 21, 26), c, { seed: seed + 5, rim: 2 });
  const happy = o.face === "happy";
  for (const side of [-1, 1]) {
    if (happy)
      crayon(arc(side * 9, -2, 4.5, 4, PI * 1.1, PI * 1.9), 2.2, INK, {
        shine: false,
      });
    else blob(ellipse(side * 9, -3, 3.5, 4.6, 10), "#f8d65c");
    crayon(
      [
        [side * 12, 7],
        [side * 30, 4],
      ],
      1.6,
      "rgba(255,255,255,0.7)",
      { shine: false },
    );
  }
  blob(
    [
      [-3, 4],
      [3, 4],
      [0, 8],
    ],
    "#f07c8a",
  );
  g.restore();
  return { head: [x, y - size * 0.62], top: [x, y - size * 0.95] };
}
