import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, mock, test } from "node:test";
import { pathToFileURL } from "node:url";
import { dkimSign } from "mailauth";
import MailComposer from "nodemailer/lib/mail-composer";

// email.ts's own listening, over a mailbox that is only an object here: what it does with a
// mail whose sender cannot be checked yet — held, said, checked again on the connection that
// stands, refused with the true reason once that has gone on too long. No network, no server.
const home = await mkdtemp(join(tmpdir(), "thursday-mailbox-"));
process.env.THURSDAY_HOME = home;

type Stored = {
  uid: number;
  source: Buffer;
  internalDate: Date;
  /** Who the server says it is from, as its envelope names them. */
  from: string;
};
/** The inbox, and what was asked of it. */
const inbox: Stored[] = [];
const downloads: number[] = [];
let connects = 0;
let current: FakeImap | null = null;
class FakeImap extends EventEmitter {
  usable = true;
  constructor() {
    super();
    current = this;
  }
  async connect() {
    connects++;
  }
  async mailboxOpen() {
    return { uidValidity: BigInt(1), uidNext: (inbox.at(-1)?.uid ?? 0) + 1 };
  }
  async fetchAll(range: string) {
    const from = Number(range.split(":")[0]);
    const found = inbox.filter((one) => one.uid >= from);
    // `n:*` names the newest mail even when it is below n (RFC 3501 §6.4.8)
    return (found.length ? found : inbox.slice(-1)).map((one) => ({
      uid: one.uid,
      size: one.source.length,
      internalDate: one.internalDate,
      envelope: { from: [{ address: one.from }] },
    }));
  }
  async fetchOne(uid: string, query: { source?: boolean }) {
    const one = inbox.find((stored) => stored.uid === Number(uid));
    if (!one) return false;
    if (query.source) downloads.push(one.uid);
    return { uid: one.uid, source: one.source };
  }
  close() {
    if (!this.usable) return;
    this.usable = false;
    this.emit("close");
  }
}
// App code is loaded as CommonJS and this file as a module, and both packages ship a build
// for each: the one the app reaches is the one that must be stood in for, so both are
const require = createRequire(import.meta.url);
for (const at of ["imapflow", pathToFileURL(require.resolve("imapflow")).href])
  mock.module(at, { namedExports: { ImapFlow: FakeImap } });
for (const at of [
  "nodemailer",
  pathToFileURL(require.resolve("nodemailer")).href,
])
  mock.module(at, {
    namedExports: { createTransport: () => ({ verify: async () => true }) },
  });

const { REACH } = await import("../config.ts");
const tuned = REACH as { mailCheckAgainMs: number; mailHoldMs: number };
tuned.mailCheckAgainMs = 20;
const { migrateDatabase } = await import("../database/migrate.ts");
await migrateDatabase();
const { readConfig } = await import("../features/config/config.query.ts");
const { createEmail, EMAIL_SEEN_KEY } = await import(
  "../features/reach/email.ts"
);

after(async () => {
  await rm(home, { recursive: true, force: true });
  // The database's connection holds the process open after the last test
  setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref();
});

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const records = new Map<string, string[][]>([
  [
    "s1._domainkey.example.org",
    [
      [
        `v=DKIM1; k=rsa; p=${publicKey.export({ type: "spki", format: "der" }).toString("base64")}`,
      ],
    ],
  ],
  ["_dmarc.example.org", [["v=DMARC1; p=reject"]]],
]);
/** The sender's records do not answer, as on a network whose DNS is out. */
let down = false;
const resolve = async (name: string) => {
  if (down) throw Object.assign(new Error("timeout"), { code: "ETIMEOUT" });
  const found = records.get(name.toLowerCase());
  if (!found) throw Object.assign(new Error("none"), { code: "ENOTFOUND" });
  return found;
};

const mailbox = "thursday@example.com";
let nextUid = 1;
/** A signed mail from the one who may write arrives, and the server says so. */
async function arrive(subject: string, from = "alex@example.org") {
  const raw = await new MailComposer({
    from: `Alex Kim <${from}>`,
    to: mailbox,
    subject,
    date: new Date(),
    messageId: `<m${nextUid}@example.org>`,
    text: "hello",
  })
    .compile()
    .build();
  const { signatures } = await dkimSign(raw, {
    signatureData: [
      {
        signingDomain: "example.org",
        selector: "s1",
        privateKey: privateKey.export({ type: "pkcs8", format: "pem" }),
      },
    ],
  } as Parameters<typeof dkimSign>[1]);
  inbox.push({
    uid: nextUid++,
    source: Buffer.concat([Buffer.from(signatures), raw]),
    internalDate: new Date(),
    from,
  });
  current?.emit("exists");
}

type Got = { words: string; unproven?: string };
/** Listens as reach does, keeping what it is handed and what it is told is held. */
function listen(wanted: (chat: string) => Promise<boolean> = async () => true) {
  const got: Got[] = [];
  const holding: (string | null)[] = [];
  const stop = new AbortController();
  const done = createEmail(
    mailbox,
    "app-password",
    "imap.example.com:993",
    "smtp.example.com:465",
    resolve,
  ).listen(
    {
      ready() {},
      incoming: (incoming) => void got.push(incoming as Got),
      wanted,
      holding: (why) => {
        if (holding.at(-1) !== why) holding.push(why);
      },
    },
    stop.signal,
  );
  return { got, holding, stop, done };
}
const until = async (what: () => boolean, label: string) => {
  for (let tries = 0; tries < 400 && !what(); tries++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(what(), label);
};
const seenUid = async () =>
  (JSON.parse((await readConfig(EMAIL_SEEN_KEY)) ?? "{}") as { uid?: number })
    .uid;

test("a mail whose sender cannot be checked yet is held, said, and read once it can be", async () => {
  tuned.mailHoldMs = 60_000;
  const heard = listen();
  await until(() => connects === 1, "connected");
  down = true;
  await arrive("First");
  await until(
    () => typeof heard.holding.at(-1) === "string",
    "it is said to be held",
  );
  assert.equal(heard.holding.at(-1), "example.org's records did not answer");
  await arrive("Second");
  // Several checks' worth: nothing is handed over unchecked, and nothing is passed over
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(heard.got.length, 0);
  assert.equal(await seenUid(), 0, "the inbox is read up to before it, still");
  assert.deepEqual(
    downloads,
    [1],
    "held, it is downloaded once, however often it is checked",
  );

  down = false;
  await until(
    () => heard.got.length === 2,
    "both are read once the records answer",
  );
  assert.deepEqual(
    heard.got.map((one) => one.words),
    ["Subject: First\n\nhello", "Subject: Second\n\nhello"],
    "in the order they came",
  );
  assert.ok(heard.got.every((one) => one.unproven === undefined));
  assert.equal(
    heard.holding.at(-1),
    null,
    "and nothing is said to be held any more",
  );
  assert.equal(connects, 1, "all on the connection that stood");
  assert.equal(await seenUid(), 2);
  heard.stop.abort();
  await heard.done;
});

test("held too long, it is refused for what held it, and what came after it is read", async () => {
  tuned.mailHoldMs = 80;
  const heard = listen();
  await until(() => connects === 2, "connected");
  down = true;
  await arrive("Third");
  await until(() => heard.got.length === 1, "given up on, and said so");
  assert.match(
    heard.got[0].unproven ?? "",
    /^Your mail of .+ was not read: its sender could not be checked: example\.org's records did not answer\. Write it again\./,
    "the reason is the one that held it, not its age",
  );
  assert.equal(await seenUid(), 3, "the inbox moves past it");

  down = false;
  await arrive("Fourth");
  await until(() => heard.got.length === 2, "the next is read");
  assert.equal(heard.got[1].unproven, undefined);
  assert.equal(heard.holding.at(-1), null);
  heard.stop.abort();
  await heard.done;
});

test("a mail from someone who may not write is passed over without being fetched", async () => {
  const heard = listen(async (chat) => chat === "alex@example.org");
  await until(() => connects === 3, "connected");
  const before = downloads.length;
  await arrive("A newsletter", "news@shop.example");
  await arrive("Fifth");
  await until(() => heard.got.length === 1, "theirs is read");
  assert.equal(heard.got[0].words, "Subject: Fifth\n\nhello");
  assert.deepEqual(downloads.slice(before), [6], "and only theirs was fetched");
  assert.equal(await seenUid(), 6, "the inbox moves past both");
  heard.stop.abort();
  await heard.done;
});
