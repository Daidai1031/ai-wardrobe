import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { detectTripsForUser, readTripProfile } from "@/lib/travel/trips";
import type { TripDecision } from "@/types/travel";

/**
 * Record — or undo — the user's answer to a detection question.
 *
 * Answers are anchored on the signature of the trip as detection produced it, not on
 * a `travel_plans` row: a split's second half has no row yet, and a merge dissolves
 * the later trip's signature along with its row (schema 22 explains why the table is
 * separate). One answer per trip, so answering again replaces the previous answer.
 *
 * The signature is validated against the user's own **currently detected** trips, the
 * same way `resolve` re-derives a trip rather than trusting the body. A decision for a
 * trip that isn't there would sit in the table doing nothing until a calendar change
 * happened to produce that signature, and then reshape a trip nobody asked about.
 *
 * Validated against detection **with the existing decisions already applied**, because
 * the anchor names the shape the user was looking at — which, for a second correction,
 * is a shape only an earlier decision produced. A signature that an existing decision
 * already anchors is accepted too, so re-answering one replaces it rather than 404ing.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await request.json().catch(() => ({}))) as {
      signature?: unknown;
      action?: unknown;
      boundaryDate?: unknown;
    };

    const signature = typeof body.signature === "string" ? body.signature : "";
    const action = body.action;
    const boundaryDate = typeof body.boundaryDate === "string" ? body.boundaryDate : null;

    if (!signature) {
      return NextResponse.json({ error: "Which trip?" }, { status: 400 });
    }
    if (action !== "split" && action !== "merge" && action !== "keep") {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    if (action === "split" && !boundaryDate) {
      return NextResponse.json(
        { error: "A split needs the date the second trip starts on." },
        { status: 400 }
      );
    }

    const profile = await readTripProfile(supabase, user.id);
    const timeZone = profile?.timezone || "UTC";
    const { trips, decisions } = await detectTripsForUser(supabase, user.id, profile, timeZone);

    const known =
      trips.some((trip) => trip.signature === signature) ||
      decisions.some((decision) => decision.anchorSignature === signature);
    if (!known) {
      return NextResponse.json(
        { error: "That trip is no longer on your calendar." },
        { status: 404 }
      );
    }

    // A split boundary has to land inside the trip, or the cut is a no-op that would
    // look to the user like the button did nothing.
    if (action === "split" && boundaryDate) {
      const target = trips.find((trip) => trip.signature === signature);
      if (target && (boundaryDate <= target.startDate || boundaryDate > target.endDate)) {
        return NextResponse.json(
          { error: "That date isn't inside the trip." },
          { status: 400 }
        );
      }
    }

    const { error } = await supabase.from("travel_trip_decisions").upsert(
      {
        user_id: user.id,
        anchor_signature: signature,
        action,
        boundary_date: action === "split" ? boundaryDate : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,anchor_signature" }
    );

    if (error) throw error;

    const decision: TripDecision = {
      action,
      anchorSignature: signature,
      boundaryDate: action === "split" ? boundaryDate : null,
    };
    return NextResponse.json({ decision });
  } catch (error) {
    console.error("Trip decision error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't save that" },
      { status: 500 }
    );
  }
}

/**
 * Undo an answer, putting the trip back under whatever detection says.
 *
 * The row is deleted rather than set back to `keep`, because `keep` is itself an
 * answer ("stop asking"), and undoing a split should let the question be asked again.
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const signature = request.nextUrl.searchParams.get("signature") ?? "";
    if (!signature) {
      return NextResponse.json({ error: "Which trip?" }, { status: 400 });
    }

    const { error } = await supabase
      .from("travel_trip_decisions")
      .delete()
      .eq("user_id", user.id)
      .eq("anchor_signature", signature);

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Trip decision undo error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't undo that" },
      { status: 500 }
    );
  }
}
