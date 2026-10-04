import { CHATGPT_DEVICE_SIGN_IN } from "@/config";
import { publicError } from "@/lib/public-error";

/** Protocol used by openai/codex codex-rs/login/src/device_code_auth.rs. */
const DEVICE_BASE = "https://auth.openai.com/api/accounts/deviceauth";
export const CHATGPT_DEVICE_URL = "https://auth.openai.com/codex/device";
export const CHATGPT_DEVICE_REDIRECT =
  "https://auth.openai.com/deviceauth/callback";

export type ChatGptDeviceCode = {
  /** Server-held grant ID, never sent to the browser. */
  deviceAuthId: string;
  userCode: string;
  intervalMs: number;
};

/** Only the user-started code is returned. No existing account/cache is read. */
export async function requestChatGptDeviceCode(
  clientId: string,
): Promise<ChatGptDeviceCode> {
  const response = await fetch(`${DEVICE_BASE}/usercode`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId }),
    signal: AbortSignal.timeout(CHATGPT_DEVICE_SIGN_IN.requestMs),
  }).catch(() =>
    publicError(
      "Could not reach ChatGPT's device sign-in. Try again once the connection is available.",
    ),
  );
  if (!response.ok)
    publicError(
      `ChatGPT could not start device sign-in (${response.status}). Enable device code login in your ChatGPT Security settings, then try again.`,
    );
  const body = (await response.json().catch(() => null)) as {
    device_auth_id?: unknown;
    user_code?: unknown;
    usercode?: unknown;
    interval?: unknown;
  } | null;
  const userCode = body?.user_code ?? body?.usercode;
  const interval = Number(body?.interval ?? 1);
  if (
    typeof body?.device_auth_id !== "string" ||
    !body.device_auth_id ||
    typeof userCode !== "string" ||
    !userCode ||
    !Number.isFinite(interval) ||
    interval < 0
  ) {
    publicError(
      "ChatGPT returned an incomplete device sign-in. Start a fresh attempt.",
    );
  }
  return {
    deviceAuthId: body.device_auth_id,
    userCode,
    intervalMs: Math.max(CHATGPT_DEVICE_SIGN_IN.minPollMs, interval * 1000),
  };
}

/** 403/404 are pending according to the native client, bounded by its 15-minute lifetime. */
export async function pollChatGptDeviceCode(code: ChatGptDeviceCode): Promise<{
  authorizationCode: string;
  verifier: string;
} | null> {
  const response = await fetch(`${DEVICE_BASE}/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      device_auth_id: code.deviceAuthId,
      user_code: code.userCode,
    }),
    signal: AbortSignal.timeout(CHATGPT_DEVICE_SIGN_IN.requestMs),
  }).catch(() =>
    publicError(
      "The ChatGPT sign-in connection dropped. Cancel this attempt and start a fresh one.",
    ),
  );
  if (response.status === 403 || response.status === 404) return null;
  if (!response.ok)
    publicError(
      `ChatGPT device sign-in failed (${response.status}). Start a fresh attempt.`,
    );
  const body = (await response.json().catch(() => null)) as {
    authorization_code?: unknown;
    code_verifier?: unknown;
  } | null;
  if (
    typeof body?.authorization_code !== "string" ||
    !body.authorization_code ||
    typeof body.code_verifier !== "string" ||
    !body.code_verifier
  ) {
    publicError(
      "ChatGPT returned an incomplete device approval. Start a fresh attempt.",
    );
  }
  return {
    authorizationCode: body.authorization_code,
    verifier: body.code_verifier,
  };
}
