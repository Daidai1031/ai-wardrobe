/**
 * The human stylist's access gate (ROADMAP Phase 10-A / D16).
 *
 * There is deliberately no `wardrobe_grants` table: the company has exactly one
 * stylist, so every row's `stylist_id` would carry the same value and the table
 * would encode nothing. Access is therefore two conditions:
 *
 *   1. the viewer's `profiles.roles` contains 'stylist', and
 *   2. the client's `profiles.access_expires_at` is in the future.
 *
 * The window is maintained by the automation webhook (`/api/webhooks/consult-ended`
 * sets it 14 days out when a consultation is marked finished, D14) and the client
 * can end it early from /profile.
 *
 * The same rule exists a second time in SQL as `public.stylist_can_view()` (schema
 * section 18a), which is what actually protects the data — the checks here are for
 * routing and UI, so a stylist gets "this window has closed" instead of an empty
 * page. Change one and you must change the other.
 */

import { createServiceSupabase } from "@/lib/supabase/service";

export const STYLIST_ROLE = "stylist";

export interface StylistClient {
  id: string;
  name: string | null;
  email: string | null;
  city: string | null;
  accessExpiresAt: string;
  shareOccasions: boolean;
}

export async function isStylist(userId: string): Promise<boolean> {
  const supabase = createServiceSupabase();
  const { data } = await supabase.from("profiles").select("roles").eq("id", userId).maybeSingle();
  return Boolean(data?.roles?.includes(STYLIST_ROLE));
}

/**
 * Every client whose access window is currently open, newest-expiring last so the
 * console can lead with the ones about to close. Returns [] for a non-stylist rather
 * than throwing — callers treat "no clients" and "not a stylist" the same way at the
 * data layer and differently in the UI.
 */
export async function listAccessibleClients(stylistId: string): Promise<StylistClient[]> {
  if (!(await isStylist(stylistId))) return [];

  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name, email, city, access_expires_at, stylist_share_occasions")
    .gt("access_expires_at", new Date().toISOString())
    .neq("id", stylistId)
    .order("access_expires_at", { ascending: true });

  if (error) {
    console.error("listAccessibleClients failed:", error);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    city: row.city,
    accessExpiresAt: row.access_expires_at as string,
    shareOccasions: Boolean(row.stylist_share_occasions),
  }));
}

/** The single client, or null if the viewer isn't a stylist or the window has closed. */
export async function getAccessibleClient(
  stylistId: string,
  clientId: string
): Promise<StylistClient | null> {
  if (stylistId === clientId) return null;
  const clients = await listAccessibleClients(stylistId);
  return clients.find((client) => client.id === clientId) ?? null;
}

/**
 * D16: append-only audit trail. Written on every server-side read of a client's data,
 * never awaited for correctness — a logging failure must not block the stylist, but it
 * also must not pass silently, hence the console.error.
 */
export async function logWardrobeAccess(
  stylistId: string,
  clientId: string,
  resource: string
): Promise<void> {
  const supabase = createServiceSupabase();
  const { error } = await supabase
    .from("wardrobe_access_log")
    .insert({ stylist_id: stylistId, client_id: clientId, resource });
  if (error) console.error("logWardrobeAccess failed:", error, { clientId, resource });
}
