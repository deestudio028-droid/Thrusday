import { envWords } from "@/features/config/config.const";
import {
  configFromEnv,
  readConfig,
  removeConfig,
  writeConfig,
} from "@/features/config/config.query";
import { publicError } from "@/lib/public-error";
import { EMAIL_SEEN_KEY } from "./email";
import {
  domainOf,
  findMailServers,
  type MailServer,
  parseServer,
  serverWords,
} from "./mail-servers";
import { startReach } from "./reach";
import {
  EMAIL_ADDRESS_KEY,
  EMAIL_IMAP_KEY,
  EMAIL_PASSWORD_KEY,
  EMAIL_SMTP_KEY,
  REACH_KEYS,
  reachPersonKey,
} from "./reach.schema";

/**
 * Settings › Phone › Email, step 2: a mailbox of Thursday's own, saved whole — address, app
 * password and the two servers — so the channel starts once, with all of it. The servers are
 * what the address's domain publishes (mail-servers), or what the user typed where it
 * publishes none.
 */

export type MailboxSaved =
  | { found: true; imap: string; smtp: string }
  /** The domain publishes no servers: the screen asks for them. Nothing was saved. */
  | { found: false };

export async function saveMailbox(input: {
  address: string;
  password: string;
  imap?: string;
  smtp?: string;
}): Promise<MailboxSaved> {
  for (const key of REACH_KEYS.email)
    if (configFromEnv(key)) publicError(envWords("Email's mailbox"));
  const address = input.address.trim();
  const typed = input.imap?.trim() || input.smtp?.trim();
  const servers = typed
    ? {
        imap: typedServer(input.imap, "reading"),
        smtp: typedServer(input.smtp, "sending"),
      }
    : await findMailServers(domainOf(address));
  if (!servers) return { found: false };

  const named = await readConfig(reachPersonKey("email"));
  if (named && JSON.parse(named).chat === address.toLowerCase())
    publicError(
      "That is the address you write to her from. Her mailbox needs an address of its own.",
    );
  await writeConfig(EMAIL_ADDRESS_KEY, address);
  await writeConfig(EMAIL_PASSWORD_KEY, input.password.trim());
  await writeConfig(EMAIL_IMAP_KEY, serverWords(servers.imap));
  await writeConfig(EMAIL_SMTP_KEY, serverWords(servers.smtp));
  await startReach("email");
  return {
    found: true,
    imap: serverWords(servers.imap),
    smtp: serverWords(servers.smtp),
  };
}

/** Her mailbox, and everything kept with it: where it was read up to, and who could write. */
export async function removeMailbox(): Promise<void> {
  for (const key of REACH_KEYS.email)
    if (configFromEnv(key)) publicError(envWords("Email's mailbox"));
  for (const key of REACH_KEYS.email) await removeConfig(key);
  await removeConfig(EMAIL_SEEN_KEY);
  // No keys left: the channel stops, and whoever was named goes with it
  await startReach("email");
}

function typedServer(value: string | undefined, what: string): MailServer {
  const server = parseServer(value ?? "");
  if (!server)
    publicError(
      `Type the ${what} server as its name and port, like mail.example.com:${what === "reading" ? 993 : 465}.`,
    );
  return server;
}
