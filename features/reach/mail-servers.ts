import { Resolver } from "node:dns/promises";
import { REACH } from "@/config";
import { publicError } from "@/lib/public-error";

/**
 * Where a mailbox is read and sent through, found the way mail services publish it for any
 * app: DNS SRV records (RFC 6186, and RFC 8314 for sending over TLS from the start). A service
 * that publishes none — most company domains, some services — has its servers typed in.
 */

export type MailServer = { host: string; port: number };

/**
 * DNS as the system has it now. A resolver keeps the servers it was made with — the process's
 * own default one too — and a laptop changes networks under a server that stays up: a VPN on
 * or off, another Wi-Fi. So one is made for each thing looked up, never kept.
 */
export const systemResolver = () =>
  new Resolver({ timeout: REACH.mailDnsMs, tries: 1 });

/** Reading mail over TLS from the start; any other port must offer STARTTLS (email.ts). */
export const IMAP_TLS_PORT = 993;
/** Sending mail over TLS from the start; any other port must offer STARTTLS (email.ts). */
export const SMTP_TLS_PORT = 465;

export const serverWords = (server: MailServer) =>
  `${server.host}:${server.port}`;

/** `host:port` as it is kept, or null when it is not one. */
export function parseServer(value: string): MailServer | null {
  const at = value.trim().lastIndexOf(":");
  if (at < 1) return null;
  const host = value.trim().slice(0, at).toLowerCase();
  const port = Number(value.trim().slice(at + 1));
  if (
    !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(
      host,
    )
  )
    return null;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
  return { host, port };
}

/** The part of an address after its last `@`. */
export const domainOf = (address: string) =>
  address.slice(address.lastIndexOf("@") + 1).toLowerCase();

/**
 * The servers a domain publishes for reading and sending mail, or null when it publishes
 * either not at all. A lookup that could not be made (no network, a resolver down) is said as
 * one, rather than taken for a domain that publishes nothing.
 */
export async function findMailServers(
  domain: string,
): Promise<{ imap: MailServer; smtp: MailServer } | null> {
  const imap =
    (await srv(`_imaps._tcp.${domain}`, domain)) ??
    (await srv(`_imap._tcp.${domain}`, domain));
  const smtp =
    (await srv(`_submissions._tcp.${domain}`, domain)) ??
    (await srv(`_submission._tcp.${domain}`, domain));
  return imap && smtp ? { imap, smtp } : null;
}

/** DNS answers that mean the record is not published, rather than that DNS could not be asked. */
const NOT_PUBLISHED = new Set(["ENOTFOUND", "ENODATA", "ENONAME"]);

/**
 * The record the domain prefers (lowest priority, then highest weight). A target of "." is
 * the domain saying outright that it offers no such service (RFC 6186 §3.4).
 */
async function srv(name: string, domain: string): Promise<MailServer | null> {
  try {
    const [best] = (await systemResolver().resolveSrv(name))
      .filter((record) => record.name && record.name !== "." && record.port)
      .sort((a, b) => a.priority - b.priority || b.weight - a.weight);
    return best
      ? { host: best.name.replace(/\.$/, "").toLowerCase(), port: best.port }
      : null;
  } catch (cause) {
    const code = (cause as { code?: string }).code ?? "";
    if (NOT_PUBLISHED.has(code)) return null;
    publicError(
      `Could not look up where ${domain}'s mail servers are (${code || String(cause)}). Check the connection and try again.`,
    );
  }
}
