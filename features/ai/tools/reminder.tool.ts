import { tool } from "ai";
import * as z from "zod";
import {
  cancelReminder,
  createReminder,
  listReminders,
} from "@/features/reminder/reminder.query";
import { ReminderInputSchema } from "@/features/reminder/reminder.schema";
import { isPublicError } from "@/lib/public-error";
import { TOOL_NAMES } from "./tool-name";

const parameters = z.object({
  action: z.enum(["list", "create", "cancel"]),
  reminder: z
    .string()
    .nullish()
    .describe("With cancel: the reminder ID or unique label from list."),
  label: z
    .string()
    .nullish()
    .describe("With create: a short name for this one-time reminder."),
  words: z
    .string()
    .nullish()
    .describe(
      "With create: exactly what the user asked to be told, using the delivery channels chosen in Settings.",
    ),
  at: z
    .string()
    .nullish()
    .describe(
      'With create: local date and time, "YYYY-MM-DD HH:MM". Resolve relative times from Now.',
    ),
  timeZone: z
    .string()
    .nullish()
    .describe(
      'With create: the user\'s IANA time zone, e.g. "Asia/Kolkata". Ask if unknown.',
    ),
});

export function createReminderTools() {
  return {
    [TOOL_NAMES.reminder]: tool({
      description:
        "One-time, time-specific reminders requested by the user. List, create or cancel. At the due minute the server attempts the delivery channels chosen in Settings, including an owner-only mobile call. Each channel requires setup; unavailable channels are recorded, and uncertain sends are never repeated automatically. Do not say the user received a message or answered a call merely because a provider accepted it.",
      inputSchema: parameters,
      execute: async (args) => {
        if (args.action === "list") return { reminders: await listReminders() };
        if (args.action === "cancel") {
          const rows = await listReminders();
          const ref = args.reminder?.trim() ?? "";
          const matches = rows.filter(
            (row) =>
              row.id === ref || row.label.toLowerCase() === ref.toLowerCase(),
          );
          if (matches.length !== 1)
            return "Name one reminder by its ID or unique label from the list; nothing was cancelled.";
          return (await cancelReminder(matches[0].id))
            ? `Cancelled “${matches[0].label}”. A provider request already in flight might still arrive; check its channel status.`
            : `“${matches[0].label}” was already cancelled.`;
        }
        const parsed = ReminderInputSchema.safeParse({
          label: args.label ?? "",
          words: args.words ?? "",
          at: args.at ?? "",
          timeZone: args.timeZone ?? "",
        });
        if (!parsed.success)
          return `${parsed.error.issues[0].message}. Nothing was scheduled.`;
        try {
          const made = await createReminder(parsed.data);
          return {
            ...made,
            note: "Scheduled once. Email, Telegram and phone attempts depend on each channel being connected at that time. Check the reminder list for the delivery outcome.",
          };
        } catch (cause) {
          if (isPublicError(cause)) return cause.message;
          if (
            cause instanceof RangeError ||
            (cause instanceof Error &&
              /time zone|calendar day|local time/.test(cause.message))
          )
            return `${cause.message} Nothing was scheduled.`;
          throw cause;
        }
      },
    }),
  };
}
