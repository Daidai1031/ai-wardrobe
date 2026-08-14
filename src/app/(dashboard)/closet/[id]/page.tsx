import { createServerSupabase } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { ItemDetail } from "./item-detail";
import { ItemOutfits, type ItemOutfitPreview } from "./item-outfits";

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: item }, { data: photos }, { data: outfitLinks, error: linksError }] = await Promise.all([
    supabase
      .from("wardrobe_items")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .single(),
    supabase
      .from("wardrobe_item_photos")
      .select("*")
      .eq("item_id", id)
      .eq("user_id", user.id)
      .order("position", { ascending: true }),
    supabase
      .from("outfit_items")
      .select("outfit_id")
      .eq("item_id", id),
  ]);

  if (!item) notFound();

  if (linksError) console.error("Item outfit links fetch failed:", linksError);
  const outfitIds = [...new Set((outfitLinks ?? []).map((row) => row.outfit_id))];
  let itemOutfits: ItemOutfitPreview[] = [];

  if (outfitIds.length > 0) {
    const { data: outfits, error: outfitsError } = await supabase
      .from("outfits")
      .select(
        "id, name, folder, notes, times_worn, ai_generated, created_at, outfit_items(item_id, position, x, y, width, wardrobe_items(*))"
      )
      .eq("user_id", user.id)
      .in("id", outfitIds)
      .order("created_at", { ascending: false })
      .limit(3);

    if (outfitsError) console.error("Item outfits fetch failed:", outfitsError);
    itemOutfits = (outfits ?? []).map((outfit) => ({
      ...outfit,
      outfit_items: (outfit.outfit_items ?? []).map((join) => ({
        ...join,
        wardrobe_items: Array.isArray(join.wardrobe_items)
          ? join.wardrobe_items[0] ?? null
          : join.wardrobe_items,
      })),
    })) as ItemOutfitPreview[];
  }

  return (
    <>
      <ItemDetail item={item} photos={photos ?? []} />
      <ItemOutfits itemId={item.id} outfits={itemOutfits} />
    </>
  );
}
