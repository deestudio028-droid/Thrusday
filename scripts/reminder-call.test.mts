import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, mock, test } from "node:test";

const home = await mkdtemp(join(tmpdir(), "thursday-reminder-call-"));
process.env.THURSDAY_HOME = home;
const values = new Map([
  ["REMINDER_CALL_OWNER_NUMBER", "+919876543210"],
  ["TWILIO_ACCOUNT_SID", `AC${"a".repeat(32)}`],
  ["TWILIO_AUTH_TOKEN", "test-private-token"],
  ["TWILIO_CALLER_NUMBER", "+15715550123"],
  ["REMINDER_CALL_MONTHLY_CAP", "30"],
]);
mock.module("../features/config/config.query.ts", {
  namedExports: { readConfig: async (key: string) => values.get(key) },
});
const { migrateDatabase } = await import("../database/migrate.ts");
await migrateDatabase();
const { placeOwnerCall, callBudgetStatus } = await import(
  "../features/reminder/call.ts"
);
const { createReminder, claimDelivery, beginDispatch } = await import(
  "../features/reminder/reminder.query.ts"
);
let sequence = 0;
async function reservedCall() {
  const now = new Date("2026-10-04T09:30:00Z");
  const reminder = await createReminder(
    {
      label: `Call ${++sequence}`,
      words: "Hello",
      at: "2026-10-04 15:00",
      timeZone: "Asia/Kolkata",
    },
    new Date("2026-10-04T09:00:00Z"),
  );
  assert.equal(await claimDelivery(reminder.id, "call"), true);
  assert.equal(await beginDispatch(reminder.id, "call", now), true);
  return { id: reminder.id, now };
}

after(async () => {
  await rm(home, { recursive: true, force: true }).catch((cause) => {
    if ((cause as NodeJS.ErrnoException).code !== "EBUSY") throw cause;
  });
});

test("Twilio receives owner-only To, configured From and bounded spoken TwiML", async () => {
  const oldFetch = globalThis.fetch;
  let request:
    | { url: string; method?: string; body?: URLSearchParams }
    | undefined;
  globalThis.fetch = (async (url: string, options?: RequestInit) => {
    request = {
      url,
      method: options?.method,
      body: options?.body as URLSearchParams,
    };
    return Response.json({ sid: `CA${"b".repeat(32)}`, status: "queued" });
  }) as typeof fetch;
  try {
    const reservation = await reservedCall();
    const receipt = await placeOwnerCall(
      "Hello ".repeat(100),
      reservation.now,
      reservation.id,
    );
    assert.equal(receipt.sid, `CA${"b".repeat(32)}`);
    assert.equal(
      request?.url,
      `https://api.twilio.com/2010-04-01/Accounts/AC${"a".repeat(32)}/Calls.json`,
    );
    assert.equal(request?.method, "POST");
    assert.equal(request?.body?.get("To"), "+919876543210");
    assert.equal(request?.body?.get("From"), "+15715550123");
    assert.match(request?.body?.get("Twiml") ?? "", /^<Response><Say>Hello /);
    assert.equal(
      (request?.body?.get("Twiml")?.length ?? 0) -
        "<Response><Say></Say><Hangup/></Response>".length,
      350,
    );
    assert.equal((await callBudgetStatus()).limit, 30);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("a failed transport cannot be mistaken for an answered call", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("connection reset");
  }) as typeof fetch;
  try {
    const reservation = await reservedCall();
    await assert.rejects(
      placeOwnerCall("Hello", reservation.now, reservation.id),
      /connection reset/,
    );
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("an owner callback uses the PIN-gated webhook and the same bounded reservation", async () => {
  const oldFetch = globalThis.fetch;
  let body: URLSearchParams | undefined;
  globalThis.fetch = (async (_url, options) => {
    body = options?.body as URLSearchParams;
    return Response.json({ sid: `CA${"e".repeat(32)}`, status: "queued" });
  }) as typeof fetch;
  try {
    const reservation = await reservedCall();
    await placeOwnerCall("Hello", reservation.now, reservation.id, true);
    assert.equal(body?.get("To"), "+919876543210");
    assert.equal(body?.get("Twiml"), null);
    assert.ok(body?.get("Url")?.endsWith("/api/twilio/voice/start"));
    assert.equal(body?.get("Method"), "POST");
    assert.equal(body?.get("TimeLimit"), "120");
  } finally {
    globalThis.fetch = oldFetch;
  }
});
