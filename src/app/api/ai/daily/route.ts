import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCurrentWeather } from "@/lib/weather/openweather";
import { describeWeatherCode, getForecastAsCurrent } from "@/lib/weather/open-meteo";
import type { DailyForecast, WeatherData } from "@/lib/weather/types";
import {
  effectiveEventLocationLabel,
  effectiveEventWeatherCity,
  weatherLocationsForEvents,
  type WeatherLocation,
} from "@/lib/weather/calendar-location";
import { eventsOnLocalDay } from "@/lib/calendar/day-bucket";
import { describeGroups, groupOccasions, occasionKind } from "@/lib/planning/occasion-groups";
import { mergeAdjacentEquivalentSegments } from "@/lib/planning/merge-segments";
import {
  hydrateSegments,
  readPlanForDate,
  type StoredPlanBundle,
} from "@/lib/planning/plans";
import {
  INCOMPATIBLE_WITH,
  MAX_PER_CATEGORY_IN_SEGMENT,
  REQUIRED_SLOTS,
  TOO_WARM_FOR_SLEEVES_C,
  buildCandidatePool,
  enforceComfort,
  enforceComposition,
  enforceCoverage,
  enforceWeather,
  isHardToTravelIn,
  isLongSleeve,
  type RuleDay,
  type RuleSegment,
  type SegmentKind,
} from "@/lib/planning/plan-rules";
import type { CalendarEvent } from "@/types/database";
import type { DailyOccasion, DailyResponse, DailyWardrobeItem } from "@/types/daily";
import { wardrobeItemLabel } from "@/lib/wardrobe/item-label";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

interface GeneratedSegment {
  label: string;
  itemIds: string[];
  changeFromPrevious?: string;
  reasoning: string;
  eventIds: string[];
}

interface GeneratedPlan {
  segments: GeneratedSegment[];
  gap?: string;
}

const WARDROBE_SELECT =
  "id, display_name, user_notes, category, subcategory, color, material, season, occasion, style_tags, brand, clean_url, original_url";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function uniqueIds(values: string[]): string[] {
  return [...new Set(values)];
}

function parseDailyPlan(text: string, validItemIds: Set<string>, validEventIds: Set<string>): GeneratedPlan | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    if (!Array.isArray(parsed.segments)) return null;

    const segments = parsed.segments
      .filter((segment): segment is Record<string, unknown> => typeof segment === "object" && segment !== null)
      .map((segment) => {
        const itemIds = Array.isArray(segment.itemIds)
          ? uniqueIds(
              segment.itemIds.filter(
                (id): id is string => typeof id === "string" && validItemIds.has(id)
              )
            )
          : [];
        const eventIds = Array.isArray(segment.eventIds)
          ? uniqueIds(
              segment.eventIds.filter(
                (id): id is string => typeof id === "string" && validEventIds.has(id)
              )
            )
          : [];

        return {
          label: typeof segment.label === "string" && segment.label.trim() ? segment.label.trim() : "Outfit",
          itemIds,
          changeFromPrevious:
            typeof segment.changeFromPrevious === "string" && segment.changeFromPrevious.trim()
              ? segment.changeFromPrevious.trim()
              : undefined,
          reasoning: typeof segment.reasoning === "string" ? segment.reasoning.trim() : "",
          eventIds,
        };
      })
      .filter((segment) => segment.itemIds.length > 0);

    if (segments.length === 0) return null;

    return {
      segments,
      gap: typeof parsed.gap === "string" && parsed.gap.trim() ? parsed.gap.trim() : undefined,
    };
  } catch {
    return null;
  }
}

interface RegeneratedSegment extends GeneratedSegment {
  nextChangeFromPrevious?: string;
}

/**
 * Same defensive shape as parseDailyPlan: ids the model made up are dropped
 * rather than trusted, and a segment left with no real items is treated as a
 * failed generation instead of being persisted empty.
 */
function parseSegmentRegeneration(
  text: string,
  validItemIds: Set<string>,
  validEventIds: Set<string>
): RegeneratedSegment | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const segment = parsed.segment;
    if (typeof segment !== "object" || segment === null) return null;

    const source = segment as Record<string, unknown>;
    const itemIds = Array.isArray(source.itemIds)
      ? uniqueIds(
          source.itemIds.filter((id): id is string => typeof id === "string" && validItemIds.has(id))
        )
      : [];
    if (itemIds.length === 0) return null;

    const eventIds = Array.isArray(source.eventIds)
      ? uniqueIds(
          source.eventIds.filter(
            (id): id is string => typeof id === "string" && validEventIds.has(id)
          )
        )
      : [];

    const optionalText = (value: unknown) =>
      typeof value === "string" && value.trim() ? value.trim() : undefined;

    return {
      label: optionalText(source.label) || "Outfit",
      itemIds,
      eventIds,
      changeFromPrevious: optionalText(source.changeFromPrevious),
      reasoning: typeof source.reasoning === "string" ? source.reasoning.trim() : "",
      nextChangeFromPrevious: optionalText(parsed.nextChangeFromPrevious),
    };
  } catch {
    return null;
  }
}

function formatLocalTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
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

function isWeatherData(value: unknown): value is WeatherData {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const weather = value as Partial<WeatherData>;
  return typeof weather.city === "string" &&
    typeof weather.temp === "number" &&
    typeof weather.feels_like === "number" &&
    typeof weather.description === "string" &&
    typeof weather.wind_speed === "number";
}

function forecastSnapshotAsWeather(value: unknown): WeatherData | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const forecast = value as Partial<DailyForecast>;
  if (
    typeof forecast.tempMin !== "number" ||
    typeof forecast.tempMax !== "number"
  ) {
    return null;
  }
  const midpoint = Math.round((forecast.tempMin + forecast.tempMax) / 2);
  return {
    city: typeof forecast.city === "string" ? forecast.city : "your location",
    temp: midpoint,
    feels_like: midpoint,
    humidity: 0,
    description:
      typeof forecast.code === "number" ? describeWeatherCode(forecast.code) : "forecast",
    icon: "",
    wind_speed: 0,
  };
}

function parseStoredWeatherLocations(value: unknown): WeatherData[] {
  if (isWeatherData(value)) return [value];
  const legacyForecast = forecastSnapshotAsWeather(value);
  if (legacyForecast) return [legacyForecast];
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const locations = (value as { locations?: unknown }).locations;
  if (!Array.isArray(locations)) return [];
  return locations
    .map((entry) => (isWeatherData(entry) ? entry : forecastSnapshotAsWeather(entry)))
    .filter((entry): entry is WeatherData => Boolean(entry));
}

function buildStoredResponse(
  stored: StoredPlanBundle,
  wardrobe: Record<string, unknown>[],
  occasions: DailyOccasion[],
  cached: boolean
): DailyResponse {
  const byId = new Map(wardrobe.map((item) => [String(item.id), toClientItem(item)]));
  const segments = hydrateSegments(stored, byId);
  const weatherLocations = parseStoredWeatherLocations(stored.plan.weather);

  return {
    planId: stored.plan.id,
    date: stored.plan.plan_date,
    source: stored.plan.source,
    weather: weatherLocations[0] ?? null,
    weatherLocations,
    occasions,
    segments,
    availableItems: wardrobe.map(toClientItem),
    gap: stored.plan.gap || undefined,
    status: stored.plan.status,
    generatedAt: stored.plan.generated_at,
    cached,
  };
}

async function readDailyOccasions(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  userId: string,
  localDate: string,
  timeZone: string
): Promise<{ events: CalendarEvent[]; occasions: DailyOccasion[] }> {
  // The slack window ensures a cross-timezone or multi-day event reaches the
  // exact local-day bucketing function instead of being discarded by SQL first.
  const dayAnchor = new Date(`${localDate}T00:00:00Z`).getTime();
  const windowStart = new Date(dayAnchor - 3 * 24 * 60 * 60 * 1000).toISOString();
  const windowEnd = new Date(dayAnchor + 3 * 24 * 60 * 60 * 1000).toISOString();

  const { data: rawEvents, error } = await supabase
    .from("calendar_events")
    .select(
      "id, user_id, google_event_id, title, location, location_override, weather_city, weather_lat, weather_lng, weather_timezone, weather_city_override, weather_lat_override, weather_lng_override, weather_timezone_override, weather_location_resolved, starts_at, ends_at, all_day, attendee_count, occasion, formality, companion, stylist_share_detail, synced_at"
    )
    .eq("user_id", userId)
    .gte("starts_at", windowStart)
    .lte("starts_at", windowEnd);

  if (error) throw error;

  const events = eventsOnLocalDay((rawEvents || []) as CalendarEvent[], localDate, timeZone).sort((a, b) =>
    a.starts_at.localeCompare(b.starts_at)
  );

  return {
    events,
    occasions: events.map((event) => ({
      id: event.id,
      title: event.title || "(untitled)",
      occasion: event.occasion || "unclassified",
      formality: event.formality ?? null,
      time: event.all_day ? "all day" : formatLocalTime(event.starts_at, timeZone),
      allDay: Boolean(event.all_day),
      location: effectiveEventLocationLabel(event),
      weatherCity: effectiveEventWeatherCity(event),
      locationOverridden: Boolean(event.location_override),
    })),
  };
}

function emptyResponse(
  localDate: string,
  availableItems: DailyWardrobeItem[],
  message: string,
  weather: WeatherData | null = null,
  weatherLocations: WeatherData[] = weather ? [weather] : []
): DailyResponse {
  return {
    planId: null,
    date: localDate,
    source: "daily",
    weather,
    weatherLocations,
    occasions: [],
    segments: [],
    availableItems,
    status: "suggested",
    generatedAt: null,
    cached: false,
    message,
  };
}

interface DailyPostBody {
  segmentId?: unknown;
  rejectedItemIds?: unknown;
}

/**
 * Everything the read, whole-day-regenerate and single-segment-regenerate paths
 * all need. Kept in one place so the three entry points can't drift on how the
 * local date or the calendar window is derived.
 */
async function loadDailyContext(request: NextRequest) {
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
  const localDate =
    request.nextUrl.searchParams.get("date") ||
    new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());

  const [{ data: wardrobeRows, error: wardrobeError }, stored, occasionData] = await Promise.all([
    supabase
      .from("wardrobe_items")
      .select(WARDROBE_SELECT)
      .eq("user_id", user.id)
      .eq("archived", false)
      .limit(150),
    readPlanForDate(supabase, user.id, localDate),
    readDailyOccasions(supabase, user.id, localDate, timeZone),
  ]);

  if (wardrobeError) throw wardrobeError;
  const wardrobe = (wardrobeRows || []) as Record<string, unknown>[];

  return {
    unauthorized: false as const,
    supabase,
    userId: user.id,
    profile,
    timeZone,
    localDate,
    wardrobe,
    availableItems: wardrobe.map(toClientItem),
    stored,
    occasionData,
  };
}

/** Keep only ids the user actually owns; a client can send anything. */
function ownedItemIds(value: unknown, wardrobe: Record<string, unknown>[]): string[] {
  if (!Array.isArray(value)) return [];
  const owned = new Set(wardrobe.map((item) => String(item.id)));
  return uniqueIds(
    value.filter((id): id is string => typeof id === "string" && isUuid(id) && owned.has(id))
  );
}

function describeWardrobe(items: Record<string, unknown>[]) {
  return items.map((item) => ({
    id: item.id,
    name: item.display_name || null,
    type: `${item.category} — ${item.subcategory || "unknown"}`,
    color: item.color,
    material: item.material,
    seasons: item.season,
    occasions: item.occasion,
    tags: item.style_tags,
    userNotes: item.user_notes || null,
  }));
}

function formatDateLabel(localDate: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${localDate}T12:00:00Z`));
}

/**
 * Current conditions for today, forecast for anything else. `?date=` lets a future
 * day be (re)generated from the week view, and reasoning about Thursday's outfit
 * using this moment's weather would be wrong in exactly the season where it matters
 * most. Returns null rather than guessing when there are no coordinates or the date
 * is outside the forecast horizon; the prompt then says the weather is unknown.
 */
async function weatherForDate(
  locations: WeatherLocation[],
  localDate: string,
  timeZone: string
): Promise<WeatherData[]> {
  const results = await Promise.all(
    locations.map(async (location) => {
      const weatherTimeZone = location.timezone || timeZone;
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: weatherTimeZone }).format(
        new Date()
      );
      const weather =
        localDate === today
          ? await getCurrentWeather(location.lat, location.lng)
          : await getForecastAsCurrent(location.lat, location.lng, localDate, location.city);
      return weather
        ? { ...weather, city: location.city || weather.city || "your location" }
        : null;
    })
  );
  return results.filter((entry): entry is WeatherData => Boolean(entry));
}

/**
 * The rule lookups a single day needs. Built per request because they close over
 * that request's wardrobe and weather.
 *
 * Unlike weekly, which has a real daily maximum from the forecast, daily only has
 * one representative temperature (current conditions today, the forecast midpoint
 * otherwise) — so the sleeve rule is marginally less strict here on a day that
 * merely peaks above the threshold.
 */
function buildDailyRules(
  wardrobe: Record<string, unknown>[],
  candidateWardrobe: Record<string, unknown>[],
  weatherLocations: WeatherData[],
  events: CalendarEvent[]
) {
  const byId = new Map(wardrobe.map((item) => [String(item.id), item]));
  const categoryFor = (itemId: string) => String(byId.get(itemId)?.category ?? "");
  const isLongSleeveFor = (itemId: string) => {
    const item = byId.get(itemId);
    return item
      ? isLongSleeve({
          category: String(item.category),
          subcategory: item.subcategory as string | null,
          material: item.material as string | null,
        })
      : false;
  };

  // Resolved from the calendar rather than from the label the model wrote, so a
  // segment covering a flight or a tennis match is treated as such however it was
  // named. Athletic wins a mixed segment: it is the stricter of the two.
  const kindByEventId = new Map(
    events.map(
      (event) =>
        [
          event.id,
          occasionKind({
            occasion: event.occasion,
            title: event.title,
            allDay: event.all_day,
          }),
        ] as const
    )
  );

  return {
    categoryFor,
    isLongSleeveFor,
    segmentKindFor: (segment: RuleSegment): SegmentKind => {
      const kinds = (segment.eventIds ?? []).map((eventId) => kindByEventId.get(eventId));
      if (kinds.includes("athletic")) return "athletic";
      if (kinds.includes("transit")) return "transit";
      return "general";
    },
    isHardToTravelInFor: (itemId: string) => {
      const item = byId.get(itemId);
      return item
        ? isHardToTravelIn({
            category: String(item.category),
            subcategory: item.subcategory as string | null,
            display_name: item.display_name as string | null,
          })
        : false;
    },
    tempFor: () =>
      weatherLocations.length > 0
        ? Math.min(...weatherLocations.map((weather) => weather.temp))
        : null,
    pool: buildCandidatePool(candidateWardrobe.map((item) => String(item.id)), categoryFor),
  };
}

/** Same order as weekly: removing can open a hole, filling one can put heels back on a flight. */
function applyDailyRules(
  days: RuleDay[],
  localDate: string,
  rules: ReturnType<typeof buildDailyRules>
) {
  const { categoryFor, isLongSleeveFor, segmentKindFor, isHardToTravelInFor, tempFor, pool } =
    rules;
  return enforceComfort(
    enforceCoverage(
      enforceWeather(
        enforceComposition(days, categoryFor),
        categoryFor,
        isLongSleeveFor,
        tempFor,
        pool
      ),
      categoryFor,
      pool,
      (itemId) => {
        const temp = tempFor();
        return temp != null && temp > TOO_WARM_FOR_SLEEVES_C && isLongSleeveFor(itemId);
      }
    ),
    categoryFor,
    segmentKindFor,
    isHardToTravelInFor,
    pool
  );
}

function describeWeather(weatherLocations: WeatherData[]) {
  return weatherLocations.length > 0
    ? `WEATHER BY LOCATION (plan for every place listed, using removable layers when conditions differ):\n${weatherLocations
        .map(
          (weather) =>
            `- ${weather.city}: ${weather.temp}°C (feels like ${weather.feels_like}°C), ${weather.description}, wind ${weather.wind_speed} m/s`
        )
        .join("\n")}`
    : "WEATHER: unknown, no city set in profile";
}

async function handleDaily(request: NextRequest, regenerate: boolean, body: DailyPostBody = {}) {
  try {
    const context = await loadDailyContext(request);
    if (context.unauthorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { supabase, userId, profile, timeZone, localDate, wardrobe, availableItems, stored, occasionData } =
      context;

    if (stored && !regenerate) {
      return NextResponse.json(buildStoredResponse(stored, wardrobe, occasionData.occasions, true));
    }

    if (stored?.plan.status === "worn" && regenerate) {
      return NextResponse.json(
        { error: "Today's worn plan cannot be regenerated." },
        { status: 409 }
      );
    }

    const rejectedItemIds = regenerate ? ownedItemIds(body.rejectedItemIds, wardrobe) : [];
    const rejectedSet = new Set(rejectedItemIds);
    const candidateWardrobe = wardrobe.filter((item) => !rejectedSet.has(String(item.id)));

    if (candidateWardrobe.length < 2) {
      return NextResponse.json(
        emptyResponse(
          localDate,
          availableItems,
          rejectedItemIds.length > 0
            ? "There aren't enough different items left to build a new recommendation."
            : "Add at least a couple of items to your closet to get a daily recommendation."
        )
      );
    }

    const weatherLocations = await weatherForDate(
      weatherLocationsForEvents(
        occasionData.events,
        profile,
        localDate,
        timeZone
      ),
      localDate,
      timeZone
    );

    const wardrobeSummary = describeWardrobe(candidateWardrobe);
    const dateLabel = formatDateLabel(localDate, timeZone);

    const promptOccasions = occasionData.occasions.map((occasion) => ({
      id: occasion.id,
      title: occasion.title,
      occasion: occasion.occasion,
      formality: occasion.formality,
      time: occasion.time,
      location: occasion.location,
      weatherCity: occasion.weatherCity,
    }));

    // Segment count is decided here, not by the model: grouping consecutive
    // occasions by formality is arithmetic, and leaving it to judgement produced
    // the same day as two segments on one run and one on the next.
    const occasionGroups = groupOccasions(occasionData.occasions);

    const exclusionInstruction =
      rejectedItemIds.length > 0
        ? `\nREJECTED ITEM IDS — the user explicitly disliked the previous plan. Do NOT use any of these items in any segment:\n${JSON.stringify(rejectedItemIds)}\n`
        : "";

    const systemPrompt = `You are an expert personal stylist AI. Build TODAY's outfit plan for the user from their ACTUAL wardrobe below — never invent items.

TODAY: ${dateLabel}
${describeWeather(weatherLocations)}

TODAY'S CALENDAR OCCASIONS (chronological; empty if none):
${promptOccasions.length > 0 ? JSON.stringify(promptOccasions, null, 2) : "(no calendar events today)"}
${exclusionInstruction}
USER PROFILE:
${profile ? `Name: ${profile.name || "User"}, Body Shape: ${profile.body_shape || "Unknown"}` : "No profile data"}
${profile?.preference_dna ? `Preferences: ${JSON.stringify(profile.preference_dna)}` : ""}

USER'S AVAILABLE WARDROBE (${wardrobeSummary.length} items):
${JSON.stringify(wardrobeSummary, null, 2)}

A non-empty wardrobe "name" is the user's authoritative name for that piece. Use it verbatim in reasoning and never reduce it to a generic color/type label. Treat "userNotes" as authoritative fit, comfort, provenance, and wearing constraints.

REQUIRED SEGMENTS — build EXACTLY these, in this order, one per entry. Occasions are already grouped by formality, so consecutive occasions that share an outfit are in the same entry and ones needing a change are separate. Do not merge or split them further:
${
  occasionGroups.length > 0
    ? JSON.stringify(describeGroups(occasionGroups), null, 2)
    : "(no calendar events today — build exactly ONE segment for the whole day)"
}
Each segment's "eventIds" must be exactly the "eventIds" of its entry above.

Each required segment carries a "kind". A segment whose kind is not "general" is dressed for what it IS, not for how formal the rest of the day is:
- "transit" — time spent getting somewhere: a flight, a train, a long drive, an airport transfer. Flat shoes that come off easily (never heels), soft or stretch fabrics that survive hours of sitting, nothing that creases or restricts, and a layer for a cold cabin. A business trip's flight is still a flight — keep the tailoring for the meetings.
- "athletic" — sport or a workout: real activewear and the right shoes for that activity, never office clothes made casual. Golf and tennis are the ones to get right, because they sit in the middle of a working day and often at a club: dress them as sport with the club's code in mind (a collared polo, proper court or golf shoes, tennis whites where the wardrobe has them), not as smart-casual.
  Anything worn for sport is sweated in, so NOTHING from an athletic segment reappears in any later segment of the day — the following segment is a complete change of clothes. Bags and accessories are the exception; the same tote before and after is fine.

Items that cannot be worn together in one segment:
${JSON.stringify(INCOMPATIBLE_WITH, null, 2)}
A dress already covers torso and legs, so it is never combined with a top or with trousers. Layer with outerwear instead.

If today is above ${TOO_WARM_FOR_SLEEVES_C}°C, use NO outerwear and NO long-sleeve tops or dresses.

Within one segment, at most this many items of each category can physically be worn at once:
${JSON.stringify(MAX_PER_CATEGORY_IN_SEGMENT, null, 2)}
These are hard caps on the whole segment, not per-occasion. Two pairs of trousers in one outfit is never valid; two tops (a shirt under a cardigan) is.

Every segment must also be a COMPLETE outfit — each of these slots needs at least one item (a dress covers both torso and legs):
${JSON.stringify(REQUIRED_SLOTS, null, 2)}

For every segment after the first, prefer changing only what's necessary from the previous one rather than recomposing the whole outfit, unless the formality gap is too large or either segment's "kind" is not "general" — moving into or out of transit or sport is where a full change of outfit is expected rather than avoided. If the exact same complete outfit works for two adjacent segment entries, reuse the exact same "itemIds" for both; do not manufacture an accessory change just to make the occasions look different. Equivalent adjacent segments will be consolidated after generation. Every segment's "itemIds" must list the COMPLETE set worn during that segment. Put every calendar event covered by a segment in that segment's "eventIds"; use only event IDs shown above.

Respond with ONLY this JSON, no other text:
{
  "segments": [
    {
      "label": "short label naming the actual occasion(s), never generic morning/evening wording",
      "itemIds": ["<wardrobe id>", "<wardrobe id>"],
      "eventIds": ["<calendar event id>"],
      "changeFromPrevious": "what changed from the prior segment; omit for the first",
      "reasoning": "1-2 sentences on why this works"
    }
  ],
  "gap": "optional wardrobe gap; omit if none"
}`;

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: "Build today's outfit plan." }],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    const text = textBlock && textBlock.type === "text" ? textBlock.text : "";
    const generated = parseDailyPlan(
      text,
      new Set(candidateWardrobe.map((item) => String(item.id))),
      new Set(occasionData.events.map((event) => event.id))
    );

    if (!generated) {
      return NextResponse.json(
        emptyResponse(
          localDate,
          availableItems,
          "Couldn't put together a recommendation right now. Try the AI Stylist chat instead.",
          weatherLocations[0] ?? null,
          weatherLocations
        )
      );
    }

    // Same last line of defence as weekly. Both rules are stated in the prompt too,
    // but a model that ignores them must not be able to persist the result: weekly
    // once produced a whole day whose outfit was a single pair of sandals, and
    // another with two pairs of trousers in one look.
    const rules = buildDailyRules(
      wardrobe,
      candidateWardrobe,
      weatherLocations,
      occasionData.events
    );
    const [wearableDay] = applyDailyRules(
      [{ planDate: localDate, segments: generated.segments }],
      localDate,
      rules
    );

    const finalSegments = mergeAdjacentEquivalentSegments(
      generated.segments.map((segment, index) => ({
        ...segment,
        itemIds: wearableDay.segments[index]?.itemIds ?? segment.itemIds,
      }))
    );

    const { data: planId, error: persistError } = await supabase.rpc("replace_outfit_plan", {
      p_plan_date: localDate,
      p_source: "daily",
      p_travel_plan_id: null,
      p_gap: generated.gap || null,
      p_weather: { locations: weatherLocations },
      p_segments: finalSegments,
    });

    if (persistError || !planId) {
      throw persistError || new Error("Daily plan was generated but could not be saved");
    }

    const persisted = await readPlanForDate(supabase, userId, localDate);
    if (!persisted) {
      throw new Error("Daily plan was saved but could not be read back");
    }

    return NextResponse.json(
      buildStoredResponse(persisted, wardrobe, occasionData.occasions, false)
    );
  } catch (error) {
    console.error("Daily recommendation error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Daily recommendation failed" },
      { status: 500 }
    );
  }
}

/**
 * Redo ONE segment and leave the rest of the day alone. Regenerating the whole
 * plan to fix a single bad look throws away the segments the user was happy with
 * and pays for a full generation, which is why this exists as its own path.
 *
 * The model also returns the FOLLOWING segment's updated "what changed" line: it
 * describes the transition from the segment being replaced, so leaving it as-is
 * would point at an outfit that no longer exists. Asking for it in the same call
 * keeps it accurate at no extra cost.
 */
async function handleSegmentRegeneration(request: NextRequest, segmentId: string, body: DailyPostBody) {
  try {
    const context = await loadDailyContext(request);
    if (context.unauthorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { supabase, userId, profile, timeZone, localDate, wardrobe, availableItems, stored, occasionData } =
      context;

    if (!stored) {
      return NextResponse.json({ error: "There is no plan to adjust yet." }, { status: 404 });
    }
    if (stored.plan.status === "worn") {
      return NextResponse.json(
        { error: "Today's worn plan cannot be regenerated." },
        { status: 409 }
      );
    }

    const target = stored.segments.find((segment) => segment.id === segmentId);
    if (!target) {
      return NextResponse.json({ error: "That segment is not part of today's plan." }, { status: 404 });
    }

    const currentItemIds = stored.segmentItems
      .filter((row) => row.segment_id === target.id)
      .sort((a, b) => a.position - b.position)
      .map((row) => row.item_id);

    // Default to rejecting exactly what this segment currently shows; the client
    // may send a narrower set. Only this segment's items are excluded — items in
    // the segments the user is keeping stay available, since wearing the same
    // blazer through two parts of the day is normal, not a repeat to avoid.
    const explicit = ownedItemIds(body.rejectedItemIds, wardrobe);
    const rejectedItemIds = explicit.length > 0 ? explicit : currentItemIds;
    const rejectedSet = new Set(rejectedItemIds);
    const candidateWardrobe = wardrobe.filter((item) => !rejectedSet.has(String(item.id)));

    if (candidateWardrobe.length < 1) {
      return NextResponse.json(
        emptyResponse(
          localDate,
          availableItems,
          "There aren't enough different items left to rebuild this segment."
        )
      );
    }

    const byId = new Map(wardrobe.map((item) => [String(item.id), item]));
    const itemsBySegment = new Map<string, string[]>();
    for (const row of [...stored.segmentItems].sort((a, b) => a.position - b.position)) {
      itemsBySegment.set(row.segment_id, [...(itemsBySegment.get(row.segment_id) || []), row.item_id]);
    }

    const planOutline = stored.segments.map((segment) => ({
      position: segment.position,
      label: segment.label,
      action: segment.id === target.id ? "REGENERATE THIS ONE" : "keep unchanged",
      currentItems: (itemsBySegment.get(segment.id) || []).map((itemId) => {
        const item = byId.get(itemId);
        return item
          ? wardrobeItemLabel({
              display_name: item.display_name as string | null,
              category: String(item.category),
              subcategory: item.subcategory as string | null,
              color: item.color as string | null,
              brand: item.brand as string | null,
            })
          : itemId;
      }),
    }));

    const nextSegment = stored.segments.find((segment) => segment.position === target.position + 1);
    const previousSegment = stored.segments.find((segment) => segment.position === target.position - 1);

    const kindOfEvent = (eventId: string) => {
      const event = occasionData.events.find((entry) => entry.id === eventId);
      return event
        ? occasionKind({
            occasion: event.occasion,
            title: event.title,
            allDay: event.all_day,
          })
        : "general";
    };
    const targetKinds = (target.event_ids ?? []).map(kindOfEvent);

    // Everything worn (not merely carried) in an athletic segment earlier today.
    // The deterministic rule below catches a reuse anyway, but naming the pieces
    // gets a styled replacement instead of a code-chosen one.
    const sweatyEarlierItemIds = stored.segments
      .filter(
        (segment) =>
          segment.position < target.position &&
          (segment.event_ids ?? []).some((eventId) => kindOfEvent(eventId) === "athletic")
      )
      .flatMap((segment) => itemsBySegment.get(segment.id) || [])
      .filter((itemId) => {
        const category = String(byId.get(itemId)?.category ?? "");
        return category !== "Bags" && category !== "Accessories";
      });

    // The parent row's weather is the snapshot for this local day; refetching here
    // would make the segment reason about different weather than the rest of the plan.
    const weatherLocations = parseStoredWeatherLocations(stored.plan.weather);
    const wardrobeSummary = describeWardrobe(candidateWardrobe);

    const systemPrompt = `You are an expert personal stylist AI. The user likes today's plan except for ONE segment. Rebuild ONLY that segment from their ACTUAL wardrobe below — never invent items.

TODAY: ${formatDateLabel(localDate, timeZone)}
${describeWeather(weatherLocations)}

TODAY'S CALENDAR OCCASIONS (chronological; empty if none):
${occasionData.occasions.length > 0 ? JSON.stringify(occasionData.occasions, null, 2) : "(no calendar events today)"}

TODAY'S FULL PLAN — you are replacing exactly one entry, the rest stay as they are:
${JSON.stringify(planOutline, null, 2)}

SEGMENT TO REGENERATE: "${target.label}" at position ${target.position}, covering event IDs ${JSON.stringify(target.event_ids || [])}.
${
  targetKinds.includes("athletic")
    ? `This segment is sport or a workout. Dress it as sport: real activewear and the right shoes for the activity, never office clothes made casual. Golf and tennis still count as sport even at a club and even with clients — respect the club's code (a collared polo, proper court or golf shoes, tennis whites where the wardrobe has them) rather than dressing them up. It may look completely different from the segments around it.\n`
    : targetKinds.includes("transit")
      ? `This segment is time spent in transit — a flight, a train, a long drive or an airport transfer. Dress it for the journey, not for what the trip is for: flat shoes that come off easily (never heels), soft or stretch fabrics that survive hours of sitting, nothing that creases or restricts, and a layer for a cold cabin. A business trip's flight is still a flight, so it may look completely different from the segments around it.\n`
      : ""
}${
  sweatyEarlierItemIds.length > 0
    ? `Earlier today the user worked out or played a match. These pieces were sweated in and must NOT come back in this segment (bags and accessories aside):\n${JSON.stringify(sweatyEarlierItemIds)}\n`
    : ""
}
REJECTED ITEM IDS — the user disliked this segment. Do NOT use any of these:
${JSON.stringify(rejectedItemIds)}

USER PROFILE:
${profile ? `Name: ${profile.name || "User"}, Body Shape: ${profile.body_shape || "Unknown"}` : "No profile data"}
${profile?.preference_dna ? `Preferences: ${JSON.stringify(profile.preference_dna)}` : ""}

USER'S AVAILABLE WARDROBE (${wardrobeSummary.length} items):
${JSON.stringify(wardrobeSummary, null, 2)}

A non-empty wardrobe "name" is the user's authoritative name for that piece. Use it verbatim in reasoning and never reduce it to a generic color/type label. Treat "userNotes" as authoritative fit, comfort, provenance, and wearing constraints.

Keep the new segment appropriate for the same occasions the old one covered. "itemIds" must be the COMPLETE set worn during this segment.
${previousSegment ? `There IS a preceding segment ("${previousSegment.label}"), so give "changeFromPrevious" describing what changes coming from it.` : `This is the FIRST segment of the day, so omit "changeFromPrevious".`}
${nextSegment ? `There IS a following segment ("${nextSegment.label}" with items ${JSON.stringify(itemsBySegment.get(nextSegment.id) || [])}). Return "nextChangeFromPrevious" rewriting how that following segment differs from your NEW segment, so the day still reads as one sequence.` : `This is the LAST segment of the day, so omit "nextChangeFromPrevious".`}

Respond with ONLY this JSON, no other text:
{
  "segment": {
    "label": "short label naming the actual occasion(s), never generic morning/evening wording",
    "itemIds": ["<wardrobe id>", "<wardrobe id>"],
    "eventIds": ["<calendar event id>"],
    "changeFromPrevious": "omit when this is the first segment",
    "reasoning": "1-2 sentences on why this works"
  },
  "nextChangeFromPrevious": "omit when there is no following segment"
}`;

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: `Rebuild the "${target.label}" segment.` }],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    const generated = parseSegmentRegeneration(
      textBlock && textBlock.type === "text" ? textBlock.text : "",
      new Set(candidateWardrobe.map((item) => String(item.id))),
      new Set(occasionData.events.map((event) => event.id))
    );

    if (!generated) {
      return NextResponse.json(
        { error: "Couldn't rebuild that segment right now. Try again in a moment." },
        { status: 502 }
      );
    }

    // The rules run over the WHOLE day with the new segment slotted in, not over
    // the segment alone: "nothing worn for sport comes back later today" is a fact
    // about the segments before this one, and a lone segment can't see them. Only
    // the target's row is persisted, so any incidental change elsewhere is ignored.
    const orderedSegments = [...stored.segments].sort((a, b) => a.position - b.position);
    const targetIndex = orderedSegments.findIndex((segment) => segment.id === target.id);
    const [wearableSegmentDay] = applyDailyRules(
      [
        {
          planDate: localDate,
          segments: orderedSegments.map((segment) =>
            segment.id === target.id
              ? {
                  itemIds: generated.itemIds,
                  // Fall back to the stored segment's events: the comfort rule must
                  // still know this is the flight even if the model returned no ids.
                  eventIds:
                    generated.eventIds.length > 0 ? generated.eventIds : target.event_ids ?? [],
                }
              : {
                  itemIds: itemsBySegment.get(segment.id) || [],
                  eventIds: segment.event_ids ?? [],
                }
          ),
        },
      ],
      localDate,
      buildDailyRules(wardrobe, candidateWardrobe, weatherLocations, occasionData.events)
    );

    const { error: persistError } = await supabase.rpc("regenerate_outfit_plan_segment", {
      p_segment_id: target.id,
      p_label: generated.label,
      p_reasoning: generated.reasoning,
      p_change_from_previous: previousSegment ? generated.changeFromPrevious ?? null : null,
      p_event_ids: generated.eventIds,
      p_item_ids: wearableSegmentDay.segments[targetIndex].itemIds,
      p_next_change_from_previous: nextSegment ? generated.nextChangeFromPrevious ?? null : null,
    });

    if (persistError) throw persistError;

    // A model-regenerated segment is no longer based on the Saved Look the user
    // may previously have reused. Keep the origin only for human Canvas edits,
    // where Save can meaningfully offer "update original" versus "save as new".
    const { error: clearSourceError } = await supabase
      .from("outfit_plan_segments")
      .update({ source_outfit_id: null })
      .eq("id", target.id);
    if (clearSourceError) throw clearSourceError;

    const persisted = await readPlanForDate(supabase, userId, localDate);
    if (!persisted) {
      throw new Error("Segment was regenerated but the plan could not be read back");
    }

    return NextResponse.json(
      buildStoredResponse(persisted, wardrobe, occasionData.occasions, false)
    );
  } catch (error) {
    console.error("Daily segment regeneration error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Segment regeneration failed" },
      { status: 500 }
    );
  }
}

/**
 * GET returns the persisted daily plan when present. Claude is called only on a
 * cache miss. POST is the explicit regenerate path: with a `segmentId` it redoes
 * that one segment in place, without it the whole day is rebuilt after excluding
 * the rejected item IDs supplied by the client.
 */
export async function GET(request: NextRequest) {
  return handleDaily(request, false);
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as DailyPostBody;

  if (typeof body.segmentId === "string" && isUuid(body.segmentId)) {
    return handleSegmentRegeneration(request, body.segmentId, body);
  }

  return handleDaily(request, true, body);
}
