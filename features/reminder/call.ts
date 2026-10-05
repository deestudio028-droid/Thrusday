import { and, count, eq, gte, inArray } from "drizzle-orm";
import { APP_URL, REMINDER } from "@/config";
import { database } from "@/database/db";
import { reminderDeliveryTable } from "@/database/tables";
import { readConfig } from "@/features/config/config.query";
import { publicError } from "@/lib/public-error";
import {
  CALL_MONTHLY_CAP_KEY,
  CALL_OWNER_NUMBER_KEY,
  TWILIO_ACCOUNT_SID_KEY,
  TWILIO_AUTH_TOKEN_KEY,
  TWILIO_CALLER_NUMBER_KEY,
} from "./reminder.schema";

/** A bounded owner-only PSTN provider. This is never enabled by default. */
export async function callSetup() {
  const [phone, sid, token, caller, cap] = await Promise.all([
    readConfig(CALL_OWNER_NUMBER_KEY),
    readConfig(TWILIO_ACCOUNT_SID_KEY),
    readConfig(TWILIO_AUTH_TOKEN_KEY),
    readConfig(TWILIO_CALLER_NUMBER_KEY),
    readConfig(CALL_MONTHLY_CAP_KEY),
  ]);
  const limit = Number(cap || 0);
  return {
    phone,
    sid,
    token,
    caller,
    limit: Number.isInteger(limit) && limit >= 0 && limit <= 30 ? limit : 0,
    ready: Boolean(
      phone &&
        sid &&
        token &&
        caller &&
        limit > 0 &&
        /^\+[1-9]\d{7,14}$/.test(phone) &&
        /^\+[1-9]\d{7,14}$/.test(caller) &&
        /^AC[a-f0-9]{32}$/i.test(sid),
    ),
  };
}

/** Submitted and uncertain attempts count against a conservative rolling 31-day cap. */
export async function callBudgetStatus(now = new Date()) {
  const { limit, ready } = await callSetup();
  const [{ used }] = await database
    .select({ used: count() })
    .from(reminderDeliveryTable)
    .where(
      and(
        eq(reminderDeliveryTable.channel, "call"),
        inArray(reminderDeliveryTable.status, [
          "dispatching",
          "accepted",
          "unknown",
        ]),
        gte(
          reminderDeliveryTable.startedAt,
          new Date(now.getTime() - REMINDER.callBudgetWindowMs),
        ),
      ),
    );
  return { limit, used, remaining: Math.max(0, limit - used), ready };
}

/** Provider acceptance only: it does not prove the person answered or heard the call. */
export async function placeOwnerCall(
  words: string,
  now: Date,
  reminderId: string,
  conversation = false,
): Promise<{ sid: string; status: string }> {
  const setup = await callSetup();
  if (
    !setup.ready ||
    !setup.phone ||
    !setup.sid ||
    !setup.token ||
    !setup.caller
  )
    publicError(
      "Connect the owner-only call provider and set a monthly cap in Settings before calls can start.",
    );
  const [reserved] = await database
    .select()
    .from(reminderDeliveryTable)
    .where(
      and(
        eq(reminderDeliveryTable.reminderId, reminderId),
        eq(reminderDeliveryTable.channel, "call"),
        eq(reminderDeliveryTable.status, "dispatching"),
      ),
    );
  if (!reserved) publicError("This call has no active reminder reservation.");
  // A rolling 31-day window is conservative across month boundaries and provider billing dates.
  const { used } = await callBudgetStatus(now);
  if (used > setup.limit)
    publicError(
      `The ${setup.limit}-call monthly safety cap is reached; this reminder will not dial.`,
    );
  const safeWords = words
    .slice(0, REMINDER.callWords)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  const body = new URLSearchParams({
    To: setup.phone,
    From: setup.caller,
    Twiml: `<Response><Say>${safeWords}</Say><Hangup/></Response>`,
    StatusCallback: new URL("/api/twilio/voice/status", APP_URL).href,
    StatusCallbackMethod: "POST",
    StatusCallbackEvent: "completed",
    TimeLimit: "120",
  });
  if (conversation) {
    body.delete("Twiml");
    body.set("Url", new URL("/api/twilio/voice/start", APP_URL).href);
    body.set("Method", "POST");
  }
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${setup.sid}/Calls.json`,
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${Buffer.from(`${setup.sid}:${setup.token}`).toString("base64")}`,
      },
      body,
      signal: AbortSignal.timeout(REMINDER.dispatchMs),
    },
  );
  if (!response.ok) {
    if (response.status >= 400 && response.status < 500)
      publicError(
        `Twilio rejected the call request (${response.status}); check the trial, recipient verification and geographic permissions. No automatic repeat will be attempted.`,
      );
    throw new Error(
      `Call provider returned ${response.status}; outcome uncertain`,
    );
  }
  const receipt = (await response.json()) as { sid?: string; status?: string };
  if (!receipt.sid || !/^CA[a-f0-9]{32}$/i.test(receipt.sid))
    throw new Error(
      "Twilio returned an invalid call receipt; outcome uncertain",
    );
  return { sid: receipt.sid, status: receipt.status ?? "queued" };
}
