"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { toast } from "sonner";
import {
  Check,
  Cloud,
  ListPlus,
  Loader2,
  Plus,
  Shirt,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type {
  DailyResponse,
  DailySegmentResponse,
  DailyWardrobeItem,
} from "@/types/daily";

type Feedback = "liked" | null;

function itemLabel(item: DailyWardrobeItem): string {
  return [item.color, item.subcategory || item.category, item.brand]
    .filter(Boolean)
    .join(" · ");
}

export function DailyRecommendation({ userId }: { userId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [data, setData] = useState<DailyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [savingSegmentIds, setSavingSegmentIds] = useState<Set<string>>(new Set());
  const [markingWorn, setMarkingWorn] = useState(false);

  const loadPlan = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/ai/daily", { cache: "no-store" });
      const next = (await response.json()) as DailyResponse;
      if (!response.ok || next.error) {
        throw new Error(next.error || "Something went wrong loading today's plan.");
      }
      setData(next);
      setFeedback(next.status === "accepted" ? "liked" : null);
    } catch (error) {
      setData({
        planId: null,
        date: "",
        weather: null,
        occasions: [],
        segments: [],
        availableItems: [],
        status: "suggested",
        generatedAt: null,
        cached: false,
        error: error instanceof Error ? error.message : "Something went wrong loading today's plan.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPlan();
  }, [loadPlan]);

  async function like() {
    if (!data?.planId || data.status === "worn") return;

    const { error } = await supabase
      .from("outfit_plans")
      .update({ status: "accepted", updated_at: new Date().toISOString() })
      .eq("id", data.planId)
      .eq("user_id", userId);

    if (error) {
      toast.error(error.message || "Couldn't save your feedback");
      return;
    }

    setFeedback("liked");
    setData((current) => (current ? { ...current, status: "accepted" } : current));
  }

  async function dislike() {
    if (!data || data.status === "worn") return;

    const rejectedItemIds = [
      ...new Set(data.segments.flatMap((segment) => segment.items.map((item) => item.id))),
    ];

    setLoading(true);
    try {
      const response = await fetch("/api/ai/daily", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rejectedItemIds }),
      });
      const next = (await response.json()) as DailyResponse;

      if (!response.ok || next.error) {
        throw new Error(next.error || "Couldn't generate another plan.");
      }
      if (next.message || next.segments.length === 0) {
        toast.error(next.message || "Couldn't generate another plan.");
        return;
      }

      setData(next);
      setFeedback(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't generate another plan.");
    } finally {
      setLoading(false);
    }
  }

  function updateSegmentItems(
    segmentId: string,
    update: (items: DailyWardrobeItem[]) => DailyWardrobeItem[]
  ) {
    setData((current) => {
      if (!current || current.status === "worn") return current;
      return {
        ...current,
        segments: current.segments.map((segment) =>
          segment.id === segmentId ? { ...segment, items: update(segment.items) } : segment
        ),
      };
    });
  }

  function removeItem(segmentId: string, itemId: string) {
    updateSegmentItems(segmentId, (items) => items.filter((item) => item.id !== itemId));
  }

  function addItem(segmentId: string, itemId: string) {
    if (!data) return;
    const item = data.availableItems.find((candidate) => candidate.id === itemId);
    if (!item) return;

    updateSegmentItems(segmentId, (items) =>
      items.some((existing) => existing.id === item.id) ? items : [...items, item]
    );
  }

  async function addToOutfits(segment: DailySegmentResponse) {
    if (segment.items.length < 2) {
      toast.error("Need at least two items to save this segment");
      return;
    }

    setSavingSegmentIds((current) => new Set(current).add(segment.id));

    const fallbackName = `${segment.label} · ${new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
    }).format(data?.date ? new Date(`${data.date}T12:00:00`) : new Date())}`;

    const { data: outfitId, error } = await supabase.rpc("save_outfit_plan_segment", {
      p_segment_id: segment.id,
      p_item_ids: segment.items.map((item) => item.id),
      p_name: fallbackName,
    });

    if (error || !outfitId) {
      toast.error(error?.message || "Failed to save outfit");
    } else {
      setData((current) =>
        current
          ? {
              ...current,
              segments: current.segments.map((currentSegment) =>
                currentSegment.id === segment.id
                  ? { ...currentSegment, savedOutfitId: String(outfitId) }
                  : currentSegment
              ),
            }
          : current
      );
      toast.success(`Saved “${segment.label}” to your outfits`);
    }

    setSavingSegmentIds((current) => {
      const next = new Set(current);
      next.delete(segment.id);
      return next;
    });
  }

  async function markWornToday() {
    if (!data?.planId || data.status === "worn") return;
    if (data.segments.some((segment) => segment.items.length === 0)) {
      toast.error("Every segment needs at least one item before confirming");
      return;
    }

    setMarkingWorn(true);
    const { error } = await supabase.rpc("mark_outfit_plan_worn", {
      p_plan_id: data.planId,
      p_segments: data.segments.map((segment) => ({
        segmentId: segment.id,
        itemIds: segment.items.map((item) => item.id),
      })),
    });

    if (error) {
      toast.error(error.message || "Couldn't mark today's plan as worn");
    } else {
      setData((current) => (current ? { ...current, status: "worn" } : current));
      toast.success("Today's actual outfits were added to your journal");
    }
    setMarkingWorn(false);
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-surface-200 p-10 flex flex-col items-center justify-center gap-3 text-surface-400">
        <Loader2 size={24} className="animate-spin text-brand-500" />
        <p className="text-sm">Putting together today&apos;s outfit plan…</p>
      </div>
    );
  }

  if (!data || data.error || data.message || data.segments.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-surface-200 p-8 text-center">
        <p className="text-sm text-surface-500 mb-4">
          {data?.error || data?.message || "No recommendation available."}
        </p>
        <div className="flex justify-center gap-2">
          <Link
            href="/closet"
            className="px-4 py-2 rounded-lg bg-surface-900 text-white text-xs font-medium hover:bg-surface-800"
          >
            Go to closet
          </Link>
          <button
            onClick={() => void loadPlan()}
            className="px-4 py-2 rounded-lg border border-surface-200 text-xs font-medium text-surface-600 hover:bg-surface-50"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const worn = data.status === "worn";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {data.weather ? (
          <div className="flex items-center gap-2 text-sm text-surface-600 bg-white rounded-xl border border-surface-200 px-4 py-3 w-fit">
            <Cloud size={16} className="text-brand-500" />
            <span className="font-medium text-surface-900">{data.weather.temp}°C</span>
            <span className="capitalize">{data.weather.description}</span>
            <span className="text-surface-400">· {data.weather.city}</span>
          </div>
        ) : (
          <div />
        )}

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => void like()}
            disabled={worn}
            title="Like"
            className={cn(
              "p-2 rounded-lg border transition-colors disabled:opacity-40",
              feedback === "liked"
                ? "border-brand-300 bg-brand-50 text-brand-600"
                : "border-surface-200 text-surface-400 hover:text-surface-700"
            )}
          >
            <ThumbsUp size={15} />
          </button>
          <button
            onClick={() => void dislike()}
            disabled={worn}
            title="Dislike — avoid these items and generate a new plan"
            className="p-2 rounded-lg border border-surface-200 text-surface-400 hover:text-surface-700 transition-colors disabled:opacity-40"
          >
            <ThumbsDown size={15} />
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-surface-200 p-6">
        <div className="flex items-center justify-between gap-3 mb-5">
          <h2 className="text-sm font-semibold text-surface-800 flex items-center gap-2">
            <Sparkles size={16} className="text-brand-500" /> Today&apos;s plan
          </h2>
          {data.cached && (
            <span className="text-[11px] text-surface-400">Saved daily plan</span>
          )}
        </div>

        <div className="space-y-5">
          {data.segments.map((segment, segmentIndex) => {
            const selectableItems = data.availableItems.filter(
              (item) => !segment.items.some((selected) => selected.id === item.id)
            );
            const saving = savingSegmentIds.has(segment.id);

            return (
              <section
                key={segment.id}
                className="rounded-xl border border-surface-200 overflow-hidden"
              >
                <div className="px-4 py-3 bg-surface-50 border-b border-surface-100 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-surface-400 mb-0.5">
                      Segment {segmentIndex + 1}
                    </p>
                    <h3 className="text-sm font-semibold text-surface-900">{segment.label}</h3>
                  </div>
                  <button
                    onClick={() => void addToOutfits(segment)}
                    disabled={saving || Boolean(segment.savedOutfitId)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-900 text-white text-xs font-medium hover:bg-surface-800 disabled:opacity-50 shrink-0"
                  >
                    {segment.savedOutfitId ? <Check size={13} /> : <ListPlus size={13} />}
                    {segment.savedOutfitId ? "Saved" : saving ? "Saving…" : "Save segment"}
                  </button>
                </div>

                <div className="p-4">
                  {segment.changeFromPrevious && (
                    <p className="text-xs text-brand-700 bg-brand-50 rounded-lg px-3 py-2 mb-4">
                      Change: {segment.changeFromPrevious}
                    </p>
                  )}

                  <div className="flex flex-wrap justify-center gap-3 bg-surface-50 rounded-lg p-5 mb-4 min-h-32">
                    {segment.items.map((item) => (
                      <div key={item.id} className="w-28 group">
                        <div className="w-28 h-28 relative">
                          <Image
                            src={item.clean_url || item.original_url}
                            alt={item.subcategory || item.category}
                            fill
                            className="object-contain"
                            unoptimized
                          />
                          {!worn && (
                            <button
                              onClick={() => removeItem(segment.id, item.id)}
                              title={`Remove ${itemLabel(item)}`}
                              className="absolute top-0 right-0 p-1 rounded-full bg-white border border-surface-200 text-surface-500 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 transition-opacity shadow-sm"
                            >
                              <X size={12} />
                            </button>
                          )}
                        </div>
                        <p className="text-[10px] text-surface-500 text-center truncate mt-1">
                          {itemLabel(item)}
                        </p>
                      </div>
                    ))}

                    {segment.items.length === 0 && (
                      <div className="flex items-center gap-2 text-xs text-amber-700">
                        <Shirt size={15} /> Add at least one item
                      </div>
                    )}
                  </div>

                  {!worn && selectableItems.length > 0 && (
                    <label className="flex items-center gap-2 mb-4">
                      <Plus size={14} className="text-surface-400 shrink-0" />
                      <span className="sr-only">Add an item to {segment.label}</span>
                      <select
                        value=""
                        onChange={(event) => addItem(segment.id, event.target.value)}
                        className="w-full max-w-sm rounded-lg border border-surface-200 bg-white px-3 py-2 text-xs text-surface-600 focus:outline-none focus:ring-2 focus:ring-brand-200"
                      >
                        <option value="">Adjust this segment — add an item…</option>
                        {selectableItems.map((item) => (
                          <option key={item.id} value={item.id}>
                            {itemLabel(item)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <p className="text-sm text-surface-700 leading-relaxed">
                    {segment.reasoning}
                  </p>
                </div>
              </section>
            );
          })}
        </div>

        {data.gap && (
          <p className="text-xs text-surface-400 mt-5 pt-4 border-t border-surface-100">
            Wardrobe gap: {data.gap}
          </p>
        )}

        <div className="mt-5 pt-4 border-t border-surface-100 flex flex-wrap items-center justify-between gap-3">
          <Link href="/stylist" className="text-xs font-medium text-brand-600 hover:text-brand-700">
            Want something else? Ask the AI Stylist →
          </Link>
          <button
            onClick={() => void markWornToday()}
            disabled={
              worn ||
              markingWorn ||
              data.segments.some((segment) => segment.items.length === 0)
            }
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 text-white text-xs font-semibold hover:bg-brand-700 disabled:opacity-50"
          >
            {worn ? <Check size={14} /> : markingWorn ? <Loader2 size={14} className="animate-spin" /> : <Shirt size={14} />}
            {worn ? "Worn today" : markingWorn ? "Confirming…" : "Confirm worn today"}
          </button>
        </div>
      </div>
    </div>
  );
}
