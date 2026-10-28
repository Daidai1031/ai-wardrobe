import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { createServerSupabase } from "@/lib/supabase/server";
import { TRY_ON_BUCKET } from "@/lib/try-on/constants";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const SIGNED_URL_SECONDS = 60 * 60;

function schemaMissing(error: { code?: string; message?: string } | null | undefined) {
  return error?.code === "42703" || error?.code === "PGRST204" || error?.code === "PGRST205";
}

/** A replaced or removed photo makes every saved render obsolete. */
async function deleteCachedTryOns(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  userId: string
) {
  const { data: tryOnRows, error: tryOnReadError } = await supabase
    .from("virtual_try_ons")
    .select("result_path")
    .eq("user_id", userId);
  if (tryOnReadError) {
    console.warn("Could not list virtual try-on rows:", tryOnReadError.message);
    return;
  }
  const resultPaths = (tryOnRows || [])
    .map((row) => (row as { result_path: string | null }).result_path)
    .filter((resultPath): resultPath is string => Boolean(resultPath));
  const { error: deleteRowsError } = await supabase
    .from("virtual_try_ons")
    .delete()
    .eq("user_id", userId);
  if (deleteRowsError) {
    console.warn("Could not remove virtual try-on rows:", deleteRowsError.message);
    return;
  }
  if (resultPaths.length > 0) {
    const { error } = await supabase.storage.from(TRY_ON_BUCKET).remove(resultPaths);
    if (error) console.warn("Could not remove virtual try-on image objects:", error.message);
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose a full-body photo to upload" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Use a JPG, PNG, WebP, or HEIC photo" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "The photo must be smaller than 15 MB" }, { status: 400 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  if (profileError || !profile) {
    return NextResponse.json({ error: "Could not load your profile" }, { status: 500 });
  }

  let normalized: Buffer;
  try {
    normalized = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize(864, 1152, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90, chromaSubsampling: "4:4:4" })
      .toBuffer();
  } catch {
    return NextResponse.json(
      { error: "We couldn't read that photo. Try converting it to JPG first." },
      { status: 400 }
    );
  }

  const storagePath = `${user.id}/profile/full-body-${Date.now()}.jpg`;
  const { error: uploadError } = await supabase.storage
    .from(TRY_ON_BUCKET)
    .upload(storagePath, normalized, { contentType: "image/jpeg", upsert: false });
  if (uploadError) {
    return NextResponse.json(
      {
        error: uploadError.message.includes("Bucket")
          ? "Virtual try-on storage is not set up yet. Apply schema section 27."
          : uploadError.message,
        code: "TRY_ON_SCHEMA_MISSING",
      },
      { status: 503 }
    );
  }

  const previousPath = (profile as { full_body_photo_path?: string | null }).full_body_photo_path;
  const { error: updateError } = await supabase
    .from("profiles")
    .update({
      full_body_photo_path: storagePath,
      full_body_photo_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (updateError) {
    await supabase.storage.from(TRY_ON_BUCKET).remove([storagePath]);
    return NextResponse.json(
      {
        error: schemaMissing(updateError)
          ? "Virtual try-on is not set up yet. Apply schema section 27."
          : "Could not save the photo to your profile",
        code: schemaMissing(updateError) ? "TRY_ON_SCHEMA_MISSING" : undefined,
      },
      { status: schemaMissing(updateError) ? 503 : 500 }
    );
  }

  if (previousPath && previousPath !== storagePath) {
    const { error } = await supabase.storage.from(TRY_ON_BUCKET).remove([previousPath]);
    if (error) console.warn("Could not remove replaced full-body photo:", error.message);
    await deleteCachedTryOns(supabase, user.id);
  }

  const { data: signed, error: signedError } = await supabase.storage
    .from(TRY_ON_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_SECONDS);
  if (signedError || !signed?.signedUrl) {
    return NextResponse.json({ error: "Photo saved, but its preview could not be opened" }, { status: 500 });
  }

  return NextResponse.json({ path: storagePath, url: signed.signedUrl });
}

export async function DELETE() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  if (profileError || !profile) {
    return NextResponse.json({ error: "Could not load your profile" }, { status: 500 });
  }

  const path = (profile as { full_body_photo_path?: string | null }).full_body_photo_path;
  const { error: updateError } = await supabase
    .from("profiles")
    .update({
      full_body_photo_path: null,
      full_body_photo_updated_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);
  if (updateError) {
    return NextResponse.json({ error: "Could not remove the photo from your profile" }, { status: 500 });
  }

  if (path) {
    const { error } = await supabase.storage.from(TRY_ON_BUCKET).remove([path]);
    if (error) console.warn("Could not remove full-body photo object:", error.message);
  }

  await deleteCachedTryOns(supabase, user.id);

  return new NextResponse(null, { status: 204 });
}
