import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { database } from "@/database/db";
import { pcBrowserDeviceTable } from "@/database/tables";
import { publicError } from "@/lib/public-error";

const OWNER = "owner";
const digest = (key: string) => createHash("sha256").update(key).digest("hex");

type PcCommand = {
  id: string;
  method:
    | "snapshot"
    | "navigate"
    | "click"
    | "fill"
    | "scroll"
    | "back"
    | "forward"
    | "reload";
  args?: Record<string, string>;
};
type PcResult = { id: string; ok: boolean; value?: unknown; error?: string };
type Pending = {
  command: PcCommand;
  finish: (result: PcResult) => void;
  sent: boolean;
};
type State = {
  pending: Pending | null;
  poll: ((command: PcCommand | null) => void) | null;
  lastSeen: number;
  ready: boolean;
};
const state = ((
  globalThis as typeof globalThis & { __pcBrowserBridge?: State }
).__pcBrowserBridge ??= {
  pending: null,
  poll: null,
  lastSeen: 0,
  ready: false,
});

function disconnectPcBrowser() {
  state.ready = false;
  state.lastSeen = 0;
  state.poll?.(null);
  state.poll = null;
  const pending = state.pending;
  state.pending = null;
  pending?.finish({
    id: pending.command.id,
    ok: false,
    error:
      "PC Chrome was unpaired while the action was pending. Inspect the tab before retrying.",
  });
}

export async function pairPcBrowser() {
  if (process.env.THURSDAY_HOSTED !== "1")
    publicError("PC Chrome pairing is for the hosted Thursday instance.");
  const key = randomBytes(32).toString("base64url");
  await database
    .insert(pcBrowserDeviceTable)
    .values({ id: OWNER, keyHash: digest(key) })
    .onConflictDoUpdate({
      target: pcBrowserDeviceTable.id,
      set: { keyHash: digest(key), createdAt: new Date() },
    });
  disconnectPcBrowser();
  return key;
}

export async function unpairPcBrowser() {
  await database
    .delete(pcBrowserDeviceTable)
    .where(eq(pcBrowserDeviceTable.id, OWNER));
  disconnectPcBrowser();
}

export async function authenticatePcBrowser(header: string | null) {
  if (!header?.startsWith("Bearer ")) return false;
  const key = header.slice(7);
  if (!/^[A-Za-z0-9_-]{43}$/.test(key)) return false;
  const [device] = await database
    .select()
    .from(pcBrowserDeviceTable)
    .where(eq(pcBrowserDeviceTable.id, OWNER));
  if (!device) return false;
  return timingSafeEqual(Buffer.from(digest(key)), Buffer.from(device.keyHash));
}

export function pcBrowserStatus() {
  return { connected: state.ready && Date.now() - state.lastSeen < 45_000 };
}

/** Extension polls from the owner's computer. No page URL or browser secret is sent in headers. */
export async function pollPcBrowser(ready: boolean): Promise<PcCommand | null> {
  state.lastSeen = Date.now();
  state.ready = ready;
  if (ready && state.pending && !state.pending.sent) {
    state.pending.sent = true;
    return state.pending.command;
  }
  return new Promise((resolve) => {
    state.poll?.(null);
    const timer = setTimeout(() => {
      if (state.poll === wake) state.poll = null;
      resolve(null);
    }, 20_000);
    const wake = (command: PcCommand | null) => {
      clearTimeout(timer);
      if (state.poll === wake) state.poll = null;
      resolve(command);
    };
    state.poll = wake;
  });
}

export function answerPcBrowser(result: PcResult) {
  const pending = state.pending;
  if (!pending || pending.command.id !== result.id) return false;
  state.pending = null;
  pending.finish(result);
  return true;
}

export async function commandPcBrowser(
  method: PcCommand["method"],
  args?: Record<string, string>,
) {
  if (!pcBrowserStatus().connected)
    publicError(
      "PC Chrome is offline or paused. Open the extension on your computer and select a tab.",
    );
  if (state.pending)
    publicError(
      "PC Chrome is busy with another action. Wait for it to finish.",
    );
  const command = { id: randomBytes(16).toString("hex"), method, args };
  const result = await new Promise<PcResult>((finish) => {
    state.pending = { command, finish, sent: false };
    if (state.poll && state.ready) {
      state.pending.sent = true;
      state.poll(command);
      state.poll = null;
    }
    setTimeout(() => {
      if (state.pending?.command.id !== command.id) return;
      state.pending = null;
      finish({
        id: command.id,
        ok: false,
        error:
          "PC Chrome did not answer in time. The action may have happened; inspect before retrying.",
      });
    }, 30_000).unref();
  });
  if (!result.ok)
    publicError(result.error ?? "PC Chrome could not complete the action.");
  return result.value;
}
