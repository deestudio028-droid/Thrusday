import assert from "node:assert/strict";
import { mock, test } from "node:test";

process.env.THURSDAY_HOSTED = "1";
process.env.THURSDAY_URL = "https://assistant.example";
const values = new Map([
  ["EMAIL_ADDRESS", "helper@gmail.com"],
  ["GMAIL_OAUTH_CLIENT_ID", "test-client-id"],
  ["GMAIL_OAUTH_CLIENT_SECRET", "test-client-secret"],
]);
const readConfig = async (key: string) => values.get(key);
mock.module("../features/config/config.query.ts", {
  namedExports: {
    configFromEnv: () => false,
    readConfig,
    writeConfig: async (key: string, value: string) => {
      values.set(key, value);
    },
    removeConfig: async (key: string) => {
      values.delete(key);
    },
  },
});
let restarts = 0;
mock.module("../features/reach/reach.ts", {
  namedExports: {
    startReach: async () => {
      restarts++;
    },
  },
});
const {
  beginGmailAuthorization,
  finishGmailAuthorization,
  disconnectGmail,
  sendGmail,
  gmailRedirectUri,
} = await import("../features/reach/gmail.ts");

test("Gmail consent is short-lived, one-time, PKCE-bound and tied to the saved mailbox", async () => {
  assert.equal(
    gmailRedirectUri(),
    "https://assistant.example/api/reach/gmail/callback",
  );
  const consent = new URL(await beginGmailAuthorization());
  assert.equal(consent.origin, "https://accounts.google.com");
  assert.equal(
    consent.searchParams.get("scope"),
    "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive.readonly",
  );
  assert.equal(consent.searchParams.get("code_challenge_method"), "S256");
  const state = consent.searchParams.get("state") ?? "";
  await assert.rejects(
    finishGmailAuthorization("code", "wrong"),
    /did not match/,
  );
  await assert.rejects(
    finishGmailAuthorization("code", state),
    /did not match/,
    "a failed callback spends the state",
  );

  const accepted = new URL(await beginGmailAuthorization());
  const goodState = accepted.searchParams.get("state") ?? "";
  const oldFetch = globalThis.fetch;
  const requests: { url: string; body?: string }[] = [];
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, body: init?.body?.toString() });
    if (url.includes("/token"))
      return Response.json({
        access_token: "access-test",
        refresh_token: "refresh-test",
        expires_in: 3600,
      });
    if (url.includes("userinfo"))
      return Response.json({
        email: "not-the-mailbox@gmail.com",
        email_verified: true,
      });
    throw Error("unexpected HTTP call");
  }) as typeof fetch;
  try {
    await assert.rejects(
      finishGmailAuthorization("code", goodState),
      /must match/,
    );
    assert.equal(values.has("GMAIL_OAUTH_REFRESH_TOKEN"), false);
    const retry = new URL(await beginGmailAuthorization());
    globalThis.fetch = (async (
      input: URL | RequestInfo,
      init?: RequestInit,
    ) => {
      const url = String(input);
      requests.push({ url, body: init?.body?.toString() });
      if (url.includes("/token"))
        return Response.json({
          access_token: "access-test",
          refresh_token: "refresh-test",
          expires_in: 3600,
        });
      if (url.includes("userinfo"))
        return Response.json({
          email: "helper@gmail.com",
          email_verified: true,
        });
      throw Error("unexpected HTTP call");
    }) as typeof fetch;
    await finishGmailAuthorization(
      "code",
      retry.searchParams.get("state") ?? "",
    );
    assert.equal(values.get("GMAIL_OAUTH_REFRESH_TOKEN"), "refresh-test");
    assert.equal(restarts, 1);
    const exchange = requests.find((request) => request.url.includes("/token"));
    assert.ok(exchange?.body?.includes("code_verifier="));
    assert.ok(
      exchange?.body?.includes("redirect_uri=https%3A%2F%2Fassistant.example"),
    );
    await assert.rejects(
      finishGmailAuthorization("code", retry.searchParams.get("state") ?? ""),
      /did not match/,
    );
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("Gmail sends raw mail over HTTPS and revocation stops further sends", async () => {
  const oldFetch = globalThis.fetch;
  let sentRaw = "";
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("messages/send")) {
      sentRaw = (JSON.parse(String(init?.body)) as { raw: string }).raw;
      return Response.json({ id: "gmail-message-id" });
    }
    throw Error("unexpected HTTP call");
  }) as typeof fetch;
  try {
    assert.equal(
      await sendGmail(Buffer.from("From: helper@gmail.com\r\n\r\nhello")),
      "gmail-message-id",
    );
    assert.equal(
      Buffer.from(sentRaw, "base64url").toString(),
      "From: helper@gmail.com\r\n\r\nhello",
    );
    await disconnectGmail();
    assert.equal(values.has("GMAIL_OAUTH_REFRESH_TOKEN"), false);
    await assert.rejects(sendGmail(Buffer.from("mail")), /Connect Gmail/);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
