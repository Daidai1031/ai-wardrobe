import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { analyzeReferencePhotos } from "@/lib/ai/reference-photos";

export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: itemId } = await params;
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await request.json()) as { photoIds?: unknown };
    const photoIds = Array.isArray(body.photoIds)
      ? body.photoIds.filter((value): value is string => typeof value === "string").slice(0, 8)
      : [];
    if (photoIds.length === 0) {
      return NextResponse.json({ error: "photoIds required" }, { status: 400 });
    }

    const [{ data: item }, { data: photos, error: photosError }] = await Promise.all([
      supabase
        .from("wardrobe_items")
        .select("id, brand, material")
        .eq("id", itemId)
        .eq("user_id", user.id)
        .single(),
      supabase
        .from("wardrobe_item_photos")
        .select("id, url, angle")
        .eq("item_id", itemId)
        .eq("user_id", user.id)
        .in("id", photoIds),
    ]);
    if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });
    if (photosError) throw photosError;

    const analyses = await analyzeReferencePhotos(photos ?? []);
    const analyzedAt = new Date().toISOString();
    const photoById = new Map((photos ?? []).map((photo) => [photo.id, photo]));
    const photoUpdates = await Promise.all(
      analyses.map((analysis) =>
        supabase
          .from("wardrobe_item_photos")
          .update({
            kind: analysis.kind,
            ...(photoById.get(analysis.id)?.angle
              ? {}
              : { angle: analysis.kind.replace("_", " ") }),
            analysis: {
              brand: analysis.brand,
              material: analysis.material,
              confidence: analysis.confidence,
            },
            analyzed_at: analyzedAt,
          })
          .eq("id", analysis.id)
          .eq("user_id", user.id)
      )
    );
    const photoUpdateError = photoUpdates.find((result) => result.error)?.error;
    if (photoUpdateError) throw photoUpdateError;

    // A readable tag is stronger evidence than the upload-time visual guess.
    // Keep a modest confidence floor so an uncertain OCR read does not silently
    // overwrite fields the user can edit themselves.
    const labelAnalyses = analyses.filter(
      (analysis) => analysis.kind === "label" && analysis.confidence >= 0.75
    );
    const brand = labelAnalyses.find((analysis) => analysis.brand)?.brand ?? null;
    const material = labelAnalyses.find((analysis) => analysis.material)?.material ?? null;
    if (brand || material) {
      const { error: updateError } = await supabase
        .from("wardrobe_items")
        .update({
          ...(brand ? { brand } : {}),
          ...(material ? { material } : {}),
          updated_at: analyzedAt,
        })
        .eq("id", itemId)
        .eq("user_id", user.id);
      if (updateError) throw updateError;
    }

    return NextResponse.json({ analyses, brand, material });
  } catch (error) {
    console.error("Reference photo analysis failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Reference analysis failed" },
      { status: 500 }
    );
  }
}
