/**
 * What the stylist sees on the Overview tab of `/pro/[clientId]` (ROADMAP Phase 10-A).
 *
 * Two different reasons this is server-side and service-role, matching the pattern in
 * `occasion-projection.ts`:
 *
 *   - The profile columns *are* reachable under her own session (schema 18b puts a
 *     `stylist_can_view(id)` policy on `profiles`), but the console already reads the
 *     row here for the access window, so re-reading it in the page would be a second
 *     round trip for the same row.
 *   - `stylist_bookings` is **not** in the 18b whitelist and deliberately never will
 *     be: it is user-readable only, because availability has to consider other users'
 *     occupied intervals without exposing them. Her own sessions with *this* client
 *     are a legitimate read, so they are projected here — service role, gated by the
 *     same access window, and narrowed to the four fields the tab renders. No client
 *     id, no notes from other people's bookings, nothing that isn't this pair's.
 *
 * There is no message/CRM store in this repo yet (ROADMAP: the Folk integration is
 * unbuilt), so "past communication" is exactly two real things: the consultations on
 * the books, and the suggestions she has already sent. This file returns the first;
 * the suggestions the console already loads.
 */

import { createServiceSupabase } from "@/lib/supabase/service";
import type { BodyShape, StylistBookingService, StylistBookingStatus } from "@/types/database";

export interface StylistClientSession {
  id: string;
  serviceType: StylistBookingService;
  startsAt: string;
  endsAt: string;
  status: StylistBookingStatus;
}

export interface StylistClientOverview {
  /** Null when the profile row is unreadable — the tab degrades to the session list. */
  profile: {
    name: string | null;
    email: string | null;
    city: string | null;
    timezone: string | null;
    heightCm: number | null;
    weightKg: number | null;
    bodyShape: BodyShape | null;
    bustCm: number | null;
    waistCm: number | null;
    hipCm: number | null;
    skinTone: string | null;
    hairColor: string | null;
    hairLength: string | null;
    memberSince: string | null;
  } | null;
  /** Newest first: the ones she is about to have, or just had, are what she needs. */
  sessions: StylistClientSession[];
}

const PROFILE_COLUMNS = [
  "name",
  "email",
  "city",
  "timezone",
  "height_cm",
  "weight_kg",
  "body_shape",
  "bust_cm",
  "waist_cm",
  "hip_cm",
  "skin_tone",
  "hair_color",
  "hair_length",
  "created_at",
].join(", ");

export async function readClientOverview(clientId: string): Promise<StylistClientOverview> {
  const supabase = createServiceSupabase();

  const [{ data: profile }, { data: bookings, error: bookingsError }] = await Promise.all([
    supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", clientId).maybeSingle(),
    supabase
      .from("stylist_bookings")
      .select("id, service_type, starts_at, ends_at, status")
      .eq("user_id", clientId)
      .order("starts_at", { ascending: false }),
  ]);

  if (bookingsError) {
    // Section 16 may not be applied. An overview without sessions is still useful, so
    // this degrades rather than taking the console down.
    console.error("readClientOverview bookings failed:", bookingsError);
  }

  // The select above is a string, so PostgREST hands back a loosely typed row.
  const row = profile as Record<string, unknown> | null;

  return {
    profile: row
      ? {
          name: (row.name as string) ?? null,
          email: (row.email as string) ?? null,
          city: (row.city as string) ?? null,
          timezone: (row.timezone as string) ?? null,
          heightCm: (row.height_cm as number) ?? null,
          weightKg: (row.weight_kg as number) ?? null,
          bodyShape: (row.body_shape as BodyShape) ?? null,
          bustCm: (row.bust_cm as number) ?? null,
          waistCm: (row.waist_cm as number) ?? null,
          hipCm: (row.hip_cm as number) ?? null,
          skinTone: (row.skin_tone as string) ?? null,
          hairColor: (row.hair_color as string) ?? null,
          hairLength: (row.hair_length as string) ?? null,
          memberSince: (row.created_at as string) ?? null,
        }
      : null,
    sessions: (bookings ?? []).map((booking) => ({
      id: booking.id as string,
      serviceType: booking.service_type as StylistBookingService,
      startsAt: booking.starts_at as string,
      endsAt: booking.ends_at as string,
      status: booking.status as StylistBookingStatus,
    })),
  };
}
