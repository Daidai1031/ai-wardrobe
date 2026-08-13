import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase/server";
import { getForecast } from "@/lib/weather/open-meteo";
import type { DailyForecast } from "@/lib/weather/types";
import {
  effectiveEventLocationLabel,
  effectiveEventWeatherCity,
  weatherLocationsForEvents,
  type WeatherLocation,
} from "@/lib/weather/calendar-location";
import { eventsOnLocalDay } from "@/lib/calendar/day-bucket";
import {
  describeGroups,
  formalityForKind,
  groupOccasions,
  occasionKind,
} from "@/lib/planning/occasion-groups";
import { mergeAdjacentEquivalentSegments } from "@/lib/planning/merge-segments";
import {
  hydrateSegments,
  localDateRange,
  mergeWearHistories,
  readPlansForDates,
  readRotationLimits,
  readWearHistory,
  wearHistoryFromPlans,
  type StoredPlanBundle,
} from "@/lib/planning/plans";
import { selectCandidates } from "@/lib/planning/candidates";
import {
  INCOMPATIBLE_WITH,
  MAX_PER_CATEGORY_IN_SEGMENT,
  MIN_FORMALITY_BANNING_ACTIVEWEAR,
  REQUIRED_SLOTS,
  ROTATION_WINDOW_DAYS,
  buildCandidatePool,
  datesNeedingRepair,
  describeRotationLimits,
  describeViolations,
  enforceComfort,
  enforceComposition,
  enforceCoverage,
  enforceRotation,
  TOO_WARM_FOR_SLEEVES_C,
  enforceWeather,
  findComfortViolations,
  findCompositionViolations,
  findCoverageViolations,
  findRotationViolations,
  findWeatherViolations,
  isActivewear,
  isHardToTravelIn,
  isLongSleeve,
  rotationContext,
  type CandidatePool,
  type RotationContext,
  type RuleDay,
  type RuleSegment,
  type SegmentContext,
} from "@/lib/planning/plan-rules";
import type { CalendarEvent } from "@/types/database";
import type { DailyOccasion, DailyWardrobeItem } from "@/types/daily";
import type { WeeklyDay, WeeklyResponse } from "@/types/weekly";
import { wardrobeItemLabel } from "@/lib/wardrobe/item-label";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

/** Weeks are 7 days from the chosen start, not Mon–Sun: opening /plan on a Saturday should still plan a useful week, and it lines up with Open-Meteo's forecast window starting today. */
const WEEK_LENGTH = 7;
const WARDROBE_SELECT =
  "id, display_name, user_notes, category, subcategory, color, material, season, occasion, style_tags, brand, clean_url, original_url, favorite, times_worn, last_worn_at, archived";

/** A week is only worth persisting if most of it generated; below this it's a failure. */
const MIN_GENERATED_DAYS = 4;

interface GeneratedDay {
  planDate: string;
  gap: string | undefined;
  segments: {
    label: string;
    itemIds: string[];
    eventIds: string[];
    changeFromPrevious: string | undefined;
    reasoning: string;
  }[];
}

function uniqueIds(values: string[]): string[] {
  return [...new Set(values)];
}

function toClientItem(item: Record<string, unknown>): DailyWardrobeItem {
  return {
    id: String(item.id),
    display_name: typeof item.display_name === "string" ? item.display_name : null,
    user_notes: typeof item.user_notes === "string" ? item.user_notes : null,
    category: String(item.category),
    subcategory: typeof item.subcategory === "string" ? item.subcategory : null,
    color: typeof item.color === "string" ? item.color : null,
    brand: typeof item.brand === "string" ? item.brand : null,
    clean_url: typeof item.clean_url === "string" ? item.clean_url : null,
    original_url: String(item.original_url),
  };
}

function formatLocalTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function weekdayLabel(date: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
}

/**
 * Everything shared by the read and generate paths. Mirrors the daily route's
 * loadDailyContext, but over a 7-day window: one events query for the whole span,
 * bucketed per local day by the same eventsOnLocalDay used by daily (6.0-F), so
 * weekly can't develop its own timezone handling.
 */
async function loadWeeklyContext(request: NextRequest) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { unauthorized: true as const };

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("name, city, lat, lng, body_shape, preference_dna, timezone, stylist_share_occasions")
    .eq("id", user.id)
    .single();

  if (profileError) throw profileError;

  const timeZone = request.nextUrl.searchParams.get("timezone") || profile?.timezone || "UTC";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
  const start = request.nextUrl.searchParams.get("start") || today;
  const dates = localDateRange(start, WEEK_LENGTH);

  const [{ data: wardrobeRows, error: wardrobeError }, plans, eventsByDate] = await Promise.all([
    supabase
      .from("wardrobe_items")
      .select(WARDROBE_SELECT)
      .eq("user_id", user.id)
      .eq("archived", false)
      .limit(300),
    readPlansForDates(supabase, user.id, dates),
    readWeekOccasions(supabase, user.id, dates, timeZone),
  ]);

  if (wardrobeError) throw wardrobeError;
  const wardrobe = (wardrobeRows || []) as Record<string, unknown>[];

  return {
    unauthorized: false as const,
    supabase,
    userId: user.id,
    profile,
    timeZone,
    start,
    dates,
    wardrobe,
    availableItems: wardrobe.map(toClientItem),
    plans,
    eventsByDate,
  };
}

/**
 * One query for the whole window, then bucketed per local day. The ±3 day slack
 * matches the daily route: an event near a boundary or spanning days must reach
 * eventsOnLocalDay rather than being cut off by the SQL range first.
 */
async function readWeekOccasions(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  userId: string,
  dates: string[],
  timeZone: string
): Promise<Map<string, { events: CalendarEvent[]; occasions: DailyOccasion[] }>> {
  const result = new Map<string, { events: CalendarEvent[]; occasions: DailyOccasion[] }>();
  if (dates.length === 0) return result;

  const firstAnchor = new Date(`${dates[0]}T00:00:00Z`).getTime();
  const lastAnchor = new Date(`${dates[dates.length - 1]}T00:00:00Z`).getTime();
  const windowStart = new Date(firstAnchor - 3 * 86_400_000).toISOString();
  const windowEnd = new Date(lastAnchor + 3 * 86_400_000).toISOString();

  const { data: rawEvents, error } = await supabase
    .from("calendar_events")
    .select(
      "id, user_id, google_event_id, title, location, location_override, weather_city, weather_lat, weather_lng, weather_timezone, weather_city_override, weather_lat_override, weather_lng_override, weather_timezone_override, weather_location_resolved, starts_at, ends_at, all_day, attendee_count, occasion, formality, companion, stylist_share_detail, synced_at"
    )
    .eq("user_id", userId)
    .gte("starts_at", windowStart)
    .lte("starts_at", windowEnd);

  if (error) throw error;
  const events = (rawEvents || []) as CalendarEvent[];

  for (const date of dates) {
    const dayEvents = eventsOnLocalDay(events, date, timeZone).sort((a, b) =>
      a.starts_at.localeCompare(b.starts_at)
    );
    result.set(date, {
      events: dayEvents,
      occasions: dayEvents.map((event) => ({
        id: event.id,
        title: event.title || "(untitled)",
        occasion: event.occasion || "unclassified",
        formality: event.formality ?? null,
        time: event.all_day ? "all day" : formatLocalTime(event.starts_at, timeZone),
        allDay: Boolean(event.all_day),
        location: effectiveEventLocationLabel(event),
        weatherCity: effectiveEventWeatherCity(event),
        locationOverridden: Boolean(event.location_override),
        sharedWithStylist: Boolean(event.stylist_share_detail),
      })),
    });
  }

  return result;
}

function buildWeeklyResponse(
  dates: string[],
  plans: Map<string, StoredPlanBundle>,
  eventsByDate: Map<string, { events: CalendarEvent[]; occasions: DailyOccasion[] }>,
  forecastByDate: Map<string, DailyForecast[]>,
  wardrobe: Record<string, unknown>[],
  extras: Partial<WeeklyResponse> = {}
): WeeklyResponse {
  const byId = new Map(wardrobe.map((item) => [String(item.id), toClientItem(item)]));

  const days: WeeklyDay[] = dates.map((date) => {
    const bundle = plans.get(date);
    const forecasts = forecastByDate.get(date) ?? [];
    return {
      date,
      planId: bundle?.plan.id ?? null,
      status: bundle?.plan.status ?? "suggested",
      source: bundle?.plan.source ?? "weekly",
      forecast: forecasts[0] ?? null,
      forecasts,
      occasions: eventsByDate.get(date)?.occasions ?? [],
      segments: bundle ? hydrateSegments(bundle, byId) : [],
      gap: bundle?.plan.gap || undefined,
      generatedAt: bundle?.plan.generated_at ?? null,
    };
  });

  return {
    start: dates[0],
    end: dates[dates.length - 1],
    days,
    availableItems: wardrobe.map(toClientItem),
    complete: days.every((day) => day.segments.length > 0),
    ...extras,
  };
}

async function forecastForWindow(
  profile: {
    city?: string | null;
    lat?: number | null;
    lng?: number | null;
    timezone?: string | null;
  } | null,
  dates: string[],
  eventsByDate: Map<string, { events: CalendarEvent[] }>,
  timeZone: string
): Promise<Map<string, DailyForecast[]>> {
  const byDate = new Map<string, DailyForecast[]>();

  const groups = new Map<string, { location: WeatherLocation; dates: string[] }>();
  for (const date of dates) {
    const locations = weatherLocationsForEvents(
      eventsByDate.get(date)?.events ?? [],
      profile,
      date,
      timeZone
    );
    for (const location of locations) {
      const key = `${location.lat.toFixed(4)},${location.lng.toFixed(4)}`;
      const group = groups.get(key) ?? { location, dates: [] };
      if (!group.dates.includes(date)) group.dates.push(date);
      groups.set(key, group);
    }
  }

  try {
    const todayUtc = new Date().toISOString().slice(0, 10);
    await Promise.all(
      [...groups.values()].map(async ({ location, dates: locationDates }) => {
        // getForecast counts from today; ask only for enough days to reach the
        // last date that actually uses this coordinate.
        const lastDate = locationDates[locationDates.length - 1];
        const offset = Math.round(
          (new Date(`${lastDate}T00:00:00Z`).getTime() -
            new Date(`${todayUtc}T00:00:00Z`).getTime()) /
            86_400_000
        );
        const wanted = new Set(locationDates);
        for (const entry of await getForecast(location.lat, location.lng, Math.max(1, offset + 1))) {
          if (wanted.has(entry.date)) {
            const current = byDate.get(entry.date) ?? [];
            current.push({ ...entry, city: location.city });
            byDate.set(entry.date, current);
          }
        }
      })
    );
  } catch (error) {
    // Weather is an input, not a requirement — a week without it is still a week.
    console.error("Weekly forecast error:", error);
  }
  return byDate;
}

function parseWeeklyPlan(
  text: string,
  validDates: Set<string>,
  validItemIds: Set<string>,
  validEventIdsByDate: Map<string, Set<string>>
): GeneratedDay[] {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return [];

  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    if (!Array.isArray(parsed.days)) return [];

    const optionalText = (value: unknown) =>
      typeof value === "string" && value.trim() ? value.trim() : undefined;

    return parsed.days
      .filter((day): day is Record<string, unknown> => typeof day === "object" && day !== null)
      .map((day) => {
        const planDate = typeof day.planDate === "string" ? day.planDate : "";
        if (!validDates.has(planDate)) return null;

        const validEventIds = validEventIdsByDate.get(planDate) ?? new Set<string>();
        const segments = Array.isArray(day.segments)
          ? day.segments
              .filter(
                (segment): segment is Record<string, unknown> =>
                  typeof segment === "object" && segment !== null
              )
              .map((segment) => ({
                label: optionalText(segment.label) || "Outfit",
                itemIds: Array.isArray(segment.itemIds)
                  ? uniqueIds(
                      segment.itemIds.filter(
                        (id): id is string => typeof id === "string" && validItemIds.has(id)
                      )
                    )
                  : [],
                // An event id is only valid on the day it actually falls on; the
                // model sees the whole week and can otherwise attach Tuesday's
                // meeting to Wednesday's outfit.
                eventIds: Array.isArray(segment.eventIds)
                  ? uniqueIds(
                      segment.eventIds.filter(
                        (id): id is string => typeof id === "string" && validEventIds.has(id)
                      )
                    )
                  : [],
                changeFromPrevious: optionalText(segment.changeFromPrevious),
                reasoning: typeof segment.reasoning === "string" ? segment.reasoning.trim() : "",
              }))
              .filter((segment) => segment.itemIds.length > 0)
          : [];

        if (segments.length === 0) return null;
        return { planDate, gap: optionalText(day.gap), segments };
      })
      .filter((day): day is GeneratedDay => day !== null);
  } catch {
    return [];
  }
}

/**
 * One targeted follow-up call that rebuilds only the days breaking a rule, leaving
 * the rest of the week alone. A repair pass rather than a stricter prompt because
 * the prompt already states the rules and the model still broke them; naming the
 * specific item and date gives it something to act on instead of a rule to re-read.
 * Deliberately one attempt — if the wardrobe genuinely can't fill seven days,
 * retrying just burns tokens, and the caller reports what's left.
 */
async function repairPlan(
  days: GeneratedDay[],
  candidateSummary: unknown[],
  labelFor: (itemId: string) => string,
  categoryFor: (itemId: string) => string,
  isLongSleeveFor: (itemId: string) => boolean,
  tempFor: (planDate: string) => number | null,
  segmentContextFor: (segment: RuleSegment) => SegmentContext,
  isHardToTravelInFor: (itemId: string) => boolean,
  isActivewearFor: (itemId: string) => boolean,
  rotationCtx: RotationContext,
  validItemIds: Set<string>,
  validEventIdsByDate: Map<string, Set<string>>
): Promise<GeneratedDay[]> {
  const rotation = findRotationViolations(days as RuleDay[], categoryFor, rotationCtx);
  const composition = findCompositionViolations(days as RuleDay[], categoryFor);
  const coverage = findCoverageViolations(days as RuleDay[], categoryFor);
  const weather = findWeatherViolations(days as RuleDay[], isLongSleeveFor, tempFor);
  const comfort = findComfortViolations(
    days as RuleDay[],
    segmentContextFor,
    isHardToTravelInFor,
    isActivewearFor,
    categoryFor
  );
  if (
    rotation.length === 0 &&
    composition.length === 0 &&
    coverage.length === 0 &&
    weather.length === 0 &&
    comfort.length === 0
  ) {
    return days;
  }

  const targets = datesNeedingRepair(rotation, composition, coverage, weather, comfort);
  const problemsByDate = describeViolations(
    rotation,
    composition,
    coverage,
    weather,
    comfort,
    labelFor
  );

  const currentWeek = days.map((day) => ({
    planDate: day.planDate,
    action: targets.includes(day.planDate) ? "REBUILD THIS DAY" : "keep exactly as is",
    segments: day.segments.map((segment) => ({
      label: segment.label,
      items: segment.itemIds.map((id) => `${labelFor(id)} [${categoryFor(id)}] (${id})`),
    })),
  }));

  const systemPrompt = `You are fixing rule violations in an otherwise finished week plan.

RULE 1 — HOW MANY DAYS OF THE WEEK the same piece may be worn on (the user set these):
${JSON.stringify(describeRotationLimits(rotationCtx.limits), null, 2)}
This counts DAYS, not appearances. Repeats WITHIN one day are always fine: one blazer can carry through several segments of the same day and that is still one day.

RULE 2 — HOW MANY OF EACH CATEGORY MAY BE WORN AT ONCE in a single segment:
${JSON.stringify(MAX_PER_CATEGORY_IN_SEGMENT, null, 2)}
These are hard caps on the whole segment, not per-occasion. Two pairs of trousers in one outfit is never valid; two tops (a shirt under a cardigan) is.

RULE 3b — NOTHING WITH SLEEVES ABOVE ${TOO_WARM_FOR_SLEEVES_C}°C. On a day whose forecast high exceeds that, use no outerwear at all and no long-sleeve tops or dresses.

RULE 3 — ITEMS THAT CANNOT BE WORN TOGETHER in one segment:
${JSON.stringify(INCOMPATIBLE_WITH, null, 2)}
A dress already covers torso and legs, so it is never combined with a top or with trousers.

RULE 4 — EVERY SEGMENT MUST BE A COMPLETE OUTFIT. Each of these slots needs at least one item (a dress covers both torso and legs):
${JSON.stringify(REQUIRED_SLOTS, null, 2)}

RULE 5 — A SEGMENT SPENT TRAVELLING IS DRESSED FOR THE JOURNEY, NOT THE DESTINATION. A flight, train, long drive or airport transfer means flat shoes that come off easily (never heels), soft or stretch fabrics that survive hours of sitting, and a layer that can be added or removed for the cabin. A business trip's flight is still a flight: the tailoring belongs on the meeting, not on the plane.

RULE 6 — SPORT IS DRESSED AS SPORT, AND CHANGED OUT OF AFTERWARDS. A workout, a match or a round of golf gets real activewear and the right shoes for that activity — a client match at a club is still sport, not smart-casual. Because it is sweated in, nothing worn in that segment may appear in ANY later segment of the same day; the next segment is a complete change of clothes. Bags and accessories are exempt.

RULE 7 — AND THE REVERSE: NO SPORT KIT AT A FORMAL OCCASION. A segment whose formality is ${MIN_FORMALITY_BANNING_ACTIVEWEAR} or higher never wears activewear — no leggings, joggers, track pieces, sweatpants, gym tops or running shoes — however comfortable or expensive they are. This does not apply to segments that ARE sport; those are already capped at a low formality.

THE WEEK AS PLANNED (each item shows its [category]):
${JSON.stringify(currentWeek, null, 2)}

SPECIFIC CONFLICTS TO FIX:
${JSON.stringify(problemsByDate, null, 2)}

CANDIDATE WARDROBE (the only items you may use):
${JSON.stringify(candidateSummary, null, 2)}

A non-empty wardrobe "name" is the user's authoritative name for that piece. Use it verbatim in reasoning and never reduce it to a generic color/type label. Treat "userNotes" as authoritative fit, comfort, provenance, and wearing constraints.

Rebuild ONLY the days marked "REBUILD THIS DAY". For each, fix the listed problems — replace a too-soon repeat with a different candidate, and drop or swap the surplus item where too many of one category are worn at once — keeping the look appropriate for that day's occasions and updating the reasoning to match. Leave every other item on those days alone if it causes no conflict. Do not touch any other day. Do not introduce a NEW conflict: check your replacements against both rules and against the rest of the week.

Respond with ONLY this JSON containing just the rebuilt days, no other text:
{
  "days": [
    {
      "planDate": "YYYY-MM-DD",
      "gap": "optional wardrobe gap; omit if none",
      "segments": [
        {
          "label": "short label naming the actual occasion(s)",
          "itemIds": ["<wardrobe id>", "<wardrobe id>"],
          "eventIds": ["<calendar event id from THAT day only>"],
          "changeFromPrevious": "what changed from the prior segment of the SAME day; omit for the first",
          "reasoning": "1-2 sentences on why this works"
        }
      ]
    }
  ]
}`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: "user", content: "Fix the conflicting days." }],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    const rebuilt = parseWeeklyPlan(
      textBlock && textBlock.type === "text" ? textBlock.text : "",
      new Set(targets),
      validItemIds,
      validEventIdsByDate
    );

    const byDate = new Map(rebuilt.map((day) => [day.planDate, day]));
    return days.map((day) => byDate.get(day.planDate) ?? day);
  } catch (error) {
    // A failed repair must not lose the week that was already generated.
    console.error("Weekly rotation repair error:", error);
    return days;
  }
}

/**
 * GET is read-only — it never calls Claude. This deliberately differs from the
 * daily route, which generates on a cache miss: a daily pick is one small call the
 * user expects automatically, whereas a week is a large call over the whole
 * wardrobe. Opening /plan should show what the week holds (forecast, calendar,
 * whatever is already planned) and let the user decide to spend a generation.
 */
export async function GET(request: NextRequest) {
  try {
    const context = await loadWeeklyContext(request);
    if (context.unauthorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const forecastByDate = await forecastForWindow(
      context.profile,
      context.dates,
      context.eventsByDate,
      context.timeZone
    );
    return NextResponse.json(
      buildWeeklyResponse(
        context.dates,
        context.plans,
        context.eventsByDate,
        forecastByDate,
        context.wardrobe,
        { stylistShareOccasions: Boolean(context.profile?.stylist_share_occasions) }
      )
    );
  } catch (error) {
    console.error("Weekly plan read error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't load the week" },
      { status: 500 }
    );
  }
}

/**
 * POST generates the week. The cross-day constraints in the prompt are the entire
 * reason weekly exists as its own call rather than seven daily ones: no daily
 * generation can know what the user is wearing on Thursday.
 */
export async function POST(request: NextRequest) {
  try {
    const context = await loadWeeklyContext(request);
    if (context.unauthorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { supabase, userId, profile, timeZone, dates, wardrobe, eventsByDate } =
      context;

    if (wardrobe.length < 4) {
      return NextResponse.json(
        buildWeeklyResponse(dates, context.plans, eventsByDate, new Map(), wardrobe, {
          message: "Add a few more items to your closet before planning a whole week.",
          stylistShareOccasions: Boolean(profile?.stylist_share_occasions),
        })
      );
    }

    const forecastByDate = await forecastForWindow(profile, dates, eventsByDate, timeZone);

    // D8: hard-filter in TypeScript before the prompt. Temperature and formality
    // bounds come from the week itself, so a week of 28°C days never offers coats.
    const temps = dates
      .flatMap((date) => forecastByDate.get(date) ?? [])
      .filter((entry): entry is DailyForecast => Boolean(entry));
    const formalityLevels = uniqueIds(
      dates.flatMap((date) =>
        (eventsByDate.get(date)?.occasions ?? [])
          .map((occasion) => occasion.formality)
          .filter((level): level is number => typeof level === "number")
          .map(String)
      )
    ).map(Number);

    const wardrobeById = new Map(wardrobe.map((item) => [String(item.id), item]));
    const labelFor = (itemId: string) => {
      const item = wardrobeById.get(itemId);
      return item
        ? wardrobeItemLabel({
            display_name: item.display_name as string | null,
            category: String(item.category),
            subcategory: item.subcategory as string | null,
            color: item.color as string | null,
            brand: item.brand as string | null,
          })
        : itemId;
    };
    const categoryFor = (itemId: string) => String(wardrobeById.get(itemId)?.category ?? "");

    // The rotation limits are the user's, not the code's (schema section 19).
    // Everything downstream — the prompt text, the repair brief, the deterministic
    // pass and the warnings — reads this one resolved map, so there is no path that
    // can still be judging by the old defaults.
    const rotationLimits = await readRotationLimits(supabase, userId);

    // What the days AROUND this window already commit to. Without it a "once a
    // week" limit silently restarted every Monday, and one of the two complaints
    // that started this — the same clutch and the same sandals every single week —
    // was invisible to the rules.
    const windowStartsAt = new Date(`${dates[0]}T00:00:00Z`).getTime();
    const historyDates = localDateRange(
      new Date(windowStartsAt - (ROTATION_WINDOW_DAYS - 1) * 86_400_000).toISOString().slice(0, 10),
      ROTATION_WINDOW_DAYS - 1
    );
    const priorHistory = await readWearHistory(supabase, userId, historyDates);
    // Days already confirmed worn inside the window are never overwritten, so what
    // they actually contain — not what this generation imagines for them — is what
    // the other days have to rotate around.
    const wornHistory = wearHistoryFromPlans(
      new Map(
        [...context.plans.entries()].filter(([, bundle]) => bundle.plan.status === "worn")
      )
    );
    const rotation = rotationContext(
      rotationLimits,
      mergeWearHistories(priorHistory, wornHistory)
    );
    const recentlyPlannedIds = new Set(rotation.history.keys());

    const { items: candidates, relaxedTo } = selectCandidates(
      wardrobe.map((item) => ({
        id: String(item.id),
        category: String(item.category),
        season: (item.season as string[] | null) ?? null,
        occasion: (item.occasion as string[] | null) ?? null,
        favorite: Boolean(item.favorite),
        times_worn: (item.times_worn as number | null) ?? 0,
        last_worn_at: (item.last_worn_at as string | null) ?? null,
        raw: item,
      })),
      {
        tempMin: temps.length > 0 ? Math.min(...temps.map((t) => t.tempMin)) : 15,
        tempMax: temps.length > 0 ? Math.max(...temps.map((t) => t.tempMax)) : 25,
        formalityLevels,
        recentlyPlannedIds,
      }
    );
    if (relaxedTo !== "both") {
      console.info(`Weekly candidate filter relaxed to "${relaxedTo}" for user ${userId}`);
    }

    const candidateSummary = candidates.map((candidate) => {
      const item = candidate.raw;
      return {
        id: item.id,
        name: item.display_name || null,
        type: `${item.category} — ${item.subcategory || "unknown"}`,
        color: item.color,
        material: item.material,
        seasons: item.season,
        occasions: item.occasion,
        tags: item.style_tags,
        lastWorn: item.last_worn_at || "never",
        userNotes: item.user_notes || null,
      };
    });

    const weekOutline = dates.map((date) => {
      const forecasts = forecastByDate.get(date) ?? [];
      return {
        planDate: date,
        day: weekdayLabel(date, timeZone),
        weather:
          forecasts.length > 0
            ? forecasts.map((forecast) => ({
              city: forecast.city,
              tempMin: forecast.tempMin,
              tempMax: forecast.tempMax,
              precipitationMm: forecast.precipitation,
              isEstimate: forecast.isEstimate,
              }))
            : "unknown",
        // Segment count per day is decided here rather than by the model: grouping
        // consecutive occasions by formality is arithmetic, and leaving it to
        // judgement gave the same day two segments on one run and one on the next.
        requiredSegments: describeGroups(groupOccasions(eventsByDate.get(date)?.occasions ?? [])),
        alreadyWorn: context.plans.get(date)?.plan.status === "worn",
      };
    });

    const systemPrompt = `You are an expert personal stylist AI. Plan the user's outfits for the next ${WEEK_LENGTH} days from their ACTUAL wardrobe below — never invent items.

THE WEEK (each entry is one local date):
${JSON.stringify(weekOutline, null, 2)}

USER PROFILE:
${profile ? `Name: ${profile.name || "User"}, Body Shape: ${profile.body_shape || "Unknown"}` : "No profile data"}
${profile?.preference_dna ? `Preferences: ${JSON.stringify(profile.preference_dna)}` : ""}

CANDIDATE WARDROBE (${candidateSummary.length} items, already filtered to this week's weather and formality):
${JSON.stringify(candidateSummary, null, 2)}

A non-empty wardrobe "name" is the user's authoritative name for that piece. Use it verbatim in reasoning and never reduce it to a generic color/type label. Treat "userNotes" as authoritative fit, comfort, provenance, and wearing constraints.

Each day lists "requiredSegments". Build EXACTLY those, in that order, one segment per entry, and set each segment's "eventIds" to exactly the entry's "eventIds". A day with an empty "requiredSegments" gets exactly ONE segment. Do not merge or split them further — the grouping already accounts for which occasions can share an outfit. Segments within the same day MAY share items; carrying one blazer from a meeting into dinner is normal.

If the exact same complete outfit works for two adjacent required entries, reuse the exact same "itemIds" for both; do not manufacture an accessory change just to make the occasions look different. Keep both entries in the response; equivalent adjacent segments will be consolidated after generation.

Each required segment carries a "kind". A segment whose kind is not "general" is dressed for what it IS, not for how formal the rest of the day is, and moving into or out of one is where a complete change of outfit is expected rather than avoided:
- "transit" — time spent getting somewhere: a flight, a train, a long drive, an airport transfer. Flat shoes that come off easily (never heels), soft or stretch fabrics that survive hours of sitting, nothing that creases or restricts, and a layer for a cold cabin. A business trip's flight is still a flight — keep the tailoring for the meetings.
- "athletic" — sport or a workout: real activewear and the right shoes for that activity, never office clothes made casual. Golf and tennis are the ones to get right, because they sit in the middle of a working day and often at a club: dress them as sport with the club's code in mind (a collared polo, proper court or golf shoes, tennis whites where the wardrobe has them), not as smart-casual. Say in the reasoning which pieces are the sport-appropriate ones.
  Anything worn for sport is sweated in, so NOTHING from an athletic segment reappears in any later segment of that same day — the following segment is a complete change of clothes. Bags and accessories are the exception; the same tote before and after is fine.

Items that cannot be worn together in one segment:
${JSON.stringify(INCOMPATIBLE_WITH, null, 2)}
A dress already covers torso and legs, so it is never combined with a top or with trousers. Layer with outerwear instead.

Each day's "weather" is a list because departure and return days can span two cities. When multiple locations are listed, the outfit must work across ALL of them: prefer removable layers and explicitly reason about the coldest and warmest conditions. Only when EVERY listed location's forecast high exceeds ${TOO_WARM_FOR_SLEEVES_C}°C should you use no outerwear and no long-sleeve tops or dresses.

WITHIN one segment, at most this many items of each category can physically be worn at once:
${JSON.stringify(MAX_PER_CATEGORY_IN_SEGMENT, null, 2)}
These are hard caps on the whole segment, not per-occasion. Two pairs of trousers in one outfit is never valid; two tops (a shirt under a cardigan) is.

ACROSS days, these constraints are the whole point of planning a week at once. Respect all of them:
1. How many DAYS of this week each piece may be worn on, by category — these are the user's own settings, not defaults:
${JSON.stringify(describeRotationLimits(rotationLimits), null, 2)}
   This counts days, not appearances: a blazer worn in three segments of one day has used one day. "At most 1 day out of any 7" means a piece worn on Tuesday is unavailable for the rest of the week.
2. Beyond the numeric limit: a statement piece (bold color or print, distinctive silhouette, anything memorable) should ideally appear only ONCE in the whole window, even where the table would technically allow a second day.
3. Spread the week across the wardrobe. Do not build seven outfits out of the same dozen favourites while other perfectly good pieces sit unused — if two candidates work equally well, take the one you haven't used yet.
${
  recentlyPlannedIds.size > 0
    ? `4. These items are ALREADY worn on the days immediately before this window, and those days count toward the same weekly limits, so most of them are unavailable now:\n${JSON.stringify(
        [...recentlyPlannedIds].map(
          (itemId) =>
            `${labelFor(itemId)} — worn ${(rotation.history.get(itemId) ?? []).join(", ")}`
        ),
        null,
        2
      )}`
    : "4. There is nothing already planned in the days before this window."
}
5. Cover the full range of formality the week's calendar actually calls for — don't plan seven interchangeable outfits.
6. NO SPORT KIT AT A FORMAL OCCASION. A segment whose formality is ${MIN_FORMALITY_BANNING_ACTIVEWEAR} or higher never wears activewear — no leggings, joggers, track pieces, sweatpants, gym tops or running shoes — however comfortable they are. Segments that ARE sport are exempt; they are already capped at a low formality.
7. Days marked "alreadyWorn": true are already confirmed and will be ignored. Still return them so the week reads as a whole, but treat their items as unavailable for the other days.

Respond with ONLY this JSON, no other text:
{
  "days": [
    {
      "planDate": "YYYY-MM-DD (must match one of the dates above)",
      "gap": "optional wardrobe gap for this day; omit if none",
      "segments": [
        {
          "label": "short label naming the actual occasion(s), never generic morning/evening wording",
          "itemIds": ["<wardrobe id>", "<wardrobe id>"],
          "eventIds": ["<calendar event id from THAT day only>"],
          "changeFromPrevious": "what changed from the prior segment of the SAME day; omit for the first",
          "reasoning": "1-2 sentences on why this works"
        }
      ]
    }
  ]
}`;

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{ role: "user", content: "Plan the week." }],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    const generated = parseWeeklyPlan(
      textBlock && textBlock.type === "text" ? textBlock.text : "",
      new Set(dates),
      new Set(candidates.map((candidate) => candidate.id)),
      new Map(
        dates.map((date) => [
          date,
          new Set((eventsByDate.get(date)?.events ?? []).map((event) => event.id)),
        ])
      )
    );

    const isLongSleeveFor = (itemId: string) => {
      const item = wardrobeById.get(itemId);
      return item
        ? isLongSleeve({
            category: String(item.category),
            subcategory: item.subcategory as string | null,
            material: item.material as string | null,
          })
        : false;
    };
    // The week has a real daily maximum; the daily route only has a single
    // representative temperature, so the two differ slightly in strictness.
    // The "too hot for sleeves" hard rule applies only when every place on a
    // travel day is hot. If New York is warm but London is cool, the prompt can
    // choose removable layers instead of the rule engine deleting all sleeves.
    const tempFor = (planDate: string) => {
      const forecasts = forecastByDate.get(planDate) ?? [];
      return forecasts.length > 0 ? Math.min(...forecasts.map((entry) => entry.tempMax)) : null;
    };

    // What a segment is, is a fact about the calendar — resolved from the events
    // themselves rather than from the label the model chose to write on it.
    const eventFactsById = new Map(
      dates.flatMap((date) =>
        (eventsByDate.get(date)?.events ?? []).map((event) => {
          const kind = occasionKind({
            occasion: event.occasion,
            title: event.title,
            allDay: event.all_day,
          });
          return [
            event.id,
            { kind, formality: formalityForKind(event.formality ?? null, kind) },
          ] as const;
        })
      )
    );
    // Athletic wins a mixed segment: it is the stricter of the two, since its
    // clothes also can't come back later in the day. Formality is the highest of
    // the segment's events, already capped by kind, so an athletic segment stays
    // at 2 and keeps its activewear.
    const segmentContextFor = (segment: RuleSegment): SegmentContext => {
      const facts = (segment.eventIds ?? [])
        .map((eventId) => eventFactsById.get(eventId))
        .filter((entry): entry is { kind: SegmentContext["kind"]; formality: number | null } =>
          Boolean(entry)
        );
      const kinds = facts.map((entry) => entry.kind);
      const formalities = facts
        .map((entry) => entry.formality)
        .filter((value): value is number => typeof value === "number");
      return {
        kind: kinds.includes("athletic")
          ? "athletic"
          : kinds.includes("transit")
            ? "transit"
            : "general",
        formality: formalities.length > 0 ? Math.max(...formalities) : null,
      };
    };
    const isActivewearFor = (itemId: string) => {
      const item = wardrobeById.get(itemId);
      return item
        ? isActivewear({
            category: String(item.category),
            subcategory: item.subcategory as string | null,
            display_name: item.display_name as string | null,
            occasion: (item.occasion as string[] | null) ?? null,
            style_tags: (item.style_tags as string[] | null) ?? null,
          })
        : false;
    };
    const isHardToTravelInFor = (itemId: string) => {
      const item = wardrobeById.get(itemId);
      return item
        ? isHardToTravelIn({
            category: String(item.category),
            subcategory: item.subcategory as string | null,
            display_name: item.display_name as string | null,
          })
        : false;
    };

    const validItemIds = new Set(candidates.map((candidate) => candidate.id));
    const validEventIdsByDate = new Map(
      dates.map((date) => [
        date,
        new Set((eventsByDate.get(date)?.events ?? []).map((event) => event.id)),
      ])
    );

    // D8 applied to the plan itself, not just to the candidate set. Stating the
    // rules in the prompt was not enough — the first real week repeated the same
    // shoes on three consecutive days, the second put two pairs of trousers in one
    // outfit — so they are checked here and repaired in one targeted call.
    const repaired = await repairPlan(
      generated,
      candidateSummary,
      labelFor,
      categoryFor,
      isLongSleeveFor,
      tempFor,
      segmentContextFor,
      isHardToTravelInFor,
      isActivewearFor,
      rotation,
      validItemIds,
      validEventIdsByDate
    );

    // Last line of defence, after the model has had its chance. Three rounds of
    // "the prompt says so and it did it anyway" is enough evidence that these
    // invariants must be guaranteed rather than requested, so they are enforced in
    // code — trim what can't be worn together, fill what's missing, then swap out
    // repeats that are too close. Order matters: coverage may introduce a repeat,
    // so rotation runs last.
    const pool: CandidatePool = buildCandidatePool(
      candidates.map((candidate) => candidate.id),
      categoryFor
    );
    const finalDays = enforceRotation(
      enforceComfort(
        enforceCoverage(
          enforceWeather(
            enforceComposition(repaired as RuleDay[], categoryFor),
            categoryFor,
            isLongSleeveFor,
            tempFor,
            pool,
            rotation
          ),
          categoryFor,
          pool,
          rotation,
          (itemId, planDate) => {
            const temp = tempFor(planDate);
            return temp != null && temp > TOO_WARM_FOR_SLEEVES_C && isLongSleeveFor(itemId);
          }
        ),
        categoryFor,
        segmentContextFor,
        isHardToTravelInFor,
        isActivewearFor,
        pool,
        rotation
      ),
      categoryFor,
      pool,
      rotation
    ) as GeneratedDay[];

    const consolidatedDays = finalDays.map((day) => ({
      ...day,
      segments: mergeAdjacentEquivalentSegments(day.segments),
    }));

    // Named as the user's own setting rather than as an abstract rule. The same
    // sentence reads as an honest closet limit when it says "you asked for at most
    // 2 days and you own 3 pairs", and as the planner being careless when it
    // doesn't.
    const ownedByCategory = new Map<string, number>();
    for (const item of wardrobe) {
      const category = String(item.category);
      ownedByCategory.set(category, (ownedByCategory.get(category) ?? 0) + 1);
    }

    const warnings = [
      ...findRotationViolations(consolidatedDays as RuleDay[], categoryFor, rotation).map(
        (violation) =>
          `"${labelFor(violation.itemId)}" is on ${violation.daysUsed} days of this week (${violation.otherDates.join(", ")} and ${violation.conflictDate}). You've set ${violation.category} to at most ${violation.maxDays} day${violation.maxDays === 1 ? "" : "s"} a week, and your closet has ${ownedByCategory.get(violation.category) ?? 0} of them — there was nothing else free to swap in.`
      ),
      ...findCoverageViolations(consolidatedDays as RuleDay[], categoryFor).map(
        (violation) =>
          `${violation.planDate} has no ${violation.missingSlot} covered — your closet has nothing suitable left (${violation.anyOf.join(" or ")}).`
      ),
      ...findWeatherViolations(consolidatedDays as RuleDay[], isLongSleeveFor, tempFor).map(
        (violation) =>
          `"${labelFor(violation.itemId)}" covers the arms but ${violation.planDate} reaches ${violation.temp}°C.`
      ),
      ...findComfortViolations(
        consolidatedDays as RuleDay[],
        segmentContextFor,
        isHardToTravelInFor,
        isActivewearFor,
        categoryFor
      ).map((violation) => {
        if (violation.reason === "sweat") {
          return `${violation.planDate} puts "${labelFor(violation.itemId)}" back on after a workout — your closet has nothing else free that day to change into.`;
        }
        if (violation.reason === "transit") {
          return `${violation.planDate} is spent travelling in "${labelFor(violation.itemId)}" — your closet has no flatter shoes free that day.`;
        }
        return `${violation.planDate} has a formal occasion wearing "${labelFor(violation.itemId)}", which is sport kit — your closet has nothing else free for it that day.`;
      }),
    ];

    if (consolidatedDays.length < Math.min(MIN_GENERATED_DAYS, dates.length)) {
      return NextResponse.json(
        buildWeeklyResponse(dates, context.plans, eventsByDate, forecastByDate, wardrobe, {
          message:
            "Couldn't put together a full week right now. Try again, or plan individual days from Home.",
          stylistShareOccasions: Boolean(profile?.stylist_share_occasions),
        })
      );
    }

    const { data: skipped, error: persistError } = await supabase.rpc("replace_weekly_plans", {
      p_days: consolidatedDays.map((day) => ({
        planDate: day.planDate,
        gap: day.gap ?? null,
        weather: { locations: forecastByDate.get(day.planDate) ?? [] },
        segments: day.segments,
      })),
    });

    if (persistError) throw persistError;

    const persisted = await readPlansForDates(supabase, userId, dates);
    return NextResponse.json(
      buildWeeklyResponse(dates, persisted, eventsByDate, forecastByDate, wardrobe, {
        skippedDates: Array.isArray(skipped) ? (skipped as string[]) : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
        stylistShareOccasions: Boolean(profile?.stylist_share_occasions),
      })
    );
  } catch (error) {
    console.error("Weekly plan generation error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Weekly planning failed" },
      { status: 500 }
    );
  }
}
