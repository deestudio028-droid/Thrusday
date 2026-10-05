import { googleRequest } from "./google";

export type CalendarEvent = {
  id: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  htmlLink?: string;
  status?: string;
};

const base = "/calendars/primary/events";

export async function listCalendarEvents(from: string, to: string) {
  const params = new URLSearchParams({
    timeMin: new Date(from).toISOString(),
    timeMax: new Date(to).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "100",
  });
  return googleRequest<{ items?: CalendarEvent[]; nextPageToken?: string }>(
    "calendar",
    `${base}?${params}`,
  );
}

export async function createCalendarEvent(input: {
  summary: string;
  description?: string;
  start: string;
  end: string;
  timeZone: string;
}) {
  return googleRequest<CalendarEvent>("calendar", base, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      summary: input.summary,
      description: input.description ?? "",
      start: { dateTime: input.start, timeZone: input.timeZone },
      end: { dateTime: input.end, timeZone: input.timeZone },
    }),
  });
}

export async function deleteCalendarEvent(id: string) {
  await googleRequest<null>("calendar", `${base}/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
