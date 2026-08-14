/**
 * Reading persisted plans out of the three-table structure
 * (`outfit_plans` → `outfit_plan_segments` → `outfit_plan_segment_items`).
 *
 * Daily reads one date and weekly reads seven, but the joining, ordering and
 * layout-carrying are identical, so they share this rather than keeping two copies
 * that quietly drift.
 *
 * Since Phase 6.2 a date has exactly one non-travel plan regardless of `source`,
 * so nothing here filters on it — `source` is provenance the caller may display,
 * never a selector.
 */

import type { createServerSupabase } from "@/lib/supabase/server";
import { resolveRotationLimits, type RotationLimits } from "@/lib/planning/plan-rules";
import type {
  DailyPlanSource,
  DailyPlanStatus,
  DailySegmentItem,
  DailySegmentResponse,
  DailyWardrobeItem,
} from "@/types/daily";

type ServerSupabase = Awaited<ReturnType<typeof createServerSupabase>>;

export interface StoredPlan {
  id: string;
  plan_date: string;
  source: DailyPlanSource;
  gap: string | null;
  weather: unknown;
  status: DailyPlanStatus;
  generated_at: string;
}

export interface StoredSegment {
  id: string;
  outfit_plan_id: string;
  position: number;
  label: string;
  reasoning: string;
  change_from_previous: string | null;
  event_ids: string[] | null;
  saved_outfit_id: string | null;
  source_outfit_id: string | null;
}

export interface StoredSegmentItem {
  segment_id: string;
  item_id: string;
  position: number;
  x: number | null;
  y: number | null;
  width: number | null;
}

export interface StoredPlanBundle {
  plan: StoredPlan;
  segments: StoredSegment[];
  segmentItems: StoredSegmentItem[];
}

const PLAN_SELECT = "id, plan_date, source, gap, weather, status, generated_at";
const SEGMENT_SELECT =
  "id, outfit_plan_id, position, label, reasoning, change_from_previous, event_ids, saved_outfit_id, source_outfit_id";
const SEGMENT_ITEM_SELECT = "segment_id, item_id, position, x, y, width";

/**
 * Every non-travel plan on the given local dates, keyed by date. Dates with no
 * plan, or a plan whose segments were never written, are simply absent — callers
 * decide whether that means "generate" or "show an empty day".
 */
export async function readPlansForDates(
  supabase: ServerSupabase,
  userId: string,
  dates: string[]
): Promise<Map<string, StoredPlanBundle>> {
  const result = new Map<string, StoredPlanBundle>();
  if (dates.length === 0) return result;

  const { data: plans, error: plansError } = await supabase
    .from("outfit_plans")
    .select(PLAN_SELECT)
    .eq("user_id", userId)
    .in("plan_date", dates)
    .is("travel_plan_id", null);

  if (plansError) throw plansError;
  const storedPlans = (plans || []) as StoredPlan[];
  if (storedPlans.length === 0) return result;

  const { data: segments, error: segmentsError } = await supabase
    .from("outfit_plan_segments")
    .select(SEGMENT_SELECT)
    .in(
      "outfit_plan_id",
      storedPlans.map((plan) => plan.id)
    )
    .order("position");

  if (segmentsError) throw segmentsError;
  const storedSegments = (segments || []) as StoredSegment[];

  let storedItems: StoredSegmentItem[] = [];
  if (storedSegments.length > 0) {
    const { data: items, error: itemsError } = await supabase
      .from("outfit_plan_segment_items")
      .select(SEGMENT_ITEM_SELECT)
      .in(
        "segment_id",
        storedSegments.map((segment) => segment.id)
      )
      .order("position");

    if (itemsError) throw itemsError;
    storedItems = (items || []) as StoredSegmentItem[];
  }

  for (const plan of storedPlans) {
    const planSegments = storedSegments
      .filter((segment) => segment.outfit_plan_id === plan.id)
      .sort((a, b) => a.position - b.position);
    // A plan row with no segments is not usable as a cache hit; treating it as one
    // would show the user an empty day they can't act on.
    if (planSegments.length === 0) continue;

    const segmentIds = new Set(planSegments.map((segment) => segment.id));
    result.set(plan.plan_date, {
      plan,
      segments: planSegments,
      segmentItems: storedItems.filter((item) => segmentIds.has(item.segment_id)),
    });
  }

  return result;
}

/**
 * The user's own per-category repeat rules (schema section 19), already merged
 * over the defaults.
 *
 * Read on its own rather than as another column on the profile query the planners
 * already run, because this repo applies schema changes by hand: until section 19
 * is pasted into the SQL editor, adding the column to that select would 400 the
 * whole query and take daily and weekly planning down with it. Here the worst case
 * is that everyone plans with the default limits, which is exactly the behaviour
 * that existed before the setting did.
 */
export async function readRotationLimits(
  supabase: ServerSupabase,
  userId: string
): Promise<RotationLimits> {
  const { data, error } = await supabase
    .from("profiles")
    .select("rotation_limits")
    .eq("id", userId)
    .single();

  if (error) {
    console.warn("Falling back to default rotation limits:", error.message);
    return resolveRotationLimits(null);
  }
  return resolveRotationLimits((data as { rotation_limits?: unknown } | null)?.rotation_limits);
}

/**
 * Which dates each item is already committed to, for the rotation rules.
 *
 * The rules used to see only the days in the current request, which made the
 * "same few pieces every time" complaint inevitable: redoing one day had no idea
 * what the other six already used, and each new week started from a blank slate
 * over the same favourites. Reading the neighbouring plans costs one query and
 * turns the limit into a real rolling week.
 */
export async function readWearHistory(
  supabase: ServerSupabase,
  userId: string,
  dates: string[]
): Promise<Map<string, string[]>> {
  return wearHistoryFromPlans(await readPlansForDates(supabase, userId, dates));
}

/** Same shape, from plans the caller has already read. */
export function wearHistoryFromPlans(
  plans: Map<string, StoredPlanBundle>
): Map<string, string[]> {
  const history = new Map<string, string[]>();

  for (const bundle of plans.values()) {
    const onThisDay = new Set(bundle.segmentItems.map((row) => row.item_id));
    for (const itemId of onThisDay) {
      history.set(itemId, [...(history.get(itemId) ?? []), bundle.plan.plan_date]);
    }
  }

  return history;
}

/** Union of several histories, deduplicated per item. */
export function mergeWearHistories(
  ...histories: Map<string, string[]>[]
): Map<string, string[]> {
  const merged = new Map<string, string[]>();
  for (const history of histories) {
    for (const [itemId, dates] of history) {
      merged.set(itemId, [...new Set([...(merged.get(itemId) ?? []), ...dates])].sort());
    }
  }
  return merged;
}

/**
 * The longest window one generation call may cover.
 *
 * Lives here rather than in the route because travel mode has to size its request
 * against the same number: a 20-day trip that asked for 20 days would not get a
 * longer plan, it would get a truncated one, and the UI needs to be able to say so
 * before the user presses the button rather than after.
 */
export const MAX_PLAN_WINDOW_DAYS = 14;

/** Calendar dates from `start`, inclusive. Plain local dates, no time zone involved. */
export function localDateRange(start: string, length: number): string[] {
  const anchor = new Date(`${start}T00:00:00Z`);
  return Array.from({ length }, (_, index) => {
    const date = new Date(anchor);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

/** Convenience wrapper for the single-date (daily) case. */
export async function readPlanForDate(
  supabase: ServerSupabase,
  userId: string,
  date: string
): Promise<StoredPlanBundle | null> {
  const plans = await readPlansForDates(supabase, userId, [date]);
  return plans.get(date) ?? null;
}

/**
 * Hydrate stored segments into the client shape, attaching each item's Canvas
 * geometry. Items the wardrobe lookup can't resolve (archived or deleted since the
 * plan was generated) are dropped rather than rendered as holes.
 */
export function hydrateSegments(
  bundle: StoredPlanBundle,
  itemsById: Map<string, DailyWardrobeItem>
): DailySegmentResponse[] {
  const bySegment = new Map<string, StoredSegmentItem[]>();
  for (const row of bundle.segmentItems) {
    bySegment.set(row.segment_id, [...(bySegment.get(row.segment_id) || []), row]);
  }

  return bundle.segments.map((segment) => ({
    id: segment.id,
    label: segment.label,
    reasoning: segment.reasoning,
    changeFromPrevious: segment.change_from_previous || undefined,
    eventIds: segment.event_ids || [],
    savedOutfitId: segment.saved_outfit_id,
    sourceOutfitId: segment.source_outfit_id,
    items: (bySegment.get(segment.id) || [])
      .sort((a, b) => a.position - b.position)
      .map((row) => {
        const item = itemsById.get(row.item_id);
        return item ? { ...item, x: row.x, y: row.y, width: row.width } : null;
      })
      .filter((item): item is DailySegmentItem => Boolean(item)),
  }));
}
