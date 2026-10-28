import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getConnectionStatus } from "@/lib/google/client";
import { ProfileForm } from "./profile-form";
import { GoogleConnections } from "./google-connections";
import { StylistSharing } from "./stylist-sharing";
import { ProfileTabs, type ProfileTab } from "./profile-tabs";
import { SignOutButton } from "./sign-out-button";
import { FullBodyPhoto } from "./full-body-photo";
import { TRY_ON_BUCKET } from "@/lib/try-on/constants";

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
  const photoPath = (profile as { full_body_photo_path?: string | null } | null)
    ?.full_body_photo_path;
  const photoUpdatedAt = (profile as { full_body_photo_updated_at?: string | null } | null)
    ?.full_body_photo_updated_at;
  const { data: signedPhoto } = photoPath
    ? await supabase.storage.from(TRY_ON_BUCKET).createSignedUrl(photoPath, 60 * 60)
    : { data: null };

  // Closet analytics moved to /closet; keep old links landing on it.
  if (params.tab === "analytics") redirect("/closet?tab=analytics");

  // Google's OAuth callback lands here with ?google_calendar=…, and that result is
  // reported by the connected-accounts section, which lives on the privacy tab.
  const requestedTab = params.tab;
  const initialTab: ProfileTab =
    calendarResult !== undefined || requestedTab === "privacy"
      ? "privacy"
      : "profile";

  return (
    <ProfileTabs
      initialTab={initialTab}
      panels={{
        profile: (
          <div className="space-y-8">
            <ProfileForm profile={profile} />
            <FullBodyPhoto
              initialPhotoUrl={signedPhoto?.signedUrl ?? null}
              updatedAt={photoUpdatedAt ?? null}
            />
            <div className="max-w-2xl border-t border-surface-200 pt-6">
              <SignOutButton />
            </div>
          </div>
        ),
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
