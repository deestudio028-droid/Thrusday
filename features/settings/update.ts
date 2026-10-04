import { spawn } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DATA_DIR, UPDATE } from "@/config";
import { listRunningThreadIds } from "@/features/bot/thread.query";
import { readConfig, writeConfig } from "@/features/config/config.query";
import { isAnyCallLive } from "@/features/thursday/thursday.query";
import { logger } from "@/lib/logger";
import { publicError } from "@/lib/public-error";
import { APP_OWN } from "@/lib/sandbox";
import { type Running, readRunning } from "./running";

// Moving to a newer version. A copy installed from npm never changes by itself: the background
// job runs the copy `start` put under ~/.thursday/app, and a bare `npx thursday-agent` leaves a
// server already up as it is (bin/thursday.mjs leaveToRunning). So the app asks npm which
// version is newest when a browser opens it, says so, and — for the copy in the background,
// started through npx — moves there itself at a press.

/** The package on npm, and the one command that starts it through npx (bin/tools.mjs). */
const PACKAGE = "thursday-agent";
const NPX = `npx ${PACKAGE}`;
const GLOBAL = "thursday";

/**
 * npm's registry, asked for the manifest its `latest` tag names: `GET /{package}/{tag}`, as its
 * API documents (github.com/npm/registry, docs/REGISTRY-API.md). The one request this app makes
 * that nobody asked for by name; SECURITY.md says so.
 */
const REGISTRY = `https://registry.npmjs.org/${PACKAGE}/latest`;

/** A plain release. The only kind offered, and the only text that reaches a command line. */
const PLAIN = /^\d+\.\d+\.\d+$/;

/** When the notice was last closed, as an ISO time (config row). */
const NOTICE_CLOSED_KEY = "UPDATE_NOTICE_CLOSED";

/** What the update's own command printed, beside the database; named as private files are. */
const LOG_FILE = "update.local.log";

export type UpdateBusy = {
  /** A call is open: it ends when the server restarts. */
  call: boolean;
  /** Jobs at work: they pause and wait on Continue, and a routine's run ends. */
  threads: number;
};

export type Update = {
  /** The version that runs, as its starter said; null from source, which says none. */
  current: string | null;
  /** npm's newest release when it is newer than `current`; null when it is not, or not known. */
  newer: string | null;
  /** npm could not be asked, so `newer` says nothing either way. */
  unreached: boolean;
  /** The line a person types to move to `newer`. */
  command: string | null;
  /** Whether the app can run that move itself: the background copy, started through npx. */
  byButton: boolean;
  /** Whether the notice is due as the app opens: something newer, not closed lately. */
  notice: boolean;
  /** A move this server started: where to, and why it stopped if it has. */
  moving: { to: string; failed: string | null } | null;
};

/**
 * Pinned: a route and an action can load separate copies of this module, and the move one
 * started is what the other reports. `asking` is the one request in flight, shared by every
 * page that opened at once.
 */
const pinned = globalThis as typeof globalThis & {
  __updateAsked?: { at: number; latest: string | null };
  __updateAsking?: Promise<string | null>;
  __updateMoving?: { to: string; failed: string | null };
};

/** Whether `a` is a later plain release than `b`. Anything else — a prerelease — is not. */
export function isNewer(a: string, b: string): boolean {
  if (!PLAIN.test(a) || !PLAIN.test(b)) return false;
  const [x, y] = [a, b].map((version) => version.split(".").map(Number));
  for (let at = 0; at < 3; at++) if (x[at] !== y[at]) return x[at] > y[at];
  return false;
}

/**
 * npm's newest version; null when it could not be asked. An answer is kept for UPDATE.checkMs
 * and a failure for UPDATE.againMs, so a page opened again does not ask again; nothing is kept
 * across a restart, which is one more ask.
 */
async function newestOnNpm(): Promise<string | null> {
  const kept = pinned.__updateAsked;
  if (
    kept &&
    Date.now() - kept.at < (kept.latest ? UPDATE.checkMs : UPDATE.againMs)
  )
    return kept.latest;
  pinned.__updateAsking ??= askNpm().finally(() => {
    pinned.__updateAsking = undefined;
  });
  return pinned.__updateAsking;
}

async function askNpm(): Promise<string | null> {
  let latest: string | null = null;
  try {
    const response = await fetch(REGISTRY, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(UPDATE.timeoutMs),
    });
    if (!response.ok) throw new Error(`npm answered ${response.status}`);
    const said = ((await response.json()) as { version?: unknown }).version;
    if (typeof said !== "string") throw new Error("npm named no version");
    latest = said;
  } catch (cause) {
    logger.warn("npm could not be asked for the newest version", cause);
  }
  pinned.__updateAsked = { at: Date.now(), latest };
  return latest;
}

/**
 * The version npm can move: one its starter named, of a copy run through npx or a global
 * install. A checkout (`pnpm start`, `pnpm dev`) moves with git, and is told nothing here.
 */
const movable = (running: Running, version: string | null) =>
  Boolean(version && PLAIN.test(version)) &&
  (running.command === NPX || running.command === GLOBAL);

/** Only the copy in the background can be replaced from here; a terminal's is its person's. */
const movesItself = (running: Running) =>
  running.where === "background" && running.mac && running.command === NPX;

/**
 * The line that moves this install to `version`, on its own data folder: `start` carries the
 * `--home` its folder needs (running.ts). A background copy is started again from the new
 * version; one in a terminal is run again there; a global install is updated first.
 */
function moveCommand(running: Running, version: string): string | null {
  const { command, start, where } = running;
  if (!command || !start) return null;
  const again =
    where === "background" ? start : start.replace(`${command} start`, command);
  return command === NPX
    ? again.replace(NPX, `${NPX}@${version}`)
    : `npm install -g ${PACKAGE}@${version} && ${again}`;
}

async function closedLately(): Promise<boolean> {
  const at = Date.parse((await readConfig(NOTICE_CLOSED_KEY)) ?? "");
  return Number.isFinite(at) && Date.now() - at < UPDATE.quietMs;
}

/** The notice was closed: it stays away for UPDATE.quietMs, in every tab and browser. */
export async function closeUpdateNotice(): Promise<void> {
  await writeConfig(NOTICE_CLOSED_KEY, new Date().toISOString());
}

/** What runs, what npm has, and how to get there. Asks npm at most once per UPDATE.checkMs. */
export async function readUpdate(): Promise<Update> {
  const running = readRunning();
  const current = process.env.THURSDAY_VERSION?.trim() || null;
  const moving = pinned.__updateMoving ?? null;
  if (!movable(running, current))
    return {
      current,
      newer: null,
      unreached: false,
      command: null,
      byButton: false,
      notice: false,
      moving,
    };
  const latest = await newestOnNpm();
  const newer = latest && current && isNewer(latest, current) ? latest : null;
  return {
    current,
    newer,
    unreached: latest === null,
    command: newer ? moveCommand(running, newer) : null,
    byButton: Boolean(newer) && movesItself(running),
    notice: Boolean(newer) && !(await closedLately()),
    moving,
  };
}

/** The last lines the update's command wrote, for a move that stopped. */
function logTail(file: string, lines = 6): string {
  try {
    return readFileSync(file, "utf8")
      .trimEnd()
      .split("\n")
      .slice(-lines)
      .join("\n");
  } catch {
    return "";
  }
}

/**
 * Moves the background copy to `version` by running that version's own `start`
 * (bin/background.mjs replaceJob): it installs the copy, stops this server, starts the new one,
 * waits until it serves, and loads this one again when it does not. The command is detached,
 * in a process group of its own: launchd ends a job's whole group when the job is taken out,
 * and a child left in this server's group died with it before it could start anything
 * (measured with two throwaway launchd jobs: the attached child was gone after `bootout`, the
 * detached one ran on under pid 1).
 *
 * Only the version this server offered is taken, so nothing a request sends reaches the
 * command line. With a call open or jobs at work it starts only when told `anyway`, and says
 * what is open otherwise.
 */
export async function startUpdate(
  version: string,
  anyway: boolean,
): Promise<{ started: boolean; busy: UpdateBusy | null }> {
  const update = await readUpdate();
  if (!update.byButton || update.newer !== version || !PLAIN.test(version))
    publicError(
      "That version is not on offer here. Settings › Thursday says how to update.",
    );
  const going = pinned.__updateMoving;
  if (going && !going.failed) return { started: true, busy: null };

  const busy: UpdateBusy = {
    call: await isAnyCallLive(),
    threads: (await listRunningThreadIds()).length,
  };
  if (!anyway && (busy.call || busy.threads)) return { started: false, busy };

  // The user's own environment: what the app set to run itself (NODE_ENV, PORT, its roots)
  // is this server's, not the next one's. How the person starts it is kept, so every line
  // the new copy prints names the command they have
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of Object.keys(env)) if (APP_OWN.test(name)) delete env[name];
  env.THURSDAY_COMMAND = NPX;

  const file = join(DATA_DIR, LOG_FILE);
  const log = openSync(file, "w");
  const moving = { to: version, failed: null as string | null };
  pinned.__updateMoving = moving;
  const port = process.env.PORT?.trim();
  try {
    const child = spawn(
      "npx",
      [
        "--yes",
        `${PACKAGE}@${version}`,
        "start",
        "--home",
        DATA_DIR,
        ...(port ? ["--port", port] : []),
        "--no-open",
      ],
      // Started from the home folder, as a person typing it would be. This server runs inside
      // its own copy (server.js chdirs there), which is itself a package of this name and is
      // the folder `start` removes once the new version is up (bin/background.mjs pruneCopies)
      { cwd: homedir(), detached: true, stdio: ["ignore", log, log], env },
    );
    child.on("error", (cause: NodeJS.ErrnoException) => {
      moving.failed =
        cause.code === "ENOENT"
          ? "npx was not found on the PATH this server runs with."
          : cause.message;
      logger.error(`the update to ${version} could not start`, cause);
    });
    // A move that works takes this server down before its command ends: an exit seen here
    // is one that stopped short
    child.on("exit", (code) => {
      if (code === 0) return;
      moving.failed = logTail(file) || `Its command stopped with exit ${code}.`;
      logger.error(`the update to ${version} stopped`, moving.failed);
    });
    child.unref();
  } finally {
    closeSync(log);
  }
  logger.info(`moving from ${update.current} to ${version}`);
  return { started: true, busy: null };
}
