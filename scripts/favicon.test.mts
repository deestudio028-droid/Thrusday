import assert from "node:assert/strict";
import { after, test } from "node:test";

// A site's icon as this server fetches it (lib/favicon), the sites themselves stood in for:
// what a site answered is kept, and a site that could not be asked is asked again.
type Answer = Response | Error;
/** What each URL answers, and how often it was asked. */
const sites = new Map<string, () => Answer>();
const asked: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  asked.push(url);
  const answer = sites.get(url)?.() ?? new Response(null, { status: 404 });
  if (answer instanceof Error) throw answer;
  return answer;
}) as typeof fetch;
after(() => {
  globalThis.fetch = realFetch;
});

const { FAVICON } = await import("../config.ts");
const { readFavicon, Unreached } = await import("../lib/favicon.ts");

const icon = () =>
  new Response(new Uint8Array([1, 2, 3]), {
    headers: { "content-type": "image/x-icon" },
  });
/** A fetch that never got an answer, as under a VPN whose certificate Node does not trust. */
const untrusted = () =>
  Object.assign(new TypeError("fetch failed"), {
    cause: { code: "SELF_SIGNED_CERT_IN_CHAIN" },
  });

test("a site that could not be asked is not taken to have no icon, and is asked again", async () => {
  const url = "https://chat.example/favicon.ico";
  sites.set(url, untrusted);
  await assert.rejects(readFavicon("chat.example"), Unreached);
  // Left alone for a while, so a page full of chips does not ask a dead network over and over
  const before = asked.length;
  await assert.rejects(readFavicon("chat.example"), Unreached);
  assert.equal(asked.length, before);

  // The network is back: no restart, and the icon is there
  (FAVICON as { againMs: number }).againMs = 0;
  sites.set(url, icon);
  const found = await readFavicon("chat.example");
  assert.equal(found?.type, "image/x-icon");
  assert.equal(found?.body.byteLength, 3);

  const after = asked.length;
  await readFavicon("chat.example");
  assert.equal(asked.length, after, "what it answered is kept");
});

test("a site that answers with no icon is kept as having none", async () => {
  sites.set(
    "https://plain.example/",
    () =>
      new Response("<html><head></head></html>", {
        headers: { "content-type": "text/html" },
      }),
  );
  assert.equal(await readFavicon("plain.example"), null);
  const before = asked.length;
  assert.equal(await readFavicon("plain.example"), null);
  assert.equal(asked.length, before, "it said so once, and is not asked again");
});
