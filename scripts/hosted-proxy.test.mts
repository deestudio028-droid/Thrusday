import assert from "node:assert/strict";
import { after, test } from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "../proxy.ts";

const beforeHosted = process.env.THURSDAY_HOSTED;
const beforeOrigin = process.env.APP_PUBLIC_ORIGIN;
process.env.THURSDAY_HOSTED = "1";
process.env.APP_PUBLIC_ORIGIN = "https://assistant.example.test";
after(() => {
  if (beforeHosted === undefined) delete process.env.THURSDAY_HOSTED;
  else process.env.THURSDAY_HOSTED = beforeHosted;
  if (beforeOrigin === undefined) delete process.env.APP_PUBLIC_ORIGIN;
  else process.env.APP_PUBLIC_ORIGIN = beforeOrigin;
});

function request(
  path: string,
  headers: Record<string, string> = {},
  method = "GET",
) {
  return new NextRequest(`http://127.0.0.1:3000${path}`, {
    method,
    headers: { host: "assistant.example.test", ...headers },
  });
}

const passes = (response: Response) =>
  response.headers.get("x-middleware-next") === "1";

test("hosted public requests require the exact configured host", () => {
  assert.ok(passes(proxy(request("/"))));
  assert.equal(
    proxy(request("/", { host: "attacker.example.test" })).status,
    421,
  );
  assert.equal(
    proxy(
      request("/", {
        host: "attacker.example.test",
        "x-forwarded-host": "assistant.example.test",
      }),
    ).status,
    421,
  );
});

test("hosted mutations accept HTTPS origin and reject missing or foreign origins", () => {
  const path = "/api/thursday/tool-call";
  assert.ok(
    passes(
      proxy(
        request(
          path,
          {
            origin: "https://assistant.example.test",
            "sec-fetch-site": "same-origin",
          },
          "POST",
        ),
      ),
    ),
  );
  assert.equal(proxy(request(path, {}, "POST")).status, 403);
  assert.equal(
    proxy(request(path, { origin: "https://attacker.example.test" }, "POST"))
      .status,
    403,
  );
  assert.equal(proxy(request(path, { origin: "null" }, "POST")).status, 403);
});

test("local artifact workers remain private loopback clients", () => {
  assert.ok(
    passes(
      proxy(
        request("/api/file/artifacts/page.html", { host: "127.0.0.1:3000" }),
      ),
    ),
  );
  assert.ok(
    passes(
      proxy(
        new NextRequest("http://127.0.0.1:3000/api/file/artifacts/chart.png"),
      ),
    ),
  );
});

test("event streams reject cross-site origin while valid browser streams pass", () => {
  assert.equal(
    proxy(request("/api/events", { "sec-fetch-site": "cross-site" })).status,
    403,
  );
  assert.ok(
    passes(
      proxy(
        request("/api/events", {
          origin: "https://assistant.example.test",
          "sec-fetch-site": "same-origin",
        }),
      ),
    ),
  );
  assert.ok(
    passes(proxy(request("/api/events", { "sec-fetch-site": "same-origin" }))),
  );
});

test("hosted mode fails closed with missing or insecure public origin", () => {
  for (const value of [
    "",
    "http://assistant.example.test",
    "https://assistant.example.test/secret",
    "https://user:password@assistant.example.test",
  ]) {
    process.env.APP_PUBLIC_ORIGIN = value;
    assert.equal(proxy(request("/")).status, 503);
  }
  process.env.APP_PUBLIC_ORIGIN = "https://assistant.example.test";
});
