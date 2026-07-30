import type { WeatherData } from "@/lib/weather/types";

export interface DailyWardrobeItem {
  id: string;
  category: string;
  subcategory: string | null;
  color: string | null;
  brand: string | null;
  clean_url: string | null;
  original_url: string;
}

export interface DailyOccasion {
  id: string;
  title: string;
  occasion: string;
  formality: number | null;
  time: string;
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
