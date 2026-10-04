import assert from "node:assert/strict";
import { test } from "node:test";
import { CHATGPT_DEVICE_SIGN_IN } from "../config.ts";
import {
  CHATGPT_DEVICE_REDIRECT,
  CHATGPT_DEVICE_URL,
  pollChatGptDeviceCode,
  requestChatGptDeviceCode,
} from "../lib/chatgpt-device.ts";

test("remote sign-in requests only a fresh one-time code", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls += 1;
    assert.equal(
      String(input),
      "https://auth.openai.com/api/accounts/deviceauth/usercode",
    );
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      client_id: "public-client",
    });
    return Response.json({
      device_auth_id: "server-grant",
      user_code: "ABCD-EFGH",
      interval: 2,
    });
  };
  const code = await requestChatGptDeviceCode("public-client");
  assert.equal(calls, 1);
  assert.equal(code.deviceAuthId, "server-grant");
  assert.equal(code.userCode, "ABCD-EFGH");
  assert.equal(
    code.intervalMs,
    Math.max(CHATGPT_DEVICE_SIGN_IN.minPollMs, 2_000),
  );
  assert.equal(CHATGPT_DEVICE_URL, "https://auth.openai.com/codex/device");
  assert.equal(
    CHATGPT_DEVICE_REDIRECT,
    "https://auth.openai.com/deviceauth/callback",
  );
});

test("remote approval stays pending until the native device endpoint grants it", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const statuses = [403, 404, 200];
  globalThis.fetch = async (input, init) => {
    assert.equal(
      String(input),
      "https://auth.openai.com/api/accounts/deviceauth/token",
    );
    assert.deepEqual(JSON.parse(String(init?.body)), {
      device_auth_id: "server-grant",
      user_code: "ABCD-EFGH",
    });
    const status = statuses.shift();
    return status === 200
      ? Response.json({
          authorization_code: "one-time-authorization",
          code_verifier: "pkce-proof",
        })
      : new Response(null, { status });
  };
  const code = {
    deviceAuthId: "server-grant",
    userCode: "ABCD-EFGH",
    intervalMs: 5_000,
  };
  assert.equal(await pollChatGptDeviceCode(code), null);
  assert.equal(await pollChatGptDeviceCode(code), null);
  assert.deepEqual(await pollChatGptDeviceCode(code), {
    authorizationCode: "one-time-authorization",
    verifier: "pkce-proof",
  });
});

test("remote sign-in refuses incomplete provider answers", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async () => Response.json({ user_code: "ABCD-EFGH" });
  await assert.rejects(
    requestChatGptDeviceCode("public-client"),
    /incomplete device sign-in/,
  );
  globalThis.fetch = async () =>
    Response.json({ authorization_code: "one-time-authorization" });
  await assert.rejects(
    pollChatGptDeviceCode({
      deviceAuthId: "server-grant",
      userCode: "ABCD-EFGH",
      intervalMs: 5_000,
    }),
    /incomplete device approval/,
  );
});
