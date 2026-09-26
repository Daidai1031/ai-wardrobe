import { createServerSupabase } from "@/lib/supabase/server";
import { getConnectionStatus } from "@/lib/google/client";
import { ProfileForm } from "./profile-form";
import { GoogleConnections } from "./google-connections";
import { StylistSharing } from "./stylist-sharing";
import { ClosetAnalytics } from "./closet-analytics";
import { ProfileTabs, type ProfileTab } from "./profile-tabs";
import { SignOutButton } from "./sign-out-button";

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

  // Google's OAuth callback lands here with ?google_calendar=…, and that result is
  // reported by the connected-accounts section, which lives on the privacy tab.
  const requestedTab = params.tab;
  const initialTab: ProfileTab =
    calendarResult !== undefined || requestedTab === "privacy"
      ? "privacy"
      : requestedTab === "analytics"
        ? "analytics"
        : "profile";

  return (
    <ProfileTabs
      initialTab={initialTab}
      panels={{
        profile: (
          <div className="space-y-8">
            <ProfileForm profile={profile} />
            <div className="max-w-2xl border-t border-surface-200 pt-6">
              <SignOutButton />
            </div>
          </div>
        ),
        analytics: <ClosetAnalytics userId={user.id} />,
        privacy: (
          <div className="space-y-6">
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
        ),
      }}
    />
  );
}
