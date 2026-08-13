// ── Core domain types matching Supabase schema ──

export type BodyShape = "pear" | "apple" | "hourglass" | "rectangle" | "inverted_triangle";

export interface Profile {
  id: string;
  email: string | null;
  name: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  timezone: string | null;
  roles: string[];
  // Phase 10-A / D16: the human stylist's read window over this client's closet.
  // Written by /api/webhooks/consult-ended (14 days after a consultation ends) and
  // clearable by the client from /profile. Null or past = no stylist access.
  access_expires_at: string | null;
  // D17 L1 master switch. False (default) means the stylist sees no occasions at all.
  stylist_share_occasions: boolean;
  height_cm: number | null;
  weight_kg: number | null;
  body_shape: BodyShape | null;
  bust_cm: number | null;
  waist_cm: number | null;
  hip_cm: number | null;
  skin_tone: string | null;
  hair_color: string | null;
  hair_length: string | null;
  preference_dna: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type ItemCategory =
  | "Tops"
  | "Bottoms"
  | "Dresses"
  | "Outerwear"
  | "Shoes"
  | "Bags"
  | "Accessories";

export const ITEM_CATEGORIES: ItemCategory[] = [
  "Tops",
  "Bottoms",
  "Dresses",
  "Outerwear",
  "Shoes",
  "Bags",
  "Accessories",
];

export interface WardrobeItem {
  id: string;
  user_id: string;
  original_url: string;
  clean_url: string | null;
  display_name: string | null;
  user_notes: string | null;
  category: ItemCategory;
  subcategory: string | null;
  color: string | null;
  colors: string[];
  brand: string | null;
  material: string | null;
  season: string[];
  occasion: string[];
  style_tags: string[];
  product_url: string | null;
  times_worn: number;
  last_worn_at: string | null;
  favorite: boolean;
  archived: boolean;
  ai_confidence: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * An extra reference angle for a wardrobe item (back, side, detail, care tag).
 * Display-only: no background removal, no classification, and never used by any
 * styling path — those read WardrobeItem.clean_url / original_url.
 */
export interface WardrobeItemPhoto {
  id: string;
  item_id: string;
  user_id: string;
  url: string;
  storage_path: string | null;
  angle: string | null;
  position: number;
  created_at: string;
}

export interface Outfit {
  id: string;
  user_id: string;
  name: string | null;
  folder: string;
  image_url: string | null;
  notes: string | null;
  rating: number | null;
  times_worn: number;
  last_worn_at: string | null;
  ai_generated: boolean;
  ai_reasoning: string | null;
  created_at: string;
  updated_at: string;
  // joined
  items?: WardrobeItem[];
}

export interface OutfitJournalEntry {
  id: string;
  user_id: string;
  outfit_id: string | null;
  plan_segment_id: string | null;
  item_ids: string[];
  worn_date: string;
  event_name: string | null;
  event_type: string | null;
  notes: string | null;
  created_at: string;
  // joined
  outfit?: Outfit;
}

export interface StyleDNA {
  user_id: string;
  color_dist: Record<string, number>;
  style_dist: Record<string, number>;
  category_dist: Record<string, number>;
  total_items: number;
  updated_at: string;
}

export interface TravelPlan {
  id: string;
  user_id: string;
  destination: string;
  destination_lat: number | null;
  destination_lng: number | null;
  destination_timezone: string | null;
  start_date: string;
  end_date: string;
  travel_goals: string[];
  packing_list: unknown[];
  daily_outfits: unknown[];
  weather_data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// google_connections is service-role-only (no client-facing RLS policy) — this type
// exists for src/lib/google/client.ts, not for use with the browser/server Supabase clients.
export interface GoogleConnection {
  user_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  scopes: string[];
  google_email: string | null;
  invalid_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalendarEvent {
  id: string;
  user_id: string;
  google_event_id: string;
  title: string | null;
  // Raw Google Calendar location. User edits are stored separately so a sync
  // cannot silently overwrite the place they chose for weather planning.
  location: string | null;
  location_override: string | null;
  weather_city: string | null;
  weather_lat: number | null;
  weather_lng: number | null;
  weather_timezone: string | null;
  weather_city_override: string | null;
  weather_lat_override: number | null;
  weather_lng_override: number | null;
  weather_timezone_override: string | null;
  weather_location_resolved: boolean;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  attendee_count: number;
  occasion: string | null;
  formality: number | null;
  // D17: closed enum (see COMPANION_TYPES) the stylist-facing wording is assembled
  // from, so that wording never derives from `title`.
  companion: string | null;
  // D17 L2: per-event opt-in that additionally reveals this event's time and raw
  // title to the stylist. Defaults false; L1 alone shows neither.
  stylist_share_detail: boolean;
  synced_at: string;
}

export type OutfitPlanSource = "daily" | "weekly" | "travel";
export type OutfitPlanStatus = "suggested" | "accepted" | "rejected" | "worn";

export interface OutfitPlan {
  id: string;
  user_id: string;
  plan_date: string;
  source: OutfitPlanSource;
  travel_plan_id: string | null;
  gap: string | null;
  weather: Record<string, unknown>;
  status: OutfitPlanStatus;
  generated_at: string;
  created_at: string;
  updated_at: string;
}

export interface OutfitPlanSegment {
  id: string;
  outfit_plan_id: string;
  position: number;
  label: string;
  reasoning: string;
  change_from_previous: string | null;
  event_ids: string[];
  saved_outfit_id: string | null;
  source_outfit_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface OutfitPlanSegmentItem {
  segment_id: string;
  item_id: string;
  position: number;
  // Normalized freeform Canvas geometry, same meaning as outfit_items.x/y/width.
  // Null until the user arranges the segment on /home; the UI falls back to a
  // deterministic default grid for those.
  x: number | null;
  y: number | null;
  width: number | null;
  created_at: string;
}

export type StylistBookingService = "online_30" | "in_person_day";
export type StylistBookingStatus = "confirmed" | "cancelled";

export interface HumanStylistBooking {
  id: string;
  user_id: string;
  service_type: StylistBookingService;
  starts_at: string;
  ends_at: string;
  timezone: string;
  status: StylistBookingStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ── Phase 10-A: human stylist review & suggestions ──

/**
 * What a suggestion is about.
 *
 * `item` is a rating/comment on a single closet piece — it never carries a proposal
 * (a lone garment has no arrangement to change). `new_outfit` is the opposite: a Look
 * the stylist built from the client's pieces that doesn't exist yet, so it has no
 * target row at all and *must* carry a proposal plus a name. Both rules live in the
 * schema's target check rather than being left to the route.
 */
export type StylistReviewTargetKind = "outfit" | "plan_segment" | "item" | "new_outfit";
export type StylistReviewStatus = "pending" | "accepted" | "declined" | "reverted";

/**
 * One suggestion from the human stylist. Deliberately a *proposal*: nothing here
 * touches the client's own outfits/plan rows until they accept, which is what makes
 * "采纳或者不要" meaningful. Created server-side (service role) and resolved through
 * the accept/decline/revert RPCs — the tables have read policies only.
 */
export interface StylistReview {
  id: string;
  client_id: string;
  stylist_id: string;
  target_kind: StylistReviewTargetKind;
  target_outfit_id: string | null;
  target_segment_id: string | null;
  target_item_id: string | null;
  /** `new_outfit` only: the name accepting will give the created Look. */
  proposed_name: string | null;
  /** `new_outfit` only: what accepting created, so undo removes exactly that Look. */
  created_outfit_id: string | null;
  rating: number | null;
  note: string | null;
  has_proposal: boolean;
  status: StylistReviewStatus;
  /** Snapshot with geometry, written at accept time so the accept can be undone. */
  previous_items: StylistReviewItemGeometry[] | null;
  /** Previous outfit copy and adjacent transition copy, restored by undo. */
  previous_text: {
    description: string | null;
    changeFromPrevious?: string | null;
    nextSegmentId?: string | null;
    nextChangeFromPrevious?: string | null;
  } | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StylistReviewItemGeometry {
  itemId: string;
  x: number | null;
  y: number | null;
  width: number | null;
}

export interface StylistReviewItem {
  review_id: string;
  item_id: string;
  position: number;
  x: number | null;
  y: number | null;
  width: number | null;
  created_at: string;
}

/** D16: who looked at whose closet, and when. Client-readable, stylist-invisible. */
export interface WardrobeAccessLogEntry {
  id: string;
  stylist_id: string;
  client_id: string;
  resource: string;
  accessed_at: string;
}

// ── AI Classification result ──

export interface AIClassification {
  category: ItemCategory;
  subcategory: string;
  color: string;
  colors: string[];
  material: string;
  season: string[];
  occasion: string[];
  style_tags: string[];
  confidence: number;
}
