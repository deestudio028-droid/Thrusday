import { PAGE_DRAFTS } from "@/config";

/**
 * A page's edits its file would not take — the file changed under them, or the save failed —
 * kept aside for that file in this browser's storage, the app's own, since a page the app
 * serves keeps nothing (skills/artifact/runtime/shell/drafts.js is the page's side of it).
 * One set per revision of the file they were written on. A page asks for them as it opens
 * (FileFrame), holds its own when a save does not land, and lets a set go once it is saved
 * or the reader dismisses it; nothing here lets one go by itself.
 */
export type PageDraft = { base: string; html: string; at: number };

/** What a page asks of its file's kept edits: to hold a set, let one go, or only to see them. */
export type DraftAsk = { hold?: unknown; drop?: unknown };

const KEY = "thursday-page-drafts:";

/** A revision as head.html names one: a few hex characters, or none on a page from before them. */
const BASE = /^[0-9a-f]{0,32}$/;

const isDraft = (value: unknown): value is PageDraft => {
  const one = value as PageDraft | null;
  return (
    typeof one === "object" &&
    one !== null &&
    typeof one.base === "string" &&
    BASE.test(one.base) &&
    typeof one.html === "string" &&
    Number.isFinite(one.at)
  );
};

/** The kept edits after `ask`, or why it cannot be done. */
export function draftsAfter(
  list: PageDraft[],
  ask: DraftAsk,
): PageDraft[] | string {
  let next = list;
  if (typeof ask.drop === "string")
    next = next.filter((one) => one.base !== ask.drop);
  if (ask.hold === undefined) return next;
  if (!isDraft(ask.hold)) return "not a page's edits";
  const { base, html, at } = ask.hold;
  next = [...next.filter((one) => one.base !== base), { base, html, at }];
  if (next.length > PAGE_DRAFTS.perFile)
    return `${PAGE_DRAFTS.perFile} sets of this page's edits are kept aside already`;
  if (next.reduce((n, one) => n + one.html.length, 0) > PAGE_DRAFTS.chars)
    return "too large to keep aside";
  return next;
}

/**
 * The answer to a page's `drafts` message for the file at `path`: its kept edits after the
 * ask, or why they could not be kept. `storage` is null where this browser keeps nothing.
 */
export function answerDrafts(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null,
  path: string,
  ask: DraftAsk,
): { drafts: PageDraft[] } | { error: string } {
  if (!storage) return { error: "this browser keeps nothing" };
  const key = `${KEY}${path}`;
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { error: "this browser keeps nothing" };
  }
  let list: PageDraft[] = [];
  try {
    const kept: unknown = JSON.parse(raw ?? "[]");
    if (Array.isArray(kept)) list = kept.filter(isDraft);
  } catch {
    // Not what this file writes: nothing kept there to read
  }
  const next = draftsAfter(list, ask);
  if (typeof next === "string") return { error: next };
  if (ask.hold !== undefined || ask.drop !== undefined) {
    try {
      if (next.length) storage.setItem(key, JSON.stringify(next));
      else storage.removeItem(key);
    } catch {
      return { error: "this browser has no room left to keep them" };
    }
  }
  return { drafts: next };
}
