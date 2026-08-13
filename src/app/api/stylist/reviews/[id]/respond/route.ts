import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * The client's answer to a suggestion: accept it, decline it, or undo an accept.
 *
 * All three run under the client's own session so `auth.uid()` inside the RPCs is the
 * client — the functions are `security definer` (they write rows the review itself
 * doesn't own) and re-check `client_id = auth.uid()` at the top for exactly that reason.
 *
 * 'revert' restores the snapshot the accept took, geometry included, and leaves the
 * review in 'reverted' rather than 'pending' so it doesn't return to the inbox looking
 * unanswered.
 */

const ACTIONS = {
  accept: "accept_stylist_review",
  decline: "decline_stylist_review",
  revert: "revert_stylist_review",
} as const;

type Action = keyof typeof ACTIONS;

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const action = body?.action as Action | undefined;
  if (!action || !(action in ACTIONS)) {
    return NextResponse.json({ error: "action must be accept, decline or revert" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc(ACTIONS[action], { p_review_id: id });

  if (error) {
    console.error(`stylist review ${action} failed:`, error);
    // These RPCs raise for the ordinary user-facing cases too ("already answered",
    // "nothing to restore"), so the message is worth passing through rather than
    // flattening every failure into a generic 500.
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, result: data ?? null });
}
