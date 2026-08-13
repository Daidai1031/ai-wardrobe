import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { CALENDAR_SCOPE, getAccessToken, hasScope } from "@/lib/google/client";
import { listCalendarEvents } from "@/lib/google/calendar";
import {
  classifyEvents,
  explicitTravelDestinationFromTitle,
} from "@/lib/calendar/classify-events";
import { geocodeCity } from "@/lib/weather/geocode";

export const dynamic = "force-dynamic";

/**
 * GET /api/google/calendar/sync?timeMin=&timeMax=
 *
 * ROADMAP 6.0-C. Pulls events from the user's primary Google Calendar, upserts the raw
 * fields into `calendar_events`, then runs classify-events.ts once (batched) over
 * whatever in that window is still missing `occasion` or `companion` — so re-running
 * this is cheap and never re-classifies a fully labeled event. Returns the window including
 * Google's `description` field for manual eyeballing; `description` is intentionally
 * never persisted (no column for it) and never passed into classification.
 *
 * Defaults to [start of today UTC, +14 days] when timeMin/timeMax aren't given.
 */
export async function GET(request: NextRequest) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  if (!(await hasScope(user.id, CALENDAR_SCOPE))) {
    return NextResponse.json(
      { error: "Calendar not connected. Visit /api/google/auth?scope=calendar first." },
      { status: 400 }
    );
  }

  const accessToken = await getAccessToken(user.id);
  if (!accessToken) {
    return NextResponse.json(
      { error: "Calendar connection is invalid — reconnect via /api/google/auth?scope=calendar" },
      { status: 400 }
    );
  }

  const now = new Date();
  const todayStart = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const timeMin = request.nextUrl.searchParams.get("timeMin") ?? todayStart.toISOString();
  const timeMax =
    request.nextUrl.searchParams.get("timeMax") ??
    new Date(todayStart.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();

  let googleEvents;
  try {
    googleEvents = await listCalendarEvents(accessToken, timeMin, timeMax);
  } catch (err) {
    console.error("calendar sync: listCalendarEvents failed:", err);
    return NextResponse.json({ error: "Failed to fetch events from Google" }, { status: 502 });
  }

  const descriptionByEventId = new Map(googleEvents.map((e) => [e.id, e.description ?? null]));

  const rows = googleEvents
    .map((e) => ({
      user_id: user.id,
      google_event_id: e.id,
      title: e.summary ?? null,
      location: e.location ?? null,
      starts_at: e.start.dateTime ?? (e.start.date ? `${e.start.date}T00:00:00Z` : null),
      ends_at: e.end.dateTime ?? (e.end.date ? `${e.end.date}T00:00:00Z` : null),
      all_day: !e.start.dateTime,
      attendee_count: e.attendees?.length ?? 0,
      synced_at: new Date().toISOString(),
    }))
    .filter((r): r is typeof r & { starts_at: string } => r.starts_at !== null);

  const previousByEventId = new Map<
    string,
    { location: string | null; title: string | null; weather_city: string | null }
  >();
  if (rows.length > 0) {
    const { data: previousRows, error: previousError } = await supabase
      .from("calendar_events")
      .select("google_event_id, location, title, weather_city")
      .eq("user_id", user.id)
      .in(
        "google_event_id",
        rows.map((row) => row.google_event_id)
      );
    if (previousError) {
      console.error("calendar sync: failed to read existing locations:", previousError);
      return NextResponse.json({ error: "Failed to compare event locations" }, { status: 500 });
    }
    for (const row of previousRows ?? []) {
      previousByEventId.set(row.google_event_id, row);
    }
  }

  if (rows.length > 0) {
    const { error } = await supabase
      .from("calendar_events")
      .upsert(rows, { onConflict: "user_id,google_event_id" });
    if (error) {
      console.error("calendar sync: upsert failed:", error);
      return NextResponse.json({ error: "Failed to persist events" }, { status: 500 });
    }

    const changedLocationIds = rows
      .filter(
        (row) =>
          previousByEventId.has(row.google_event_id) &&
          previousByEventId.get(row.google_event_id)?.location !== row.location
      )
      .map((row) => row.google_event_id);
    if (changedLocationIds.length > 0) {
      const { error: resetError } = await supabase
        .from("calendar_events")
        .update({
          weather_city: null,
          weather_lat: null,
          weather_lng: null,
          weather_timezone: null,
          weather_location_resolved: false,
        })
        .eq("user_id", user.id)
        .in("google_event_id", changedLocationIds);
      if (resetError) {
        console.error("calendar sync: failed to reset changed locations:", resetError);
        return NextResponse.json({ error: "Failed to refresh event locations" }, { status: 500 });
      }
    }
  }

  // Multi-day trips are frequently entered as all-day events whose destination is
  // encoded in the title (`Vacation: Hamptons`, `Business Trip (London)`) while
  // Google's location field is blank. Backfill those deterministic forms even for
  // rows classified by an older prompt, otherwise `weather_location_resolved=true`
  // would make the old null result permanent.
  const normalizePlace = (value: string | null) =>
    (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/s$/, "");
  const explicitDestinations = rows
    .map((row) => ({ row, city: explicitTravelDestinationFromTitle(row.title) }))
    .filter((entry): entry is { row: (typeof rows)[number]; city: string } => Boolean(entry.city))
    .filter((entry) => {
      const previous = previousByEventId.get(entry.row.google_event_id);
      const parsed = normalizePlace(entry.city);
      const stored = normalizePlace(previous?.weather_city ?? null);
      return !previous || previous.title !== entry.row.title || !stored || !stored.includes(parsed);
    });

  const geocodeCache = new Map<string, Awaited<ReturnType<typeof geocodeCity>>>();
  if (explicitDestinations.length > 0) {
    const distinct = [...new Set(explicitDestinations.map((entry) => entry.city))];
    await Promise.all(
      distinct.map(async (city) => {
        geocodeCache.set(city.toLowerCase(), await geocodeCity(city));
      })
    );
    await Promise.all(
      explicitDestinations.map(({ row, city }) => {
        const geo = geocodeCache.get(city.toLowerCase()) ?? null;
        return supabase
          .from("calendar_events")
          .update({
            weather_city: geo?.name ?? city,
            weather_lat: geo?.lat ?? null,
            weather_lng: geo?.lon ?? null,
            weather_timezone: geo?.timezone ?? null,
            weather_location_resolved: true,
          })
          .eq("user_id", user.id)
          .eq("google_event_id", row.google_event_id);
      })
    );
  }

  // `companion IS NULL` is part of the condition, not just `occasion IS NULL`: rows
  // classified before D17 added companion would otherwise never be revisited, and the
  // stylist's occasion projection would show "meeting someone" forever for events we
  // already know plenty about. Re-running sync backfills them at no extra call cost —
  // they ride along in the same batch.
  const { data: unclassified, error: unclassifiedErr } = await supabase
    .from("calendar_events")
    .select("google_event_id, title, location, attendee_count, weather_location_resolved")
    .eq("user_id", user.id)
    .or("occasion.is.null,companion.is.null,weather_location_resolved.eq.false")
    .gte("starts_at", timeMin)
    .lte("starts_at", timeMax);

  if (unclassifiedErr) {
    console.error("calendar sync: failed to load unclassified events:", unclassifiedErr);
    return NextResponse.json({ error: "Failed to load events for classification" }, { status: 500 });
  }

  if (unclassified && unclassified.length > 0) {
    const classifications = await classifyEvents(unclassified);
    const cities = [...new Set(classifications.map((entry) => entry.city).filter((city): city is string => Boolean(city)))];
    await Promise.all(
      cities.map(async (city) => {
        const key = city.toLowerCase();
        if (!geocodeCache.has(key)) geocodeCache.set(key, await geocodeCity(city));
      })
    );
    await Promise.all(
      classifications.map((c) => {
        const geo = c.city ? geocodeCache.get(c.city.toLowerCase()) ?? null : null;
        return supabase
          .from("calendar_events")
          .update({
            occasion: c.occasion,
            formality: c.formality,
            companion: c.companion,
            weather_city: geo?.name ?? c.city,
            weather_lat: geo?.lat ?? null,
            weather_lng: geo?.lon ?? null,
            weather_timezone: geo?.timezone ?? null,
            weather_location_resolved: true,
          })
          .eq("user_id", user.id)
          .eq("google_event_id", c.google_event_id);
      })
    );
  }

  const { data: finalRows, error: finalErr } = await supabase
    .from("calendar_events")
    .select(
      "google_event_id, title, location, location_override, weather_city, weather_lat, weather_lng, weather_timezone, weather_city_override, weather_lat_override, weather_lng_override, weather_timezone_override, starts_at, ends_at, all_day, attendee_count, occasion, formality, companion"
    )
    .eq("user_id", user.id)
    .gte("starts_at", timeMin)
    .lte("starts_at", timeMax)
    .order("starts_at", { ascending: true });

  if (finalErr) {
    console.error("calendar sync: failed to load final results:", finalErr);
    return NextResponse.json({ error: "Failed to load results" }, { status: 500 });
  }

  const events = (finalRows ?? []).map((r) => ({
    ...r,
    description: descriptionByEventId.get(r.google_event_id) ?? null,
  }));

  return NextResponse.json({ count: events.length, timeMin, timeMax, events });
}
