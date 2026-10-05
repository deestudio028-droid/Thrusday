import * as z from "zod";
import { REMINDER } from "@/config";

export const ReminderInputSchema = z.object({
  label: z.string().trim().min(1).max(80),
  words: z.string().trim().min(1).max(REMINDER.maxWords),
  at: z.string().regex(/^\d{4}-\d\d-\d\d ([01]\d|2[0-3]):[0-5]\d$/),
  timeZone: z.string().min(1).max(100),
});
export type ReminderInput = z.infer<typeof ReminderInputSchema>;
export type ReminderChannel = "email" | "telegram" | "call";
export const REMINDER_CHANNELS: ReminderChannel[] = [
  "email",
  "telegram",
  "call",
];
export const CALL_OWNER_NUMBER_KEY = "REMINDER_CALL_OWNER_NUMBER";
export const TWILIO_ACCOUNT_SID_KEY = "TWILIO_ACCOUNT_SID";
export const TWILIO_AUTH_TOKEN_KEY = "TWILIO_AUTH_TOKEN";
export const TWILIO_CALLER_NUMBER_KEY = "TWILIO_CALLER_NUMBER";
export const TWILIO_VOICE_PIN_KEY = "TWILIO_VOICE_PIN";
export const CALL_MONTHLY_CAP_KEY = "REMINDER_CALL_MONTHLY_CAP";

/** Interpret a wall-clock minute in its IANA zone, rejecting missing or ambiguous DST time. */
export function dueInstant(at: string, timeZone: string): Date {
  const parsed = ReminderInputSchema.pick({ at: true, timeZone: true }).parse({
    at,
    timeZone,
  });
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: parsed.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    throw new Error("Choose a valid IANA time zone.");
  }
  const [year, month, day, hour, minute] = at.match(/\d+/g)!.map(Number);
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  if (
    new Date(wanted).getUTCDate() !== day ||
    new Date(wanted).getUTCMonth() !== month - 1
  )
    throw new Error("That calendar day does not exist.");
  const wall = (stamp: number) => {
    const parts = Object.fromEntries(
      formatter.formatToParts(stamp).map(({ type, value }) => [type, value]),
    );
    return Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    );
  };
  let guess = wanted;
  for (let pass = 0; pass < 4; pass++) guess += wanted - wall(guess);
  if (wall(guess) !== wanted)
    throw new Error("That local time does not exist in this time zone.");
  for (const other of [guess - 3_600_000, guess + 3_600_000])
    if (wall(other) === wanted)
      throw new Error(
        "That local time occurs twice. Choose an unambiguous time.",
      );
  return new Date(guess);
}
