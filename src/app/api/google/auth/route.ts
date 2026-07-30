import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createServerSupabase } from "@/lib/supabase/server";
import { CALENDAR_SCOPE, buildGoogleAuthUrl } from "@/lib/google/client";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "google_oauth_state";

/**
 * GET /api/google/auth?scope=calendar
 *
 * Kicks off Calendar-only consent (ROADMAP 6.0-A). Gmail gets its own `scope=gmail`
 * value and its own consent button later (D1) — not implemented here yet, so any
 * other `scope` value 400s instead of silently falling through.
 */
export async function GET(request: NextRequest) {
  const scope = request.nextUrl.searchParams.get("scope");
  if (scope !== "calendar") {
    return NextResponse.json(
      { error: "Only scope=calendar is supported right now" },
      { status: 400 }
    );
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const state = randomBytes(24).toString("hex");
  const redirectUri = new URL("/api/google/callback", request.url).toString();
  const authUrl = buildGoogleAuthUrl({ redirectUri, state, scope: CALENDAR_SCOPE });

  const response = NextResponse.redirect(authUrl);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/api/google",
  });
  return response;
}
