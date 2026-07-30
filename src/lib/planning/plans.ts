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
  "id, outfit_plan_id, position, label, reasoning, change_from_previous, event_ids, saved_outfit_id";
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
    items: (bySegment.get(segment.id) || [])
      .sort((a, b) => a.position - b.position)
      .map((row) => {
        const item = itemsById.get(row.item_id);
        return item ? { ...item, x: row.x, y: row.y, width: row.width } : null;
      })
      .filter((item): item is DailySegmentItem => Boolean(item)),
  }));
}
