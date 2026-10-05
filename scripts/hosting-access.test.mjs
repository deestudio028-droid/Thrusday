import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";
import {
  createGateway,
  hashPassword,
  readConfiguration,
} from "../hosting/access-gateway.mjs";

const password = "gateway-test-password-with-enough-length";
const passwordHash = await hashPassword(password);
const origin = "https://assistant.example";
const host = "assistant.example";
const baseEnv = {
  APP_PUBLIC_ORIGIN: origin,
  APP_PASSWORD_HASH: passwordHash,
  SESSION_SECRET: randomBytes(48).toString("base64url"),
};

async function fixture(t, handler = (_req, res) => res.end("private app")) {
  const sockets = new Set();
  const upstream = http.createServer(handler);
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const { server } = createGateway({
    env: { ...baseEnv, INTERNAL_PORT: String(upstream.address().port) },
  });
  for (const instance of [upstream, server])
    instance.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await Promise.all([
      new Promise((resolve) => server.close(resolve)),
      new Promise((resolve) => upstream.close(resolve)),
    ]);
  });
  function request(path, { method = "GET", headers = {}, body = "" } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method,
          headers: { host, ...headers },
          agent: false,
        },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks).toString("utf8"),
            }),
          );
          res.on("error", reject);
        },
      );
      req.on("error", reject);
      req.end(body);
    });
  }
  async function login(extra = {}) {
    const result = await request("/__auth/login", {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/x-www-form-urlencoded",
        ...extra,
      },
      body: new URLSearchParams({ password }).toString(),
    });
    assert.equal(result.status, 303);
    return { cookie: result.headers["set-cookie"][0].split(";")[0], result };
  }
  return { server, upstream, port, request, login };
}

test("configuration fails closed for missing secrets, invalid hashes and non-HTTPS origins", () => {
  for (const env of [
    {},
    { ...baseEnv, SESSION_SECRET: "" },
    { ...baseEnv, APP_PASSWORD_HASH: "plaintext" },
    { ...baseEnv, APP_PUBLIC_ORIGIN: "http://assistant.example" },
    { ...baseEnv, APP_PUBLIC_ORIGIN: `${origin}/private` },
    {
      ...baseEnv,
      APP_PUBLIC_ORIGIN: "https://user:password@assistant.example",
    },
    { ...baseEnv, INTERNAL_PORT: "0" },
    { ...baseEnv, SESSION_MAX_AGE_SECONDS: "999999999" },
  ])
    assert.throws(() => readConfiguration(env));
  assert.equal(readConfiguration(baseEnv).publicOrigin, origin);
});

test("every private route is denied without a session; public health checks the app", async (t) => {
  let calls = 0;
  const f = await fixture(t, (_req, res) => {
    calls += 1;
    res.end("private app");
  });
  for (const path of [
    "/",
    "/api/config",
    "/api/events",
    "/api/file/private",
    "/_next/static/chunk.js",
  ]) {
    assert.equal((await f.request(path)).status, 401);
  }
  assert.equal(calls, 0);
  assert.equal(
    (
      await f.request("/", {
        headers: { host: "attacker.example", "x-forwarded-host": host },
      })
    ).status,
    421,
  );
  const health = await f.request("/healthz", {
    headers: { host: "healthcheck.railway.app" },
  });
  assert.equal(health.status, 200);
  assert.deepEqual(JSON.parse(health.body), { status: "ok" });
  await new Promise((resolve) => f.upstream.close(resolve));
  assert.equal((await f.request("/healthz")).status, 503);
});

test("only static information pages are public; methods and private lookalikes stay protected", async (t) => {
  const f = await fixture(t);
  for (const path of ["/about", "/privacy", "/terms"])
    assert.equal((await f.request(path)).status, 200);
  assert.equal((await f.request("/privacy/private")).status, 401);
  assert.equal((await f.request("/privacy", { method: "POST" })).status, 403);
  assert.equal(
    (await f.request("/privacy", { headers: { host: "attacker.example" } }))
      .status,
    421,
  );
});

test("login requires an exact origin, sets a secure session, and logout revokes it", async (t) => {
  const f = await fixture(t);
  for (const path of ["/", "/__auth/login"]) {
    const page = await f.request(path, { headers: { accept: "text/html" } });
    assert.equal(page.headers["referrer-policy"], "same-origin");
    assert.match(page.body, /<form action="\/__auth\/login" method="post">/);
  }
  const form = {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password }).toString(),
  };
  assert.equal((await f.request("/__auth/login", form)).status, 403);
  assert.equal(
    (
      await f.request("/__auth/login", {
        ...form,
        headers: { ...form.headers, origin: "https://attacker.example" },
      })
    ).status,
    403,
  );
  const wrongPassword = await f.request("/__auth/login", {
    ...form,
    headers: { ...form.headers, origin },
    body: "password=incorrect",
  });
  assert.equal(wrongPassword.status, 401);
  assert.equal(wrongPassword.headers["referrer-policy"], "same-origin");
  const { cookie, result } = await f.login();
  assert.match(
    result.headers["set-cookie"][0],
    /^__Host-ThursdaySession=.+; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400$/,
  );
  assert.equal(result.headers["cache-control"], "no-store");
  assert.equal(
    (await f.request("/api/config", { headers: { cookie } })).status,
    200,
  );
  assert.equal(
    (
      await f.request("/api/config", {
        headers: { cookie: `${cookie}tampered` },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await f.request("/api/config", {
        headers: { cookie: `${cookie}; ${cookie}` },
      })
    ).status,
    401,
  );
  assert.equal(
    (await f.request("/__auth/logout", { method: "POST", headers: { cookie } }))
      .status,
    403,
  );
  const logout = await f.request("/__auth/logout", {
    method: "POST",
    headers: { cookie, origin },
  });
  assert.equal(logout.status, 303);
  assert.match(logout.headers["set-cookie"][0], /Max-Age=0/);
  assert.equal(
    (await f.request("/api/config", { headers: { cookie } })).status,
    401,
  );
});

test("mutations enforce origin; proxy headers cannot be spoofed and gateway cookie stays private", async (t) => {
  let received;
  const f = await fixture(t, (req, res) => {
    received = req.headers;
    res.end("ok");
  });
  const { cookie } = await f.login();
  for (const method of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
    assert.equal(
      (await f.request("/api/config", { method, headers: { cookie } })).status,
      403,
    );
    assert.equal(
      (
        await f.request("/api/config", {
          method,
          headers: { cookie, origin: "https://attacker.example" },
        })
      ).status,
      403,
    );
  }
  assert.equal(
    (
      await f.request("/api/config", {
        method: "POST",
        headers: {
          cookie: `${cookie}; app_cookie=retained`,
          origin,
          forwarded: "host=attacker.example;proto=http",
          "x-forwarded-host": "attacker.example",
          "x-forwarded-proto": "http",
          "x-forwarded-for": "attacker-address",
          "x-original-url": "/hidden",
          connection: "x-remove",
          "x-remove": "bad",
        },
      })
    ).status,
    200,
  );
  assert.equal(received.host, host);
  assert.equal(received["x-forwarded-host"], host);
  assert.equal(received["x-forwarded-proto"], "https");
  assert.equal(received["x-forwarded-port"], "443");
  assert.notEqual(received["x-forwarded-for"], "attacker-address");
  assert.equal(received.forwarded, undefined);
  assert.equal(received["x-original-url"], undefined);
  assert.equal(received["x-remove"], undefined);
  assert.equal(received.cookie, "app_cookie=retained");
});

test("same-origin EventSource GET needs no Origin; acting GET rejects cross-site navigation", async (t) => {
  const f = await fixture(t);
  const { cookie } = await f.login();
  assert.equal(
    (
      await f.request("/api/events", {
        headers: { cookie, "sec-fetch-site": "same-origin" },
      })
    ).status,
    200,
  );
  for (const path of [
    "/api/events",
    "/api/favicon/example.com",
    "/api/thursday/call/plan",
  ]) {
    assert.equal(
      (
        await f.request(path, {
          headers: {
            cookie,
            "sec-fetch-site": "cross-site",
            "sec-fetch-mode": "navigate",
          },
        })
      ).status,
      403,
    );
  }
  assert.equal(
    (
      await f.request("/api/config", {
        headers: { cookie, "sec-fetch-site": "cross-site" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.request("/", {
        headers: {
          cookie,
          "sec-fetch-site": "cross-site",
          "sec-fetch-mode": "navigate",
        },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await f.request("/api/mcp/oauth/callback?state=test-only", {
        headers: {
          cookie,
          "sec-fetch-site": "cross-site",
          "sec-fetch-mode": "navigate",
        },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await f.request("/api/reach/gmail/callback?state=test-only", {
        headers: {
          cookie,
          "sec-fetch-site": "cross-site",
          "sec-fetch-mode": "navigate",
        },
      })
    ).status,
    200,
  );
});

test("an in-memory session does not survive replacing the gateway process", async (t) => {
  const first = await fixture(t);
  const { cookie } = await first.login();
  const second = await fixture(t);
  assert.equal(
    (await second.request("/api/config", { headers: { cookie } })).status,
    401,
  );
  assert.equal(
    (
      await second.request("/api/config?token=untrusted&password=untrusted", {
        headers: {},
      })
    ).status,
    401,
  );
});

test("only narrow paired-browser and signed-voice paths reach their own app validator", async (t) => {
  const reached = [];
  const f = await fixture(t, (req, res) => {
    reached.push(req.url);
    res.end("validator reached");
  });
  const bearer = `Bearer ${"a".repeat(43)}`;
  assert.equal(
    (
      await f.request("/api/pc-browser/bridge", {
        headers: { authorization: bearer },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await f.request("/api/twilio/voice/start", {
        method: "POST",
        headers: { "x-twilio-signature": "dGVzdA==" },
      })
    ).status,
    200,
  );
  assert.deepEqual(reached, [
    "/api/pc-browser/bridge",
    "/api/twilio/voice/start",
  ]);
  for (const path of [
    "/api/config",
    "/api/pc-browser/bridgex",
    "/api/twilio/voice-wrong/start",
  ]) {
    assert.equal(
      (
        await f.request(path, {
          method: "POST",
          headers: { authorization: bearer, "x-twilio-signature": "dGVzdA==" },
        })
      ).status,
      403,
    );
  }
  assert.equal(
    (await f.request("/api/twilio/voice/start", { method: "POST" })).status,
    403,
  );
  assert.equal(
    (
      await f.request("/api/pc-browser/bridge", {
        headers: { authorization: "Bearer wrong" },
      })
    ).status,
    401,
  );
});

test("login limits form size, content type and password guessing", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await f.request("/__auth/login", {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: "{}",
      })
    ).status,
    415,
  );
  assert.equal(
    (
      await f.request("/__auth/login", {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: `password=${"x".repeat(9000)}`,
      })
    ).status,
    413,
  );
  const outcomes = [];
  for (let i = 0; i < 12; i += 1)
    outcomes.push(
      (
        await f.request("/__auth/login", {
          method: "POST",
          headers: {
            origin,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: "password=wrong",
        })
      ).status,
    );
  assert.ok(outcomes.includes(429));
});

test("authenticated SSE responses arrive before the upstream response ends", async (t) => {
  let release;
  const f = await fixture(t, (req, res) => {
    if (req.url !== "/api/events") return res.end("ok");
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "public",
    });
    res.write("data: first\n\n");
    release = () => res.end("data: second\n\n");
  });
  const { cookie } = await f.login();
  await new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: f.port,
        path: "/api/events",
        headers: { host, cookie },
        agent: false,
      },
      (res) => {
        assert.equal(res.statusCode, 200);
        assert.equal(res.headers["cache-control"], "private, no-store");
        res.once("data", (chunk) => {
          assert.equal(chunk.toString(), "data: first\n\n");
          release();
        });
        res.on("end", resolve);
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
});

test("authenticated upload bodies reach the upstream before the client finishes sending", async (t) => {
  let firstChunk;
  const arrived = new Promise((resolve) => {
    firstChunk = resolve;
  });
  const f = await fixture(t, (req, res) => {
    req.once("data", (chunk) => firstChunk(chunk.toString()));
    req.on("end", () => res.end("uploaded"));
  });
  const { cookie } = await f.login();
  const result = new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: f.port,
        path: "/api/upload",
        method: "POST",
        headers: { host, cookie, origin },
        agent: false,
      },
      (res) => {
        res.resume();
        res.on("end", resolve);
      },
    );
    req.on("error", reject);
    req.write("first chunk");
    arrived.then((chunk) => {
      assert.equal(chunk, "first chunk");
      req.end("last chunk");
    }, reject);
  });
  await result;
});

function websocket(f, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port: f.port,
      path: "/socket",
      headers: {
        host,
        connection: "Upgrade",
        upgrade: "websocket",
        ...headers,
      },
      agent: false,
    });
    req.on("upgrade", (res, socket, head) =>
      resolve({ status: res.statusCode, socket, head }),
    );
    req.on("response", (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("WebSocket upgrades need a real session and origin and preserve bidirectional bytes", async (t) => {
  const f = await fixture(t);
  let upgrades = 0;
  f.upstream.on("upgrade", (_req, socket, head) => {
    upgrades += 1;
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
    );
    if (head.length) socket.write(head);
    socket.on("data", (chunk) => socket.write(chunk));
  });
  assert.equal((await websocket(f, { origin })).status, 401);
  const { cookie } = await f.login();
  assert.equal((await websocket(f, { cookie })).status, 403);
  assert.equal(
    (await websocket(f, { cookie, origin: "https://attacker.example" })).status,
    403,
  );
  assert.equal(upgrades, 0);
  const connected = await websocket(f, { cookie, origin });
  assert.equal(connected.status, 101);
  const echoed = once(connected.socket, "data");
  connected.socket.write("streamed websocket bytes");
  assert.equal((await echoed)[0].toString(), "streamed websocket bytes");
  connected.socket.destroy();
  assert.equal(upgrades, 1);
});
