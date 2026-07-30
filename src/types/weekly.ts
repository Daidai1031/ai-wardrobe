import type { DailyForecast } from "@/lib/weather/types";
import type {
  DailyOccasion,
  DailyPlanSource,
  DailyPlanStatus,
  DailySegmentResponse,
  DailyWardrobeItem,
} from "./daily";

/**
 * One day of the week view. A day with no plan yet still appears (with its
 * forecast and occasions) so the user can see what the week holds before spending
 * a generation on it.
 */
export interface WeeklyDay {
  date: string;
  planId: string | null;
  status: DailyPlanStatus;
  source: DailyPlanSource;
  forecast: DailyForecast | null;
  occasions: DailyOccasion[];
  segments: DailySegmentResponse[];
  gap?: string;
  generatedAt: string | null;
}

export interface WeeklyResponse {
  start: string;
  end: string;
  days: WeeklyDay[];
  availableItems: DailyWardrobeItem[];
  /** True when every day in the window already had a stored plan. */
  complete: boolean;
  /**
   * Dates the generator left untouched because they were already confirmed worn.
   * Surfaced so a day that looks "not regenerated" reads as deliberate rather than
   * as a silent failure.
   */
  skippedDates?: string[];
  /**
   * Rotation rules the generator could not satisfy even after a repair pass —
   * usually a wardrobe too small in some category to fill seven days without
   * repeating. Shown rather than swallowed, so a repeat reads as a known
   * limitation instead of the plan looking careless.
   */
  warnings?: string[];
  message?: string;
  error?: string;
}
