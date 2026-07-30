import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { exchangeCodeForTokens, saveConnection } from "@/lib/google/client";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "google_oauth_state";

/**
 * GET /api/google/callback — Google redirects here after consent (or denial).
 * Lands the user back on /profile with a `google_calendar=connected|error` flag.
 * The Connected accounts section reads it, reports the outcome once, then strips it
 * from the URL — the redirect is the only channel this flow has to report back.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const oauthError = params.get("error");
  const code = params.get("code");
  const returnedState = params.get("state");
  const cookieState = request.cookies.get(STATE_COOKIE)?.value;

  function redirectTo(status: "connected" | "error", reason?: string) {
    const url = new URL("/profile", request.url);
    url.searchParams.set("google_calendar", status);
    if (reason) url.searchParams.set("reason", reason);
    const res = NextResponse.redirect(url);
    res.cookies.delete(STATE_COOKIE);
    return res;
  }

  if (oauthError) return redirectTo("error", oauthError);
  if (!code || !returnedState || returnedState !== cookieState) {
    return redirectTo("error", "invalid_state");
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    const redirectUri = new URL("/api/google/callback", request.url).toString();
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    await saveConnection(user.id, tokens);
  } catch (err) {
    console.error("Google OAuth callback failed:", err);
    return redirectTo("error", "token_exchange_failed");
  }

  return redirectTo("connected");
}
