"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  OutfitCollage,
  layoutsFromRows,
  type CanvasItem,
} from "@/components/outfit/outfit-canvas";

interface ItemOutfitJoin {
  item_id: string;
  position: number | null;
  x: number | null;
  y: number | null;
  width: number | null;
  wardrobe_items: CanvasItem | null;
}

export interface ItemOutfitPreview {
  id: string;
  name: string | null;
  folder: string | null;
  notes: string | null;
  times_worn: number | null;
  ai_generated: boolean | null;
  created_at: string;
  outfit_items: ItemOutfitJoin[];
}

export function ItemOutfits({
  itemId,
  outfits,
}: {
  itemId: string;
  outfits: ItemOutfitPreview[];
}) {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);

  async function generateThree() {
    setGenerating(true);
    try {
      const response = await fetch("/api/ai/item-outfits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      });
      const result = (await response.json()) as { created?: number; error?: string };
      if (!response.ok) throw new Error(result.error || "Couldn't generate looks.");

      toast.success(`${result.created || 3} looks added to your Looks library`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't generate looks.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <section className="mt-10 border-t border-surface-200 pt-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles size={17} className="text-brand-600" />
            <h2 className="text-lg font-semibold text-surface-900">Recommended Looks</h2>
          </div>
          <p className="mt-1 text-sm text-surface-500">
            {outfits.length > 0
              ? "Showing up to 3 Looks you have already saved with this piece."
              : "This piece has not been used in a saved Look yet."}
          </p>
        </div>
        {outfits.length > 0 && (
          <Link
            href="/outfits"
            className="flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-800"
          >
            View all Looks <ArrowRight size={13} />
          </Link>
        )}
      </div>

      {outfits.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {outfits.slice(0, 3).map((outfit) => {
            const joins = [...(outfit.outfit_items || [])]
              .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
              .filter(
                (join): join is ItemOutfitJoin & { wardrobe_items: CanvasItem } =>
                  Boolean(join.wardrobe_items)
              );
            const items = joins.map((join) => join.wardrobe_items);

            return (
              <Link
                key={outfit.id}
                href={`/outfits?open=${encodeURIComponent(outfit.id)}`}
                className="group overflow-hidden rounded-2xl border border-surface-200 bg-white transition-all hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <OutfitCollage
                  items={items}
                  layouts={layoutsFromRows(
                    joins.map((join) => ({
                      id: join.item_id,
                      x: join.x,
                      y: join.y,
                      width: join.width,
                    }))
                  )}
                  className="rounded-none bg-[#f1eee9]"
                />
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="min-w-0 truncate text-sm font-semibold text-surface-900">
                      {outfit.name || "Untitled Look"}
                    </h3>
                    {outfit.ai_generated && (
                      <span className="shrink-0 rounded-full bg-brand-50 px-2 py-1 text-[10px] font-semibold text-brand-700">
                        AI
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-surface-400">
                    {items.length} {items.length === 1 ? "piece" : "pieces"} · Worn{" "}
                    {outfit.times_worn || 0}×
                  </p>
                  {outfit.notes && (
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-surface-500">
                      {outfit.notes}
                    </p>
                  )}
                  <span className="mt-3 flex items-center gap-1 text-xs font-semibold text-brand-700">
                    Open Look <ArrowRight size={12} />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-surface-300 bg-surface-50 px-6 py-10 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-100 text-brand-700">
            <Sparkles size={19} />
          </span>
          <h3 className="mt-4 text-sm font-semibold text-surface-900">
            Generate three complete Looks
          </h3>
          <p className="mt-1 max-w-md text-xs leading-5 text-surface-500">
            The stylist will build three different outfits around this exact piece using only your
            closet. Nothing is generated until you choose to continue.
          </p>
          <button
            type="button"
            onClick={generateThree}
            disabled={generating}
            className="mt-5 flex items-center gap-2 rounded-xl bg-surface-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-surface-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {generating ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {generating ? "Generating 3 looks…" : "Generate 3 looks"}
          </button>
        </div>
      )}
    </section>
  );
}
