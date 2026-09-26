import type { SupabaseClient } from "@supabase/supabase-js";
import { VICTORIA_HOME, victoriaRows } from "./victoria-calendar";

/**
 * Demo mode for the calendar sync route (`DEMO_CALENDAR=victoria`, development only -- the
 * gate lives in the route so a production build never includes this module): "Sync
 * calendar" loads Victoria's month (docs/test-case-victoria.md) instead of pulling from
 * Google, so the planner can be exercised on a dense calendar with no OAuth connection.
 */

/**
 * Upserts the month, anchored to the current week so it always spans today. Upsert on the
 * positional `seed-victoria-NNN` id means pressing the button again refreshes the same rows
 * instead of piling up copies, and leaves the user's own `location_override` /
 * `stylist_share_detail` edits alone (they aren't in the payload).
 *
 * Trips can't be detected without a home to compare against and a day can't be bucketed
 * without a timezone, so a profile missing either gets New York -- but only what is
 * missing: a profile someone already filled in is never overwritten.
 */
export async function loadVictoriaCalendar(
  supabase: SupabaseClient,
  userId: string
): Promise<{ events: number; filledProfile: boolean }> {
  const rows = victoriaRows(userId);
  const { error } = await supabase.from("calendar_events").upsert(rows, { onConflict: "user_id,google_event_id" });
  if (error) throw new Error(`Failed to load the demo calendar: ${error.message}`);

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("lat, lng, timezone")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw new Error(`Failed to read the profile: ${profileError.message}`);

  const patch: Record<string, string | number> = {};
  if (profile?.lat == null || profile?.lng == null) {
    patch.city = VICTORIA_HOME.city;
    patch.lat = VICTORIA_HOME.lat;
    patch.lng = VICTORIA_HOME.lng;
  }
  if (!profile?.timezone) patch.timezone = VICTORIA_HOME.timezone;

  if (Object.keys(patch).length > 0) {
    const { error: updateError } = await supabase.from("profiles").update(patch).eq("id", userId);
    if (updateError) throw new Error(`Failed to set the demo home city: ${updateError.message}`);
  }

  return { events: rows.length, filledProfile: Object.keys(patch).length > 0 };
}
