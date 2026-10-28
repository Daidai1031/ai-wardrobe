"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertCircle, ArrowRight, Camera, Check, Loader2, Shirt, Sparkles } from "lucide-react";
import { defaultLayoutFor, imageUrl, itemName } from "@/components/outfit/outfit-canvas";
import { cn } from "@/lib/utils";
import type { SavedOutfit } from "./outfits-view";
import { VIRTUAL_TRY_ON_CATEGORIES } from "@/lib/try-on/constants";

export interface InitialTryOnResult {
  id: string;
  outfitId: string;
  resultUrl: string;
  createdAt: string;
}

interface VirtualTryOnProps {
  outfits: SavedOutfit[];
  profilePhotoUrl: string | null;
  initialResults: InitialTryOnResult[];
}

const SUPPORTED_CATEGORIES = new Set<string>(VIRTUAL_TRY_ON_CATEGORIES);

function wearablePieces(outfit: SavedOutfit) {
  return [...outfit.outfit_items]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((join) => join.wardrobe_items)
    .filter((item): item is NonNullable<typeof item> =>
      Boolean(item && SUPPORTED_CATEGORIES.has(item.category))
    )
    .slice(0, 6);
}

function usableItemCount(outfit: SavedOutfit) {
  return wearablePieces(outfit).length;
}

function OutfitMiniature({ outfit }: { outfit: SavedOutfit }) {
  const joins = [...outfit.outfit_items]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .filter((join) => Boolean(join.wardrobe_items));

  return (
    <div className="relative aspect-square overflow-hidden rounded-lg bg-surface-100">
      {joins.map((join, index) => {
        const item = join.wardrobe_items;
        if (!item) return null;
        const layout =
          join.x != null && join.y != null && join.width != null
            ? { x: join.x, y: join.y, width: join.width }
            : defaultLayoutFor(index);
        return (
          <div
            key={item.id}
            className="absolute"
            style={{
              left: `${layout.x}%`,
              top: `${layout.y}%`,
              width: `${layout.width}%`,
              aspectRatio: "1 / 1",
              zIndex: index + 1,
            }}
          >
            <Image
              src={imageUrl(item)}
              alt={itemName(item)}
              fill
              className="object-contain"
              sizes="130px"
              unoptimized
            />
          </div>
        );
      })}
      {joins.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-surface-300">
          <Shirt size={28} strokeWidth={1.4} />
        </div>
      )}
    </div>
  );
}

export function VirtualTryOn({ outfits, profilePhotoUrl, initialResults }: VirtualTryOnProps) {
  const eligibleOutfits = useMemo(
    () => outfits.filter((outfit) => usableItemCount(outfit) > 0),
    [outfits]
  );
  const initialByOutfit = useMemo(
    () => {
      const byOutfit = new Map<string, InitialTryOnResult>();
      initialResults.forEach((result) => {
        if (!byOutfit.has(result.outfitId)) byOutfit.set(result.outfitId, result);
      });
      return byOutfit;
    },
    [initialResults]
  );
  const [selectedOutfitId, setSelectedOutfitId] = useState<string | null>(
    initialResults[0]?.outfitId ?? null
  );
  const [results, setResults] = useState(initialByOutfit);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedOutfit = eligibleOutfits.find((outfit) => outfit.id === selectedOutfitId) ?? null;
  const selectedResult = selectedOutfitId ? results.get(selectedOutfitId) : null;
  const selectedPieceNames = selectedOutfit
    ? wearablePieces(selectedOutfit).map((item) => itemName(item))
    : [];

  async function generate() {
    if (!selectedOutfitId || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const response = await fetch("/api/ai/virtual-try-on", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outfitId: selectedOutfitId }),
      });
      const data = (await response.json()) as {
        id?: string;
        outfitId?: string;
        resultUrl?: string;
        createdAt?: string;
        error?: string;
      };
      if (!response.ok || !data.id || !data.outfitId || !data.resultUrl || !data.createdAt) {
        throw new Error(data.error || "Virtual try-on failed");
      }
      const result: InitialTryOnResult = {
        id: data.id,
        outfitId: data.outfitId,
        resultUrl: data.resultUrl,
        createdAt: data.createdAt,
      };
      setResults((current) => new Map(current).set(result.outfitId, result));
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "Virtual try-on failed");
    } finally {
      setGenerating(false);
    }
  }

  if (!profilePhotoUrl) {
    return (
      <div>
        <TryOnHeading />
        <div className="grid min-h-[420px] items-center gap-8 rounded-2xl border border-surface-200 bg-white p-8 md:grid-cols-[1fr_0.75fr] md:p-12">
          <div>
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-100 text-brand-700">
              <Camera size={23} />
            </div>
            <h2 className="font-display text-2xl font-semibold text-surface-900">
              Start with a full-body photo
            </h2>
            <p className="mt-3 max-w-md text-sm leading-6 text-surface-500">
              Add one clear photo in User. It stays private and can be reused across your saved Looks,
              so you do not need to upload it every time.
            </p>
            <Link
              href="/profile#full-body-photo"
              className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-lg bg-surface-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-surface-800 active:scale-[0.98]"
            >
              Add full-body photo <ArrowRight size={15} />
            </Link>
          </div>
          <div className="mx-auto aspect-[3/4] w-full max-w-56 rounded-2xl border-2 border-dashed border-surface-300 bg-surface-50 p-8">
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-surface-400">
              <Camera size={36} strokeWidth={1.4} />
              <span className="text-xs leading-5">Front-facing · full body · even light</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (eligibleOutfits.length === 0) {
    return (
      <div>
        <TryOnHeading />
        <div className="rounded-2xl border border-surface-200 bg-white p-8 text-center sm:p-12">
          <Shirt size={32} className="mx-auto text-surface-300" />
          <h2 className="mt-4 font-display text-xl font-semibold text-surface-900">
            Save a Look to try it on
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-surface-500">
            Virtual try-on works with saved Looks containing a top, bottom, dress, outer layer, or
            shoes.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <TryOnHeading />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(300px,0.85fr)_minmax(380px,1.15fr)]">
        {/* The action sits at the top and only the list of Looks scrolls, so the card never
            outgrows the screen however many Looks are saved. */}
        <section className="flex flex-col rounded-2xl border border-surface-200 bg-white p-4 sm:p-5 lg:max-h-[calc(100vh-7rem)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-surface-900">1. Choose a saved Look</p>
              <p className="mt-1 text-xs leading-5 text-surface-500">
                Pick the Look you want to see on your photo.
              </p>
            </div>
            <Link
              href="/profile#full-body-photo"
              className="shrink-0 text-xs font-medium text-brand-700 hover:underline"
            >
              Change photo
            </Link>
          </div>

          <button
            type="button"
            onClick={generate}
            disabled={!selectedOutfit || generating || Boolean(selectedResult)}
            className="mt-4 inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-lg bg-surface-900 px-4 py-2.5 text-sm font-medium text-white transition-[background-color,transform] hover:bg-surface-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-surface-400"
          >
            {generating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {generating
              ? "Creating your try-on…"
              : selectedResult
                ? "Saved try-on ready"
                : "Try on this Look"}
          </button>
          <p className="mt-2 shrink-0 text-center text-[11px] leading-4 text-surface-400">
            The first render may take up to 3 minutes. Identical inputs reuse the saved result.
          </p>

          {error && (
            <p role="alert" className="mt-3 flex shrink-0 items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-700">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}

          {selectedOutfit && (
            <p className="mt-3 shrink-0 text-xs leading-5 text-surface-500">
              This render uses {selectedPieceNames.join(", ")}. Bags and small accessories stay on the
              Look, and out of the photo.
            </p>
          )}

          <div className="-mx-1 mt-4 min-h-0 flex-1 overflow-y-auto border-t border-surface-200 px-1 pt-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2">
              {eligibleOutfits.map((outfit) => {
                const selected = outfit.id === selectedOutfitId;
                const hasResult = results.has(outfit.id);
                return (
                  <button
                    key={outfit.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setSelectedOutfitId(outfit.id);
                      setError(null);
                    }}
                    className={cn(
                      "relative rounded-xl border p-2 text-left transition-[border-color,box-shadow,transform] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 active:scale-[0.98]",
                      selected
                        ? "border-surface-900 shadow-[0_0_0_1px_rgba(0,0,0,0.8)]"
                        : "border-surface-200 hover:border-surface-400"
                    )}
                  >
                    <OutfitMiniature outfit={outfit} />
                    <span className="mt-2 flex items-center justify-between gap-2 px-1 pb-1">
                      <span className="min-w-0 truncate text-xs font-semibold text-surface-800">
                        {outfit.name || "Untitled outfit"}
                      </span>
                      {hasResult && <Check size={14} className="shrink-0 text-brand-600" />}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section aria-live="polite" className="rounded-2xl bg-surface-200 p-4 sm:p-5 lg:sticky lg:top-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-surface-900">2. See it on you</p>
              <p className="mt-0.5 text-xs text-surface-500">
                {selectedOutfit?.name || "Choose a Look to begin"}
              </p>
            </div>
            {selectedResult && (
              <a
                href={selectedResult.resultUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-brand-700 hover:underline"
              >
                Open full size
              </a>
            )}
          </div>
          {selectedResult ? (
            // The card takes the photo's own proportions rather than a fixed 3:4 frame, so a
            // render that is not exactly 3:4 has no blank bands around it.
            <div className="relative mx-auto w-fit max-w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={selectedResult.resultUrl}
                alt={`Virtual try-on of ${selectedOutfit?.name || "saved outfit"}`}
                className="block h-auto max-h-[calc(100vh-14rem)] w-auto max-w-full rounded-xl"
              />
              {generating && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-white/85 text-surface-700">
                  <Loader2 size={28} className="animate-spin text-brand-600" />
                  <span className="text-sm font-medium">Checking your saved render…</span>
                </div>
              )}
            </div>
          ) : (
            <div className="relative mx-auto flex aspect-[3/4] max-h-[calc(100vh-14rem)] w-full max-w-[520px] flex-col items-center justify-center gap-3 rounded-xl bg-white p-8 text-center text-surface-400">
              {generating ? (
                <>
                  <Loader2 size={32} className="animate-spin text-brand-600" />
                  <p className="text-sm font-medium text-surface-600">Fitting the Look to your photo…</p>
                  <p className="max-w-xs text-xs leading-5">
                    Keep this page open while FLUX preserves your pose and applies the garments.
                  </p>
                </>
              ) : (
                <>
                  <Sparkles size={32} strokeWidth={1.4} />
                  <p className="max-w-xs text-sm leading-6">
                    Choose a Look, then generate a realistic preview on your saved photo.
                  </p>
                </>
              )}
            </div>
          )}
          <p className="mx-auto mt-3 max-w-[520px] text-[11px] leading-5 text-surface-400">
            AI preview only — fit, drape, proportions, and garment details may differ from real life.
          </p>
        </section>
      </div>
    </div>
  );
}

function TryOnHeading() {
  return (
    <div className="mb-7">
      <p className="mb-1 text-[12px] font-semibold uppercase tracking-[0.16em] text-brand-600">
        FLUX Virtual Try-On Pro
      </p>
      <h1 className="font-display text-3xl font-semibold text-surface-900">See the Look on you</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-surface-500">
        Preview a saved outfit on your own full-body photo before deciding what to wear.
      </p>
    </div>
  );
}
