"use client";

/**
 * The client's side of a human stylist suggestion (ROADMAP Phase 10-A).
 *
 * Shows what she proposed next to what the client currently has, because "accept or
 * not" is a comparison and asking for it without the before is asking blind. Accepting
 * overwrites the target and snapshots the previous arrangement server-side, so the undo
 * offered afterwards restores the collage exactly — geometry included.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, RotateCcw, Sparkles, Star, X } from "lucide-react";
import { OutfitCollage, layoutsFromRows } from "@/components/outfit/outfit-canvas";
import type { StylistReviewCard } from "@/lib/stylist/reviews";
import { wardrobeItemLabel } from "@/lib/wardrobe/item-label";
import { cn } from "@/lib/utils";

type Action = "accept" | "decline" | "revert";

export function StylistReviewInbox({ reviews }: { reviews: StylistReviewCard[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  const visible = reviews.filter((review) => !dismissed.has(review.id));
  if (visible.length === 0) return null;

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

  return (
    <section className="mb-6 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles size={15} className="text-brand-600" />
        <h2 className="text-sm font-semibold text-surface-900">From your stylist</h2>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      )}

      {visible.map((review) => {
        const busy = busyId === review.id;
        const accepted = review.status === "accepted";

        return (
          <article
            key={review.id}
            className="overflow-hidden rounded-2xl border border-surface-200 bg-white"
          >
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-surface-100 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-surface-900">{review.targetLabel}</p>
                <p className="text-xs text-surface-400">
                  {review.targetKind === "item"
                    ? "Her thoughts on a piece in your closet"
                    : review.targetKind === "new_outfit"
                      ? accepted
                        ? "Saved to your Looks"
                        : "A new Look she put together from your closet"
                      : accepted
                        ? "You accepted this suggestion"
                        : "A suggestion from your stylist"}
                </p>
              </div>
              {review.rating !== null && (
                <div className="flex items-center gap-0.5">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <Star
                      key={value}
                      size={14}
                      className={cn(
                        value <= review.rating!
                          ? "fill-amber-400 text-amber-400"
                          : "text-surface-200"
                      )}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-4 p-4">
              {review.targetKind === "item" && review.current[0] && (
                // A piece review has no before/after to compare, so the piece itself is
                // the context: without it the note reads as being about nothing.
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={review.current[0].clean_url || review.current[0].original_url}
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
                      <OutfitCollage
                        items={review.current}
                        layouts={layoutsFromRows(review.current)}
                      />
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

              <div className="flex flex-wrap gap-2">
                {accepted ? (
                  <button
                    type="button"
                    onClick={() => respond(review.id, "revert")}
                    disabled={busy}
                    className="flex items-center gap-1.5 rounded-lg border border-surface-200 px-3 py-1.5 text-xs font-medium text-surface-600 transition-colors hover:bg-surface-50 disabled:opacity-50"
                  >
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                    {review.targetKind === "new_outfit"
                      ? "Undo — remove it from my Looks"
                      : "Undo — put my version back"}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => respond(review.id, "accept")}
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
                      onClick={() => respond(review.id, "decline")}
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
          </article>
        );
      })}
    </section>
  );
}
