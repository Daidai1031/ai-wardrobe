import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  detectTripsForUser,
  readTripProfile,
  resolveTripBySignature,
} from "@/lib/travel/trips";

/**
 * Turn a detected trip into a row the user can act on, and hand back its id.
 *
 * POST rather than a link straight to `/travel/<signature>`, and a write rather than
 * a lookup, because a trip needs somewhere to keep the two things detection cannot
 * derive: which days the user confirmed, and what they've packed. Creating that row
 * lazily — on the click that opens the trip, not on the page that lists them — keeps
 * a calendar full of trips nobody opens out of the table.
 *
 * The signature is re-derived from the calendar here rather than trusted from the
 * body, so a caller cannot invent a trip that isn't on their calendar.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await request.json().catch(() => ({}))) as { signature?: unknown };
    const signature = typeof body.signature === "string" ? body.signature : "";
    if (!signature) {
      return NextResponse.json({ error: "Which trip?" }, { status: 400 });
    }

    const profile = await readTripProfile(supabase, user.id);
    const timeZone = profile?.timezone || "UTC";
    const { trips } = await detectTripsForUser(supabase, user.id, profile, timeZone);
    const trip = trips.find((candidate) => candidate.signature === signature);

    if (!trip) {
      return NextResponse.json(
        { error: "That trip is no longer on your calendar." },
        { status: 404 }
      );
    }

    const row = await resolveTripBySignature(supabase, user.id, trip);
    return NextResponse.json({ id: row.id });
  } catch (error) {
    console.error("Trip resolve error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't open that trip" },
      { status: 500 }
    );
  }
}
