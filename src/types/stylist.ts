import type { ItemCategory } from "@/types/database";

export type StylistServiceType = "online_30" | "in_person_day";

export interface StylistWardrobeItem {
  id: string;
  category: ItemCategory;
  subcategory: string | null;
  color: string | null;
  brand: string | null;
  clean_url: string | null;
  original_url: string;
}

export interface StylistQuestionResponse {
  type: "question";
  reply: string;
  questions: string[];
}

export interface StylistLook {
  name: string;
  summary: string;
  reasoning: string[];
  stylingNotes: string[];
  gap: string | null;
  items: StylistWardrobeItem[];
}

export interface StylistRecommendationResponse {
  type: "recommendation";
  reply: string;
  look: StylistLook;
  availableItems: StylistWardrobeItem[];
}

export type StylistResponse = StylistQuestionResponse | StylistRecommendationResponse;

export interface StylistSlot {
  startsAt: string;
  endsAt: string;
  dateLabel: string;
  timeLabel: string;
}

export interface StylistBooking {
  id: string;
  serviceType: StylistServiceType;
  startsAt: string;
  endsAt: string;
  timezone: string;
  scheduleTimezone: string;
  status: "confirmed" | "cancelled";
  dateLabel: string;
  timeLabel: string;
}

export interface StylistSlotsResponse {
  serviceType: StylistServiceType;
  timezone: string;
  scheduleTimezone: string;
  slots: StylistSlot[];
}
