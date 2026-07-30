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
    .select("segment_id, item_id, position")
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
      .map((row) => byId.get(row.item_id))
      .filter((item): item is DailyWardrobeItem => Boolean(item)),
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

async function handleDaily(request: NextRequest, regenerate: boolean) {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
    const availableItems = wardrobe.map(toClientItem);

    if (stored && !regenerate) {
      return NextResponse.json(buildStoredResponse(stored, wardrobe, occasionData.occasions, true));
    }

    if (stored?.plan.status === "worn" && regenerate) {
      return NextResponse.json(
        { error: "Today's worn plan cannot be regenerated." },
        { status: 409 }
      );
    }

    let rejectedItemIds: string[] = [];
    if (regenerate) {
      const body = (await request.json().catch(() => ({}))) as { rejectedItemIds?: unknown };
      if (Array.isArray(body.rejectedItemIds)) {
        const ownedIds = new Set(wardrobe.map((item) => String(item.id)));
        rejectedItemIds = uniqueIds(
          body.rejectedItemIds.filter(
            (id): id is string => typeof id === "string" && isUuid(id) && ownedIds.has(id)
          )
        );
      }
    }

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

    const wardrobeSummary = candidateWardrobe.map((item) => ({
      id: item.id,
      type: `${item.category} — ${item.subcategory || "unknown"}`,
      color: item.color,
      material: item.material,
      seasons: item.season,
      occasions: item.occasion,
      tags: item.style_tags,
    }));

    const dateLabel = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(new Date(`${localDate}T12:00:00Z`));

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
${weather ? `WEATHER: ${weather.temp}°C (feels like ${weather.feels_like}°C), ${weather.description}, wind ${weather.wind_speed} m/s, in ${weather.city}` : "WEATHER: unknown, no city set in profile"}

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

    const persisted = await readStoredPlan(supabase, user.id, localDate);
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
 * GET returns the persisted daily plan when present. Claude is called only on a
 * cache miss. POST is the explicit Dislike/regenerate path and overwrites the
 * same parent plan after excluding the rejected item IDs supplied by the client.
 */
export async function GET(request: NextRequest) {
  return handleDaily(request, false);
}

export async function POST(request: NextRequest) {
  return handleDaily(request, true);
}
