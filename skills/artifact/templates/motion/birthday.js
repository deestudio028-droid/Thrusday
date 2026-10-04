// A birthday surprise for a grandmother, in six scenes: the example to start a film from.
// Copy it, keep its shape, and make every scene the user's own.

film({
  title: "Happy birthday, Grandma",
  size: "1920x1080",
  mood: "tender",
  seed: 4,
  colors: { paper: "#fbf6ea", ink: "#2b3a67", card: "#f8f0dc" },
  cast: {
    grandma: {
      age: "elder",
      skin: "fair",
      hair: "grey",
      hairStyle: "bun",
      top: "#7d9b76",
      bottom: "#6a5478",
      skirt: true,
      glasses: true,
    },
    dad: {
      skin: "fair",
      hair: "brown",
      hairStyle: "short",
      top: "#3f6fb0",
      bottom: "#4a4a5a",
    },
    mia: {
      age: "child",
      skin: "fair",
      hair: "brown",
      hairStyle: "pigtails",
      top: "#f27caa",
      bottom: "#f8d65c",
      skirt: true,
    },
  },
  scenes: [
    // 1. A quiet street at night; one window is still lit. We move toward it.
    {
      seconds: 4,
      draw(d) {
        d.camera(960, 540 + d.at(0, 4) * 60, 1 + d.at(0, 4) * 0.12);
        d.sky({ time: "night", moon: [1540, 170] });
        d.ground("town", { y: 780 });
        d.write("It's almost midnight.", 960, 260, {
          size: 84,
          color: "#fff6e0",
          at: 0.6,
        });
      },
    },
    // 2. Two of them tiptoe in with a cake. She is asleep in her chair.
    {
      seconds: 5,
      enter: "iris",
      draw(d) {
        d.room({ wall: "#f3c350", window: "night", lamp: 1500, frames: true });
        d.thing("sofa", 1380, 960, 260, { color: "#b0624f" });
        d.person("grandma", 1380, 960, 560, { pose: "sit", face: "sleepy" });
        const x = d.move(-200, 620, 0, 3);
        const walking = d.moving(0, 3);
        d.person("dad", x, 960, 640, {
          pose: walking ? "walk" : "hold",
          face: "happy",
          holding: (hx, hy) =>
            d.thing("cake", hx, hy + 70, 200, { candles: 3, lit: 1 }),
        });
        d.person("mia", x - 230, 960, 640, {
          pose: walking ? "walk" : "stand",
          face: "smile",
          look: [1, 0],
        });
        d.bubble("shh…", x - 60, 330, {
          to: [x - 230, 520],
          at: 1.2,
          size: 64,
        });
      },
    },
    // 3. Surprise! She wakes; the room fills with confetti.
    {
      seconds: 4,
      enter: "cut",
      big: true,
      draw(d) {
        d.camera(1100, 600, 1.12);
        d.room({ wall: "#f3c350", window: "night", lamp: 1500 });
        d.thing("sofa", 1380, 960, 260, { color: "#b0624f" });
        d.person("grandma", 1380, 960, 560, {
          pose: d.t < 0.5 ? "sit" : "cheeks",
          face: d.t < 0.5 ? "surprised" : "teary",
        });
        d.person("dad", 700, 960, 640, {
          pose: "give",
          facing: 1,
          face: "laugh",
          holding: (hx, hy) =>
            d.thing("cake", hx, hy + 70, 200, { candles: 3, lit: 1 }),
        });
        d.person("mia", 430, 960, 640, {
          pose: "cheer",
          face: "laugh",
          hat: "party",
        });
        d.burst(1380, 520, 0.1, { radius: 150, color: "#e0463f" });
        d.confetti(0.1);
        d.note("Surprise!", 820, 300, { size: 96, at: 0.2, rot: -0.05 });
      },
    },
    // 4. She blows out the candles, and laughs.
    {
      seconds: 4,
      enter: "slide",
      draw(d) {
        d.camera(960, 560, 1.05 + d.at(0, 4) * 0.08);
        d.plain("#f6d8c8");
        d.person("grandma", 960, 1180, 1100, {
          face: d.t < 1.1 ? "calm" : "laugh",
        });
        d.thing("table", 960, 1230, 330, { cloth: "#fbf6ea" });
        const out = d.at(1.2, 1.5);
        d.thing("cake", 960, 905, 250, {
          candles: 3,
          lit: 1 - out,
          smoke: d.at(1.5, 3.5),
        });
        d.sound("blow", 1.0);
        d.sparkles(960, 700, 1.5, { radius: 300 });
        d.write("make a wish", 1480, 330, { size: 84, at: 0.2 });
      },
    },
    // 5. A card on the table, and what they wrote in it.
    {
      seconds: 6,
      enter: "page",
      draw(d) {
        d.desk({ color: "#c98f5a" });
        d.thing("flowers", 360, 900, 380, { rot: -0.3 });
        d.thing("mug", 1640, 380, 170);
        d.card(990, 520, { w: 1060, h: 620, lined: true, rot: -0.02 });
        d.write("Dear Grandma,", 560, 330, {
          size: 70,
          align: "left",
          at: 0.5,
        });
        d.write("Every year with you is", 560, 480, {
          size: 70,
          align: "left",
          at: 1.4,
        });
        d.write("my favourite year.", 560, 600, {
          size: 70,
          align: "left",
          at: 2.6,
        });
        d.write("— Mia", 1300, 740, { size: 64, at: 3.8, color: "#c9452c" });
        d.hearts(1380, 730, 4.2);
      },
    },
    // 6. The message, held.
    {
      seconds: 6,
      enter: "tear",
      big: true,
      draw(d) {
        d.sky({ time: "dawn", clouds: 4 });
        d.ground("hills", { y: 820 });
        d.thing("balloons", 1560, 900 - d.at(0, 6) * 60, 360, { n: 5 });
        d.person("mia", 520, 1020, 560, { pose: "heart", face: "happy" });
        d.person("grandma", 780, 1020, 600, { pose: "wave", face: "happy" });
        d.write("Happy birthday, Grandma", 1030, 300, { size: 104, at: 0.4 });
        d.write("we love you", 1030, 450, {
          size: 80,
          color: "#c9452c",
          at: 2,
        });
        d.hearts(900, 520, 2.6, { n: 8 });
      },
    },
  ],
});
