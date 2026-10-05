import assert from "node:assert/strict";
import { mock, test } from "node:test";
import twilio from "twilio";

process.env.THURSDAY_HOSTED = "1";
process.env.THURSDAY_URL = "https://assistant.example";
const sid = `AC${"a".repeat(32)}`;
const callSid = `CA${"b".repeat(32)}`;
const values = new Map([
  ["TWILIO_ACCOUNT_SID", sid],
  ["TWILIO_AUTH_TOKEN", "test-new-auth-token"],
  ["TWILIO_CALLER_NUMBER", "+15715550123"],
  ["REMINDER_CALL_OWNER_NUMBER", "+919876543210"],
  ["TWILIO_VOICE_PIN", "123456"],
]);
mock.module("../features/config/config.query.ts", {
  namedExports: { readConfig: async (key: string) => values.get(key) },
});
let answers = 0;
let answerGate: Promise<void> | null = null;
mock.module("../features/thursday/thursday.text.ts", {
  namedExports: {
    openTextCall: async () => ({ callId: "test-call", standing: null }),
    answerInWriting: async () => {
      answers++;
      await answerGate;
      return {
        text: "I can help with that.",
        did: [],
        messages: [],
        moved: null,
      };
    },
  },
});
const { verifiedTwilioForm, handleInboundVoice } = await import(
  "../features/twilio/voice.ts"
);

function signed(path: string, fields: Record<string, string>, good = true) {
  const url = `https://assistant.example${path}`;
  const signature = twilio.getExpectedTwilioSignature(
    good ? "test-new-auth-token" : "bad-token",
    url,
    fields,
  );
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": signature,
    },
    body: new URLSearchParams(fields),
  });
}

test("Twilio webhook rejects invalid signature and accepts exact signed public URL", async () => {
  const fields = {
    AccountSid: sid,
    CallSid: callSid,
    From: "+919876543210",
    To: "+15715550123",
  };
  assert.equal(
    await verifiedTwilioForm(signed("/api/twilio/voice/start", fields, false)),
    null,
  );
  assert.equal(
    (await verifiedTwilioForm(signed("/api/twilio/voice/start", fields)))?.get(
      "CallSid",
    ),
    callSid,
  );
});

test("only configured owner can begin and a private PIN gates speech", async () => {
  const base = {
    AccountSid: sid,
    CallSid: callSid,
    From: "+919876543210",
    To: "+15715550123",
  };
  const refused = await handleInboundVoice(
    new URLSearchParams({ ...base, From: "+15559990000" }),
    "start",
  );
  assert.match(await refused.text(), /private/);
  const started = await handleInboundVoice(new URLSearchParams(base), "start");
  assert.match(await started.text(), /Enter your private PIN/);
  const wrong = await handleInboundVoice(
    new URLSearchParams({ ...base, Digits: "000000" }),
    "pin",
  );
  assert.match(await wrong.text(), /did not match/);
  const restart = await handleInboundVoice(new URLSearchParams(base), "start");
  assert.equal(restart.status, 200);
  const accepted = await handleInboundVoice(
    new URLSearchParams({ ...base, Digits: "123456" }),
    "pin",
  );
  assert.match(await accepted.text(), /Tell me what you need/);
});

test("duplicate signed speech callback is idempotent after processing", async () => {
  const otherCallSid = `CA${"c".repeat(32)}`;
  const base = {
    AccountSid: sid,
    CallSid: otherCallSid,
    From: "+919876543210",
    To: "+15715550123",
  };
  await handleInboundVoice(new URLSearchParams(base), "start");
  const pinResponse = await handleInboundVoice(
    new URLSearchParams({ ...base, Digits: "123456" }),
    "pin",
  );
  const turn = (await pinResponse.text()).match(/turn=([A-Za-z0-9_-]+)/)?.[1];
  assert.ok(turn);
  const spoken = new URLSearchParams({
    ...base,
    SpeechResult: "Hello Thursday",
  });
  const first = await handleInboundVoice(spoken, "talk", turn);
  const firstText = await first.text();
  const repeat = await handleInboundVoice(spoken, "talk", turn);
  assert.equal(await repeat.text(), firstText);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(answers, 1);
  const wait = firstText.match(/wait=([A-Za-z0-9_-]+)/)?.[1];
  assert.ok(wait);
  const heard = await handleInboundVoice(
    new URLSearchParams(base),
    "wait",
    wait,
  );
  const heardText = await heard.text();
  assert.match(heardText, /I can help with that/);
  const duplicateWait = await handleInboundVoice(
    new URLSearchParams(base),
    "wait",
    wait,
  );
  assert.equal(await duplicateWait.text(), heardText);
  const stale = await handleInboundVoice(spoken, "talk", turn);
  assert.equal(await stale.text(), firstText);
  assert.equal(answers, 1);
});

test("an API callback to the owner still requires the private PIN", async () => {
  const base = {
    AccountSid: sid,
    CallSid: `CA${"d".repeat(32)}`,
    Direction: "outbound-api",
    From: "+15715550123",
    To: "+919876543210",
  };
  const denied = await handleInboundVoice(
    new URLSearchParams({ ...base, To: "+15559990000" }),
    "start",
  );
  assert.match(await denied.text(), /private/);
  const started = await handleInboundVoice(new URLSearchParams(base), "start");
  assert.match(await started.text(), /Enter your private PIN/);
  const accepted = await handleInboundVoice(
    new URLSearchParams({ ...base, Digits: "123456" }),
    "pin",
  );
  assert.match(await accepted.text(), /Tell me what you need/);
});

test("a pending backend stays on the line and its later answer is spoken", async () => {
  let release!: () => void;
  answerGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const base = {
    AccountSid: sid,
    CallSid: `CA${"f".repeat(32)}`,
    From: "+919876543210",
    To: "+15715550123",
  };
  try {
    await handleInboundVoice(new URLSearchParams(base), "start");
    const connected = await handleInboundVoice(
      new URLSearchParams({ ...base, Digits: "123456" }),
      "pin",
    );
    const turn = (await connected.text()).match(/turn=([A-Za-z0-9_-]+)/)?.[1];
    const processing = await handleInboundVoice(
      new URLSearchParams({ ...base, SpeechResult: "Hello" }),
      "talk",
      turn,
    );
    const first = await processing.text();
    assert.match(first, /Pause length="1"/);
    const wait = first.match(/wait=([A-Za-z0-9_-]+)/)?.[1];
    const pending = await handleInboundVoice(
      new URLSearchParams(base),
      "wait",
      wait,
    );
    const pendingText = await pending.text();
    assert.match(pendingText, /Redirect/);
    assert.doesNotMatch(pendingText, /Hangup/);
    release();
    await new Promise((resolve) => setImmediate(resolve));
    const next = pendingText.match(/wait=([A-Za-z0-9_-]+)/)?.[1];
    const answer = await handleInboundVoice(
      new URLSearchParams(base),
      "wait",
      next,
    );
    assert.match(await answer.text(), /I can help with that/);
  } finally {
    release();
    answerGate = null;
  }
});

test("unrecognized speech asks once for repetition instead of silently hanging up", async () => {
  const base = {
    AccountSid: sid,
    CallSid: `CA${"1".repeat(32)}`,
    From: "+919876543210",
    To: "+15715550123",
  };
  await handleInboundVoice(new URLSearchParams(base), "start");
  const connected = await handleInboundVoice(
    new URLSearchParams({ ...base, Digits: "123456" }),
    "pin",
  );
  const prompt = await connected.text();
  assert.match(prompt, /actionOnEmptyResult="true"/);
  assert.match(prompt, /speechTimeout="2"/);
  const turn = prompt.match(/turn=([A-Za-z0-9_-]+)/)?.[1];
  const missed = await handleInboundVoice(
    new URLSearchParams(base),
    "talk",
    turn,
  );
  const repeated = await missed.text();
  assert.match(repeated, /Please say it again/);
  const next = repeated.match(/turn=([A-Za-z0-9_-]+)/)?.[1];
  assert.ok(next);
  const stopped = await handleInboundVoice(
    new URLSearchParams(base),
    "talk",
    next,
  );
  const stoppedText = await stopped.text();
  assert.match(stoppedText, /could not hear/);
  assert.doesNotMatch(stoppedText, /Gather/);
});
