import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { STYLIST_ROLE } from "@/lib/stylist/access";
import { readStylistReviewsForClient } from "@/lib/stylist/reviews";
import { StylistReviewInbox } from "@/components/stylist/review-inbox";
import { DailyRecommendation } from "./daily-recommendation";

export default async function HomePage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, stylistReviews] = await Promise.all([
    supabase.from("profiles").select("name, roles").eq("id", user.id).single(),
    readStylistReviewsForClient(supabase, user.id),
  ]);

  // A staff-only account has no closet, so /home is a page of empty states. Sign-in
  // lands here (proxy.ts sends authenticated users to /home), so the redirect has to be
  // on this page — the proxy can't check roles without a DB query on every request.
  const roles = profile?.roles ?? [];
  if (roles.includes(STYLIST_ROLE) && roles.length > 0 && !roles.includes("client")) {
    redirect("/pro");
  }

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div>
      <h1 className="text-xl font-semibold text-surface-900 mb-1">
        {profile?.name ? `Good morning, ${profile.name.split(" ")[0]}` : "Good morning"}
      </h1>
      <p className="text-sm text-surface-500 mb-6">{today}</p>

      {/* Above the daily plan on purpose: a human suggestion is rarer and more
          personal than the generated one, and burying it under the plan means it
          gets seen after the decision it was meant to inform. */}
      <StylistReviewInbox reviews={stylistReviews} />

      <DailyRecommendation userId={user.id} />
    </div>
  );
}
