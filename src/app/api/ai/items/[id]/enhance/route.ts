import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  enhanceWardrobeItem,
  ITEM_ENHANCEMENT_MODEL,
  type EnhancementReference,
} from "@/lib/ai/enhance-item";
import type { ItemCategory, ReferencePhotoKind } from "@/types/database";
import { analyzeReferencePhotos } from "@/lib/ai/reference-photos";

export const maxDuration = 240;

const LABEL_PATTERN = /(^|\b)(label|tag|care tag|wash tag|composition|fiber)(\b|$)|标签|洗标|吊牌|成分/i;
// Longer than the route's hard limit so a legitimate final upload cannot race
// with GET marking the same job failed.
const PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;
const ENHANCEMENT_COLUMNS = [
  "optimized_url",
  "optimized_storage_path",
  "enhancement_candidate_url",
  "enhancement_candidate_path",
  "enhancement_status",
  "enhancement_started_at",
  "enhancement_model",
  "enhanced_at",
  "kind",
  "analysis",
  "analyzed_at",
];

function isEnhancementSchemaError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; message?: string };
  if (candidate.code !== "42703" && candidate.code !== "PGRST204") return false;
  const message = candidate.message?.toLowerCase() ?? "";
  return ENHANCEMENT_COLUMNS.some((column) => message.includes(column));
}

function missingSchemaResponse() {
  return NextResponse.json(
    {
      error:
        'Photo enhancement needs its database migration first (run the "WARDROBE ITEM PHOTO ENHANCEMENT" block in supabase/schema.sql).',
      code: "ENHANCEMENT_SCHEMA_MISSING",
    },
    { status: 503 }
  );
}

function itemLookupErrorResponse(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { code?: string; message?: string };
  if (isEnhancementSchemaError(candidate)) return missingSchemaResponse();
  if (candidate.code === "PGRST116") {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }
  console.error("Item enhancement lookup failed:", error);
  return NextResponse.json(
    { error: candidate.message || "Could not load this item" },
    { status: 500 }
  );
}

function processingIsStale(startedAt: string | null) {
  if (!startedAt) return true;
  const timestamp = Date.parse(startedAt);
  return !Number.isFinite(timestamp) || Date.now() - timestamp > PROCESSING_TIMEOUT_MS;
}

function fallbackKind(angle: string | null): ReferencePhotoKind {
  if (angle && LABEL_PATTERN.test(angle)) return "label";
  return "other";
}

async function ownedItem(itemId: string, userId: string) {
  const supabase = await createServerSupabase();
  return supabase
    .from("wardrobe_items")
    .select(
      "id, user_id, original_url, clean_url, optimized_url, optimized_storage_path, enhancement_candidate_url, enhancement_candidate_path, enhancement_status, enhancement_started_at, category, subcategory, color, brand, material"
    )
    .eq("id", itemId)
    .eq("user_id", userId)
    .single();
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: item, error: itemError } = await ownedItem(id, user.id);
  const lookupError = itemLookupErrorResponse(itemError);
  if (lookupError) return lookupError;
  if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });
  if (item.enhancement_status === "processing" && processingIsStale(item.enhancement_started_at)) {
    await supabase
      .from("wardrobe_items")
      .update({ enhancement_status: "failed", enhancement_started_at: null })
      .eq("id", id)
      .eq("user_id", user.id);
    item.enhancement_status = "failed";
  }
  return NextResponse.json({
    status: item.enhancement_status,
    startedAt: item.enhancement_started_at,
    candidateUrl: item.enhancement_candidate_url,
    optimizedUrl: item.optimized_url,
  });
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const routeStartedAt = Date.now();
  const { id: itemId } = await params;
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: item, error: itemError } = await ownedItem(itemId, user.id);
  const lookupError = itemLookupErrorResponse(itemError);
  if (lookupError) return lookupError;
  if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });
  if (
    item.enhancement_status === "processing" &&
    !processingIsStale(item.enhancement_started_at)
  ) {
    return NextResponse.json({ error: "This item is already being enhanced" }, { status: 409 });
  }

  try {
    if (item.enhancement_candidate_path) {
      await supabase.storage.from("wardrobe").remove([item.enhancement_candidate_path]);
    }
    const { error: processingError } = await supabase
      .from("wardrobe_items")
      .update({
        enhancement_status: "processing",
        enhancement_started_at: new Date().toISOString(),
        enhancement_candidate_url: null,
        enhancement_candidate_path: null,
      })
      .eq("id", itemId)
      .eq("user_id", user.id);
    if (processingError) throw processingError;

    const { data: photos, error: photosError } = await supabase
      .from("wardrobe_item_photos")
      .select("id, url, angle, kind, analysis, analyzed_at, position")
      .eq("item_id", itemId)
      .eq("user_id", user.id)
      .order("position", { ascending: true });
    if (photosError) throw photosError;

    // Existing reference photos predate cached roles. Pay one small batched
    // vision call the first time only, then reuse kind/label metadata forever.
    const missingKinds = (photos ?? []).filter((photo) => !photo.kind);
    if (missingKinds.length > 0) {
      const analyses = await analyzeReferencePhotos(
        missingKinds.map((photo) => ({ id: photo.id, url: photo.url }))
      );
      const analyzedAt = new Date().toISOString();
      for (const analysis of analyses) {
        const photo = (photos ?? []).find((candidate) => candidate.id === analysis.id);
        if (photo) {
          photo.kind = analysis.kind;
          photo.analysis = {
            brand: analysis.brand,
            material: analysis.material,
            confidence: analysis.confidence,
          };
          photo.analyzed_at = analyzedAt;
        }
        await supabase
          .from("wardrobe_item_photos")
          .update({
            kind: analysis.kind,
            ...(photo?.angle ? {} : { angle: analysis.kind.replace("_", " ") }),
            analysis: {
              brand: analysis.brand,
              material: analysis.material,
              confidence: analysis.confidence,
            },
            analyzed_at: analyzedAt,
          })
          .eq("id", analysis.id)
          .eq("user_id", user.id);
      }

      const labels = analyses.filter(
        (analysis) => analysis.kind === "label" && analysis.confidence >= 0.75
      );
      const extractedBrand = labels.find((analysis) => analysis.brand)?.brand ?? null;
      const extractedMaterial = labels.find((analysis) => analysis.material)?.material ?? null;
      if (extractedBrand || extractedMaterial) {
        item.brand = extractedBrand || item.brand;
        item.material = extractedMaterial || item.material;
        await supabase
          .from("wardrobe_items")
          .update({
            ...(extractedBrand ? { brand: extractedBrand } : {}),
            ...(extractedMaterial ? { material: extractedMaterial } : {}),
            updated_at: analyzedAt,
          })
          .eq("id", itemId)
          .eq("user_id", user.id);
      }
    }

    const references: EnhancementReference[] = (photos ?? []).map((photo) => ({
      url: photo.url,
      kind: (photo.kind as ReferencePhotoKind | null) ?? fallbackKind(photo.angle),
    }));
    console.info(
      `[item-enhance:${itemId}] References ready: ${references.length} total, ${references.filter((reference) => reference.kind !== "label").slice(0, 4).length} visual`
    );
    const image = await enhanceWardrobeItem(
      {
        original_url: item.original_url,
        clean_url: item.clean_url,
        category: item.category as ItemCategory,
        subcategory: item.subcategory,
        color: item.color,
        brand: item.brand,
        material: item.material,
      },
      references
    );

    const storagePath = `${user.id}/enhanced/${itemId}-${Date.now()}.png`;
    const blob = new Blob([new Uint8Array(image)], { type: "image/png" });
    const { error: uploadError } = await supabase.storage
      .from("wardrobe")
      .upload(storagePath, blob, { contentType: "image/png", upsert: false });
    if (uploadError) throw uploadError;
    const {
      data: { publicUrl },
    } = supabase.storage.from("wardrobe").getPublicUrl(storagePath);

    const { error: readyError } = await supabase
      .from("wardrobe_items")
      .update({
        enhancement_candidate_url: publicUrl,
        enhancement_candidate_path: storagePath,
        enhancement_status: "ready",
        enhancement_started_at: null,
        enhancement_model: ITEM_ENHANCEMENT_MODEL,
      })
      .eq("id", itemId)
      .eq("user_id", user.id);
    if (readyError) {
      await supabase.storage.from("wardrobe").remove([storagePath]);
      throw readyError;
    }

    console.info(
      `[item-enhance:${itemId}] Candidate ready in ${Math.round((Date.now() - routeStartedAt) / 1000)}s`
    );

    return NextResponse.json({
      status: "ready",
      candidateUrl: publicUrl,
      referenceCount: references.filter((reference) => reference.kind !== "label").slice(0, 4).length,
      model: ITEM_ENHANCEMENT_MODEL,
    });
  } catch (error) {
    await supabase
      .from("wardrobe_items")
      .update({ enhancement_status: "failed", enhancement_started_at: null })
      .eq("id", itemId)
      .eq("user_id", user.id);
    console.error(
      `[item-enhance:${itemId}] Failed after ${Math.round((Date.now() - routeStartedAt) / 1000)}s:`,
      error
    );
    if (isEnhancementSchemaError(error)) return missingSchemaResponse();
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Enhancement failed" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: itemId } = await params;
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: item, error: itemError } = await ownedItem(itemId, user.id);
  const lookupError = itemLookupErrorResponse(itemError);
  if (lookupError) return lookupError;
  if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });
  if (!item.enhancement_candidate_url || !item.enhancement_candidate_path) {
    return NextResponse.json({ error: "No enhancement candidate to accept" }, { status: 409 });
  }

  const acceptedAt = new Date().toISOString();
  const { error } = await supabase
    .from("wardrobe_items")
    .update({
      optimized_url: item.enhancement_candidate_url,
      optimized_storage_path: item.enhancement_candidate_path,
      enhancement_candidate_url: null,
      enhancement_candidate_path: null,
      enhancement_status: "complete",
      enhancement_started_at: null,
      enhanced_at: acceptedAt,
      updated_at: acceptedAt,
    })
    .eq("id", itemId)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (
    item.optimized_storage_path &&
    item.optimized_storage_path !== item.enhancement_candidate_path
  ) {
    await supabase.storage.from("wardrobe").remove([item.optimized_storage_path]);
  }
  return NextResponse.json({ optimizedUrl: item.enhancement_candidate_url });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: itemId } = await params;
  const target = request.nextUrl.searchParams.get("target") === "candidate" ? "candidate" : "optimized";
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: item, error: itemError } = await ownedItem(itemId, user.id);
  const lookupError = itemLookupErrorResponse(itemError);
  if (lookupError) return lookupError;
  if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });

  const path =
    target === "candidate" ? item.enhancement_candidate_path : item.optimized_storage_path;
  const update =
    target === "candidate"
      ? {
          enhancement_candidate_url: null,
          enhancement_candidate_path: null,
          enhancement_status: item.optimized_url ? "complete" : "idle",
          enhancement_started_at: null,
        }
      : {
          optimized_url: null,
          optimized_storage_path: null,
          enhancement_status: item.enhancement_candidate_url ? "ready" : "idle",
          enhancement_started_at: null,
          enhanced_at: null,
          updated_at: new Date().toISOString(),
        };
  const { error } = await supabase
    .from("wardrobe_items")
    .update(update)
    .eq("id", itemId)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (path) await supabase.storage.from("wardrobe").remove([path]);

  return NextResponse.json({
    optimizedUrl: target === "optimized" ? null : item.optimized_url,
    displayUrl: target === "optimized" ? item.clean_url || item.original_url : undefined,
  });
}
