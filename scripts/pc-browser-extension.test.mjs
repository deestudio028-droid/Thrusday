import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const worker = await readFile(
  new URL("../public/pc-browser-extension/worker.js", import.meta.url),
  "utf8",
);
function harness({ allowed = true, response = null } = {}) {
  const values = {};
  const sessions = {};
  const requests = [];
  let permissionAdded;
  let messageListener;
  const storage = (data) => ({
    async get(keys) {
      return Object.fromEntries(
        (Array.isArray(keys) ? keys : [keys]).map((key) => [key, data[key]]),
      );
    },
    async set(next) {
      Object.assign(data, next);
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    },
    async clear() {
      for (const key of Object.keys(data)) delete data[key];
    },
  });
  runInNewContext(worker, {
    URL,
    setTimeout,
    chrome: {
      storage: { local: storage(values), session: storage(sessions) },
      permissions: {
        contains: async ({ origins }) =>
          allowed && origins[0] === "https://assistant.example/*",
        onAdded: {
          addListener: (listener) => {
            permissionAdded = listener;
          },
        },
      },
      runtime: {
        onMessage: {
          addListener: (listener) => {
            messageListener = listener;
          },
        },
        onStartup: { addListener() {} },
        onInstalled: { addListener() {} },
      },
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (typeof response === "function") return response(url, options);
      return response ?? new Promise(() => {});
    },
  });
  return {
    values,
    sessions,
    requests,
    granted: () => permissionAdded(),
    send: (message) =>
      new Promise((resolve) => messageListener(message, {}, resolve)),
  };
}
const key = "a".repeat(43);
test("sharing without a paired server reports the missing connection", async () => {
  const app = harness();
  const result = await app.send({ kind: "share" });
  assert.match(result.error, /Not paired/);
  assert.equal(app.sessions.tabId, undefined);
  assert.equal(app.requests.length, 0);
});

test("opening a paired popup resumes polling after a worker restart", async () => {
  const app = harness();
  app.values.pairedKey = key;
  app.values.serverOrigin = "https://assistant.example";
  await app.send({ kind: "status" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.requests.length, 1);
});
test("permission grant completes pairing even after the popup closes", async () => {
  const app = harness();
  app.values.pendingPair = { key, serverOrigin: "https://assistant.example" };
  await app.granted();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.values.pairedKey, key);
  assert.equal(app.values.pendingPair, undefined);
  assert.equal(app.sessions.paused, true);
  assert.equal(
    app.requests[0].url,
    "https://assistant.example/api/pc-browser/bridge",
  );
  assert.equal(app.requests[0].options.headers["x-thursday-ready"], "0");
  assert.equal(
    app.requests[0].options.headers["ngrok-skip-browser-warning"],
    "1",
  );
});
test("unapproved origins and non-HTTPS origins cannot pair", async () => {
  for (const allowed of [false, true]) {
    const app = harness({ allowed });
    app.values.pendingPair = {
      key,
      serverOrigin: allowed
        ? "http://assistant.example"
        : "https://assistant.example",
    };
    await app.granted();
    assert.equal(app.values.pairedKey, undefined);
    assert.equal(app.requests.length, 0);
  }
});
test("a rejected key is forgotten and the popup explains how to reconnect", async () => {
  const app = harness({ response: { status: 401 } });
  const paired = await app.send({
    kind: "pair",
    key,
    serverOrigin: "https://assistant.example",
  });
  assert.ok(paired.message.startsWith("Paired"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.values.pairedKey, undefined);
  const status = await app.send({ kind: "status" });
  assert.match(status.message, /rejected this key/);
});

test("an old poll rejection cannot erase a newly paired key", async () => {
  let rejectOld;
  let requests = 0;
  const app = harness({
    response: () => {
      requests++;
      return new Promise((resolve) => {
        if (requests === 1) rejectOld = resolve;
      });
    },
  });
  await app.send({
    kind: "pair",
    key,
    serverOrigin: "https://assistant.example",
  });
  await new Promise((resolve) => setImmediate(resolve));
  const replacement = "b".repeat(43);
  await app.send({
    kind: "pair",
    key: replacement,
    serverOrigin: "https://assistant.example",
  });
  rejectOld({ status: 401 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.values.pairedKey, replacement);
  assert.equal(app.values.pairingError, undefined);
  assert.equal(app.requests.length, 2);
});
