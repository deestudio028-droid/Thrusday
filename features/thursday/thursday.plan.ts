import { randomUUID } from "node:crypto";
import {
  type LanguageModel,
  type ModelMessage,
  streamText,
  type ToolSet,
} from "ai";
import { LIVE_CALL, PLAN_CALL, TEXT_CALL } from "@/config";
import { openPlanCall } from "@/features/ai/chatgpt";
import { LIVE_PROVIDER, type LiveSettings } from "@/features/ai/live.schema";
import { loadTools } from "@/features/ai/load-tools";
import { getTextModel, modelErrorToString } from "@/features/ai/model";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { EXA_API_KEY } from "@/features/config/config.const";
import { readConfig } from "@/features/config/config.query";
import {
  joinPlanLine,
  type PlanEvent,
  type PlanWire,
} from "@/lib/live/live.plan";
import { LIVE_PLAN_MODEL } from "@/lib/live/live.schema";
import { acceptedReasoning, wantedReasoning } from "@/lib/live/live.server";
import { logger } from "@/lib/logger";
import { createEventBus, type EventBus } from "@/lib/protocol/events";
import { createEventStream } from "@/lib/protocol/events.server";
import { publicError } from "@/lib/public-error";

/**
 * A spoken call on the GPT subscription. The plan's voice (LIVE_PLAN_MODEL) has no backend of
 * the provider's: it hands work over to whoever opened the call (live.plan), so the app runs
 * her backend itself — her prompt, her tools, the backend model, on the plan — and answers the
 * voice with what it returns, as the Codex CLI runs its own agent for /voice (codex-rs core
 * realtime_conversation.rs, `delegation.created` in, `delegation.context.append` out).
 *
 * The page holds the media and runs her tools, as it does on a key's call, and hears the call
 * in the key's own words: what this line says is put to it as the events of GPT-Live's public
 * wire (live.session), a response for each step of her backend, so one session drives both
 * lines. It follows the line over a stream (`followPlanLine`) and answers on it
 * (`tellPlanLine`); both reach this through app/api/thursday/call/plan.
 */

/** An event as GPT-Live's public wire words it, which is what the page reads (live.session). */
type WireEvent = { type: string } & Record<string, unknown>;

/** What the page sends back, in the same words. */
type PageEvent = {
  type?: unknown;
  event_id?: unknown;
  content?: unknown;
  item?: {
    type?: unknown;
    role?: unknown;
    call_id?: unknown;
    output?: unknown;
    content?: { type?: unknown; text?: unknown; image_url?: unknown }[];
  };
};

/**
 * Work for her backend: what the voice handed over, by its delegation; or, with a null id, a
 * run the page asked for with nothing waiting on it (`response.create`), on what it put down.
 */
type Handed = { id: string; text: string } | { id: null };

type PlanLine = {
  id: string;
  wire: PlanWire;
  began: number;
  over: boolean;
  bus: EventBus<WireEvent>;
  /** Said before the page followed: the first thing it reads. */
  outbox: WireEvent[];
  followed: boolean;
  /** Ends a line no page ever followed. */
  orphan: ReturnType<typeof setTimeout> | undefined;
  stop: AbortController;
  backend: {
    model: LanguageModel;
    system: string;
    tools: ToolSet;
    providerOptions: Record<string, Record<string, string>>;
  };
  /** Her backend's conversation, over every hand-over of the call. */
  messages: ModelMessage[];
  /** Facts for the backend alone, put in before its next step (`brief` on the page). */
  facts: string[];
  /** What was said since the last hand-over, as the voice's side transcribed it. */
  talk: { role: "user" | "assistant"; text: string; done: boolean }[];
  handed: Handed[];
  working: boolean;
  /**
   * The calls of the step the page runs. A `response.create` once all their outputs are in
   * goes on with them; one before, from a page that had not yet heard of the step, is a run.
   */
  calling: string[];
  /**
   * What the page sent back for her calls, by call: kept as it comes, since a tool can finish
   * before the step that called it has.
   */
  outputs: Map<string, string>;
  /**
   * Pictures the page sent as the user's, each with the words it came with: of a file they
   * put down, or of a drawing they showed. In after the outputs of the step that was running
   * when they were put down, or before her next step when none was.
   */
  pictures: (
    | { type: "text"; text: string }
    | { type: "image"; image: string }
  )[];
  /** The page asked for the next response; `next` is waiting on it, when it is. */
  asked: boolean;
  next: (() => void) | null;
};

type Pinned = { __planLines?: Map<string, PlanLine> };
/** Open lines by their call's row. Pinned to globalThis: the action that opens one and the route that follows it load apart. */
const lines = ((globalThis as Pinned).__planLines ??= new Map());

/** Where the page follows a line and answers on it. */
export const planRelayOf = (callId: string) =>
  `/api/thursday/call/plan?call=${encodeURIComponent(callId)}`;

/**
 * Opens a spoken call on the plan from the browser's offer. The voice gets her voice's prompt;
 * the backend is loaded here, on the plan, with the tool set a key's call declares (every tool
 * runs in the page, as there) and the plan's own search in the hosted search's place. The row
 * is inserted once the line is up, so a refusal leaves none open; the page follows the line at
 * `planRelayOf` its id.
 */
export async function openPlanLine(input: {
  sdp: string;
  voice: { instructions: string; voice: string };
  settings: LiveSettings;
  backendPrompt: string;
  opened: { webSearch: boolean; readSkills: boolean };
  insertRow: () => Promise<string>;
}): Promise<{ callId: string; sdp: string }> {
  const { settings, opened } = input;
  const [text, declared, exaKey, openaiKey] = await Promise.all([
    getTextModel({ provider: "chatgpt", model: settings.backendModel }),
    loadTools({ target: "thursday", ...opened }),
    readConfig(EXA_API_KEY),
    readConfig(LIVE_PROVIDER.apiKeyName),
  ]);
  // The reasoning asked for is checked the way a call in writing checks it (thursday.text):
  // only a key can ask the model, so without one it goes as chosen
  const reasoning = openaiKey
    ? await acceptedReasoning({
        apiKey: openaiKey,
        model: settings.backendModel,
        effort: settings.reasoningEffort,
      })
    : wantedReasoning(settings.reasoningEffort);

  // Declared, not run: every call of hers goes to the page, which runs it as on a key's call
  const tools: ToolSet = {};
  for (const [name, { execute: _runsInThePage, ...one }] of Object.entries(
    declared,
  ))
    tools[name] = one;
  // One search, never two, as on a key's call (thursday.action): Exa's while its key is set
  const hosted = text.searchTools && Object.values(text.searchTools)[0];
  if (opened.webSearch && !exaKey && hosted)
    tools[TOOL_NAMES.web_search] = hosted;

  const opening = await openPlanCall({
    sdp: input.sdp,
    session: {
      model: LIVE_PLAN_MODEL,
      instructions: input.voice.instructions,
      audio: { output: { voice: input.voice.voice } },
      delegation: { type: "client" },
    },
  });

  const bus = createEventBus<WireEvent>();
  const line: PlanLine = {
    id: "",
    wire: { say: () => false, answer: () => false, close: () => {} },
    began: Date.now(),
    over: false,
    bus,
    outbox: [],
    followed: false,
    orphan: undefined,
    stop: new AbortController(),
    backend: {
      model: text.model,
      system: input.backendPrompt,
      tools,
      providerOptions: {
        openai: {
          ...(reasoning?.effort ? { reasoningEffort: reasoning.effort } : {}),
          ...(reasoning && "summary" in reasoning && reasoning.summary
            ? { reasoningSummary: reasoning.summary }
            : {}),
        },
      },
    },
    messages: [],
    facts: [],
    talk: [],
    handed: [],
    working: false,
    calling: [],
    outputs: new Map(),
    pictures: [],
    asked: false,
    next: null,
  };
  line.wire = await joinPlanLine({
    callId: opening.callId,
    headers: opening.headers,
    on: {
      event: (event) => hear(line, event),
      closed: (code) =>
        end(line, code === 1000 ? "remote_hangup" : "connection_lost"),
    },
  });
  try {
    line.id = await input.insertRow();
  } catch (cause) {
    line.wire.close();
    throw cause;
  }
  lines.set(line.id, line);
  // A page that failed after the handshake never follows, and the line would stay open for nobody
  line.orphan = setTimeout(() => {
    if (!line.followed) end(line, "connection_lost");
  }, LIVE_CALL.startupMs);
  // The line is up: the page may speak into it once its own media is too
  toPage(line, { type: "session.started" });
  return { callId: line.id, sdp: opening.sdp };
}

/**
 * The page's side of a line: what it said so far, then each event as it comes, for as long as
 * the page stays. A page that leaves takes the call with it, since the media was its.
 */
export function followPlanLine(callId: string, signal: AbortSignal): Response {
  const line = lines.get(callId);
  if (!line || line.over) publicError("That call is not open on the plan.");
  if (line.followed) publicError("That call already has its page.");
  line.followed = true;
  clearTimeout(line.orphan);
  return createEventStream(line.bus, {
    onWatchers: (count) => {
      if (count === 0) end(line, "connection_lost");
    },
  }).respond(signal, () => line.outbox.splice(0));
}

/** What the page says on a line, in the order it said it. */
export function tellPlanLine(callId: string, events: unknown[]): void {
  const line = lines.get(callId);
  if (!line) publicError("That call is not open on the plan.");
  for (const event of events) take(line, (event ?? {}) as PageEvent);
}

function toPage(line: PlanLine, event: WireEvent) {
  const stamped = { ...event, offset_ms: Date.now() - line.began };
  if (line.followed) line.bus.emit(stamped);
  else line.outbox.push(stamped);
}

function hear(line: PlanLine, event: PlanEvent) {
  if (line.over) return;
  switch (event.type) {
    case "heard": {
      // Pieces keep the order they came in; the page groups them into turns by their time
      const at = Date.now() - line.began;
      toPage(line, {
        type:
          event.role === "user"
            ? "session.input_transcript.delta"
            : "session.output_transcript.delta",
        delta: event.text,
        start_ms: at,
        end_ms: at,
      });
      const last = line.talk.at(-1);
      if (last && last.role === event.role && !last.done)
        last.text += event.text;
      else line.talk.push({ role: event.role, text: event.text, done: false });
      return;
    }
    case "turn": {
      // The whole turn, in place of its pieces
      const open = line.talk.findLast(
        (entry) => entry.role === event.role && !entry.done,
      );
      if (open) {
        open.text = event.text;
        open.done = true;
      } else line.talk.push({ role: event.role, text: event.text, done: true });
      return;
    }
    case "delegated":
      line.handed.push({ id: event.id, text: event.text });
      void work(line);
      return;
    case "error":
      toPage(line, { type: "error", error: { message: event.message } });
      return;
    case "started":
      // Said to the page as the line came up
      return;
  }
}

function take(line: PlanLine, event: PageEvent) {
  if (line.over) return;
  switch (event.type) {
    case "session.instructions.append":
    case "session.commentary.append":
    case "session.thinking.append": {
      // An opening or an update is hers to say; context she keeps without reading out
      const kind = event.type.split(".")[1];
      const said =
        typeof event.content === "string" &&
        line.wire.say(
          event.content,
          kind === "thinking" ? "commentary" : "speakable",
        );
      toPage(
        line,
        said
          ? {
              type: `session.${kind}.appended`,
              client_event_id: event.event_id,
            }
          : {
              type: "error",
              error: {
                message: "The call on the plan did not take that update.",
                client_event_id: event.event_id,
              },
            },
      );
      return;
    }
    case "response.item.create": {
      const item = event.item;
      if (item?.type === "function_call_output") {
        if (typeof item.call_id === "string")
          line.outputs.set(
            item.call_id,
            typeof item.output === "string" ? item.output : "",
          );
        return;
      }
      const parts = item?.type === "message" ? (item.content ?? []) : [];
      if (item?.role === "user") {
        // A file they put down or a drawing they showed, as a picture with the words it came with
        for (const part of parts)
          if (part.type === "input_image" && typeof part.image_url === "string")
            line.pictures.push({ type: "image", image: part.image_url });
          else if (part.type === "input_text" && typeof part.text === "string")
            line.pictures.push({ type: "text", text: part.text });
        return;
      }
      if (item?.role === "developer")
        for (const part of parts)
          if (part.type === "input_text" && typeof part.text === "string")
            line.facts.push(part.text);
      return;
    }
    case "response.create":
      // Going on with a step's calls; else a run on what the page put down, as the guide has
      // a key's backend run on a picture ("then send response.create to run")
      if (
        line.calling.length &&
        line.calling.every((call) => line.outputs.has(call))
      ) {
        if (line.next) line.next();
        else line.asked = true;
      } else {
        line.handed.push({ id: null });
        void work(line);
      }
      return;
    case "session.close":
      end(line, "close_requested");
      return;
  }
}

/** Hand-overs and runs the page asked for, one at a time, in the order they came. */
async function work(line: PlanLine) {
  if (line.working) return;
  line.working = true;
  try {
    for (
      let next = line.handed.shift();
      next && !line.over;
      next = line.handed.shift()
    )
      await respond(line, next);
  } finally {
    line.working = false;
  }
}

/** A field of a hand-over as Codex bounds one: escaped, and cut at `delegationBytes` from the end it keeps. */
function bounded(text: string, keep: "start" | "end"): string {
  const escaped = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  if (Buffer.byteLength(escaped) <= PLAN_CALL.delegationBytes) return escaped;
  // Whole characters from the end it keeps, as many as fit beside the mark
  let room = PLAN_CALL.delegationBytes - Buffer.byteLength("…");
  const characters = Array.from(escaped);
  if (keep === "end") characters.reverse();
  const kept: string[] = [];
  for (const character of characters) {
    room -= Buffer.byteLength(character);
    if (room < 0) break;
    kept.push(character);
  }
  if (keep === "end") kept.reverse();
  return keep === "start" ? `${kept.join("")}…` : `…${kept.join("")}`;
}

/**
 * What the voice handed over, as the Codex CLI hands it to its own backend (codex-rs core
 * context/realtime_delegation.rs `RealtimeDelegation`): its words, and what was said since the
 * hand-over before, a line a turn.
 */
function handedOver(text: string, talk: string): string {
  const input = bounded(text || talk, "start");
  const said = talk
    ? `\n  <transcript_delta>${bounded(talk, "end")}</transcript_delta>`
    : "";
  return `<realtime_delegation>\n  <input>${input}</input>${said}\n</realtime_delegation>`;
}

/**
 * One hand-over, a step of her backend at a time, each a response of the page's wire: what
 * the step called goes to the page, which runs it and asks for the next response; a call the
 * sdk could not take is answered by it, and she reads its error in the next step. What she
 * says at the end goes back to the voice to say; a step that fails tells the voice so, and so
 * does running out of steps before an answer. A run
 * the page asked for is the same with no hand-over, on what it put down and what was said
 * since she last worked: its end goes into the voice to say. One whose put-down a turn before
 * it already took runs nothing, or she answered the same picture twice.
 */
async function respond(line: PlanLine, handed: Handed) {
  if (handed.id === null && !line.facts.length && !line.pictures.length) return;
  const tell = (text: string) =>
    handed.id === null
      ? line.wire.say(text, "speakable")
      : line.wire.answer(handed.id, text, "speakable");
  const talk = line.talk
    .splice(0)
    .map((entry) => `${entry.role}: ${entry.text}`)
    .join("\n");
  // With no hand-over to carry it, what was said around the showing goes in on its own: "is
  // this logo too busy?" said as it was shown is what she answers
  if (handed.id === null && talk)
    line.messages.push({
      role: "system",
      content: `Said since you last worked, as the voice's side transcribed it:\n<transcript_delta>${bounded(talk, "end")}</transcript_delta>`,
    });
  // What was put down before the voice handed over came before it: in after the hand-over,
  // a picture put down a while ago read as sent with the words
  takeGiven(line);
  if (handed.id !== null)
    line.messages.push({
      role: "user",
      content: handedOver(handed.text, talk),
    });

  for (let step = 0; step < TEXT_CALL.maxSteps && !line.over; step += 1) {
    const id = `resp_${randomUUID()}`;
    const emit = (event: WireEvent) =>
      toPage(line, {
        type: "response.event",
        delegation_id: handed.id,
        event: { response_id: id, ...event },
      });
    emit({ type: "response.created", response: { id } });

    const done = await stepOf(line, emit);
    if (line.over) return;
    if ("failed" in done) {
      emit({
        type: "response.failed",
        response: { id, error: { message: done.failed } },
      });
      tell(`That failed: ${done.failed}`);
      return;
    }
    // Set before the page hears the step end, which is when it may ask to go on
    line.calling = done.calls.map((call) => call.toolCallId);
    emit({ type: "response.completed", response: { id } });
    if (!done.calls.length) {
      // Nothing for the page to run, and the sdk's error is among her messages already: she
      // reads it, and answers or calls what she meant. What was put down meanwhile goes in
      // after it, and the steps one answer may take still bound this
      if (done.invalid) {
        takeGiven(line);
        continue;
      }
      if (done.text) tell(done.text);
      return;
    }

    // The page runs the calls and sends each one's output, then asks for the next response
    if (!line.asked)
      await new Promise<void>((next) => {
        line.next = next;
      });
    line.next = null;
    line.asked = false;
    line.calling = [];
    if (line.over) return;
    line.messages.push({
      role: "tool",
      content: done.calls.map((call) => ({
        type: "tool-result" as const,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output: {
          type: "text" as const,
          value: line.outputs.get(call.toolCallId) ?? "No output came back.",
        },
      })),
    });
    for (const call of done.calls) line.outputs.delete(call.toolCallId);
    // Put down while her calls ran: after their results, as a key's call puts it
    takeGiven(line);
  }
  // Every step one answer may take is gone with no answer: said, as a failed step is, or the
  // voice waits on a hand-over that never comes back
  if (!line.over)
    tell("That failed: it ran out of steps before it had an answer.");
}

/** What the page put down, into her conversation in the order it sent it: each fact, then the pictures it names. */
function takeGiven(line: PlanLine) {
  for (const fact of line.facts.splice(0))
    line.messages.push({ role: "system", content: fact });
  showPictures(line);
}

/** The pictures the page sent as the user's, into her conversation as one message of theirs. */
function showPictures(line: PlanLine) {
  const shown = line.pictures.splice(0);
  if (shown.length) line.messages.push({ role: "user", content: shown });
}

/** One step of her backend on the plan, told to the page as it goes. */
async function stepOf(
  line: PlanLine,
  emit: (event: WireEvent) => void,
): Promise<
  | {
      /** What the page runs. */
      calls: { toolCallId: string; toolName: string }[];
      /** The sdk could not take a call and answered it itself: the page has no result to send for it. */
      invalid: boolean;
      text: string;
    }
  | { failed: string }
> {
  const thought = new Map<string, string>();
  const cited = new Map<string, { url: string; title?: string }>();
  try {
    const result = streamText({
      model: line.backend.model,
      instructions: line.backend.system,
      messages: line.messages,
      allowSystemInMessages: true,
      tools: line.backend.tools,
      providerOptions: line.backend.providerOptions,
      abortSignal: line.stop.signal,
    });
    for await (const part of result.fullStream) {
      switch (part.type) {
        case "reasoning-delta":
          thought.set(part.id, (thought.get(part.id) ?? "") + part.text);
          break;
        case "reasoning-end": {
          const text = thought.get(part.id)?.trim();
          if (text)
            emit({
              type: "response.reasoning_summary_text.done",
              item_id: part.id,
              summary_index: 0,
              text,
            });
          break;
        }
        case "tool-call":
          // A call the sdk could not take, a tool she lacks or input that does not fit its
          // tool, it answers itself with an error among the step's messages: the page is not
          // asked to run it as well, or the call would have two results
          if (part.invalid && !part.providerExecuted) break;
          // Her search runs on the plan's side: the page is told what it looked for, not asked to run it
          emit(
            part.providerExecuted
              ? {
                  type: "response.output_item.added",
                  item: {
                    type: "web_search_call",
                    id: part.toolCallId,
                    action: {},
                  },
                }
              : {
                  type: "response.output_item.done",
                  item: {
                    type: "function_call",
                    id: part.toolCallId,
                    call_id: part.toolCallId,
                    name: part.toolName,
                    arguments: JSON.stringify(part.input ?? {}),
                    status: "completed",
                  },
                },
          );
          break;
        case "tool-result":
          if (part.providerExecuted)
            emit({
              type: "response.output_item.done",
              item: {
                type: "web_search_call",
                id: part.toolCallId,
                action: searchActionOf(part.output),
              },
            });
          break;
        case "source":
          if (part.sourceType === "url" && !cited.has(part.url))
            cited.set(part.url, {
              url: part.url,
              ...(part.title ? { title: part.title } : {}),
            });
          break;
        case "error":
          throw part.error;
      }
    }
    const [calls, text, response] = await Promise.all([
      result.toolCalls,
      result.text,
      result.response,
    ]);
    // The pages her answer cites, as the answer's item names them on a key's call
    if (cited.size)
      emit({
        type: "response.output_item.done",
        item: {
          type: "message",
          id: `msg_${randomUUID()}`,
          content: [
            {
              type: "output_text",
              annotations: [...cited.values()].map((page) => ({
                type: "url_citation",
                ...page,
              })),
            },
          ],
        },
      });
    line.messages.push(...response.messages);
    const asked = calls.filter((call) => !call.providerExecuted);
    return {
      calls: asked.filter((call) => !call.invalid),
      invalid: asked.some((call) => call.invalid),
      text: text.trim(),
    };
  } catch (cause) {
    if (line.over) return { failed: "The call ended." };
    logger.warn({ cause }, "plan call backend step failed");
    return { failed: modelErrorToString(cause) };
  }
}

/** What a hosted search looked for and read, as a search item's `action` words it (live.session). */
function searchActionOf(output: unknown) {
  const { action, sources } = (output ?? {}) as {
    action?: { query?: unknown; queries?: unknown };
    sources?: { url?: unknown }[];
  };
  return {
    ...(typeof action?.query === "string" ? { query: action.query } : {}),
    ...(Array.isArray(action?.queries) ? { queries: action.queries } : {}),
    sources: (sources ?? []).flatMap((source) =>
      typeof source?.url === "string" ? [{ url: source.url }] : [],
    ),
  };
}

/** The line is over, whoever ended it: the voice is told, the backend stops, the page hears why last. */
function end(line: PlanLine, reason: string) {
  if (line.over) return;
  line.over = true;
  clearTimeout(line.orphan);
  line.stop.abort();
  line.next?.();
  line.wire.close();
  lines.delete(line.id);
  toPage(line, { type: "session.closed", reason });
}
