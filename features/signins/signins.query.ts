import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";
import * as z from "zod";
import { appEvents } from "@/app/api/events/app-event.server";
import { BROWSER_CLI, DATA_DIR, PATHS } from "@/config";
import {
  browserStateFile,
  jobShellEnv,
  type ListedBrowser,
  listBrowsers,
  openWorkspace,
  saveBrowserState,
  WORKSPACE,
} from "@/features/workspace/workspace";
import { logger } from "@/lib/logger";
import { createKeyedLock } from "@/lib/queue";
import type { Sandbox } from "@/lib/sandbox";
import { type SignIn, siteOf } from "./signins.schema";

/**
 * The vault: one file per account of a site under the data folder, outside the workspace the
 * bots work in, so no bot comes across another's session among its files. It is a place, not
 * a lock — a bot's shell is not confined — and what it buys is that a session reaches a
 * browser only through the app, which asks the list below first. A file holds the record and
 * the browser's storage state together, so signing out of one account is removing its file.
 */
// Dot-prefixed like the workspace, so in a checkout it never reads as part of the app
const VAULT = join(DATA_DIR, PATHS.signIns);

/** What a file holds, as every build since the vault began writes it; anything else is not read. */
const KeptFile = z.object({
  site: z.string().min(1),
  account: z.string().min(1),
  bots: z.array(z.string()),
  asking: z.array(z.string()),
  keptAt: z.string(),
  usedAt: z.string().nullable(),
  state: z.unknown(),
});
type Kept = z.infer<typeof KeptFile>;

/**
 * A sign-in's file: the site as it reads, and the account hashed, so any name the site shows
 * makes a file name, and two that differ only in case stay two files on a disk that ignores
 * case (macOS's, by default) as they do everywhere else.
 */
const fileOf = (site: string, account: string) =>
  join(
    VAULT,
    `${encodeURIComponent(siteOf(site))}@${createHash("sha256").update(account).digest("hex").slice(0, 16)}.json`,
  );

/**
 * Where a build from before accounts kept a site's one sign-in. It is read where it is, and
 * moves to its account's file the first time that sign-in is written (`write`): nothing is
 * moved in bulk, so nothing can be left half moved.
 */
const olderFileOf = (site: string) =>
  join(VAULT, `${encodeURIComponent(siteOf(site))}.json`);

/** The site a vault file is for, from its name alone; null for a file that is no sign-in. */
function siteOfName(name: string): string | null {
  const [, site] = /^([^@]+)(?:@[0-9a-f]{16})?\.json$/.exec(name) ?? [];
  if (!site) return null;
  try {
    return decodeURIComponent(site);
  } catch {
    return null;
  }
}

const changed = () => appEvents.emit({ type: "signins" });

async function readKept(path: string): Promise<Kept | null> {
  try {
    const kept = KeptFile.safeParse(JSON.parse(await readFile(path, "utf8")));
    return kept.success ? kept.data : null;
  } catch {
    return null;
  }
}

/** One account's sign-in, in its own file or still in the site's older one. */
async function read(site: string, account: string): Promise<Kept | null> {
  const own = await readKept(fileOf(site, account));
  if (own) return own;
  const older = await readKept(olderFileOf(site));
  return older?.site === siteOf(site) && older.account === account
    ? older
    : null;
}

/** An older file that holds this account goes: its sign-in is in the account's own file now, or signed out. */
async function dropOlder(site: string, account: string) {
  const path = olderFileOf(site);
  const older = await readKept(path);
  if (older?.site === siteOf(site) && older.account === account)
    await rm(path, { force: true });
}

/**
 * Written beside and moved over: writing in place empties the file first, and a write that
 * then fails — a disk a bot filled, the process stopped mid-write — leaves a file `readKept`
 * cannot parse, which reads as a sign-in that was never kept. The one name beside is enough,
 * since every write waits in the vault's lane, and it is no sign-in's name (`siteOfName`).
 */
async function write(kept: Kept) {
  await mkdir(VAULT, { recursive: true });
  const file = fileOf(kept.site, kept.account);
  const beside = `${file}.saving`;
  try {
    // Owner-only: the session signs in as them
    await writeFile(beside, JSON.stringify(kept), { mode: 0o600 });
    await rename(beside, file);
  } catch (cause) {
    await rm(beside, { force: true }).catch(() => {});
    throw cause;
  }
  await dropOlder(kept.site, kept.account);
  changed();
}

/**
 * Every write to the vault reads, decides and writes in one lane, so two of them — a bot's
 * turn renewing a sign-in while the user lets another bot use it — never write over each
 * other. Pinned to globalThis: a route and an action a dev reload loads apart share it.
 */
const vaultLane = ((
  globalThis as typeof globalThis & {
    __signInsVault?: ReturnType<typeof createKeyedLock>;
  }
).__signInsVault ??= createKeyedLock());
const inVault = <T>(work: () => Promise<T>) => vaultLane("vault", work);

const record = ({ state: _state, ...signIn }: Kept): SignIn => signIn;

/** The sites the vault holds sign-ins for, from its file names alone. */
async function keptSites(): Promise<string[]> {
  const names = await readdir(VAULT).catch(() => [] as string[]);
  return [...new Set(names.flatMap((name) => siteOfName(name) ?? []))].sort();
}

/**
 * The sign-ins kept, by site, then account; `only` names the sites to read, so a lookup opens
 * that site's files alone. A site's older file counts until its account has a file of its own.
 */
async function listKept(only?: (site: string) => boolean): Promise<Kept[]> {
  const names = (await readdir(VAULT).catch(() => [] as string[])).filter(
    (name) => {
      const site = siteOfName(name);
      return site !== null && (!only || only(site));
    },
  );
  const found = await Promise.all(
    names.map(async (name) => {
      const kept = await readKept(join(VAULT, name));
      if (!kept) return null;
      const own = basename(fileOf(kept.site, kept.account));
      if (name === own) return kept;
      return name === basename(olderFileOf(kept.site)) && !names.includes(own)
        ? kept
        : null;
    }),
  );
  return found
    .flatMap((kept) => (kept ? [kept] : []))
    .sort(
      (a, b) =>
        a.site.localeCompare(b.site) || a.account.localeCompare(b.account),
    );
}

/**
 * The sign-ins a name stands for: its own site's, else those kept for a domain it sits under,
 * the longest first. A site's cookies are its domain's, so `myaccount.google.com` is signed in
 * by what was kept as `google.com` — asked by another name, the same session read as missing.
 */
async function keptFor(site: string): Promise<Kept[]> {
  const asked = siteOf(site);
  const sites = await keptSites();
  const at = sites.includes(asked)
    ? asked
    : sites
        .filter((kept) => asked.endsWith(`.${kept}`))
        .sort((a, b) => b.length - a.length)[0];
  return at ? listKept((one) => one === at) : [];
}

export async function listSignIns(): Promise<SignIn[]> {
  return (await listKept()).map(record);
}

/**
 * Keeps what `bot`'s browser holds for `site`, as `account`. A site keeps one sign-in per
 * account; the bot that kept one may borrow it, and whoever could before still can. An
 * account already kept is replaced only by a bot the user let use it: any other would swap
 * every allowed bot onto the session it signed in with, and put itself on the list without
 * the user — it goes on the asking list instead, as `borrowSignIn` does. The account is the
 * name the bot read off the page, which the app cannot check, so a name that matches none the
 * site keeps is kept beside them only when the bot says it is `another` account: the same
 * account written two ways is caught before it is two rows. And a name the site keeps
 * already is never `another` account: on a site that shows no name both would be the site's
 * own, and the second would be kept over the first — it needs a name that tells it apart.
 */
export function keepSignIn(input: {
  site: string;
  account: string;
  bot: string;
  state: unknown;
  another?: boolean | null;
}): Promise<
  | { kind: "kept"; signIn: SignIn; replaced: boolean }
  | { kind: "taken"; signIn: SignIn }
  | { kind: "unlisted"; site: string; accounts: string[] }
  | { kind: "clash"; site: string; accounts: string[] }
> {
  return inVault(async () => {
    const kept = await keptFor(input.site);
    const site = kept[0]?.site ?? siteOf(input.site);
    const account = input.account.trim() || site;
    const accounts = kept.map((one) => one.account);
    const before = kept.find((one) => one.account === account);
    if (before && input.another)
      return { kind: "clash" as const, site, accounts };
    if (before && !before.bots.includes(input.bot)) {
      const asked = before.asking.includes(input.bot)
        ? before
        : { ...before, asking: [...before.asking, input.bot] };
      if (asked !== before) await write(asked);
      return { kind: "taken" as const, signIn: record(asked) };
    }
    if (!before && kept.length && !input.another)
      return { kind: "unlisted" as const, site, accounts };
    const next: Kept = {
      site,
      account,
      bots: [...new Set([...(before?.bots ?? []), input.bot])],
      asking: (before?.asking ?? []).filter((bot) => bot !== input.bot),
      keptAt: new Date().toISOString(),
      usedAt: before?.usedAt ?? null,
      state: input.state,
    };
    await write(next);
    return { kind: "kept" as const, signIn: record(next), replaced: !!before };
  });
}

/**
 * What `bot` gets when it asks for `site`: the state when it may borrow it, else why not —
 * nothing is kept; the site keeps several accounts and none, or one it does not keep, was
 * named; or the user has not let this bot in, which is noted so the screen can offer the one
 * tap. Which account the work is for is the bot's to say, or the user's: with more than one
 * kept, none is picked for it.
 */
export function borrowSignIn(
  site: string,
  bot: string,
  account?: string | null,
): Promise<
  | { kind: "state"; signIn: SignIn; state: unknown }
  | { kind: "none"; kept: string[] }
  | { kind: "pick"; site: string; accounts: string[] }
  | { kind: "ask"; signIn: SignIn }
> {
  return inVault(async () => {
    const kept = await keptFor(site);
    if (!kept.length) return { kind: "none" as const, kept: await keptSites() };
    const named = account?.trim();
    const one = named
      ? kept.find((each) => each.account === named)
      : kept.length === 1
        ? kept[0]
        : undefined;
    if (!one)
      return {
        kind: "pick" as const,
        site: kept[0].site,
        accounts: kept.map((each) => each.account),
      };
    if (!one.bots.includes(bot)) {
      if (!one.asking.includes(bot))
        await write({ ...one, asking: [...one.asking, bot] });
      return { kind: "ask" as const, signIn: record(one) };
    }
    const used = { ...one, usedAt: new Date().toISOString() };
    await write(used);
    return { kind: "state" as const, signIn: record(used), state: one.state };
  });
}

/** A participant's session as the browser CLI lists it, or null when it has none open. */
async function listedBrowser(
  sandbox: Sandbox,
  env: Record<string, string>,
): Promise<ListedBrowser | null> {
  const browsers = await listBrowsers(sandbox, env);
  return browsers.find((b) => b.name === env.PLAYWRIGHT_CLI_SESSION) ?? null;
}

/**
 * Whose browser a participant's session drives: its own, or the user's Chrome it attached
 * to. Theirs holds every site they are signed in to, so its state is never read out.
 */
export async function sessionBrowser(
  sandbox: Sandbox,
  env: Record<string, string>,
): Promise<"own" | "theirs" | null> {
  const open = await listedBrowser(sandbox, env);
  if (!open) return null;
  return open.attached ? "theirs" : "own";
}

/** Whether a participant's own browser is a window on the user's screen. */
export async function sessionWindow(
  sandbox: Sandbox,
  env: Record<string, string>,
): Promise<boolean> {
  const open = await listedBrowser(sandbox, env);
  return !!open && !open.attached && open.headed === true;
}

/**
 * What the app does to one participant's browser — lend a sign-in, keep one, renew what it
 * holds — runs one at a time. Two at once, a turn's renewal still running as the next turn
 * lends, or two sign-ins lent in one step, would read one sign-in's cookies while the
 * browser already holds the other's, and write them into the wrong file. A bot's own
 * commands are not in the lane; the mark is what catches those (renewHeld).
 */
const browserLane = ((
  globalThis as typeof globalThis & {
    __signInsBrowser?: ReturnType<typeof createKeyedLock>;
  }
).__signInsBrowser ??= createKeyedLock());

export const inBrowser = <T>(
  env: Record<string, string>,
  work: () => Promise<T>,
) => browserLane(env.PLAYWRIGHT_CLI_SESSION ?? "", work);

/**
 * The kept sign-ins each browser holds because the app put them there (`sign_in_use`) or took
 * them from it (`sign_in_keep`), by its CLI session, with the bot it is for: per site, the
 * account, since a site's cookies carry one session at a time. Renewal reads back these
 * alone: a browser that only visited a site holds a visitor's cookies under the same names (a
 * shop's PHPSESSID, a CSRF token), and copied back they would sign every bot out. `mark` is
 * what the app set on that browser when it did (`setMark`): an `open` in the same session
 * starts another browser under the same name, and what that one holds was never lent. Kept in
 * memory, pinned to globalThis so the tool that notes and the run that renews share one map
 * across a dev reload; after a restart nothing is renewed until a sign-in is loaded again.
 */
type Hold = { bot: string; mark: string; sites: Map<string, string> };
type Held = Map<string, Hold>;
const holding: Held = ((
  globalThis as typeof globalThis & { __signInsLentByAccount?: Held }
).__signInsLentByAccount ??= new Map());

/**
 * Set on the browser's own context through the CLI's `run-code`, which runs in the process
 * that holds the browser: it lasts as long as that browser, and the one the next `open`
 * starts under the same session does not have it. It lives in that process alone, never in
 * the browser's storage, so no site sees it and no saved state carries it.
 */
const MARK = "__thursdaySignIns";

/** The mark on a participant's browser; null when it has none, undefined when it cannot be read. */
async function readMark(
  sandbox: Sandbox,
  env: Record<string, string>,
): Promise<string | null | undefined> {
  const read = await sandbox.exec(
    `playwright-cli --raw run-code "async page => page.context().${MARK} ?? null"`,
    { env, timeoutMs: BROWSER_CLI.readMs },
  );
  if (read.exitCode !== 0) return undefined;
  try {
    const mark = JSON.parse(read.stdout) as unknown;
    return typeof mark === "string" ? mark : null;
  } catch {
    return undefined;
  }
}

/**
 * Whether this process has seen a mark set in one command read back in the next: a CLI that
 * stopped keeping one context between commands would lose every mark, and every renewal after
 * would be skipped without a word. Once seen, a set that succeeds is taken at its word.
 */
let marksLast = false;

async function setMark(
  sandbox: Sandbox,
  env: Record<string, string>,
  mark: string,
): Promise<boolean> {
  const set = await sandbox.exec(
    `playwright-cli --raw run-code "async page => { page.context().${MARK} = '${mark}'; return true; }"`,
    { env, timeoutMs: BROWSER_CLI.readMs },
  );
  if (set.exitCode !== 0) return false;
  if (marksLast) return true;
  marksLast = (await readMark(sandbox, env)) === mark;
  return marksLast;
}

/**
 * Notes that this participant's browser holds a kept sign-in, for `bot`, and marks the
 * browser. `loaded`: `state-load` replaced its whole storage (Playwright clears every cookie
 * before it adds the state's), so it holds that sign-in alone. `kept`: taken from what it
 * holds, which stays, so what the app lent it before is still held — while it is still the
 * browser the app marked — but for this site, which it holds as this account now.
 */
export async function holdSignIn(
  sandbox: Sandbox,
  env: Record<string, string>,
  bot: string,
  signIn: Pick<SignIn, "site" | "account">,
  how: "loaded" | "kept",
): Promise<void> {
  const key = env.PLAYWRIGHT_CLI_SESSION;
  if (!key) return;
  const held = holding.get(key);
  if (
    how === "kept" &&
    held?.bot === bot &&
    (await readMark(sandbox, env)) === held.mark
  ) {
    held.sites.set(signIn.site, signIn.account);
    return;
  }
  const mark = randomUUID().replaceAll("-", "");
  if (await setMark(sandbox, env, mark)) {
    holding.set(key, {
      bot,
      mark,
      sites: new Map([[signIn.site, signIn.account]]),
    });
    return;
  }
  holding.delete(key);
  logger.warn(
    `sign-ins: ${key}'s browser could not be marked, so ${signIn.site} is not renewed from it`,
  );
}

/**
 * Someone just signed in to `site` in this participant's browser: what it holds for that site
 * is that sign-in, whoever it is, and no longer the kept one the app lent it.
 */
export function releaseSignIn(env: Record<string, string>, site: string) {
  const held = holding.get(env.PLAYWRIGHT_CLI_SESSION ?? "");
  if (!held) return;
  const asked = siteOf(site);
  for (const one of [...held.sites.keys()])
    if (one === asked || asked.endsWith(`.${one}`) || one.endsWith(`.${asked}`))
      held.sites.delete(one);
}

/** This participant's browser holds nothing the app can vouch for: a load into it failed part way. */
export function forgetBrowser(env: Record<string, string>) {
  holding.delete(env.PLAYWRIGHT_CLI_SESSION ?? "");
}

/**
 * The browser was closed and opened again with the same storage loaded back (the sign-in
 * window going, ai/tools/signin.tool): it holds what the last one held, so it takes its mark.
 */
export async function carryHold(
  sandbox: Sandbox,
  env: Record<string, string>,
): Promise<void> {
  const key = env.PLAYWRIGHT_CLI_SESSION ?? "";
  const held = holding.get(key);
  if (held && !(await setMark(sandbox, env, held.mark))) holding.delete(key);
}

type Cookie = { name: string; domain: string; path: string; value: string };
type State = { cookies?: Cookie[] };

const cookieKey = (cookie: Cookie) =>
  `${cookie.name}\n${cookie.domain}\n${cookie.path}`;

/**
 * A site renews its session cookies while the session is used, and the copy kept here goes
 * stale: lent again, it can be refused, or end the session it was copied from. So this
 * participant's browser's cookies go back into the kept sign-ins it holds (`holdSignIn`) and
 * its bot may still use — only the cookies a sign-in already holds (same name, domain and
 * path), so a browser that signed out changes nothing, and only from the browser the app
 * marked, read before the cookies are taken and again after. Run after every turn
 * (renewSignIns) and before a sign-in is lent (ai/tools/signin.tool), always inside
 * `inBrowser`. One attached to the user's own Chrome is theirs and is not read.
 */
export async function renewHeld(
  sandbox: Sandbox,
  env: Record<string, string>,
): Promise<void> {
  const key = env.PLAYWRIGHT_CLI_SESSION ?? "";
  const held = holding.get(key);
  if (!held?.sites.size) return;
  if ((await sessionBrowser(sandbox, env)) !== "own") {
    // Closed, or theirs now: what it held went with it
    holding.delete(key);
    return;
  }
  // Unreadable: nothing is copied from a browser the app cannot tell, and it is asked again
  // next time. Another mark, or none: another browser under the same session, started by
  // `open`, which was never lent anything
  const marked = async () => {
    const mark = await readMark(sandbox, env);
    if (mark !== undefined && mark !== held.mark) holding.delete(key);
    return mark === held.mark;
  };
  if (!(await marked())) return;

  const path = browserStateFile();
  let now: Map<string, Cookie>;
  try {
    const saved = await sandbox.exec(saveBrowserState(path), {
      env,
      timeoutMs: BROWSER_CLI.loadMs,
    });
    if (saved.exitCode !== 0) return;
    const state = JSON.parse(await sandbox.readFile(path, "utf-8")) as State;
    now = new Map((state.cookies ?? []).map((c) => [cookieKey(c), c]));
  } finally {
    await sandbox.exec(`rm -f ${path}`);
  }
  // A bot's own `open` between the two reads started another browser: what was taken is its
  if (holding.get(key) !== held || !(await marked())) return;

  for (const [site, account] of held.sites)
    await inVault(async () => {
      const kept = await read(site, account);
      const state = kept?.state as State | undefined;
      if (!kept || !state?.cookies || !kept.bots.includes(held.bot)) return;
      let renewed = false;
      const cookies = state.cookies.map((cookie) => {
        const fresh = now.get(cookieKey(cookie));
        if (!fresh || JSON.stringify(fresh) === JSON.stringify(cookie))
          return cookie;
        renewed = true;
        return fresh;
      });
      if (renewed) await write({ ...kept, state: { ...state, cookies } });
    });
}

/** After a bot's turn: `session` is the participant's (workspace botBrowserSession). */
export async function renewSignIns(session: string): Promise<void> {
  const env = jobShellEnv(session);
  if (!holding.get(env.PLAYWRIGHT_CLI_SESSION ?? "")?.sites.size) return;
  const sandbox = await openWorkspace();
  await inBrowser(env, () => renewHeld(sandbox, env));
}

/** The user's say on one bot: let in, or not any more. Only the screen calls this. */
export function setSignInBot(
  site: string,
  account: string,
  bot: string,
  on: boolean,
): Promise<void> {
  return inVault(async () => {
    const kept = await read(site, account);
    if (!kept) return;
    await write({
      ...kept,
      bots: on
        ? [...new Set([...kept.bots, bot])]
        : kept.bots.filter((one) => one !== bot),
      asking: kept.asking.filter((one) => one !== bot),
    });
  });
}

/**
 * Signs out of one account as far as the app can: what is kept for it goes, in its own file
 * and in an older one still holding it, and the site's other accounts stay. The site may
 * still list the session.
 */
export function removeSignIn(site: string, account: string): Promise<void> {
  return inVault(async () => {
    await rm(fileOf(site, account), { force: true });
    await dropOlder(site, account);
    changed();
  });
}

/**
 * Sessions bots kept in their own folders before the vault (`bots/<name>/.auth/*.json`, as
 * the browser skill used to say) are taken in under the file's name and removed from the
 * workspace, where every bot's shell could read them. Once, at boot; nothing to do after.
 * One for an account the site does not keep yet is kept beside the others, since nobody is
 * there to say whether it is another name for one of them.
 */
export async function adoptKeptSessions(): Promise<void> {
  const root = join(WORKSPACE, PATHS.bots);
  for (const bot of await readdir(root).catch(() => [] as string[])) {
    const folder = join(root, bot, ".auth");
    for (const name of await readdir(folder).catch(() => [] as string[])) {
      if (!name.endsWith(".json")) continue;
      const path = join(folder, name);
      try {
        const state = JSON.parse(await readFile(path, "utf8")) as unknown;
        const site = name.slice(0, -5);
        const account = (
          await readFile(join(folder, "account.txt"), "utf8").catch(() => "")
        ).trim();
        let kept = await keepSignIn({ site, account, bot, state });
        if (kept.kind === "unlisted")
          kept = await keepSignIn({ site, account, bot, state, another: true });
        if (kept.kind !== "kept" && kept.kind !== "taken")
          throw new Error(`${site} (${account}) could not be told apart`);
        await rm(path);
        logger.info(
          kept.kind === "kept"
            ? `sign-ins: took in ${bot}'s ${site}`
            : `sign-ins: ${site} is kept for another bot already; ${bot}'s old copy was removed and ${bot} is asking for it`,
        );
      } catch (cause) {
        logger.warn(`sign-ins: could not take in ${path}`, cause);
      }
    }
  }
}
