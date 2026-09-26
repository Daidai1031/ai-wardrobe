import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { STYLIST_ROLE } from "@/lib/stylist/access";
import { DailyRecommendation } from "./daily-recommendation";
import { HOME_WEATHER_SLOT_ID } from "./weather-slot";
import { HomeSplash, PhoneGreeting } from "./home-greeting";
import { SPLASH_COOKIE } from "./splash-cookie";
import { StyleSwipe, type SwipeOutfitRow } from "./style-swipe";

/** Enough to swipe through without paying for the user's whole Look library. */
const SWIPE_DECK_SIZE = 20;

export default async function HomePage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: swipeOutfits }] = await Promise.all([
    supabase.from("profiles").select("name, roles").eq("id", user.id).single(),
    supabase
      .from("outfits")
      .select(
        "id, name, folder, outfit_items(item_id, position, x, y, width, wardrobe_items(id, display_name, optimized_url, clean_url, original_url, category, subcategory, color, brand))"
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(SWIPE_DECK_SIZE),
  ]);

  // A staff-only account has no closet, so /home is a page of empty states. Sign-in
  // lands here (proxy.ts sends authenticated users to /home), so the redirect has to be
  // on this page — the proxy can't check roles without a DB query on every request.
  const roles = profile?.roles ?? [];
  if (roles.includes(STYLIST_ROLE) && roles.length > 0 && !roles.includes("client")) {
    redirect("/pro");
  }

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const firstName = profile?.name ? profile.name.split(" ")[0] : undefined;
  const splashSeen = (await cookies()).has(SPLASH_COOKIE);

  return (
    <div>
      {/* Phone: a full-screen greeting once per session, then a small one-line greeting here.
          Desktop keeps the large heading. */}
      {!splashSeen && <HomeSplash firstName={firstName} />}
      <PhoneGreeting firstName={firstName} />
      <h1 className="hidden font-serif text-display text-ink mb-1 lg:block">
        {firstName ? `Good morning, ${firstName}` : "Good morning"}
      </h1>
      <div className="mb-6 flex flex-col gap-1 text-body text-ink-muted max-lg:mt-1">
        <p>{today}</p>
        {/* The forecast is portalled in here by DailyRecommendation, once the plan loads. */}
        <div id={HOME_WEATHER_SLOT_ID} />
      </div>

      {/* Side by side on wide screens so the plan (what the user came for) and the
          swipe prototype (secondary, signal-collecting) are both visible at once
          without either reading as equal in importance — the plan gets the bulk
          of the width, swipe is a narrow strip beside it, and both stretch to the
          taller card's height so the two panels read as one balanced row rather
          than a tall card next to a short one. Stacks back to a single column
          below xl, where there isn't room to keep both legible. */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-stretch">
        <DailyRecommendation />
        <div className="flex flex-col gap-3">
          <StyleSwipe outfits={(swipeOutfits || []) as unknown as SwipeOutfitRow[]} />
          <Link href="/outfits?tab=stylist" className="text-button text-ink-muted hover:text-ink">
            Want something else? Ask the AI Stylist →
          </Link>
        </div>
      </div>
    </div>
  );
}
