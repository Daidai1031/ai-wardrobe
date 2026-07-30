import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { revokeConnection } from "@/lib/google/client";

/**
 * Disconnects the caller's own Google connection. POST rather than GET so a
 * prefetch or a crawler can't revoke someone's Calendar access, and the user id
 * comes from the session rather than the body — there is no way to ask this route
 * to disconnect anybody else.
 */
export async function POST() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { revokedAtGoogle } = await revokeConnection(user.id);
    return NextResponse.json({ revokedAtGoogle });
  } catch (error) {
    console.error("Google disconnect error:", error);
    return NextResponse.json({ error: "Couldn't disconnect Google" }, { status: 500 });
  }
}
