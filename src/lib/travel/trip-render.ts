/**
 * Everything the print page and the public share page render, read in one place.
 *
 * Both of those are server-rendered and neither can call `/api/ai/weekly`, so this
 * reads the same stored rows directly. Two things it deliberately does differently
 * from the live trip page:
 *
 * - **Weather comes from the plan's own snapshot**, not from a fresh forecast call.
 *   A printed card should say what the outfit was chosen for; re-fetching would
 *   print today's forecast next to a look decided against last week's.
 * - **It reads every date of the trip**, not just the ones one generation covers, so
 *   a long trip prints whatever exists rather than the first fourteen days.
 */

import { hydrateSegments, readPlansForDates } from "@/lib/planning/plans";
import { garmentsForDays, resolvePackingList } from "@/lib/travel/packing";
import { tripMetaFrom } from "@/lib/travel/trips";
import type { createServerSupabase } from "@/lib/supabase/server";
import type { CalendarEvent, TravelPlan } from "@/types/database";
import type { DailyOccasion, DailyWardrobeItem } from "@/types/daily";
import type { WeeklyDay } from "@/types/weekly";
import type { TripRenderData } from "@/types/travel";

type AnySupabase = Awaited<ReturnType<typeof createServerSupabase>>;

const WARDROBE_SELECT =
  "id, display_name, user_notes, category, subcategory, color, brand, optimized_url, clean_url, original_url";

/**
 * One weather line as a printed card shows it.
 *
 * `outfit_plans.weather` holds `{ locations: [...] }` from both planners, but the
 * entries are different shapes: weekly stores forecast days (`tempMin`/`tempMax`)
 * and daily stores current conditions (`temp`). Rather than teach the pages both,
 * they are flattened to a label here.
 */
export interface PrintedWeather {
  city: string | null;
  summary: string;
  isEstimate: boolean;
}

export function weatherLinesFrom(weather: unknown): PrintedWeather[] {
  const locations =
    weather && typeof weather === "object" && Array.isArray((weather as { locations?: unknown }).locations)
      ? ((weather as { locations: unknown[] }).locations as Record<string, unknown>[])
      : [];

  return locations
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .map((entry) => {
      const city = typeof entry.city === "string" ? entry.city : null;
      if (typeof entry.tempMin === "number" && typeof entry.tempMax === "number") {
        const rain =
          typeof entry.precipitation === "number" && entry.precipitation > 0
            ? `, ${entry.precipitation}mm rain`
            : "";
        return {
          city,
          summary: `${Math.round(entry.tempMin)}°–${Math.round(entry.tempMax)}°C${rain}`,
          isEstimate: Boolean(entry.isEstimate),
        };
      }
      if (typeof entry.temp === "number") {
        const description = typeof entry.description === "string" ? `, ${entry.description}` : "";
        return {
          city,
          summary: `${Math.round(entry.temp)}°C${description}`,
          isEstimate: false,
        };
      }
      return null;
    })
    .filter((entry): entry is PrintedWeather => entry !== null);
}

function formatLocalTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(
    new Date(iso)
  );
}

export async function readTripRenderData(
  supabase: AnySupabase,
  userId: string,
  row: TravelPlan,
  timeZone: string
): Promise<TripRenderData> {
  const meta = tripMetaFrom(row, undefined);
  const plans = await readPlansForDates(supabase, userId, meta.dates);

  const itemIds = [
    ...new Set(
      [...plans.values()].flatMap((bundle) => bundle.segmentItems.map((item) => item.item_id))
    ),
  ];
  const eventIds = [
    ...new Set(
      [...plans.values()].flatMap((bundle) =>
        bundle.segments.flatMap((segment) => segment.event_ids ?? [])
      )
    ),
  ];

  const [{ data: itemRows }, { data: eventRows }] = await Promise.all([
    itemIds.length > 0
      ? supabase.from("wardrobe_items").select(WARDROBE_SELECT).in("id", itemIds).eq("user_id", userId)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    eventIds.length > 0
      ? supabase
          .from("calendar_events")
          .select("id, title, starts_at, all_day, occasion, formality, location, location_override, weather_city")
          .in("id", eventIds)
          .eq("user_id", userId)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  const itemsById = new Map<string, DailyWardrobeItem>(
    ((itemRows || []) as Record<string, unknown>[]).map((item) => [
      String(item.id),
      {
        id: String(item.id),
        display_name: typeof item.display_name === "string" ? item.display_name : null,
        user_notes: typeof item.user_notes === "string" ? item.user_notes : null,
        category: String(item.category),
        subcategory: typeof item.subcategory === "string" ? item.subcategory : null,
        color: typeof item.color === "string" ? item.color : null,
        brand: typeof item.brand === "string" ? item.brand : null,
        optimized_url: typeof item.optimized_url === "string" ? item.optimized_url : null,
        clean_url: typeof item.clean_url === "string" ? item.clean_url : null,
        original_url: String(item.original_url),
      },
    ])
  );

  const eventsById = new Map<string, Partial<CalendarEvent>>(
    ((eventRows || []) as Record<string, unknown>[]).map((event) => [
      String(event.id),
      event as Partial<CalendarEvent>,
    ])
  );

  const days: WeeklyDay[] = meta.dates.map((date) => {
    const bundle = plans.get(date);
    const segments = bundle ? hydrateSegments(bundle, itemsById) : [];
    const occasions: DailyOccasion[] = [
      ...new Set(segments.flatMap((segment) => segment.eventIds)),
    ]
      .map((eventId) => eventsById.get(eventId))
      .filter((event): event is Partial<CalendarEvent> => Boolean(event?.starts_at))
      .map((event) => ({
        id: String(event.id),
        title: event.title || "(untitled)",
        occasion: event.occasion || "unclassified",
        formality: event.formality ?? null,
        time: event.all_day ? "all day" : formatLocalTime(event.starts_at!, timeZone),
        allDay: Boolean(event.all_day),
        location: event.location_override || event.location || event.weather_city || null,
        weatherCity: event.weather_city ?? null,
        locationOverridden: Boolean(event.location_override),
      }))
      .sort((a, b) => a.time.localeCompare(b.time));

    return {
      date,
      planId: bundle?.plan.id ?? null,
      status: bundle?.plan.status ?? "suggested",
      source: bundle?.plan.source ?? "weekly",
      forecast: null,
      forecasts: [],
      occasions,
      segments,
      gap: bundle?.plan.gap || undefined,
      generatedAt: bundle?.plan.generated_at ?? null,
    };
  });

  const packing = resolvePackingList(row.packing_list, meta.tripType);

  return {
    trip: meta,
    days,
    garments: garmentsForDays(days, meta.confirmedDates, packing.packedItemIds),
    packing,
    availableItems: [...itemsById.values()],
  };
}

/** The raw stored weather for one date, so a page can print what the plan was made for. */
export async function readStoredWeatherByDate(
  supabase: AnySupabase,
  userId: string,
  dates: string[]
): Promise<Map<string, PrintedWeather[]>> {
  const { data, error } = await supabase
    .from("outfit_plans")
    .select("plan_date, weather")
    .eq("user_id", userId)
    .in("plan_date", dates)
    .is("travel_plan_id", null);

  if (error) throw error;
  return new Map(
    ((data || []) as { plan_date: string; weather: unknown }[]).map((row) => [
      row.plan_date,
      weatherLinesFrom(row.weather),
    ])
  );
}
