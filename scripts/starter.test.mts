import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// What the command prints, and when it says the app is up. Importing background.mjs runs
// nothing: no job is read or written here.
const { comesUp } = await import("../bin/background.mjs");
const { tilde } = await import("../bin/print.mjs");

const listen = (server: Server, port = 0) =>
  new Promise<number>((resolve) =>
    server.listen(port, "127.0.0.1", () =>
      resolve((server.address() as AddressInfo).port),
    ),
  );
const close = (server: Server) =>
  new Promise((resolve) => server.close(resolve));

/** A port nothing listens on: one that was just let go. */
async function quietPort() {
  const server = createServer();
  const port = await listen(server);
  await close(server);
  return port;
}

test("a server that answers after a moment is up", async () => {
  const port = await quietPort();
  const server = createServer((_request, response) => response.end("ok"));
  const late = setTimeout(() => listen(server, port), 400);
  try {
    assert.equal(await comesUp(port, () => false, 10_000), "up");
  } finally {
    clearTimeout(late);
    await close(server);
  }
});

test("a server that answers with a failure is not up", async () => {
  const server = createServer((_request, response) => {
    response.statusCode = 500;
    response.end();
  });
  const port = await listen(server);
  try {
    assert.equal(await comesUp(port, () => false, 700), "late");
  } finally {
    await close(server);
  }
});

test("a server that exits before it answers is not waited on", async () => {
  const port = await quietPort();
  const from = Date.now();
  const gone = () => Date.now() - from > 300;
  assert.equal(await comesUp(port, gone, 60_000), "exited");
  assert.ok(Date.now() - from < 5_000);
});

test("a server that neither answers nor exits is late, not waited on for ever", async () => {
  const port = await quietPort();
  assert.equal(await comesUp(port, () => false, 600), "late");
});

test("a path under the home folder is written from ~", {
  skip: process.platform === "win32",
}, () => {
  const home = homedir();
  assert.equal(tilde(home), "~");
  assert.equal(tilde(join(home, ".thursday")), "~/.thursday");
  assert.equal(tilde("/srv/thursday"), "/srv/thursday");
  // A folder that only begins like the home folder is not under it
  assert.equal(tilde(`${home}-other/data`), `${home}-other/data`);
});

test("into a pipe or a log the lines are plain, and a step is only its finished line", () => {
  // As the background job writes them: its log is shown in Settings as it was written
  const env = { ...process.env };
  delete env.FORCE_COLOR;
  const run = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const { begin, card, done, fail, say } = await import("./bin/print.mjs");
       begin("Installing");
       done("Installed   /x/app");
       begin("Starting it");
       fail(["It did not come up."]);
       say(card("Thursday 1.2.3", "http://localhost:4747", [
         ["data", "/x"],
         ["log", null],
         ["stop", "thursday stop"],
       ]));`,
    ],
    { encoding: "utf8", env, cwd: join(import.meta.dirname, "..") },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.equal(
    run.stdout,
    [
      "  ✓ Installed   /x/app",
      "",
      "  Thursday 1.2.3",
      "  → http://localhost:4747",
      "    data   /x",
      "    stop   thursday stop",
      "",
      "",
    ].join("\n"),
  );
  assert.equal(run.stderr, "\n  It did not come up.\n\n");
});
