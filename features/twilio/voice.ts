import { randomBytes, timingSafeEqual } from "node:crypto";
import type { ModelMessage } from "ai";
import twilio from "twilio";
import { APP_URL, PHONE_TURN } from "@/config";
import { readConfig } from "@/features/config/config.query";
import {
  CALL_OWNER_NUMBER_KEY,
  TWILIO_ACCOUNT_SID_KEY,
  TWILIO_AUTH_TOKEN_KEY,
  TWILIO_CALLER_NUMBER_KEY,
  TWILIO_VOICE_PIN_KEY,
} from "@/features/reminder/reminder.schema";

const endpoint = "/api/twilio/voice";
const xml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const say = (words: string) => `<Say>${xml(words)}</Say>`;
const respond = (content: string) =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${content}</Response>`,
    {
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "cache-control": "private, no-store",
      },
    },
  );

type Session = {
  started: number;
  authenticated: boolean;
  turns: number;
  waits: number;
  hops: number;
  expectedTurn?: string;
  usedTurns: Set<string>;
  expectedWait?: string;
  waitReplies: Map<string, string>;
  talkReply?: string;
  abort?: AbortController;
  callId?: string;
  standing?: string | null;
  messages: ModelMessage[];
  pending: boolean;
  answer?: string;
  missedSpeech?: number;
  backend?: Promise<typeof import("@/features/thursday/thursday.text")>;
  answered?: Promise<void>;
  answerReady?: () => void;
};
const sessions = new Map<string, Session>();
const nonce = () => randomBytes(12).toString("base64url");
const gather = (session: Session, prompt: string) => {
  session.expectedTurn = nonce();
  return `<Gather input="speech" timeout="${PHONE_TURN.speechStartSeconds}" speechTimeout="${PHONE_TURN.speechPauseSeconds}" actionOnEmptyResult="true" action="${endpoint}/talk?turn=${session.expectedTurn}" method="POST">${say(prompt)}</Gather><Hangup/>`;
};
const waiting = (session: Session) => {
  session.expectedWait = nonce();
  return `<Pause length="${PHONE_TURN.waitSeconds}"/><Redirect method="POST">${endpoint}/wait?wait=${session.expectedWait}</Redirect>`;
};
function endSession(id: string) {
  sessions.get(id)?.abort?.abort();
  sessions.delete(id);
}
setInterval(() => {
  for (const [id, session] of sessions)
    if (Date.now() - session.started > 10 * 60_000) endSession(id);
}, 60_000).unref();

/** Twilio signs the exact public URL and every form field, including future fields. */
export async function verifiedTwilioForm(
  request: Request,
): Promise<URLSearchParams | null> {
  const token = await readConfig(TWILIO_AUTH_TOKEN_KEY);
  if (
    !token ||
    request.headers.get("content-type")?.split(";")[0] !==
      "application/x-www-form-urlencoded"
  )
    return null;
  if (Number(request.headers.get("content-length") ?? 0) > 20_000) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  let raw = "";
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
    if (raw.length > 20_000) {
      await reader.cancel();
      return null;
    }
  }
  raw += decoder.decode();
  const form = new URLSearchParams(raw);
  const params = Object.fromEntries(form);
  const signature = request.headers.get("x-twilio-signature") ?? "";
  const url = new URL(request.url);
  const publicUrl = new URL(`${url.pathname}${url.search}`, APP_URL).href;
  return twilio.validateRequest(token, signature, publicUrl, params)
    ? form
    : null;
}

const same = (a: string, b: string) =>
  /^\d{6,10}$/.test(a) &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function handleInboundVoice(
  form: URLSearchParams,
  step: "start" | "pin" | "talk" | "wait",
  requestToken?: string | null,
) {
  const [sid, owner, caller, pin] = await Promise.all([
    readConfig(TWILIO_ACCOUNT_SID_KEY),
    readConfig(CALL_OWNER_NUMBER_KEY),
    readConfig(TWILIO_CALLER_NUMBER_KEY),
    readConfig(TWILIO_VOICE_PIN_KEY),
  ]);
  const callSid = form.get("CallSid") ?? "";
  const ownerLeg =
    form.get("Direction") === "outbound-api"
      ? form.get("From") === caller && form.get("To") === owner
      : form.get("From") === owner && form.get("To") === caller;
  if (
    !sid ||
    !owner ||
    !caller ||
    !pin ||
    !/^CA[a-f0-9]{32}$/i.test(callSid) ||
    form.get("AccountSid") !== sid ||
    !ownerLeg
  )
    return respond(`${say("This number is private.")}<Hangup/>`);
  const now = Date.now();
  let session = sessions.get(callSid);
  if (step === "start") {
    if (session?.authenticated)
      return respond(`${say("This call has already started.")}<Hangup/>`);
    if (session)
      return respond(
        `<Gather input="dtmf" numDigits="${pin.length}" timeout="${PHONE_TURN.pinSeconds}" action="${endpoint}/pin" method="POST">${say("Thursday here. Enter your private PIN.")}</Gather><Hangup/>`,
      );
    if (sessions.size >= 100)
      return respond(
        `${say("The call line is busy. Try again later.")}<Hangup/>`,
      );
    session = {
      started: now,
      authenticated: false,
      turns: 0,
      waits: 0,
      hops: 1,
      usedTurns: new Set(),
      waitReplies: new Map(),
      messages: [],
      pending: false,
    };
    sessions.set(callSid, session);
    return respond(
      `<Gather input="dtmf" numDigits="${pin.length}" timeout="${PHONE_TURN.pinSeconds}" action="${endpoint}/pin" method="POST">${say("Thursday here. Enter your private PIN.")}</Gather><Hangup/>`,
    );
  }
  if (!session || now - session.started > 10 * 60_000) {
    endSession(callSid);
    return respond(`${say("This call has ended.")}<Hangup/>`);
  }
  if (step === "pin") {
    if (session.authenticated)
      return respond(`${say("This step was already completed.")}<Hangup/>`);
    if (!same(form.get("Digits") ?? "", pin)) {
      endSession(callSid);
      return respond(`${say("The PIN did not match.")}<Hangup/>`);
    }
    session.authenticated = true;
    // Load the backend while the owner hears the prompt and speaks, before the
    // first answer's deadline starts. This does not start a model request.
    session.backend = import("@/features/thursday/thursday.text");
    void session.backend.catch(() => {});
    session.hops++;
    return respond(
      gather(session, "You are connected. Tell me what you need."),
    );
  }
  if (!session.authenticated) {
    endSession(callSid);
    return respond(`${say("This call has ended.")}<Hangup/>`);
  }
  if (step === "wait") {
    const token = requestToken ?? "";
    if (session.waitReplies.has(token))
      return respond(session.waitReplies.get(token)!);
    if (!token || token !== session.expectedWait)
      return respond(`${say("This call step expired.")}<Hangup/>`);
    session.hops++;
    if (session.hops >= 9) {
      endSession(callSid);
      return respond(
        `${say("The trial call has reached its turn limit. Please continue in the app.")}<Hangup/>`,
      );
    }
    if (session.pending && session.answer === undefined && session.answered) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        session.answered,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, PHONE_TURN.callbackWaitMs);
        }),
      ]);
      clearTimeout(timer);
      if (sessions.get(callSid) !== session)
        return respond(`${say("This call has ended.")}<Hangup/>`);
    }
    let content: string;
    if (session.answer !== undefined) {
      const answer = session.answer.slice(0, 650);
      session.answer = undefined;
      session.pending = false;
      if (session.turns >= 2) {
        content = `${say(answer)}<Hangup/>`;
        session.waitReplies.set(token, content);
        endSession(callSid);
        return respond(content);
      }
      content = gather(session, answer);
      session.waitReplies.set(token, content);
      return respond(content);
    }
    if (!session.pending || ++session.waits > 4) {
      endSession(callSid);
      return respond(
        `${say("This answer is taking too long for the trial call. Please check the app for it.")}<Hangup/>`,
      );
    }
    content = waiting(session);
    session.waitReplies.set(token, content);
    return respond(content);
  }
  const turn = requestToken ?? "";
  if (session.usedTurns.has(turn))
    return respond(
      session.talkReply ?? `${say("Already processing this turn.")}<Hangup/>`,
    );
  if (!turn || turn !== session.expectedTurn)
    return respond(`${say("This call step expired.")}<Hangup/>`);
  session.usedTurns.add(turn);
  session.hops++;
  if (session.pending)
    return respond(
      session.talkReply ?? `${say("Already processing this turn.")}<Hangup/>`,
    );
  const spoken = form.get("SpeechResult")?.trim().slice(0, 1000);
  if (!spoken) {
    session.missedSpeech = (session.missedSpeech ?? 0) + 1;
    if (session.missedSpeech > 1 || session.hops >= 9) {
      endSession(callSid);
      return respond(
        `${say("I could not hear you. Please continue in the app.")}<Hangup/>`,
      );
    }
    session.talkReply = gather(
      session,
      "I did not catch that. Please say it again after this prompt.",
    );
    return respond(session.talkReply);
  }
  if (++session.turns > 2) {
    endSession(callSid);
    return respond(
      `${say("This trial call has reached its conversation limit.")}<Hangup/>`,
    );
  }
  session.pending = true;
  session.waits = 0;
  session.abort = new AbortController();
  const current = session;
  current.answered = new Promise<void>((resolve) => {
    current.answerReady = resolve;
  });
  const signal = AbortSignal.any([
    AbortSignal.timeout(PHONE_TURN.answerMs),
    current.abort!.signal,
  ]);
  void (async () => {
    const { openTextCall, answerInWriting } = await (current.backend ??
      import("@/features/thursday/thursday.text"));
    signal.throwIfAborted();
    if (!current.callId) {
      const opened = await openTextCall();
      current.callId = opened.callId;
      current.standing = opened.standing;
    }
    const result = await answerInWriting({
      callId: current.callId,
      standing: current.standing ?? null,
      messages: [...current.messages, { role: "user", content: spoken }],
      said: spoken,
      signal,
      spoken: true,
    });
    current.messages = result.messages;
    if (sessions.get(callSid) === current)
      current.answer =
        result.text
          .replace(
            /\p{Extended_Pictographic}|\p{Emoji_Modifier}|[\u200D\uFE0F]/gu,
            "",
          )
          .trim() || "I completed the request. Check the app for the details.";
  })()
    .catch(() => {
      if (sessions.get(callSid) === current)
        current.answer =
          "I could not finish that in this call. Please check the app.";
    })
    .finally(() => current.answerReady?.());
  session.talkReply = waiting(session);
  return respond(session.talkReply);
}
