import { readConfig } from "@/features/config/config.query";
import { recordCallStatus } from "@/features/reminder/reminder.query";
import {
  CALL_OWNER_NUMBER_KEY,
  TWILIO_ACCOUNT_SID_KEY,
  TWILIO_CALLER_NUMBER_KEY,
} from "@/features/reminder/reminder.schema";
import { verifiedTwilioForm } from "@/features/twilio/voice";

export async function POST(request: Request) {
  const form = await verifiedTwilioForm(request);
  if (!form) return new Response("Forbidden", { status: 403 });
  const [sid, owner, caller] = await Promise.all([
    readConfig(TWILIO_ACCOUNT_SID_KEY),
    readConfig(CALL_OWNER_NUMBER_KEY),
    readConfig(TWILIO_CALLER_NUMBER_KEY),
  ]);
  if (
    form.get("AccountSid") !== sid ||
    form.get("To") !== owner ||
    form.get("From") !== caller
  )
    return new Response("Forbidden", { status: 403 });
  await recordCallStatus(
    form.get("CallSid") ?? "",
    form.get("CallStatus") ?? "",
  );
  return new Response(null, { status: 204 });
}
