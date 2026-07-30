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
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  attendee_count: number;
  occasion: string | null;
  formality: number | null;
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
