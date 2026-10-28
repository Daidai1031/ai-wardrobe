"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { GapRow, TIER_LABEL } from "@/components/shop/gap-row";
import { MIN_ITEMS_FOR_GAPS, type ClosetGap } from "@/lib/shop/detect-gaps";
import { cn } from "@/lib/utils";
import { SHOPPING_TIERS, type ShoppingRecommendation, type ShoppingTier } from "@/types/database";

/**
 * The Gaps & shop tab (ROADMAP Phase 9-A). The gaps themselves are computed on the server
 * by pure rules, so they are always here and cost nothing; naming brands is the one model
 * call, and only runs when the user asks for it.
 */
export function GapsShop({
  userId,
  gaps,
  closetSize,
  fingerprint,
  initialTier,
  initialRecommendations,
}: {
  userId: string;
  gaps: ClosetGap[];
  closetSize: number;
  fingerprint: string;
  initialTier: ShoppingTier | null;
  initialRecommendations: ShoppingRecommendation[];
}) {
  const supabase = createClient();
  const [tier, setTier] = useState<ShoppingTier | null>(initialTier);
  const [recommendations, setRecommendations] = useState(initialRecommendations);
  const [loading, setLoading] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);

  const byKey = useMemo(() => new Map(recommendations.map((r) => [r.gap_key, r])), [recommendations]);
  const dismissed = gaps.filter((gap) => byKey.get(gap.key)?.status === "dismissed");
  const visible = gaps.filter((gap) => showDismissed || byKey.get(gap.key)?.status !== "dismissed");

  // A brand list written for another tier, an earlier closet or an earlier brand list (the
  // seed script clears `summary`) still shows, but the button offers to bring it up to date.
  const isFresh = (rec: ShoppingRecommendation | undefined) =>
    Boolean(rec && rec.summary && rec.tier === tier && rec.closet_fingerprint === fingerprint);
  const needsSuggestions = gaps.some((gap) => {
    const rec = byKey.get(gap.key);
    return !rec || (rec.status === "new" && !isFresh(rec));
  });
  const hasAnyBrands = recommendations.some((r) => r.brands.length > 0);

  async function chooseTier(next: ShoppingTier) {
    const previous = tier;
    setTier(next);
    const { error } = await supabase.from("profiles").update({ shopping_tier: next }).eq("id", userId);
    if (error) {
      setTier(previous);
      toast.error("Could not save your price range");
    }
  }

  async function suggest() {
    setLoading(true);
    try {
      const res = await fetch("/api/ai/shop", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not get suggestions");
      setRecommendations(body.recommendations);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not get suggestions");
    } finally {
      setLoading(false);
    }
  }

  async function setStatus(gap: ClosetGap, status: ShoppingRecommendation["status"]) {
    const current = byKey.get(gap.key);
    const optimistic: ShoppingRecommendation = current
      ? { ...current, status }
      : {
          id: `pending-${gap.key}`,
          user_id: userId,
          gap_key: gap.key,
          gap: gap as unknown as Record<string, unknown>,
          summary: null,
          brands: [],
          tier,
          closet_fingerprint: null,
          status,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
    setRecommendations((list) => [...list.filter((r) => r.gap_key !== gap.key), optimistic]);

    // A gap dismissed before any suggestion exists still needs a row to remember it.
    const { data, error } = await supabase
      .from("shopping_recommendations")
      .upsert(
        { user_id: userId, gap_key: gap.key, gap, status, updated_at: new Date().toISOString() },
        { onConflict: "user_id,gap_key" }
      )
      .select("*")
      .single();
    if (error || !data) {
      setRecommendations((list) => [...list.filter((r) => r.gap_key !== gap.key), ...(current ? [current] : [])]);
      toast.error("Could not update");
      return;
    }
    setRecommendations((list) => [...list.filter((r) => r.gap_key !== gap.key), data as ShoppingRecommendation]);
  }

  if (closetSize < MIN_ITEMS_FOR_GAPS) {
    return (
      <p className="py-16 text-center text-sm text-ink-muted">
        Add at least {MIN_ITEMS_FOR_GAPS} pieces and we&apos;ll show what your closet is missing.
      </p>
    );
  }

  return (
    <div className="max-w-3xl">
      <section className="mb-8">
        <p className="text-[11.5px] font-bold uppercase tracking-[0.04em] text-ink">Price range</p>
        <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Price range">
          {SHOPPING_TIERS.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={tier === value}
              onClick={() => chooseTier(value)}
              className={cn(
                "border px-3 py-1.5 text-[13px] transition-colors",
                tier === value ? "border-ink bg-ink text-ink-inverse" : "border-border text-ink hover:border-ink"
              )}
            >
              {TIER_LABEL[value]}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-ink-muted">
          We suggest brands in this range first, and from the ranges either side of it.
        </p>
      </section>

      {gaps.length === 0 ? (
        <p className="py-10 text-sm text-ink-muted">No obvious gaps — your closet covers every occasion we check.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[16px] font-semibold text-ink">What your closet is missing</h2>
            {needsSuggestions && (
              <button
                type="button"
                onClick={suggest}
                disabled={!tier || loading}
                className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-[14px] font-semibold text-ink-inverse disabled:opacity-40"
                title={tier ? undefined : "Choose a price range first"}
              >
                {loading && <Loader2 size={15} className="animate-spin" />}
                {hasAnyBrands ? "Update where to shop" : "Suggest where to shop"}
              </button>
            )}
          </div>

          {visible.length === 0 && (
            <p className="mt-3 text-sm text-ink-muted">You&apos;ve set aside every gap we found.</p>
          )}

          <ul className="mt-2">
            {visible.map((gap) => {
              const rec = byKey.get(gap.key);
              return (
                <GapRow key={gap.key} gap={gap} summary={rec?.summary}>
                  {rec && rec.brands.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
                      {rec.brands.map((brand) => (
                        <a
                          key={brand.name}
                          href={brand.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[14px] font-semibold text-ink underline underline-offset-4 hover:text-accent"
                        >
                          {brand.name}
                          <ExternalLink size={12} />
                        </a>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 flex gap-4 text-[12px]">
                    {rec?.status === "dismissed" ? (
                      <button type="button" onClick={() => setStatus(gap, "new")} className="text-ink-muted hover:text-ink">
                        Restore
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setStatus(gap, rec?.status === "saved" ? "new" : "saved")}
                          className={rec?.status === "saved" ? "font-semibold text-ink" : "text-ink-muted hover:text-ink"}
                        >
                          {rec?.status === "saved" ? "Saved" : "Save"}
                        </button>
                        <button type="button" onClick={() => setStatus(gap, "dismissed")} className="text-ink-muted hover:text-ink">
                          Not for me
                        </button>
                      </>
                    )}
                  </div>
                </GapRow>
              );
            })}
          </ul>

          {dismissed.length > 0 && (
            <button
              type="button"
              onClick={() => setShowDismissed((v) => !v)}
              className="mt-4 text-[12px] text-ink-muted hover:text-ink"
            >
              {showDismissed ? "Hide dismissed" : `Show ${dismissed.length} dismissed`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
