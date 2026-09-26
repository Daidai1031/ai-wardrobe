"use client";

import { useMemo } from "react";
import { SwipeMark } from "@/components/icons/section-marks";
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
    <section className="flex flex-1 flex-col rounded-md bg-surface-100 p-4 sm:p-6 shadow-[0_1px_2px_rgba(10,10,10,0.05),0_8px_20px_rgba(10,10,10,0.08)] lg:border lg:border-border lg:shadow-none">
      <h2 className="flex items-center gap-2 font-serif text-heading text-ink">
        <SwipeMark size={16} className="text-ink-muted" /> Style swipe
      </h2>

      <div className="mt-5 flex flex-1 flex-col justify-center">
        <SwipeDeck cards={cards} surface="daily_feed" candidateSource="rule" />
      </div>
    </section>
  );
}
