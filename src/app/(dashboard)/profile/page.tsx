import { createServerSupabase } from "@/lib/supabase/server";
import { getConnectionStatus } from "@/lib/google/client";
import { ProfileForm } from "./profile-form";
import { GoogleConnections } from "./google-connections";
import { StylistSharing } from "./stylist-sharing";

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // The connection status is read server-side on purpose: google_connections has
  // RLS with no policy, so a browser client cannot query it at all, and it holds
  // OAuth tokens that must never reach one. getConnectionStatus returns a
  // token-free summary.
  const [{ data: profile }, connectionStatus, params] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single(),
    getConnectionStatus(user.id),
    searchParams,
  ]);

  const calendarResult = params.google_calendar;

  return (
    <div className="space-y-6">
      <ProfileForm profile={profile} />
      <GoogleConnections
        status={connectionStatus}
        calendarResult={typeof calendarResult === "string" ? calendarResult : undefined}
      />
      <StylistSharing
        userId={user.id}
        accessExpiresAt={profile?.access_expires_at ?? null}
        shareOccasions={Boolean(profile?.stylist_share_occasions)}
      />
    </div>
  );
}
