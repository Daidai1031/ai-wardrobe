import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase/server";
import { getForecast } from "@/lib/weather/open-meteo";
import type { DailyForecast } from "@/lib/weather/types";
import { eventsOnLocalDay } from "@/lib/calendar/day-bucket";
import { describeGroups, groupOccasions } from "@/lib/planning/occasion-groups";
import { hydrateSegments, readPlansForDates, type StoredPlanBundle } from "@/lib/planning/plans";
import { selectCandidates } from "@/lib/planning/candidates";
import {
  INCOMPATIBLE_WITH,
  MAX_PER_CATEGORY_IN_SEGMENT,
  REPEAT_GAP_BY_CATEGORY,
  REQUIRED_SLOTS,
  buildCandidatePool,
  datesNeedingRepair,
  describeViolations,
  enforceComposition,
  enforceCoverage,
  enforceRotation,
  TOO_WARM_FOR_SLEEVES_C,
  enforceWeather,
  findCompositionViolations,
  findCoverageViolations,
  findRotationViolations,
  findWeatherViolations,
  isLongSleeve,
  type CandidatePool,
  type RuleDay,
} from "@/lib/planning/plan-rules";
import type { CalendarEvent } from "@/types/database";
import type { DailyOccasion, DailyWardrobeItem } from "@/types/daily";
import type { WeeklyDay, WeeklyResponse } from "@/types/weekly";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

/** Weeks are 7 days from the chosen start, not Mon–Sun: opening /plan on a Saturday should still plan a useful week, and it lines up with Open-Meteo's forecast window starting today. */
const WEEK_LENGTH = 7;
const WARDROBE_SELECT =
  "id, category, subcategory, color, material, season, occasion, style_tags, brand, clean_url, original_url, favorite, times_worn, last_worn_at, archived";

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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function uniqueIds(values: string[]): string[] {
  return [...new Set(values)];
}

/** Add days to a YYYY-MM-DD calendar date without touching time zones — these are plain local dates, not instants. */
function addLocalDays(date: string, days: number): string {
  const anchor = new Date(`${date}T00:00:00Z`);
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return anchor.toISOString().slice(0, 10);
}

function toClientItem(item: Record<string, unknown>): DailyWardrobeItem {
  return {
    id: String(item.id),
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
    .select("name, city, lat, lng, body_shape, preference_dna, timezone")
    .eq("id", user.id)
    .single();

  if (profileError) throw profileError;

  const timeZone = request.nextUrl.searchParams.get("timezone") || profile?.timezone || "UTC";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
  const start = request.nextUrl.searchParams.get("start") || today;
  const dates = Array.from({ length: WEEK_LENGTH }, (_, i) => addLocalDays(start, i));

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
      "id, user_id, google_event_id, title, location, starts_at, ends_at, all_day, attendee_count, occasion, formality, synced_at"
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
      })),
    });
  }

  return result;
}

function buildWeeklyResponse(
  dates: string[],
  plans: Map<string, StoredPlanBundle>,
  eventsByDate: Map<string, { events: CalendarEvent[]; occasions: DailyOccasion[] }>,
  forecastByDate: Map<string, DailyForecast>,
  wardrobe: Record<string, unknown>[],
  extras: Partial<WeeklyResponse> = {}
): WeeklyResponse {
  const byId = new Map(wardrobe.map((item) => [String(item.id), toClientItem(item)]));

  const days: WeeklyDay[] = dates.map((date) => {
    const bundle = plans.get(date);
    return {
      date,
      planId: bundle?.plan.id ?? null,
      status: bundle?.plan.status ?? "suggested",
      source: bundle?.plan.source ?? "weekly",
      forecast: forecastByDate.get(date) ?? null,
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
  profile: { lat?: number | null; lng?: number | null } | null,
  dates: string[]
): Promise<Map<string, DailyForecast>> {
  const byDate = new Map<string, DailyForecast>();
  if (profile?.lat == null || profile?.lng == null) return byDate;

  try {
    // getForecast counts from today; ask for enough days to cover a start date that
    // may be further out, then keep only the dates in the window.
    const todayUtc = new Date().toISOString().slice(0, 10);
    const offset = Math.round(
      (new Date(`${dates[0]}T00:00:00Z`).getTime() - new Date(`${todayUtc}T00:00:00Z`).getTime()) /
        86_400_000
    );
    const days = Math.max(WEEK_LENGTH, offset + WEEK_LENGTH);
    for (const entry of await getForecast(profile.lat, profile.lng, days)) {
      byDate.set(entry.date, entry);
    }
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
  validItemIds: Set<string>,
  validEventIdsByDate: Map<string, Set<string>>
): Promise<GeneratedDay[]> {
  const rotation = findRotationViolations(days as RuleDay[], categoryFor);
  const composition = findCompositionViolations(days as RuleDay[], categoryFor);
  const coverage = findCoverageViolations(days as RuleDay[], categoryFor);
  const weather = findWeatherViolations(days as RuleDay[], isLongSleeveFor, tempFor);
  if (
    rotation.length === 0 &&
    composition.length === 0 &&
    coverage.length === 0 &&
    weather.length === 0
  ) {
    return days;
  }

  const targets = datesNeedingRepair(rotation, composition, coverage, weather);
  const problemsByDate = describeViolations(rotation, composition, coverage, weather, labelFor);

  const currentWeek = days.map((day) => ({
    planDate: day.planDate,
    action: targets.includes(day.planDate) ? "REBUILD THIS DAY" : "keep exactly as is",
    segments: day.segments.map((segment) => ({
      label: segment.label,
      items: segment.itemIds.map((id) => `${labelFor(id)} [${categoryFor(id)}] (${id})`),
    })),
  }));

  const systemPrompt = `You are fixing rule violations in an otherwise finished week plan.

RULE 1 — REPEAT GAP (per category, in whole days between wearings; 0 means it may repeat freely):
${JSON.stringify(REPEAT_GAP_BY_CATEGORY, null, 2)}
A gap of 2 means Monday and Wednesday are fine but Monday and Tuesday are not. Bags and accessories are exempt — carrying the same bag or wearing the same sunglasses daily is normal. Repeats WITHIN one day are always fine: one blazer can carry through several segments of the same day.

RULE 2 — HOW MANY OF EACH CATEGORY MAY BE WORN AT ONCE in a single segment:
${JSON.stringify(MAX_PER_CATEGORY_IN_SEGMENT, null, 2)}
These are hard caps on the whole segment, not per-occasion. Two pairs of trousers in one outfit is never valid; two tops (a shirt under a cardigan) is.

RULE 3b — NOTHING WITH SLEEVES ABOVE ${TOO_WARM_FOR_SLEEVES_C}°C. On a day whose forecast high exceeds that, use no outerwear at all and no long-sleeve tops or dresses.

RULE 3 — ITEMS THAT CANNOT BE WORN TOGETHER in one segment:
${JSON.stringify(INCOMPATIBLE_WITH, null, 2)}
A dress already covers torso and legs, so it is never combined with a top or with trousers.

RULE 4 — EVERY SEGMENT MUST BE A COMPLETE OUTFIT. Each of these slots needs at least one item (a dress covers both torso and legs):
${JSON.stringify(REQUIRED_SLOTS, null, 2)}

THE WEEK AS PLANNED (each item shows its [category]):
${JSON.stringify(currentWeek, null, 2)}

SPECIFIC CONFLICTS TO FIX:
${JSON.stringify(problemsByDate, null, 2)}

CANDIDATE WARDROBE (the only items you may use):
${JSON.stringify(candidateSummary, null, 2)}

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

    const forecastByDate = await forecastForWindow(context.profile, context.dates);
    return NextResponse.json(
      buildWeeklyResponse(
        context.dates,
        context.plans,
        context.eventsByDate,
        forecastByDate,
        context.wardrobe
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

    const { supabase, userId, profile, timeZone, dates, wardrobe, availableItems, eventsByDate } =
      context;

    if (wardrobe.length < 4) {
      return NextResponse.json(
        buildWeeklyResponse(dates, context.plans, eventsByDate, new Map(), wardrobe, {
          message: "Add a few more items to your closet before planning a whole week.",
        })
      );
    }

    const forecastByDate = await forecastForWindow(profile, dates);

    // D8: hard-filter in TypeScript before the prompt. Temperature and formality
    // bounds come from the week itself, so a week of 28°C days never offers coats.
    const temps = dates
      .map((date) => forecastByDate.get(date))
      .filter((entry): entry is DailyForecast => Boolean(entry));
    const formalityLevels = uniqueIds(
      dates.flatMap((date) =>
        (eventsByDate.get(date)?.occasions ?? [])
          .map((occasion) => occasion.formality)
          .filter((level): level is number => typeof level === "number")
          .map(String)
      )
    ).map(Number);

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
      }
    );
    if (relaxedTo !== "both") {
      console.info(`Weekly candidate filter relaxed to "${relaxedTo}" for user ${userId}`);
    }

    const candidateSummary = candidates.map((candidate) => {
      const item = candidate.raw;
      return {
        id: item.id,
        type: `${item.category} — ${item.subcategory || "unknown"}`,
        color: item.color,
        material: item.material,
        seasons: item.season,
        occasions: item.occasion,
        tags: item.style_tags,
        lastWorn: item.last_worn_at || "never",
      };
    });

    const weekOutline = dates.map((date) => {
      const forecast = forecastByDate.get(date);
      return {
        planDate: date,
        day: weekdayLabel(date, timeZone),
        weather: forecast
          ? {
              tempMin: forecast.tempMin,
              tempMax: forecast.tempMax,
              precipitationMm: forecast.precipitation,
              isEstimate: forecast.isEstimate,
            }
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

Each day lists "requiredSegments". Build EXACTLY those, in that order, one segment per entry, and set each segment's "eventIds" to exactly the entry's "eventIds". A day with an empty "requiredSegments" gets exactly ONE segment. Do not merge or split them further — the grouping already accounts for which occasions can share an outfit. Segments within the same day MAY share items; carrying one blazer from a meeting into dinner is normal.

Items that cannot be worn together in one segment:
${JSON.stringify(INCOMPATIBLE_WITH, null, 2)}
A dress already covers torso and legs, so it is never combined with a top or with trousers. Layer with outerwear instead.

On any day whose forecast high exceeds ${TOO_WARM_FOR_SLEEVES_C}°C, use NO outerwear and NO long-sleeve tops or dresses — check each day's "weather" above.

WITHIN one segment, at most this many items of each category can physically be worn at once:
${JSON.stringify(MAX_PER_CATEGORY_IN_SEGMENT, null, 2)}
These are hard caps on the whole segment, not per-occasion. Two pairs of trousers in one outfit is never valid; two tops (a shirt under a cardigan) is.

ACROSS days, these constraints are the whole point of planning a week at once. Respect all of them:
1. Minimum whole days between two wearings of the same item, by category:
${JSON.stringify(REPEAT_GAP_BY_CATEGORY, null, 2)}
   A gap of 2 means Monday and Wednesday are fine but Monday and Tuesday are not. 0 means it may repeat freely — bags and accessories are exempt because carrying the same bag or wearing the same sunglasses every day is normal.
2. Beyond the numeric gap: a statement piece (bold color or print, distinctive silhouette, anything memorable) should ideally appear only ONCE in the whole window, even though the table would technically allow a second wearing.
3. Cover the full range of formality the week's calendar actually calls for — don't plan seven interchangeable outfits.
4. Days marked "alreadyWorn": true are already confirmed and will be ignored. Still return them so the week reads as a whole, but treat their items as unavailable for the other days.

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

    const wardrobeById = new Map(wardrobe.map((item) => [String(item.id), item]));
    const labelFor = (itemId: string) => {
      const item = wardrobeById.get(itemId);
      return item ? `${item.color || ""} ${item.subcategory || item.category}`.trim() : itemId;
    };
    const categoryFor = (itemId: string) => String(wardrobeById.get(itemId)?.category ?? "");
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
    const tempFor = (planDate: string) => forecastByDate.get(planDate)?.tempMax ?? null;

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
      enforceCoverage(
        enforceWeather(
          enforceComposition(repaired as RuleDay[], categoryFor),
          categoryFor,
          isLongSleeveFor,
          tempFor,
          pool
        ),
        categoryFor,
        pool,
        (itemId, planDate) => {
          const temp = tempFor(planDate);
          return temp != null && temp > TOO_WARM_FOR_SLEEVES_C && isLongSleeveFor(itemId);
        }
      ),
      categoryFor,
      pool
    ) as GeneratedDay[];

    const warnings = [
      ...findRotationViolations(finalDays as RuleDay[], categoryFor).map(
        (violation) =>
          `"${labelFor(violation.itemId)}" repeats on ${violation.conflictDate}, only ${violation.gapDays} day(s) after ${violation.keptDate} (${violation.category} needs ${violation.requiredGapDays}).`
      ),
      ...findCoverageViolations(finalDays as RuleDay[], categoryFor).map(
        (violation) =>
          `${violation.planDate} has no ${violation.missingSlot} covered — your closet has nothing suitable left (${violation.anyOf.join(" or ")}).`
      ),
      ...findWeatherViolations(finalDays as RuleDay[], isLongSleeveFor, tempFor).map(
        (violation) =>
          `"${labelFor(violation.itemId)}" covers the arms but ${violation.planDate} reaches ${violation.temp}°C.`
      ),
    ];

    if (finalDays.length < Math.min(MIN_GENERATED_DAYS, dates.length)) {
      return NextResponse.json(
        buildWeeklyResponse(dates, context.plans, eventsByDate, forecastByDate, wardrobe, {
          message:
            "Couldn't put together a full week right now. Try again, or plan individual days from Home.",
        })
      );
    }

    const { data: skipped, error: persistError } = await supabase.rpc("replace_weekly_plans", {
      p_days: finalDays.map((day) => ({
        planDate: day.planDate,
        gap: day.gap ?? null,
        weather: forecastByDate.get(day.planDate) ?? {},
        segments: day.segments,
      })),
    });

    if (persistError) throw persistError;

    const persisted = await readPlansForDates(supabase, userId, dates);
    return NextResponse.json(
      buildWeeklyResponse(dates, persisted, eventsByDate, forecastByDate, wardrobe, {
        skippedDates: Array.isArray(skipped) ? (skipped as string[]) : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
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
