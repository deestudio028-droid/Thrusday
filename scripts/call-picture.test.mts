import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { CALL_PICTURE } from "../config.ts";
import { pictureOfFile, pictureSizes } from "../features/thursday/picture.ts";

// A picture put down on a spoken call is made to fit the one message its connection carries
// (features/thursday/picture): the sizes it is tried at, and what the backend is told when one
// could not be put before it. The browser's part, a file route, a decoder and a canvas, is
// stood in for below.

type Size = { width: number; height: number };

const square = (side: number): Size => ({ width: side, height: side });

test("a picture larger than the longest side starts at it and steps down as it always has", () => {
  assert.deepEqual(pictureSizes(3200, 2000), [
    { width: 1600, height: 1000 },
    { width: 1200, height: 750 },
    { width: 800, height: 500 },
    { width: 560, height: 350 },
  ]);
  assert.deepEqual(pictureSizes(2000, 3200), [
    { width: 1000, height: 1600 },
    { width: 750, height: 1200 },
    { width: 500, height: 800 },
    { width: 350, height: 560 },
  ]);
  // The arithmetic from when every scale was of `longestSide`: what is larger than that
  // comes out the same to the pixel
  const ofLongestSide = ({ width, height }: Size): Size[] =>
    CALL_PICTURE.scales.map((scale) => {
      const ratio = Math.min(
        1,
        (CALL_PICTURE.longestSide * scale) / Math.max(width, height),
      );
      return {
        width: Math.round(width * ratio),
        height: Math.round(height * ratio),
      };
    });
  for (const [width, height] of [
    [1601, 1201],
    [1920, 1080],
    [4032, 3024],
    [3000, 3000],
    [8000, 6000],
    [1601, 7],
  ])
    assert.deepEqual(
      pictureSizes(width, height),
      ofLongestSide({ width, height }),
      `${width}x${height}`,
    );
});

test("a picture smaller than the longest side steps down from its own size", () => {
  assert.deepEqual(pictureSizes(400, 400), [
    square(400),
    square(300),
    square(200),
    square(140),
  ]);
  assert.deepEqual(pictureSizes(560, 320), [
    { width: 560, height: 320 },
    { width: 420, height: 240 },
    { width: 280, height: 160 },
    { width: 196, height: 112 },
  ]);
  for (const [width, height] of [
    [400, 400],
    [560, 320],
    [100, 100],
    [1599, 900],
  ]) {
    const sizes = pictureSizes(width, height);
    sizes.slice(1).forEach((size, at) => {
      const before = sizes[at];
      assert.ok(
        size.width < before.width && size.height < before.height,
        `${width}x${height}: step ${at + 1} is not smaller than the one before`,
      );
    });
  }
});

test("a side is never under one pixel, however much longer the other is", () => {
  assert.deepEqual(
    pictureSizes(4000, 1),
    [1600, 1200, 800, 560].map((width) => ({ width, height: 1 })),
  );
  assert.deepEqual(
    pictureSizes(1, 4000),
    [1600, 1200, 800, 560].map((height) => ({ width: 1, height })),
  );
  for (const [width, height] of [
    [4000, 1],
    [1, 4000],
    [100_000, 1],
    [1, 100_000],
    [1, 1],
  ])
    for (const size of pictureSizes(width, height))
      assert.ok(
        size.width >= 1 &&
          size.height >= 1 &&
          Number.isInteger(size.width) &&
          Number.isInteger(size.height),
        `${width}x${height}: ${size.width}x${size.height}`,
      );
});

test("no step is larger than the one before it, or than the picture", () => {
  for (const [width, height] of [
    [1, 1],
    [2, 2],
    [3, 2],
    [7, 5],
    [16, 16],
    [400, 400],
    [1599, 1],
    [1600, 900],
    [1601, 900],
    [3200, 2000],
    [4000, 1],
    [1, 4000],
    [8000, 6000],
  ]) {
    const sizes = pictureSizes(width, height);
    assert.equal(sizes.length, CALL_PICTURE.scales.length);
    let before: Size = { width, height };
    for (const size of sizes) {
      assert.ok(
        size.width <= before.width && size.height <= before.height,
        `${width}x${height}: ${size.width}x${size.height} after ${before.width}x${before.height}`,
      );
      before = size;
    }
    assert.ok(
      Math.max(sizes[0].width, sizes[0].height) <= CALL_PICTURE.longestSide,
      `${width}x${height} starts past the longest side`,
    );
  }
});

/** What was read back off the canvas: its size then, and the quality asked for. */
type Drawn = Size & { quality: number };

/**
 * A JPEG as a browser reads a canvas back: longer with more pixels and a higher quality, and
 * `data:,` for a canvas with no pixels, as a browser answers for one.
 */
const jpeg = (width: number, height: number, quality: number) =>
  width && height
    ? `data:image/jpeg;base64,${"A".repeat(Math.ceil((width * height * quality) / 10))}`
    : "data:,";

/** What the browser is made to do with a picture: the file route's answer, then the rest. */
type Browser = {
  route: () => Response;
  /** What decoding the body makes, or the reason it cannot. */
  bitmap?: Size | Error;
  /** Whether the browser gives a canvas to draw on. */
  canvas?: boolean;
};

const realFetch = globalThis.fetch;
afterEach(() => {
  Object.assign(globalThis, { fetch: realFetch });
  Reflect.deleteProperty(globalThis, "document");
  Reflect.deleteProperty(globalThis, "createImageBitmap");
});

/** Stands the browser's part in for `pictureOfFile`, and returns what it was made to do. */
function browse({
  route,
  bitmap = { width: 400, height: 300 },
  canvas = true,
}: Browser) {
  const seen = { asked: [] as string[], drawn: [] as Drawn[], closed: 0 };
  Object.assign(globalThis, {
    fetch: async (url: string) => {
      seen.asked.push(url);
      return route();
    },
    createImageBitmap: async () => {
      if (bitmap instanceof Error) throw bitmap;
      return {
        ...bitmap,
        close: () => {
          seen.closed += 1;
        },
      };
    },
    document: {
      createElement: () => {
        const drawing = {
          width: 0,
          height: 0,
          getContext: () => (canvas ? { fillRect() {}, drawImage() {} } : null),
          toDataURL: (_type: string, quality: number): string => {
            const { width, height } = drawing;
            seen.drawn.push({ width, height, quality });
            return jpeg(width, height, quality);
          },
        };
        return drawing;
      },
    },
  });
  return seen;
}

const png = () =>
  new Response("png", { headers: { "content-type": "image/png" } });

/** The sizes drawn on, in turn: one size once, however many qualities it was read back at. */
const sizesDrawn = (drawn: Drawn[]): Size[] =>
  drawn
    .filter(
      (size, at) =>
        !at ||
        size.width !== drawn[at - 1].width ||
        size.height !== drawn[at - 1].height,
    )
    .map(({ width, height }) => ({ width, height }));

/** The picture handed over, as its data URL; what was said in its place fails the test. */
async function taken(path: string, bytes: number): Promise<string> {
  const got = await pictureOfFile(path, bytes);
  assert.ok("url" in got, "failed" in got ? got.failed : "no picture");
  return got.url;
}

/** Room for less than any JPEG comes to (its header alone is longer), whatever the steps are. */
const NONE_FITS = 20;

test("a picture that fits goes as a JPEG at its own size, and its bitmap is let go", async () => {
  const seen = browse({ route: png });
  const url = await taken("a b/pic.png", 100_000);
  assert.equal(url, jpeg(400, 300, CALL_PICTURE.qualities[0]));
  assert.deepEqual(seen.asked, ["/api/file/a%20b/pic.png"]);
  assert.deepEqual(seen.drawn, [
    { width: 400, height: 300, quality: CALL_PICTURE.qualities[0] },
  ]);
  assert.equal(seen.closed, 1);
});

test("a small picture too heavy at its own size is made smaller, not tried again at it", async () => {
  const seen = browse({ route: png, bitmap: square(400) });
  // One short of the least the first size can come to, at the plainest quality
  const bytes = jpeg(400, 400, Math.min(...CALL_PICTURE.qualities)).length - 1;
  const url = await taken("a.png", bytes);
  assert.ok(url.length <= bytes);
  assert.deepEqual(sizesDrawn(seen.drawn), pictureSizes(400, 400).slice(0, 2));
  assert.equal(seen.closed, 1);
});

test("a picture that fits at no size was tried at every size, each smaller than the last", async () => {
  const seen = browse({ route: png, bitmap: square(400) });
  const got = await pictureOfFile("a.png", NONE_FITS);
  assert.ok("failed" in got);
  assert.deepEqual(sizesDrawn(seen.drawn), pictureSizes(400, 400));
  assert.equal(
    seen.drawn.length,
    pictureSizes(400, 400).length * CALL_PICTURE.qualities.length,
  );
  assert.equal(seen.closed, 1);
});

test("a strip of a picture is never drawn on a canvas with no pixels", async () => {
  for (const bitmap of [
    { width: 4000, height: 1 },
    { width: 1, height: 4000 },
  ]) {
    const seen = browse({ route: png, bitmap });
    const url = await taken("strip.png", 100_000);
    assert.ok(url.startsWith("data:image/jpeg;base64,"), url);
    assert.ok(
      seen.drawn.every(({ width, height }) => width >= 1 && height >= 1),
      JSON.stringify(seen.drawn),
    );
  }
});

test("every way a picture can fail is words for the backend, and nothing throws", async () => {
  const cases: {
    what: string;
    browser: Browser;
    told: string;
    /** The room for the picture; it fits, unless a case says none does. */
    bytes?: number;
    /** Bitmaps made and so to be let go: none unless the body was decoded. */
    closed?: number;
  }[] = [
    {
      what: "a route that cannot be reached",
      browser: {
        route: () => {
          throw new TypeError("Failed to fetch");
        },
      },
      told: "a.png could not be read: Failed to fetch",
    },
    {
      what: "a file that is gone",
      browser: { route: () => new Response("Not found", { status: 404 }) },
      told: "There is no file at a.png in the workspace.",
    },
    {
      what: "a path outside the workspace",
      browser: { route: () => new Response("Outside", { status: 403 }) },
      told: "a.png is outside the workspace.",
    },
    {
      what: "another refusal",
      browser: { route: () => new Response("", { status: 500 }) },
      told: "a.png could not be read: the file route answered 500.",
    },
    {
      what: "a body that breaks partway",
      browser: {
        route: () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new TypeError("connection reset"));
              },
            }),
            { headers: { "content-type": "image/png" } },
          ),
      },
      told: "a.png could not be read: connection reset",
    },
    {
      what: "a file that is not an image",
      browser: {
        route: () =>
          new Response("words", { headers: { "content-type": "text/plain" } }),
      },
      told: "a.png is not an image. Read it in the shell instead.",
    },
    {
      what: "a file the browser cannot decode",
      browser: {
        route: png,
        bitmap: new Error("The source image could not be decoded."),
      },
      told: "a.png could not be drawn as a picture: The source image could not be decoded.",
    },
    {
      what: "a browser with no canvas",
      browser: { route: png, canvas: false },
      told: "This browser could not draw the picture.",
      closed: 1,
    },
    {
      what: "a picture that fits at no size",
      browser: { route: png },
      told: `a.png would not fit the ${NONE_FITS} B this connection carries, even made smaller.`,
      bytes: NONE_FITS,
      closed: 1,
    },
  ];
  for (const { what, browser, told, bytes = 100_000, closed = 0 } of cases) {
    const seen = browse(browser);
    assert.deepEqual(
      await pictureOfFile("a.png", bytes),
      { failed: told },
      what,
    );
    assert.equal(seen.closed, closed, what);
  }
});
