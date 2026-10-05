import { REMINDER } from "@/config";
import { ownerNoticeReady, sendOwnerNotice } from "@/features/reach/reach";
import { logger } from "@/lib/logger";
import { isPublicError } from "@/lib/public-error";
import { callSetup, placeOwnerCall } from "./call";
import {
  beginDispatch,
  claimDelivery,
  dueDeliveries,
  finishDelivery,
  recordCallAccepted,
  recoverDeliveries,
} from "./reminder.query";
import type { ReminderChannel } from "./reminder.schema";

type NoticeSenders = {
  email: (words: string) => Promise<void>;
  telegram: (words: string) => Promise<void>;
  call: (
    words: string,
    now: Date,
    reminderId: string,
  ) => Promise<{ sid: string; status: string }>;
};

const liveSenders: NoticeSenders = {
  email: (words) => sendOwnerNotice("email", words),
  telegram: (words) => sendOwnerNotice("telegram", words),
  call: placeOwnerCall,
};

/** One durable provider attempt. A failed or interrupted dispatch is never blindly repeated. */
async function deliver(
  item: {
    reminderId: string;
    channel: ReminderChannel;
    words: string;
    dueAt: Date;
  },
  now: Date,
  senders: NoticeSenders,
) {
  if (
    item.channel !== "call" &&
    now.getTime() - item.dueAt.getTime() <= REMINDER.catchUpMs &&
    !(await ownerNoticeReady(item.channel))
  )
    return;
  if (!(await claimDelivery(item.reminderId, item.channel))) return;
  if (item.channel === "call") {
    const setup = await callSetup();
    if (!setup.ready) {
      await finishDelivery(
        item.reminderId,
        "call",
        "unavailable",
        "Call setup is off or incomplete",
        now,
      );
      return;
    }
  }
  if (!(await beginDispatch(item.reminderId, item.channel, now))) return;
  try {
    if (item.channel === "call") {
      const receipt = await senders.call(item.words, now, item.reminderId);
      if (!/^CA[a-f0-9]{32}$/i.test(receipt.sid))
        throw new Error("Invalid Twilio call receipt");
      await recordCallAccepted(item.reminderId, receipt.sid, receipt.status);
      return;
    }
    await senders[item.channel](item.words);
    await finishDelivery(
      item.reminderId,
      item.channel,
      "accepted",
      "Provider accepted the request",
      new Date(),
    );
  } catch (cause) {
    const certain = isPublicError(cause);
    await finishDelivery(
      item.reminderId,
      item.channel,
      certain ? "unavailable" : "unknown",
      certain
        ? cause.message
        : "Provider outcome uncertain; no automatic retry",
      new Date(),
    );
    if (!certain)
      logger.warn(
        `reminder ${item.channel}: provider outcome uncertain`,
        cause,
      );
  }
}

/** Called at startup and on a short timer; SQLite claims prevent overlapping ticks. */
export async function startDueReminders(
  now = new Date(),
  senders = liveSenders,
) {
  const due = await dueDeliveries(now);
  for (const item of due) {
    try {
      await deliver(item, now, senders);
    } catch (cause) {
      logger.error(
        `reminder ${item.channel}: could not prepare delivery`,
        cause,
      );
    }
  }
}

type Pinned = typeof globalThis & { __reminderClock?: NodeJS.Timeout };

export async function startReminderClock() {
  const pinned = globalThis as Pinned;
  if (pinned.__reminderClock) clearInterval(pinned.__reminderClock);
  await recoverDeliveries();
  let looking = false;
  const tick = () => {
    if (looking) return;
    looking = true;
    void startDueReminders()
      .catch((cause) => logger.error("reminder clock", cause))
      .finally(() => {
        looking = false;
      });
  };
  tick();
  pinned.__reminderClock = setInterval(tick, REMINDER.tickMs);
  pinned.__reminderClock.unref();
}
