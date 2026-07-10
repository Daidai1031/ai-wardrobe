import { createServerSupabase } from "@/lib/supabase/server";
import { ITEM_CATEGORIES } from "@/types/database";
import { ClosetView } from "./closet-view";

export default async function ClosetPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; color?: string; season?: string }>;
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

  // Get distinct colors for filter
  const { data: allItems } = await supabase
    .from("wardrobe_items")
    .select("color, category")
    .eq("user_id", user.id)
    .eq("archived", false);

  const colors = [...new Set((allItems || []).map((i) => i.color).filter(Boolean))];
  const categoryCounts: Record<string, number> = {};
  (allItems || []).forEach((i) => {
    categoryCounts[i.category] = (categoryCounts[i.category] || 0) + 1;
  });

  return (
    <ClosetView
      items={items || []}
      colors={colors as string[]}
      categoryCounts={categoryCounts}
      activeCategory={params.category}
      activeColor={params.color}
      activeSeason={params.season}
    />
  );
}
