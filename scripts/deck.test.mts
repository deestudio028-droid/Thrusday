import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import type { ZodType } from "zod";

// The workspace is found from the data folder as the modules load: keep it off anyone's own
const home = await mkdtemp(join(tmpdir(), "thursday-deck-"));
process.env.THURSDAY_HOME = home;
after(() => rm(home, { recursive: true, force: true }));

const { createDeckTools } = await import("../features/ai/tools/deck.tool.ts");
const { TOOL_NAMES } = await import("../features/ai/tools/tool-name.ts");
const { openWorkspace, WORKSPACE } = await import(
  "../features/workspace/workspace.ts"
);

/** What the shots step answers in place of a browser, which a test has none of. */
let shots = { exitCode: 0, stdout: '{"pictures":[],"cut":[]}', stderr: "" };
const sandbox = { ...(await openWorkspace()), exec: async () => shots };
const tool = createDeckTools(sandbox, "Tester", {}, false)[
  TOOL_NAMES.make_deck
];
const schema = tool.inputSchema as ZodType;
const make = async (input: unknown) =>
  (tool.execute as (input: unknown, options: unknown) => Promise<unknown>)(
    schema.parse(input),
    { toolCallId: "t", messages: [] },
  );

const slides = [
  { layout: "cover", title: "Heat pumps took the market" },
  {
    layout: "cards",
    title: "Three forces",
    cards: [{ title: "Subsidies" }, { title: "Gas prices" }],
  },
];
const file = (name: string) =>
  join(WORKSPACE, "artifacts", "Tester", name, `${name}.html`);
/** The deck a file holds, as the page reads it. */
const held = async (path: string) =>
  JSON.parse(
    /<script type="application\/json" data-deck(?:="")?>([\s\S]*?)<\/script>/.exec(
      await readFile(path, "utf8"),
    )?.[1] ?? "null",
  );
const revisionIn = (said: unknown) =>
  /revision ([0-9a-f]{12})/.exec(String(said))?.[1] ?? "";

test("a deck is refused by its schema before anything is written", () => {
  const five = Array.from({ length: 5 }, (_, i) => ({ title: `Card ${i}` }));
  for (const bad of [
    { layout: "cards", title: "Too many", cards: five },
    { layout: "poster", title: "No such layout" },
    { layout: "number", value: "a figure far too long" },
  ])
    assert.equal(
      schema.safeParse({ deck: "d", title: "D", slides: [bad] }).success,
      false,
      JSON.stringify(bad),
    );
});

test("dates along a line, two sides compared and figures side by side are slides, within their bounds", () => {
  const ok = [
    {
      layout: "timeline",
      title: "What changes when",
      steps: [
        { when: "October", title: "A host on day one" },
        {
          when: "November",
          title: "The first week's plan",
          text: "Day by day",
        },
      ],
    },
    {
      layout: "compare",
      title: "The first week, now and after",
      sides: [
        { label: "Now", points: ["Nobody to ask"] },
        { label: "After", points: ["A map of who knows what"] },
      ],
    },
    {
      layout: "stats",
      title: "One day, six people",
      stats: [
        { value: "6 hours", label: "Friday" },
        { value: "6", label: "people" },
      ],
    },
  ];
  assert.equal(
    schema.safeParse({ deck: "d", title: "D", slides: ok }).success,
    true,
  );
  for (const bad of [
    {
      layout: "timeline",
      title: "One date",
      steps: [{ when: "May", title: "x" }],
    },
    {
      layout: "compare",
      title: "Three sides",
      sides: [1, 2, 3].map((n) => ({ label: `S${n}`, points: ["p"] })),
    },
    {
      layout: "stats",
      title: "One figure",
      stats: [{ value: "1", label: "x" }],
    },
  ])
    assert.equal(
      schema.safeParse({ deck: "d", title: "D", slides: [bad] }).success,
      false,
      JSON.stringify(bad),
    );
});

test("a new deck is its frame and its slides as data, with a revision to change it by", async () => {
  const said = await make({ deck: "Q3 review", title: "Q3", slides });
  const path = file("Q3-review");
  assert.ok(existsSync(path));
  assert.equal(
    String(said).split("\n")[0],
    "artifacts/Tester/Q3-review/Q3-review.html",
  );
  assert.match(
    String(said),
    /2 slides, revision [0-9a-f]{12}\. Every slide fits/,
  );
  const html = await readFile(path, "utf8");
  assert.match(html, /<title>Q3<\/title>/);
  assert.match(html, /<meta name="generator" content="Thursday">/);
  assert.deepEqual((await held(path)).slides.length, 2);
});

test("a change lands only with the revision it was made on", async () => {
  const first = await make({
    deck: "plan",
    title: "Plan",
    theme: "sea",
    slides,
  });
  const revision = revisionIn(first);

  // Without the revision, the deck comes back as it stands and nothing is written
  const blind = (await make({ deck: "plan", title: "Other", slides })) as {
    revision: string;
    current: { title: string };
    note: string;
  };
  assert.equal(blind.revision, revision);
  assert.equal(blind.current.title, "Plan");
  assert.match(blind.note, /already a deck/);
  assert.equal((await held(file("plan"))).title, "Plan");

  // With it, the change is written, and a palette left unsaid is the deck's own
  const second = await make({
    deck: "plan",
    title: "Plan, again",
    revision,
    slides,
  });
  assert.notEqual(revisionIn(second), revision);
  const now = await held(file("plan"));
  assert.equal(now.title, "Plan, again");
  assert.equal(now.theme, "sea");

  // The first revision is stale now
  const stale = (await make({
    deck: "plan",
    title: "Late",
    revision,
    slides,
  })) as {
    note: string;
  };
  assert.match(stale.note, /changed since that revision/);
});

test("a deck the app kept after an edit is still read as a deck", async () => {
  await make({ deck: "kept", title: "Kept", slides });
  const path = file("kept");
  // A browser writes the page back with its own spelling of the data's tag
  const html = await readFile(path, "utf8");
  for (const tag of ['data-deck="">', "data-deck>"]) {
    await writeFile(path, html.replace(/data-deck(="")?>/, tag));
    const said = (await make({ deck: "kept", title: "Again", slides })) as {
      current: { title: string };
    };
    assert.equal(said.current.title, "Kept", tag);
  }
});

test("a page that holds no deck is never written over", async () => {
  const page = file("notes");
  await mkdir(join(page, ".."), { recursive: true });
  await writeFile(
    page,
    '<!doctype html><meta name="revision" content="aaaaaaaaaaaa"><p>A page</p>',
  );
  const said = await make({
    deck: "notes",
    title: "N",
    revision: "aaaaaaaaaaaa",
    slides,
  });
  assert.match(String(said), /not a deck made of slides/);
  assert.match(await readFile(page, "utf8"), /<p>A page<\/p>/);
});

test("pictures are copied beside the deck, and never under a name a slide's picture takes", async () => {
  const pics = join(WORKSPACE, "scratch", "pics");
  await mkdir(pics, { recursive: true });
  await writeFile(join(pics, "photo.png"), "png");
  await writeFile(join(pics, "slide-01.png"), "png");
  const said = await make({
    deck: "pictures",
    title: "Pictures",
    slides: [
      {
        layout: "image",
        title: "A",
        image: "scratch/pics/photo.png",
        alt: "a",
      },
      {
        layout: "image",
        title: "B",
        image: "scratch/pics/slide-01.png",
        alt: "b",
      },
    ],
  });
  const dir = join(WORKSPACE, "artifacts", "Tester", "pictures");
  assert.ok(existsSync(join(dir, "photo.png")));
  assert.ok(existsSync(join(dir, "picture-slide-01.png")));
  const deck = await held(join(dir, "pictures.html"));
  assert.deepEqual(
    deck.slides.map((slide: { image: string }) => slide.image),
    ["photo.png", "picture-slide-01.png"],
  );

  // Handed back, the deck names them beside it, and the names still reach them
  const again = await make({
    deck: "pictures",
    title: "Pictures",
    revision: revisionIn(said),
    slides: deck.slides,
  });
  assert.match(String(again), /Every slide fits/);

  const missing = await make({
    deck: "missing",
    title: "M",
    slides: [{ layout: "image", title: "A", image: "nowhere.png", alt: "a" }],
  });
  assert.match(String(missing), /no file at nowhere\.png/);
});

test("a new picture named as one beside the deck takes a name of its own, and the one a slide shows is kept", async () => {
  const first = join(WORKSPACE, "scratch", "first");
  const later = join(WORKSPACE, "scratch", "later");
  await mkdir(first, { recursive: true });
  await mkdir(later, { recursive: true });
  await writeFile(join(first, "web-01.jpg"), "the first photo");
  await writeFile(join(later, "web-01.jpg"), "a newer photo");
  const said = await make({
    deck: "renamed",
    title: "Renamed",
    slides: [
      {
        layout: "image",
        title: "A",
        image: "scratch/first/web-01.jpg",
        alt: "a",
      },
    ],
  });
  const dir = join(WORKSPACE, "artifacts", "Tester", "renamed");
  // Revised: a new slide points at a newer photo of the same name, placed first, while the
  // old slide still names the one beside the deck
  const again = await make({
    deck: "renamed",
    title: "Renamed",
    revision: revisionIn(said),
    slides: [
      {
        layout: "image",
        title: "New",
        image: "scratch/later/web-01.jpg",
        alt: "n",
      },
      { layout: "image", title: "A", image: "web-01.jpg", alt: "a" },
    ],
  });
  assert.equal(
    await readFile(join(dir, "web-01.jpg"), "utf8"),
    "the first photo",
  );
  assert.equal(
    await readFile(join(dir, "web-01-2.jpg"), "utf8"),
    "a newer photo",
  );
  const deck = await held(join(dir, "renamed.html"));
  assert.deepEqual(
    deck.slides.map((slide: { image: string }) => slide.image),
    ["web-01-2.jpg", "web-01.jpg"],
  );
  // The same photo handed again is the one already there: no second copy
  await make({
    deck: "renamed",
    title: "Renamed",
    revision: revisionIn(again),
    slides: [
      {
        layout: "image",
        title: "A",
        image: "scratch/first/web-01.jpg",
        alt: "a",
      },
    ],
  });
  const last = await held(join(dir, "renamed.html"));
  assert.deepEqual(
    last.slides.map((slide: { image: string }) => slide.image),
    ["web-01.jpg"],
  );
  assert.ok(!existsSync(join(dir, "web-01-3.jpg")));
});

test("a table's short rows are filled out and a long one is refused", async () => {
  const table = (rows: string[][]) => ({
    deck: "table",
    title: "T",
    slides: [{ layout: "table", title: "T", columns: ["", "A", "B"], rows }],
  });
  const long = await make(table([["x", "1", "2", "3"]]));
  assert.match(String(long), /row 1 has 4 cells, and there are 3 columns/);
  await make(table([["x", "1"]]));
  assert.deepEqual((await held(file("table"))).slides[0].rows, [
    ["x", "1", ""],
  ]);
});

test("what a slide says stays data inside the page", async () => {
  await make({
    deck: "escape",
    title: "</script><script>alert(1)</script>",
    slides: [{ layout: "statement", title: "<!-- a comment --></script>" }],
  });
  const html = await readFile(file("escape"), "utf8");
  assert.doesNotMatch(html, /<script>alert/);
  const deck = await held(file("escape"));
  assert.equal(deck.slides[0].title, "<!-- a comment --></script>");
});

test("slides that do not fit are named back, and a deck without its pictures says so", async () => {
  shots = { exitCode: 0, stdout: '{"pictures":[],"cut":[2,5]}', stderr: "" };
  const cut = await make({ deck: "cut", title: "C", slides });
  assert.match(String(cut), /Slides 2 and 5 do not fit/);

  shots = { exitCode: 1, stdout: "", stderr: "no browser here" };
  const blind = await make({ deck: "blind", title: "B", slides });
  assert.match(String(blind), /could not be made \(no browser here\)/);
  shots = { exitCode: 0, stdout: '{"pictures":[],"cut":[]}', stderr: "" };
});

test("a path in the bot's own folder where no deck is yet makes a new one there", async () => {
  const said = await make({
    deck: "artifacts/Tester/q4 plan",
    title: "Q4",
    slides,
  });
  assert.equal(
    String(said).split("\n")[0],
    "artifacts/Tester/q4-plan/q4-plan.html",
  );
  assert.ok(existsSync(file("q4-plan")));
  const nested = await make({
    deck: "artifacts/Tester/decks/intro.html",
    title: "I",
    slides,
  });
  assert.equal(
    String(nested).split("\n")[0],
    "artifacts/Tester/decks/intro/intro.html",
  );
  const theirs = await make({
    deck: "artifacts/Other/theirs",
    title: "T",
    slides,
  });
  assert.match(
    String(theirs),
    /There is no deck at artifacts\/Other\/theirs\. A new deck is made in your own folder/,
  );
  assert.ok(!existsSync(join(WORKSPACE, "artifacts", "Other")));
});

test("every slide on one picture comes back, and reaches a model that sees pictures", async () => {
  const sheet = join(WORKSPACE, "artifacts", "Tester", "sheet", "slides.png");
  shots = {
    exitCode: 0,
    stdout: JSON.stringify({
      pictures: [join(dirname(sheet), "slide-01.png")],
      sheet,
      cut: [],
    }),
    stderr: "",
  };
  const said = String(await make({ deck: "sheet", title: "S", slides }));
  const [, picture, line] = said.split("\n");
  assert.equal(picture, "artifacts/Tester/sheet/slides.png");
  assert.match(line, /slides\.png holds every slide, numbered/);

  // One pixel stands in for the picture the renderer draws
  await writeFile(
    sheet,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  const answer = { toolCallId: "t", input: undefined as never, output: said };
  const seeing = createDeckTools(sandbox, "Tester", {}, true)[
    TOOL_NAMES.make_deck
  ];
  assert.equal((await seeing.toModelOutput?.(answer))?.type, "content");
  assert.deepEqual(await tool.toModelOutput?.(answer), {
    type: "text",
    value: said,
  });
  shots = { exitCode: 0, stdout: '{"pictures":[],"cut":[]}', stderr: "" };
});

test("a picture slide explains a thing at a time, and a quiz's right pick is one it has", async () => {
  const drawing = join(WORKSPACE, "scratch", "sun.svg");
  await mkdir(dirname(drawing), { recursive: true });
  await writeFile(
    drawing,
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"></svg>',
  );
  await make({
    deck: "Water",
    title: "Where rain comes from",
    slides: [
      { layout: "cover", title: "Where does rain come from?" },
      {
        layout: "picture",
        image: "scratch/sun.svg",
        alt: "The sun over the sea",
        text: "The sun warms the sea.",
        term: "sea",
      },
      {
        layout: "quiz",
        question: "What does warm water become?",
        choices: [
          { text: "Vapour", image: "scratch/sun.svg" },
          { text: "Stone" },
        ],
        right: 0,
        answer: "Warmed, it rises as vapour.",
      },
    ],
  });
  const path = file("Water");
  const deck = await held(path);
  // Both slides show the one picture, copied beside the deck once
  assert.equal(deck.slides[1].image, "sun.svg");
  assert.equal(deck.slides[2].choices[0].image, "sun.svg");
  assert.equal(deck.slides[2].choices[1].image, undefined);
  assert.ok(existsSync(join(dirname(path), "sun.svg")));

  const refused = await make({
    deck: "Water2",
    title: "T",
    slides: [
      {
        layout: "quiz",
        question: "Which?",
        choices: [{ text: "a" }, { text: "b" }],
        right: 3,
        answer: "Because.",
      },
    ],
  });
  assert.match(String(refused), /right is 3, and there are 2 picks/);
  assert.ok(!existsSync(file("Water2")));

  for (const bad of [
    {
      layout: "quiz",
      question: "One pick?",
      choices: [{ text: "a" }],
      right: 0,
      answer: "A.",
    },
    {
      layout: "quiz",
      question: "Five picks?",
      choices: [1, 2, 3, 4, 5].map((n) => ({ text: String(n) })),
      right: 0,
      answer: "A.",
    },
    {
      layout: "picture",
      image: "x.png",
      alt: "x",
      text: "a line far longer than a picture book would ever hold ".repeat(3),
    },
  ])
    assert.equal(
      schema.safeParse({ deck: "d", title: "D", slides: [bad] }).success,
      false,
      JSON.stringify(bad),
    );
});

test("a deck becomes a PDF or a video only from what it needs, and says what is missing", async () => {
  const { spawnSync } = await import("node:child_process");
  const repo = join(import.meta.dirname, "..");
  const run = (...args: string[]) =>
    spawnSync(
      process.execPath,
      [join(repo, "skills", "artifact", "scripts", "deck.mjs"), ...args],
      {
        cwd: WORKSPACE,
        encoding: "utf8",
        env: {
          ...process.env,
          THURSDAY_ARTIFACTS: "artifacts/Tester",
          THURSDAY_SKILLS: join(repo, "skills"),
        },
      },
    );
  await make({ deck: "Rain", title: "Rain", slides });

  const none = run("video", "Rain");
  assert.equal(none.status, 1);
  assert.match(none.stderr, /one audio file a slide.*: 2 of them/);
  // By its path, as make_deck handed it back
  assert.match(
    run("video", "artifacts/Tester/Rain/Rain.html").stderr,
    /: 2 of them/,
  );

  const voice = join(WORKSPACE, "scratch", "voice-1.mp3");
  await mkdir(dirname(voice), { recursive: true });
  await writeFile(voice, "");
  assert.match(
    run("video", "Rain", "scratch/voice-1.mp3").stderr,
    /has 2 slides and 1 audio files came/,
  );
  assert.match(
    run("video", "Rain", "scratch/voice-1.mp3", "scratch/gone.mp3").stderr,
    /No such audio: scratch\/gone\.mp3/,
  );
  // Nothing was made, and no voice moved
  assert.ok(!existsSync(join(dirname(file("Rain")), "Rain.mp4")));
  assert.ok(existsSync(voice));

  const page = join(WORKSPACE, "artifacts", "Tester", "page.html");
  await writeFile(page, "<p>Not a deck</p>");
  assert.match(
    run("pdf", "artifacts/Tester/page.html").stderr,
    /is not a deck the make_deck tool made/,
  );
  assert.match(run("pdf", "Nowhere").stderr, /No deck at/);
  assert.match(run("slides", "Rain").stderr, /Usage: deck\.mjs pdf/);
});
