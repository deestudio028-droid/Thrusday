import {
  handleInboundVoice,
  verifiedTwilioForm,
} from "@/features/twilio/voice";

export async function POST(
  request: Request,
  context: { params: Promise<{ step: string }> },
) {
  const form = await verifiedTwilioForm(request);
  if (!form) return new Response("Forbidden", { status: 403 });
  const { step } = await context.params;
  if (step !== "start" && step !== "pin" && step !== "talk" && step !== "wait")
    return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  return handleInboundVoice(
    form,
    step,
    step === "talk"
      ? url.searchParams.get("turn")
      : url.searchParams.get("wait"),
  );
}
