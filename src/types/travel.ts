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
/** One city of a trip, with the dates it covers. */
export interface TripLeg {
  city: string;
  startDate: string;
  endDate: string;
}

/**
 * A correction the user made to what detection produced.
 *
 * Anchored on the signature of the trip they were looking at, never on a stored row:
 * a split produces a half that has no row yet, and a merge makes the later trip's
 * signature disappear, so neither can be recorded on `travel_plans`. Schema 22.
 */
export interface TripDecision {
  /**
   * `split` cuts the trip at `boundaryDate`; `merge` joins it with the trip that
   * follows it; `keep` is "leave it as detected", which exists so a dismissed
   * suggestion stays dismissed instead of being asked again on every load.
   */
  action: "split" | "merge" | "keep";
  anchorSignature: string;
  /** Required by `split`, the first local date of the second half. Null otherwise. */
  boundaryDate: string | null;
}

export interface DetectedTrip {
  signature: string;
  destination: string;
  /** Every distinct city the trip touches, in first-seen order. Multi-city trips are real. */
  cities: string[];
  /** Those cities with their dates — what makes "is this two trips?" answerable. */
  legs: TripLeg[];
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

/**
 * A question detection wants to ask about a trip it isn't sure it got right.
 *
 * Only ever raised where the evidence is concrete — a trip covering two cities, or two
 * trips whose destinations are close enough that the split may have been wrong — never
 * as a general "is this right?", which would train the user to dismiss it.
 */
export interface TripSuggestion {
  kind: "split" | "merge";
  /** The signature the answer will be anchored on. */
  signature: string;
  question: string;
  /** What the affirmative button does, e.g. "Split into two trips". */
  actionLabel: string;
  /** `split` only: the date the second trip would start on. */
  boundaryDate?: string;
}

/** A detected trip joined to its stored row, when it has one. */
export interface TripSummary extends DetectedTrip {
  /** Set when detection wants to check its own work on this trip. */
  suggestion?: TripSuggestion;
  /** True when this trip's shape is the user's decision rather than detection's. */
  userShaped?: boolean;
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
