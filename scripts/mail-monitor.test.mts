import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";

process.env.THURSDAY_HOME = await mkdtemp(join(tmpdir(), "thursday-monitor-"));
let next = 100;
let validity = "one";
let messages: number[] = [];
mock.module("../features/mail-monitor/inbox.ts", {
  namedExports: {
    withInbox: async (use: (client: unknown, address: string) => unknown) =>
      use(
        {
          mailbox: { uidValidity: validity, uidNext: next },
          search: async () => messages,
        },
        "assistant@example.test",
      ),
    readInboxMail: async (_client: unknown, uid: number) => ({
      uid,
      from: "sender@example.test",
      subject: "Message",
      text: "Message content",
    }),
  },
});
// The monitor's injected assessor avoids models; no provider or shell is used in this suite.
mock.module("../features/thursday/thursday.text.ts", {
  namedExports: { readTextCallProvider: async () => null },
});
const { migrateDatabase } = await import("../database/migrate.ts");
await migrateDatabase();
const { writeConfig, readConfig } = await import(
  "../features/config/config.query.ts"
);
const { listReminders, queueImportantMailAlert, createReminder } = await import(
  "../features/reminder/reminder.query.ts"
);
const { monitorTick, MONITOR_ENABLED } = await import(
  "../features/mail-monitor/monitor.ts"
);
let assessed: number[] = [];
const assess = async (mail: { uid: number }) => {
  assessed.push(mail.uid);
  return {
    important: true,
    summary: "An important message",
    reason: "Needs action",
  };
};

test("disabled monitor and first enable never alert old messages", async () => {
  await monitorTick(assess);
  assert.deepEqual(assessed, []);
  await writeConfig(MONITOR_ENABLED, "on");
  messages = [97, 98, 99];
  await monitorTick(assess);
  assert.deepEqual(assessed, []);
  assert.equal(JSON.parse((await readConfig("MAIL_MONITOR_CURSOR"))!).uid, 99);
});

test("important new UID creates only Telegram and call; repeated UID never duplicates", async () => {
  messages = [99, 100];
  next = 101;
  await monitorTick(assess);
  await monitorTick(assess);
  assert.deepEqual(assessed, [100]);
  const rows = await listReminders();
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].deliveries.map((one) => one.channel).sort(), [
    "call",
    "telegram",
  ]);
  await queueImportantMailAlert(rows[0].id, "Duplicate", "Duplicate");
  assert.equal((await listReminders()).length, 1);
});

test("routine mail advances cursor without alerting", async () => {
  messages = [101];
  await monitorTick(async () => ({
    important: false,
    summary: "Routine",
    reason: "No action",
  }));
  assert.equal((await listReminders()).length, 1);
  assert.equal(JSON.parse((await readConfig("MAIL_MONITOR_CURSOR"))!).uid, 101);
});

test("classification failure keeps cursor and does not dial; next successful assessment resumes", async () => {
  messages = [102];
  await assert.rejects(
    monitorTick(async () => {
      throw new Error("Classifier unavailable");
    }),
    /Classifier unavailable/,
  );
  assert.equal(JSON.parse((await readConfig("MAIL_MONITOR_CURSOR"))!).uid, 101);
  assert.equal((await listReminders()).length, 1);
  await monitorTick(assess);
  assert.equal((await listReminders()).length, 2);
});

test("changed mailbox validity rebaselines instead of replaying old mail", async () => {
  validity = "two";
  next = 51;
  messages = [49, 50];
  assessed = [];
  await monitorTick(assess);
  assert.deepEqual(assessed, []);
  assert.equal(JSON.parse((await readConfig("MAIL_MONITOR_CURSOR"))!).uid, 50);
});

test("call-only reminder preference does not add other notifications", async () => {
  await writeConfig("REMINDER_CHANNELS", "call");
  const made = await createReminder(
    {
      label: "Requested reminder",
      words: "Reminder",
      at: "2030-01-01 10:00",
      timeZone: "UTC",
    },
    new Date("2029-01-01T00:00:00Z"),
  );
  const row = (await listReminders()).find((one) => one.id === made.id)!;
  assert.deepEqual(
    row.deliveries.map((one) => one.channel),
    ["call"],
  );
});
