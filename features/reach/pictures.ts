import {
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { APP_DIR, PATHS, REACH } from "@/config";
import { extensionOf } from "@/features/workspace/file-kind";
import { openWorkspace } from "@/features/workspace/workspace";
import { logger } from "@/lib/logger";
import { PromiseChain } from "@/lib/utils";
import type { OutgoingFile } from "./channel";

/**
 * What a page looks like, for a chat that opens no HTML: pictures of it, sent in its place,
 * and for a page made to be read, a PDF of it beside them (pdfOf). A deck's slides and a
 * canvas's boards are one picture each, at their own size; any other page is read from the
 * top, a phone's screen at a time. They are drawn by the renderer the bots shoot with
 * (skills/artifact/runtime/render.mjs), in a headless browser of their own that keeps
 * nothing and is closed once they are drawn.
 */

const RENDER = join(
  APP_DIR,
  PATHS.skills.default,
  "artifact",
  "runtime",
  "render.mjs",
);

/**
 * The screen a page is read on: a phone's width at twice its pixels, so the words are
 * sharp on the phone that shows them. A desktop browser at that size rather than an
 * emulated phone, so a page lays out by its width alone.
 */
const PHONE = { viewport: { width: 412, height: 839 }, deviceScaleFactor: 2 };

/** One drawing at a time: they share one browser session, which each closes when done. */
const inTurn = PromiseChain();

/** Pictures of the file at `full` when it is a page; none for anything else, or when none can be drawn. */
export function picturesOf(full: string): Promise<OutgoingFile[]> {
  if (!isPage(full)) return Promise.resolve([]);
  return inTurn(() =>
    rendered(full, `--out "$OUT" --name "$NAME" --most ${REACH.pictures}`, {
      failed: "no pictures",
      take: async (out) => {
        const names = (await readdir(out))
          .filter((name) => name.endsWith(".png"))
          .sort();
        return Promise.all(
          names.map(async (name) => ({
            bytes: await readFile(join(out, name)),
            name,
            picture: true,
          })),
        );
      },
    }),
  ).catch((cause) => {
    logger.warn(`reach: no pictures of ${basename(full)}`, cause);
    return [];
  });
}

/**
 * The page at `full` as a PDF, by its own print rules, when it is made to be read: a
 * document, a brief, a trip, a digest or a deck says so in its head (`<meta name="print"
 * content="pdf">`, artifact runtime/shell/head.html). Null for anything else — a canvas, a
 * sheet, an app — or when it cannot be printed.
 */
export function pdfOf(full: string): Promise<OutgoingFile | null> {
  if (!isPage(full)) return Promise.resolve(null);
  return inTurn(async () => {
    const mark = await printMark(full);
    if (!mark) return null;
    // A deck's mark names its slide's size: a slide past it is refused, not split in two
    const size = mark.size ? ` --size ${mark.size}` : "";
    return rendered(full, `--pdf "$OUT/$NAME.pdf"${size}`, {
      failed: "not printed",
      take: async (out) => ({
        bytes: await readFile(
          join(out, `${basename(full, extname(full))}.pdf`),
        ),
        name: `${basename(full, extname(full))}.pdf`,
        picture: false,
      }),
    });
  }).catch((cause) => {
    logger.warn(`reach: no PDF of ${basename(full)}`, cause);
    return null;
  });
}

const isPage = (full: string) => ["html", "htm"].includes(extensionOf(full));

/**
 * The mark a page that prints carries in its head, before its styles, with the sheet size
 * a deck gives it; null for a page without one.
 */
async function printMark(full: string) {
  const file = await open(full);
  try {
    const head = Buffer.alloc(4096);
    const { bytesRead } = await file.read(head, 0, head.length, 0);
    const found = /<meta name="print" content="pdf(?: (\d+x\d+))?">/.exec(
      head.subarray(0, bytesRead).toString("utf8"),
    );
    return found ? { size: found[1] ?? "" } : null;
  } finally {
    await file.close();
  }
}

/**
 * The page drawn by the renderer in its shot mode, with `args` after it, in a headless
 * browser of its own that keeps nothing and is closed after; `take` reads what it wrote
 * into the folder `$OUT` before that folder is removed.
 */
async function rendered<T>(
  full: string,
  args: string,
  { failed, take }: { failed: string; take: (out: string) => Promise<T> },
): Promise<T> {
  const out = await mkdtemp(join(tmpdir(), "thursday-pictures-"));
  const config = join(out, "browser.json");
  await writeFile(
    config,
    JSON.stringify({ browser: { contextOptions: PHONE } }),
  );
  // Paths go in as variables, never spelled into the command: a file's name is a bot's choice
  const env = {
    PLAYWRIGHT_CLI_SESSION: "reach-pictures",
    PLAYWRIGHT_MCP_BROWSER: "chromium",
    PLAYWRIGHT_MCP_ISOLATED: "true",
    PLAYWRIGHT_MCP_CONFIG: config,
    RENDER,
    PAGE: full,
    OUT: out,
    NAME: basename(full, extname(full)),
  };
  const sandbox = await openWorkspace();
  try {
    const drawn = await sandbox.exec(`node "$RENDER" "$PAGE" --shot ${args}`, {
      env,
      timeoutMs: REACH.drawMs,
    });
    if (drawn.exitCode !== 0)
      throw new Error(drawn.stderr.trim().split("\n").at(-1) || failed);
    return await take(out);
  } finally {
    await sandbox
      .exec("playwright-cli close", { env, timeoutMs: 15_000 })
      .catch(() => {});
    await rm(out, { recursive: true, force: true });
  }
}
