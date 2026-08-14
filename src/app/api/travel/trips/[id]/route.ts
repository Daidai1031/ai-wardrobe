import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createServerSupabase } from "@/lib/supabase/server";
import { readTripMeta, readTripProfile } from "@/lib/travel/trips";
import { resolvePackingList } from "@/lib/travel/packing";
import type { TripDetailResponse, TripPackingList } from "@/types/travel";

/**
 * The trip's own state: what it is, which days the user confirmed, what's packed.
 *
 * Deliberately does not carry the day outfits. Those come from
 * `/api/ai/weekly?start=&days=` — the same endpoint and the same stored rows `/plan`
 * reads — so a day planned in either place is the same day rather than a copy that
 * can drift.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const profile = await readTripProfile(supabase, user.id);
    const found = await readTripMeta(supabase, user.id, id, profile, profile?.timezone || "UTC");
    if (!found) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

    const response: TripDetailResponse = {
      trip: found.meta,
      packing: resolvePackingList(found.row.packing_list, found.meta.tripType),
    };
    return NextResponse.json(response);
  } catch (error) {
    console.error("Trip read error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't load that trip" },
      { status: 500 }
    );
  }
}

interface TripPatchBody {
  /** Local dates the user is confirming. Replaces the stored set outright. */
  confirmedDates?: unknown;
  packing?: unknown;
  tripType?: unknown;
  /** "create" mints a share token if there isn't one; "revoke" clears it. */
  share?: unknown;
}

function sanitizeDates(value: unknown, allowed: string[]): string[] | null {
  if (!Array.isArray(value)) return null;
  const permitted = new Set(allowed);
  // Silently dropping a date outside the trip rather than erroring: the client sends
  // the set it currently shows, and a trip whose dates shifted mid-session should
  // save the part that's still valid, not fail the whole confirmation.
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string"))]
    .filter((date) => permitted.has(date))
    .sort();
}

function sanitizePacking(value: unknown): TripPackingList | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const strings = (input: unknown) =>
    Array.isArray(input) ? input.filter((entry): entry is string => typeof entry === "string") : [];

  const extras = Array.isArray(raw.extras)
    ? (raw.extras as unknown[])
        .filter(
          (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null
        )
        .map((entry) => ({
          id: String(entry.id ?? "").slice(0, 64),
          label: String(entry.label ?? "").slice(0, 120),
          custom: Boolean(entry.custom),
          checked: Boolean(entry.checked),
        }))
        .filter((entry) => entry.id && entry.label.trim())
        // A hand-written list is a list, not a data store. The cap stops a bug or a
        // stuck key from growing the JSONB column without bound.
        .slice(0, 100)
    : [];

  return {
    packedItemIds: strings(raw.packedItemIds).slice(0, 500),
    extras,
    hiddenTemplateIds: strings(raw.hiddenTemplateIds).slice(0, 100),
  };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const profile = await readTripProfile(supabase, user.id);
    const found = await readTripMeta(supabase, user.id, id, profile, profile?.timezone || "UTC");
    if (!found) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

    const body = (await request.json().catch(() => ({}))) as TripPatchBody;
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

    const confirmedDates = sanitizeDates(body.confirmedDates, found.meta.dates);
    if (confirmedDates) update.confirmed_dates = confirmedDates;

    const packing = sanitizePacking(body.packing);
    if (packing) update.packing_list = packing;

    if (body.tripType === "business" || body.tripType === "leisure") {
      update.trip_type = body.tripType;
    }

    if (body.share === "create" && !found.row.share_token) {
      // 32 hex characters of CSPRNG. This is the only credential the public
      // /trip/[token] page has, so it has to be unguessable rather than merely
      // unique — a sequential id or a slug would make every trip enumerable.
      update.share_token = randomBytes(16).toString("hex");
      update.shared_at = new Date().toISOString();
    }
    if (body.share === "revoke") {
      update.share_token = null;
      update.shared_at = null;
    }

    const { data, error } = await supabase
      .from("travel_plans")
      .update(update)
      .eq("id", id)
      .eq("user_id", user.id)
      .select("packing_list, trip_type, confirmed_dates, share_token")
      .single();

    if (error) throw error;
    const row = data as {
      packing_list: unknown;
      trip_type: "business" | "leisure" | null;
      confirmed_dates: string[] | null;
      share_token: string | null;
    };

    const tripType = row.trip_type ?? found.meta.tripType;
    const response: TripDetailResponse = {
      trip: {
        ...found.meta,
        tripType,
        confirmedDates: row.confirmed_dates ?? [],
        shareToken: row.share_token,
      },
      // Re-resolved rather than echoed back: changing the trip type changes which
      // template entries exist, and the client should get the list it will render.
      packing: resolvePackingList(row.packing_list, tripType),
    };
    return NextResponse.json(response);
  } catch (error) {
    console.error("Trip update error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't save that change" },
      { status: 500 }
    );
  }
}
