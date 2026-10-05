import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { APP_URL, REACH } from "@/config";
import {
  configFromEnv,
  readConfig,
  removeConfig,
  writeConfig,
} from "@/features/config/config.query";
import { publicError } from "@/lib/public-error";
import {
  EMAIL_ADDRESS_KEY,
  GMAIL_CLIENT_ID_KEY,
  GMAIL_CLIENT_SECRET_KEY,
  GMAIL_REFRESH_TOKEN_KEY,
} from "./reach.schema";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.readonly",
];
const SCOPE = SCOPES.join(" ");
const CALLBACK_PATH = "/api/reach/gmail/callback";
type Pending = { digest: Buffer; verifier: string; until: number };
type GmailState = {
  pending: Pending | null;
  access: { token: string; until: number } | null;
};
const state = ((
  globalThis as typeof globalThis & { thursdayGmail?: GmailState }
).thursdayGmail ??= {
  pending: null,
  access: null,
});

export const gmailRedirectUri = () => new URL(CALLBACK_PATH, APP_URL).href;
const encoded = (bytes: Buffer) => bytes.toString("base64url");
const digest = (value: string) => createHash("sha256").update(value).digest();

async function client() {
  const id = await readConfig(GMAIL_CLIENT_ID_KEY);
  const secret = await readConfig(GMAIL_CLIENT_SECRET_KEY);
  if (!id || !secret)
    publicError(
      "Add the Gmail OAuth web client ID and secret in Settings › API keys first.",
    );
  return { id, secret };
}

/** Begun only by the authenticated, same-origin Settings action. */
export async function beginGmailAuthorization(): Promise<string> {
  if (process.env.THURSDAY_HOSTED !== "1")
    publicError(
      "This Gmail HTTPS connection is for the hosted Thursday instance.",
    );
  const address = await readConfig(EMAIL_ADDRESS_KEY);
  if (!address?.toLowerCase().endsWith("@gmail.com"))
    publicError(
      "Save a Gmail mailbox in Settings › Phone before connecting Gmail.",
    );
  const { id } = await client();
  const csrf = encoded(randomBytes(32));
  const verifier = encoded(randomBytes(32));
  state.pending = {
    digest: digest(csrf),
    verifier,
    until: Date.now() + REACH.gmailAuthMs,
  };
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", id);
  url.searchParams.set("redirect_uri", gmailRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", csrf);
  url.searchParams.set("code_challenge", encoded(digest(verifier)));
  url.searchParams.set("code_challenge_method", "S256");
  return url.href;
}

async function tokenRequest(
  params: URLSearchParams,
): Promise<Record<string, unknown>> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params,
    signal: AbortSignal.timeout(REACH.gmailHttpMs),
  });
  if (!response.ok)
    publicError(
      `Gmail authorization failed (${response.status}). Reconnect Gmail in Settings.`,
    );
  return (await response.json()) as Record<string, unknown>;
}

/** The one-time OAuth callback; the state is consumed even if Google rejects the code. */
export async function finishGmailAuthorization(
  code: string,
  csrf: string,
): Promise<void> {
  const pending = state.pending;
  state.pending = null;
  const supplied = digest(csrf);
  if (
    !pending ||
    pending.until < Date.now() ||
    !timingSafeEqual(pending.digest, supplied)
  )
    publicError(
      "Gmail connection expired or did not match. Start it again in Settings.",
    );
  if (!code || code.length > 4096)
    publicError("Google did not return a usable authorization code.");
  const { id, secret } = await client();
  const token = await tokenRequest(
    new URLSearchParams({
      code,
      client_id: id,
      client_secret: secret,
      redirect_uri: gmailRedirectUri(),
      grant_type: "authorization_code",
      code_verifier: pending.verifier,
    }),
  );
  if (
    typeof token.access_token !== "string" ||
    typeof token.refresh_token !== "string"
  )
    publicError(
      "Google did not grant offline Gmail access. Reconnect and allow the requested access.",
    );
  if (typeof token.scope === "string") {
    const granted = new Set(token.scope.split(" "));
    if (SCOPES.some((scope) => !granted.has(scope)))
      publicError(
        "Google did not grant every requested service. Reconnect and allow Gmail, Calendar and Drive access.",
      );
  }
  const profile = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { authorization: `Bearer ${token.access_token}` },
    signal: AbortSignal.timeout(REACH.gmailHttpMs),
  });
  if (!profile.ok) publicError("Google could not confirm the Gmail account.");
  const owner = (await profile.json()) as {
    email?: string;
    email_verified?: boolean;
  };
  const mailbox = await readConfig(EMAIL_ADDRESS_KEY);
  if (
    !owner.email_verified ||
    owner.email?.toLowerCase() !== mailbox?.toLowerCase()
  )
    publicError(
      "The Google account must match Thursday's saved Gmail mailbox.",
    );
  await writeConfig(GMAIL_REFRESH_TOKEN_KEY, token.refresh_token);
  state.access = {
    token: token.access_token,
    until: Date.now() + Number(token.expires_in ?? 3600) * 1000,
  };
  const { startReach } = await import("./reach");
  await startReach("email");
}

export async function clearGmailAuthorization(): Promise<void> {
  if (configFromEnv(GMAIL_REFRESH_TOKEN_KEY))
    publicError(
      "Gmail authorization is set by this server's environment and cannot be changed in Settings.",
    );
  state.pending = null;
  state.access = null;
  await removeConfig(GMAIL_REFRESH_TOKEN_KEY);
}

export async function disconnectGmail(): Promise<void> {
  await clearGmailAuthorization();
  const { startReach } = await import("./reach");
  await startReach("email");
}

export async function gmailConnected() {
  return Boolean(await readConfig(GMAIL_REFRESH_TOKEN_KEY));
}

export async function googleAccessToken(): Promise<string> {
  if (
    state.access &&
    state.access.until - Date.now() > REACH.gmailTokenMarginMs
  )
    return state.access.token;
  const refresh = await readConfig(GMAIL_REFRESH_TOKEN_KEY);
  if (!refresh)
    publicError(
      "Connect Gmail in Settings › Phone to send mail from this hosted server.",
    );
  const { id, secret } = await client();
  const token = await tokenRequest(
    new URLSearchParams({
      client_id: id,
      client_secret: secret,
      refresh_token: refresh,
      grant_type: "refresh_token",
    }),
  );
  if (typeof token.access_token !== "string")
    publicError(
      "Gmail access was revoked. Reconnect Gmail in Settings › Phone.",
    );
  state.access = {
    token: token.access_token,
    until: Date.now() + Number(token.expires_in ?? 3600) * 1000,
  };
  return state.access.token;
}

export function invalidateGoogleAccessToken() {
  state.access = null;
}

/** Gmail accepts raw RFC 5322 mail over HTTPS, avoiding the host's blocked SMTP ports. */
export async function sendGmail(raw: Buffer): Promise<string | null> {
  const token = await googleAccessToken();
  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ raw: raw.toString("base64url") }),
      signal: AbortSignal.timeout(REACH.gmailHttpMs),
    },
  );
  if (response.status === 401) {
    state.access = null;
    publicError(
      "Gmail access was revoked. Reconnect Gmail in Settings › Phone.",
    );
  }
  if (!response.ok)
    publicError(`Gmail could not send the mail (${response.status}).`);
  const sent = (await response.json()) as { id?: string };
  return sent.id ?? null;
}
