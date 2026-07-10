import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";
import { removeBackground } from "@/lib/ai/remove-bg";
import { classifyItem } from "@/lib/ai/classify";
import { detectItems, segmentItems } from "@/lib/ai/segment";
import sharp from "sharp";

const MIN_VISIBLE_FOREGROUND_FRACTION = 0.002;

/** Reject transparent/near-empty background-removal results before storage. */
async function hasVisibleForeground(imageBuffer: Buffer): Promise<boolean> {
  const metadata = await sharp(imageBuffer).metadata();

  // Some background-removal providers may return a flattened image. It cannot
  // be alpha-empty, so leave content validation to classification in that case.
  if (!metadata.hasAlpha) return true;

  const { data, info } = await sharp(imageBuffer)
    .resize(256, 256, { fit: "inside", withoutEnlargement: true })
    .extractChannel("alpha")
    .raw()
    .toBuffer({ resolveWithObject: true });

  let visiblePixels = 0;
  for (const alpha of data) {
    if (alpha >= 16) visiblePixels++;
  }

  return visiblePixels / (info.width * info.height) >= MIN_VISIBLE_FOREGROUND_FRACTION;
}

/**
 * Prepares a clean image, then classifies and inserts it. Single-item photos
 * use background removal; multi-item crops already carry SAM-generated alpha.
 */
async function processOneItem(
  supabase: SupabaseClient,
  userId: string,
  originalUrl: string,
  source: { imageUrl: string } | { cleanBuffer: Buffer },
  cleanPath: string
) {
  let cleanBuffer: Buffer;
  if ("cleanBuffer" in source) {
    cleanBuffer = source.cleanBuffer;
  } else {
    const { cleanImageUrl } = await removeBackground(source.imageUrl);
    const cleanResponse = await fetch(cleanImageUrl);
    if (!cleanResponse.ok) {
      throw new Error(`Failed to download background-removed image (${cleanResponse.status})`);
    }
    cleanBuffer = Buffer.from(await cleanResponse.arrayBuffer());
  }

  if (!(await hasVisibleForeground(cleanBuffer))) {
    throw new Error("Segmentation returned an empty image");
  }
  const cleanBlob = new Blob([new Uint8Array(cleanBuffer)], { type: "image/png" });

  const { error: uploadError } = await supabase.storage
    .from("wardrobe")
    .upload(cleanPath, cleanBlob, { contentType: "image/png", upsert: true });

  if (uploadError) throw new Error(`Failed to store clean image: ${uploadError.message}`);

  const { data: { publicUrl: cleanPublicUrl } } = supabase.storage
    .from("wardrobe")
    .getPublicUrl(cleanPath);

  const classification = await classifyItem(cleanPublicUrl);

  const { data: item, error: insertError } = await supabase
    .from("wardrobe_items")
    .insert({
      user_id: userId,
      original_url: originalUrl,
      clean_url: cleanPublicUrl,
      category: classification.category,
      subcategory: classification.subcategory,
      color: classification.color,
      colors: classification.colors,
      material: classification.material,
      season: classification.season,
      occasion: classification.occasion,
      style_tags: classification.style_tags,
      ai_confidence: classification.confidence,
    })
    .select()
    .single();

  if (insertError) throw new Error(`Failed to save item: ${insertError.message}`);

  return { item, classification };
}

/**
 * POST /api/ai/classify
 *
 * Body: { originalUrl: string, storagePath: string }
 *
 * 1. Cheap Claude Vision count: how many distinct items are in this photo?
 * 2a. Single item (count <= 1) → unchanged pipeline: remove bg → classify → store.
 * 2b. Multi item (count >= 2) → SAM segments directly to transparent crops,
 *     then classify and store each crop as its own wardrobe_items row.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { originalUrl, storagePath, mode } = await request.json();
    if (!originalUrl) {
      return NextResponse.json({ error: "originalUrl required" }, { status: 400 });
    }

    // The user can declare up front whether the photo has one item or
    // several. A declared "single" skips the item-count vision call
    // entirely — the most common upload case pays zero detection tokens. A
    // declared "multi" still needs one call for the concrete SAM prompts,
    // but trusts the user's count over Claude's guess. Omitting mode falls
    // back to the original auto-detect behavior for backward compatibility.
    let itemCount: number;
    let prompts: string[] = [];
    if (mode === "single") {
      console.log("[classify] user declared single item; skipping detection call");
      itemCount = 1;
    } else {
      console.log("[classify] detecting item count for", originalUrl);
      const detection = await detectItems(originalUrl);
      itemCount = mode === "multi" ? Math.max(2, detection.count) : detection.count;
      prompts = detection.prompts;
      console.log("[classify] item count:", itemCount);
    }

    if (itemCount <= 1) {
      const cleanPath = storagePath.replace(/\.[^.]+$/, "_clean.png");
      const { item, classification } = await processOneItem(
        supabase,
        user.id,
        originalUrl,
        { imageUrl: originalUrl },
        cleanPath
      );
      return NextResponse.json({ item, classification, multiItem: false });
    }

    // Multi-item: SAM supplies the alpha mask, so these crops do not need the
    // separate background-removal model used by the single-item branch.
    console.log("[classify] multi-item branch, segmenting...");
    const crops = await segmentItems(originalUrl, prompts, itemCount);
    console.log(`[classify] got ${crops.length} segments`);
    const results = [];
    for (let i = 0; i < crops.length; i++) {
      console.log(`[classify] processing segment ${i + 1}/${crops.length}`);
      const cleanPath = storagePath.replace(/\.[^.]+$/, `_item${i}_clean.png`);
      try {
        const result = await processOneItem(
          supabase,
          user.id,
          originalUrl,
          { cleanBuffer: crops[i] },
          cleanPath
        );
        results.push(result);
        console.log(`[classify] segment ${i + 1} done:`, result.classification.category);
      } catch (err) {
        console.error(`Item ${i} pipeline error:`, err);
      }
    }

    if (results.length === 0) {
      return NextResponse.json({ error: "Failed to process any detected items" }, { status: 500 });
    }

    return NextResponse.json({ items: results, multiItem: true, count: results.length });
  } catch (err) {
    console.error("Pipeline error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Pipeline failed" },
      { status: 500 }
    );
  }
}
