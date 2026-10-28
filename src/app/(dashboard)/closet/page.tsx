import { createServerSupabase } from "@/lib/supabase/server";
import { readRotationLimits } from "@/lib/planning/plans";
import { closetFingerprint, detectGaps } from "@/lib/shop/detect-gaps";
import { ITEM_CATEGORIES, type ShoppingRecommendation, type ShoppingTier } from "@/types/database";
import { ClosetView } from "./closet-view";
import { ClosetAnalytics } from "./closet-analytics";
import { ClosetTabs, type ClosetTab } from "./closet-tabs";
import { GapsShop } from "./gaps-shop";

export default async function ClosetPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; color?: string; season?: string; tab?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  // Build query
  let query = supabase
    .from("wardrobe_items")
    .select("*")
    .eq("user_id", user.id)
    .eq("archived", false)
    .order("created_at", { ascending: false });

  if (params.category && ITEM_CATEGORIES.includes(params.category as never)) {
    query = query.eq("category", params.category);
  }
  if (params.color) {
    query = query.eq("color", params.color);
  }
  if (params.season) {
    query = query.contains("season", [params.season]);
  }

  const { data: items, error } = await query;

  if (error) {
    console.error("Closet fetch error:", error);
  }

  // The whole active closet, unfiltered: the colour filter and the gap rules both need it.
  const [{ data: allItems }, { data: profile }, { data: recommendations }, rotationLimits] = await Promise.all([
    supabase
      .from("wardrobe_items")
      .select("id, color, colors, category, subcategory, display_name, season, occasion, style_tags")
      .eq("user_id", user.id)
      .eq("archived", false),
    supabase.from("profiles").select("shopping_tier").eq("id", user.id).single(),
    supabase.from("shopping_recommendations").select("*").eq("user_id", user.id),
    readRotationLimits(supabase, user.id),
  ]);
  const closet = allItems || [];

  const colors = [...new Set(closet.map((i) => i.color).filter(Boolean))];
  const categoryCounts: Record<string, number> = {};
  closet.forEach((i) => {
    categoryCounts[i.category] = (categoryCounts[i.category] || 0) + 1;
  });

  const initialTab: ClosetTab =
    params.tab === "analytics" || params.tab === "gaps" ? params.tab : "items";

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-surface-900">My Closet</h1>
      <ClosetTabs
        initialTab={initialTab}
        panels={{
          items: (
            <ClosetView
              items={items || []}
              colors={colors as string[]}
              categoryCounts={categoryCounts}
              activeCategory={params.category}
              activeColor={params.color}
              activeSeason={params.season}
            />
          ),
          analytics: <ClosetAnalytics userId={user.id} />,
          gaps: (
            <GapsShop
              userId={user.id}
              gaps={detectGaps(closet, rotationLimits)}
              closetSize={closet.length}
              fingerprint={closetFingerprint(closet)}
              initialTier={(profile?.shopping_tier as ShoppingTier | null) ?? null}
              initialRecommendations={(recommendations || []) as ShoppingRecommendation[]}
            />
          ),
        }}
      />
    </div>
  );
}
