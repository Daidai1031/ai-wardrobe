"use client";

/**
 * The client's side of a human stylist suggestion (ROADMAP Phase 10-A).
 *
 * Shows what she proposed next to what the client currently has, because "accept or
 * not" is a comparison and asking for it without the before is asking blind. Accepting
 * overwrites the target and snapshots the previous arrangement server-side, so the undo
 * offered afterwards restores the collage exactly — geometry included.
 *
 * Layout: this sits above the daily plan on /home, so each pending suggestion stays
 * visible as one compact strip instead of being hidden behind a section-level fold. The
 * two collages ride at its right end as thumbnails and only open to full size when the
 * strip is expanded. Answered suggestions move behind the "Reviewed" button beside the
 * heading, which is also where an accepted suggestion's undo goes on living.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Clock,
  Loader2,
  RotateCcw,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { OutfitCollage, layoutsFromRows } from "@/components/outfit/outfit-canvas";
import type { ReviewCardItem, StylistReviewCard } from "@/lib/stylist/reviews";
import { wardrobeItemLabel } from "@/lib/wardrobe/item-label";
import { wardrobeItemImage } from "@/lib/wardrobe/item-image";
import { cn } from "@/lib/utils";

type Action = "accept" | "decline" | "revert";

export function StylistReviewInbox({ reviews }: { reviews: StylistReviewCard[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [openHistory, setOpenHistory] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // A just-declined card is kept out of both lists until the refresh lands, otherwise it
  // would jump to the history still labelled "pending".
  const pending = reviews.filter((review) => review.status === "pending" && !dismissed.has(review.id));
  const history = reviews.filter((review) => review.status !== "pending");

  if (pending.length === 0 && history.length === 0) return null;

  async function respond(reviewId: string, action: Action) {
    setBusyId(reviewId);
    setError(null);
    try {
      const response = await fetch(`/api/stylist/reviews/${reviewId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Could not save your answer");

      if (action === "decline") {
        // Nothing outside this card changed, so a card-level dismissal is enough.
        setDismissed((current) => new Set(current).add(reviewId));
        router.refresh();
        return;
      }

      // Accepting or undoing rewrote the day's plan or a saved Look, and the surfaces
      // that render those — DailyRecommendation here, WeekView on /plan — are Client
      // Components holding their own fetched state. router.refresh() re-renders Server
      // Components only, so they'd keep showing the pre-accept outfit until the user
      // happened to reload. A full reload is blunt but it is the only thing that
      // actually re-runs those fetches.
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your answer");
    } finally {
      setBusyId(null);
    }
  }

  function toggleExpanded(reviewId: string) {
    setExpandedId((current) => (current === reviewId ? null : reviewId));
  }

  return (
    <section className="mb-6">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 py-1">
          <Sparkles size={15} className="text-brand-600" />
          <h2 className="text-sm font-semibold text-surface-900">From your stylist</h2>
          {pending.length > 0 && (
            <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
              {pending.length}
            </span>
          )}
        </div>

        {history.length > 0 && (
          <button
            type="button"
            onClick={() => setOpenHistory((open) => !open)}
            className={cn(
              "ml-auto flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
              openHistory
                ? "border-surface-300 bg-surface-100 text-surface-700"
                : "border-surface-200 text-surface-500 hover:bg-surface-50"
            )}
          >
            <Clock size={13} />
            Reviewed ({history.length})
          </button>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      {pending.length > 0 && (
        <div className="mt-3 space-y-2">
          {pending.map((review) => (
            <ReviewStrip
              key={review.id}
              review={review}
              busy={busyId === review.id}
              expanded={expandedId === review.id}
              onToggle={() => toggleExpanded(review.id)}
              onRespond={(action) => respond(review.id, action)}
            />
          ))}
        </div>
      )}

      {openHistory && history.length > 0 && (
        <div className="mt-3 space-y-2">
          {history.map((review) => (
            <ReviewStrip
              key={review.id}
              review={review}
              busy={busyId === review.id}
              expanded={expandedId === review.id}
              onToggle={() => toggleExpanded(review.id)}
              onRespond={(action) => respond(review.id, action)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/** One suggestion as a strip: text on the left, the collages as thumbnails on the right. */
function ReviewStrip({
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
    <article
      className={cn(
        "overflow-hidden rounded-2xl border bg-white",
        answered ? "border-surface-100" : "border-surface-200"
      )}
    >
      <div className="flex items-start gap-3 p-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="truncate text-sm font-semibold text-surface-900">{review.targetLabel}</p>
            {review.rating !== null && (
              <div className="flex items-center gap-0.5">
                {[1, 2, 3, 4, 5].map((value) => (
                  <Star
                    key={value}
                    size={12}
                    className={cn(
                      value <= review.rating! ? "fill-amber-400 text-amber-400" : "text-surface-200"
                    )}
                  />
                ))}
              </div>
            )}
          </div>
          <p className="text-xs text-surface-400">{subtitleFor(review)}</p>

          {review.note && !expanded && (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-surface-600">{review.note}</p>
          )}

          <div className="mt-2 flex flex-wrap gap-2">
            {answered ? (
              canUndo ? (
                <button
                  type="button"
                  onClick={() => onRespond("revert")}
                  disabled={busy}
                  className="flex items-center gap-1.5 rounded-lg border border-surface-200 px-3 py-1.5 text-xs font-medium text-surface-600 transition-colors hover:bg-surface-50 disabled:opacity-50"
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
                  className="flex items-center gap-1.5 rounded-lg bg-surface-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-surface-800 disabled:opacity-50"
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
                  className="flex items-center gap-1.5 rounded-lg border border-surface-200 px-3 py-1.5 text-xs font-medium text-surface-600 transition-colors hover:bg-surface-50 disabled:opacity-50"
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
          className="flex shrink-0 items-center gap-1.5 rounded-lg p-1 transition-colors hover:bg-surface-50"
        >
          <ReviewThumbs review={review} />
          <ChevronDown
            size={14}
            className={cn("text-surface-400 transition-transform", expanded && "rotate-180")}
          />
        </button>
      </div>

      {expanded && (
        <div className="space-y-4 border-t border-surface-100 p-4">
          {review.targetKind === "item" && review.current[0] && (
            // A piece review has no before/after to compare, so the piece itself is
            // the context: without it the note reads as being about nothing.
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={wardrobeItemImage(review.current[0])}
                alt={review.targetLabel}
                className="h-20 w-20 shrink-0 rounded-lg border border-surface-100 bg-surface-50 object-contain p-1"
              />
              <p className="text-xs text-surface-400">{wardrobeItemLabel(review.current[0])}</p>
            </div>
          )}

          {review.note && (
            <p className="whitespace-pre-wrap rounded-lg bg-surface-50 p-3 text-xs leading-relaxed text-surface-700">
              {review.note}
            </p>
          )}

          {review.hasProposal &&
            (review.targetKind === "new_outfit" ? (
              // Nothing existed before, so there is no Before to put beside it —
              // a blank left-hand collage would read as "she deleted something".
              <div className="sm:max-w-[50%]">
                <p className="mb-1.5 text-[11px] font-medium text-brand-700">Her look</p>
                <OutfitCollage
                  items={review.proposed}
                  layouts={layoutsFromRows(review.proposed)}
                  className="ring-1 ring-brand-200"
                />
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="mb-1.5 text-[11px] font-medium text-surface-400">
                    {accepted ? "Before" : "Yours now"}
                  </p>
                  <OutfitCollage items={review.current} layouts={layoutsFromRows(review.current)} />
                </div>
                <div>
                  <p className="mb-1.5 text-[11px] font-medium text-brand-700">Her version</p>
                  <OutfitCollage
                    items={review.proposed}
                    layouts={layoutsFromRows(review.proposed)}
                    className="ring-1 ring-brand-200"
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
        className="h-14 w-14 rounded-lg border border-surface-100 bg-surface-50 object-contain p-1"
      />
    );
  }

  if (review.targetKind === "new_outfit") {
    return <Thumb items={review.proposed} accent />;
  }

  return (
    <>
      <Thumb items={review.current} />
      <ArrowRight size={12} className="shrink-0 text-surface-300" />
      <Thumb items={review.proposed} accent />
    </>
  );
}

function Thumb({ items, accent = false }: { items: ReviewCardItem[]; accent?: boolean }) {
  return (
    <div className="w-14 shrink-0">
      <OutfitCollage
        items={items}
        layouts={layoutsFromRows(items)}
        className={accent ? "ring-1 ring-brand-200" : "ring-1 ring-surface-200"}
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
