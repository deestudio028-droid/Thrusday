import {
  googleAccessToken,
  invalidateGoogleAccessToken,
} from "@/features/reach/gmail";
import { publicError } from "@/lib/public-error";

/** Fixed Google API origins only. Never accept a model-provided URL. */
export async function googleResponse(
  service: "calendar" | "drive",
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  if (!path.startsWith("/") || path.startsWith("//"))
    throw new Error("Google API path must be relative");
  const origin =
    service === "calendar"
      ? "https://www.googleapis.com/calendar/v3"
      : "https://www.googleapis.com/drive/v3";
  const token = await googleAccessToken();
  const response = await fetch(`${origin}${path}`, {
    ...options,
    headers: { authorization: `Bearer ${token}`, ...(options.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 401) {
    invalidateGoogleAccessToken();
    publicError(
      "Google access expired or was revoked. Reconnect Google in Settings › Phone.",
    );
  }
  if (!response.ok)
    publicError(
      `${service === "calendar" ? "Calendar" : "Drive"} rejected the request (${response.status}).`,
    );
  return response;
}

export async function googleRequest<T>(
  service: "calendar" | "drive",
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await googleResponse(service, path, options);
  return response.status === 204
    ? (null as T)
    : (response.json() as Promise<T>);
}
