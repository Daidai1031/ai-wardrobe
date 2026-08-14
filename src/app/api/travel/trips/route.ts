import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { hasScope } from "@/lib/google/client";
import { readTripProfile, readTripSummaries } from "@/lib/travel/trips";
import type { TripListResponse } from "@/types/travel";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

/**
 * Every trip on the calendar in the next 30 days.
 *
 * Read-only and free — detection is deterministic TypeScript over rows that are
 * already synced, with no model call anywhere (see `detect-trips.ts`). Nothing here
 * pulls from Google either: like `/plan`, this reads whatever the last
 * `/api/google/calendar/sync` left behind, so the page offers a Sync button rather
 * than silently showing a stale month.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const profile = await readTripProfile(supabase, user.id);
    const timeZone = request.nextUrl.searchParams.get("timezone") || profile?.timezone || "UTC";

    const [{ trips, windowStart, windowEnd }, calendarConnected] = await Promise.all([
      readTripSummaries(supabase, user.id, profile, timeZone),
      hasScope(user.id, CALENDAR_SCOPE),
    ]);

    const response: TripListResponse = {
      trips,
      calendarConnected,
      windowStart,
      windowEnd,
      // Two very different empty states, and conflating them is what makes an
      // integration feel broken: nothing detected because nothing is connected, or
      // nothing detected because the next month is genuinely all at home.
      message:
        trips.length > 0
          ? undefined
          : calendarConnected
            ? undefined
            : "Connect Google Calendar from your profile and we'll find your trips automatically.",
    };
    return NextResponse.json(response);
  } catch (error) {
    console.error("Trip detection error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't read your trips" },
      { status: 500 }
    );
  }
}
