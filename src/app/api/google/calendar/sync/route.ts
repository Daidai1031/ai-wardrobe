import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { CALENDAR_SCOPE, getAccessToken, hasScope } from "@/lib/google/client";
import { listCalendarEvents } from "@/lib/google/calendar";
import { classifyEvents } from "@/lib/calendar/classify-events";

export const dynamic = "force-dynamic";

/**
 * GET /api/google/calendar/sync?timeMin=&timeMax=
 *
 * ROADMAP 6.0-C. Pulls events from the user's primary Google Calendar, upserts the raw
 * fields into `calendar_events`, then runs classify-events.ts once (batched) over
 * whatever in that window still has `occasion IS NULL` — so re-running this is cheap
 * and never re-classifies an event twice. Returns the full window's events including
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

  if (rows.length > 0) {
    const { error } = await supabase
      .from("calendar_events")
      .upsert(rows, { onConflict: "user_id,google_event_id" });
    if (error) {
      console.error("calendar sync: upsert failed:", error);
      return NextResponse.json({ error: "Failed to persist events" }, { status: 500 });
    }
  }

  const { data: unclassified, error: unclassifiedErr } = await supabase
    .from("calendar_events")
    .select("google_event_id, title, location, attendee_count")
    .eq("user_id", user.id)
    .is("occasion", null)
    .gte("starts_at", timeMin)
    .lte("starts_at", timeMax);

  if (unclassifiedErr) {
    console.error("calendar sync: failed to load unclassified events:", unclassifiedErr);
    return NextResponse.json({ error: "Failed to load events for classification" }, { status: 500 });
  }

  if (unclassified && unclassified.length > 0) {
    const classifications = await classifyEvents(unclassified);
    await Promise.all(
      classifications.map((c) =>
        supabase
          .from("calendar_events")
          .update({ occasion: c.occasion, formality: c.formality })
          .eq("user_id", user.id)
          .eq("google_event_id", c.google_event_id)
      )
    );
  }

  const { data: finalRows, error: finalErr } = await supabase
    .from("calendar_events")
    .select("google_event_id, title, location, starts_at, ends_at, all_day, attendee_count, occasion, formality")
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
