import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client — bypasses RLS entirely. Only use it for tables that
 * intentionally have no client-facing policy, like `google_connections` (OAuth tokens
 * must never be reachable via a user's session, only from trusted server code). Never
 * import this into a Client Component, and never let SUPABASE_SERVICE_ROLE_KEY leak
 * into a NEXT_PUBLIC_ var.
 */
export function createServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
