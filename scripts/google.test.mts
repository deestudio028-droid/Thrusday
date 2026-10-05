import assert from "node:assert/strict";
import { mock, test } from "node:test";

let invalidated = 0;
mock.module("../features/reach/gmail.ts", {
  namedExports: {
    googleAccessToken: async () => "access-test",
    invalidateGoogleAccessToken: () => {
      invalidated++;
    },
  },
});
const { listCalendarEvents, createCalendarEvent, deleteCalendarEvent } =
  await import("../features/google/calendar.ts");
const { listDriveFiles, readDriveFile } = await import(
  "../features/google/drive.ts"
);

test("Google connectors use fixed API origins, bearer auth, scoped inputs and bounded content", async () => {
  const oldFetch = globalThis.fetch;
  const requests: { url: URL; options: RequestInit }[] = [];
  globalThis.fetch = (async (input: string, options: RequestInit) => {
    const url = new URL(input);
    requests.push({ url, options });
    assert.equal(
      (options.headers as Record<string, string>).authorization,
      "Bearer access-test",
    );
    if (url.pathname.endsWith("/export")) return new Response("Document text");
    if (url.searchParams.has("alt")) return new Response("Plain text");
    if (url.pathname.endsWith("/files/file-1"))
      return Response.json({
        id: "file-1",
        name: "My Doc",
        mimeType: "application/vnd.google-apps.document",
        capabilities: { canDownload: true },
      });
    if (url.pathname.endsWith("/events/event-1") && options.method === "DELETE")
      return new Response(null, { status: 204 });
    if (url.pathname.endsWith("/events") && options.method === "POST")
      return Response.json({ id: "event-1", summary: "Visit" });
    return Response.json({ items: [], files: [] });
  }) as typeof fetch;
  try {
    await listCalendarEvents(
      "2026-10-04T09:00:00+05:30",
      "2026-10-05T09:00:00+05:30",
    );
    await createCalendarEvent({
      summary: "Visit",
      start: "2026-10-04T09:00:00+05:30",
      end: "2026-10-04T10:00:00+05:30",
      timeZone: "Asia/Kolkata",
    });
    await deleteCalendarEvent("event-1");
    await listDriveFiles("O'Brien");
    const read = await readDriveFile("file-1");
    assert.equal(read.content, "Document text");
    assert.equal(requests[0].url.origin, "https://www.googleapis.com");
    assert.equal(
      requests[0].url.searchParams.get("timeMin"),
      "2026-10-04T03:30:00.000Z",
    );
    assert.equal(
      requests[3].url.searchParams.get("q"),
      "trashed = false and name contains 'O\\'Brien'",
    );
    assert.equal(requests[4].url.pathname, "/drive/v3/files/file-1");
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("revoked token clears the cache and requires reconnection", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("revoked", { status: 401 })) as typeof fetch;
  try {
    await assert.rejects(listDriveFiles(""), /Reconnect Google/);
    assert.equal(invalidated, 1);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
