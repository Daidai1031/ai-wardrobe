import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { removeBackground } from "@/lib/ai/remove-bg";
import { classifyItem } from "@/lib/ai/classify";

/**
 * POST /api/ai/classify
 *
 * Full pipeline for a single clothing upload:
 * 1. Receive image URL (already uploaded to Supabase Storage)
 * 2. Remove background via fal.ai
 * 3. Classify via Claude Vision
 * 4. Store clean image in Supabase Storage
 * 5. Create wardrobe_item record
 *
 * Body: { originalUrl: string, storagePath: string }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { originalUrl, storagePath } = await request.json();
    if (!originalUrl) {
      return NextResponse.json({ error: "originalUrl required" }, { status: 400 });
    }

    // 1. Remove background
    const { cleanImageUrl } = await removeBackground(originalUrl);

    // 2. Upload clean image to Supabase Storage
    const cleanResponse = await fetch(cleanImageUrl);
    const cleanBlob = await cleanResponse.blob();
    const cleanPath = storagePath.replace(/\.[^.]+$/, "_clean.png");

    const { error: uploadError } = await supabase.storage
      .from("wardrobe")
      .upload(cleanPath, cleanBlob, {
        contentType: "image/png",
        upsert: true,
      });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      return NextResponse.json({ error: "Failed to store clean image" }, { status: 500 });
    }

    const { data: { publicUrl: cleanPublicUrl } } = supabase.storage
      .from("wardrobe")
      .getPublicUrl(cleanPath);

    // 3. Classify with Claude Vision (use the clean image for better accuracy)
    const classification = await classifyItem(cleanPublicUrl);

    // 4. Insert wardrobe item
    const { data: item, error: insertError } = await supabase
      .from("wardrobe_items")
      .insert({
        user_id: user.id,
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

    if (insertError) {
      console.error("Insert error:", insertError);
      return NextResponse.json({ error: "Failed to save item" }, { status: 500 });
    }

    return NextResponse.json({
      item,
      classification,
    });
  } catch (err) {
    console.error("Pipeline error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Pipeline failed" },
      { status: 500 }
    );
  }
}
