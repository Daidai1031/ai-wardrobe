"use client";

/**
 * One stylist suggestion as a strip, for the mailbox on /home (ROADMAP Phase 10-A).
 *
 * Shows what she proposed next to what the client currently has, because "accept or
 * not" is a comparison and asking for it without the before is asking blind. Accepting
 * overwrites the target and snapshots the previous arrangement server-side, so the undo
 * offered afterwards restores the collage exactly — geometry included.
 *
 * Each strip is compact: the two collages ride at its right end as thumbnails and only
 * open to full size when expanded. Accept / No thanks / Undo stay visible collapsed, so
 * answering never requires expanding. The mailbox (`stylist-mailbox.tsx`) owns the
 * network calls and which strips sit under New versus History.
 */

import {
  ArrowRight,
  Check,
  ChevronDown,
  Loader2,
  RotateCcw,
  Star,
  X,
} from "lucide-react";
import { OutfitCollage, layoutsFromRows } from "@/components/outfit/outfit-canvas";
import type { ReviewCardItem, StylistReviewCard } from "@/lib/stylist/reviews";
import { wardrobeItemLabel } from "@/lib/wardrobe/item-label";
import { wardrobeItemImage } from "@/lib/wardrobe/item-image";
import { cn } from "@/lib/utils";

export type Action = "accept" | "decline" | "revert";

/** One suggestion as a strip: text on the left, the collages as thumbnails on the right. */
export function ReviewStrip({
  review,
  busy,
  expanded,
  onToggle,
  onRespond,
}: {
  review: StylistReviewCard;
  busy: boolean;
  expanded: boolean;
  onToggle: () => void;
  onRespond: (action: Action) => void;
}) {
  const accepted = review.status === "accepted";
  const answered = review.status !== "pending";
  // Undo restores a previous arrangement, so a review that never carried one — a rating
  // and a comment, which is every item review — has nothing to restore and gets no
  // button once it is answered.
  const canUndo = accepted && review.hasProposal;

  return (
    <article className="overflow-hidden rounded-md bg-surface-200">
      <div className="flex items-start gap-3 p-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="truncate text-subheading text-ink">{review.targetLabel}</p>
            {review.rating !== null && (
              <div className="flex items-center gap-0.5">
                {[1, 2, 3, 4, 5].map((value) => (
                  <Star
                    key={value}
                    size={12}
                    className={cn(
                      value <= review.rating! ? "fill-amber-400 text-amber-400" : "text-border"
                    )}
                  />
                ))}
              </div>
            )}
          </div>
          <p className="text-body-small text-ink-muted">{subtitleFor(review)}</p>

          {review.note && !expanded && (
            <p className="mt-1 line-clamp-2 text-body text-ink-muted leading-relaxed">{review.note}</p>
          )}

          <div className="mt-2 flex flex-wrap gap-2">
            {answered ? (
              canUndo ? (
                <button
                  type="button"
                  onClick={() => onRespond("revert")}
                  disabled={busy}
                  className="flex items-center gap-1.5 rounded-none border border-border px-3 py-1.5 text-button text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
                >
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                  {review.targetKind === "new_outfit"
                    ? "Undo — remove it from my Looks"
                    : "Undo — put my version back"}
                </button>
              ) : null
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onRespond("accept")}
                  disabled={busy}
                  className="flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-button text-ink-inverse transition-colors hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  {review.targetKind === "new_outfit"
                    ? "Save to my Looks"
                    : review.hasProposal
                      ? "Use her version"
                      : "Got it"}
                </button>
                <button
                  type="button"
                  onClick={() => onRespond("decline")}
                  disabled={busy}
                  className="flex items-center gap-1.5 rounded-full border border-ink px-3 py-1.5 text-button text-ink transition-colors hover:bg-surface-100 disabled:opacity-50"
                >
                  <X size={13} />
                  No thanks
                </button>
              </>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? "Hide the full-size look" : "See the full-size look"}
          className="flex shrink-0 items-center gap-1.5 rounded-none p-1 transition-colors hover:bg-surface-100"
        >
          <ReviewThumbs review={review} />
          <ChevronDown
            size={14}
            className={cn("text-ink-muted transition-transform", expanded && "rotate-180")}
          />
        </button>
      </div>

      {expanded && (
        <div className="space-y-4 border-t border-border p-4">
          {review.targetKind === "item" && review.current[0] && (
            // A piece review has no before/after to compare, so the piece itself is
            // the context: without it the note reads as being about nothing.
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={wardrobeItemImage(review.current[0])}
                alt={review.targetLabel}
                className="h-20 w-20 shrink-0 rounded-sm bg-surface-100 object-contain p-1"
              />
              <p className="text-body-small text-ink-muted">{wardrobeItemLabel(review.current[0])}</p>
            </div>
          )}

          {review.note && (
            <p className="whitespace-pre-wrap rounded-sm bg-surface-100 p-3 text-body text-ink leading-relaxed">
              {review.note}
            </p>
          )}

          {review.hasProposal &&
            (review.targetKind === "new_outfit" ? (
              // Nothing existed before, so there is no Before to put beside it —
              // a blank left-hand collage would read as "she deleted something".
              <div className="sm:max-w-[50%]">
                <p className="mb-1.5 text-label uppercase text-ink-muted">Her look</p>
                <OutfitCollage
                  items={review.proposed}
                  layouts={layoutsFromRows(review.proposed)}
                  className="rounded-sm ring-1 ring-ink"
                />
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="mb-1.5 text-label uppercase text-ink-muted">
                    {accepted ? "Before" : "Yours now"}
                  </p>
                  <OutfitCollage
                    items={review.current}
                    layouts={layoutsFromRows(review.current)}
                    className="rounded-sm"
                  />
                </div>
                <div>
                  <p className="mb-1.5 text-label uppercase text-ink-muted">Her version</p>
                  <OutfitCollage
                    items={review.proposed}
                    layouts={layoutsFromRows(review.proposed)}
                    className="rounded-sm ring-1 ring-ink"
                  />
                </div>
              </div>
            ))}
        </div>
      )}
    </article>
  );
}

/**
 * The comparison at strip scale: Before → Her version as two small collages, so the
 * shape of the suggestion is readable without expanding anything.
 */
function ReviewThumbs({ review }: { review: StylistReviewCard }) {
  if (!review.hasProposal) {
    const item = review.current[0];
    if (!item) return null;
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={wardrobeItemImage(item)}
        alt=""
        className="h-14 w-14 rounded-sm bg-surface-100 object-contain p-1"
      />
    );
  }

  if (review.targetKind === "new_outfit") {
    return <Thumb items={review.proposed} highlight />;
  }

  return (
    <>
      <Thumb items={review.current} />
      <ArrowRight size={12} className="shrink-0 text-ink-muted" />
      <Thumb items={review.proposed} highlight />
    </>
  );
}

function Thumb({ items, highlight = false }: { items: ReviewCardItem[]; highlight?: boolean }) {
  return (
    <div className="w-14 shrink-0">
      <OutfitCollage
        items={items}
        layouts={layoutsFromRows(items)}
        className={cn("rounded-sm", highlight ? "ring-1 ring-ink" : "ring-1 ring-border")}
      />
    </div>
  );
}

function subtitleFor(review: StylistReviewCard): string {
  if (review.status === "declined") return "You passed on this one";
  if (review.status === "reverted") return "You put your own version back";
  if (review.status === "accepted") {
    if (review.targetKind === "new_outfit") return "Saved to your Looks";
    if (review.targetKind === "item") return "You read this one";
    return "You accepted this suggestion";
  }
  if (review.targetKind === "item") return "Her thoughts on a piece in your closet";
  if (review.targetKind === "new_outfit") return "A new Look she put together from your closet";
  return "A suggestion from your stylist";
}
