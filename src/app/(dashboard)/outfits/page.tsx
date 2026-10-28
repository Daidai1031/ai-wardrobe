import { createServerSupabase } from "@/lib/supabase/server";
import type { WardrobeItem } from "@/types/database";
import { OutfitsView, type SavedOutfit } from "./outfits-view";
import type { InitialTryOnResult } from "./virtual-try-on";
import { TRY_ON_BUCKET } from "@/lib/try-on/constants";
import { tryOnFingerprint } from "@/lib/try-on/input";

interface StoredTryOn {
  id: string;
  outfit_id: string;
  result_path: string;
  person_photo_path: string;
  item_fingerprint: string;
  created_at: string;
}

export default async function OutfitsPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const [
    { data: outfits, error: outfitsError },
    { data: wardrobeItems, error: itemsError },
    { data: profile },
    { data: tryOnRows, error: tryOnError },
  ] =
    await Promise.all([
      supabase
        .from("outfits")
        .select(
          "*, outfit_items(item_id, position, x, y, width, wardrobe_items(*))"
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("wardrobe_items")
        .select("*")
        .eq("user_id", user.id)
        .eq("archived", false)
        .order("created_at", { ascending: false }),
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase
        .from("virtual_try_ons")
        .select("id,outfit_id,result_path,person_photo_path,item_fingerprint,created_at")
        .eq("user_id", user.id)
        .eq("status", "complete")
        .not("result_path", "is", null)
        .order("created_at", { ascending: false })
        .limit(30),
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

  if (tryOnError && tryOnError.code !== "PGRST205") {
    console.error("Virtual try-on history fetch error:", tryOnError.message);
  }

  const photoPath = (profile as { full_body_photo_path?: string | null } | null)
    ?.full_body_photo_path;
  const { data: signedPhoto } = photoPath
    ? await supabase.storage.from(TRY_ON_BUCKET).createSignedUrl(photoPath, 60 * 60)
    : { data: null };

  const currentFingerprints = new Map<string, string>();
  if (photoPath) {
    for (const outfit of (outfits || []) as SavedOutfit[]) {
      const garments = [...(outfit.outfit_items || [])]
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((join) => join.wardrobe_items)
        .filter((item): item is NonNullable<typeof item> => Boolean(item));
      currentFingerprints.set(outfit.id, tryOnFingerprint(photoPath, garments));
    }
  }

  const initialTryOns = (
    await Promise.all(
      ((tryOnRows || []) as StoredTryOn[]).map(async (row): Promise<InitialTryOnResult | null> => {
        if (
          row.person_photo_path !== photoPath ||
          currentFingerprints.get(row.outfit_id) !== row.item_fingerprint
        ) {
          return null;
        }
        const { data, error } = await supabase.storage
          .from(TRY_ON_BUCKET)
          .createSignedUrl(row.result_path, 60 * 60);
        if (error || !data?.signedUrl) return null;
        return {
          id: row.id,
          outfitId: row.outfit_id,
          resultUrl: data.signedUrl,
          createdAt: row.created_at,
        };
      })
    )
  ).filter((result): result is InitialTryOnResult => Boolean(result));

  return (
    <OutfitsView
      outfits={(outfits || []) as SavedOutfit[]}
      wardrobeItems={(wardrobeItems || []) as WardrobeItem[]}
      userId={user.id}
      profilePhotoUrl={signedPhoto?.signedUrl ?? null}
      initialTryOns={initialTryOns}
    />
  );
}
