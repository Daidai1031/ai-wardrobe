import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  composeGarmentReference,
  downloadTryOnResult,
  generateVirtualTryOn,
} from "@/lib/ai/virtual-try-on";
import { TRY_ON_BUCKET, VIRTUAL_TRY_ON_MODEL } from "@/lib/try-on/constants";
import {
  eligibleTryOnGarments,
  tryOnFingerprint,
  virtualTryOnPrompt,
  type TryOnGarment,
} from "@/lib/try-on/input";

export const maxDuration = 240;

const PERSON_URL_SECONDS = 15 * 60;
const RESULT_URL_SECONDS = 60 * 60;
const PROCESSING_STALE_MS = 5 * 60 * 1000;

interface OutfitJoin {
  item_id: string;
  position: number | null;
  wardrobe_items: TryOnGarment | null;
}

interface OutfitWithItems {
  id: string;
  name: string | null;
  user_id: string;
  outfit_items: OutfitJoin[];
}

interface TryOnRow {
  id: string;
  status: "processing" | "complete" | "failed";
  result_path: string | null;
  updated_at: string;
  created_at: string;
}

function isSchemaMissing(error: { code?: string; message?: string } | null | undefined) {
  return error?.code === "42703" || error?.code === "PGRST204" || error?.code === "PGRST205";
}

async function signedResultUrl(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  path: string
) {
  const { data, error } = await supabase.storage
    .from(TRY_ON_BUCKET)
    .createSignedUrl(path, RESULT_URL_SECONDS);
  if (error || !data?.signedUrl) throw new Error("Could not open the saved try-on result");
  return data.signedUrl;
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { outfitId?: string } | null;
  if (!body?.outfitId) {
    return NextResponse.json({ error: "Choose a saved outfit to try on" }, { status: 400 });
  }

  const [{ data: profile, error: profileError }, { data: outfitData, error: outfitError }] =
    await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase
        .from("outfits")
        .select(
          "id,name,user_id,outfit_items(item_id,position,wardrobe_items(id,display_name,category,subcategory,color,optimized_url,clean_url,original_url))"
        )
        .eq("id", body.outfitId)
        .eq("user_id", user.id)
        .single(),
    ]);

  if (profileError || !profile) {
    return NextResponse.json({ error: "Could not load your profile" }, { status: 500 });
  }
  if (outfitError || !outfitData) {
    return NextResponse.json({ error: "That saved outfit could not be found" }, { status: 404 });
  }

  const photoPath = (profile as { full_body_photo_path?: string | null }).full_body_photo_path;
  if (!photoPath) {
    return NextResponse.json(
      { error: "Add a full-body photo in User before trying on an outfit", code: "PHOTO_REQUIRED" },
      { status: 400 }
    );
  }

  const outfit = outfitData as unknown as OutfitWithItems;
  const garments = [...(outfit.outfit_items || [])]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((join) => join.wardrobe_items)
    .filter((item): item is TryOnGarment => Boolean(item));
  if (eligibleTryOnGarments(garments).length === 0) {
    return NextResponse.json(
      { error: "This look needs a top, bottom, dress, outer layer, or shoes for virtual try-on" },
      { status: 400 }
    );
  }

  const fingerprint = tryOnFingerprint(photoPath, garments);
  const prompt = virtualTryOnPrompt(garments);
  const { data: cachedData, error: cacheError } = await supabase
    .from("virtual_try_ons")
    .select("id,status,result_path,updated_at,created_at")
    .eq("user_id", user.id)
    .eq("outfit_id", outfit.id)
    .eq("person_photo_path", photoPath)
    .eq("item_fingerprint", fingerprint)
    .maybeSingle();

  if (cacheError) {
    return NextResponse.json(
      {
        error: isSchemaMissing(cacheError)
          ? "Virtual try-on is not set up yet. Apply schema section 27."
          : "Could not check the try-on cache",
        code: isSchemaMissing(cacheError) ? "TRY_ON_SCHEMA_MISSING" : undefined,
      },
      { status: isSchemaMissing(cacheError) ? 503 : 500 }
    );
  }

  const cached = cachedData as TryOnRow | null;
  if (cached?.status === "complete" && cached.result_path) {
    return NextResponse.json({
      id: cached.id,
      outfitId: outfit.id,
      resultUrl: await signedResultUrl(supabase, cached.result_path),
      createdAt: cached.created_at,
      cached: true,
    });
  }

  if (
    cached?.status === "processing" &&
    Date.now() - new Date(cached.updated_at).getTime() < PROCESSING_STALE_MS
  ) {
    return NextResponse.json(
      { error: "This outfit is already being rendered. Try again in a moment.", code: "IN_PROGRESS" },
      { status: 409 }
    );
  }

  let tryOnId = cached?.id;
  if (tryOnId) {
    const { error } = await supabase
      .from("virtual_try_ons")
      .update({ status: "processing", error: null, updated_at: new Date().toISOString() })
      .eq("id", tryOnId)
      .eq("user_id", user.id);
    if (error) return NextResponse.json({ error: "Could not restart this try-on" }, { status: 500 });
  } else {
    const { data, error } = await supabase
      .from("virtual_try_ons")
      .insert({
        user_id: user.id,
        outfit_id: outfit.id,
        person_photo_path: photoPath,
        item_fingerprint: fingerprint,
        model: VIRTUAL_TRY_ON_MODEL,
        prompt,
        status: "processing",
      })
      .select("id")
      .single();
    if (error || !data) {
      return NextResponse.json(
        {
          error:
            error?.code === "23505"
              ? "This outfit is already being rendered. Try again in a moment."
              : "Could not start virtual try-on",
        },
        { status: error?.code === "23505" ? 409 : 500 }
      );
    }
    tryOnId = data.id;
  }

  try {
    const { data: personSigned, error: personSignedError } = await supabase.storage
      .from(TRY_ON_BUCKET)
      .createSignedUrl(photoPath, PERSON_URL_SECONDS);
    if (personSignedError || !personSigned?.signedUrl) {
      throw new Error("Could not open your full-body photo");
    }

    const garmentReference = await composeGarmentReference(garments);
    const generated = await generateVirtualTryOn(personSigned.signedUrl, garmentReference, prompt);
    const resultBuffer = await downloadTryOnResult(generated.imageUrl);
    const resultPath = `${user.id}/results/${outfit.id}-${fingerprint.slice(0, 16)}-${Date.now()}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from(TRY_ON_BUCKET)
      .upload(resultPath, resultBuffer, { contentType: "image/jpeg", upsert: false });
    if (uploadError) throw new Error("Could not save the generated try-on image");

    const { error: updateError } = await supabase
      .from("virtual_try_ons")
      .update({
        result_path: resultPath,
        seed: generated.seed,
        status: "complete",
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", tryOnId)
      .eq("user_id", user.id);
    if (updateError) {
      await supabase.storage.from(TRY_ON_BUCKET).remove([resultPath]);
      throw new Error("Could not cache the generated try-on image");
    }

    return NextResponse.json({
      id: tryOnId,
      outfitId: outfit.id,
      resultUrl: await signedResultUrl(supabase, resultPath),
      createdAt: new Date().toISOString(),
      cached: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Virtual try-on failed";
    await supabase
      .from("virtual_try_ons")
      .update({ status: "failed", error: message.slice(0, 500), updated_at: new Date().toISOString() })
      .eq("id", tryOnId)
      .eq("user_id", user.id);
    console.error("Virtual try-on failed:", error);
    return NextResponse.json(
      { error: `${message}. Try again; completed renders are cached automatically.` },
      { status: 502 }
    );
  }
}
