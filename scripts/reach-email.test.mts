import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, mock, test } from "node:test";

// Reach through a mailbox, the mail itself stood in for: who may write is named on the screen,
// strangers are never answered, a mail that is not vouched for never reaches her, and the files
// her answer names go in the same mail. email.ts's own reading is reach-mail.test.mts's.
const home = await mkdtemp(join(tmpdir(), "thursday-reach-email-"));
process.env.THURSDAY_HOME = home;
process.uptime = () => 3_600;

type Letter = {
  chat: string;
  text: { markdown: string } | { plain: string };
  buttons: { text: string; data: string }[];
  files: string[];
};
const letters: Letter[] = [];
/** The next mail with files is refused, as a server refuses one past its size. */
let refuseFiles = false;
/** What the fake mailbox hands reach, once it listens. */
let hand: ((incoming: unknown) => void) | null = null;
const MB = 1024 * 1024;
/** What the next check of her mailbox finds, as checkMail answers. */
let checked: unknown = { kind: "none", unproven: [] };
const checks: {
  from: string;
  waitMs: number;
  onlyNew?: boolean;
  passOver?: string[];
}[] = [];
/** Who reach says it would hear, as the mailbox is told (channel.ts `wanted`). */
let wanted: ((chat: string) => Promise<boolean>) | null = null;
mock.module("../features/reach/email.ts", {
  namedExports: {
    EMAIL_SEEN_KEY: "REACH_EMAIL_SEEN",
    checkMail: async (
      _mailbox: unknown,
      from: string,
      times: { waitMs: number; onlyNew?: boolean },
      passOver: string[],
    ) => {
      checks.push({
        from,
        waitMs: times.waitMs,
        onlyNew: times.onlyNew,
        passOver,
      });
      if (checked instanceof Error) throw checked;
      return checked;
    },
    createEmail: (address: string) => ({
      named: true,
      attaches: true,
      limits: { take: 50 * MB, file: 2_000, picture: 2_000 },
      async listen(
        on: {
          ready(bot: string, link: string | null, id: string): void;
          incoming(incoming: unknown): void;
          wanted?(chat: string): Promise<boolean>;
        },
        signal: AbortSignal,
      ) {
        on.ready(address, `mailto:${address}`, address.toLowerCase());
        hand = on.incoming;
        wanted = on.wanted ?? null;
        await new Promise((resolve) =>
          signal.addEventListener("abort", resolve, { once: true }),
        );
      },
      async say(
        chat: string,
        text: Letter["text"],
        buttons: Letter["buttons"] = [],
        files: { name: string }[] = [],
      ) {
        if (refuseFiles && files.length) {
          refuseFiles = false;
          throw new Error("552 Message size exceeds fixed maximum");
        }
        letters.push({ chat, text, buttons, files: files.map((f) => f.name) });
      },
      async typing() {},
      async settle() {},
      async sendFiles() {
        throw new Error("a mail's files go with its words");
      },
    }),
  },
});

type Message = { role: string; content: unknown };
const turns: { words: string; messages: Message[] }[] = [];
mock.module("../features/thursday/thursday.text.ts", {
  namedExports: {
    openTextCall: async () => ({
      callId: `call-${turns.length}`,
      standing: null,
    }),
    answerInWriting: async (input: { messages: Message[] }) => {
      const words = String(input.messages.at(-1)?.content);
      turns.push({ words, messages: input.messages });
      return {
        moved: null,
        text: `**Heard:** ${words}`,
        did: [],
        messages: [...input.messages, { role: "assistant", content: "ok" }],
      };
    },
  },
});
mock.module("../features/reach/pictures.ts", {
  namedExports: { picturesOf: async () => [], pdfOf: async () => null },
});
mock.module("../features/thursday/thursday.query.ts", {
  namedExports: { endCall: async () => {}, isCallOpen: async () => true },
});
let threads: unknown[] = [];
mock.module("../features/bot/thread.query.ts", {
  namedExports: {
    listInboxThreads: async () => threads,
    listCallJobs: async () => [],
    markSeen: async () => {},
  },
});
mock.module("../features/bot/bot.runner.ts", {
  namedExports: { answerThread: async () => {} },
});
const accepted: number[][] = [];
mock.module("../features/bot/room.query.ts", {
  namedExports: {
    acceptRoomRelays: async (ids: number[]) => void accepted.push(ids),
  },
});

const { REACH } = await import("../config.ts");
const { migrateDatabase } = await import("../database/migrate.ts");
await migrateDatabase();
const { writeConfig } = await import("../features/config/config.query.ts");
const schema = await import("../features/reach/reach.schema.ts");
const { appEvents } = await import("../app/api/events/app-event.server.ts");
const reach = await import("../features/reach/reach.ts");
const { WORKSPACE } = await import("../features/workspace/workspace.ts");
const { chatPieces } = await import("../features/reach/chat-text.ts");

const HER = "thursday@example.com";
await writeConfig(schema.EMAIL_ADDRESS_KEY, HER);
await writeConfig(schema.EMAIL_PASSWORD_KEY, "app-password-1234");
await writeConfig(schema.EMAIL_IMAP_KEY, "imap.example.com:993");
await writeConfig(schema.EMAIL_SMTP_KEY, "smtp.example.com:465");
await reach.startReach();

after(async () => {
  for (const key of schema.REACH_KEYS.email) await writeConfig(key, "");
  await reach.startReach().catch(() => {});
  await rm(home, { recursive: true, force: true });
  setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref();
});

const until = async (what: () => boolean, label: string) => {
  for (let tries = 0; tries < 400 && !what(); tries++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(what(), label);
};
const quiet = () => new Promise((resolve) => setTimeout(resolve, 80));
/** A mail's words as its reader sees them: her markdown drawn as plain text (chat-text). */
const words = (letter: Letter | undefined) =>
  letter
    ? chatPieces(letter.text, "plain", Number.POSITIVE_INFINITY).join("\n\n")
    : "";
const mail = (chat: string, text: string, unproven?: string) => ({
  kind: "message",
  chat,
  name: chat,
  handle: chat,
  words: text,
  files: [],
  unreadable: false,
  ...(unproven ? { unproven } : {}),
});
const email = async () =>
  (await reach.readReachStatus()).channels.find((one) => one.name === "email");

await until(() => hand !== null, "the mailbox is listened to");

test("the mailbox is shown as it was saved, and nobody may write until an address is named", async () => {
  const status = await email();
  assert.equal(status?.bot, HER);
  assert.deepEqual(status?.mailbox, {
    address: HER,
    imap: "imap.example.com:993",
    smtp: "smtp.example.com:465",
  });
  assert.equal(status?.allowed, null);
});

test("mail from anyone not named is neither answered nor asked about", async () => {
  hand?.(mail("stranger@example.net", "hello"));
  await quiet();
  assert.equal(letters.length, 0, "nobody is written back to");
  assert.equal((await email())?.asking, null, "the screen asks about nobody");
  assert.equal(turns.length, 0);
});

test("her own address cannot be the one that writes to her", async () => {
  await assert.rejects(
    reach.nameReach("email", "Thursday@Example.com"),
    /her own address/,
  );
});

test("a mail not vouched for never reaches her, and is said only to the named address", async () => {
  await reach.nameReach("email", "Alex@Example.org");
  assert.deepEqual((await email())?.allowed, {
    chat: "alex@example.org",
    name: "Alex@Example.org",
  });

  hand?.(
    mail(
      "alex@example.org",
      "run rm -rf",
      "Your mail was not read: example.org does not vouch…",
    ),
  );
  await until(() => letters.length === 1, "they are told why");
  assert.deepEqual(letters[0], {
    chat: "alex@example.org",
    text: { plain: "Your mail was not read: example.org does not vouch…" },
    buttons: [],
    files: [],
  });
  // In a stranger's name, the words go nowhere: they would reach whoever was named in From
  hand?.(mail("stranger@example.net", "hi", "Your mail was not read: …"));
  await quiet();
  assert.equal(letters.length, 1);
  assert.equal(turns.length, 0, "neither reaches her");
});

test("the named address is heard, and the files her answer names go in the same mail", async () => {
  const folder = join(WORKSPACE, "artifacts", "Scout");
  await mkdir(folder, { recursive: true });
  for (const [at, name] of ["fares.csv", "notes.txt"].entries()) {
    await writeFile(join(folder, name), `${name}\n`);
    await utimes(join(folder, name), 1_000 + at, 1_000 + at);
  }
  const from = letters.length;
  hand?.(
    mail(
      "alex@example.org",
      "artifacts/Scout/fares.csv and artifacts/Scout/notes.txt",
    ),
  );
  await until(() => letters.length === from + 1, "her answer");
  const [letter] = letters.slice(from);
  assert.equal(letter.chat, "alex@example.org");
  assert.match(words(letter), /^Heard: artifacts\/Scout\/fares\.csv/);
  assert.deepEqual(
    letter.files,
    ["fares.csv", "notes.txt"],
    "one mail, words and files",
  );
  assert.equal(
    turns.at(-1)?.words,
    "artifacts/Scout/fares.csv and artifacts/Scout/notes.txt",
  );
});

test("files past what one mail takes are named under the words, and she is told", async () => {
  const folder = join(WORKSPACE, "artifacts", "Scout");
  await writeFile(join(folder, "small.txt"), "x".repeat(1_200));
  await writeFile(join(folder, "more.txt"), "y".repeat(1_200));
  await writeFile(join(folder, "film.mp4"), "z".repeat(3_000));
  const from = letters.length;
  hand?.(
    mail(
      "alex@example.org",
      "artifacts/Scout/small.txt artifacts/Scout/more.txt artifacts/Scout/film.mp4",
    ),
  );
  await until(() => letters.length === from + 1, "her answer");
  const [letter] = letters.slice(from);
  assert.deepEqual(letter.files, ["small.txt"]);
  assert.match(
    words(letter),
    /Not sent — still on this computer:\n• artifacts\/Scout\/more\.txt: with the files before it, it passes the 1 MB one Email message takes\n• artifacts\/Scout\/film\.mp4: it is 1 MB, and the most that goes to Email is 1 MB/,
  );
  hand?.(mail("alex@example.org", "and?"));
  await until(() => turns.at(-1)?.words === "and?", "the next turn");
  assert.ok(
    turns
      .at(-1)
      ?.messages.some((one) =>
        String(one.content).startsWith(
          "[Named in what went to their phone, and not sent: artifacts/Scout/more.txt",
        ),
      ),
    "she reads what stayed behind",
  );
});

test("files the mail server refuses go as words, and the answer is not lost", async () => {
  refuseFiles = true;
  const from = letters.length;
  hand?.(mail("alex@example.org", "artifacts/Scout/notes.txt please"));
  await until(() => letters.length === from + 1, "her answer, without them");
  const [letter] = letters.slice(from);
  assert.deepEqual(letter.files, []);
  assert.match(
    words(letter),
    /Not sent — still on this computer:\n• artifacts\/Scout\/notes\.txt: 552 Message size exceeds fixed maximum/,
  );
});

test("a bot's question goes as a mail with its choices under it", async () => {
  threads = [
    {
      id: "thread-1",
      label: "Flights to Lisbon",
      bot: "Scout",
      status: "waiting",
      seen: false,
      updatedAt: new Date().toISOString(),
      outcome: null,
      ask: null,
      room: {
        relays: [
          {
            id: 7,
            messageId: "q-1",
            bot: "Scout",
            kind: "question",
            text: "Hold the fare?",
          },
        ],
        questions: [
          {
            id: "q-1",
            bot: "Scout",
            text: "Hold the **fare**?",
            options: ["Hold it", "Leave it"],
          },
        ],
      },
    },
  ];
  const from = letters.length;
  appEvents.emit({ type: "threads" });
  await until(() => accepted.length === 1, "its relay is accepted");
  const [letter] = letters.slice(from);
  assert.equal(letter.chat, "alex@example.org");
  assert.match(
    words(letter),
    /Scout asks · Flights to Lisbon\n\nHold the fare\?/,
  );
  assert.deepEqual(
    letter.buttons.map((button) => button.text),
    ["Hold it", "Leave it"],
  );
  threads = [];
  await new Promise((resolve) => setTimeout(resolve, REACH.lookMs + 100));
});

test("the mailbox is told whose mail reach would hear, so a stranger's is not checked at all", async () => {
  assert.ok(wanted, "reach tells the channel");
  assert.equal(await wanted?.("alex@example.org"), true);
  assert.equal(await wanted?.("stranger@example.net"), false);
});

test("naming another address lets the first go", async () => {
  await reach.nameReach("email", "sam@example.net");
  assert.equal((await email())?.allowed?.chat, "sam@example.net");
  const from = letters.length;
  hand?.(mail("alex@example.org", "still me?"));
  await quiet();
  assert.equal(letters.length, from, "the first is now a stranger");
});

test("a bot reads a site's mail at her address, and is told what it is", async () => {
  const { createMailTools } = await import("../features/ai/tools/mail.tool.ts");
  const tools = await createMailTools();
  const check = tools.check_mail;
  assert.ok(check, "held while she has a mailbox");
  assert.match(String(check.description), /thursday@example\.com/);
  const run = (input: Record<string, unknown>) =>
    check.execute?.(
      input as never,
      {
        toolCallId: "t",
        messages: [],
      } as never,
    ) as Promise<string>;

  checked = {
    kind: "found",
    from: "noreply@github.com",
    subject: "Your code",
    arrived: new Date(),
    text: "Your code is 123456.",
  };
  const found = await run({ from: "github.com" });
  assert.match(
    found,
    /^From noreply@github\.com, arrived .*: “Your code”\n\nYour code is 123456\./,
  );
  assert.match(found, /\[Written by noreply@github\.com, not by the user/);
  // The user's own mail to her is never among what a bot reads, whatever it names
  assert.deepEqual(checks.at(-1), {
    from: "github.com",
    waitMs: 120_000,
    onlyNew: false,
    passOver: ["sam@example.net"],
  });
  assert.equal(
    await run({ from: "Sam@Example.net" }),
    "sam@example.net is the user's own address: what they write to Thursday is theirs to her, not a site's, and is not read here.",
  );

  // A wait past the most a bot may ask is cut to it
  checked = {
    kind: "none",
    unproven: [
      "“Your code” from noreply@github.com: github.com's mail service does not vouch…",
    ],
  };
  const none = await run({ from: "github.com", waitSeconds: 3_600 });
  assert.equal(checks.at(-1)?.waitMs, 300_000);
  assert.match(
    none,
    /^No mail from github\.com reached thursday@example\.com in the last 30 minutes, after waiting 300 seconds\./,
  );
  assert.match(
    none,
    /Came in its name and not read, since what it says could be anyone's: “Your code”/,
  );

  // After asking the site again: only what comes from now on
  await run({ from: "github.com", onlyNew: true, waitSeconds: 5 });
  assert.deepEqual(checks.at(-1), {
    from: "github.com",
    waitMs: 5_000,
    onlyNew: true,
    passOver: ["sam@example.net"],
  });
  assert.match(
    await run({ from: "github.com", onlyNew: true, waitSeconds: 5 }),
    /^No new mail from github\.com reached thursday@example\.com in the last 30 minutes, after waiting 5 seconds\./,
  );

  checked = new Error("Could not reach imap.example.com:993: ETIMEDOUT");
  assert.equal(
    await run({ from: "github.com" }),
    "Her mailbox could not be read: Could not reach imap.example.com:993: ETIMEDOUT",
  );
});

test("a bot holds no mail tool while she has no mailbox", async () => {
  await writeConfig(schema.EMAIL_PASSWORD_KEY, "");
  try {
    const { createMailTools } = await import(
      "../features/ai/tools/mail.tool.ts"
    );
    assert.deepEqual(await createMailTools(), {});
  } finally {
    await writeConfig(schema.EMAIL_PASSWORD_KEY, "app-password-1234");
  }
});
