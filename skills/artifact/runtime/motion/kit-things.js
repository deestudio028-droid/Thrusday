// Things, cut out of paper: each drawn 100 tall in its own units, its bottom middle at (0, 0),
// then set where it stands and scaled to the size asked.

const THINGS = {
  cake(o) {
    const c = o.color ?? "#f6b3c5";
    const cream = o.cream ?? "#fffaf0";
    const n = o.candles ?? 3;
    const two = o.tiers === 2;
    paper(ellipse(0, -4, 62, 10, 30), o.plate ?? "#e8edf5", {
      rim: 2,
      shadow: 5,
    });
    const tiers = two
      ? [
          [-48, -46, 96, 42],
          [-32, -76, 64, 30],
        ]
      : [[-48, -56, 96, 52]];
    for (const [x, y, w, h] of tiers) {
      paper(rect(x, y, w, h, 6), c, { rim: 2.4, shadow: 6 });
      // Icing dripping over the top edge
      const drip = [[x - 2, y - 2]];
      for (let i = 0; i <= 10; i++) {
        const px = x + (w * i) / 10;
        drip.push([px, y + 8 + (i % 2 ? 6 + hash(i, w) * 7 : 0)]);
      }
      drip.push([x + w + 2, y - 2]);
      paper(drip, cream, { rim: 0, shadow: 2 });
      for (let i = 0; i < 5; i++)
        blob(
          ellipse(x + 10 + ((w - 20) * i) / 4, y + h * 0.62, 3.2, 3.2, 8),
          ["#e0463f", "#3a80ef", "#f8d65c", "#18a896", "#fff"][i],
        );
    }
    const topY = two ? -76 : -56;
    const topW = two ? 64 : 96;
    const lit = o.lit === undefined ? 1 : Number(o.lit);
    for (let i = 0; i < n; i++) {
      const cx = n === 1 ? 0 : -topW * 0.36 + (topW * 0.72 * i) / (n - 1);
      paper(
        rect(cx - 3.5, topY - 24, 7, 26, 2),
        ["#3a80ef", "#f27caa", "#f8d65c", "#18a896"][i % 4],
        { rim: 1, shadow: 2 },
      );
      quiet(() => {
        if (lit > 0.01) {
          const fl = lit * (0.9 + 0.1 * Math.sin(X.T * 17 + i * 2));
          const gr = X.g.createRadialGradient(
            cx,
            topY - 34,
            1,
            cx,
            topY - 34,
            22 * fl,
          );
          gr.addColorStop(0, "rgba(255,220,120,0.55)");
          gr.addColorStop(1, "rgba(255,220,120,0)");
          if (!X.dry) {
            X.g.fillStyle = gr;
            X.g.fillRect(cx - 24, topY - 58, 48, 48);
          }
          blob(
            [
              ...arc(cx, topY - 30, 5 * fl, 5 * fl, 0, PI, 8),
              [cx + Math.sin(X.T * 9 + i) * 1.5, topY - 30 - 14 * fl],
            ],
            "#ffb43c",
          );
          blob(
            [
              ...arc(cx, topY - 29, 2.4 * fl, 2.4 * fl, 0, PI, 6),
              [cx, topY - 29 - 6 * fl],
            ],
            "#fff3c0",
          );
        } else if (o.smoke) {
          const sm = clamp(o.smoke);
          const pts = [];
          for (let m = 0; m <= 10; m++) {
            const q = m / 10;
            pts.push([
              cx + Math.sin(q * 6 + X.T * 3 + i) * 4 * q,
              topY - 26 - q * 40 * sm,
            ]);
          }
          X.g.save();
          X.g.globalAlpha *= 0.6 * (1 - sm * 0.6);
          crayon(pts, 2.5, "#d8d8e0", { shine: false });
          X.g.restore();
        }
      });
    }
  },
  gift(o) {
    const c = o.color ?? "#e05a4c";
    const rib = o.ribbon ?? "#f8d65c";
    const open = clamp(o.open ?? 0);
    if (open > 0) {
      // Light from inside
      const gl = X.g.createRadialGradient(0, -62, 4, 0, -62, 90);
      gl.addColorStop(0, `rgba(255,236,160,${0.7 * open})`);
      gl.addColorStop(1, "rgba(255,236,160,0)");
      if (!X.dry) {
        X.g.fillStyle = gl;
        X.g.fillRect(-100, -170, 200, 170);
      }
    }
    paper(rect(-40, -62, 80, 62, 3), c, { rim: 2.4, shadow: 6 });
    paper(rect(-7, -62, 14, 62, 1), rib, { rim: 0, shadow: 0 });
    X.g.save();
    X.g.translate(-44 + open * 34, -62 - open * 34);
    X.g.rotate(open * 0.45);
    paper(rect(0, -14, 88, 16, 3), shade(c, -0.08), { rim: 2.2, shadow: 5 });
    paper(rect(37, -14, 14, 16, 1), rib, { rim: 0, shadow: 0 });
    for (const side of [-1, 1])
      paper(ellipse(44 + side * 12, -22, 13, 8, 16), rib, {
        rim: 1.4,
        shadow: 3,
      });
    blob(ellipse(44, -20, 5, 5, 10), shade(rib, -0.2));
    X.g.restore();
  },
  balloons(o) {
    const cols = o.colors ?? [
      "#e0463f",
      "#3a80ef",
      "#f8d65c",
      "#f27caa",
      "#18a896",
    ];
    const n = o.n ?? 3;
    for (let i = 0; i < n; i++) {
      const a = n === 1 ? 0 : -0.5 + i / (n - 1);
      const sway = Math.sin(X.T * 1.7 + i * 1.3) * 4;
      const bx = a * 42 + sway;
      const by = -78 + Math.abs(a) * 12 - (i % 2) * 8;
      crayon(
        curve([0, 0], [bx * 0.4 + 3, by * 0.5], [bx, by + 18]),
        1.6,
        "#6b6b80",
        { shine: false },
      );
      paper(ellipse(bx, by, 16, 20, 26), cols[i % cols.length], {
        rim: 1.8,
        shadow: 5,
      });
      blob(
        [
          [bx - 3, by + 20],
          [bx + 3, by + 20],
          [bx, by + 25],
        ],
        shade(cols[i % cols.length], -0.2),
      );
      blob(ellipse(bx - 6, by - 8, 3, 5.5, 10), "rgba(255,255,255,0.6)");
    }
  },
  flowers(o) {
    const cols = o.colors ?? ["#e0463f", "#f27caa", "#f8d65c", "#fff6ea"];
    const wrap = o.wrap ?? "#f3dcb4";
    const heads = [
      [-22, -74],
      [0, -86],
      [22, -74],
      [-11, -62],
      [12, -62],
      [-30, -56],
      [30, -56],
    ];
    for (const [i, [hx, hy]] of heads.entries())
      crayon(
        [
          [0, -30],
          [hx * 0.6, hy + 10],
        ],
        3,
        "#4f9f5b",
        { shine: false, seed: 900 + i },
      );
    for (const [i, [hx, hy]] of heads.entries()) {
      const c = cols[i % cols.length];
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * TAU + i;
        paper(
          ellipse(hx + Math.cos(a) * 7, hy + Math.sin(a) * 7, 6.5, 6.5, 12),
          c,
          { rim: 0.8, shadow: 2, seed: 910 + i * 7 + k },
        );
      }
      blob(ellipse(hx, hy, 3.6, 3.6, 8), i % 2 ? "#f8d65c" : "#e5762c");
    }
    for (const side of [-1, 1])
      paper(
        ellipse(side * 26, -44, 7, 14, 12).map(([x, y]) => [x, y]),
        "#4f9f5b",
        { rim: 1, shadow: 2, seed: 930 + side },
      );
    paper(
      [
        [-36, -52],
        [36, -52],
        [8, 0],
        [-8, 0],
      ],
      wrap,
      { rim: 2, shadow: 6 },
    );
    paper(
      [
        [-10, -30],
        [10, -30],
        [8, -18],
        [-8, -18],
      ],
      o.ribbon ?? "#e05a4c",
      { rim: 1, shadow: 2 },
    );
  },
  flowerbed(o) {
    // 240 wide: flowers growing out of the ground, swaying a little
    const cols = o.colors ?? [
      "#e0463f",
      "#f27caa",
      "#f8d65c",
      "#fff6ea",
      "#b07ad8",
    ];
    const n = o.n ?? 9;
    for (let i = 0; i < n; i++) {
      const x = -108 + (216 * i) / (n - 1) + (hash(i, 7) - 0.5) * 14;
      const h = 55 + hash(i, 8) * 40;
      const sway = Math.sin(X.T * 1.6 + i) * 3;
      crayon(
        curve([x, -6], [x + sway * 0.5, -h * 0.5], [x + sway, -h]),
        3,
        "#4f9f5b",
        { shine: false, seed: 950 + i },
      );
      X.g.save();
      X.g.translate(x - 8, -h * 0.45);
      X.g.rotate(-0.6);
      paper(ellipse(0, 0, 9, 4.5, 10), "#5fa35a", {
        rim: 0.8,
        shadow: 1,
        seed: 960 + i,
      });
      X.g.restore();
      const c = cols[i % cols.length];
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * TAU + i;
        paper(
          ellipse(
            x + sway + Math.cos(a) * 7,
            -h + Math.sin(a) * 7,
            6.5,
            6.5,
            12,
          ),
          c,
          { rim: 0.8, shadow: 2, seed: 970 + i * 7 + k },
        );
      }
      blob(ellipse(x + sway, -h, 3.6, 3.6, 8), i % 2 ? "#f8d65c" : "#e5762c");
    }
    paper(
      [
        [-124, 0],
        [-110, -16],
        [-60, -24],
        [0, -26],
        [60, -24],
        [110, -16],
        [124, 0],
      ],
      o.soil ?? "#8a5a3c",
      { rim: 2, shadow: 4 },
    );
  },
  plant(o) {
    paper(
      [
        [-24, -34],
        [24, -34],
        [18, 0],
        [-18, 0],
      ],
      o.pot ?? "#cc6c45",
      { rim: 2, shadow: 5 },
    );
    paper(rect(-27, -40, 54, 10, 3), o.pot ?? "#cc6c45", {
      rim: 1.6,
      shadow: 3,
    });
    for (const [a, l] of [
      [-0.6, 34],
      [0.5, 32],
      [-0.1, 42],
    ]) {
      X.g.save();
      X.g.translate(0, -40);
      X.g.rotate(a);
      paper(ellipse(0, -l * 0.6, 10, l * 0.55, 16), o.leaf ?? "#4f9f5b", {
        rim: 1.2,
        shadow: 3,
      });
      X.g.restore();
    }
    if (o.flower !== false) {
      crayon(
        [
          [2, -60],
          [4, -86],
        ],
        3,
        "#3f7f49",
        { shine: false },
      );
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * TAU + 0.3;
        paper(
          ellipse(4 + Math.cos(a) * 7, -92 + Math.sin(a) * 7, 6, 6, 10),
          o.color ?? "#e3463f",
          { rim: 0.8, shadow: 0 },
        );
      }
      blob(ellipse(4, -92, 4, 4, 8), "#f8d65c");
    }
  },
  heart(o) {
    const b = o.beat ? 1 + 0.08 * Math.max(0, Math.sin(X.T * 7)) ** 8 : 1;
    X.g.save();
    X.g.translate(0, -50);
    X.g.scale(b, b);
    paper(heart(0, 4, 50), o.color ?? "#e0463f", { rim: 2.6, shadow: 7 });
    blob(ellipse(-24, -18, 6, 9, 10), "rgba(255,255,255,0.35)");
    X.g.restore();
  },
  letter(o) {
    const c = o.color ?? "#f4ecd9";
    const open = clamp(o.open ?? 0);
    const slide = clamp((open - 0.4) / 0.6);
    paper(rect(-50, -66, 100, 66, 3), shade(c, -0.08), { rim: 2.2, shadow: 6 });
    quiet(() => {
      if (open > 0.3) {
        paper(rect(-42, -62 - slide * 56, 84, 60, 2), "#fffdf6", {
          rim: 1.4,
          shadow: 3,
        });
        for (let k = 0; k < 3; k++)
          crayon(
            [
              [-30, -48 - slide * 56 + k * 12],
              [30 - k * 12, -48 - slide * 56 + k * 12],
            ],
            2,
            "#9aa0c4",
            { shine: false },
          );
      }
    });
    paper(
      [
        [-50, -66],
        [0, -30],
        [50, -66],
        [50, 0],
        [-50, 0],
      ],
      c,
      { rim: 2, shadow: 3 },
    );
    crayon(
      [
        [-50, 0],
        [0, -34],
        [50, 0],
      ],
      1.8,
      shade(c, -0.25),
      { shine: false },
    );
    const fy = -66 + (1 - open) * 36;
    if (open < 0.5)
      paper(
        [
          [-50, -66],
          [50, -66],
          [0, fy],
        ],
        shade(c, -0.04),
        { rim: 1.6, shadow: 4 },
      );
    else
      paper(
        [
          [-50, -66],
          [50, -66],
          [0, -66 - (open - 0.5) * 72],
        ],
        shade(c, -0.04),
        { rim: 1.6, shadow: 2 },
      );
    if (open < 0.4)
      paper(heart(0, fy + 2, 9), o.seal ?? "#e0463f", { rim: 1, shadow: 2 });
  },
  photo(o) {
    const [rw, rh] = String(o.ratio ?? "4:3")
      .split(":")
      .map(Number);
    const h = 100;
    const inner = h * 0.78;
    const w = (inner * rw) / rh + 12;
    paper(rect(-w / 2, -h, w, h, 1), o.frame ?? "#fffdf6", {
      rim: 1.4,
      shadow: 8,
    });
    const ix = -w / 2 + 6;
    const iy = -h + 6;
    const iw = w - 12;
    const ih = inner - 6;
    const img = X.images[o.image];
    if (img && !X.dry) {
      // The picture covers its window, cut to it
      const k = Math.max(iw / img.width, ih / img.height);
      X.g.save();
      X.g.beginPath();
      X.g.rect(ix, iy, iw, ih);
      X.g.clip();
      X.g.drawImage(
        img,
        ix + (iw - img.width * k) / 2,
        iy + (ih - img.height * k) / 2,
        img.width * k,
        img.height * k,
      );
      X.g.fillStyle = "rgba(255,236,200,0.12)";
      X.g.fillRect(ix, iy, iw, ih);
      X.g.restore();
    } else {
      paper(rect(ix, iy, iw, ih, 0), "#bfe0f6", { rim: 0, shadow: 0 });
      paper(
        [
          [ix, iy + ih],
          [ix, iy + ih * 0.7],
          [ix + iw * 0.35, iy + ih * 0.45],
          [ix + iw * 0.7, iy + ih * 0.72],
          [ix + iw, iy + ih * 0.55],
          [ix + iw, iy + ih],
        ],
        "#8cc084",
        { rim: 0, shadow: 0 },
      );
      blob(ellipse(ix + iw * 0.78, iy + ih * 0.28, 6, 6, 12), "#f8d65c");
    }
    if (o.caption)
      handText(o.caption, 0, -6, {
        size: 11,
        color: o.captionColor ?? "#2b3a67",
        width: w - 10,
      });
    if (o.tape !== false) {
      X.g.save();
      X.g.translate(0, -h);
      X.g.rotate(-0.06);
      paper(rect(-16, -5, 32, 10, 1), "rgba(246,236,205,0.85)", {
        rim: 0,
        shadow: 0,
        jag: 3,
      });
      X.g.restore();
    }
  },
  mug(o) {
    const c = o.color ?? "#fbf6ea";
    crayon(arc(34, -38, 14, 16, -PI * 0.5, PI * 0.5), 7, c);
    paper(rect(-34, -72, 68, 72, 10), c, { rim: 2, shadow: 6 });
    blob(rect(-34, -46, 68, 10, 2), o.band ?? "#3a80ef");
    if (o.steam !== false)
      for (let k = 0; k < 3; k++) {
        const pts = [];
        for (let m = 0; m <= 12; m++) {
          const q = m / 12;
          pts.push([
            (k - 1) * 14 + Math.sin(q * 7 - X.T * 4 + k) * 5 * q,
            -80 - q * 50,
          ]);
        }
        X.g.save();
        X.g.globalAlpha *= 0.55;
        crayon(pts, 3.5, "#ffffff", { shine: false });
        X.g.restore();
      }
  },
  ring(o) {
    const c = o.color ?? "#b8323f";
    const open = clamp(o.open ?? 1);
    paper(rect(-36, -40, 72, 40, 6), c, { rim: 2, shadow: 6 });
    X.g.save();
    X.g.translate(0, -40);
    X.g.scale(1, -Math.cos(open * PI * 0.9));
    paper(rect(-36, 0, 72, 30, 6), shade(c, 0.1), { rim: 2, shadow: 3 });
    X.g.restore();
    if (open > 0.5) {
      paper(rect(-28, -40, 56, 12, 4), "#f4e7ee", { rim: 0, shadow: 0 });
      crayon(arc(0, -52, 12, 12, 0, TAU, 24), 4, "#f2c14e", { shine: false });
      paper(star(0, -68, 8, 4, 0.5, 0), "#dff4ff", { rim: 1, shadow: 3 });
      const tw = Math.max(0, Math.sin(X.T * 5));
      paper(star(14, -76, 4 + tw * 4, 4, 0.25, 0), "#ffffff", {
        rim: 0,
        shadow: 0,
      });
    }
  },
  star(o) {
    paper(star(0, -50, 50, 5, 0.46), o.color ?? "#f8d65c", {
      rim: 2.4,
      shadow: 6,
    });
  },
  sun(o) {
    const c = o.color ?? "#f5a623";
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * TAU + X.T * 0.3;
      crayon(
        [
          [Math.cos(a) * 38, -50 + Math.sin(a) * 38],
          [Math.cos(a) * 48, -50 + Math.sin(a) * 48],
        ],
        5,
        c,
        { shine: false },
      );
    }
    paper(ellipse(0, -50, 30, 30, 30), c, { rim: 2, shadow: 5 });
  },
  moon(o) {
    X.g.save();
    X.g.translate(0, -50);
    X.g.rotate(-0.35);
    paper(
      [
        ...arc(0, 0, 48, 48, -PI * 0.62, PI * 0.62, 36),
        ...arc(-20, 0, 38, 42, PI * 0.5, -PI * 0.5, 30),
      ],
      o.color ?? "#f6e9c6",
      { rim: 1.4, shadow: 8 },
    );
    X.g.restore();
  },
  cloud(o) {
    paper(cloud(0, -40, 50, 6, 0.4), o.color ?? "#ffffff", {
      rim: 2,
      shadow: 5,
    });
  },
  tree(o) {
    const kind = o.kind ?? "round";
    paper(rect(-7, -46, 14, 46, 3), o.trunk ?? "#8a5a3c", {
      rim: 1.4,
      shadow: 3,
    });
    if (kind === "pine") {
      const c = o.color ?? "#2f7d5b";
      for (let i = 0; i < 3; i++)
        paper(
          [
            [-36 + i * 7, -34 - i * 22],
            [0, -76 - i * 20],
            [36 - i * 7, -34 - i * 22],
          ],
          c,
          { rim: 1.6, shadow: 4 },
        );
    } else {
      const c =
        o.color ??
        (kind === "blossom"
          ? "#f7b6c8"
          : kind === "autumn"
            ? "#e58a3a"
            : "#5fa35a");
      paper(cloud(0, -68, 36, 7, 1), c, { rim: 2, shadow: 5 });
      if (kind === "blossom" || kind === "autumn")
        for (let k = 0; k < 9; k++)
          blob(
            ellipse(-26 + hash(k, 3) * 52, -86 + hash(k, 4) * 36, 3.5, 3.5, 8),
            kind === "blossom" ? "#fff0f4" : "#c9452c",
          );
    }
  },
  house(o) {
    const wall = o.wall ?? "#f4ecd9";
    const roof = o.roof ?? "#c9452c";
    paper(rect(-42, -58, 84, 58, 2), wall, { rim: 2, shadow: 6 });
    paper(
      [
        [-52, -56],
        [0, -98],
        [52, -56],
      ],
      roof,
      { rim: 2, shadow: 5 },
    );
    paper(rect(-10, -30, 20, 30, 3), o.door ?? "#8a5a3c", {
      rim: 1,
      shadow: 2,
    });
    const lit = o.lit ? "#f8d65c" : "#bfe0f6";
    for (const side of [-1, 1]) blob(rect(side * 26 - 8, -44, 16, 16, 2), lit);
    paper(rect(22, -96, 10, 22, 1), shade(wall, -0.2), { rim: 1, shadow: 2 });
  },
  suitcase(o) {
    const c = o.color ?? "#e38a3f";
    crayon(
      [
        [-14, -76],
        [-14, -86],
        [14, -86],
        [14, -76],
      ],
      5,
      "#5a4034",
      { shine: false },
    );
    paper(rect(-40, -76, 80, 76, 10), c, { rim: 2.4, shadow: 6 });
    for (const side of [-1, 1])
      crayon(
        [
          [side * 20, -70],
          [side * 20, -6],
        ],
        4,
        shade(c, -0.25),
        { shine: false },
      );
    paper(ellipse(-18, -46, 10, 8, 12), "#f8d65c", { rim: 1, shadow: 2 });
    paper(rect(6, -30, 20, 12, 2), "#3a80ef", { rim: 1, shadow: 2 });
  },
  plane(o) {
    const c = o.color ?? "#fbf6ea";
    paper(
      [
        [-10, -60],
        [-24, -94],
        [-12, -94],
        [16, -60],
      ],
      shade(c, -0.1),
      { rim: 1.4, shadow: 3 },
    );
    paper(rect(-60, -66, 120, 26, 13), c, { rim: 2, shadow: 6 });
    paper(
      [
        [-58, -60],
        [-72, -86],
        [-60, -86],
        [-44, -62],
      ],
      o.tail ?? "#e05a4c",
      { rim: 1.4, shadow: 3 },
    );
    for (let k = 0; k < 5; k++)
      blob(ellipse(-26 + k * 14, -56, 3.6, 3.6, 8), "#3a80ef");
    paper(
      [
        [-6, -48],
        [26, -20],
        [36, -20],
        [18, -48],
      ],
      shade(c, -0.14),
      { rim: 1.4, shadow: 3 },
    );
  },
  car(o) {
    const c = o.color ?? "#e05a4c";
    const spin = (o.drive ?? 0) * X.T * 6;
    paper(
      [
        [-58, -20],
        [-56, -40],
        [-30, -44],
        [-18, -64],
        [26, -64],
        [40, -44],
        [58, -38],
        [58, -20],
      ],
      c,
      { rim: 2.2, shadow: 6 },
    );
    blob(
      [
        [-12, -60],
        [-24, -44],
        [0, -44],
        [0, -60],
      ],
      "#bfe0f6",
    );
    blob(
      [
        [6, -60],
        [6, -44],
        [32, -44],
        [22, -60],
      ],
      "#bfe0f6",
    );
    for (const wx of [-34, 34]) {
      paper(ellipse(wx, -16, 14, 14, 20), "#2b2d42", { rim: 1.6, shadow: 4 });
      crayon(
        [
          [wx + Math.cos(spin) * 8, -16 + Math.sin(spin) * 8],
          [wx - Math.cos(spin) * 8, -16 - Math.sin(spin) * 8],
        ],
        3,
        "#c9ccd8",
        { shine: false },
      );
    }
    blob(ellipse(54, -32, 4, 3, 8), "#f8d65c");
  },
  book(o) {
    const c = o.color ?? "#3a80ef";
    paper(
      [
        [-58, -30],
        [0, -22],
        [58, -30],
        [60, 0],
        [0, 6],
        [-60, 0],
      ],
      c,
      { rim: 2.2, shadow: 6 },
    );
    paper(
      [
        [-52, -34],
        [-2, -26],
        [-2, 2],
        [-54, -4],
      ],
      "#fffdf6",
      { rim: 1.2, shadow: 2 },
    );
    paper(
      [
        [52, -34],
        [2, -26],
        [2, 2],
        [54, -4],
      ],
      "#fffdf6",
      { rim: 1.2, shadow: 2 },
    );
    for (let k = 0; k < 3; k++) {
      crayon(
        [
          [-44, -24 + k * 8],
          [-10, -18 + k * 8],
        ],
        1.6,
        "#9aa0c4",
        { shine: false },
      );
      crayon(
        [
          [10, -18 + k * 8],
          [44, -24 + k * 8],
        ],
        1.6,
        "#9aa0c4",
        { shine: false },
      );
    }
  },
  camera(o) {
    const c = o.color ?? "#2b2d42";
    paper(rect(-44, -58, 88, 58, 8), c, { rim: 2, shadow: 6 });
    paper(rect(-20, -66, 26, 10, 3), c, { rim: 1.4, shadow: 2 });
    paper(ellipse(0, -30, 20, 20, 24), "#c9ccd8", { rim: 1.4, shadow: 3 });
    blob(ellipse(0, -30, 12, 12, 18), "#1b1d3a");
    blob(ellipse(-4, -34, 3.5, 3.5, 8), "#ffffff");
    const fl = clamp(o.flash ?? 0);
    if (fl > 0) {
      blob(rect(24, -54, 12, 8, 2), "#fff6c8");
      X.g.save();
      X.g.globalAlpha *= Math.sin(fl * PI);
      paper(star(30, -50, 40, 8, 0.3, 0), "#fffbe8", { rim: 0, shadow: 0 });
      X.g.restore();
    }
  },
  table(o) {
    // 240 wide: things on it stand on its top, 100 above its feet
    const cloth = o.cloth ?? o.color ?? "#fbf6ea";
    for (const side of [-1, 1])
      paper(rect(side * 96 - 6, -92, 12, 92, 3), o.legs ?? "#a8764e", {
        rim: 1.4,
        shadow: 4,
      });
    paper(
      [
        [-120, -100],
        [120, -100],
        [126, -62],
        [-126, -62],
      ],
      cloth,
      { rim: 2.2, shadow: 6 },
    );
    if (o.cloth)
      for (let k = 0; k < 7; k++)
        blob(ellipse(-100 + k * 33, -76, 6, 6, 10), shade(cloth, -0.2));
  },
  sofa(o) {
    // 240 wide, its seat 55 up: sit people on it with pose "sit" at its feet
    const c = o.color ?? "#6c8fb5";
    paper(rect(-110, -100, 220, 60, 22), shade(c, -0.08), {
      rim: 2.4,
      shadow: 6,
    });
    paper(rect(-114, -58, 228, 40, 12), c, { rim: 2.2, shadow: 4 });
    for (const side of [-1, 1])
      paper(rect(side * 118 - 20, -80, 40, 64, 16), shade(c, -0.12), {
        rim: 2.2,
        shadow: 5,
      });
    for (const side of [-1, 1])
      paper(rect(side * 96 - 5, -18, 10, 18, 2), "#5a4034", {
        rim: 1,
        shadow: 2,
      });
  },
  bench(o) {
    const c = o.color ?? "#a8764e";
    for (let k = 0; k < 2; k++)
      paper(rect(-110, -96 + k * 18, 220, 12, 4), c, { rim: 1.6, shadow: 3 });
    paper(rect(-114, -50, 228, 14, 4), c, { rim: 1.8, shadow: 4 });
    for (const side of [-1, 1])
      paper(rect(side * 94 - 5, -40, 10, 40, 2), "#4a4a5a", {
        rim: 1,
        shadow: 3,
      });
  },
  music(o) {
    const c = o.color ?? "#2b3a67";
    blob(ellipse(-12, -14, 13, 10, 14), c);
    blob(ellipse(24, -22, 13, 10, 14), c);
    crayon(
      [
        [-1, -16],
        [0, -84],
      ],
      5,
      c,
      { shine: false },
    );
    crayon(
      [
        [35, -24],
        [36, -92],
      ],
      5,
      c,
      { shine: false },
    );
    paper(
      [
        [0, -84],
        [36, -92],
        [36, -78],
        [0, -70],
      ],
      c,
      { rim: 0, shadow: 0 },
    );
  },
};
/**
 * A thing standing on (x, y), `size` tall: cake, gift, balloons, flowers, flowerbed, plant, heart, letter,
 * photo, mug, ring, star, sun, moon, cloud, tree, house, suitcase, plane, car, book, camera,
 * table, sofa, bench, music. o: its own options, and rot (turned), flip.
 */
function thing(name, x, y, size, o = {}) {
  nextSeed(o);
  const draw = THINGS[name];
  if (!draw)
    throw new Error(
      `No thing "${name}". The things: ${Object.keys(THINGS).join(", ")}. Draw anything else from shapes with d.paper().`,
    );
  const g = X.g;
  const s = size / 100;
  g.save();
  g.translate(x, y);
  if (o.rot) g.rotate(o.rot);
  g.scale(o.flip ? -s : s, s);
  draw(o);
  g.restore();
  return { top: [x, y - size], middle: [x, y - size / 2] };
}
