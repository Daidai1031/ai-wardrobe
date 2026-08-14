import type { CalendarEvent } from "@/types/database";

export interface WeatherLocation {
  city: string | null;
  lat: number;
  lng: number;
  timezone: string | null;
  source: "calendar" | "profile";
}

interface ProfileLocation {
  city?: string | null;
  lat?: number | null;
  lng?: number | null;
  timezone?: string | null;
}

function coordinateKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

function addDays(localDate: string, days: number): string {
  const [year, month, day] = localDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function localDateForInstant(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(iso));
}

/**
 * The first and last local dates an event actually occupies.
 *
 * Exported because trip detection needs exactly the same answer: a trip is a run of
 * local dates, and an all-day Google event's exclusive end date and a red-eye
 * crossing midnight are both easy to get wrong twice.
 */
export function eventLocalDateBounds(
  event: CalendarEvent,
  timeZone: string
): { first: string; last: string } {
  if (event.all_day) {
    const first = event.starts_at.slice(0, 10);
    const exclusiveEnd = (event.ends_at ?? event.starts_at).slice(0, 10);
    return {
      first,
      last: exclusiveEnd > first ? addDays(exclusiveEnd, -1) : first,
    };
  }

  const first = localDateForInstant(event.starts_at, timeZone);
  const startMs = new Date(event.starts_at).getTime();
  const endMs = new Date(event.ends_at ?? event.starts_at).getTime();
  // Event intervals are [start, end). Probe one millisecond before the end so a
  // trip ending exactly at midnight does not manufacture an extra return day.
  const last = localDateForInstant(
    new Date(endMs > startMs ? endMs - 1 : startMs).toISOString(),
    timeZone
  );
  return { first, last };
}

function isBusinessTravel(event: CalendarEvent): boolean {
  const title = event.title ?? "";
  const occasion = (event.occasion ?? "").toLowerCase();
  return (
    /\b(?:business|work|corporate)\s+(?:trip|travel)\b/i.test(title) ||
    /^(?:business|work|corporate)_(?:trip|travel)$/.test(occasion)
  );
}

function profileWeatherLocation(profile: ProfileLocation | null): WeatherLocation | null {
  if (profile?.lat == null || profile?.lng == null) return null;
  return {
    city: profile.city ?? null,
    lat: profile.lat,
    lng: profile.lng,
    timezone: profile.timezone ?? null,
    source: "profile",
  };
}

function eventWeatherLocation(event: CalendarEvent): WeatherLocation | null {
  const hasOverrideCoordinates =
    typeof event.weather_lat_override === "number" &&
    typeof event.weather_lng_override === "number";
  const lat = hasOverrideCoordinates ? event.weather_lat_override : event.weather_lat;
  const lng = hasOverrideCoordinates ? event.weather_lng_override : event.weather_lng;
  if (typeof lat !== "number" || typeof lng !== "number") return null;

  return {
    city: hasOverrideCoordinates ? effectiveEventWeatherCity(event) : event.weather_city,
    lat,
    lng,
    timezone: hasOverrideCoordinates
      ? event.weather_timezone_override
      : event.weather_timezone,
    source: "calendar",
  };
}

/** The place text the user should see beside an event in the planner. */
export function effectiveEventLocationLabel(event: CalendarEvent): string | null {
  return event.location_override || event.location || event.weather_city_override || event.weather_city;
}

/** The canonical city label attached to the coordinates planning will use. */
export function effectiveEventWeatherCity(event: CalendarEvent): string | null {
  return event.weather_city_override || event.location_override || event.weather_city;
}

/**
 * All weather locations that matter on one planning date.
 *
 * Ordinary and vacation events use their explicit Calendar destination for every
 * day they overlap. A multi-day business/work trip is different: on its first and
 * last local dates the user is in transit, so both home and destination matter.
 * Other same-day events in different cities are also preserved rather than being
 * collapsed back to the profile city.
 */
export function weatherLocationsForEvents(
  events: CalendarEvent[],
  profile: ProfileLocation | null,
  localDate: string,
  timeZone: string
): WeatherLocation[] {
  const calendarLocations = new Map<string, WeatherLocation>();
  const home = profileWeatherLocation(profile);
  let includeHomeForTravel = false;

  for (const event of events) {
    const location = eventWeatherLocation(event);
    if (!location) continue;
    calendarLocations.set(coordinateKey(location.lat, location.lng), location);

    if (isBusinessTravel(event)) {
      const bounds = eventLocalDateBounds(event, timeZone);
      includeHomeForTravel ||= localDate === bounds.first || localDate === bounds.last;
    }
  }

  if (includeHomeForTravel && home) {
    calendarLocations.set(coordinateKey(home.lat, home.lng), home);
  }

  if (calendarLocations.size > 0) return [...calendarLocations.values()];
  return home ? [home] : [];
}

/** Backward-compatible single-location view for callers that cannot render a route. */
export function weatherLocationForEvents(
  events: CalendarEvent[],
  profile: ProfileLocation | null,
  localDate = new Date().toISOString().slice(0, 10),
  timeZone = profile?.timezone || "UTC"
): WeatherLocation | null {
  return weatherLocationsForEvents(events, profile, localDate, timeZone)[0] ?? null;
}
