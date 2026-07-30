import { createServiceSupabase } from "@/lib/supabase/service";
import type { GoogleConnection } from "@/types/database";

/**
 * Calendar-only OAuth for now (ROADMAP 6.0-A / D1). Gmail gets its own scope and its
 * own consent button later — do not fold it into this file or this flow. Both scopes
 * will eventually live in the same `google_connections` row (one row per user, one
 * `scopes` array), but only `calendar.readonly` is ever requested from here today.
 */
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

export function buildGoogleAuthUrl(opts: {
  redirectUri: string;
  state: string;
  scope: string;
}): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: opts.scope,
    access_type: "offline",
    prompt: "consent",
    state: opts.state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<GoogleTokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// Returns null (never throws) — a refresh failure is routine under Google's Testing-mode
// ~7 day refresh_token expiry (ROADMAP D1) and callers must degrade gracefully, not 500.
async function refreshAccessToken(
  refreshToken: string
): Promise<{ access_token: string; expires_in: number } | null> {
  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) return null;
    return res.json();
  } catch (err) {
    console.error("Google refreshAccessToken error:", err);
    return null;
  }
}

async function getConnection(userId: string): Promise<GoogleConnection | null> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("google_connections")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("getConnection error:", error);
    return null;
  }
  return data as GoogleConnection | null;
}

/**
 * Upserts the tokens from a fresh OAuth callback. Google reliably returns a
 * refresh_token because the auth request always sends prompt=consent, but if it's
 * ever omitted we fall back to whatever refresh_token is already on file rather than
 * clobbering it with null.
 */
export async function saveConnection(userId: string, tokens: GoogleTokenResponse) {
  const supabase = createServiceSupabase();
  const existing = await getConnection(userId);
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  const { error } = await supabase.from("google_connections").upsert(
    {
      user_id: userId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? existing?.refresh_token ?? null,
      expires_at: expiresAt,
      scopes: tokens.scope.split(" ").filter(Boolean),
      invalid_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) throw error;
}

// 60s buffer so a token doesn't expire mid-request.
const EXPIRY_BUFFER_MS = 60_000;

/**
 * The single place that hands out a usable Calendar access token — fetches the stored
 * one, refreshes it if expired, and persists the refreshed value. Returns null (never
 * throws) whenever Calendar isn't usable: no connection, previously marked invalid, or
 * the refresh itself failed — in which case the connection is marked invalid here so
 * the UI can prompt for re-auth instead of silently retrying every call.
 */
export async function getAccessToken(userId: string): Promise<string | null> {
  const connection = await getConnection(userId);
  if (!connection || connection.invalid_at) return null;

  const expiresAt = connection.expires_at ? new Date(connection.expires_at).getTime() : 0;
  if (expiresAt - EXPIRY_BUFFER_MS > Date.now()) {
    return connection.access_token;
  }

  if (!connection.refresh_token) {
    await markInvalid(userId);
    return null;
  }

  const refreshed = await refreshAccessToken(connection.refresh_token);
  if (!refreshed) {
    await markInvalid(userId);
    return null;
  }

  const supabase = createServiceSupabase();
  const { error } = await supabase
    .from("google_connections")
    .update({
      access_token: refreshed.access_token,
      expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  if (error) {
    console.error("getAccessToken: failed to persist refreshed token:", error);
    return null;
  }

  return refreshed.access_token;
}

async function markInvalid(userId: string) {
  const supabase = createServiceSupabase();
  const { error } = await supabase
    .from("google_connections")
    .update({ invalid_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) console.error("markInvalid error:", error);
}

/** Gates a feature on a granted, still-valid scope — check this before every Calendar call. */
export async function hasScope(userId: string, scope: string): Promise<boolean> {
  const connection = await getConnection(userId);
  if (!connection || connection.invalid_at) return false;
  return connection.scopes.includes(scope);
}

/**
 * What the settings UI is allowed to know about a connection. Deliberately carries
 * no tokens: `google_connections` has RLS with no policy precisely so tokens never
 * reach a browser, and that guarantee would be pointless if this shape leaked them
 * through a Server Component's props instead.
 *
 * `needsReconnect` is the state that matters in the UI — a row exists but was marked
 * invalid, which under Testing-mode's ~7 day refresh_token expiry (D1) is routine
 * rather than exceptional. It reads as "connected but broken", not "never connected".
 */
export interface GoogleConnectionStatus {
  connected: boolean;
  needsReconnect: boolean;
  scopes: string[];
  googleEmail: string | null;
  connectedAt: string | null;
}

export async function getConnectionStatus(userId: string): Promise<GoogleConnectionStatus> {
  const connection = await getConnection(userId);
  if (!connection) {
    return { connected: false, needsReconnect: false, scopes: [], googleEmail: null, connectedAt: null };
  }
  return {
    connected: !connection.invalid_at,
    needsReconnect: Boolean(connection.invalid_at),
    scopes: connection.scopes || [],
    googleEmail: connection.google_email,
    connectedAt: connection.created_at,
  };
}

const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/**
 * Drops the connection. The local row is deleted even when Google's revoke call
 * fails: the user asked to disconnect, and keeping tokens we've been told to forget
 * is the worse outcome. The cost of that choice is that a failed revoke leaves the
 * grant listed in the user's Google account until they remove it there, which the
 * UI says explicitly rather than pretending the revoke always lands.
 */
export async function revokeConnection(userId: string): Promise<{ revokedAtGoogle: boolean }> {
  const connection = await getConnection(userId);
  if (!connection) return { revokedAtGoogle: true };

  let revokedAtGoogle = false;
  // Revoking the refresh token invalidates every token derived from it; fall back to
  // the access token when there is no refresh token on file.
  const token = connection.refresh_token || connection.access_token;
  if (token) {
    try {
      const res = await fetch(GOOGLE_REVOKE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
      });
      revokedAtGoogle = res.ok;
      if (!res.ok) {
        console.error("Google revoke failed:", res.status, await res.text());
      }
    } catch (err) {
      console.error("Google revoke error:", err);
    }
  }

  const supabase = createServiceSupabase();
  const { error } = await supabase.from("google_connections").delete().eq("user_id", userId);
  if (error) throw error;

  return { revokedAtGoogle };
}
