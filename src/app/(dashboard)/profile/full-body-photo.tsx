"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, Camera, ImagePlus, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { convertIfNeeded } from "@/lib/images/convert-heic";

export function FullBodyPhoto({
  initialPhotoUrl,
  updatedAt,
}: {
  initialPhotoUrl: string | null;
  updatedAt: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [photoUrl, setPhotoUrl] = useState(initialPhotoUrl);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected || uploading) return;
    if (selected.size > 15 * 1024 * 1024) {
      setError("The photo must be smaller than 15 MB.");
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const file = await convertIfNeeded(selected);
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/profile/full-body-photo", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !data.url) throw new Error(data.error || "Photo upload failed");
      setPhotoUrl(data.url);
      toast.success("Full-body photo saved");
      router.refresh();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Photo upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function removePhoto() {
    if (removing || !photoUrl) return;
    if (!window.confirm("Remove your full-body photo and all saved virtual try-on images?")) return;

    setRemoving(true);
    setError(null);
    try {
      const response = await fetch("/api/profile/full-body-photo", { method: "DELETE" });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Could not remove the photo");
      }
      setPhotoUrl(null);
      toast.success("Full-body photo removed");
      router.refresh();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Could not remove the photo");
    } finally {
      setRemoving(false);
    }
  }

  const busy = uploading || removing;

  return (
    <section id="full-body-photo" className="max-w-2xl scroll-mt-6 border-t border-surface-200 pt-8">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700">
          <Camera size={18} />
        </div>
        <div>
          <h2 className="text-base font-semibold text-surface-900">Virtual try-on photo</h2>
          <p className="mt-1 max-w-xl text-sm leading-6 text-surface-500">
            Add one clear, front-facing full-body photo. We reuse it when you preview saved Looks on
            your body.
          </p>
        </div>
      </div>

      <div className="grid gap-4 rounded-2xl border border-surface-200 bg-white p-4 sm:grid-cols-[180px_1fr] sm:p-5">
        <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-surface-100">
          {photoUrl ? (
            <Image
              src={photoUrl}
              alt="Your full-body virtual try-on photo"
              fill
              className="object-cover"
              sizes="180px"
              unoptimized
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-5 text-center text-surface-400">
              <Camera size={28} strokeWidth={1.5} />
              <span className="text-xs leading-5">Your photo will appear here</span>
            </div>
          )}
          {uploading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/85 text-surface-700">
              <Loader2 size={24} className="animate-spin" />
              <span className="text-xs font-medium">Preparing photo…</span>
            </div>
          )}
        </div>

        <div className="flex flex-col justify-between gap-5">
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium text-surface-800">For the most natural result</p>
              <ul className="mt-2 space-y-1 text-xs leading-5 text-surface-500">
                <li>• Stand straight with your full body, hands, and shoes visible.</li>
                <li>• Use even light and a simple background.</li>
                <li>• Wear close-fitting clothes without heavy layers.</li>
              </ul>
            </div>
            <p className="flex items-start gap-2 rounded-lg bg-surface-50 p-3 text-xs leading-5 text-surface-500">
              <ShieldCheck size={15} className="mt-0.5 shrink-0 text-surface-600" />
              Stored privately. A short-lived signed link is sent to fal.ai only when you generate a
              try-on.
            </p>
            {error && (
              <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-700">
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
                {error}
              </p>
            )}
            {photoUrl && updatedAt && (
              <p className="text-[11px] text-surface-400">
                Updated {new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(updatedAt))}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={inputRef}
              id="full-body-photo-input"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
              onChange={handleFile}
              disabled={busy}
              className="sr-only"
            />
            <label
              htmlFor="full-body-photo-input"
              aria-disabled={busy}
              className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg bg-surface-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-surface-800 active:scale-[0.98] aria-disabled:pointer-events-none aria-disabled:bg-surface-400"
            >
              {uploading ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
              {uploading ? "Uploading…" : photoUrl ? "Replace photo" : "Upload photo"}
            </label>
            {photoUrl && (
              <button
                type="button"
                onClick={removePhoto}
                disabled={busy}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:text-surface-400"
              >
                {removing ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                {removing ? "Removing…" : "Remove"}
              </button>
            )}
            {photoUrl && (
              <Link
                href="/outfits?tab=tryon"
                className="ml-auto inline-flex min-h-11 items-center gap-1.5 px-2 py-2.5 text-sm font-medium text-brand-700 transition-colors hover:text-brand-800 hover:underline"
              >
                Try an outfit <ArrowRight size={15} />
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
