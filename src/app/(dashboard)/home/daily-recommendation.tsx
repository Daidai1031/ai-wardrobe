"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Check,
  Cloud,
  Layers3,
  Loader2,
  Pencil,
  RotateCcw,
  Shirt,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { wardrobeItemLabel } from "@/lib/wardrobe/item-label";
import { OutfitCollage, layoutsFromRows } from "@/components/outfit/outfit-canvas";
import {
  SegmentCanvasEditor,
  type SegmentCanvasSaveResult,
} from "@/components/outfit/segment-canvas-editor";
import { SegmentSaveButton } from "@/components/outfit/segment-save-button";
import type {
  DailyResponse,
  DailySegmentResponse,
  DailyWardrobeItem,
} from "@/types/daily";

type Feedback = "liked" | null;

function itemLabel(item: DailyWardrobeItem): string {
  return wardrobeItemLabel(item);
}

export function DailyRecommendation({ userId }: { userId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [data, setData] = useState<DailyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [regeneratingSegmentId, setRegeneratingSegmentId] = useState<string | null>(null);
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [reusingSegmentId, setReusingSegmentId] = useState<string | null>(null);
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
        source: "daily",
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

  /** Whole-day Dislike: every segment is thrown away and rebuilt. */
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

  /**
   * Per-segment Dislike. Only this segment is rebuilt, so a day where one look
   * lands and another misses doesn't cost the user the good one.
   */
  async function dislikeSegment(segment: DailySegmentResponse) {
    if (!data || data.status === "worn") return;

    setRegeneratingSegmentId(segment.id);
    try {
      const response = await fetch("/api/ai/daily", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segmentId: segment.id,
          rejectedItemIds: segment.items.map((item) => item.id),
        }),
      });
      const next = (await response.json()) as DailyResponse;

      if (!response.ok || next.error) {
        throw new Error(next.error || "Couldn't rebuild that segment.");
      }
      if (next.message || next.segments.length === 0) {
        toast.error(next.message || "Couldn't rebuild that segment.");
        return;
      }

      setData(next);
      setFeedback(null);
      toast.success(`Rebuilt “${segment.label}”`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't rebuild that segment.");
    } finally {
      setRegeneratingSegmentId(null);
    }
  }

  function applyEditedSegment(segmentId: string, result: SegmentCanvasSaveResult) {
    setData((current) =>
      current
        ? {
            ...current,
            segments: current.segments.map((segment) =>
              segment.id === segmentId
                ? {
                    ...segment,
                    items: result.items,
                    savedOutfitId: result.savedOutfitId,
                    sourceOutfitId: result.sourceOutfitId,
                  }
                : segment
            ),
          }
        : current
    );
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
  const editingSegment = data.segments.find((segment) => segment.id === editingSegmentId);
  const weatherLocations = data.weatherLocations?.length
    ? data.weatherLocations
    : data.weather
      ? [data.weather]
      : [];

  if (editingSegment) {
    return (
      <SegmentCanvasEditor
        segment={editingSegment}
        availableItems={data.availableItems}
        showSavedLooksInitially={reusingSegmentId === editingSegment.id}
        onCancel={() => {
          setEditingSegmentId(null);
          setReusingSegmentId(null);
        }}
        onSaved={(result) => {
          applyEditedSegment(editingSegment.id, result);
          setEditingSegmentId(null);
          setReusingSegmentId(null);
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {weatherLocations.length > 0 ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-surface-600 bg-white rounded-xl border border-surface-200 px-4 py-3 w-fit">
            <Cloud size={16} className="text-brand-500" />
            {weatherLocations.map((weather, index) => (
              <span key={`${weather.city}-${index}`} className="whitespace-nowrap">
                <span className="font-medium text-surface-900">{weather.city}</span>{" "}
                {weather.temp}°C · <span className="capitalize">{weather.description}</span>
              </span>
            ))}
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
            title="Dislike the whole day — avoid every item above and rebuild all segments"
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
          <div className="flex items-center gap-2">
            {/* A date has one plan; this says where today's came from, so a look the
                user recognises from /plan doesn't read as an unrelated suggestion. */}
            {data.source === "weekly" && (
              <Link
                href="/plan"
                className="rounded-full bg-brand-50 px-2.5 py-1 text-[10px] font-semibold text-brand-700 hover:bg-brand-100"
              >
                From your week plan
              </Link>
            )}
            {data.cached && <span className="text-[11px] text-surface-400">Saved daily plan</span>}
          </div>
        </div>

        <div className="space-y-5">
          {data.segments.map((segment, segmentIndex) => {
            const regenerating = regeneratingSegmentId === segment.id;

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
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                    <button
                      onClick={() => void dislikeSegment(segment)}
                      disabled={worn || regenerating || Boolean(regeneratingSegmentId)}
                      title="Rebuild only this segment — the other segments stay as they are"
                      className="p-1.5 rounded-lg border border-surface-200 text-surface-400 hover:text-surface-700 transition-colors disabled:opacity-40"
                    >
                      {regenerating ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <RotateCcw size={13} />
                      )}
                    </button>
                    <button
                      onClick={() => {
                        setReusingSegmentId(segment.id);
                        setEditingSegmentId(segment.id);
                      }}
                      disabled={worn || Boolean(regeneratingSegmentId)}
                      title="Replace this segment with one of your saved outfits"
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-surface-200 text-surface-600 text-xs font-medium hover:bg-surface-50 disabled:opacity-40"
                    >
                      <Layers3 size={13} />
                      Use saved
                    </button>
                    <button
                      onClick={() => {
                        setReusingSegmentId(null);
                        setEditingSegmentId(segment.id);
                      }}
                      disabled={worn || Boolean(regeneratingSegmentId)}
                      title="Adjust this segment on the canvas"
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-surface-200 text-surface-600 text-xs font-medium hover:bg-surface-50 disabled:opacity-40"
                    >
                      <Pencil size={13} />
                      Adjust
                    </button>
                    <SegmentSaveButton
                      segment={segment}
                      date={data.date}
                      disabled={worn}
                      onSaved={(outfitId) =>
                        setData((current) =>
                          current
                            ? {
                                ...current,
                                segments: current.segments.map((currentSegment) =>
                                  currentSegment.id === segment.id
                                    ? {
                                        ...currentSegment,
                                        savedOutfitId: outfitId,
                                        sourceOutfitId: outfitId,
                                      }
                                    : currentSegment
                                ),
                              }
                            : current
                        )
                      }
                    />
                  </div>
                </div>

                {/* Collage left, copy right: a square collage stacked above full-width
                    text left a lot of dead space beside it on wide screens. Collapses
                    to a single column below sm. */}
                <div className="p-4 grid gap-4 sm:grid-cols-[minmax(0,15rem)_1fr] sm:items-start">
                  {segment.items.length > 0 ? (
                    <OutfitCollage
                      items={segment.items}
                      layouts={layoutsFromRows(segment.items)}
                    />
                  ) : (
                    <div className="flex aspect-square items-center justify-center gap-2 rounded-xl bg-surface-50 p-5 text-xs text-amber-700">
                      <Shirt size={15} /> Add at least one item
                    </div>
                  )}

                  <div className="space-y-3">
                    {segment.changeFromPrevious && (
                      <p className="text-xs text-brand-700 bg-brand-50 rounded-lg px-3 py-2">
                        Change: {segment.changeFromPrevious}
                      </p>
                    )}

                    <p className="text-sm text-surface-700 leading-relaxed">{segment.reasoning}</p>

                    {segment.items.length > 0 && (
                      <ul className="space-y-1 border-t border-surface-100 pt-3">
                        {segment.items.map((item) => (
                          <li key={item.id} className="text-[11px] text-surface-500 leading-relaxed">
                            {itemLabel(item)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
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
              worn || markingWorn || data.segments.some((segment) => segment.items.length === 0)
            }
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 text-white text-xs font-semibold hover:bg-brand-700 disabled:opacity-50"
          >
            {worn ? (
              <Check size={14} />
            ) : markingWorn ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Shirt size={14} />
            )}
            {worn ? "Worn today" : markingWorn ? "Confirming…" : "Confirm worn today"}
          </button>
        </div>
      </div>
    </div>
  );
}
