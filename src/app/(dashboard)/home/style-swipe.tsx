"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { layoutsFromRows, type CanvasItem } from "@/components/outfit/outfit-canvas";
import { SwipeDeck, type SwipeCard } from "@/components/swipe/swipe-deck";

type SwipeItemPreview = CanvasItem & { brand?: string | null };

export interface SwipeOutfitRow {
  id: string;
  name: string | null;
  folder: string | null;
  outfit_items: {
    item_id: string;
    position: number | null;
    x: number | null;
    y: number | null;
    width: number | null;
    wardrobe_items: SwipeItemPreview | null;
  }[];
}

/**
 * Prototype surface for the swipe feature (docs/recommendation-system-plan.md).
 * Deliberately fed from saved Looks rather than external inspiration images: the
 * plan's onboarding deck needs a licence-clean inspiration corpus we don't have
 * yet, while these are the user's own photos and already on the page.
 *
 * Nothing here writes to the database. The deck hands back the `swipe_event`
 * row it *would* have written, so the shape can be reviewed before the table
 * exists — which is the order the plan's §4 argues for.
 */
export function StyleSwipe({ outfits }: { outfits: SwipeOutfitRow[] }) {
  const [open, setOpen] = useState(true);

  const cards = useMemo<SwipeCard[]>(() => {
    return outfits
      .map((outfit) => {
        const joins = [...(outfit.outfit_items || [])]
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          .filter((join) => join.wardrobe_items);

        const items = joins.map((join) => join.wardrobe_items as SwipeItemPreview);
        const layouts = layoutsFromRows(
          joins.map((join) => ({
            id: join.wardrobe_items!.id,
            x: join.x,
            y: join.y,
            width: join.width,
          }))
        );

        return {
          id: outfit.id,
          title: outfit.name?.trim() || "Untitled look",
          subtitle: [outfit.folder, `${items.length} pieces`].filter(Boolean).join(" · "),
          items,
          layouts,
        };
      })
      .filter((card) => card.items.length > 0);
  }, [outfits]);

  return (
    <section className="mt-6 rounded-xl border border-surface-200 bg-white p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-surface-800">
            <Sparkles size={16} className="text-brand-500" /> Style swipe
            <span className="rounded-full bg-surface-100 px-2 py-0.5 text-[10px] font-medium text-surface-500">
              Prototype · nothing is saved
            </span>
          </h2>
          <p className="mt-1 text-xs text-surface-400">
            Right to like · left to skip (with a reason) · up if you&apos;re wearing it · down for
            not now.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((previous) => !previous)}
          className="flex shrink-0 items-center gap-1 rounded-lg border border-surface-200 px-2.5 py-1.5 text-xs font-medium text-surface-600 hover:bg-surface-50"
        >
          {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {open ? "Hide" : "Show"}
        </button>
      </div>

      {open && (
        <div className="mt-5">
          <SwipeDeck cards={cards} surface="daily_feed" candidateSource="rule" />
        </div>
      )}
    </section>
  );
}
