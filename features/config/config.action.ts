"use server";

import * as z from "zod";
import { KEY_MIN } from "@/config";
import {
  cancelChatGptDeviceSignIn,
  pollChatGptDeviceSignIn,
  startChatGptDeviceSignIn,
  startChatGptSignIn,
} from "@/features/ai/chatgpt";
import { LIVE_PROVIDER } from "@/features/ai/live.schema";
import {
  GMAIL_CLIENT_ID_KEY,
  GMAIL_CLIENT_SECRET_KEY,
  REACH_KEYS,
} from "@/features/reach/reach.schema";
import {
  CALL_OWNER_NUMBER_KEY,
  TWILIO_ACCOUNT_SID_KEY,
  TWILIO_CALLER_NUMBER_KEY,
  TWILIO_VOICE_PIN_KEY,
} from "@/features/reminder/reminder.schema";
import { keyRefusal } from "@/lib/live/live.server";
import { serverAction } from "@/lib/protocol/server-action";
import { publicError } from "@/lib/public-error";
import {
  acceptsChoice,
  CONFIG_ENTRIES,
  CONFIG_KEYS,
  envWords,
} from "./config.const";
import { configFromEnv, removeConfig, writeConfig } from "./config.query";

/** The catalogue is the allow list. */
const KeySchema = z.enum(CONFIG_KEYS as [string, ...string[]]);

/** Secrets are checked by length only; choices must be in the catalogue (`acceptsChoice`). */
export const setConfigAction = serverAction(
  async (key: unknown, value: unknown) => {
    const parsed = z
      .object({ key: KeySchema, value: z.string().trim().min(1) })
      .parse({ key, value });

    const entry = CONFIG_ENTRIES[parsed.key];
    refuseFromEnv(parsed.key);
    if (entry?.signIn) {
      publicError(`${entry.label} takes a sign-in, not a key.`);
    }
    if (entry?.choices) {
      if (!acceptsChoice(entry, parsed.value)) {
        publicError("That is not one of the options.");
      }
    } else if (
      [CALL_OWNER_NUMBER_KEY, TWILIO_CALLER_NUMBER_KEY].includes(parsed.key) &&
      !/^\+[1-9]\d{7,14}$/.test(parsed.value)
    ) {
      publicError(
        "Enter your own mobile number with country code, for example +919876543210.",
      );
    } else if (
      parsed.key === TWILIO_ACCOUNT_SID_KEY &&
      !/^AC[a-f0-9]{32}$/i.test(parsed.value)
    ) {
      publicError("Enter the Twilio Account SID from your Console.");
    } else if (
      parsed.key === TWILIO_VOICE_PIN_KEY &&
      !/^\d{6,10}$/.test(parsed.value)
    ) {
      publicError("Choose a private PIN of six to ten digits.");
    } else if (parsed.value.length < KEY_MIN) {
      publicError("That does not look like a key");
    }
    // The key a call cannot open without is asked about before it is kept: a wrong one
    // would otherwise be found out at the first call, as a call that will not open
    if (parsed.key === LIVE_PROVIDER.apiKeyName) {
      const refused = await keyRefusal(parsed.value);
      if (refused)
        publicError(`${LIVE_PROVIDER.label} did not take it — ${refused}`);
    }
    await writeConfig(parsed.key, parsed.value);
    if ([GMAIL_CLIENT_ID_KEY, GMAIL_CLIENT_SECRET_KEY].includes(parsed.key)) {
      const { clearGmailAuthorization } = await import(
        "@/features/reach/gmail"
      );
      await clearGmailAuthorization();
    }
    await tokenChanged(parsed.key);
  },
);

export const removeConfigAction = serverAction(async (key: unknown) => {
  const parsed = KeySchema.parse(key);
  refuseFromEnv(parsed);
  await removeConfig(parsed);
  if ([GMAIL_CLIENT_ID_KEY, GMAIL_CLIENT_SECRET_KEY].includes(parsed)) {
    const { clearGmailAuthorization } = await import("@/features/reach/gmail");
    await clearGmailAuthorization();
  }
  await tokenChanged(parsed);
});

/**
 * The environment wins over a row (config.query readConfig), so a write or a removal here would
 * change nothing that is used: refused in words, rather than reported done.
 */
function refuseFromEnv(key: string) {
  if (configFromEnv(key))
    publicError(envWords(CONFIG_ENTRIES[key]?.label ?? key));
}

/** A chat service's new token is listened to at once, and none is nothing to listen for (features/reach). */
async function tokenChanged(key: string) {
  if (!Object.values(REACH_KEYS).some((keys) => keys.includes(key))) return;
  const { reachChannelOf, startReach } = await import("@/features/reach/reach");
  const channel = reachChannelOf(key);
  if (channel) await startReach(channel);
}

/**
 * Starts signing in to ChatGPT and returns the page to open (ai/chatgpt). The answer lands on
 * the server, which keeps the sign-in and signals the screen (`config`).
 */
export const startChatGptSignInAction = serverAction(async () => {
  if (process.env.THURSDAY_HOSTED === "1") return startChatGptDeviceSignIn();
  return { kind: "browser" as const, url: await startChatGptSignIn() };
});

const SignInAttemptSchema = z.uuid();
export const pollChatGptDeviceSignInAction = serverAction(async (id: unknown) =>
  pollChatGptDeviceSignIn(SignInAttemptSchema.parse(id)),
);
export const cancelChatGptDeviceSignInAction = serverAction(
  async (id: unknown) =>
    cancelChatGptDeviceSignIn(SignInAttemptSchema.parse(id)),
);
