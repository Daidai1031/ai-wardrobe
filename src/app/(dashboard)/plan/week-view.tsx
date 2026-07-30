"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  CloudSun,
  ListPlus,
  Loader2,
  Pencil,
  RotateCcw,
  Shirt,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { OutfitCollage, layoutsFromRows } from "@/components/outfit/outfit-canvas";
import { SegmentCanvasEditor } from "@/components/outfit/segment-canvas-editor";
import type { DailyResponse, DailySegmentItem, DailySegmentResponse } from "@/types/daily";
import type { WeeklyDay, WeeklyResponse } from "@/types/weekly";

function weekdayShort(date: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" }).format(
    new Date(`${date}T12:00:00Z`)
  );
}

function dayNumber(date: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", day: "numeric" }).format(
    new Date(`${date}T12:00:00Z`)
  );
}

function rangeLabel(start: string, end: string): string {
  const format = (date: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(
      new Date(`${date}T12:00:00Z`)
    );
  return `${format(start)} – ${format(end)}`;
}

export function WeekView() {
  const supabase = useMemo(() => createClient(), []);
  const [data, setData] = useState<WeeklyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [planning, setPlanning] = useState(false);
  const [regeneratingDate, setRegeneratingDate] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [regeneratingSegmentId, setRegeneratingSegmentId] = useState<string | null>(null);
  const [savingSegmentIds, setSavingSegmentIds] = useState<Set<string>>(new Set());
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/ai/weekly", { cache: "no-store" });
      const next = (await response.json()) as WeeklyResponse;
      if (!response.ok || next.error) throw new Error(next.error || "Couldn't load the week.");
      setData(next);
      setSelectedDate((current) => current ?? next.days.find((day) => day.segments.length > 0)?.date ?? null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't load the week.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Plans the whole window in one call — the cross-day constraints only hold if every day is decided together. */
  async function planWeek() {
    setPlanning(true);
    try {
      const response = await fetch("/api/ai/weekly", { method: "POST" });
      const next = (await response.json()) as WeeklyResponse;
      if (!response.ok || next.error) throw new Error(next.error || "Couldn't plan the week.");

      setData(next);
      if (next.message) {
        toast.error(next.message);
      } else {
        toast.success("Your week is planned");
        if (next.skippedDates && next.skippedDates.length > 0) {
          toast.info(
            `${next.skippedDates.length} day${next.skippedDates.length === 1 ? "" : "s"} left as-is — already confirmed worn.`
          );
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't plan the week.");
    } finally {
      setPlanning(false);
    }
  }

  /**
   * One day only. This goes through the daily route rather than the weekly one, which
   * also flips that date's `source` back to "daily" — once a day is redone on its own
   * it is no longer bound by the week's cross-day constraints, and the badge on the
   * cell says so rather than pretending the week is still intact.
   */
  async function regenerateDay(day: WeeklyDay) {
    if (day.status === "worn") return;

    setRegeneratingDate(day.date);
    try {
      const response = await fetch(`/api/ai/daily?date=${day.date}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rejectedItemIds: [...new Set(day.segments.flatMap((s) => s.items.map((i) => i.id)))],
        }),
      });
      const next = (await response.json()) as DailyResponse;
      if (!response.ok || next.error) throw new Error(next.error || "Couldn't redo that day.");
      if (next.message || next.segments.length === 0) {
        toast.error(next.message || "Couldn't redo that day.");
        return;
      }

      toast.success("Rebuilt that day");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't redo that day.");
    } finally {
      setRegeneratingDate(null);
    }
  }

  /**
   * Rebuild one segment of any day in the window. The daily route already takes
   * `?date=`, and its segment RPCs were never limited to today — only the UI was,
   * which is why /plan used to be able to show a Thursday it couldn't edit.
   */
  async function regenerateSegment(date: string, segment: DailySegmentResponse) {
    setRegeneratingSegmentId(segment.id);
    try {
      const response = await fetch(`/api/ai/daily?date=${date}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segmentId: segment.id,
          rejectedItemIds: segment.items.map((item) => item.id),
        }),
      });
      const next = (await response.json()) as DailyResponse;
      if (!response.ok || next.error) throw new Error(next.error || "Couldn't rebuild that look.");
      if (next.message) {
        toast.error(next.message);
        return;
      }

      toast.success(`Rebuilt “${segment.label}”`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't rebuild that look.");
    } finally {
      setRegeneratingSegmentId(null);
    }
  }

  async function saveSegmentToLooks(date: string, segment: DailySegmentResponse) {
    if (segment.items.length < 2) {
      toast.error("Need at least two items to save this look");
      return;
    }

    setSavingSegmentIds((current) => new Set(current).add(segment.id));
    const fallbackName = `${segment.label} · ${new Intl.DateTimeFormat("en", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
    }).format(new Date(`${date}T12:00:00Z`))}`;

    const { data: outfitId, error } = await supabase.rpc("save_outfit_plan_segment", {
      p_segment_id: segment.id,
      p_item_ids: segment.items.map((item) => item.id),
      p_name: fallbackName,
    });

    if (error || !outfitId) {
      toast.error(error?.message || "Failed to save look");
    } else {
      toast.success(`Saved “${segment.label}” to your outfits`);
      await load();
    }

    setSavingSegmentIds((current) => {
      const next = new Set(current);
      next.delete(segment.id);
      return next;
    });
  }

  function applyEditedSegment(segmentId: string, items: DailySegmentItem[]) {
    setData((current) =>
      current
        ? {
            ...current,
            days: current.days.map((day) => ({
              ...day,
              segments: day.segments.map((segment) =>
                segment.id === segmentId
                  ? // The RPC clears saved_outfit_id since the saved Look is a
                    // snapshot of the pre-edit segment; mirror it so Save re-enables.
                    { ...segment, items, savedOutfitId: null }
                  : segment
              ),
            })),
          }
        : current
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-surface-200 bg-white p-10 text-surface-400">
        <Loader2 size={24} className="animate-spin text-brand-500" />
        <p className="text-sm">Loading your week…</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-surface-200 bg-white p-8 text-center">
        <p className="mb-4 text-sm text-surface-500">Couldn&apos;t load the week.</p>
        <button
          onClick={() => void load()}
          className="rounded-lg border border-surface-200 px-4 py-2 text-xs font-medium text-surface-600 hover:bg-surface-50"
        >
          Try again
        </button>
      </div>
    );
  }

  const planned = data.days.filter((day) => day.segments.length > 0).length;
  const selected = data.days.find((day) => day.date === selectedDate) ?? null;
  const editingSegment = data.days
    .flatMap((day) => day.segments)
    .find((segment) => segment.id === editingSegmentId);

  if (editingSegment) {
    return (
      <SegmentCanvasEditor
        segment={editingSegment}
        availableItems={data.availableItems}
        onCancel={() => setEditingSegmentId(null)}
        onSaved={(items) => {
          applyEditedSegment(editingSegment.id, items);
          setEditingSegmentId(null);
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-surface-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-surface-600">
          <CalendarDays size={16} className="text-brand-500" />
          <span className="font-medium text-surface-900">{rangeLabel(data.start, data.end)}</span>
          <span className="text-surface-400">
            · {planned} of {data.days.length} days planned
          </span>
        </div>
        <button
          onClick={() => void planWeek()}
          disabled={planning}
          className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {planning ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {planning ? "Planning…" : planned > 0 ? "Replan the week" : "Plan this week"}
        </button>
      </div>

      {/* Rotation rules the generator couldn't satisfy. Shown rather than swallowed:
          a repeat the user can see explained reads as a closet limitation, an
          unexplained one reads as the planner being careless. */}
      {data.warnings && data.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
            <AlertTriangle size={13} /> Couldn&apos;t avoid every repeat this week
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {data.warnings.map((warning) => (
              <li key={warning} className="text-[11px] leading-relaxed text-amber-700">
                {warning}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Seven columns on wide screens, scrolling horizontally rather than reflowing —
          a week that wraps onto two rows stops reading as a week. */}
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <div className="grid min-w-[52rem] grid-cols-7 gap-2">
          {data.days.map((day) => {
            const isSelected = day.date === selectedDate;
            const first = day.segments[0];
            return (
              <button
                key={day.date}
                onClick={() => setSelectedDate(day.date)}
                className={cn(
                  "flex flex-col gap-2 rounded-xl border p-2.5 text-left transition-colors",
                  isSelected
                    ? "border-brand-400 bg-brand-50/50"
                    : "border-surface-200 bg-white hover:border-surface-300"
                )}
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-surface-500">
                    {weekdayShort(day.date)}
                  </span>
                  <span className="text-sm font-semibold text-surface-900">
                    {dayNumber(day.date)}
                  </span>
                </div>

                {day.forecast ? (
                  <p className="flex items-center gap-1 text-[10px] text-surface-500">
                    <CloudSun size={11} className="shrink-0" />
                    {day.forecast.tempMin}°–{day.forecast.tempMax}°
                    {/* D2: an estimate is a historical average, never a forecast. */}
                    {day.forecast.isEstimate && (
                      <span className="text-amber-600" title="Historical average, not a forecast">
                        ~
                      </span>
                    )}
                  </p>
                ) : (
                  <p className="text-[10px] text-surface-300">no forecast</p>
                )}

                {first ? (
                  <OutfitCollage items={first.items} layouts={layoutsFromRows(first.items)} />
                ) : (
                  <div className="flex aspect-square items-center justify-center rounded-lg bg-surface-50 text-surface-300">
                    <Shirt size={18} />
                  </div>
                )}

                <div className="space-y-1">
                  <p className="truncate text-[11px] font-medium text-surface-700">
                    {first ? first.label : "Not planned"}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {day.segments.length > 1 && (
                      <span className="rounded-full bg-surface-100 px-1.5 py-0.5 text-[9px] font-semibold text-surface-500">
                        +{day.segments.length - 1} more
                      </span>
                    )}
                    {day.status === "worn" && (
                      <span className="rounded-full bg-brand-100 px-1.5 py-0.5 text-[9px] font-semibold text-brand-700">
                        Worn
                      </span>
                    )}
                    {day.segments.length > 0 && day.source === "daily" && (
                      <span
                        className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700"
                        title="Redone on its own, so it isn't bound by the week's constraints"
                      >
                        Adjusted
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {selected && (
        <DayDetail
          day={selected}
          isToday={selected.date === data.start}
          regenerating={regeneratingDate === selected.date}
          regeneratingSegmentId={regeneratingSegmentId}
          savingSegmentIds={savingSegmentIds}
          onRegenerate={() => void regenerateDay(selected)}
          onRegenerateSegment={(segment) => void regenerateSegment(selected.date, segment)}
          onEditSegment={(segment) => setEditingSegmentId(segment.id)}
          onSaveSegment={(segment) => void saveSegmentToLooks(selected.date, segment)}
        />
      )}
    </div>
  );
}

function DayDetail({
  day,
  isToday,
  regenerating,
  regeneratingSegmentId,
  savingSegmentIds,
  onRegenerate,
  onRegenerateSegment,
  onEditSegment,
  onSaveSegment,
}: {
  day: WeeklyDay;
  isToday: boolean;
  regenerating: boolean;
  regeneratingSegmentId: string | null;
  savingSegmentIds: Set<string>;
  onRegenerate: () => void;
  onRegenerateSegment: (segment: DailySegmentResponse) => void;
  onEditSegment: (segment: DailySegmentResponse) => void;
  onSaveSegment: (segment: DailySegmentResponse) => void;
}) {
  const fullDate = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${day.date}T12:00:00Z`));

  return (
    <div className="rounded-xl border border-surface-200 bg-white p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-surface-900">{fullDate}</h2>
          {day.occasions.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {day.occasions.map((occasion) => (
                <span
                  key={occasion.id}
                  className="rounded-full bg-surface-100 px-2 py-0.5 text-[10px] font-medium text-surface-600"
                >
                  {occasion.time} · {occasion.title}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-xs text-surface-400">Nothing on the calendar</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Only for today — /home shows today and nothing else, so offering it on a
              Thursday sent the user somewhere that couldn't edit what they clicked. */}
          {isToday && (
            <Link
              href="/home"
              className="rounded-lg border border-surface-200 px-3 py-2 text-xs font-medium text-surface-600 hover:bg-surface-50"
            >
              Open on Home
            </Link>
          )}
          <button
            onClick={onRegenerate}
            disabled={regenerating || day.status === "worn"}
            title={
              day.status === "worn"
                ? "Already confirmed worn — this day is history now"
                : "Redo just this day"
            }
            className="flex items-center gap-1.5 rounded-lg border border-surface-200 px-3 py-2 text-xs font-medium text-surface-600 hover:bg-surface-50 disabled:opacity-40"
          >
            {regenerating ? (
              <Loader2 size={13} className="animate-spin" />
            ) : day.status === "worn" ? (
              <Check size={13} />
            ) : (
              <RotateCcw size={13} />
            )}
            {regenerating ? "Redoing…" : "Redo this day"}
          </button>
        </div>
      </div>

      {day.segments.length === 0 ? (
        <p className="text-sm text-surface-400">
          Nothing planned yet. Use “Plan this week” above to fill the whole window at once.
        </p>
      ) : (
        <div className="space-y-5">
          {day.segments.map((segment, index) => (
            <section key={segment.id} className="grid gap-4 sm:grid-cols-[minmax(0,13rem)_1fr] sm:items-start">
              <OutfitCollage items={segment.items} layouts={layoutsFromRows(segment.items)} />
              <div className="space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-surface-400">
                      Segment {index + 1}
                    </p>
                    <h3 className="text-sm font-semibold text-surface-900">{segment.label}</h3>
                  </div>
                  {day.status !== "worn" && (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => onRegenerateSegment(segment)}
                        disabled={Boolean(regeneratingSegmentId)}
                        title="Rebuild only this look"
                        className="rounded-lg border border-surface-200 p-1.5 text-surface-400 transition-colors hover:text-surface-700 disabled:opacity-40"
                      >
                        {regeneratingSegmentId === segment.id ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <RotateCcw size={13} />
                        )}
                      </button>
                      <button
                        onClick={() => onEditSegment(segment)}
                        disabled={Boolean(regeneratingSegmentId)}
                        title="Adjust this look on the canvas"
                        className="flex items-center gap-1.5 rounded-lg border border-surface-200 px-2.5 py-1.5 text-xs font-medium text-surface-600 hover:bg-surface-50 disabled:opacity-40"
                      >
                        <Pencil size={13} />
                        Adjust
                      </button>
                      <button
                        onClick={() => onSaveSegment(segment)}
                        disabled={savingSegmentIds.has(segment.id) || Boolean(segment.savedOutfitId)}
                        className="flex items-center gap-1.5 rounded-lg bg-surface-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-surface-800 disabled:opacity-50"
                      >
                        {segment.savedOutfitId ? <Check size={13} /> : <ListPlus size={13} />}
                        {segment.savedOutfitId
                          ? "Saved"
                          : savingSegmentIds.has(segment.id)
                            ? "Saving…"
                            : "Save"}
                      </button>
                    </div>
                  )}
                </div>
                {segment.changeFromPrevious && (
                  <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700">
                    Change: {segment.changeFromPrevious}
                  </p>
                )}
                <p className="text-sm leading-relaxed text-surface-700">{segment.reasoning}</p>
                <ul className="space-y-1 border-t border-surface-100 pt-2">
                  {segment.items.map((item) => (
                    <li key={item.id} className="text-[11px] leading-relaxed text-surface-500">
                      {[item.color, item.subcategory || item.category, item.brand]
                        .filter(Boolean)
                        .join(" · ")}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ))}
        </div>
      )}

      {day.gap && (
        <p className="mt-5 border-t border-surface-100 pt-4 text-xs text-surface-400">
          Wardrobe gap: {day.gap}
        </p>
      )}
    </div>
  );
}
