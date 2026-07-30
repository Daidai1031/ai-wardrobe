import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCurrentWeather } from "@/lib/weather/openweather";
import type { WeatherData } from "@/lib/weather/types";
import { eventsOnLocalDay } from "@/lib/calendar/day-bucket";
import type { CalendarEvent } from "@/types/database";
import type {
  DailyOccasion,
  DailyPlanStatus,
  DailyResponse,
  DailySegmentItem,
  DailySegmentResponse,
  DailyWardrobeItem,
} from "@/types/daily";

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

interface StoredPlan {
  id: string;
  plan_date: string;
  gap: string | null;
  weather: unknown;
  status: DailyPlanStatus;
  generated_at: string;
}

interface StoredSegment {
  id: string;
  position: number;
  label: string;
  reasoning: string;
  change_from_previous: string | null;
  event_ids: string[] | null;
  saved_outfit_id: string | null;
}

interface StoredSegmentItem {
  segment_id: string;
  item_id: string;
  position: number;
  x: number | null;
  y: number | null;
  width: number | null;
}

const WARDROBE_SELECT =
  "id, category, subcategory, color, material, season, occasion, style_tags, brand, clean_url, original_url";

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
    category: String(item.category),
    subcategory: typeof item.subcategory === "string" ? item.subcategory : null,
    color: typeof item.color === "string" ? item.color : null,
    brand: typeof item.brand === "string" ? item.brand : null,
    clean_url: typeof item.clean_url === "string" ? item.clean_url : null,
    original_url: String(item.original_url),
  };
}

function parseStoredWeather(value: unknown): WeatherData | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const weather = value as Partial<WeatherData>;
  return typeof weather.city === "string" &&
    typeof weather.temp === "number" &&
    typeof weather.feels_like === "number" &&
    typeof weather.description === "string" &&
    typeof weather.wind_speed === "number"
    ? (weather as WeatherData)
    : null;
}

async function readStoredPlan(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  userId: string,
  localDate: string
): Promise<{ plan: StoredPlan; segments: StoredSegment[]; segmentItems: StoredSegmentItem[] } | null> {
  const { data: plan, error: planError } = await supabase
    .from("outfit_plans")
    .select("id, plan_date, gap, weather, status, generated_at")
    .eq("user_id", userId)
    .eq("plan_date", localDate)
    .eq("source", "daily")
    .is("travel_plan_id", null)
    .maybeSingle();

  if (planError) throw planError;
  if (!plan) return null;

  const { data: segments, error: segmentsError } = await supabase
    .from("outfit_plan_segments")
    .select("id, position, label, reasoning, change_from_previous, event_ids, saved_outfit_id")
    .eq("outfit_plan_id", plan.id)
    .order("position");

  if (segmentsError) throw segmentsError;
  const storedSegments = (segments || []) as StoredSegment[];
  if (storedSegments.length === 0) return null;

  const { data: segmentItems, error: itemsError } = await supabase
    .from("outfit_plan_segment_items")
    .select("segment_id, item_id, position, x, y, width")
    .in(
      "segment_id",
      storedSegments.map((segment) => segment.id)
    )
    .order("position");

  if (itemsError) throw itemsError;

  return {
    plan: plan as StoredPlan,
    segments: storedSegments,
    segmentItems: (segmentItems || []) as StoredSegmentItem[],
  };
}

function buildStoredResponse(
  stored: NonNullable<Awaited<ReturnType<typeof readStoredPlan>>>,
  wardrobe: Record<string, unknown>[],
  occasions: DailyOccasion[],
  cached: boolean
): DailyResponse {
  const byId = new Map(wardrobe.map((item) => [String(item.id), toClientItem(item)]));
  const itemsBySegment = new Map<string, StoredSegmentItem[]>();

  for (const row of stored.segmentItems) {
    const existing = itemsBySegment.get(row.segment_id) || [];
    existing.push(row);
    itemsBySegment.set(row.segment_id, existing);
  }

  const segments: DailySegmentResponse[] = stored.segments.map((segment) => ({
    id: segment.id,
    label: segment.label,
    reasoning: segment.reasoning,
    changeFromPrevious: segment.change_from_previous || undefined,
    eventIds: segment.event_ids || [],
    savedOutfitId: segment.saved_outfit_id,
    items: (itemsBySegment.get(segment.id) || [])
      .sort((a, b) => a.position - b.position)
      .map((row) => {
        const item = byId.get(row.item_id);
        return item ? { ...item, x: row.x, y: row.y, width: row.width } : null;
      })
      .filter((item): item is DailySegmentItem => Boolean(item)),
  }));

  return {
    planId: stored.plan.id,
    date: stored.plan.plan_date,
    weather: parseStoredWeather(stored.plan.weather),
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
      "id, user_id, google_event_id, title, location, starts_at, ends_at, all_day, attendee_count, occasion, formality, synced_at"
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
    })),
  };
}

function emptyResponse(
  localDate: string,
  availableItems: DailyWardrobeItem[],
  message: string,
  weather: WeatherData | null = null
): DailyResponse {
  return {
    planId: null,
    date: localDate,
    weather,
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
    readStoredPlan(supabase, user.id, localDate),
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
    type: `${item.category} — ${item.subcategory || "unknown"}`,
    color: item.color,
    material: item.material,
    seasons: item.season,
    occasions: item.occasion,
    tags: item.style_tags,
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

function describeWeather(weather: WeatherData | null) {
  return weather
    ? `WEATHER: ${weather.temp}°C (feels like ${weather.feels_like}°C), ${weather.description}, wind ${weather.wind_speed} m/s, in ${weather.city}`
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

    let weather: WeatherData | null = null;
    if (profile?.lat != null && profile?.lng != null) {
      weather = await getCurrentWeather(profile.lat, profile.lng);
    }

    const wardrobeSummary = describeWardrobe(candidateWardrobe);
    const dateLabel = formatDateLabel(localDate, timeZone);

    const promptOccasions = occasionData.occasions.map((occasion) => ({
      id: occasion.id,
      title: occasion.title,
      occasion: occasion.occasion,
      formality: occasion.formality,
      time: occasion.time,
    }));

    const exclusionInstruction =
      rejectedItemIds.length > 0
        ? `\nREJECTED ITEM IDS — the user explicitly disliked the previous plan. Do NOT use any of these items in any segment:\n${JSON.stringify(rejectedItemIds)}\n`
        : "";

    const systemPrompt = `You are an expert personal stylist AI. Build TODAY's outfit plan for the user from their ACTUAL wardrobe below — never invent items.

TODAY: ${dateLabel}
${describeWeather(weather)}

TODAY'S CALENDAR OCCASIONS (chronological; empty if none):
${promptOccasions.length > 0 ? JSON.stringify(promptOccasions, null, 2) : "(no calendar events today)"}
${exclusionInstruction}
USER PROFILE:
${profile ? `Name: ${profile.name || "User"}, Body Shape: ${profile.body_shape || "Unknown"}` : "No profile data"}
${profile?.preference_dna ? `Preferences: ${JSON.stringify(profile.preference_dna)}` : ""}

USER'S AVAILABLE WARDROBE (${wardrobeSummary.length} items):
${JSON.stringify(wardrobeSummary, null, 2)}

Build the plan as a sequence of "segments" — one segment per distinct look the user actually needs today. The number of segments is NOT fixed and must NOT just mirror the number of calendar occasions:
- No occasions, or all occasions are similar in formality → 1 segment for the whole day.
- Occasions with a meaningfully different formality or type (e.g. gym then a board meeting) → a separate segment for each.
- Adjacent occasions with similar formality/type → merge them into one segment instead of repeating the same outfit as a separate entry.

For every segment after the first, prefer changing only what's necessary from the previous one rather than recomposing the whole outfit, unless the formality gap is too large. Every segment's "itemIds" must list the COMPLETE set worn during that segment. Put every calendar event covered by a segment in that segment's "eventIds"; use only event IDs shown above.

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
          weather
        )
      );
    }

    const { data: planId, error: persistError } = await supabase.rpc("replace_outfit_plan", {
      p_plan_date: localDate,
      p_source: "daily",
      p_travel_plan_id: null,
      p_gap: generated.gap || null,
      p_weather: weather || {},
      p_segments: generated.segments,
    });

    if (persistError || !planId) {
      throw persistError || new Error("Daily plan was generated but could not be saved");
    }

    const persisted = await readStoredPlan(supabase, userId, localDate);
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
        return item ? `${item.color || ""} ${item.subcategory || item.category}`.trim() : itemId;
      }),
    }));

    const nextSegment = stored.segments.find((segment) => segment.position === target.position + 1);
    const previousSegment = stored.segments.find((segment) => segment.position === target.position - 1);

    // The parent row's weather is the snapshot for this local day; refetching here
    // would make the segment reason about different weather than the rest of the plan.
    const weather = parseStoredWeather(stored.plan.weather);
    const wardrobeSummary = describeWardrobe(candidateWardrobe);

    const systemPrompt = `You are an expert personal stylist AI. The user likes today's plan except for ONE segment. Rebuild ONLY that segment from their ACTUAL wardrobe below — never invent items.

TODAY: ${formatDateLabel(localDate, timeZone)}
${describeWeather(weather)}

TODAY'S CALENDAR OCCASIONS (chronological; empty if none):
${occasionData.occasions.length > 0 ? JSON.stringify(occasionData.occasions, null, 2) : "(no calendar events today)"}

TODAY'S FULL PLAN — you are replacing exactly one entry, the rest stay as they are:
${JSON.stringify(planOutline, null, 2)}

SEGMENT TO REGENERATE: "${target.label}" at position ${target.position}, covering event IDs ${JSON.stringify(target.event_ids || [])}.

REJECTED ITEM IDS — the user disliked this segment. Do NOT use any of these:
${JSON.stringify(rejectedItemIds)}

USER PROFILE:
${profile ? `Name: ${profile.name || "User"}, Body Shape: ${profile.body_shape || "Unknown"}` : "No profile data"}
${profile?.preference_dna ? `Preferences: ${JSON.stringify(profile.preference_dna)}` : ""}

USER'S AVAILABLE WARDROBE (${wardrobeSummary.length} items):
${JSON.stringify(wardrobeSummary, null, 2)}

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

    const { error: persistError } = await supabase.rpc("regenerate_outfit_plan_segment", {
      p_segment_id: target.id,
      p_label: generated.label,
      p_reasoning: generated.reasoning,
      p_change_from_previous: previousSegment ? generated.changeFromPrevious ?? null : null,
      p_event_ids: generated.eventIds,
      p_item_ids: generated.itemIds,
      p_next_change_from_previous: nextSegment ? generated.nextChangeFromPrevious ?? null : null,
    });

    if (persistError) throw persistError;

    const persisted = await readStoredPlan(supabase, userId, localDate);
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
