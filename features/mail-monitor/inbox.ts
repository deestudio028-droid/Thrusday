import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { MAIL_MONITOR } from "@/config";
import { readConfig } from "@/features/config/config.query";
import { parseServer } from "@/features/reach/mail-servers";

export type InboxMail = {
  uid: number;
  from: string;
  subject: string;
  text: string;
};
export async function withInbox<T>(
  use: (client: ImapFlow, address: string) => Promise<T>,
): Promise<T> {
  const [address, password, server] = await Promise.all([
    readConfig("EMAIL_ADDRESS"),
    readConfig("EMAIL_APP_PASSWORD"),
    readConfig("EMAIL_IMAP_SERVER"),
  ]);
  const imap = parseServer(server ?? "");
  if (!address || !password || !imap)
    throw new Error("Connect the mailbox in Settings > Phone first.");
  const client = new ImapFlow({
    host: imap.host,
    port: imap.port,
    secure: imap.port === 993,
    ...(imap.port === 993 ? {} : { doSTARTTLS: true }),
    auth: { user: address, pass: password },
    logger: false,
    maxLiteralSize: MAIL_MONITOR.sourceBytes,
    connectionTimeout: MAIL_MONITOR.ioMs,
    socketTimeout: MAIL_MONITOR.ioMs,
  });
  client.on("error", () => {});
  try {
    await client.connect();
    await client.mailboxOpen("INBOX", { readOnly: true });
    return await use(client, address);
  } finally {
    if (client.usable) await client.logout().catch(() => client.close());
    else client.close();
  }
}
export async function readInboxMail(
  client: ImapFlow,
  uid: number,
): Promise<InboxMail> {
  const meta = await client.fetchOne(
    uid,
    { envelope: true, size: true },
    { uid: true },
  );
  if (!meta) throw new Error("This inbox message no longer exists.");
  const source =
    meta.size !== undefined && meta.size <= MAIL_MONITOR.sourceBytes
      ? await client.fetchOne(uid, { source: true }, { uid: true })
      : false;
  const parsed =
    source && source.source
      ? await simpleParser(source.source, {
          skipImageLinks: true,
          skipTextToHtml: true,
        })
      : null;
  return {
    uid,
    from: meta.envelope?.from?.map((one) => one.address ?? "").join(", ") ?? "",
    subject: meta.envelope?.subject ?? "",
    text:
      parsed?.text?.slice(0, MAIL_MONITOR.textChars) ??
      "[Body unavailable or too large; assess only the subject and sender.]",
  };
}
export async function searchInbox(input: {
  from?: string;
  subject?: string;
  uid?: number;
}) {
  return withInbox(async (client) => {
    if (input.uid)
      return { messages: [await readInboxMail(client, input.uid)] };
    const found = await client.search(
      {
        ...(input.from ? { from: input.from } : {}),
        ...(input.subject ? { subject: input.subject } : {}),
        all: !input.from && !input.subject,
      },
      { uid: true },
    );
    const ids = (found || []).slice(-MAIL_MONITOR.batch).reverse();
    const messages = [];
    for (const uid of ids) messages.push(await readInboxMail(client, uid));
    return { messages };
  });
}
