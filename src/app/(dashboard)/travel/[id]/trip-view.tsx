"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  Briefcase,
  Check,
  CloudSun,
  Layers3,
  Loader2,
  Luggage,
  Palmtree,
  Pencil,
  Printer,
  RotateCcw,
  Share2,
  Shirt,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { wardrobeItemLabel } from "@/lib/wardrobe/item-label";
import { OutfitCollage, layoutsFromRows } from "@/components/outfit/outfit-canvas";
import {
  SegmentCanvasEditor,
  type SegmentCanvasSaveResult,
} from "@/components/outfit/segment-canvas-editor";
import { SegmentSaveButton } from "@/components/outfit/segment-save-button";
import { garmentsForDays } from "@/lib/travel/packing";
import { PackingPanel } from "./packing-panel";
import type { DailyResponse, DailySegmentResponse } from "@/types/daily";
import type { WeeklyDay, WeeklyResponse } from "@/types/weekly";
import type { TripDetailResponse, TripMeta, TripPackingList } from "@/types/travel";

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

function fullDateLabel(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
}

function rangeLabel(start: string, end: string): string {
  const format = (date: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(
      new Date(`${date}T12:00:00Z`)
    );
  return `${format(start)} – ${format(end)}`;
}

type Tab = "outfits" | "packing";

export function TripView({
  initialTrip,
  initialPacking,
}: {
  initialTrip: TripMeta;
  initialPacking: TripPackingList;
}) {
  const [trip, setTrip] = useState(initialTrip);
  const [packing, setPacking] = useState(initialPacking);
  const [week, setWeek] = useState<WeeklyResponse | null>(null);
  const [tab, setTab] = useState<Tab>("outfits");
  const [loading, setLoading] = useState(true);
  const [planning, setPlanning] = useState(false);
  const [savingTrip, setSavingTrip] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [regeneratingDate, setRegeneratingDate] = useState<string | null>(null);
  const [regeneratingSegmentId, setRegeneratingSegmentId] = useState<string | null>(null);
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [reusingSegmentId, setReusingSegmentId] = useState<string | null>(null);

  /**
   * The trip's days come from the weekly endpoint, not from a travel-specific one.
   * That is the whole "if it's already planned in /plan, it's already here" promise:
   * there is no second copy to pull from, it is the same row.
   */
  const loadDays = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/ai/weekly?start=${trip.startDate}&days=${trip.planDays}`,
        { cache: "no-store" }
      );
      const next = (await response.json()) as WeeklyResponse;
      if (!response.ok || next.error) throw new Error(next.error || "Couldn't load this trip.");
      setWeek(next);
      setSelectedDate(
        (current) =>
          current ?? next.days.find((day) => day.segments.length > 0)?.date ?? next.days[0]?.date ?? null
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't load this trip.");
    } finally {
      setLoading(false);
    }
  }, [trip.startDate, trip.planDays]);

  useEffect(() => {
    void loadDays();
  }, [loadDays]);

  // Memoized rather than defaulted inline: `week?.days ?? []` is a new array every
  // render, which would re-run every derived useMemo below it on every render.
  const days = useMemo(() => week?.days ?? [], [week]);
  const plannedDates = useMemo(
    () => days.filter((day) => day.segments.length > 0).map((day) => day.date),
    [days]
  );
  const unplannedDates = useMemo(
    () => days.filter((day) => day.segments.length === 0).map((day) => day.date),
    [days]
  );
  const confirmed = useMemo(() => new Set(trip.confirmedDates), [trip.confirmedDates]);

  const garments = useMemo(
    () => garmentsForDays(days, trip.confirmedDates, packing.packedItemIds),
    [days, trip.confirmedDates, packing.packedItemIds]
  );

  /** Every trip mutation goes through the same PATCH, so the row and the UI can't diverge. */
  const patchTrip = useCallback(
    async (body: Record<string, unknown>, failureMessage: string) => {
      setSavingTrip(true);
      try {
        const response = await fetch(`/api/travel/trips/${trip.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const next = (await response.json()) as TripDetailResponse;
        if (!response.ok || next.error) throw new Error(next.error || failureMessage);
        setTrip(next.trip);
        setPacking(next.packing);
        return next;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : failureMessage);
        return null;
      } finally {
        setSavingTrip(false);
      }
    },
    [trip.id]
  );

  /**
   * Plan the trip. `keep` is what makes this safe to press on a trip that's already
   * half planned: days that already have outfits — and, on a full replan, days the
   * user confirmed — are sent to the generator as context and then left untouched
   * when it writes.
   */
  async function planTrip(mode: "fill" | "replan") {
    const keep = mode === "fill" ? plannedDates : trip.confirmedDates;
    setPlanning(true);
    try {
      const response = await fetch(
        `/api/ai/weekly?start=${trip.startDate}&days=${trip.planDays}&keep=${keep.join(",")}`,
        { method: "POST" }
      );
      const next = (await response.json()) as WeeklyResponse;
      if (!response.ok || next.error) throw new Error(next.error || "Couldn't plan this trip.");

      setWeek(next);
      if (next.message) {
        toast.error(next.message);
        return;
      }
      toast.success(mode === "fill" ? "Planned the remaining days" : "Replanned your trip");
      setSelectedDate(
        (current) => current ?? next.days.find((day) => day.segments.length > 0)?.date ?? null
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't plan this trip.");
    } finally {
      setPlanning(false);
    }
  }

  async function regenerateDay(day: WeeklyDay) {
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
      // A regenerated day is no longer the one that was confirmed, so the
      // confirmation comes off with it — otherwise the packing list would still be
      // built from clothes that are no longer in the plan.
      if (confirmed.has(day.date)) {
        await patchTrip(
          { confirmedDates: trip.confirmedDates.filter((date) => date !== day.date) },
          "Couldn't update this trip."
        );
        toast.info("That day is no longer confirmed — check the new look and confirm again.");
      }
      toast.success("Rebuilt that day");
      await loadDays();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't redo that day.");
    } finally {
      setRegeneratingDate(null);
    }
  }

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
      await loadDays();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't rebuild that look.");
    } finally {
      setRegeneratingSegmentId(null);
    }
  }

  async function toggleConfirmed(date: string) {
    const next = confirmed.has(date)
      ? trip.confirmedDates.filter((entry) => entry !== date)
      : [...trip.confirmedDates, date].sort();
    const saved = await patchTrip({ confirmedDates: next }, "Couldn't confirm that day.");
    if (saved && !confirmed.has(date)) toast.success("Confirmed — it's on the packing list");
  }

  async function confirmAllPlanned() {
    const saved = await patchTrip(
      { confirmedDates: [...new Set([...trip.confirmedDates, ...plannedDates])].sort() },
      "Couldn't confirm those days."
    );
    if (saved) {
      toast.success("Every planned day confirmed");
      setTab("packing");
    }
  }

  async function toggleShare() {
    const saved = await patchTrip(
      { share: trip.shareToken ? "revoke" : "create" },
      "Couldn't change sharing."
    );
    if (!saved) return;
    if (saved.trip.shareToken) {
      const url = `${window.location.origin}/trip/${saved.trip.shareToken}`;
      await navigator.clipboard?.writeText(url).catch(() => undefined);
      toast.success("Share link copied — anyone with it can view this trip");
    } else {
      toast.success("Share link revoked");
    }
  }

  function applyEditedSegment(segmentId: string, result: SegmentCanvasSaveResult) {
    setWeek((current) =>
      current
        ? {
            ...current,
            days: current.days.map((day) => ({
              ...day,
              segments: day.segments.map((segment) =>
                segment.id === segmentId
                  ? {
                      ...segment,
                      items: result.items,
                      savedOutfitId: result.savedOutfitId,
                      sourceOutfitId: result.sourceOutfitId,
                    }
                  : segment
              ),
            })),
          }
        : current
    );
  }

  const editingSegment = days
    .flatMap((day) => day.segments)
    .find((segment) => segment.id === editingSegmentId);

  if (editingSegment) {
    return (
      <SegmentCanvasEditor
        segment={editingSegment}
        availableItems={week?.availableItems ?? []}
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

  const business = trip.tripType === "business";
  const TypeIcon = business ? Briefcase : Palmtree;
  const selected = days.find((day) => day.date === selectedDate) ?? null;
  const truncated = trip.dates.length > trip.planDays;

  return (
    <div className="space-y-4">
      <Link
        href="/travel"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-surface-500 hover:text-surface-800"
      >
        <ArrowLeft size={13} /> All trips
      </Link>

      <div className="rounded-2xl border border-surface-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {renaming ? (
                // Detection names a trip after the city it found, which is right until
                // it isn't ("Hamptons" for a house in Montauk, "Away" when no event
                // carried a city). The name is the row's; the signature stays what the
                // calendar produced, so renaming can't strand the packing list.
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    setRenaming(false);
                    if (draftName.trim() === trip.destination) return;
                    void patchTrip({ destination: draftName }, "Couldn't rename the trip.");
                  }}
                  className="flex items-center gap-1.5"
                >
                  <input
                    autoFocus
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    onBlur={() => setRenaming(false)}
                    maxLength={80}
                    placeholder={trip.destination}
                    aria-label="Trip name"
                    className="w-56 rounded-lg border border-surface-300 px-2 py-1 font-display text-2xl font-semibold text-surface-900 focus:border-brand-400 focus:outline-none"
                  />
                  <span className="text-[11px] text-surface-400">Enter to save · empty to reset</span>
                </form>
              ) : (
                <h1 className="font-display text-2xl font-semibold text-surface-900">
                  <button
                    onClick={() => {
                      setDraftName(trip.destination);
                      setRenaming(true);
                    }}
                    title="Rename this trip"
                    className="hover:text-brand-600"
                  >
                    {trip.destination}
                  </button>
                </h1>
              )}
              <button
                onClick={() =>
                  void patchTrip(
                    { tripType: business ? "leisure" : "business" },
                    "Couldn't change the trip type."
                  )
                }
                disabled={savingTrip}
                title={`Classified from your calendar: ${trip.typeReason}. Click to switch — it changes what the packing list suggests.`}
                className={cn(
                  "flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold transition-opacity disabled:opacity-50",
                  business ? "bg-surface-900 text-white" : "bg-brand-100 text-brand-700"
                )}
              >
                <TypeIcon size={11} />
                {business ? "Business trip" : "Trip"}
              </button>
            </div>
            <p className="mt-1 text-sm text-surface-500">
              {rangeLabel(trip.startDate, trip.endDate)} · {trip.dates.length} day
              {trip.dates.length === 1 ? "" : "s"}
              {trip.cities.length > 1 ? ` · ${trip.cities.join(" → ")}` : ""}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => void toggleShare()}
              disabled={savingTrip}
              title={
                trip.shareToken
                  ? "Anyone with the link can view this trip. Click to revoke it."
                  : "Create a link anyone can open to view this trip — no sign-in needed"
              }
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium disabled:opacity-50",
                trip.shareToken
                  ? "border-brand-300 bg-brand-50 text-brand-700"
                  : "border-surface-200 text-surface-600 hover:bg-surface-50"
              )}
            >
              <Share2 size={13} />
              {trip.shareToken ? "Shared" : "Share"}
            </button>
            <Link
              href={`/travel/${trip.id}/print`}
              target="_blank"
              title="Outfit cards and packing list, laid out for printing or saving as PDF"
              className="flex items-center gap-1.5 rounded-lg border border-surface-200 px-3 py-2 text-xs font-medium text-surface-600 hover:bg-surface-50"
            >
              <Printer size={13} />
              Print / PDF
            </Link>
          </div>
        </div>

        {trip.shareToken && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-surface-50 px-3 py-2">
            <code className="min-w-0 flex-1 truncate text-[11px] text-surface-600">
              {typeof window === "undefined"
                ? `/trip/${trip.shareToken}`
                : `${window.location.origin}/trip/${trip.shareToken}`}
            </code>
            <button
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(`${window.location.origin}/trip/${trip.shareToken}`)
                  .then(() => toast.success("Link copied"));
              }}
              className="rounded-md border border-surface-200 bg-white px-2 py-1 text-[11px] font-medium text-surface-600"
            >
              Copy
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 rounded-xl border border-surface-200 bg-white p-1">
        {(
          [
            { id: "outfits" as const, label: "Outfits", icon: Shirt },
            { id: "packing" as const, label: "Packing", icon: Luggage },
          ]
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors",
              tab === id ? "bg-surface-900 text-white" : "text-surface-500 hover:bg-surface-50"
            )}
          >
            <Icon size={13} />
            {label}
            {id === "packing" && garments.length > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 text-[10px]",
                  tab === id ? "bg-white/20" : "bg-surface-100"
                )}
              >
                {garments.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-surface-200 bg-white p-10 text-surface-400">
          <Loader2 size={24} className="animate-spin text-brand-500" />
          <p className="text-sm">Loading your trip…</p>
        </div>
      ) : tab === "packing" ? (
        <PackingPanel
          garments={garments}
          packing={packing}
          confirmedCount={trip.confirmedDates.length}
          plannedCount={plannedDates.length}
          saving={savingTrip}
          onChange={(next) => void patchTrip({ packing: next }, "Couldn't save the packing list.")}
          onGoToOutfits={() => setTab("outfits")}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-surface-200 bg-white px-4 py-3">
            <p className="text-sm text-surface-600">
              <span className="font-medium text-surface-900">
                {plannedDates.length} of {days.length} days planned
              </span>
              {trip.confirmedDates.length > 0 && (
                <span className="text-surface-400"> · {trip.confirmedDates.length} confirmed</span>
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {plannedDates.length > trip.confirmedDates.length && (
                <button
                  onClick={() => void confirmAllPlanned()}
                  disabled={savingTrip}
                  className="flex items-center gap-1.5 rounded-lg border border-surface-200 px-3 py-2 text-xs font-medium text-surface-600 hover:bg-surface-50 disabled:opacity-50"
                >
                  <Check size={13} />
                  Confirm all planned
                </button>
              )}
              {unplannedDates.length > 0 && plannedDates.length > 0 && (
                <button
                  onClick={() => void planTrip("fill")}
                  disabled={planning}
                  title="Plan only the days that don't have an outfit yet, keeping the ones that do"
                  className="flex items-center gap-1.5 rounded-lg border border-surface-200 px-3 py-2 text-xs font-medium text-surface-600 hover:bg-surface-50 disabled:opacity-50"
                >
                  {planning ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                  Plan the other {unplannedDates.length}
                </button>
              )}
              <button
                onClick={() => void planTrip(plannedDates.length === 0 ? "fill" : "replan")}
                disabled={planning}
                title={
                  plannedDates.length === 0
                    ? "Plan every day of this trip in one go"
                    : "Replan every day except the ones you've confirmed"
                }
                className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {planning ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {planning
                  ? "Planning…"
                  : plannedDates.length === 0
                    ? "Plan this trip"
                    : "Replan the trip"}
              </button>
            </div>
          </div>

          {truncated && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] leading-relaxed text-amber-700">
              This trip runs {trip.dates.length} days. One generation covers {trip.planDays} of them,
              so the days from {trip.dates[trip.planDays]} onward aren&apos;t shown here — plan those
              from <Link href="/plan" className="underline">This week</Link> once they come closer.
            </p>
          )}

          {week?.warnings && week.warnings.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
                <AlertTriangle size={13} /> Couldn&apos;t avoid every repeat
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {week.warnings.map((warning) => (
                  <li key={warning} className="text-[11px] leading-relaxed text-amber-700">
                    {warning}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <div
              className="grid gap-2"
              style={{
                gridTemplateColumns: `repeat(${days.length}, minmax(6.5rem, 1fr))`,
                minWidth: `${days.length * 6.5}rem`,
              }}
            >
              {days.map((day, index) => (
                <TripDayCell
                  key={day.date}
                  day={day}
                  index={index}
                  selected={day.date === selectedDate}
                  confirmed={confirmed.has(day.date)}
                  onSelect={() => setSelectedDate(day.date)}
                />
              ))}
            </div>
          </div>

          {selected && (
            <TripDayPanel
              day={selected}
              dayIndex={days.findIndex((entry) => entry.date === selected.date)}
              confirmed={confirmed.has(selected.date)}
              savingTrip={savingTrip}
              regenerating={regeneratingDate === selected.date}
              regeneratingSegmentId={regeneratingSegmentId}
              onToggleConfirmed={() => void toggleConfirmed(selected.date)}
              onRegenerate={() => void regenerateDay(selected)}
              onRegenerateSegment={(segment) => void regenerateSegment(selected.date, segment)}
              onEditSegment={(segment, reuseSaved) => {
                setReusingSegmentId(reuseSaved ? segment.id : null);
                setEditingSegmentId(segment.id);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

function TripDayCell({
  day,
  index,
  selected,
  confirmed,
  onSelect,
}: {
  day: WeeklyDay;
  index: number;
  selected: boolean;
  confirmed: boolean;
  onSelect: () => void;
}) {
  const first = day.segments[0];
  const forecasts = day.forecasts?.length ? day.forecasts : day.forecast ? [day.forecast] : [];

  return (
    <button
      onClick={onSelect}
      className={cn(
        "flex flex-col gap-2 rounded-xl border p-2.5 text-left transition-colors",
        selected ? "border-brand-400 bg-brand-50/50" : "border-surface-200 bg-white hover:border-surface-300"
      )}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-surface-400">
          Day {index + 1}
        </span>
        <span className="text-[11px] font-semibold text-surface-700">
          {weekdayShort(day.date)} {dayNumber(day.date)}
        </span>
      </div>

      {forecasts.length > 0 ? (
        <div className="space-y-0.5">
          {forecasts.map((forecast, forecastIndex) => (
            <p
              key={`${forecast.city ?? "location"}-${forecastIndex}`}
              className="flex items-center gap-1 text-[10px] text-surface-500"
            >
              <CloudSun size={11} className="shrink-0" />
              <span className="truncate">
                {forecast.city ? `${forecast.city} ` : ""}
                {forecast.tempMin}°–{forecast.tempMax}°
              </span>
              {/* D2: an estimate is a historical average, never a forecast — and on a
                  trip booked weeks out most days are estimates, so this matters more here. */}
              {forecast.isEstimate && (
                <span className="text-amber-600" title="Historical average, not a forecast">
                  ~
                </span>
              )}
            </p>
          ))}
        </div>
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
          {confirmed && (
            <span className="flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700">
              <Check size={9} /> Confirmed
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function TripDayPanel({
  day,
  dayIndex,
  confirmed,
  savingTrip,
  regenerating,
  regeneratingSegmentId,
  onToggleConfirmed,
  onRegenerate,
  onRegenerateSegment,
  onEditSegment,
}: {
  day: WeeklyDay;
  dayIndex: number;
  confirmed: boolean;
  savingTrip: boolean;
  regenerating: boolean;
  regeneratingSegmentId: string | null;
  onToggleConfirmed: () => void;
  onRegenerate: () => void;
  onRegenerateSegment: (segment: DailySegmentResponse) => void;
  onEditSegment: (segment: DailySegmentResponse, reuseSaved: boolean) => void;
}) {
  return (
    <div className="rounded-xl border border-surface-200 bg-white p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-surface-400">Day {dayIndex + 1}</p>
          <h2 className="text-sm font-semibold text-surface-900">{fullDateLabel(day.date)}</h2>
          {day.occasions.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {day.occasions.map((occasion) => (
                <span
                  key={occasion.id}
                  className="rounded-lg bg-surface-100 px-2.5 py-1.5 text-[10px] font-medium text-surface-600"
                >
                  {occasion.time} · {occasion.title}
                  {occasion.location ? ` · ${occasion.location}` : ""}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-xs text-surface-400">Nothing on the calendar</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {day.segments.length > 0 && (
            <>
              <button
                onClick={onRegenerate}
                disabled={regenerating}
                title="Rebuild every look on this day"
                className="flex items-center gap-1.5 rounded-lg border border-surface-200 px-3 py-2 text-xs font-medium text-surface-600 hover:bg-surface-50 disabled:opacity-40"
              >
                {regenerating ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <RotateCcw size={13} />
                )}
                {regenerating ? "Redoing…" : "Redo this day"}
              </button>
              {/* The confirmation is the whole difference between this page and /plan:
                  the packing list is built from confirmed days only, so packing follows
                  a decision instead of following a suggestion. */}
              <button
                onClick={onToggleConfirmed}
                disabled={savingTrip}
                title={
                  confirmed
                    ? "Take this day off the packing list"
                    : "Confirm you're wearing this, and add its pieces to the packing list"
                }
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50",
                  confirmed
                    ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                    : "bg-surface-900 text-white hover:bg-surface-800"
                )}
              >
                <Check size={13} />
                {confirmed ? "Confirmed" : "Confirm & pack"}
              </button>
            </>
          )}
        </div>
      </div>

      {day.segments.length === 0 ? (
        <p className="text-sm text-surface-400">
          Nothing planned for this day yet. Use “Plan this trip” above to fill the whole trip at
          once.
        </p>
      ) : (
        <div className="space-y-5">
          {day.segments.map((segment, index) => (
            <section
              key={segment.id}
              className="grid gap-4 sm:grid-cols-[minmax(0,13rem)_1fr] sm:items-start"
            >
              <OutfitCollage items={segment.items} layouts={layoutsFromRows(segment.items)} />
              <div className="space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-surface-400">
                      Look {index + 1}
                    </p>
                    <h3 className="text-sm font-semibold text-surface-900">{segment.label}</h3>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
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
                      onClick={() => onEditSegment(segment, true)}
                      disabled={Boolean(regeneratingSegmentId)}
                      title="Replace this look with one of your saved outfits"
                      className="flex items-center gap-1.5 rounded-lg border border-surface-200 px-2.5 py-1.5 text-xs font-medium text-surface-600 hover:bg-surface-50 disabled:opacity-40"
                    >
                      <Layers3 size={13} />
                      Use saved
                    </button>
                    <button
                      onClick={() => onEditSegment(segment, false)}
                      disabled={Boolean(regeneratingSegmentId)}
                      title="Adjust this look on the canvas"
                      className="flex items-center gap-1.5 rounded-lg border border-surface-200 px-2.5 py-1.5 text-xs font-medium text-surface-600 hover:bg-surface-50 disabled:opacity-40"
                    >
                      <Pencil size={13} />
                      Adjust
                    </button>
                    <SegmentSaveButton segment={segment} date={day.date} onSaved={() => undefined} />
                  </div>
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
                      {wardrobeItemLabel(item)}
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
