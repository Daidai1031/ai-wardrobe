/**
 * Reads of the client ↔ stylist message thread (schema 23).
 *
 * The client's read runs under their own session — `stylist_messages` has a
 * "client reads own" policy. The stylist's read is service-role and is only ever
 * called after `getAccessibleClient()` has passed, because she has no RLS access to
 * the table.
 *
 * Both degrade to an empty thread when the table is missing (`PGRST205` before
 * section 23 is applied): /home and the console must keep rendering, and an empty
 * mailbox is a truthful answer for a feature that has not been switched on yet.
 */

import type { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import type { StylistMessage } from "@/types/database";

type ServerSupabase = Awaited<ReturnType<typeof createServerSupabase>>;

const COLUMNS = "id, client_id, sender, body, created_at, read_at";
const THREAD_LIMIT = 200;

export async function readMessagesForClient(
  supabase: ServerSupabase,
  clientId: string
): Promise<StylistMessage[]> {
  const { data, error } = await supabase
    .from("stylist_messages")
    .select(COLUMNS)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(THREAD_LIMIT);

  if (error) {
    console.error("readMessagesForClient failed:", error);
    return [];
  }
  return (data ?? []) as StylistMessage[];
}

/** Service-role. Callers must have verified the stylist's access to `clientId` first. */
export async function readMessagesForStylist(clientId: string): Promise<StylistMessage[]> {
  const { data, error } = await createServiceSupabase()
    .from("stylist_messages")
    .select(COLUMNS)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(THREAD_LIMIT);

  if (error) {
    console.error("readMessagesForStylist failed:", error);
    return [];
  }
  return (data ?? []) as StylistMessage[];
}
