"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Briefcase,
  CalendarDays,
  Check,
  Loader2,
  MapPin,
  Palmtree,
  Plane,
  RefreshCw,
  Share2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TripListResponse, TripSummary } from "@/types/travel";

function dateRangeLabel(start: string, end: string): string {
  const format = (date: string, withYear: boolean) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
      ...(withYear ? { year: "numeric" } : {}),
    }).format(new Date(`${date}T12:00:00Z`));

  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return start === end ? format(start, true) : `${format(start, false)} – ${format(end, sameYear)}`;
}

function nightsLabel(dates: string[]): string {
  const nights = Math.max(0, dates.length - 1);
  return `${dates.length} day${dates.length === 1 ? "" : "s"}${
    nights > 0 ? ` · ${nights} night${nights === 1 ? "" : "s"}` : ""
  }`;
}

export function TripList() {
  const router = useRouter();
  const [data, setData] = useState<TripListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [openingSignature, setOpeningSignature] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/travel/trips", { cache: "no-store" });
      const next = (await response.json()) as TripListResponse;
      if (!response.ok || next.error) throw new Error(next.error || "Couldn't read your trips.");
      setData(next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't read your trips.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Nothing pulls the calendar automatically — `/api/google/calendar/sync` is
   * caller-driven — and detection over a 30-day window is more exposed to that than
   * `/plan` is: the sync's own default window is 14 days, so a trip three weeks out
   * genuinely isn't in the database until someone presses this.
   */
  async function syncCalendar() {
    setSyncing(true);
    try {
      const now = new Date();
      const timeMax = new Date(now.getTime() + 45 * 86_400_000);
      const response = await fetch(
        `/api/google/calendar/sync?timeMin=${now.toISOString()}&timeMax=${timeMax.toISOString()}`,
        { cache: "no-store" }
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Couldn't reach your calendar.");
      toast.success(
        payload.count > 0
          ? `Synced ${payload.count} event${payload.count === 1 ? "" : "s"}.`
          : "No events found in the next six weeks."
      );
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't reach your calendar.");
    } finally {
      setSyncing(false);
    }
  }

  /**
   * A detected trip has no row until it's opened — see `/api/travel/trips/resolve`.
   * So this is a POST and then a navigation, rather than a plain link.
   */
  async function openTrip(trip: TripSummary) {
    if (trip.id) {
      router.push(`/travel/${trip.id}`);
      return;
    }

    setOpeningSignature(trip.signature);
    try {
      const response = await fetch("/api/travel/trips/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature: trip.signature }),
      });
      const payload = (await response.json()) as { id?: string; error?: string };
      if (!response.ok || !payload.id) throw new Error(payload.error || "Couldn't open that trip.");
      router.push(`/travel/${payload.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't open that trip.");
      setOpeningSignature(null);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-surface-200 bg-white p-10 text-surface-400">
        <Loader2 size={24} className="animate-spin text-brand-500" />
        <p className="text-sm">Looking through your calendar…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-surface-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-surface-600">
          <CalendarDays size={16} className="text-brand-500" />
          <span className="font-medium text-surface-900">
            {data ? dateRangeLabel(data.windowStart, data.windowEnd) : "Next 30 days"}
          </span>
          <span className="text-surface-400">
            · {data?.trips.length ?? 0} trip{(data?.trips.length ?? 0) === 1 ? "" : "s"} found
          </span>
        </div>
        <button
          onClick={() => void syncCalendar()}
          disabled={syncing}
          title="Pull the next six weeks from your Google Calendar"
          className="flex items-center gap-1.5 rounded-lg border border-surface-200 px-3 py-2 text-xs font-medium text-surface-600 hover:bg-surface-50 disabled:opacity-50"
        >
          {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {syncing ? "Syncing…" : "Sync calendar"}
        </button>
      </div>

      {!data || data.trips.length === 0 ? (
        <div className="rounded-2xl border border-surface-200 bg-white py-16 text-center">
          <Plane size={32} className="mx-auto mb-3 text-surface-300" />
          <p className="text-sm text-surface-600">
            {data?.message ?? "No trips on your calendar in the next 30 days."}
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs text-surface-400">
            {data?.calendarConnected
              ? "A trip is found from events away from your home city — a flight, a multi-day entry somewhere else, or a title like “Business Trip (London)”. If one is missing, sync the calendar or check your home city in Profile."
              : "Trips are found from your calendar, so nothing can be detected until it's connected."}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {data.trips.map((trip) => (
            <TripCard
              key={trip.signature}
              trip={trip}
              opening={openingSignature === trip.signature}
              onOpen={() => void openTrip(trip)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TripCard({
  trip,
  opening,
  onOpen,
}: {
  trip: TripSummary;
  opening: boolean;
  onOpen: () => void;
}) {
  const business = trip.tripType === "business";
  const Icon = business ? Briefcase : Palmtree;
  const allPlanned = trip.plannedDays >= trip.dates.length;
  const allConfirmed = trip.confirmedDays >= trip.dates.length;

  return (
    <button
      onClick={onOpen}
      disabled={opening}
      className="flex flex-col gap-3 rounded-2xl border border-surface-200 bg-white p-4 text-left transition-colors hover:border-brand-300 disabled:opacity-60"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-surface-400">
            <MapPin size={11} className="shrink-0" />
            <span className="truncate">{trip.cities.join(" · ")}</span>
          </div>
          <h2 className="mt-0.5 truncate font-display text-lg font-semibold text-surface-900">
            {trip.destination}
          </h2>
        </div>
        <span
          title={`Classified from your calendar: ${trip.typeReason}`}
          className={cn(
            "flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold",
            business ? "bg-surface-900 text-white" : "bg-brand-100 text-brand-700"
          )}
        >
          <Icon size={11} />
          {business ? "Business trip" : "Trip"}
        </span>
      </div>

      <div className="space-y-1">
        <p className="text-sm font-medium text-surface-700">
          {dateRangeLabel(trip.startDate, trip.endDate)}
        </p>
        <p className="text-xs text-surface-400">{nightsLabel(trip.dates)}</p>
      </div>

      {trip.highlights.length > 0 && (
        <ul className="space-y-0.5">
          {trip.highlights.map((highlight) => (
            <li key={highlight} className="truncate text-[11px] text-surface-500">
              {highlight}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-surface-100 pt-3">
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-semibold",
            allPlanned ? "bg-brand-100 text-brand-700" : "bg-surface-100 text-surface-500"
          )}
        >
          {allPlanned
            ? "All days planned"
            : `${trip.plannedDays}/${trip.dates.length} days planned`}
        </span>
        {trip.confirmedDays > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
            <Check size={10} />
            {allConfirmed ? "Confirmed" : `${trip.confirmedDays} confirmed`}
          </span>
        )}
        {trip.shared && (
          <span className="flex items-center gap-1 rounded-full bg-surface-100 px-2 py-0.5 text-[10px] font-semibold text-surface-500">
            <Share2 size={10} />
            Shared
          </span>
        )}
        {opening && <Loader2 size={13} className="ml-auto animate-spin text-brand-500" />}
      </div>
    </button>
  );
}
