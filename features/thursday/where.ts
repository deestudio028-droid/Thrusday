import { HERE } from "@/config";
import { errorToString } from "@/lib/utils";
import type { Where } from "./thursday.schema";

// In the browser: where the user is, asked of the device, named and forecast from here.
// Both services are free, take no key and answer a page directly; BigDataCloud's fair use
// asks for exactly this — calls from the browser, with the device's current position from
// the Geolocation API — so a server anywhere, local or not, never sees the position.
// Looked up while the page is in front, before any call (`keepWhere`): a call reads what is
// kept and never waits on the device or the services.

/**
 * What the page found: `where` goes to the server for her prompts; `position` and `country`
 * stay on this page, where the globe is drawn (here-globe), and are never sent anywhere.
 */
export type Found = {
  where: Where;
  position: { lat: number; lon: number };
  /** The country the place service names there, ISO two letters: the one her prompt names. */
  country: string | null;
};

/**
 * What was found last, and when. A call reads it whole for `HERE.keptMs`; past that its
 * place is still read and its weather no longer is (`whereNow`).
 */
let kept: { found: Found; at: number } | null = null;

/**
 * Whether it is time to look again: nothing kept, or what is kept within one lookup's time
 * (`HERE.lookMs`) of running out. Looked up that much ahead, a page in front never has it
 * run out while the lookup that replaces it is still on its way.
 */
const due = () => !kept || Date.now() - kept.at >= HERE.keptMs - HERE.lookMs;

/**
 * The lookup on its way, so a second never starts beside it. One the device has left
 * unanswered for `HERE.keptMs` is given up on, and the next one asks again.
 */
let looking: { done: Promise<void>; asked: number } | null = null;

function position(): Promise<GeolocationCoordinates> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve(coords),
      reject,
      { maximumAge: HERE.keptMs },
    ),
  );
}

async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok)
    throw new Error(`${new URL(url).host} answered ${response.status}`);
  return response.json();
}

/** `Lisbon, Portugal`, in English like the rest of the prompt, and its country's code (`PT`). */
async function placeOf(
  at: GeolocationCoordinates,
  signal: AbortSignal,
): Promise<{ name: string | null; country: string | null }> {
  const body = (await getJson(
    `https://api.bigdatacloud.net/data/reverse-geocode-client?${new URLSearchParams(
      {
        latitude: String(at.latitude),
        longitude: String(at.longitude),
        localityLanguage: "en",
      },
    )}`,
    signal,
  )) as {
    city?: string;
    locality?: string;
    countryName?: string;
    countryCode?: string;
  };
  const name = [body.city || body.locality, body.countryName]
    .filter(Boolean)
    .join(", ");
  return {
    name: name || null,
    country: /^[A-Z]{2}$/.test(body.countryCode ?? "")
      ? (body.countryCode as string)
      : null,
  };
}

async function weatherAt(
  at: GeolocationCoordinates,
  signal: AbortSignal,
): Promise<Where["weather"]> {
  // To about a kilometre: a forecast needs no more
  const round = (degrees: number) =>
    (Math.round(degrees * 100) / 100).toString();
  const body = (await getJson(
    `https://api.open-meteo.com/v1/forecast?${new URLSearchParams({
      latitude: round(at.latitude),
      longitude: round(at.longitude),
      current: "temperature_2m,weather_code,wind_gusts_10m",
      daily: "temperature_2m_max,temperature_2m_min,sunrise,sunset",
      // Sunrise and sunset in the place's own time
      timezone: "auto",
      forecast_days: "1",
    })}`,
    signal,
  )) as {
    current: {
      temperature_2m: number;
      weather_code: number;
      wind_gusts_10m?: number | null;
    };
    daily: {
      temperature_2m_max: number[];
      temperature_2m_min: number[];
      sunrise: string[];
      sunset: string[];
    };
  };
  // `2026-09-27T07:28` → `07:28`
  const clock = (iso: string) => iso.slice(11, 16);
  const gusts = body.current.wind_gusts_10m;
  return {
    code: body.current.weather_code,
    temperature: body.current.temperature_2m,
    low: body.daily.temperature_2m_min[0],
    high: body.daily.temperature_2m_max[0],
    sunrise: clock(body.daily.sunrise[0]),
    sunset: clock(body.daily.sunset[0]),
    // Not every forecast model has gusts at every place; unknown is said as nothing
    gusts: typeof gusts === "number" ? gusts : null,
  };
}

/**
 * The device's position, then its name and its weather. The device is waited on for as long
 * as it takes, the browser's permission prompt included; the two services for `HERE.lookMs`.
 */
async function find(): Promise<Found | null> {
  const at = await position();
  const deadline = new AbortController();
  const late = setTimeout(() => deadline.abort(), HERE.lookMs);
  const [place, weather] = await Promise.allSettled([
    placeOf(at, deadline.signal),
    weatherAt(at, deadline.signal),
  ]);
  clearTimeout(late);
  for (const [what, result] of [
    ["place", place],
    ["weather", weather],
  ] as const) {
    if (result.status === "rejected")
      console.warn(`No ${what} for the call: ${errorToString(result.reason)}`);
  }
  const named = place.status === "fulfilled" ? place.value : null;
  const where = {
    place: named?.name ?? null,
    weather: weather.status === "fulfilled" ? weather.value : null,
  };
  return where.place || where.weather
    ? {
        where,
        position: { lat: at.latitude, lon: at.longitude },
        country: named?.country ?? null,
      }
    : null;
}

/** Looks it up and keeps what is found; joins the lookup already on its way. */
function look(): Promise<void> {
  if (looking && Date.now() - looking.asked < HERE.keptMs) return looking.done;
  const done = find()
    .then(
      (found) => {
        if (found) kept = { found, at: Date.now() };
      },
      (cause) => {
        // 1 is PERMISSION_DENIED in the spec, read as a number: a browser without the
        // GeolocationPositionError global would throw here. A refusal is theirs to make
        // and is not logged
        const refused = (cause as { code?: unknown } | null)?.code === 1;
        // Refused now, what was found while it was allowed is no longer theirs to have read
        if (refused) kept = null;
        else console.warn(`No position for the call: ${errorToString(cause)}`);
      },
    )
    .then(() => {
      if (looking?.done === done) looking = null;
    });
  looking = { done, asked: Date.now() };
  return done;
}

/**
 * Where the user is and the weather there, as the page has it as a call starts, or null: no
 * Geolocation, refused, nothing found, or not found yet. A call never waits on it (config
 * HERE): with nothing kept it goes without, and the lookup this starts is for the next one.
 * Called from the press that starts a call, so the browser's permission prompt comes with
 * something the user did; the browser remembers the answer.
 *
 * What was found longer ago than `HERE.keptMs` is still where they are, for all the page
 * knows, and no longer the weather: the place is read and the weather left out, rather than
 * the call going without both. That is every call placed more than `keptMs` after the last
 * lookup on a page that could not look ahead — hidden, or in a browser that only says it
 * allows the position at a press.
 */
export function whereNow(): Found | null {
  if (kept && Date.now() - kept.at < HERE.keptMs) return kept.found;
  if (navigator.geolocation) void look();
  if (!kept?.found.where.place) return null;
  return {
    ...kept.found,
    where: { place: kept.found.where.place, weather: null },
  };
}

/**
 * Looks it up before any call, when the browser already lets this app have the position.
 * Never asks where it would prompt: the prompt comes with a press (`whereNow`).
 */
export async function lookAhead(): Promise<void> {
  if (!due()) return;
  if (!navigator.geolocation || !navigator.permissions) return;
  let allowed: boolean;
  try {
    allowed =
      (await navigator.permissions.query({ name: "geolocation" })).state ===
      "granted";
  } catch {
    // A browser that cannot say is asked at the press, as it always was
    return;
  }
  if (allowed) await look();
}

/**
 * Keeps it looked up while the page is in front: as the page opens, as it comes back into
 * view, as the network comes back, and again a lookup's time before what is kept runs out
 * (`due`), so a press finds it there. A hidden page asks nothing. Returns what stops it.
 */
export function keepWhere(): () => void {
  let again: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const keep = async () => {
    clearTimeout(again);
    if (document.visibilityState !== "visible") return;
    // Armed before the lookup is waited on: a device that never answers would otherwise
    // leave this waiting for good, and nothing would look again while the page stayed up
    again = setTimeout(keep, HERE.keptMs);
    await lookAhead();
    if (stopped || document.visibilityState !== "visible") return;
    const left = kept ? kept.at + HERE.keptMs - HERE.lookMs - Date.now() : 0;
    clearTimeout(again);
    // With nothing fresh kept — not allowed yet, or not found — it is tried after as long
    again = setTimeout(keep, left > 0 ? left : HERE.keptMs);
  };
  void keep();
  document.addEventListener("visibilitychange", keep);
  // A lookup made with no network found nothing (a laptop just woken): asked again as it
  // comes back, not a whole `keptMs` later
  window.addEventListener("online", keep);
  return () => {
    stopped = true;
    clearTimeout(again);
    document.removeEventListener("visibilitychange", keep);
    window.removeEventListener("online", keep);
  };
}
