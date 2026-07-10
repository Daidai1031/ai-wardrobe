import { createServerSupabase } from "@/lib/supabase/server";
import type { WardrobeItem } from "@/types/database";
import { OutfitsView, type SavedOutfit } from "./outfits-view";

export default async function OutfitsPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const [{ data: outfits, error: outfitsError }, { data: wardrobeItems, error: itemsError }] =
    await Promise.all([
      supabase
        .from("outfits")
        .select(
          "*, outfit_items(item_id, position, x, y, width, wardrobe_items(id, clean_url, original_url, category, subcategory, color, brand))"
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("wardrobe_items")
        .select("*")
        .eq("user_id", user.id)
        .eq("archived", false)
        .order("created_at", { ascending: false }),
    ]);

  if (outfitsError) {
    console.error(
      "Outfits fetch error (raw):",
      JSON.stringify(outfitsError, Object.getOwnPropertyNames(outfitsError))
    );
  }
  if (itemsError) {
    console.error("Wardrobe fetch error:", {
      message: itemsError.message,
      details: itemsError.details,
      hint: itemsError.hint,
      code: itemsError.code,
    });
  }

  return (
    <OutfitsView
      outfits={(outfits || []) as SavedOutfit[]}
      wardrobeItems={(wardrobeItems || []) as WardrobeItem[]}
      userId={user.id}
    />
  );
}
