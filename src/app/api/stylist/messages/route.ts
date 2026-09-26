import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getAccessibleClient } from "@/lib/stylist/access";
import type { StylistMessage } from "@/types/database";

export const dynamic = "force-dynamic";

/**
 * Messages between a client and the human stylist (schema 23).
 *
 * One route, two directions, told apart by who is calling and whether a `clientId`
 * names someone else:
 *
 *   - no `clientId` (or your own): the caller is a client writing to the stylist.
 *   - a `clientId` that isn't the caller's: the caller is the stylist replying, and
 *     must pass the same access-window gate as every other read of that client.
 *
 * Writes use the service role — the table has a read policy only, because a message
 * spans two users. That makes this route the one place the rule "a stylist can only
 * write to a client whose window is open" lives.
 */

const MAX_BODY = 2000;

async function currentUser() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const payload = (await request.json().catch(() => null)) as {
    body?: unknown;
    clientId?: unknown;
  } | null;

  const body = typeof payload?.body === "string" ? payload.body.trim() : "";
  if (!body) return NextResponse.json({ error: "Write something first" }, { status: 400 });
  if (body.length > MAX_BODY) {
    return NextResponse.json({ error: `Keep it under ${MAX_BODY} characters` }, { status: 400 });
  }

  const requestedClientId = typeof payload?.clientId === "string" ? payload.clientId : null;
  const stylistReplying = requestedClientId !== null && requestedClientId !== user.id;

  if (stylistReplying && !(await getAccessibleClient(user.id, requestedClientId))) {
    return NextResponse.json({ error: "No access to this client" }, { status: 403 });
  }

  const { data, error } = await createServiceSupabase()
    .from("stylist_messages")
    .insert({
      client_id: stylistReplying ? requestedClientId : user.id,
      sender: stylistReplying ? "stylist" : "client",
      body,
    })
    .select("id, client_id, sender, body, created_at, read_at")
    .single();

  if (error) {
    console.error("stylist message insert failed:", error);
    return NextResponse.json({ error: "Could not send your message" }, { status: 500 });
  }

  return NextResponse.json({ message: data as StylistMessage });
}

/**
 * Marks what the caller has received as read. A client clears the stylist's messages
 * in their own thread; the stylist clears the client's in the thread named by
 * `clientId`. Only the recipient's side is ever touched, so opening your own outbox
 * can't mark anything.
 */
export async function PATCH(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const payload = (await request.json().catch(() => null)) as { clientId?: unknown } | null;
  const requestedClientId = typeof payload?.clientId === "string" ? payload.clientId : null;
  const stylistReading = requestedClientId !== null && requestedClientId !== user.id;

  if (stylistReading && !(await getAccessibleClient(user.id, requestedClientId))) {
    return NextResponse.json({ error: "No access to this client" }, { status: 403 });
  }

  const { error } = await createServiceSupabase()
    .from("stylist_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("client_id", stylistReading ? requestedClientId : user.id)
    .eq("sender", stylistReading ? "client" : "stylist")
    .is("read_at", null);

  if (error) {
    console.error("stylist message mark-read failed:", error);
    return NextResponse.json({ error: "Could not update messages" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
