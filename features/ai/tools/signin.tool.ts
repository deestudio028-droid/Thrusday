import { type ToolSet, tool } from "ai";
import * as z from "zod";
import { BROWSER_CLI } from "@/config";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import {
  borrowSignIn,
  carryHold,
  forgetBrowser,
  holdSignIn,
  inBrowser,
  keepSignIn,
  releaseSignIn,
  renewHeld,
  sessionBrowser,
  sessionWindow,
} from "@/features/signins/signins.query";
import { type SignIn, siteOf } from "@/features/signins/signins.schema";
import {
  browserStateFile,
  saveBrowserState,
} from "@/features/workspace/workspace";
import { logger } from "@/lib/logger";
import type { Sandbox } from "@/lib/sandbox";

/**
 * A bot's two hands on the sign-ins the app keeps (signins.query): borrow one into its own
 * browser, keep the one the user just made. The session itself never passes through the
 * model or stays among the bot's files — it crosses the workspace as a file that exists for
 * one command, because the browser CLI reads and writes state by path. Whether a bot may
 * borrow a sign-in is the user's say and is settled on screen, never by what a tool is told.
 */

const SITE = z
  .string()
  .describe("The site's address, like instagram.com. No path, no https://.");

export function createSignInTools(
  sandbox: Sandbox,
  bot: string,
  /** This participant's browser session (workspace jobShellEnv): the state goes into, and comes out of, its own browser. */
  env: Record<string, string>,
): ToolSet {
  const cli = async (command: string) => {
    const ran = await sandbox.exec(command, {
      env,
      timeoutMs: BROWSER_CLI.loadMs,
    });
    return ran.exitCode === 0
      ? null
      : (ran.stderr || ran.stdout).trim().slice(0, 300) ||
          `exit ${ran.exitCode}`;
  };

  /**
   * The window a sign-in was made in goes, and the job's browser goes on without one, signed
   * in, on the page it was on. A browser cannot turn headless, so it is closed and opened
   * again with the sign-in loaded from `state` (a state file standing at that path).
   */
  const hideWindow = async (
    state: string,
    signIn: Pick<SignIn, "site" | "account">,
  ): Promise<string> => {
    if (!(await sessionWindow(sandbox, env).catch(() => false))) return "";
    const at = await sandbox.exec(
      `playwright-cli --raw run-code "async page => page.url()"`,
      { env, timeoutMs: BROWSER_CLI.readMs },
    );
    let url = "";
    try {
      url = String(JSON.parse(at.stdout));
    } catch {}
    const reopened =
      (await cli("playwright-cli close")) ??
      (await cli("playwright-cli open")) ??
      (await cli(`playwright-cli state-load ${state}`));
    // The same storage is back in a new browser, so it holds what the last one did
    if (reopened) forgetBrowser(env);
    else await carryHold(sandbox, env);
    const failed =
      reopened ??
      (/^https?:/.test(url)
        ? await cli(`playwright-cli goto '${url.replaceAll("'", "'\\''")}'`)
        : null);
    const use = `\`${TOOL_NAMES.sign_in_use}\` with ${signIn.site} and \`account\` ${signIn.account}`;
    return failed
      ? `The window closed, but your browser did not come back signed in: ${failed}. Open it (\`playwright-cli open\`) and call ${use}.`
      : `The window was for the sign-in, so it is closed: your browser goes on without one, signed in, on the same page. When what comes next is theirs to see, open it \`--headed\` and call ${use} again.`;
  };

  return {
    [TOOL_NAMES.sign_in_use]: tool({
      description:
        "Sign your browser in to a site with a sign-in the user already made and the app kept. Open your browser first: the sign-in goes into the browser you have open, and opening another one afterwards throws it away.",
      inputSchema: z.object({
        site: SITE,
        account: z
          .string()
          .nullish()
          .describe(
            "Which of the site's accounts, as the app names them, when it keeps more than one.",
          ),
      }),
      execute: ({ site, account }) =>
        inBrowser(env, async () => {
          // A kept session loaded into their Chrome would replace the one they are signed in with
          if ((await sessionBrowser(sandbox, env)) === "theirs")
            return "You are working in their own Chrome: it is already signed in as them, and nothing is loaded into it. Go to the site.";
          // What the app lent this browser goes back first: loading clears every cookie it
          // holds, and the account asked for may be the one it holds, renewed since it was read
          await renewHeld(sandbox, env).catch((cause) =>
            logger.warn(`${bot}: kept sign-ins were not renewed`, cause),
          );
          const found = await borrowSignIn(site, bot, account);
          if (found.kind === "none")
            return found.kept.length
              ? `Nothing is kept for ${siteOf(site)}. Kept: ${found.kept.join(", ")} — call again with one of those if it is the same site. Otherwise open the site's sign-in page in a window they can see, ask them to sign in there, and call \`${TOOL_NAMES.sign_in_keep}\` once they have.`
              : `Nothing is kept for ${siteOf(site)}. Open its sign-in page in a window they can see, ask them to sign in there, and call \`${TOOL_NAMES.sign_in_keep}\` once they have.`;
          if (found.kind === "pick")
            return account?.trim()
              ? `Nothing is kept for ${found.site} as ${account.trim()}. Kept there: ${found.accounts.join(", ")} — call again with one of those as it is written. For another account, open the site's sign-in page in a new browser they can see (\`playwright-cli open <its sign-in url> --headed\`), ask them to sign in there, and call \`${TOOL_NAMES.sign_in_keep}\` once they have.`
              : `${found.site} keeps more than one account: ${found.accounts.join(", ")}. Call again with \`account\`, the one this work is for; when the user has not said which, ask them.`;
          if (found.kind === "ask")
            return `The user keeps a ${found.signIn.site} sign-in (${found.signIn.account}) and has not let you use it. Ask them, as a question, whether you may; they allow it on screen. Call again with \`account\` ${found.signIn.account} once they have said yes.`;

          const path = browserStateFile();
          await sandbox.writeFile(path, JSON.stringify(found.state));
          const failed = await cli(`playwright-cli state-load ${path}`).finally(
            () => sandbox.exec(`rm -f ${path}`),
          );
          if (failed) forgetBrowser(env);
          else await holdSignIn(sandbox, env, bot, found.signIn, "loaded");
          return failed
            ? `The sign-in could not be loaded into your browser: ${failed}. Open the browser you mean to keep (\`playwright-cli open …\`, headed if you want a window), then call this again — opening another browser after this throws the sign-in away.`
            : `Signed in to ${found.signIn.site} as ${found.signIn.account}. Go to the site again (\`goto\`) — a page drawn before this still looks signed out. If it still shows you signed out after that, the site does not accept a sign-in carried over from another browser, and signing in again here will not last either: work in their own Chrome instead, \`playwright-cli attach --extension=chrome\`.`;
        }),
    }),

    [TOOL_NAMES.sign_in_keep]: tool({
      description:
        "Keep the sign-in the user just made in your browser window, so later work is signed in without asking them again. Call it right after they say they signed in. The window was for the sign-in: it closes, and your browser goes on without one, signed in, on the same page.",
      inputSchema: z.object({
        site: SITE,
        account: z
          .string()
          .describe(
            "Who it is signed in as, as the site shows it — a handle, an email. The site's name when nothing is shown.",
          ),
        keepWindow: z
          .boolean()
          .nullish()
          .describe(
            "True when what comes next on this site is theirs to see — the products to choose, a checkout to confirm — and the window stays up.",
          ),
        another: z
          .boolean()
          .nullish()
          .describe(
            "True when this is a different account from the ones the app keeps for the site.",
          ),
      }),
      execute: ({ site, account, keepWindow, another }) =>
        inBrowser(env, async () => {
          if ((await sessionBrowser(sandbox, env)) === "theirs")
            return "You are working in their own Chrome: it stays signed in as them by itself, and nothing is kept from it.";
          // They signed in to the site here, as whoever they are: what the app lent this browser for it is gone
          releaseSignIn(env, site);
          const path = browserStateFile();
          const failed = await cli(saveBrowserState(path));
          if (failed) {
            await sandbox.exec(`rm -f ${path}`);
            return `The browser's state could not be read: ${failed}. Nothing was kept.`;
          }
          try {
            const state = JSON.parse(
              await sandbox.readFile(path, "utf-8"),
            ) as unknown;
            const kept = await keepSignIn({
              site,
              account,
              bot,
              state,
              another,
            });
            if (kept.kind === "unlisted")
              return `Not kept yet: ${kept.site} keeps ${kept.accounts.join(", ")}. If they signed in again as one of those, call this again with \`account\` written as it is there; if this is a different account, call again with \`another\` set to true.`;
            if (kept.kind === "clash")
              return `Not kept yet: ${kept.site} keeps a sign-in as ${account.trim() || kept.site} already. If this is that account signed in again, call this again without \`another\`; if it is a different one, call again with an \`account\` that tells it apart from ${kept.accounts.join(", ")} — what the site shows for it, or what the user calls it.`;
            if (kept.kind === "taken")
              return `Not kept: the user already keeps a ${kept.signIn.site} sign-in (${kept.signIn.account}) for other bots, and only they choose who uses it. This browser stays signed in for this job. Ask them, as a question, whether you may use the kept one — they allow it under Settings › Sign-ins — or, if this one should replace it, to sign out of the kept one there first; then call this again.`;
            await holdSignIn(sandbox, env, bot, kept.signIn, "kept");
            const said = `Kept: ${kept.signIn.site} as ${kept.signIn.account}${kept.replaced ? ", in place of the sign-in kept under that name before" : ""}. It is listed for them under Settings › Sign-ins, where they can sign out of it.`;
            return keepWindow
              ? said
              : `${said} ${await hideWindow(path, kept.signIn)}`.trim();
          } finally {
            await sandbox.exec(`rm -f ${path}`);
          }
        }),
    }),
  };
}
