import { and, count, eq, isNull, lte, notLike } from "drizzle-orm";
import { appEvents } from "@/app/api/events/app-event.server";
import { REMINDER } from "@/config";
import { database } from "@/database/db";
import { reminderDeliveryTable, reminderTable } from "@/database/tables";
import { readConfig } from "@/features/config/config.query";
import { publicError } from "@/lib/public-error";
import {
  dueInstant,
  REMINDER_CHANNELS,
  type ReminderChannel,
  type ReminderInput,
} from "./reminder.schema";

const changed = () => appEvents.emit({ type: "routines" });
const earlyCallStatuses = new Map<string, string>();

/** A stable inbox message ID prevents duplicate alerts after reclassification or restart. */
export async function queueImportantMailAlert(
  id: string,
  label: string,
  words: string,
  now = new Date(),
) {
  await database.transaction(async (tx) => {
    const made = await tx
      .insert(reminderTable)
      .values({ id, label, words, dueAt: now, timeZone: "UTC" })
      .onConflictDoNothing()
      .returning();
    if (!made.length) return;
    await tx.insert(reminderDeliveryTable).values(
      ["telegram", "call"].map((channel) => ({
        reminderId: id,
        channel: channel as ReminderChannel,
      })),
    );
  });
  changed();
}
type DeliveryStatus = typeof reminderDeliveryTable.$inferSelect.status;

export async function createReminder(input: ReminderInput, now = new Date()) {
  const dueAt = dueInstant(input.at, input.timeZone);
  if (dueAt <= now)
    publicError("That reminder time has passed. Choose a later time.");
  const [{ total }] = await database
    .select({ total: count() })
    .from(reminderTable)
    .where(notLike(reminderTable.id, "mail-%"));
  if (total >= REMINDER.max)
    publicError("The reminder list is full. Delete an old reminder first.");
  const id = crypto.randomUUID();
  const channels =
    (await readConfig("REMINDER_CHANNELS")) === "call"
      ? (["call"] as const)
      : REMINDER_CHANNELS;
  await database.transaction(async (tx) => {
    await tx.insert(reminderTable).values({
      id,
      label: input.label,
      words: input.words,
      dueAt,
      timeZone: input.timeZone,
    });
    await tx
      .insert(reminderDeliveryTable)
      .values(channels.map((channel) => ({ reminderId: id, channel })));
  });
  changed();
  return { id, label: input.label, dueAt, timeZone: input.timeZone };
}

export async function listReminders() {
  const rows = await database
    .select()
    .from(reminderTable)
    .orderBy(reminderTable.dueAt);
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      deliveries: await database
        .select()
        .from(reminderDeliveryTable)
        .where(eq(reminderDeliveryTable.reminderId, row.id)),
    })),
  );
}

export async function cancelReminder(id: string, now = new Date()) {
  const [row] = await database
    .update(reminderTable)
    .set({ cancelledAt: now })
    .where(and(eq(reminderTable.id, id), isNull(reminderTable.cancelledAt)))
    .returning();
  if (!row) return false;
  await database
    .update(reminderDeliveryTable)
    .set({ status: "cancelled", finishedAt: now })
    .where(
      and(
        eq(reminderDeliveryTable.reminderId, id),
        eq(reminderDeliveryTable.status, "ready"),
      ),
    );
  await database
    .update(reminderDeliveryTable)
    .set({ status: "cancelled", finishedAt: now })
    .where(
      and(
        eq(reminderDeliveryTable.reminderId, id),
        eq(reminderDeliveryTable.status, "claimed"),
      ),
    );
  changed();
  return true;
}

export async function dueDeliveries(now = new Date()) {
  return database
    .select({
      reminderId: reminderDeliveryTable.reminderId,
      channel: reminderDeliveryTable.channel,
      words: reminderTable.words,
      dueAt: reminderTable.dueAt,
    })
    .from(reminderDeliveryTable)
    .innerJoin(
      reminderTable,
      eq(reminderTable.id, reminderDeliveryTable.reminderId),
    )
    .where(
      and(
        eq(reminderDeliveryTable.status, "ready"),
        lte(reminderTable.dueAt, now),
        isNull(reminderTable.cancelledAt),
      ),
    );
}

/** Atomic compare-and-set: another tick cannot take the same delivery. */
export async function claimDelivery(
  id: string,
  channel: ReminderChannel,
): Promise<boolean> {
  const rows = await database
    .update(reminderDeliveryTable)
    .set({ status: "claimed" })
    .where(
      and(
        eq(reminderDeliveryTable.reminderId, id),
        eq(reminderDeliveryTable.channel, channel),
        eq(reminderDeliveryTable.status, "ready"),
      ),
    )
    .returning();
  return rows.length === 1;
}

/** Last cancellation check before an external request can be issued. */
export async function beginDispatch(
  id: string,
  channel: ReminderChannel,
  now = new Date(),
): Promise<boolean> {
  const [reminder] = await database
    .select()
    .from(reminderTable)
    .where(eq(reminderTable.id, id));
  if (
    !reminder ||
    reminder.cancelledAt ||
    now.getTime() - reminder.dueAt.getTime() > REMINDER.catchUpMs
  ) {
    await finishDelivery(
      id,
      channel,
      reminder?.cancelledAt ? "cancelled" : "unavailable",
      "Cancelled or too late",
      now,
    );
    return false;
  }
  const rows = await database
    .update(reminderDeliveryTable)
    .set({ status: "dispatching", startedAt: now })
    .where(
      and(
        eq(reminderDeliveryTable.reminderId, id),
        eq(reminderDeliveryTable.channel, channel),
        eq(reminderDeliveryTable.status, "claimed"),
      ),
    )
    .returning();
  return rows.length === 1;
}

export async function finishDelivery(
  id: string,
  channel: ReminderChannel,
  status: DeliveryStatus,
  detail: string | null,
  now = new Date(),
) {
  await database
    .update(reminderDeliveryTable)
    .set({ status, detail, finishedAt: now })
    .where(
      and(
        eq(reminderDeliveryTable.reminderId, id),
        eq(reminderDeliveryTable.channel, channel),
        status === "cancelled" || status === "unavailable"
          ? eq(reminderDeliveryTable.status, "claimed")
          : eq(reminderDeliveryTable.status, "dispatching"),
      ),
    );
  changed();
}

export async function recordCallAccepted(
  id: string,
  providerId: string,
  providerStatus: string,
  now = new Date(),
) {
  providerStatus = earlyCallStatuses.get(providerId) ?? providerStatus;
  earlyCallStatuses.delete(providerId);
  await database
    .update(reminderDeliveryTable)
    .set({
      status: "accepted",
      detail: "Twilio accepted the call request",
      providerId,
      providerStatus,
      finishedAt: now,
    })
    .where(
      and(
        eq(reminderDeliveryTable.reminderId, id),
        eq(reminderDeliveryTable.channel, "call"),
        eq(reminderDeliveryTable.status, "dispatching"),
      ),
    );
  changed();
}

/** Signed provider callback may race the Create Call API response. */
export async function recordCallStatus(providerId: string, status: string) {
  if (
    !/^CA[a-f0-9]{32}$/i.test(providerId) ||
    !/^(queued|initiated|ringing|in-progress|completed|busy|no-answer|failed|canceled)$/.test(
      status,
    )
  )
    return false;
  const updated = await database
    .update(reminderDeliveryTable)
    .set({ providerStatus: status })
    .where(
      and(
        eq(reminderDeliveryTable.channel, "call"),
        eq(reminderDeliveryTable.providerId, providerId),
      ),
    )
    .returning();
  if (updated.length) {
    changed();
    return true;
  }
  if (earlyCallStatuses.size > 100) earlyCallStatuses.clear();
  earlyCallStatuses.set(providerId, status);
  setTimeout(() => earlyCallStatuses.delete(providerId), 60_000).unref();
  return false;
}

/** On restart, a claim not yet dispatched is safe to take again. An in-flight send is uncertain. */
export async function recoverDeliveries(now = new Date()) {
  await database
    .update(reminderDeliveryTable)
    .set({ status: "ready" })
    .where(eq(reminderDeliveryTable.status, "claimed"));
  await database
    .update(reminderDeliveryTable)
    .set({
      status: "unknown",
      detail: "Server restarted during provider dispatch",
      finishedAt: now,
    })
    .where(eq(reminderDeliveryTable.status, "dispatching"));
  changed();
}
