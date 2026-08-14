/**
 * Finding trips in a calendar, deterministically.
 *
 * The question "how many trips are in the next 30 days" is answered here in
 * TypeScript rather than by a model, for the same reason `occasion-groups.ts` and
 * `plan-rules.ts` are (D8): it is decidable from data we already store — an event's
 * coordinates, its local date span, its title — and a model asked the same question
 * twice returned two different trip counts, which would silently re-key every stored
 * trip and orphan its packing list.
 *
 * The classifier that DOES run on a model — `classifyEvents()` — has already given
 * each event an `occasion` and a `formality`. This file consumes those; it never
 * calls anything.
 */

import { eventLocalDateBounds } from "@/lib/weather/calendar-location";
import { explicitTravelDestinationFromTitle } from "@/lib/calendar/classify-events";
import { occasionKind } from "@/lib/planning/occasion-groups";
import type { CalendarEvent } from "@/types/database";
import type { DetectedTrip, TripType } from "@/types/travel";

/**
 * How far from the profile city counts as away. Generous on purpose: a suburb, a
 * second office across a metro area, or a geocoder resolving "Brooklyn" to a point a
 * few kilometres off the saved home coordinate is not a trip, and a card reading
 * "Trip to New York" for someone who lives there is worse than missing a real one.
 */
const AWAY_RADIUS_KM = 120;

/** Bridging a gap this wide keeps one trip whole when a middle day has nothing on the calendar. */
const MAX_GAP_DAYS = 2;

/**
 * A single day away is an errand, not a trip — unless the calendar says otherwise in
 * so many words ("Business Trip (London)"), in which case believe it.
 */
const MIN_TRIP_DAYS = 2;

const BUSINESS_TITLE_PATTERNS = [
  /\bbusiness\s+(?:trip|travel)\b/i,
  /\bwork\s+(?:trip|travel)\b/i,
  /\bcorporate\s+(?:trip|travel|retreat)\b/i,
  /\bconference\b/i,
  /\bsummit\b/i,
  /\boff[\s-]?site\b/i,
  /\bclient\s+(?:visit|trip)\b/i,
  /\bsite\s+visit\b/i,
  /\btrade\s+show\b/i,
];

const LEISURE_TITLE_PATTERNS = [
  /\bvacation\b/i,
  /\bholiday\b/i,
  /\bhoneymoon\b/i,
  /\bgetaway\b/i,
  /\bstaycation\b/i,
  /\bweekend\s+(?:away|trip)\b/i,
  /\bfamily\s+(?:trip|visit)\b/i,
  /\bwedding\b/i,
  /\bcruise\b/i,
];

/** Occasions that read as work when nothing in the title settles it. */
const WORK_OCCASION_PATTERN =
  /\b(?:work|office|board|meeting|client|business|conference|networking|interview|presentation|standup|review|summit|training)\b/;

function normalizeForMatching(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[_-]+/g, " ");
}

/** Great-circle distance in km. Only ever compared against a coarse radius. */
function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function addDays(localDate: string, days: number): string {
  const [year, month, day] = localDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000
  );
}

function datesInclusive(start: string, end: string): string[] {
  const out: string[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) out.push(date);
  return out;
}

/**
 * The signature is deliberately start date + destination and NOT the end date or the
 * event ids: a trip routinely gains a meeting or loses a day between two visits to
 * this page, and re-keying on any of that would fork the stored row and strand the
 * packing list on the old one.
 */
export function tripSignature(startDate: string, destination: string): string {
  return `${startDate}|${destination.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

export interface HomeLocation {
  city?: string | null;
  lat?: number | null;
  lng?: number | null;
  timezone?: string | null;
}

interface AwayEvent {
  event: CalendarEvent;
  first: string;
  last: string;
  city: string | null;
  lat: number | null;
  lng: number | null;
  timezone: string | null;
  /** True when the destination came from the title rather than from coordinates. */
  fromTitle: boolean;
}

function eventCoordinates(event: CalendarEvent): {
  lat: number | null;
  lng: number | null;
  city: string | null;
  timezone: string | null;
} {
  const hasOverride =
    typeof event.weather_lat_override === "number" && typeof event.weather_lng_override === "number";
  return {
    lat: hasOverride ? event.weather_lat_override : (event.weather_lat ?? null),
    lng: hasOverride ? event.weather_lng_override : (event.weather_lng ?? null),
    city: (hasOverride ? event.weather_city_override : null) || event.weather_city || null,
    timezone:
      (hasOverride ? event.weather_timezone_override : null) || event.weather_timezone || null,
  };
}

/**
 * Is this event somewhere other than home?
 *
 * Coordinates decide it when both ends have them, because a city name comparison
 * can't tell "New York" from "New York, NY". When home has no saved coordinates —
 * the user never filled in a city — an explicit trip title is the only evidence
 * left, and a bare foreign city name is not enough: without a home to compare
 * against, every event with a location would read as a trip.
 */
function awayEventFor(
  event: CalendarEvent,
  home: HomeLocation | null,
  timeZone: string
): AwayEvent | null {
  const titleDestination = explicitTravelDestinationFromTitle(event.title);
  const { lat, lng, city, timezone } = eventCoordinates(event);
  const bounds = eventLocalDateBounds(event, timeZone);

  const hasHome = typeof home?.lat === "number" && typeof home?.lng === "number";
  const farFromHome =
    hasHome && typeof lat === "number" && typeof lng === "number"
      ? distanceKm(home!.lat!, home!.lng!, lat, lng) > AWAY_RADIUS_KM
      : false;

  if (!farFromHome && !titleDestination) return null;

  return {
    event,
    first: bounds.first,
    last: bounds.last,
    city: city || titleDestination,
    lat: farFromHome ? lat : null,
    lng: farFromHome ? lng : null,
    timezone: farFromHome ? timezone : null,
    fromTitle: !farFromHome,
  };
}

function classifyTrip(events: CalendarEvent[]): { tripType: TripType; typeReason: string } {
  for (const event of events) {
    const title = event.title ?? "";
    if (BUSINESS_TITLE_PATTERNS.some((pattern) => pattern.test(title))) {
      return { tripType: "business", typeReason: `“${title}” is on your calendar` };
    }
    if (LEISURE_TITLE_PATTERNS.some((pattern) => pattern.test(title))) {
      return { tripType: "leisure", typeReason: `“${title}” is on your calendar` };
    }
  }

  // Nothing in the wording settles it, so judge by what the days actually hold.
  // Transit is excluded: every trip has flights, and counting them would just
  // measure trip length. Formality 3 is where the classifier's scale turns into work.
  let work = 0;
  let personal = 0;
  for (const event of events) {
    if (occasionKind({ occasion: event.occasion, title: event.title, allDay: event.all_day }) !== "general") {
      continue;
    }
    const worky =
      (typeof event.formality === "number" && event.formality >= 3) ||
      WORK_OCCASION_PATTERN.test(normalizeForMatching(event.occasion)) ||
      WORK_OCCASION_PATTERN.test(normalizeForMatching(event.title));
    if (worky) work += 1;
    else personal += 1;
  }

  const total = work + personal;
  const reason = (count: number, kind: string) =>
    `${count} of ${total} scheduled event${total === 1 ? "" : "s"} ` +
    `look${count === 1 ? "s" : ""} ${kind}`;

  if (work > personal) {
    return { tripType: "business", typeReason: reason(work, "like work") };
  }
  return {
    tripType: "leisure",
    typeReason:
      total === 0
        ? "nothing work-related on the calendar while you're there"
        : reason(personal, "personal"),
  };
}

/**
 * Which city to call the trip. An explicitly stated destination wins over a
 * geocoded one — "Hamptons" is what the user wrote and what they'll recognise —
 * and otherwise the city appearing on the most days does, so a layover doesn't
 * name the trip.
 */
function chooseDestination(awayEvents: AwayEvent[]): {
  destination: string;
  cities: string[];
  lat: number | null;
  lng: number | null;
  timezone: string | null;
} {
  const cities: string[] = [];
  const dayCount = new Map<string, number>();
  for (const away of awayEvents) {
    if (!away.city) continue;
    if (!cities.includes(away.city)) cities.push(away.city);
    const days = Math.max(1, daysBetween(away.first, away.last) + 1);
    dayCount.set(away.city, (dayCount.get(away.city) ?? 0) + days);
  }

  const stated = awayEvents.find((away) => away.fromTitle && away.city)?.city;
  const busiest = [...dayCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const destination = stated || busiest || "Away";

  // Coordinates for whichever city we settled on, preferring one that actually has them.
  const anchor =
    awayEvents.find((away) => away.city === destination && away.lat != null) ??
    awayEvents.find((away) => away.lat != null);

  return {
    destination,
    cities: cities.length > 0 ? cities : [destination],
    lat: anchor?.lat ?? null,
    lng: anchor?.lng ?? null,
    timezone: anchor?.timezone ?? null,
  };
}

/**
 * Every trip in the given events, ordered by start date.
 *
 * `events` should already be restricted to the detection window by the caller;
 * `windowStart`/`windowEnd` are applied here as well so an event spanning the edge
 * (a trip that began last week) is clipped to the part the user can still plan.
 */
export function detectTrips(
  events: CalendarEvent[],
  home: HomeLocation | null,
  timeZone: string,
  windowStart: string,
  windowEnd: string
): DetectedTrip[] {
  const awayEvents = events
    .map((event) => awayEventFor(event, home, timeZone))
    .filter((away): away is AwayEvent => away !== null)
    .sort((a, b) => a.first.localeCompare(b.first));

  if (awayEvents.length === 0) return [];

  // Runs of dates that are away, bridging short gaps. A Tuesday with nothing on the
  // calendar between two London days is still London.
  const runs: { start: string; end: string; away: AwayEvent[] }[] = [];
  for (const away of awayEvents) {
    const current = runs[runs.length - 1];
    if (current && daysBetween(current.end, away.first) <= MAX_GAP_DAYS + 1) {
      current.end = away.last > current.end ? away.last : current.end;
      current.away.push(away);
      continue;
    }
    runs.push({ start: away.first, end: away.last, away: [away] });
  }

  const transitDates = new Set(
    events
      .filter(
        (event) =>
          occasionKind({ occasion: event.occasion, title: event.title, allDay: event.all_day }) ===
          "transit"
      )
      .flatMap((event) => {
        const bounds = eventLocalDateBounds(event, timeZone);
        return datesInclusive(bounds.first, bounds.last);
      })
  );

  const trips: DetectedTrip[] = [];
  for (const run of runs) {
    // The departure and return legs belong to the trip even when the flight itself
    // is geocoded to the home airport, which is exactly what a 5pm "Depart for JFK"
    // is. Only one day on each side, and only when something is actually flying.
    let start = transitDates.has(addDays(run.start, -1)) ? addDays(run.start, -1) : run.start;
    let end = transitDates.has(addDays(run.end, 1)) ? addDays(run.end, 1) : run.end;

    if (start < windowStart) start = windowStart;
    if (end > windowEnd) end = windowEnd;
    if (end < start) continue;

    const hasStatedTrip = run.away.some((away) => away.fromTitle || away.event.all_day);
    const length = daysBetween(start, end) + 1;
    if (length < MIN_TRIP_DAYS && !hasStatedTrip) continue;

    const dates = datesInclusive(start, end);
    const dateSet = new Set(dates);
    // Everything on the calendar during the trip, not only the away-flagged events:
    // a dinner with no location is still part of the trip, and the classifier needs it.
    const tripEvents = events.filter((event) => {
      const bounds = eventLocalDateBounds(event, timeZone);
      return datesInclusive(bounds.first, bounds.last).some((date) => dateSet.has(date));
    });

    const { destination, cities, lat, lng, timezone } = chooseDestination(run.away);
    const { tripType, typeReason } = classifyTrip(tripEvents);

    trips.push({
      signature: tripSignature(start, destination),
      destination,
      cities,
      destinationLat: lat,
      destinationLng: lng,
      destinationTimezone: timezone,
      startDate: start,
      endDate: end,
      dates,
      tripType,
      typeReason,
      eventIds: tripEvents.map((event) => event.id),
      highlights: [
        ...new Set(
          run.away
            .map((away) => away.event.title)
            .filter((title): title is string => Boolean(title))
        ),
      ].slice(0, 3),
    });
  }

  return trips.sort((a, b) => a.startDate.localeCompare(b.startDate));
}
