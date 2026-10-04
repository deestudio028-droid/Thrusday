import assert from "node:assert/strict";
import test from "node:test";
import { putDown } from "../features/thursday/put-down.ts";

// What a spoken call does with files put down (features/thursday/put-down): every picture is
// made to fit first, then the fact and the pictures go into the backend's conversation back to
// back, the run after them, and she is told last, even when a step failed. Where each of them
// lands is the session's to decide (live-session tests it); here the session is a recorder.

type Session = Parameters<typeof putDown>[0];
type Fit = Parameters<typeof putDown>[2];
type Taken = Awaited<ReturnType<Fit>>;

/**
 * A session, a voice and a fit that write down what they are given, in order. Each put-in and
 * each telling also queues a microtask that writes "tick": one awaited between two of them lets
 * its tick in between, so a put-in made all at once has every tick after it.
 */
function ledger() {
  const log: string[] = [];
  const write = (entry: string) => {
    log.push(entry);
    queueMicrotask(() => log.push("tick"));
  };
  const live: Session = {
    pictureRoom: (path) => 1_000 + path.length,
    brief: (text) => write(`brief ${text}`),
    picture: (image, path) => write(`picture ${path} ${image}`),
    run: () => write("run"),
  };
  const tell = (line: string) => write(`told ${line}`);
  const fit: Fit = async (path, bytes) => {
    log.push(`fit ${path} in ${bytes}`);
    return { url: `data:${path}` };
  };
  return { log, live, tell, fit };
}

/** What was written before the first tick: whatever went in with no await between. */
const together = (log: string[]) =>
  log.slice(0, log.includes("tick") ? log.indexOf("tick") : undefined);

/** Lets everything that can run without a timer run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("pictures are made first; the fact, pictures and run then go in at once, and she is told last", async () => {
  const { log, live, tell, fit } = ledger();
  await putDown(
    live,
    { fact: "F", pictures: ["a.png", "long.png"], run: true },
    fit,
    tell,
  );
  assert.deepEqual(together(log), [
    "fit a.png in 1005",
    "fit long.png in 1008",
    "brief F",
    "picture a.png data:a.png",
    "picture long.png data:long.png",
    "run",
    "told F",
  ]);
});

test("nothing goes in and she is not told while a picture is still being made", async () => {
  const { log, live, tell } = ledger();
  const making = new Map<string, (taken: Taken) => void>();
  const fit: Fit = (path) =>
    new Promise((resolve) => {
      making.set(path, resolve);
    });
  const finish = (path: string, taken: Taken) => {
    const resolve = making.get(path);
    assert.ok(resolve, `${path} is not being made`);
    resolve(taken);
  };
  const done = putDown(
    live,
    { fact: "F", pictures: ["a.png", "b.png"], run: true },
    fit,
    tell,
  );
  await settle();
  finish("a.png", { url: "data:a" });
  await settle();
  // b.png is being made, and the fact and a.png, which are ready, wait for it
  assert.deepEqual([...making.keys()], ["a.png", "b.png"]);
  assert.deepEqual(log, []);
  finish("b.png", { url: "data:b" });
  await done;
  assert.deepEqual(together(log), [
    "brief F",
    "picture a.png data:a",
    "picture b.png data:b",
    "run",
    "told F",
  ]);
});

test("a picture that cannot be made is said to the backend in its place", async () => {
  const { log, live, tell } = ledger();
  const fit: Fit = async (path) =>
    path === "b.png"
      ? { failed: "b.png is not an image." }
      : { url: `data:${path}` };
  await putDown(
    live,
    { fact: "F", pictures: ["a.png", "b.png", "c.png"] },
    fit,
    tell,
  );
  assert.deepEqual(together(log), [
    "brief F",
    "picture a.png data:a.png",
    "brief b.png could not be put before you as a picture: b.png is not an image.",
    "picture c.png data:c.png",
    "told F",
  ]);
});

test("files with no picture go in and are told at once, and run only when asked", async () => {
  const plain = ledger();
  const first = putDown(
    plain.live,
    { fact: "F", pictures: [] },
    plain.fit,
    plain.tell,
  );
  // Nothing has been awaited yet
  assert.deepEqual(plain.log, ["brief F", "told F"]);
  const asked = ledger();
  const second = putDown(
    asked.live,
    { fact: "F", pictures: [], run: true },
    asked.fit,
    asked.tell,
  );
  assert.deepEqual(asked.log, ["brief F", "run", "told F"]);
  await Promise.all([first, second]);
});

test("she is told when a picture cannot be made at all, and the failure reaches the caller", async () => {
  const { log, live, tell } = ledger();
  const fit: Fit = async (path) => {
    if (path === "b.png") throw new Error("the canvas is gone");
    return { url: `data:${path}` };
  };
  await assert.rejects(
    putDown(
      live,
      { fact: "F", pictures: ["a.png", "b.png"], run: true },
      fit,
      tell,
    ),
    /the canvas is gone/,
  );
  // Nothing was put in: the fact goes with the pictures or not at all
  assert.deepEqual(together(log), ["told F"]);
});

test("she is told even when putting in fails partway, and the run is not asked", async () => {
  const { log, live, tell, fit } = ledger();
  const broken: Session = {
    ...live,
    picture: (image, path) => {
      if (path === "b.png") throw new Error("the data channel is closed");
      live.picture(image, path);
    },
  };
  await assert.rejects(
    putDown(
      broken,
      { fact: "F", pictures: ["a.png", "b.png"], run: true },
      fit,
      tell,
    ),
    /the data channel is closed/,
  );
  assert.deepEqual(together(log), [
    "fit a.png in 1005",
    "fit b.png in 1005",
    "brief F",
    "picture a.png data:a.png",
    "told F",
  ]);
});
