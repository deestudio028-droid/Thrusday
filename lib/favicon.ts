import { FAVICON } from "@/config";

/**
 * A site's icon, asked for by this server (config FAVICON). Only a public host name is
 * fetched — letters and dots with a letter TLD, never an address or `localhost` — so a
 * page's URL cannot turn this into a way to reach the machine's own network. What a site
 * answered, icon or nothing, is kept for the life of the process. A site that could not be
 * asked at all (`Unreached`) answered nothing, so nothing is kept: it is asked again.
 */
export type Favicon = { body: ArrayBuffer; type: string };

const HOST =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Some sites refuse a request that names no browser at all. */
const AGENT = "Mozilla/5.0 (compatible; thursday-agent favicon)";

const kept = new Map<string, Favicon | null>();

/**
 * The site could not be asked: no network, a name that does not resolve just now, a wait that
 * ran out, a certificate this machine does not trust (a VPN that reads the traffic). That is
 * the computer's moment, not the site's answer — kept as "no icon", every site asked while a
 * VPN was on stayed without one until the server restarted.
 */
export class Unreached extends Error {}

/** Sites that could not be asked, and when: left alone for FAVICON.againMs, then asked again. */
const unreached = new Map<string, number>();

/** One more under the cap, the oldest going first. */
function keep<V>(map: Map<string, V>, name: string, value: V) {
  if (!map.has(name) && map.size >= FAVICON.kept) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(name, value);
}

/** The site's icon, or null when it has none. Throws `Unreached` when it could not be asked. */
export async function readFavicon(host: string): Promise<Favicon | null> {
  const name = host.trim().toLowerCase().replace(/\.$/, "");
  if (!HOST.test(name) || name.endsWith(".local")) return null;
  if (kept.has(name)) return kept.get(name) ?? null;
  const missed = unreached.get(name);
  if (missed !== undefined && Date.now() - missed < FAVICON.againMs)
    throw new Unreached(name);

  let found: Favicon | null;
  try {
    found = await fetchIcon(name);
  } catch (cause) {
    keep(unreached, name, Date.now());
    throw new Unreached(name, { cause });
  }
  unreached.delete(name);
  keep(kept, name, found);
  return found;
}

/**
 * `/favicon.ico` first; a site without one names its icon in its front page's head
 * (`<link rel="icon" href>`), read from the first FAVICON.pageBytes of it. The icon
 * it names is fetched only from a public host, like the site itself. A fetch that fails
 * before any answer throws, for readFavicon to tell from a site that answered with none.
 */
async function fetchIcon(host: string): Promise<Favicon | null> {
  const direct = await fetchImage(`https://${host}/favicon.ico`);
  if (direct) return direct;
  const named = await namedIcon(host);
  return named ? fetchImage(named) : null;
}

/**
 * A fetch that follows a redirect only to another public https host, as the first one had to
 * be: left to follow on its own, a public page redirecting to an address on the machine's own
 * network was fetched from here.
 */
async function publicFetch(
  url: string,
  init: RequestInit,
  hops = 3,
): Promise<Response | null> {
  let at = url;
  for (let hop = 0; hop <= hops; hop++) {
    const response = await fetch(at, { ...init, redirect: "manual" });
    if (response.status < 300 || response.status > 399) return response;
    const next = response.headers.get("location");
    if (!next) return null;
    const target = new URL(next, at);
    const name = target.hostname.toLowerCase();
    if (
      target.protocol !== "https:" ||
      !HOST.test(name) ||
      name.endsWith(".local")
    )
      return null;
    at = target.href;
  }
  return null;
}

async function fetchImage(url: string): Promise<Favicon | null> {
  const response = await publicFetch(url, {
    signal: AbortSignal.timeout(FAVICON.timeoutMs),
    headers: { accept: "image/*", "user-agent": AGENT },
  });
  if (!response?.ok) return null;
  const type = response.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) return null;
  const body = await response.arrayBuffer();
  if (!body.byteLength || body.byteLength > FAVICON.maxBytes) return null;
  return { body, type };
}

/** The icon a front page names, as an absolute https URL on a public host. */
async function namedIcon(host: string): Promise<string | null> {
  const response = await publicFetch(`https://${host}/`, {
    signal: AbortSignal.timeout(FAVICON.timeoutMs),
    headers: { accept: "text/html", "user-agent": AGENT },
  });
  if (!response?.ok || !response.body) return null;
  // The head is at the top; the rest of the page is never read
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let html = "";
  while (html.length < FAVICON.pageBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
  }
  void reader.cancel().catch(() => {});

  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/\brel=["']?[^"'>]*\bicon\b/i.test(tag)) continue;
    const href = /\bhref=["']?([^"'\s>]+)/i.exec(tag)?.[1];
    if (!href) continue;
    try {
      const url = new URL(href, response.url || `https://${host}/`);
      if (url.protocol === "https:" && HOST.test(url.hostname)) return url.href;
    } catch {
      // not a URL: the next link
    }
  }
  return null;
}
