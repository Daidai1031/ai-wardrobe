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

export interface DailySegmentResponse {
  id: string;
  label: string;
  items: DailyWardrobeItem[];
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
