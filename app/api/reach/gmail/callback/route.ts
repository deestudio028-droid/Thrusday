import { finishGmailAuthorization } from "@/features/reach/gmail";
import { isPublicError } from "@/lib/public-error";

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    if (url.searchParams.has("error"))
      throw new Error(
        "Google did not grant Gmail access. Start again in Settings › Phone.",
      );
    await finishGmailAuthorization(
      url.searchParams.get("code") ?? "",
      url.searchParams.get("state") ?? "",
    );
    return new Response(null, {
      status: 303,
      headers: {
        location: "/",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    });
  } catch (cause) {
    return new Response(
      isPublicError(cause)
        ? cause.message
        : "Gmail connection failed. Try again in Settings › Phone.",
      {
        status: 400,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
        },
      },
    );
  }
}
