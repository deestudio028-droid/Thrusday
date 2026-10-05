import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

// This process has no bot jobs: their asynchronous shell cleanup also emits files.
// A shared event counter in the runner suite can count another job's notification.
const home = await mkdtemp(join(tmpdir(), "thursday-workspace-signal-"));
process.env.THURSDAY_HOME = home;
process.env.THURSDAY_SKIP_BROWSER = "1";
const { appEvents } = await import("../app/api/events/app-event.server.ts");
const { openWorkspace } = await import("../features/workspace/workspace.ts");

after(async () => {
  await rm(home, { recursive: true, force: true });
});

test("every command and write in a shell tells a file open on screen to look again", async () => {
  let told = 0;
  const stop = appEvents.subscribe((event) => {
    if (event.type === "files") told += 1;
  });
  try {
    const sandbox = await openWorkspace();
    await sandbox.exec("true");
    assert.equal(told, 1);
    await sandbox.writeFile("scratch/files-signal.txt", "x");
    assert.equal(told, 2);
    // A command that failed may have written part of a file.
    assert.equal((await sandbox.exec("exit 3")).exitCode, 3);
    assert.equal(told, 3);
  } finally {
    stop();
  }
});
