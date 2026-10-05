import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, mock, test } from "node:test";

const home = await mkdtemp(join(tmpdir(), "thursday-reminder-"));
process.env.THURSDAY_HOME = home;

mock.module("../features/reach/reach.ts", {
  namedExports: {
    ownerNoticeReady: async () => true,
    sendOwnerNotice: async () => {},
  },
});
mock.module("../features/reminder/call.ts", {
  namedExports: {
    callSetup: async () => ({ ready: true }),
    placeOwnerCall: async () => {},
  },
});

const { migrateDatabase } = await import("../database/migrate.ts");
await migrateDatabase();
const {
  createReminder,
  listReminders,
  cancelReminder,
  claimDelivery,
  beginDispatch,
  recoverDeliveries,
} = await import("../features/reminder/reminder.query.ts");
const { startDueReminders } = await import(
  "../features/reminder/reminder.clock.ts"
);
const { dueInstant } = await import("../features/reminder/reminder.schema.ts");

after(async () => {
  // Windows libsql keeps a handle open until process exit; the OS clears this temp directory later.
  await rm(home, { recursive: true, force: true }).catch((cause) => {
    if ((cause as NodeJS.ErrnoException).code !== "EBUSY") throw cause;
  });
});

test("wall-clock conversion handles India and rejects missing or repeated DST minutes", () => {
  assert.equal(
    dueInstant("2026-10-04 15:00", "Asia/Kolkata").toISOString(),
    "2026-10-04T09:30:00.000Z",
  );
  assert.throws(
    () => dueInstant("2026-03-08 02:30", "America/New_York"),
    /does not exist/,
  );
  assert.throws(
    () => dueInstant("2026-11-01 01:30", "America/New_York"),
    /occurs twice/,
  );
});

test("independent channels record acceptance, uncertain result, and certain rejection once", async () => {
  const now = new Date("2026-10-04T09:00:00Z");
  const made = await createReminder(
    {
      label: "Meeting",
      words: "Join the meeting",
      at: "2026-10-04 15:00",
      timeZone: "Asia/Kolkata",
    },
    now,
  );
  const sent = { email: 0, telegram: 0, call: 0 };
  const senders = {
    email: async () => {
      sent.email++;
    },
    telegram: async () => {
      sent.telegram++;
      throw new Error("network reset");
    },
    call: async () => {
      sent.call++;
      return { sid: `CA${"b".repeat(32)}`, status: "queued" };
    },
  };
  const due = new Date("2026-10-04T09:30:00Z");
  await Promise.all([
    startDueReminders(due, senders),
    startDueReminders(due, senders),
  ]);
  assert.deepEqual(sent, { email: 1, telegram: 1, call: 1 });
  const row = (await listReminders()).find((one) => one.id === made.id)!;
  assert.deepEqual(
    Object.fromEntries(row.deliveries.map((one) => [one.channel, one.status])),
    {
      email: "accepted",
      telegram: "unknown",
      call: "accepted",
    },
  );
  await recoverDeliveries();
  await startDueReminders(new Date("2026-10-04T09:35:00Z"), senders);
  assert.deepEqual(sent, { email: 1, telegram: 1, call: 1 });
});

test("restart only reclaims a pre-dispatch claim; never repeats uncertain dispatch", async () => {
  const now = new Date("2026-10-04T10:00:00Z");
  const made = await createReminder(
    {
      label: "Restart",
      words: "Check status",
      at: "2026-10-04 16:00",
      timeZone: "Asia/Kolkata",
    },
    new Date("2026-10-04T09:00:00Z"),
  );
  assert.equal(await claimDelivery(made.id, "email"), true);
  assert.equal(await claimDelivery(made.id, "telegram"), true);
  assert.equal(await beginDispatch(made.id, "telegram", now), true);
  await recoverDeliveries(new Date("2026-10-04T10:01:00Z"));
  const row = (await listReminders()).find((one) => one.id === made.id)!;
  assert.deepEqual(
    Object.fromEntries(row.deliveries.map((one) => [one.channel, one.status])),
    {
      email: "ready",
      telegram: "unknown",
      call: "ready",
    },
  );
  assert.equal(await cancelReminder(made.id), true);
  assert.equal(await claimDelivery(made.id, "email"), false);
});
