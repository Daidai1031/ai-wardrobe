/**
 * Server-side reading and materializing of trips.
 *
 * A trip lives in two places on purpose. **What it is** — dates, destination,
 * business or leisure — is re-derived from the calendar on every read by
 * `detectTrips()`, so a flight moved in Google is a trip moved here, with nothing to
 * keep in sync. **What the user has decided about it** — which days they confirmed,
 * what they've ticked off the packing list, whether it's shared — is a
 * `travel_plans` row, created the first time they open the trip and matched back to
 * the detection by `calendar_signature`.
 *
 * The outfits themselves are in neither: a trip's days are ordinary local dates and
 * since Phase 6.2 a date has exactly one plan, so travel reads and writes the same
 * `outfit_plans` rows `/plan` does. That is what makes "if it's already planned,
 * just show me that" true rather than a copy.
 */

import { createServerSupabase } from "@/lib/supabase/server";
import { MAX_PLAN_WINDOW_DAYS, readPlansForDates } from "@/lib/planning/plans";
import { detectTrips, type HomeLocation } from "@/lib/travel/detect-trips";
import type { CalendarEvent, TravelPlan } from "@/types/database";
import type { DetectedTrip, TripMeta, TripSummary } from "@/types/travel";

type ServerSupabase = Awaited<ReturnType<typeof createServerSupabase>>;

/** How far ahead trips are looked for. The user asked for a month; the calendar sync's own default window is 14 days, so a longer trip list is a reason to press Sync. */
export const TRIP_WINDOW_DAYS = 30;

export const CALENDAR_EVENT_SELECT =
  "id, user_id, google_event_id, title, location, location_override, weather_city, weather_lat, weather_lng, weather_timezone, weather_city_override, weather_lat_override, weather_lng_override, weather_timezone_override, weather_location_resolved, starts_at, ends_at, all_day, attendee_count, occasion, formality, companion, stylist_share_detail, synced_at";

const TRAVEL_PLAN_SELECT =
  "id, user_id, destination, destination_lat, destination_lng, destination_timezone, start_date, end_date, travel_goals, packing_list, trip_type, origin, calendar_signature, confirmed_dates, share_token, shared_at, created_at, updated_at";

export interface TripProfile extends HomeLocation {
  name?: string | null;
}

function addDays(localDate: string, days: number): string {
  const [year, month, day] = localDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export async function readTripProfile(
  supabase: ServerSupabase,
  userId: string
): Promise<TripProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("name, city, lat, lng, timezone")
    .eq("id", userId)
    .single();

  if (error) throw error;
  return (data as TripProfile) ?? null;
}

/**
 * Trips on the calendar in the next `TRIP_WINDOW_DAYS`.
 *
 * The SQL range is padded by a week on each side so a trip already under way, or one
 * whose all-day container starts just before the window, is still seen and then
 * clipped to the window by `detectTrips` — the same reason the weekly route pads its
 * own event query.
 */
export async function detectTripsForUser(
  supabase: ServerSupabase,
  userId: string,
  profile: TripProfile | null,
  timeZone: string
): Promise<{ trips: DetectedTrip[]; windowStart: string; windowEnd: string }> {
  const windowStart = new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
  const windowEnd = addDays(windowStart, TRIP_WINDOW_DAYS - 1);

  const { data, error } = await supabase
    .from("calendar_events")
    .select(CALENDAR_EVENT_SELECT)
    .eq("user_id", userId)
    .gte("starts_at", `${addDays(windowStart, -7)}T00:00:00Z`)
    .lte("starts_at", `${addDays(windowEnd, 7)}T23:59:59Z`);

  if (error) throw error;

  return {
    trips: detectTrips((data || []) as CalendarEvent[], profile, timeZone, windowStart, windowEnd),
    windowStart,
    windowEnd,
  };
}

export async function readStoredTrips(
  supabase: ServerSupabase,
  userId: string
): Promise<TravelPlan[]> {
  const { data, error } = await supabase
    .from("travel_plans")
    .select(TRAVEL_PLAN_SELECT)
    .eq("user_id", userId)
    .order("start_date");

  if (error) throw error;
  return (data || []) as TravelPlan[];
}

/**
 * Detected trips joined to their stored rows, with how much of each is planned.
 *
 * A stored trip whose signature no longer detects — the trip was cancelled, or the
 * user deleted the calendar event — is deliberately dropped from the list rather
 * than shown as an orphan. Its row survives in the database, so restoring the event
 * brings the packing list back with it.
 */
export async function readTripSummaries(
  supabase: ServerSupabase,
  userId: string,
  profile: TripProfile | null,
  timeZone: string
): Promise<{ trips: TripSummary[]; windowStart: string; windowEnd: string }> {
  const [{ trips: detected, windowStart, windowEnd }, stored] = await Promise.all([
    detectTripsForUser(supabase, userId, profile, timeZone),
    readStoredTrips(supabase, userId),
  ]);

  const storedBySignature = new Map(
    stored
      .filter((row) => row.calendar_signature)
      .map((row) => [row.calendar_signature as string, row])
  );

  const allDates = [...new Set(detected.flatMap((trip) => trip.dates))];
  const plans = await readPlansForDates(supabase, userId, allDates);

  const trips = detected.map((trip) => {
    const row = storedBySignature.get(trip.signature);
    const confirmed = new Set(row?.confirmed_dates ?? []);
    return {
      ...trip,
      id: row?.id ?? null,
      // A stored trip may carry a type the user corrected by hand; that beats
      // re-deriving it from the same events that got it wrong the first time.
      tripType: row?.trip_type ?? trip.tripType,
      typeReason: row?.trip_type && row.trip_type !== trip.tripType ? "you set this" : trip.typeReason,
      plannedDays: trip.dates.filter((date) => plans.has(date)).length,
      confirmedDays: trip.dates.filter((date) => confirmed.has(date)).length,
      shared: Boolean(row?.share_token),
    };
  });

  return { trips, windowStart, windowEnd };
}

/**
 * The stored row for a detected trip, created if it doesn't exist yet.
 *
 * Rows are created on first open rather than on detection so a calendar full of
 * trips the user never looks at doesn't fill the table. The upsert targets
 * `travel_plans_calendar_signature_key`, so two tabs opening the same trip at once
 * resolve to the same row instead of racing to create two.
 */
export async function resolveTripBySignature(
  supabase: ServerSupabase,
  userId: string,
  trip: DetectedTrip
): Promise<TravelPlan> {
  const { data, error } = await supabase
    .from("travel_plans")
    .upsert(
      {
        user_id: userId,
        destination: trip.destination,
        destination_lat: trip.destinationLat,
        destination_lng: trip.destinationLng,
        destination_timezone: trip.destinationTimezone,
        start_date: trip.startDate,
        // Dates are refreshed on every resolve: the calendar is the source of truth
        // for when the trip is, and the row is only the source of truth for what the
        // user decided about it.
        end_date: trip.endDate,
        trip_type: trip.tripType,
        origin: "calendar",
        calendar_signature: trip.signature,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,calendar_signature", ignoreDuplicates: false }
    )
    .select(TRAVEL_PLAN_SELECT)
    .single();

  if (error) throw error;
  return data as TravelPlan;
}

function datesInclusive(start: string, end: string): string[] {
  const out: string[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) out.push(date);
  return out;
}

/**
 * One stored trip, described the way the UI needs it.
 *
 * The row is the authority for identity and for what the user decided; the calendar
 * is the authority for when and where the trip is. Where they disagree — an event
 * moved since the row was written — the calendar wins for dates and cities, which is
 * why this re-detects rather than reading `start_date`/`end_date` back.
 *
 * A trip that no longer detects at all still resolves, from the row's own dates.
 * Losing the packing list because a calendar entry was tidied up would be worse than
 * showing a trip whose events have gone.
 */
export async function readTripMeta(
  supabase: ServerSupabase,
  userId: string,
  tripId: string,
  profile: TripProfile | null,
  timeZone: string
): Promise<{ row: TravelPlan; meta: TripMeta } | null> {
  const { data, error } = await supabase
    .from("travel_plans")
    .select(TRAVEL_PLAN_SELECT)
    .eq("id", tripId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  const row = data as TravelPlan;

  const { trips } = await detectTripsForUser(supabase, userId, profile, timeZone);
  const detected = trips.find((trip) => trip.signature === row.calendar_signature);

  return { row, meta: tripMetaFrom(row, detected) };
}

/** Shared by the trip route and by the print/share pages, which read the row a different way. */
export function tripMetaFrom(row: TravelPlan, detected: DetectedTrip | undefined): TripMeta {
  const startDate = detected?.startDate ?? row.start_date;
  const endDate = detected?.endDate ?? row.end_date;
  const dates = detected?.dates ?? datesInclusive(startDate, endDate);

  return {
    id: row.id,
    destination: row.destination,
    cities: detected?.cities ?? [row.destination],
    startDate,
    endDate,
    dates,
    planDays: Math.min(dates.length, MAX_PLAN_WINDOW_DAYS),
    // The stored type wins: it is either what detection decided at resolve time or
    // what the user corrected afterwards, and re-deriving would undo the correction.
    tripType: row.trip_type ?? detected?.tripType ?? "leisure",
    typeReason: detected?.typeReason ?? "you set this",
    confirmedDates: row.confirmed_dates ?? [],
    shareToken: row.share_token,
    origin: row.origin,
  };
}
