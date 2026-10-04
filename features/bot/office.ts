/**
 * A thread as the office draws it while it runs: what crossed the room, where each seat stands
 * now, and when the screen saw each of them happen. No React, so the bot suite reads a real room
 * through it (scripts/bot-context.test.mts) and the office view follows one (components/office-view).
 *
 * The lines say what was sent and when it was written, and the room's exchanges how each seat
 * stands now (thread.query). How a seat stood in between is kept nowhere, so the office draws the
 * present, and walks what it sees change while it is open (`watch`): a hand-off let out, an
 * answer handed back, the report. Nothing is guessed from the words.
 */

import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { pathsIn } from "@/features/workspace/file-kind";
import { toDate } from "@/lib/date-like";
import { ROOM_THURSDAY, type RoomView, type WorkState } from "./room.schema";
import { type Chatter, messageOf, type ThreadView } from "./thread.store";

/** The user, in the office: questions and the final report come to their counter. */
export const YOU = "you";

export type OfficeKind =
  /** The job handed to the thread's bot. */
  | "job"
  /** Work sent to another bot. */
  | "give"
  /** A held hand-off going out, the answers it waited for attached. */
  | "release"
  /** A bot's answer to whoever handed it the work. */
  | "return"
  | "question"
  /** The user's words to a bot whose question they answered. */
  | "answer"
  /** The user's words to a bot that asked nothing: a step in, or more for the job. */
  | "tell"
  /** The thread's bot's final answer to the user. */
  | "report"
  /** A send the room turned down, drawn as the step it was. */
  | "refused";

export type OfficeEvent = {
  /** The same on every reading of the thread: what the office remembers it by, and its key. */
  id: string;
  kind: OfficeKind;
  /** The line it was read from, for events written in the same moment; -1 for the job. */
  order: number;
  from: string;
  to: string;
  /** What crossed; for `refused`, why the room turned it down. */
  text: string;
  /** Seconds since the job was handed over. */
  at: number;
  /** Only for `give`: the bots whose answers it waits for, while it waits. */
  after: string[];
  /** Only for `give`: words that joined an exchange already open to that bot, rather than a new one. */
  extra: boolean;
  /** The exchange a give opened or a release let out, or the room question a question opened; "" for none. */
  exchange: string;
  /**
   * For a `question`: when it was seen closed with no answer written yet (answered, or a stop).
   * For a `report`: when it was seen taken back, the thread going on after it. Null while it stands.
   */
  closed: number | null;
};

export type SeatKey =
  | "run"
  | "asking"
  | "paused"
  | "held"
  | "ended"
  | "done"
  | "stopped"
  | "none";

/** Where a seat stands now, as the room's exchanges have it. */
export type Seat = {
  key: SeatKey;
  /** Who it waits on: the bots a held hand-off waits for, those whose work is not back, or you. */
  waits: string[];
  /** Seconds since the handover it has stood so; null when nothing says. */
  since: number | null;
};

export type OfficeThread = {
  coord: string;
  /** The thread's bot first, then each bot in the order it was first handed work. */
  bots: string[];
  events: OfficeEvent[];
  seats: Map<string, Seat>;
  /** Exchanges still owed the answers they wait for, with those bots (room.query releaseWaiting). */
  owed: Map<string, string[]>;
  /** How each exchange stands, by id. */
  states: Map<string, WorkState>;
  /** The first line each exchange's bot wrote under it, by exchange. */
  starts: Map<string, number>;
  /** The questions to the user open now, by id. */
  asking: Set<string>;
  /** Seconds from the handover to the last line. */
  span: number;
  /** The steps each bot has taken so far: its tool calls, a hand-off or a question among them. */
  steps: Map<string, number>;
  status: ThreadView["status"];
  /** Whether the user has had the ending (Thread `seen`). */
  seen: boolean;
};

/** What the room said when it turned a send down (thread.query keeps it as the tool's result). */
const refusalOf = (line: Chatter) =>
  (line.tool?.results ?? [])
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join(" ")
    .trim();

/** What the room hands a caller when a bot's turn ends without words (room.query finishRoomWork). */
const SILENT = "This turn ended without a message.";

type Exchange = RoomView["exchanges"][number];

const terminal = (state: WorkState) =>
  state === "done" || state === "cancelled";

/** Owed the answers of the bots it named: held until they go out with them, even once started early. */
const isOwed = (row: Exchange) =>
  row.waitsFor.length > 0 && row.state !== "cancelled";

/** Not started: its words wait unread with the answers (room.query isHeld). */
const isHeld = (row: Exchange) =>
  row.state === "waiting" && row.waitsFor.length > 0;

export function officeOf(thread: ThreadView): OfficeThread {
  const start = toDate(thread.createdAt).getTime();
  const sec = (line: Chatter) =>
    line.at ? Math.max(0, (toDate(line.at).getTime() - start) / 1000) : 0;
  const coord = thread.bot.name;
  const lines = thread.lines;
  const exchanges = thread.room.exchanges;
  const rows = new Map(exchanges.map((row) => [row.id, row]));
  // A model may write a bot's name in any case; the room goes by its own spelling (room.query awaited)
  const known = [
    coord,
    ...thread.room.participants.map((one) => one.bot),
    ...exchanges.map((row) => row.bot),
  ];
  const canon = (name: string) =>
    known.find((one) => one.toLowerCase() === name.toLowerCase()) ?? name;
  // Words in a model message that also acted are the words beside a call, the bot's work; words
  // alone end a turn (thread.store messagesIn)
  const acting = new Set(
    lines
      .filter((line) => line.kind === "tool" || line.kind === "ask")
      .map(messageOf),
  );
  const alone = (line: Chatter) =>
    (line.kind === "say" || line.kind === "result") &&
    !acting.has(messageOf(line));
  const own = (line: Chatter) =>
    line.kind !== "user" && line.kind !== "note" && line.kind !== "stop";
  /** Per exchange: the message of its last words, and the last and first lines its bot wrote under it. */
  const lastWords = new Map<string, string>();
  const lastOwn = new Map<string, number>();
  const starts = new Map<string, number>();
  for (const [index, line] of lines.entries()) {
    if (!line.parent) continue;
    if (own(line)) lastOwn.set(line.parent, index);
    if (own(line) && !starts.has(line.parent)) starts.set(line.parent, index);
    if (alone(line)) lastWords.set(line.parent, messageOf(line));
  }

  const events: OfficeEvent[] = [
    {
      id: "job",
      kind: "job",
      order: -1,
      from: YOU,
      to: coord,
      text: thread.request,
      at: 0,
      after: [],
      extra: false,
      exchange: "",
      closed: null,
    },
  ];
  const bots = [coord];
  const seat = (bot: string) => {
    if (bot && bot !== ROOM_THURSDAY && !bots.includes(bot)) bots.push(bot);
  };
  /** Bots whose question you answered, until the answer is read. */
  const answered = new Set<string>();
  let said: { message: string; event: OfficeEvent } | null = null;
  const push = (
    event: Omit<OfficeEvent, "after" | "extra" | "exchange" | "closed"> &
      Partial<Pick<OfficeEvent, "after" | "extra" | "exchange">>,
  ) => {
    const full: OfficeEvent = {
      after: [],
      extra: false,
      exchange: "",
      ...event,
      closed: null,
    };
    events.push(full);
    said = null;
    return full;
  };

  const read = (line: Chatter, order: number, at: number, from: string) => {
    const base = { id: line.id, order, at };
    if (line.kind === "tool") {
      if (line.tool?.name === TOOL_NAMES.send_message) {
        const meant = line.meant ? canon(line.meant.name) : "";
        push({
          ...base,
          kind: "refused",
          from,
          to: meant === ROOM_THURSDAY ? YOU : meant,
          text: refusalOf(line),
        });
      }
      return;
    }
    if (line.kind === "ask") {
      const to = canon(line.to?.name ?? "");
      if (to === ROOM_THURSDAY) {
        const id = line.questionId ?? "";
        // Answered, the user's next words to it are the answer; withdrawn by a stop, they are not
        if (rows.get(id)?.state === "done") answered.add(from);
        push({
          ...base,
          kind: "question",
          from,
          to: YOU,
          text: line.text,
          exchange: id,
        });
        return;
      }
      seat(to);
      const row = line.exchange ? rows.get(line.exchange) : undefined;
      push({
        ...base,
        kind: "give",
        from,
        to,
        text: line.text,
        after: row && isOwed(row) ? row.waitsFor : [],
        // No row of its own: the words joined an exchange already open to that bot (room.query sendRoomMessage)
        extra: !row,
        exchange: row?.id ?? "",
      });
      return;
    }
    if (line.kind === "user") {
      push({
        ...base,
        kind: answered.delete(from) ? "answer" : "tell",
        from: YOU,
        to: from,
        text: line.text,
      });
      return;
    }
    // A stop or a summary is the app's: the seat reads the stop, the floor neither
    if (line.kind !== "say" && line.kind !== "result") return;
    // Words among a turn's steps are its working, not something carried across the floor
    if (!alone(line)) return;
    // Several text blocks of one message are one thing said
    const message = messageOf(line);
    const last = said as { message: string; event: OfficeEvent } | null;
    if (last?.message === message) {
      last.event.text = `${last.event.text}\n\n${line.text}`;
      return;
    }
    if (from === coord) {
      // The thread's answer is its last words once it is done (thread.store threadFromRow); words
      // before ended a turn with work still out, and cross nothing
      if (line.kind === "result")
        said = {
          message,
          event: push({
            ...base,
            kind: "report",
            from,
            to: YOU,
            text: line.text,
          }),
        };
      return;
    }
    const row = line.parent ? rows.get(line.parent) : undefined;
    // A helper's last words under an exchange that is done are its answer (room.query
    // finishRoomWork); words before them ended a turn that went on
    if (row?.state === "done" && lastWords.get(row.id) === message) {
      said = {
        message,
        event: push({
          ...base,
          kind: "return",
          from,
          to: canon(row.caller),
          text: line.text,
          exchange: row.id,
        }),
      };
      return;
    }
  };

  for (const [index, line] of lines.entries()) {
    const at = sec(line);
    const from = canon(line.bot.name);
    seat(from);
    read(line, index, at, from);
    // An exchange done with no words: the room hands the caller its own for them (finishRoomWork)
    const row = line.parent ? rows.get(line.parent) : undefined;
    if (
      row?.state === "done" &&
      from !== coord &&
      lastOwn.get(row.id) === index &&
      !lastWords.has(row.id)
    )
      push({
        id: `silent:${line.id}`,
        kind: "return",
        order: index,
        from,
        to: canon(row.caller),
        text: SILENT,
        at,
        exchange: row.id,
      });
  }

  const when = (index: number) => (index < 0 ? null : sec(lines[index]));
  const lastOf = (bot: string) =>
    lines.findLastIndex((line) => canon(line.bot.name) === bot && own(line));
  const seatOf = (bot: string): Seat => {
    const mine = exchanges.filter((row) => row.bot === bot);
    const asks = thread.room.questions.filter((one) => canon(one.bot) === bot);
    // A bot asking you runs nothing else until you answer (room.query deliver)
    if (asks.length)
      return {
        key: "asking",
        waits: [YOU],
        since: when(lines.findIndex((line) => line.questionId === asks[0].id)),
      };
    if (mine.some((row) => row.state === "running" || row.state === "queued"))
      return { key: "run", waits: [], since: null };
    const paused = mine.filter((row) => row.state === "paused");
    if (paused.length)
      return {
        key: "paused",
        waits: [YOU],
        since: when(
          lines.findLastIndex(
            (line) =>
              line.kind === "stop" &&
              paused.some((row) => row.id === line.parent),
          ),
        ),
      };
    const held = mine.find(isHeld);
    if (held)
      return {
        key: "held",
        waits: held.waitsFor,
        since: when(
          lines.findIndex(
            (line) => line.kind === "ask" && line.exchange === held.id,
          ),
        ),
      };
    if (mine.some((row) => row.state === "waiting")) {
      // What it handed out that is not back, which its turn waits on (room.query finishRoomWork)
      const out = exchanges.filter(
        (row) =>
          canon(row.caller) === bot &&
          row.bot !== ROOM_THURSDAY &&
          !terminal(row.state),
      );
      return {
        key: "ended",
        waits: bots.filter((one) => out.some((row) => row.bot === one)),
        since: when(lastOf(bot)),
      };
    }
    const last = mine.at(-1);
    if (!last) return { key: "none", waits: [], since: null };
    if (last.state === "cancelled")
      return { key: "stopped", waits: [], since: null };
    // Its last turn ended with nothing out and no words: the room is idle until you write
    if (bot === coord && thread.status !== "done")
      return thread.status === "cancelled"
        ? { key: "stopped", waits: [], since: null }
        : { key: "ended", waits: [], since: when(lastOf(bot)) };
    return { key: "done", waits: [], since: when(lastOf(bot)) };
  };
  // A bot the user wrote to before it said anything has an exchange and no line yet
  for (const row of exchanges) seat(row.bot);

  return {
    coord,
    bots,
    events,
    seats: new Map(bots.map((bot) => [bot, seatOf(bot)])),
    owed: new Map(
      exchanges.filter(isOwed).map((row) => [row.id, row.waitsFor]),
    ),
    states: new Map(exchanges.map((row) => [row.id, row.state])),
    starts,
    asking: new Set(thread.room.questions.map((one) => one.id)),
    // Folded rather than spread: a long job's lines outnumber what a call takes as arguments
    span: lines.reduce((most, line) => Math.max(most, sec(line)), 0),
    steps: lines.reduce((count, line) => {
      if (line.kind !== "tool" && line.kind !== "ask") return count;
      const bot = canon(line.bot.name);
      count.set(bot, (count.get(bot) ?? 0) + 1);
      return count;
    }, new Map<string, number>()),
    status: thread.status,
    seen: thread.seen,
  };
}

// ---- what the office has seen since it opened

/** What the office saw of a thread while open, in seconds since the handover. */
export type OfficeMemory = {
  /** When each event was first read, by id. */
  read: Map<string, number>;
  /** Each seat as last read, and since when it has stood so (null: from before the office opened, the lines not saying). */
  seats: Map<string, { state: string; since: number | null }>;
  /** Hand-offs seen owed answers, the bots they waited on, and when each was seen let out. */
  owed: Map<string, { waits: string[]; out: number | null }>;
  /** Questions seen open, and when each was seen closed. */
  asked: Map<string, number | null>;
  /**
   * Reports seen, and when each was seen taken back: once the user writes on after a report,
   * the lines no longer read it as one, and its bot is walked back to its desk with it rather
   * than put there at once.
   */
  reports: Map<string, { event: OfficeEvent; gone: number | null }>;
  /** When the thread was seen to end; null while it runs. */
  ended: number | null;
  /** When the office first read the thread: what comes after it is seen as it happens. */
  opened: number;
  /** It first read the thread done with its ending not yet seen: the office opens on that finish. */
  fresh: boolean;
};

/**
 * The office's memory after one more reading at `now`. What was written before the office
 * opened stays where it was written; what shows up later is walked from when it shows, which
 * for an answer handed back is when its bot's turn ended, not when its words began.
 */
export function watch(
  memory: OfficeMemory | null,
  office: OfficeThread,
  now: number,
): OfficeMemory {
  const first = memory === null;
  const read = new Map(memory?.read);
  for (const event of office.events)
    if (!read.has(event.id))
      read.set(event.id, first ? event.at : Math.max(event.at, now));
  const seats = new Map(memory?.seats);
  for (const [bot, seat] of office.seats) {
    const state = `${seat.key}:${seat.waits.join(",")}`;
    if (seats.get(bot)?.state === state) continue;
    seats.set(bot, { state, since: first ? seat.since : now });
  }
  const owed = new Map(memory?.owed);
  for (const [id, waits] of office.owed) owed.set(id, { waits, out: null });
  for (const [id, hold] of owed) {
    if (hold.out !== null || office.owed.has(id)) continue;
    // Out with the answers it waited for, unless a stop cancelled it first
    if (office.states.get(id) === "cancelled") owed.delete(id);
    else owed.set(id, { ...hold, out: now });
  }
  const asked = new Map(memory?.asked);
  for (const id of office.asking) if (!asked.has(id)) asked.set(id, null);
  for (const [id, closed] of asked)
    if (closed === null && !office.asking.has(id)) asked.set(id, now);
  const reports = new Map(memory?.reports);
  for (const event of office.events)
    if (event.kind === "report") reports.set(event.id, { event, gone: null });
  for (const [id, seen] of reports)
    if (seen.gone === null && !office.events.some((event) => event.id === id))
      reports.set(id, { ...seen, gone: now });
  const over = office.status === "done" || office.status === "cancelled";
  return {
    read,
    seats,
    owed,
    asked,
    reports,
    ended: over ? (memory?.ended ?? (first ? office.span : now)) : null,
    opened: memory?.opened ?? now,
    fresh: memory?.fresh ?? (office.status === "done" && !office.seen),
  };
}

/** The office's events on the clock they were seen by, and each seat with since when it stands. */
export type OfficeScene = {
  office: OfficeThread;
  events: OfficeEvent[];
  seats: Map<string, Seat>;
  /** When the thread was seen to end; null while it runs. */
  ended: number | null;
  /** When the office first read the thread, and whether it opened on a finish not yet seen (OfficeMemory). */
  opened: number;
  fresh: boolean;
};

export function sceneOf(
  office: OfficeThread,
  memory: OfficeMemory,
): OfficeScene {
  const events = office.events.map((event): OfficeEvent => {
    const at = memory.read.get(event.id) ?? event.at;
    const hold = memory.owed.get(event.exchange);
    if (event.kind === "give" && !event.extra && hold)
      return { ...event, at, after: hold.waits };
    if (event.kind === "question")
      return {
        ...event,
        at,
        // Closed before the office opened: at once, where it was asked
        closed:
          memory.asked.get(event.exchange) ??
          (office.asking.has(event.exchange) ? null : at),
      };
    return { ...event, at };
  });
  // A hand-off seen let out is carried to its desk with the answers it waited for
  for (const [id, hold] of memory.owed) {
    if (hold.out === null) continue;
    const give = events.find(
      (event) => event.kind === "give" && event.exchange === id,
    );
    if (give)
      events.push({
        ...give,
        id: `release:${id}`,
        kind: "release",
        // Seen with other things, it comes before the first line its bot wrote for it, and so
        // before that bot's answer and any report; with none yet, after all there is
        order: (office.starts.get(id) ?? Number.POSITIVE_INFINITY) - 0.5,
        at: Math.max(hold.out, give.at),
      });
  }
  // A report seen and then taken back as the thread went on stays, closed from when that was
  // seen, so its bot walks back from your counter with it
  for (const [id, seen] of memory.reports)
    if (seen.gone !== null)
      events.push({
        ...seen.event,
        at: memory.read.get(id) ?? seen.event.at,
        closed: seen.gone,
      });
  events.sort((a, b) => a.at - b.at || a.order - b.order);
  const seats = new Map(
    [...office.seats].map(([bot, seat]) => [
      bot,
      { ...seat, since: memory.seats.get(bot)?.since ?? seat.since },
    ]),
  );
  return {
    office,
    events,
    seats,
    ended: memory.ended,
    opened: memory.opened,
    fresh: memory.fresh,
  };
}

// ---- what a seat wears

export type SeatState = {
  key: SeatKey;
  /** The chip's words. */
  label: string;
  since: number | null;
  /** Who it waits on: bots, or you. */
  waits: string[];
};

const nameOf = (who: string) => (who === YOU ? "you" : who);

/** "Analyst", "Analyst and Designer", "3 bots". */
export const namesOf = (list: string[]) =>
  list.length > 2 ? `${list.length} bots` : list.map(nameOf).join(" and ");

const NOBODY: Seat = { key: "none", waits: [], since: null };

export function seatAt(scene: OfficeScene, bot: string): SeatState {
  const { key, waits, since } = scene.seats.get(bot) ?? NOBODY;
  const own = bot === scene.office.coord;
  const labels: Record<SeatKey, string> = {
    run: "Working",
    asking: "Waiting on you",
    paused: "Paused",
    held: `Held · after ${namesOf(waits)}`,
    ended: waits.length ? `Waiting on ${namesOf(waits)}` : "Waiting",
    done: own ? "Reported" : "Answered",
    stopped: "Stopped",
    none: "Not called yet",
  };
  return { key, label: labels[key], since, waits };
}

/** The helpers handed work so far, and how many of them have handed their answer back. */
export function backOf(scene: OfficeScene) {
  const called = scene.office.bots.filter(
    (bot) => bot !== scene.office.coord && seatAt(scene, bot).key !== "none",
  );
  return {
    called: called.length,
    back: called.filter((bot) => seatAt(scene, bot).key === "done").length,
  };
}

/** The final report standing at `t`: handed over, and not taken back since as the thread went on. */
export const reportAt = (scene: OfficeScene, t: number) =>
  scene.events.find(
    (event) =>
      event.kind === "report" &&
      event.at <= t &&
      (event.closed === null || event.closed > t),
  ) ?? null;

/**
 * What the job handed over: each file its answers and its report name, in the order first named,
 * read as the room reads a file in a message (attachments, pathsIn).
 */
export function filesOf(scene: OfficeScene) {
  const files = new Set<string>();
  for (const event of scene.events)
    if (event.kind === "return" || event.kind === "report")
      for (const path of pathsIn(event.text)) files.add(path);
  return [...files];
}

/**
 * What a bot's plate says, when it says anything: the bot at work, the one that wants the user
 * (a question, or Continue after the app stopped it), and the coordinator once its report stands.
 * Every other bot stands as it is, its plate folded to its name until pointed at; how it stands
 * is on its mark, and what it did is in its tab in the room.
 */
export type Plate = { tone: "work" | "you" | "report"; words: string };

export function plateOf(
  scene: OfficeScene,
  bot: string,
  t: number,
): Plate | null {
  switch (seatAt(scene, bot).key) {
    case "run":
      return { tone: "work", words: "working" };
    case "asking":
    case "paused":
      return { tone: "you", words: "needs you" };
    default:
      return bot === scene.office.coord && reportAt(scene, t)
        ? { tone: "report", words: "report ready" }
        : null;
  }
}

/**
 * What a bot has to show of its work, opened over it in the office: the coordinator's report
 * while it stands, a question it waits on the user with, or the last answer a helper handed back.
 * Null when it has said none of these yet.
 */
export function wordsOf(
  scene: OfficeScene,
  bot: string,
  t: number,
): { kind: "report" | "question" | "answer"; text: string } | null {
  if (bot === scene.office.coord) {
    const report = reportAt(scene, t);
    if (report) return { kind: "report", text: report.text };
  }
  const said = scene.events.findLast(
    (event) =>
      event.from === bot &&
      event.at <= t &&
      (event.kind === "return" ||
        (event.kind === "question" && seatAt(scene, bot).key === "asking")),
  );
  if (!said) return null;
  return {
    kind: said.kind === "question" ? "question" : "answer",
    text: said.text,
  };
}

/**
 * How the job stands as a whole, written on the ground beside the building (office-stage
 * GroundSign): at work, the user's turn (a bot asks them something), paused (the app stopped a
 * run and waits on Continue), stopped, or done.
 */
export type Sign = "work" | "you" | "paused" | "stopped" | "done";

/**
 * The job as a whole: done or stopped as the thread is; before that a bot asking the user makes
 * it their turn, one the app paused waits on Continue, and the rest is at work. A pause says why
 * only in its words, a failed call as well as a limit reached, so it is a pause and no more.
 */
export function signOf(scene: OfficeScene): Sign {
  const { bots, status } = scene.office;
  if (status === "done") return "done";
  if (status === "cancelled") return "stopped";
  const keys = bots.map((bot) => seatAt(scene, bot).key);
  if (keys.includes("asking")) return "you";
  if (keys.includes("paused")) return "paused";
  return "work";
}

/** "4:40", or "2:04:40" past the hour, from seconds. */
export const clockOf = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds));
  const two = (n: number) => String(n).padStart(2, "0");
  const hours = Math.floor(whole / 3600);
  return hours
    ? `${hours}:${two(Math.floor(whole / 60) % 60)}:${two(whole % 60)}`
    : `${Math.floor(whole / 60)}:${two(whole % 60)}`;
};
