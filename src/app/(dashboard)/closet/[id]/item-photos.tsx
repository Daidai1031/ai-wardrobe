"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { convertIfNeeded } from "@/lib/images/convert-heic";
import type { WardrobeItem, WardrobeItemPhoto } from "@/types/database";
import { wardrobeItemName } from "@/lib/wardrobe/item-label";
import { Heart, Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Enough to cover back / side / detail / label / worn-on shots without turning
 * the item page into an album. The real limit is the strip staying scannable.
 */
const MAX_EXTRA_PHOTOS = 8;

/** The main background-removed image, as one entry in the same strip. */
const PRIMARY = "primary" as const;

export function ItemPhotos({
  item,
  photos,
  onToggleFavorite,
}: {
  item: WardrobeItem;
  photos: WardrobeItemPhoto[];
  onToggleFavorite: () => void;
}) {
  const router = useRouter();
  const supabase = createClient();
  const fileInput = useRef<HTMLInputElement>(null);

  // Which photo the big frame shows. Extra angles are for looking at, so this
  // is view state only — it never changes which image styling uses.
  const [selectedId, setSelectedId] = useState<string>(PRIMARY);
  const [uploading, setUploading] = useState(false);
  const [labelDraft, setLabelDraft] = useState<string | null>(null);

  const primaryUrl = item.clean_url || item.original_url;
  const selected = photos.find((p) => p.id === selectedId) ?? null;
  const atLimit = photos.length >= MAX_EXTRA_PHOTOS;

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    const room = MAX_EXTRA_PHOTOS - photos.length;
    const picked = Array.from(files).slice(0, room);
    if (picked.length < files.length) {
      toast.error(`Only ${room} more photo${room === 1 ? "" : "s"} can be added to this item`);
    }
    if (picked.length === 0) return;

    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not logged in");

      let position = photos.reduce((max, p) => Math.max(max, p.position), -1) + 1;
      let added = 0;

      for (const original of picked) {
        try {
          const file = await convertIfNeeded(original);
          const ext = file.name.split(".").pop() || "jpg";
          const storagePath = `${user.id}/${item.id}-angle-${Date.now()}-${position}.${ext}`;

          const { error: uploadError } = await supabase.storage
            .from("wardrobe")
            .upload(storagePath, file, { contentType: file.type });
          if (uploadError) throw uploadError;

          const { data: { publicUrl } } = supabase.storage
            .from("wardrobe")
            .getPublicUrl(storagePath);

          const { error: insertError } = await supabase
            .from("wardrobe_item_photos")
            .insert({
              item_id: item.id,
              user_id: user.id,
              url: publicUrl,
              storage_path: storagePath,
              position,
            });
          // Don't leave the uploaded object behind if the row it belongs to
          // never lands — it would be unreachable from the UI forever.
          if (insertError) {
            await supabase.storage.from("wardrobe").remove([storagePath]);
            throw insertError;
          }

          position += 1;
          added += 1;
        } catch (err) {
          console.error("Extra photo upload failed:", err);
          toast.error(`Couldn't add ${original.name}`);
        }
      }

      if (added > 0) {
        toast.success(added === 1 ? "Photo added" : `${added} photos added`);
        router.refresh();
      }
    } catch (err) {
      console.error("Extra photo upload failed:", err);
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function handleDelete(photo: WardrobeItemPhoto) {
    if (!confirm("Remove this photo?")) return;

    const { error } = await supabase
      .from("wardrobe_item_photos")
      .delete()
      .eq("id", photo.id);

    if (error) {
      toast.error("Failed to remove photo");
      return;
    }
    // Row first, object second: an orphaned object is invisible clutter, but a
    // row pointing at a deleted object renders as a broken image.
    if (photo.storage_path) {
      await supabase.storage.from("wardrobe").remove([photo.storage_path]);
    }

    if (selectedId === photo.id) setSelectedId(PRIMARY);
    toast.success("Photo removed");
    router.refresh();
  }

  async function saveLabel(photo: WardrobeItemPhoto, value: string) {
    setLabelDraft(null);
    const angle = value.trim() || null;
    if (angle === photo.angle) return;

    const { error } = await supabase
      .from("wardrobe_item_photos")
      .update({ angle })
      .eq("id", photo.id);

    if (error) toast.error("Failed to save label");
    else router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="relative aspect-square bg-white rounded-2xl border border-surface-200 overflow-hidden">
        <Image
          src={selected ? selected.url : primaryUrl}
          alt={
            selected
              ? `${wardrobeItemName(item)} — ${selected.angle || "additional angle"}`
              : wardrobeItemName(item)
          }
          fill
          className="object-contain p-4"
          unoptimized
        />
        <button
          onClick={onToggleFavorite}
          className="absolute top-3 right-3 p-2 rounded-full bg-white/80 backdrop-blur-sm"
        >
          <Heart
            size={18}
            className={cn(item.favorite ? "fill-red-500 text-red-500" : "text-surface-400")}
          />
        </button>
        {selected && (
          <span className="absolute top-3 left-3 px-2 py-1 rounded-md bg-surface-900/70 text-white text-[11px]">
            Reference photo
          </span>
        )}
      </div>

      {/* Thumbnail strip: the styling image first, then the extra angles. */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setSelectedId(PRIMARY)}
          title="Used for outfits"
          className={cn(
            "relative w-16 h-16 rounded-lg overflow-hidden border bg-white transition-colors",
            selectedId === PRIMARY
              ? "border-surface-900 ring-1 ring-surface-900"
              : "border-surface-200 hover:border-surface-400"
          )}
        >
          <Image src={primaryUrl} alt="Main photo" fill className="object-contain p-1" unoptimized />
        </button>

        {photos.map((photo) => (
          <div key={photo.id} className="relative group">
            <button
              onClick={() => setSelectedId(photo.id)}
              title={photo.angle || "Additional angle"}
              className={cn(
                "relative w-16 h-16 rounded-lg overflow-hidden border bg-white transition-colors",
                selectedId === photo.id
                  ? "border-surface-900 ring-1 ring-surface-900"
                  : "border-surface-200 hover:border-surface-400"
              )}
            >
              <Image
                src={photo.url}
                alt={photo.angle || "Additional angle"}
                fill
                className="object-cover"
                unoptimized
              />
            </button>
            <button
              onClick={() => handleDelete(photo)}
              aria-label="Remove photo"
              className="absolute -top-1.5 -right-1.5 p-1 rounded-full bg-white border border-surface-200 text-surface-400 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-red-600 transition-opacity"
            >
              <Trash2 size={11} />
            </button>
          </div>
        ))}

        <button
          onClick={() => fileInput.current?.click()}
          disabled={uploading || atLimit}
          title={atLimit ? `Up to ${MAX_EXTRA_PHOTOS} extra photos` : "Add another angle"}
          className="w-16 h-16 rounded-lg border border-dashed border-surface-300 text-surface-400 flex flex-col items-center justify-center gap-0.5 hover:border-surface-400 hover:text-surface-600 disabled:opacity-40 disabled:hover:border-surface-300"
        >
          {uploading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <>
              <Plus size={16} />
              <span className="text-[10px] leading-none">Angle</span>
            </>
          )}
        </button>

        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {/* Label for whichever extra angle is open. */}
      {selected && (
        <input
          value={labelDraft ?? selected.angle ?? ""}
          onChange={(e) => setLabelDraft(e.target.value)}
          onBlur={(e) => saveLabel(selected, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          placeholder="Label this angle — back, side, detail, care tag…"
          className="w-full px-3 py-1.5 rounded-lg border border-surface-200 text-xs"
        />
      )}

      <p className="text-xs text-surface-400 text-center">
        Extra photos are for reference only — outfits and AI styling always use the
        main background-removed photo.
      </p>

      {item.original_url !== item.clean_url && item.clean_url && (
        <p className="text-xs text-surface-400 text-center">
          Background removed by AI ·{" "}
          <button onClick={() => window.open(item.original_url)} className="underline">
            View original
          </button>
        </p>
      )}
      {item.ai_confidence && (
        <p className="text-xs text-surface-400 text-center">
          AI confidence: {Math.round(item.ai_confidence * 100)}%
        </p>
      )}
    </div>
  );
}
