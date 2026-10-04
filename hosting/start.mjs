import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createGateway } from "./access-gateway.mjs";
import { HOSTING_ACCESS } from "./config.ts";

// Validate the public boundary before the application can migrate or open user data.
const { server, config } = createGateway();
if (config.listenPort === config.upstreamPort) {
  throw new Error("PORT and INTERNAL_PORT must be different");
}
const appDir = resolve(process.env.THURSDAY_APP_DIR || "/app");
const dataDir = resolve(process.env.THURSDAY_HOME || "/app/data");
await mkdir(dataDir, { recursive: true, mode: 0o700 });
await access(dataDir, constants.R_OK | constants.W_OK);
await access(join(appDir, "server.js"), constants.R_OK);

// The worker needs the public origin, but never the access gateway's credentials.
const workerEnv = { ...process.env };
delete workerEnv.APP_PASSWORD_HASH;
delete workerEnv.SESSION_SECRET;
const worker = spawn(process.execPath, [join(appDir, "server.js")], {
  cwd: appDir,
  stdio: "inherit",
  env: {
    ...workerEnv,
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    PORT: String(config.upstreamPort),
    THURSDAY_HOSTED: "1",
    THURSDAY_APP_DIR: appDir,
    THURSDAY_HOME: dataDir,
    THURSDAY_URL: config.publicOrigin,
    THURSDAY_RUNS: "elsewhere",
    THURSDAY_COMMAND: "Railway deployment",
    THURSDAY_VERSION: "0.28.0",
    NEXT_MANUAL_SIG_HANDLE: "true",
  },
});

const sockets = new Set();
server.on("connection", (socket) => {
  sockets.add(socket);
  socket.once("close", () => sockets.delete(socket));
});
let stopping = false;
let exitCode = 1;
let deadline;
function stop(code, signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  exitCode = code;
  process.exitCode = code;
  server.close();
  if (worker.exitCode === null && worker.signalCode === null)
    worker.kill(signal);
  deadline = setTimeout(() => {
    for (const socket of sockets) socket.destroy();
    if (worker.exitCode === null && worker.signalCode === null)
      worker.kill("SIGKILL");
    process.exit(exitCode);
  }, HOSTING_ACCESS.shutdownMs);
  deadline.unref();
}
server.on("error", (error) => {
  console.error(`Thursday access gateway failed: ${error.message}`);
  stop(1);
});
worker.on("error", (error) => {
  console.error(`Thursday application failed to start: ${error.message}`);
  stop(1);
});
worker.once("exit", (code, signal) => {
  if (!stopping) {
    console.error(
      `Thursday application exited (${signal || code}); stopping gateway.`,
    );
    stop(code || 1);
  }
  clearTimeout(deadline);
  for (const socket of sockets) socket.destroy();
  process.exit(exitCode);
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.once(signal, () => stop(0, signal));
}
server.listen(config.listenPort, "0.0.0.0", () => {
  console.log(
    `Thursday access gateway listening on port ${config.listenPort}.`,
  );
});
