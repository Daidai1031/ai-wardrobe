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

export interface DailyResponse {
  planId: string | null;
  date: string;
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
