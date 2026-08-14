import type { DailyWardrobeItem } from "./daily";
import type { TripType } from "./database";
import type { WeeklyDay } from "./weekly";

export type { TripType };

/**
 * A trip as detected from the calendar, before it has a `travel_plans` row.
 *
 * Everything here is derived from `calendar_events` on every read, so a trip whose
 * flight moved or whose destination was corrected re-detects with the new dates
 * rather than going stale. `signature` is what carries the identity across those
 * re-detections — see schema section 21.
 */
export interface DetectedTrip {
  signature: string;
  destination: string;
  /** Every distinct city the trip touches, in first-seen order. Multi-city trips are real. */
  cities: string[];
  destinationLat: number | null;
  destinationLng: number | null;
  destinationTimezone: string | null;
  startDate: string;
  endDate: string;
  /** Every local date of the trip, inclusive and contiguous. */
  dates: string[];
  tripType: TripType;
  /** Why it was classified that way, shown in the UI so the badge isn't a black box. */
  typeReason: string;
  eventIds: string[];
  /** Titles of the events that put this trip on the map, for the card's subtitle. */
  highlights: string[];
}

/** A detected trip joined to its stored row, when it has one. */
export interface TripSummary extends DetectedTrip {
  /** Null until the user opens the trip and it is materialized. */
  id: string | null;
  /** Days of the trip that already have a plan, from /plan or from here. */
  plannedDays: number;
  confirmedDays: number;
  shared: boolean;
}

export interface TripListResponse {
  trips: TripSummary[];
  /** True when the account has no Google Calendar connection, so nothing could be detected. */
  calendarConnected: boolean;
  /** Local date the 30-day detection window starts on. */
  windowStart: string;
  windowEnd: string;
  message?: string;
  error?: string;
}

/**
 * A checklist entry that is not a garment. Deliberately a fixed template plus the
 * user's own additions rather than anything generated (D11): a model will forget the
 * charger and invent a travel adaptor the user doesn't own.
 */
export interface PackingExtra {
  id: string;
  label: string;
  /** Template entries can be hidden but not deleted; custom ones can be deleted. */
  custom: boolean;
  checked: boolean;
}

export interface TripPackingList {
  /** Wardrobe item ids the user has ticked off. Garments themselves come from the confirmed days. */
  packedItemIds: string[];
  extras: PackingExtra[];
  /** Template ids the user removed, so they stay removed across reloads. */
  hiddenTemplateIds: string[];
}

/** One garment to pack, with every trip date it is worn on. */
export interface PackingGarment {
  item: DailyWardrobeItem;
  dates: string[];
  packed: boolean;
}

export interface TripMeta {
  id: string;
  destination: string;
  cities: string[];
  startDate: string;
  endDate: string;
  /** Every local date of the trip. */
  dates: string[];
  /**
   * How many of those days one generation actually covers. Equal to `dates.length`
   * for any normal trip; a very long one is capped by the planner's window and the
   * UI says so rather than quietly planning half.
   */
  planDays: number;
  tripType: TripType;
  typeReason: string;
  confirmedDates: string[];
  shareToken: string | null;
  origin: "manual" | "calendar";
}

/**
 * The trip's own state. The day outfits are deliberately not in here — the client
 * fetches those from `/api/ai/weekly?start=&days=`, which is the same endpoint and
 * the same stored rows `/plan` uses.
 */
export interface TripDetailResponse {
  trip: TripMeta;
  packing: TripPackingList;
  message?: string;
  error?: string;
}

/** Everything the print page and the public share page render, read server-side in one place. */
export interface TripRenderData {
  trip: TripMeta;
  days: WeeklyDay[];
  garments: PackingGarment[];
  packing: TripPackingList;
  availableItems: DailyWardrobeItem[];
}
