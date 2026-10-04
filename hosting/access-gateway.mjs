import {
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import http from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { HOSTING_ACCESS as limits } from "./config.ts";

const scrypt = promisify(scryptCallback);
const SCRYPT_OPTIONS = limits.scrypt;
const COOKIE = "__Host-ThursdaySession";
const HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const FORWARD_HEADERS = new Set([
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
  "x-real-ip",
  "x-original-url",
  "x-rewrite-url",
]);
const SAFE_METHODS = new Set(["GET", "HEAD"]);

function integer(value, name, min, max) {
  if (!/^\d+$/.test(String(value ?? "")))
    throw new Error(`${name} must be configured as an integer`);
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max)
    throw new Error(`${name} is outside its allowed range`);
  return result;
}

function decodeBase64url(value, length) {
  if (!/^[A-Za-z0-9_-]+$/.test(value ?? ""))
    throw new Error("APP_PASSWORD_HASH has an invalid format");
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== length || bytes.toString("base64url") !== value)
    throw new Error("APP_PASSWORD_HASH has an invalid format");
  return bytes;
}

export function readConfiguration(env = process.env) {
  let origin;
  try {
    origin = new URL(env.APP_PUBLIC_ORIGIN);
  } catch {
    throw new Error("APP_PUBLIC_ORIGIN must be configured");
  }
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new Error("APP_PUBLIC_ORIGIN must be a plain HTTPS origin");
  }
  const parts = String(env.APP_PASSWORD_HASH ?? "").split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt-v1")
    throw new Error("APP_PASSWORD_HASH must use scrypt-v1 format");
  const salt = decodeBase64url(parts[1], 16);
  const passwordKey = decodeBase64url(parts[2], 64);
  const sessionSecret = Buffer.from(env.SESSION_SECRET ?? "", "utf8");
  if (
    sessionSecret.length < limits.secretMinBytes ||
    sessionSecret.length > limits.secretMaxBytes
  )
    throw new Error("SESSION_SECRET must contain at least 32 bytes");
  return {
    publicOrigin: origin.origin,
    publicHost: origin.host,
    publicPort: origin.port || "443",
    listenPort: integer(env.PORT ?? "8080", "PORT", 1, 65535),
    upstreamPort: integer(
      env.INTERNAL_PORT ?? "3000",
      "INTERNAL_PORT",
      1,
      65535,
    ),
    sessionMaxAgeSeconds: integer(
      env.SESSION_MAX_AGE_SECONDS ?? String(limits.sessionSeconds),
      "SESSION_MAX_AGE_SECONDS",
      limits.sessionMinSeconds,
      limits.sessionMaxSeconds,
    ),
    sessionSecret,
    salt,
    passwordKey,
  };
}

export async function hashPassword(password) {
  if (
    typeof password !== "string" ||
    Buffer.byteLength(password, "utf8") < limits.passwordMinBytes ||
    Buffer.byteLength(password, "utf8") > limits.passwordMaxBytes
  ) {
    throw new Error("Use a password containing 14 to 1024 bytes");
  }
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64, SCRYPT_OPTIONS);
  return `scrypt-v1:${salt.toString("base64url")}:${key.toString("base64url")}`;
}

function responseHeaders(extra = {}) {
  return {
    "cache-control": "no-store",
    "content-type": "text/plain; charset=utf-8",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...extra,
  };
}

function reply(res, status, text, extra = {}) {
  const body = Buffer.from(text);
  res.writeHead(
    status,
    responseHeaders({ "content-length": body.length, ...extra }),
  );
  res.end(body);
}

function loginPage(error = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Thursday — private sign in</title><style>body{font:16px system-ui;background:#10151b;color:#f0f4f9;margin:0;min-height:100vh;display:grid;place-items:center}main{width:min(360px,calc(100vw - 48px));padding:28px;border:1px solid #354354;border-radius:16px;background:#19212b}h1{font-size:24px;margin:0 0 12px}p{line-height:1.5;color:#c4cfdb}label,input,button{display:block}input{box-sizing:border-box;width:100%;padding:12px;margin:8px 0 16px;background:#10151b;border:1px solid #66768a;border-radius:6px;color:white;font:inherit}button{padding:12px 18px;border:0;border-radius:6px;background:#a8d2ff;color:#09243f;font:inherit;font-weight:600;cursor:pointer}.error{color:#ffb2b2}</style></head><body><main><h1>Thursday</h1><p>Sign in to your private assistant.</p>${error ? `<p class="error">${error}</p>` : ""}<form action="/__auth/login" method="post"><label for="password">Hosting password</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="1024"><button type="submit">Sign in</button></form></main></body></html>`;
}

const AUTH_PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "x-frame-options": "DENY",
};

function cookieValue(req) {
  const matches = String(req.headers.cookie ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter((item) => item.startsWith(`${COOKIE}=`));
  return matches.length === 1 ? matches[0].slice(COOKIE.length + 1) : "";
}

function stripSessionCookie(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter((item) => item && !item.startsWith(`${COOKIE}=`))
    .join("; ");
}

function constantEqual(a, b) {
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readLoginBody(req) {
  if (
    String(req.headers["content-type"] ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase() !== "application/x-www-form-urlencoded"
  ) {
    throw Object.assign(new Error("Unsupported form"), { status: 415 });
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limits.loginBodyBytes)
      throw Object.assign(new Error("Form too large"), { status: 413 });
    chunks.push(chunk);
  }
  const params = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  if (params.getAll("password").length !== 1)
    throw Object.assign(new Error("Invalid form"), { status: 400 });
  const password = params.get("password");
  if (Buffer.byteLength(password, "utf8") > limits.passwordMaxBytes)
    throw Object.assign(new Error("Form too large"), { status: 413 });
  return password;
}

function proxyHeaders(req, config, upgrade = false) {
  const connectionNames = String(req.headers.connection ?? "")
    .toLowerCase()
    .split(",")
    .map((item) => item.trim());
  const excluded = new Set([
    ...HOP_HEADERS,
    ...FORWARD_HEADERS,
    ...connectionNames,
  ]);
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (
      !excluded.has(name) &&
      name !== "host" &&
      name !== "cookie" &&
      value !== undefined
    )
      headers[name] = value;
  }
  const cookie = stripSessionCookie(req.headers.cookie);
  if (cookie) headers.cookie = cookie;
  headers.host = config.publicHost;
  headers["x-forwarded-host"] = config.publicHost;
  headers["x-forwarded-proto"] = "https";
  headers["x-forwarded-port"] = config.publicPort;
  headers["x-forwarded-for"] = req.socket.remoteAddress ?? "127.0.0.1";
  if (upgrade) {
    headers.connection = "Upgrade";
    headers.upgrade = "websocket";
  }
  return headers;
}

function upstreamResponseHeaders(upstream, upgrade = false) {
  const connectionNames = String(upstream.headers.connection ?? "")
    .toLowerCase()
    .split(",")
    .map((item) => item.trim());
  const excluded = new Set([...HOP_HEADERS, ...connectionNames]);
  const headers = {};
  for (const [name, value] of Object.entries(upstream.headers))
    if (!excluded.has(name) && value !== undefined) headers[name] = value;
  headers["cache-control"] = "private, no-store";
  headers["x-content-type-options"] = "nosniff";
  headers["referrer-policy"] = "no-referrer";
  if (upgrade) {
    headers.connection = "Upgrade";
    headers.upgrade = "websocket";
  }
  return headers;
}

/** HTTPS terminates at Railway. This process is the only publicly exposed listener. */
export function createGateway({ env = process.env } = {}) {
  const config = readConfiguration(env);
  const sessions = new Map();
  const loginAttempts = new Map();
  const agent = new http.Agent({
    keepAlive: true,
    maxSockets: limits.upstreamSockets,
  });
  let activePasswordChecks = 0;

  const signature = (id) =>
    createHmac("sha256", config.sessionSecret).update(id).digest("base64url");
  function validSession(req) {
    const token = cookieValue(req);
    const parts = token.split(".");
    if (
      parts.length !== 2 ||
      !/^[A-Za-z0-9_-]{43}$/.test(parts[0]) ||
      !/^[A-Za-z0-9_-]{43}$/.test(parts[1])
    )
      return undefined;
    if (!constantEqual(Buffer.from(parts[1]), Buffer.from(signature(parts[0]))))
      return undefined;
    const expiresAt = sessions.get(parts[0]);
    if (!expiresAt || expiresAt <= Date.now()) {
      sessions.delete(parts[0]);
      return undefined;
    }
    return parts[0];
  }
  function hostValid(req) {
    let hostCount = 0;
    for (let i = 0; i < req.rawHeaders.length; i += 2)
      if (req.rawHeaders[i].toLowerCase() === "host") hostCount += 1;
    return (
      hostCount === 1 &&
      String(req.headers.host ?? "").toLowerCase() ===
        config.publicHost.toLowerCase()
    );
  }
  const originValid = (req) => req.headers.origin === config.publicOrigin;
  function authenticate(req) {
    if (!hostValid(req)) return 421;
    if (req.headers.origin !== undefined && !originValid(req)) return 403;
    if (!SAFE_METHODS.has(req.method) && !originValid(req)) return 403;
    const site = req.headers["sec-fetch-site"];
    if (site !== undefined && site !== "same-origin" && site !== "none") {
      const path = new URL(req.url, config.publicOrigin).pathname;
      const safeNavigation =
        SAFE_METHODS.has(req.method) &&
        req.headers["sec-fetch-mode"] === "navigate" &&
        !limits.actingReads.some((route) => path.startsWith(route));
      if (!safeNavigation) return 403;
    }
    return validSession(req) ? 0 : 401;
  }
  function loginAllowed(req) {
    const key = req.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    const attempt = loginAttempts.get(key);
    if (
      attempt &&
      attempt.expiresAt > now &&
      attempt.count >= limits.loginAttempts
    )
      return false;
    if (!attempt || attempt.expiresAt <= now)
      loginAttempts.set(key, {
        count: 1,
        expiresAt: now + limits.loginWindowMs,
      });
    else attempt.count += 1;
    for (const [ip, record] of loginAttempts)
      if (record.expiresAt <= now) loginAttempts.delete(ip);
    if (
      loginAttempts.size > limits.loginAddressLimit ||
      activePasswordChecks >= limits.simultaneousPasswordChecks
    )
      return false;
    return true;
  }
  const sessionCookie = (token) =>
    `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${config.sessionMaxAgeSeconds}`;
  const clearCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

  async function upstreamReady() {
    return new Promise((resolveReady) => {
      const probe = http.request(
        {
          hostname: "127.0.0.1",
          port: config.upstreamPort,
          path: "/api/running",
          method: "GET",
          agent,
          headers: {
            host: config.publicHost,
            "x-forwarded-host": config.publicHost,
            "x-forwarded-proto": "https",
            "x-forwarded-port": config.publicPort,
          },
        },
        (response) => {
          response.resume();
          resolveReady(response.statusCode >= 200 && response.statusCode < 400);
        },
      );
      probe.setTimeout(limits.readinessMs, () => {
        probe.destroy();
        resolveReady(false);
      });
      probe.on("error", () => resolveReady(false));
      probe.end();
    });
  }

  const server = http.createServer(async (req, res) => {
    if (!req.url.startsWith("/") || req.url.startsWith("//"))
      return reply(res, 400, "Invalid request.");
    let path;
    try {
      path = new URL(req.url, config.publicOrigin).pathname;
    } catch {
      return reply(res, 400, "Invalid request.");
    }
    // Railway's health probe can carry its own Host; this route reveals status alone.
    if (path === "/healthz" && SAFE_METHODS.has(req.method)) {
      const ready = await upstreamReady();
      return reply(
        res,
        ready ? 200 : 503,
        req.method === "HEAD"
          ? ""
          : JSON.stringify({ status: ready ? "ok" : "unavailable" }),
        { "content-type": "application/json" },
      );
    }
    if (!hostValid(req)) return reply(res, 421, "Unexpected host.");
    if (path === "/__auth/login") {
      if (req.method === "GET")
        return reply(res, 200, loginPage(), AUTH_PAGE_HEADERS);
      if (req.method !== "POST")
        return reply(res, 405, "Method not allowed.", { allow: "GET, POST" });
      if (!originValid(req)) return reply(res, 403, "Request origin denied.");
      if (!loginAllowed(req))
        return reply(res, 429, "Too many sign-in attempts. Try again later.", {
          "retry-after": "600",
        });
      activePasswordChecks += 1;
      try {
        const password = await readLoginBody(req);
        const key = await scrypt(password, config.salt, 64, SCRYPT_OPTIONS);
        if (!constantEqual(key, config.passwordKey))
          return reply(
            res,
            401,
            loginPage("Incorrect password. Try again."),
            AUTH_PAGE_HEADERS,
          );
        const now = Date.now();
        for (const [id, expiresAt] of sessions)
          if (expiresAt <= now) sessions.delete(id);
        if (sessions.size >= limits.sessionLimit)
          return reply(res, 503, "Sign-in is temporarily unavailable.");
        const oldId = validSession(req);
        if (oldId) sessions.delete(oldId);
        const id = randomBytes(32).toString("base64url");
        sessions.set(id, now + config.sessionMaxAgeSeconds * 1000);
        loginAttempts.delete(req.socket.remoteAddress ?? "unknown");
        return reply(res, 303, "", {
          location: "/",
          "set-cookie": sessionCookie(`${id}.${signature(id)}`),
        });
      } catch (error) {
        return reply(res, error.status ?? 400, "Unable to process sign-in.");
      } finally {
        activePasswordChecks -= 1;
      }
    }
    const denied = authenticate(req);
    if (denied) {
      if (
        denied === 401 &&
        req.method === "GET" &&
        String(req.headers.accept ?? "").includes("text/html")
      )
        return reply(res, 401, loginPage(), AUTH_PAGE_HEADERS);
      return reply(
        res,
        denied,
        denied === 401 ? "Sign-in required." : "Request origin denied.",
      );
    }
    if (path === "/__auth/logout") {
      if (req.method === "GET")
        return reply(
          res,
          200,
          '<!doctype html><title>Thursday sign out</title><form action="/__auth/logout" method="post"><button>Sign out of Thursday</button></form>',
          AUTH_PAGE_HEADERS,
        );
      if (req.method !== "POST")
        return reply(res, 405, "Method not allowed.", { allow: "GET, POST" });
      sessions.delete(validSession(req));
      return reply(res, 303, "", {
        location: "/__auth/login",
        "set-cookie": clearCookie,
      });
    }
    if (path.startsWith("/__auth/")) return reply(res, 404, "Not found.");
    const upstream = http.request(
      {
        hostname: "127.0.0.1",
        port: config.upstreamPort,
        path: req.url,
        method: req.method,
        headers: proxyHeaders(req, config),
        agent,
      },
      (upstreamResponse) => {
        res.writeHead(
          upstreamResponse.statusCode ?? 502,
          upstreamResponseHeaders(upstreamResponse),
        );
        upstreamResponse.on("error", () => res.destroy());
        upstreamResponse.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent)
        reply(res, 502, "Thursday is temporarily unavailable.");
      else res.destroy();
    });
    req.on("aborted", () => upstream.destroy());
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  });

  function rejectUpgrade(socket, status, message) {
    if (socket.destroyed || socket.writableEnded) return;
    const phrase =
      {
        401: "Unauthorized",
        403: "Forbidden",
        421: "Misdirected Request",
        502: "Bad Gateway",
        400: "Bad Request",
      }[status] ?? "Bad Request";
    socket.end(
      `HTTP/1.1 ${status} ${phrase}\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`,
    );
  }
  server.on("upgrade", (req, socket, head) => {
    const denied = authenticate(req);
    if (denied || !originValid(req))
      return rejectUpgrade(
        socket,
        denied || 403,
        "Authorized same-origin session required.",
      );
    if (
      !req.url.startsWith("/") ||
      req.url.startsWith("//") ||
      new URL(req.url, config.publicOrigin).pathname.startsWith("/__auth/")
    )
      return rejectUpgrade(socket, 400, "Unsupported upgrade.");
    if (String(req.headers.upgrade ?? "").toLowerCase() !== "websocket")
      return rejectUpgrade(socket, 400, "Unsupported upgrade.");
    const upstream = http.request({
      hostname: "127.0.0.1",
      port: config.upstreamPort,
      path: req.url,
      method: req.method,
      headers: proxyHeaders(req, config, true),
      agent: false,
    });
    const timer = setTimeout(() => {
      upstream.destroy();
      rejectUpgrade(socket, 502, "Upgrade unavailable.");
    }, limits.upgradeMs);
    timer.unref();
    socket.on("error", () => upstream.destroy());
    socket.on("close", () => {
      clearTimeout(timer);
      upstream.destroy();
    });
    upstream.on("upgrade", (response, upstreamSocket, upstreamHead) => {
      clearTimeout(timer);
      if (response.statusCode !== 101) {
        upstreamSocket.destroy();
        return rejectUpgrade(socket, 502, "Upgrade unavailable.");
      }
      const headers = upstreamResponseHeaders(response, true);
      let responseText = "HTTP/1.1 101 Switching Protocols\r\n";
      for (const [name, value] of Object.entries(headers))
        for (const item of Array.isArray(value) ? value : [value])
          responseText += `${name}: ${item}\r\n`;
      socket.write(`${responseText}\r\n`);
      if (head.length) upstreamSocket.write(head);
      if (upstreamHead.length) socket.write(upstreamHead);
      upstreamSocket.on("error", () => socket.destroy());
      socket.on("error", () => upstreamSocket.destroy());
      upstreamSocket.on("close", () => socket.destroy());
      socket.on("close", () => upstreamSocket.destroy());
      socket.pipe(upstreamSocket);
      upstreamSocket.pipe(socket);
    });
    upstream.on("response", (response) => {
      clearTimeout(timer);
      response.destroy();
      rejectUpgrade(socket, 502, "Upgrade unavailable.");
    });
    upstream.on("error", () => {
      clearTimeout(timer);
      if (!socket.destroyed) rejectUpgrade(socket, 502, "Upgrade unavailable.");
    });
    upstream.end();
  });
  server.on("clientError", (_error, socket) => {
    if (socket.writable) rejectUpgrade(socket, 400, "Invalid request.");
  });
  server.headersTimeout = limits.headersMs;
  server.requestTimeout = 0;
  server.keepAliveTimeout = limits.keepAliveMs;
  server.on("close", () => agent.destroy());
  return { server, config };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const { server, config } = createGateway();
    server.listen(config.listenPort, "0.0.0.0", () =>
      console.log(
        `Thursday access gateway listening on port ${config.listenPort}.`,
      ),
    );
    const shutdown = () => {
      server.close();
      setTimeout(() => process.exit(0), limits.shutdownMs).unref();
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  } catch (error) {
    console.error(
      `Thursday access gateway configuration error: ${error.message}`,
    );
    process.exitCode = 1;
  }
}
