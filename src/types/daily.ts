import type { WeatherData } from "@/lib/weather/types";

export interface DailyWardrobeItem {
  id: string;
  display_name: string | null;
  user_notes: string | null;
  category: string;
  subcategory: string | null;
  color: string | null;
  brand: string | null;
  optimized_url: string | null;
  clean_url: string | null;
  original_url: string;
}

export interface DailyOccasion {
  id: string;
  title: string;
  occasion: string;
  formality: number | null;
  time: string;
  /**
   * Google all-day events have no real instant. Planning needs it explicitly: an
   * all-day "Business Trip (London)" is a container for the whole day, not the
   * journey itself, and only the timed flight is dressed for comfort.
   */
  allDay: boolean;
  /** Effective event place shown in the planner: user override first, then Google. */
  location: string | null;
  /** Canonical city whose coordinates are used for this event's weather. */
  weatherCity: string | null;
  /** True when location is a local planning override rather than Google's value. */
  locationOverridden: boolean;
  /**
   * ROADMAP D17 L2: this single event's time and title are visible to the human
   * stylist. Off by default; the client turns it on per event from /plan, where the
   * thing being revealed is on screen next to the switch.
   */
  sharedWithStylist?: boolean;
}

/**
 * A wardrobe item as it sits inside a plan segment, carrying the freeform
 * Canvas geometry the user arranged. x/y/width are null for a freshly generated
 * segment — the model never produces layout — and the UI falls back to the
 * shared default grid in that case.
 */
export interface DailySegmentItem extends DailyWardrobeItem {
  x: number | null;
  y: number | null;
  width: number | null;
}

export interface DailySegmentResponse {
  id: string;
  label: string;
  items: DailySegmentItem[];
  reasoning: string;
  changeFromPrevious?: string;
  eventIds: string[];
  savedOutfitId: string | null;
  /** Saved Look this segment was copied from, retained while the copy is edited. */
  sourceOutfitId: string | null;
}

export type DailyPlanStatus = "suggested" | "accepted" | "rejected" | "worn";

/**
 * How the plan for this date was produced. Since Phase 6.2 a date has exactly one
 * plan, so this is provenance only — it never decides which plan a date has. `/home`
 * uses it to tell the user today's outfit came from their week plan, and regenerating
 * a day from `/home` flips it back to `"daily"` because that day is no longer bound
 * by the week's cross-day constraints.
 */
export type DailyPlanSource = "daily" | "weekly" | "travel";

export interface DailyResponse {
  planId: string | null;
  date: string;
  source: DailyPlanSource;
  weather: WeatherData | null;
  /** All relevant conditions when a day spans multiple cities. */
  weatherLocations?: WeatherData[];
  occasions: DailyOccasion[];
  segments: DailySegmentResponse[];
  availableItems: DailyWardrobeItem[];
  gap?: string;
  status: DailyPlanStatus;
  generatedAt: string | null;
  cached: boolean;
  message?: string;
  error?: string;
}
