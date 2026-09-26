"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { toast } from "sonner";
import {
  ChevronDown,
  Cloud,
  Ellipsis,
  Layers3,
  Loader2,
  Pencil,
  RotateCcw,
  Shirt,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { HandCheck } from "@/components/icons/hand-check";
import { PlanMark } from "@/components/icons/section-marks";
import {
  EditableCollage,
  OutfitCollage,
  layoutsFromRows,
  type CanvasItemLayout,
} from "@/components/outfit/outfit-canvas";
import {
  SegmentCanvasEditor,
  type SegmentCanvasSaveResult,
} from "@/components/outfit/segment-canvas-editor";
import type { DailyResponse, DailySegmentItem, DailySegmentResponse } from "@/types/daily";
import { wardrobeItemLabel } from "@/lib/wardrobe/item-label";
import { HOME_WEATHER_SLOT_ID } from "./weather-slot";

/**
 * The "what changed" line under a segment. Pieces that differ from the previous
 * segment are bolded wherever the note names them; matching is by label, so a note
 * the model worded loosely simply gets no bold rather than a wrong one.
 */
function ChangeNote({
  text,
  changedLabels,
  className,
}: {
  text: string;
  changedLabels: string[];
  className?: string;
}) {
  const labels = Array.from(new Set(changedLabels.filter(Boolean))).sort(
    (a, b) => b.length - a.length
  );
  const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = escaped.length > 0 ? text.split(new RegExp(`(${escaped.join("|")})`, "i")) : [text];

  return (
    <p className={cn("text-body-small text-ink-muted text-justify hyphens-auto", className)}>
      <span className="text-label font-bold uppercase text-ink lg:text-ink-muted">[CHANGE]</span>{" "}
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <strong key={index} className="font-semibold text-ink">
            {part}
          </strong>
        ) : (
          part
        )
      )}
    </p>
  );
}

/** Pieces present in exactly one of the two segments: what was taken off and what was put on. */
function changedItemLabels(previous: DailySegmentItem[], current: DailySegmentItem[]): string[] {
  const before = new Set(previous.map((item) => item.id));
  const after = new Set(current.map((item) => item.id));
  return [
    ...previous.filter((item) => !after.has(item.id)),
    ...current.filter((item) => !before.has(item.id)),
  ].map(wardrobeItemLabel);
}

export function DailyRecommendation() {
  const supabase = useMemo(() => createClient(), []);
  const [data, setData] = useState<DailyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [regeneratingSegmentId, setRegeneratingSegmentId] = useState<string | null>(null);
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [reusingSegmentId, setReusingSegmentId] = useState<string | null>(null);
  const [markingWorn, setMarkingWorn] = useState(false);
  // Phone timeline only: which segment's "···" menu is open, and which segments are showing
  // their full-size collage / full reasoning instead of the compact row.
  const [menuSegmentId, setMenuSegmentId] = useState<string | null>(null);
  const [openCollageIds, setOpenCollageIds] = useState<string[]>([]);
  const [openReasonIds, setOpenReasonIds] = useState<string[]>([]);
  // Segments the user has confirmed but that aren't written yet. `mark_outfit_plan_worn` takes the
  // whole day atomically (every segment exactly once, one +1 per distinct item), so the write
  // happens when the last segment is confirmed; until then a confirmed segment is only locked.
  const [confirmedSegmentIds, setConfirmedSegmentIds] = useState<string[]>([]);
  const layoutSaves = useRef<Promise<void>>(Promise.resolve());

  const loadPlan = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/ai/daily", { cache: "no-store" });
      const next = (await response.json()) as DailyResponse;
      if (!response.ok || next.error) {
        throw new Error(next.error || "Something went wrong loading today's plan.");
      }
      setData(next);
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

  const [weatherSlot, setWeatherSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setWeatherSlot(document.getElementById(HOME_WEATHER_SLOT_ID));
  }, []);

  /**
   * Per-segment Dislike. Only this segment is rebuilt, so a day where one look
   * lands and another misses doesn't cost the user the good one.
   */
  async function dislikeSegment(segment: DailySegmentResponse) {
    if (!data) return;

    setRegeneratingSegmentId(segment.id);
    try {
      if (!(await reopenSegment(segment))) return;
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
      toast.success(`Rebuilt “${segment.label}”`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't rebuild that segment.");
    } finally {
      setRegeneratingSegmentId(null);
    }
  }

  /**
   * Confirming doesn't freeze a segment: changing one is allowed, and it takes the
   * confirmation back — what was confirmed is no longer what's on the card. If the
   * whole day was already written, `unmark_outfit_plan_worn` reverses that first
   * (every segment-editing RPC refuses a worn plan); the other segments stay confirmed
   * and the day is written again when the last one is. Returns false when it couldn't.
   */
  async function reopenSegment(segment: DailySegmentResponse): Promise<boolean> {
    if (!data?.planId) return false;

    if (data.status === "worn") {
      setMarkingWorn(true);
      const { error } = await supabase.rpc("unmark_outfit_plan_worn", { p_plan_id: data.planId });
      setMarkingWorn(false);
      if (error) {
        toast.error(error.message || "Couldn't reopen today's plan");
        return false;
      }
      setConfirmedSegmentIds(data.segments.map((s) => s.id).filter((id) => id !== segment.id));
      setData((current) => (current ? { ...current, status: "suggested" } : current));
      return true;
    }

    setConfirmedSegmentIds((ids) => ids.filter((id) => id !== segment.id));
    return true;
  }

  function applyEditedSegment(segmentId: string, result: SegmentCanvasSaveResult) {
    setData((current) =>
      current
        ? {
            ...current,
            segments: current.segments.map((segment) => {
              if (segment.id === segmentId) {
                return {
                  ...segment,
                  items: result.items,
                  savedOutfitId: result.savedOutfitId,
                  sourceOutfitId: result.sourceOutfitId,
                  reasoning: result.reasoning,
                  changeFromPrevious: result.changeFromPrevious ?? undefined,
                };
              }
              if (result.nextSegmentId && segment.id === result.nextSegmentId) {
                return {
                  ...segment,
                  changeFromPrevious: result.nextChangeFromPrevious ?? undefined,
                };
              }
              return segment;
            }),
          }
        : current
    );
  }

  /**
   * Direct manipulation on the card: a garment was dragged or resized without changing
   * which garments the segment holds. The card updates at once; the same RPC the Canvas
   * editor saves through persists it, and a failure puts the previous arrangement back.
   *
   * Saves are chained rather than fired together, because each carries the whole
   * arrangement and two in flight could land out of order and leave the older one.
   * `p_source_matches` is false: a moved garment is no longer an exact copy of a saved
   * Look, so the exact link is dropped while the "started from" link is kept — the
   * same outcome as editing the layout on the Canvas. The RPC leaves the model's
   * reasoning alone for a layout-only change.
   */
  function commitSegmentLayout(
    segment: DailySegmentResponse,
    orderedIds: string[],
    layouts: Record<string, CanvasItemLayout>
  ) {
    const byId = new Map(segment.items.map((item) => [item.id, item]));
    const nextItems: DailySegmentItem[] = orderedIds
      .map((id) => byId.get(id))
      .filter((item): item is DailySegmentItem => Boolean(item))
      .map((item) => ({
        ...item,
        x: layouts[item.id]?.x ?? item.x,
        y: layouts[item.id]?.y ?? item.y,
        width: layouts[item.id]?.width ?? item.width,
      }));
    const previous = segment;

    const patch = (segmentId: string, apply: (s: DailySegmentResponse) => DailySegmentResponse) =>
      setData((current) =>
        current
          ? {
              ...current,
              segments: current.segments.map((s) => (s.id === segmentId ? apply(s) : s)),
            }
          : current
      );

    patch(segment.id, (s) => ({ ...s, items: nextItems, savedOutfitId: null }));

    layoutSaves.current = layoutSaves.current.then(async () => {
      if (!(await reopenSegment(segment))) {
        patch(segment.id, () => previous);
        return;
      }
      const { error } = await supabase.rpc("update_outfit_plan_segment_from_canvas", {
        p_segment_id: segment.id,
        p_items: nextItems.map((item) => ({
          itemId: item.id,
          x: item.x,
          y: item.y,
          width: item.width,
        })),
        p_source_outfit_id: segment.sourceOutfitId ?? segment.savedOutfitId ?? null,
        p_source_matches: false,
      });
      if (error) {
        toast.error(error.message || "Couldn't save that arrangement");
        patch(segment.id, () => previous);
      }
    });
  }

  const toggleId = (list: string[], id: string) =>
    list.includes(id) ? list.filter((value) => value !== id) : [...list, id];

  /** Same as the Adjust / Use saved buttons on the wider layout. */
  async function openEditor(segment: DailySegmentResponse, reuse: boolean) {
    setMenuSegmentId(null);
    if (!(await reopenSegment(segment))) return;
    setReusingSegmentId(reuse ? segment.id : null);
    setEditingSegmentId(segment.id);
  }

  async function confirmSegment(segment: DailySegmentResponse) {
    if (!data?.planId || markingWorn) return;

    if (data.status === "worn" || confirmedSegmentIds.includes(segment.id)) {
      await reopenSegment(segment);
      return;
    }

    const next = [...confirmedSegmentIds, segment.id];
    setConfirmedSegmentIds(next);
    if (data.segments.every((s) => next.includes(s.id))) {
      const saved = await markWornToday();
      if (!saved) setConfirmedSegmentIds((ids) => ids.filter((id) => id !== segment.id));
    }
  }

  async function markWornToday(): Promise<boolean> {
    if (!data?.planId || data.status === "worn") return false;
    if (data.segments.some((segment) => segment.items.length === 0)) {
      toast.error("Every segment needs at least one item before confirming");
      return false;
    }

    setMarkingWorn(true);
    const { error } = await supabase.rpc("mark_outfit_plan_worn", {
      p_plan_id: data.planId,
      p_segments: data.segments.map((segment) => ({
        segmentId: segment.id,
        itemIds: segment.items.map((item) => item.id),
      })),
    });

    setMarkingWorn(false);
    if (error) {
      toast.error(error.message || "Couldn't mark today's plan as worn");
      return false;
    }
    setData((current) => (current ? { ...current, status: "worn" } : current));
    toast.success("Today's actual outfits were added to your journal");
    return true;
  }

  if (loading) {
    return (
      <div className="bg-surface-200 rounded-md p-10 flex flex-col items-center justify-center gap-3 text-ink-muted lg:border lg:border-border lg:bg-white">
        <Loader2 size={24} className="animate-spin text-ink" />
        <p className="text-body">Putting together today&apos;s outfit plan…</p>
      </div>
    );
  }

  if (!data || data.error || data.message || data.segments.length === 0) {
    return (
      <div className="bg-surface-200 rounded-md p-8 text-center lg:border lg:border-border lg:bg-white">
        <p className="text-body text-ink-muted mb-4">
          {data?.error || data?.message || "No recommendation available."}
        </p>
        <div className="flex justify-center gap-2">
          <Link
            href="/closet"
            className="px-4 py-2 rounded-none bg-ink text-ink-inverse text-button hover:opacity-90"
          >
            Go to closet
          </Link>
          <button
            onClick={() => void loadPlan()}
            className="px-4 py-2 rounded-none border border-border text-button text-ink-muted hover:text-ink"
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

  // The forecast belongs to the page header, beside the date, not inside the card — but
  // it is fetched with the plan, so it is portalled into the slot `page.tsx` leaves there.
  const weatherPortal =
    weatherSlot && weatherLocations.length > 0
      ? createPortal(
          <div className="flex items-center gap-1.5">
            <Cloud size={16} className="shrink-0 text-ink-muted" />
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
              {weatherLocations.map((weather, index) => (
                <span key={`${weather.city}-${index}`} className="whitespace-nowrap">
                  <span className="font-medium text-ink">{weather.city}</span>{" "}
                  {weather.temp}°C · <span className="capitalize">{weather.description}</span>
                </span>
              ))}
            </div>
          </div>,
          weatherSlot
        )
      : null;

  if (editingSegment) {
    return (
      <>
        {weatherPortal}
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
      </>
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface-200 rounded-md p-4 sm:p-6 shadow-[0_1px_2px_rgba(10,10,10,0.05),0_8px_20px_rgba(10,10,10,0.08)] lg:border lg:border-border lg:bg-white lg:shadow-none">
      {weatherPortal}

      <div className="flex items-center justify-between gap-3 mb-5">
        <h2 className="font-serif text-heading text-ink flex items-center gap-2">
          <PlanMark size={16} className="text-ink-muted" /> Today&apos;s plan
        </h2>
      </div>

      {/* The day as a timeline, on every screen size. Each stop is a row: a collage, the
          reasoning and Confirm; the editing tools are behind "···", and tapping the collage
          opens the full-size, editable version. On a phone the collage is small and the
          reasoning is clamped (a chevron expands it); from sm up there is room for both in full. */}
      <div className="relative pl-6 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-border">
        {data.segments.map((segment, segmentIndex) => {
          const regenerating = regeneratingSegmentId === segment.id;
          const confirmed = worn || confirmedSegmentIds.includes(segment.id);
          const time = data.occasions.find((occasion) => segment.eventIds.includes(occasion.id))?.time;
          const collageOpen = openCollageIds.includes(segment.id);
          const reasonOpen = openReasonIds.includes(segment.id);
          const menuOpen = menuSegmentId === segment.id;
          const busy = markingWorn || Boolean(regeneratingSegmentId);

          const toolItems = [
            {
              label: "Rebuild this segment",
              Icon: RotateCcw,
              run: () => {
                setMenuSegmentId(null);
                void dislikeSegment(segment);
              },
            },
            { label: "Use saved outfit", Icon: Layers3, run: () => void openEditor(segment, true) },
            { label: "Adjust on canvas", Icon: Pencil, run: () => void openEditor(segment, false) },
          ];

          const moreMenu = (
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setMenuSegmentId(menuOpen ? null : segment.id)}
              aria-label="Edit this segment"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="flex h-8 w-8 items-center justify-center text-ink-muted transition-colors hover:text-ink"
            >
              {regenerating ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Ellipsis size={18} />
              )}
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuSegmentId(null)} />
                <div
                  role="menu"
                  className="absolute bottom-full right-0 z-20 mb-1 min-w-[11rem] overflow-hidden rounded-sm border border-border bg-white py-1 shadow-[0_1px_2px_rgba(10,10,10,0.05),0_8px_20px_rgba(10,10,10,0.12)]"
                >
                  {toolItems.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      role="menuitem"
                      disabled={busy}
                      onClick={item.run}
                      className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-[14px] leading-none text-ink-muted transition-colors hover:bg-surface-200 hover:text-ink disabled:opacity-40"
                    >
                      <item.Icon size={14} />
                      {item.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          );

          const text = (
            <div className="flex min-w-0 flex-1 flex-col">
              {segment.changeFromPrevious && (
                <ChangeNote
                  text={segment.changeFromPrevious}
                  changedLabels={changedItemLabels(
                    data.segments[segmentIndex - 1]?.items ?? [],
                    segment.items
                  )}
                  className={cn(
                    "lg:order-2 lg:mt-3 lg:border-t lg:border-border lg:pt-2 lg:text-[13px] lg:leading-[19px]",
                    !reasonOpen && !collageOpen && "line-clamp-2 sm:line-clamp-none"
                  )}
                />
              )}
              <p
                className={cn(
                  "text-justify hyphens-auto text-[13px] leading-[19px] text-ink-muted sm:text-[14px] sm:leading-[22px] lg:order-1 lg:text-[15px] lg:leading-6 lg:text-ink",
                  segment.changeFromPrevious && "mt-1 lg:mt-0",
                  !reasonOpen && !collageOpen && "line-clamp-3 sm:line-clamp-none"
                )}
              >
                {segment.reasoning}
              </p>
              {segment.reasoning.length > 110 && !collageOpen && (
                <button
                  type="button"
                  onClick={() => setOpenReasonIds((ids) => toggleId(ids, segment.id))}
                  aria-label={reasonOpen ? "Show less" : "Show the full description"}
                  aria-expanded={reasonOpen}
                  className="-ml-1 mt-0.5 flex h-7 w-7 items-center justify-center text-ink-muted transition-colors hover:text-ink sm:hidden"
                >
                  <ChevronDown
                    size={18}
                    className={cn("transition-transform duration-200", reasonOpen && "rotate-180")}
                  />
                </button>
              )}
              <div className="mt-3 flex items-center gap-1 lg:hidden">
              <button
                type="button"
                onClick={() => void confirmSegment(segment)}
                disabled={busy || segment.items.length === 0}
                title={confirmed ? "Click to take the confirmation back" : undefined}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-button disabled:opacity-70",
                  confirmed
                    ? "border-border bg-surface-100 text-ink"
                    : "border-transparent bg-accent text-ink-inverse"
                )}
              >
                {markingWorn && !worn ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <HandCheck size={13} />
                )}
                {confirmed ? "Confirmed" : "Confirm"}
              </button>
              {moreMenu}
              </div>
            </div>
          );

          const rail = (
            <div className="hidden w-[176px] shrink-0 flex-col gap-2 lg:flex">
              {toolItems.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  disabled={busy}
                  onClick={item.run}
                  className="flex w-full items-center justify-center gap-2 px-2.5 py-1.5 text-[13.5px] font-medium leading-5 text-ink-muted transition-colors hover:text-ink disabled:opacity-40"
                >
                  {item.Icon === RotateCcw && regenerating ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <item.Icon size={15} />
                  )}
                  {item.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => void confirmSegment(segment)}
                disabled={busy || segment.items.length === 0}
                title={confirmed ? "Click to take the confirmation back" : undefined}
                className={cn(
                  "mt-1.5 flex items-center justify-center gap-1.5 self-center rounded-full border px-[18px] py-2 text-[15px] font-semibold leading-5 disabled:opacity-70",
                  confirmed
                    ? "border-border bg-white text-ink"
                    : "border-transparent bg-accent text-ink-inverse"
                )}
              >
                {markingWorn && !worn ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <HandCheck size={14} />
                )}
                {confirmed ? "Confirmed" : "Confirm"}
              </button>
            </div>
          );

          return (
            <div key={segment.id} className="relative pb-6 last:pb-0">
              <span
                aria-hidden
                className={cn(
                  "absolute -left-6 top-1 h-[11px] w-[11px] rounded-full border-2 border-ink",
                  confirmed ? "bg-ink" : "bg-surface-200 lg:bg-white"
                )}
              />

              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-label uppercase text-ink-muted">
                    {time ?? `Segment ${segmentIndex + 1}`}
                  </p>
                  <h3 className="heading-plain text-subheading text-ink lg:text-[18px] lg:leading-6">{segment.label}</h3>
                </div>
              </div>

              {segment.items.length === 0 ? (
                <div className="mt-2 flex items-center gap-2 rounded-sm bg-surface-100 p-4 text-body text-ink-muted lg:bg-surface-200">
                  <Shirt size={15} /> Add at least one item
                </div>
              ) : collageOpen ? (
                <div className="mt-2 sm:flex sm:items-start sm:gap-6">
                  <div className="sm:w-[18rem] sm:shrink-0">
                    <EditableCollage
                      items={segment.items}
                      layouts={layoutsFromRows(segment.items)}
                      disabled={markingWorn || regenerating}
                      onCommit={(orderedIds, layouts) =>
                        commitSegmentLayout(segment, orderedIds, layouts)
                      }
                      className="mx-auto w-full max-w-[18rem] rounded-none bg-transparent"
                    />
                    <button
                      type="button"
                      onClick={() => setOpenCollageIds((ids) => toggleId(ids, segment.id))}
                      className="mx-auto mt-1 block text-body-small text-ink-muted hover:text-ink"
                    >
                      Show smaller
                    </button>
                  </div>
                  <div className="mt-2 flex sm:mt-0 sm:flex-1">{text}</div>
                  {rail}
                </div>
              ) : (
                <div className="mt-2 flex gap-3 sm:gap-6">
                  <button
                    type="button"
                    onClick={() => setOpenCollageIds((ids) => toggleId(ids, segment.id))}
                    aria-label="Show the full-size outfit"
                    className="h-[104px] w-[104px] shrink-0 overflow-hidden rounded-sm bg-surface-100 sm:h-[168px] sm:w-[168px] lg:bg-surface-200"
                  >
                    <OutfitCollage
                      items={segment.items}
                      layouts={layoutsFromRows(segment.items)}
                      className="rounded-none bg-transparent"
                    />
                  </button>
                  {text}
                  {rail}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {data.gap && (
        <p className="text-body-small text-ink-muted text-justify hyphens-auto mt-5 pt-4 border-t border-border">
          Wardrobe gap: {data.gap}
        </p>
      )}

    </div>
  );
}
