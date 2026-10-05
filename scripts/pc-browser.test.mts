import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const home = await mkdtemp(join(tmpdir(), "thursday-pc-browser-"));
process.env.THURSDAY_HOME = home;
process.env.THURSDAY_HOSTED = "1";
const { migrateDatabase } = await import("../database/migrate.ts");
await migrateDatabase();
const {
  pairPcBrowser,
  unpairPcBrowser,
  authenticatePcBrowser,
  pcBrowserStatus,
  pollPcBrowser,
  answerPcBrowser,
  commandPcBrowser,
} = await import("../features/pc-browser/bridge.ts");

after(async () => {
  await rm(home, { recursive: true, force: true }).catch((cause) => {
    if ((cause as NodeJS.ErrnoException).code !== "EBUSY") throw cause;
  });
});

test("one paired device can relay a selected-tab action and revocation takes effect", async () => {
  const key = await pairPcBrowser();
  assert.match(key, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(await authenticatePcBrowser(`Bearer ${key}`), true);
  assert.equal(await authenticatePcBrowser("Bearer bad"), false);
  assert.equal(pcBrowserStatus().connected, false);
  const wait = pollPcBrowser(true);
  assert.equal(pcBrowserStatus().connected, true);
  const result = commandPcBrowser("snapshot");
  const command = await wait;
  assert.equal(command?.method, "snapshot");
  assert.equal(
    answerPcBrowser({ id: command!.id, ok: true, value: { title: "Example" } }),
    true,
  );
  assert.deepEqual(await result, { title: "Example" });
  await unpairPcBrowser();
  assert.equal(pcBrowserStatus().connected, false);
  assert.equal(await authenticatePcBrowser(`Bearer ${key}`), false);
});

test("unpairing cancels a command before a replacement device can receive it", async () => {
  const first = await pairPcBrowser();
  const wait = pollPcBrowser(true);
  const result = commandPcBrowser("click", { selector: "#go" });
  const command = await wait;
  assert.equal(command?.method, "click");
  await unpairPcBrowser();
  await assert.rejects(result, /unpaired/);
  assert.equal(answerPcBrowser({ id: command!.id, ok: true }), false);
  assert.equal(await authenticatePcBrowser(`Bearer ${first}`), false);
  const second = await pairPcBrowser();
  assert.notEqual(second, first);
  assert.equal(await authenticatePcBrowser(`Bearer ${second}`), true);
  await unpairPcBrowser();
});
