import {
  answerPcBrowser,
  authenticatePcBrowser,
  pollPcBrowser,
} from "@/features/pc-browser/bridge";

const headers = {
  "cache-control": "private, no-store",
  "content-type": "application/json",
};
const deny = () =>
  new Response(JSON.stringify({ error: "PC Chrome pairing required" }), {
    status: 401,
    headers,
  });

export async function GET(request: Request) {
  if (!(await authenticatePcBrowser(request.headers.get("authorization"))))
    return deny();
  if (new URL(request.url).searchParams.get("verify") === "1")
    return new Response(JSON.stringify({ paired: true }), { headers });
  const ready = request.headers.get("x-thursday-ready") === "1";
  const command = await pollPcBrowser(ready);
  return new Response(JSON.stringify({ command }), { headers });
}

export async function POST(request: Request) {
  if (!(await authenticatePcBrowser(request.headers.get("authorization"))))
    return deny();
  const body = await request.text();
  if (body.length > 100_000)
    return new Response("Result too large", { status: 413 });
  let result: { id: string; ok: boolean; value?: unknown; error?: string };
  try {
    result = JSON.parse(body);
  } catch {
    return new Response("Invalid result", { status: 400 });
  }
  if (
    !/^[a-f0-9]{32}$/.test(result.id) ||
    typeof result.ok !== "boolean" ||
    (result.error !== undefined &&
      (typeof result.error !== "string" || result.error.length > 1000))
  )
    return new Response("Invalid result", { status: 400 });
  if (!answerPcBrowser(result))
    return new Response("Result no longer expected", { status: 409 });
  return new Response(null, { status: 204, headers });
}
