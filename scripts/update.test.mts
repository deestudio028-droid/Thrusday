import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, test } from "node:test";

// Moving to a newer version: what npm is asked and how often, what is offered for each way
// of running, the notice's day of quiet, and the command the app runs for itself — against a
// stand-in `npx`, since the real one replaces the background job of whoever runs this.
// No network: `fetch` is the test's.
const home = await mkdtemp(join(tmpdir(), "thursday-update-"));
process.env.THURSDAY_HOME = home;

const { migrateDatabase } = await import("../database/migrate.ts");
await migrateDatabase();
const { UPDATE } = await import("../config.ts");
const { database } = await import("../database/db.ts");
const { threadTable } = await import("../database/tables.ts");
const { closeUpdateNotice, isNewer, readUpdate, startUpdate } = await import(
  "../features/settings/update.ts"
);

const realFetch = globalThis.fetch;
const realPath = process.env.PATH;
const kept = { ...UPDATE };
after(async () => {
  await rm(home, { recursive: true, force: true });
});
afterEach(() => {
  globalThis.fetch = realFetch;
  process.env.PATH = realPath;
  Object.assign(UPDATE, kept);
  forget();
  for (const name of [
    "THURSDAY_VERSION",
    "THURSDAY_RUNS",
    "THURSDAY_COMMAND",
    "THURSDAY_START",
    "PORT",
  ])
    delete process.env[name];
});

const pinned = globalThis as {
  __updateAsked?: unknown;
  __updateMoving?: unknown;
};
/** What a restart forgets: npm's last answer and a move under way. */
const forget = () => {
  delete pinned.__updateAsked;
  delete pinned.__updateMoving;
};

/** npm answers `latest` as `version`, or not at all; counts the asks. */
function npm(version: string | null) {
  const asked: string[] = [];
  globalThis.fetch = (async (url: string) => {
    asked.push(String(url));
    if (version === null) throw new TypeError("fetch failed");
    return Response.json({ name: "thursday-agent", version });
  }) as typeof fetch;
  return asked;
}

/** The environment the starter hands the server (bin/thursday.mjs). */
function runs(
  where: "background" | "terminal",
  command: string,
  version = "1.2.3",
) {
  process.env.THURSDAY_VERSION = version;
  process.env.THURSDAY_RUNS = where;
  process.env.THURSDAY_COMMAND = command;
  process.env.THURSDAY_START = `${command} start`;
  process.env.PORT = "4747";
}

const mac = process.platform === "darwin";

test("a later plain release is newer; an equal, an earlier or a prerelease one is not", () => {
  assert.equal(isNewer("0.25.0", "0.24.0"), true);
  assert.equal(isNewer("0.100.0", "0.99.9"), true, "numbers, not text");
  assert.equal(isNewer("1.0.0", "0.99.99"), true);
  assert.equal(isNewer("0.24.0", "0.24.0"), false);
  assert.equal(isNewer("0.23.9", "0.24.0"), false);
  assert.equal(isNewer("0.25.0-beta.1", "0.24.0"), false);
  assert.equal(isNewer("latest", "0.24.0"), false);
});

test("a copy run from source is told nothing, and npm is not asked", async () => {
  const asked = npm("9.9.9");
  // `pnpm dev`: no starter, so no version and no command
  assert.deepEqual(await readUpdate(), {
    current: null,
    newer: null,
    unreached: false,
    command: null,
    byButton: false,
    notice: false,
    moving: null,
  });
  // `pnpm start` in a checkout names its version, and moves with git
  runs("terminal", "pnpm start");
  const checkout = await readUpdate();
  assert.equal(checkout.current, "1.2.3");
  assert.equal(checkout.newer, null);
  assert.equal(asked.length, 0);
});

test("npm is asked once for every page that opens within the day, and again after it", async () => {
  runs("background", "npx thursday-agent");
  const asked = npm("1.3.0");
  const [first, second] = await Promise.all([readUpdate(), readUpdate()]);
  assert.deepEqual(asked, ["https://registry.npmjs.org/thursday-agent/latest"]);
  assert.equal(first.newer, "1.3.0");
  assert.equal(second.newer, "1.3.0");
  assert.equal(first.unreached, false);
  await readUpdate();
  assert.equal(asked.length, 1, "kept for UPDATE.checkMs");
  UPDATE.checkMs = 0;
  await readUpdate();
  assert.equal(asked.length, 2);
});

test("npm out of reach is said, offers nothing, and is asked again sooner than a day", async () => {
  runs("background", "npx thursday-agent");
  const asked = npm(null);
  const update = await readUpdate();
  assert.equal(update.unreached, true);
  assert.equal(update.newer, null);
  assert.equal(update.notice, false);
  await readUpdate();
  assert.equal(asked.length, 1, "kept for UPDATE.againMs");
  // The day a good answer is kept is not what a failure waits
  UPDATE.againMs = 0;
  npm("1.3.0");
  assert.equal((await readUpdate()).newer, "1.3.0");
});

test("the version that runs being npm's newest, or past it, offers nothing", async () => {
  runs("background", "npx thursday-agent", "1.3.0");
  npm("1.3.0");
  const same = await readUpdate();
  assert.equal(same.newer, null);
  assert.equal(same.unreached, false);
  assert.equal(same.notice, false);
  forget();
  runs("background", "npx thursday-agent", "1.4.0");
  assert.equal((await readUpdate()).newer, null);
});

test("each way of running is given the line that moves it, and only the background's npx copy a button", async () => {
  npm("1.3.0");
  runs("background", "npx thursday-agent");
  const background = await readUpdate();
  assert.equal(background.command, "npx thursday-agent@1.3.0 start");
  assert.equal(background.byButton, mac, "the background is macOS only");

  runs("terminal", "npx thursday-agent");
  const terminal = await readUpdate();
  assert.equal(terminal.command, "npx thursday-agent@1.3.0");
  assert.equal(terminal.byButton, false);

  // Another data folder keeps its `--home` in the line
  process.env.THURSDAY_START = "npx thursday-agent start --home /tmp/other";
  assert.equal(
    (await readUpdate()).command,
    "npx thursday-agent@1.3.0 --home /tmp/other",
  );

  runs("background", "thursday");
  const global = await readUpdate();
  assert.equal(
    global.command,
    "npm install -g thursday-agent@1.3.0 && thursday start",
  );
  assert.equal(global.byButton, false);
});

test("the notice is due until it is closed, then stays away for UPDATE.quietMs", async () => {
  runs("background", "npx thursday-agent");
  npm("1.3.0");
  assert.equal((await readUpdate()).notice, true);
  await closeUpdateNotice();
  const closed = await readUpdate();
  assert.equal(closed.notice, false);
  assert.equal(closed.newer, "1.3.0", "Settings still says it");
  UPDATE.quietMs = 0;
  assert.equal((await readUpdate()).notice, true);
});

test("a version the server did not offer is never run", async () => {
  runs("background", "npx thursday-agent");
  npm("1.3.0");
  await assert.rejects(startUpdate("1.3.1", true), /not on offer/);
  await assert.rejects(startUpdate("1.3.0 && rm -rf ~", true), /not on offer/);
  // In a terminal the move is the person's to type
  runs("terminal", "npx thursday-agent");
  await assert.rejects(startUpdate("1.3.0", true), /not on offer/);
  assert.equal((await readUpdate()).moving, null);
});

/** A stand-in `npx` first on the PATH: writes what it was run with, then exits as told. */
async function standInNpx(exit: number) {
  const bin = await mkdtemp(join(tmpdir(), "thursday-npx-"));
  const out = join(bin, "ran.txt");
  await writeFile(
    join(bin, "npx"),
    `#!/bin/sh\n{ printf '%s\\n' "$@"; echo "COMMAND=$THURSDAY_COMMAND"; echo "NODE_ENV=$NODE_ENV"; echo "PORT=$PORT"; echo "CWD=$(pwd)"; echo "HOME_VAR=$THURSDAY_HOME"; } > '${out}'\necho "the stand-in ran"\nexit ${exit}\n`,
  );
  await chmod(join(bin, "npx"), 0o755);
  process.env.PATH = `${bin}:${realPath}`;
  return {
    ran: async () => {
      for (let tries = 0; tries < 200; tries++) {
        const text = await readFile(out, "utf8").catch(() => "");
        if (text.includes("HOME_VAR=")) return text.trim().split("\n");
        await new Promise((done) => setTimeout(done, 10));
      }
      assert.fail("the stand-in npx never ran");
    },
    done: () => rm(bin, { recursive: true, force: true }),
  };
}

test("Update runs the new version's own start on this folder and port, in the user's environment", {
  skip: !mac,
}, async () => {
  runs("background", "npx thursday-agent");
  npm("1.3.0");
  const npx = await standInNpx(0);
  try {
    assert.deepEqual(await startUpdate("1.3.0", false), {
      started: true,
      busy: null,
    });
    assert.deepEqual(await npx.ran(), [
      "--yes",
      "thursday-agent@1.3.0",
      "start",
      "--home",
      home,
      "--port",
      "4747",
      "--no-open",
      // How the person starts it is kept; what the app set to run itself is not passed on
      "COMMAND=npx thursday-agent",
      "NODE_ENV=",
      "PORT=",
      // Not the folder this server runs in, which the new version's start removes
      `CWD=${homedir()}`,
      "HOME_VAR=",
    ]);
    assert.deepEqual((await readUpdate()).moving, {
      to: "1.3.0",
      failed: null,
    });
    // Pressed again, in another tab: the move under way is the one
    assert.equal((await startUpdate("1.3.0", false)).started, true);
  } finally {
    await npx.done();
  }
});

test("a command that stops short is said in its own last words, and Update can be pressed again", {
  skip: !mac,
}, async () => {
  runs("background", "npx thursday-agent");
  npm("1.3.0");
  const npx = await standInNpx(1);
  try {
    await startUpdate("1.3.0", false);
    await npx.ran();
    let failed: string | null = null;
    for (let tries = 0; tries < 200 && !failed; tries++) {
      failed = (await readUpdate()).moving?.failed ?? null;
      await new Promise((done) => setTimeout(done, 10));
    }
    assert.equal(failed, "the stand-in ran");
    assert.equal(
      await readFile(join(home, "update.local.log"), "utf8"),
      "the stand-in ran\n",
    );
  } finally {
    await npx.done();
  }
  const again = await standInNpx(0);
  try {
    assert.equal((await startUpdate("1.3.0", false)).started, true);
    await again.ran();
    assert.equal((await readUpdate()).moving?.failed, null);
  } finally {
    await again.done();
  }
});

test("with a job at work Update says so first, and starts only when told anyway", {
  skip: !mac,
}, async () => {
  runs("background", "npx thursday-agent");
  npm("1.3.0");
  await database.insert(threadTable).values({
    id: "busy-thread",
    bot: "Alpha",
    label: "Busy",
    request: "Busy",
    status: "running",
  });
  const npx = await standInNpx(0);
  try {
    assert.deepEqual(await startUpdate("1.3.0", false), {
      started: false,
      busy: { call: false, threads: 1 },
    });
    assert.equal((await readUpdate()).moving, null, "nothing was run");
    assert.equal((await startUpdate("1.3.0", true)).started, true);
    await npx.ran();
  } finally {
    await npx.done();
  }
});

test("a move that stops says whether the one before runs on or nothing answers, and stopping twice is two failures", async (context) => {
  const { followUpdate, useUpdateStore } = await import(
    "../features/settings/update.store.ts"
  );
  const { UPDATE } = await import("../config.ts");
  /** What the server answers the page's read with; null is a server that is down. */
  let answer: unknown = null;
  context.mock.method(globalThis, "fetch", async () => {
    if (!answer) throw new TypeError("fetch failed");
    return Response.json({ $ok: true, data: answer });
  });
  context.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const pass = async (ms: number) => {
    for (let at = 0; at < ms; at += UPDATE.pollMs) {
      context.mock.timers.tick(UPDATE.pollMs);
      for (let turn = 0; turn < 5; turn++)
        await new Promise((done) => setImmediate(done));
    }
  };

  // The server that ran before is back and says why the move stopped
  answer = { current: "1.2.0", moving: { to: "1.3.0", failed: "npm said no" } };
  const first = followUpdate("1.3.0");
  await pass(UPDATE.pollMs);
  await first;
  const one = useUpdateStore.getState().failed;
  assert.deepEqual(one, { to: "1.3.0", why: "npm said no", running: true });

  // Tried again, and nothing answers until the page gives up: not said to be running
  answer = null;
  const second = followUpdate("1.3.0");
  await pass(UPDATE.waitMs + UPDATE.pollMs);
  await second;
  const two = useUpdateStore.getState().failed;
  assert.deepEqual(two, {
    to: "1.3.0",
    why: "The new version did not answer in time.",
    running: false,
  });
  // The card puts away the failure it was closed on, which the second is not (update-notice)
  assert.notEqual(two, one);
});
