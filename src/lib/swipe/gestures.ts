/**
 * The swipe vocabulary from `docs/recommendation-system-plan.md` §4.1–§4.3.
 *
 * Deliberately storage-free and React-free. The prototype deck on /home is the
 * only consumer today, but the `swipe_event` table has to speak these exact
 * strings when it lands — the plan's own point is that the event schema is the
 * one thing that must be right from day one, and a prototype that invents its
 * own labels guarantees a translation layer later.
 */

export const SWIPE_GESTURES = ["like", "dislike", "wear_now", "later"] as const;
export type SwipeGesture = (typeof SWIPE_GESTURES)[number];

export type SwipeDirection = "right" | "left" | "up" | "down";

/** §4.1. `later` is weak signal and is excluded from training, not merely down-weighted. */
export const GESTURE_BY_DIRECTION: Record<SwipeDirection, SwipeGesture> = {
  right: "like",
  left: "dislike",
  up: "wear_now",
  down: "later",
};

export const GESTURE_COPY: Record<
  SwipeGesture,
  { verb: string; hint: string; direction: SwipeDirection }
> = {
  like: { verb: "Like", hint: "Save to lookbook", direction: "right" },
  dislike: { verb: "Nope", hint: "Tell us why", direction: "left" },
  wear_now: { verb: "Wear", hint: "Strongest signal", direction: "up" },
  later: { verb: "Later", hint: "Wrong season / not today", direction: "down" },
};

/**
 * §4.2. A left swipe without a reason is nearly unlearnable — the item, the
 * combination and the occasion tag are three different fixes and the gesture
 * alone can't tell them apart. `targets: "item"` marks the one reason that is
 * about a single piece, which is why the deck then asks *which* piece.
 */
export const DISLIKE_REASONS = [
  { id: "wrong_occasion", label: "Wrong occasion", targets: "outfit" },
  { id: "wrong_fit", label: "Wrong fit for my body", targets: "outfit" },
  { id: "wrong_color", label: "Wrong color for me", targets: "outfit" },
  { id: "not_my_style", label: "Not my style", targets: "outfit" },
  { id: "dislike_item", label: "Don't like this specific item", targets: "item" },
  { id: "dont_go_together", label: "Items don't go together", targets: "outfit" },
] as const;

export type DislikeReason = (typeof DISLIKE_REASONS)[number]["id"];

export type SwipeSurface = "onboarding" | "daily_feed" | "stylist_review";
export type CandidateSource = "rule" | "embedding" | "stylist_curated" | "exploration";

/**
 * §4.3, minus the fields only a server can fill (`user_id`, weather/calendar
 * context). `candidate_source` and `model_version` are the two the plan warns
 * everyone forgets: without them no later change can be attributed to anything.
 */
export interface SwipeEventDraft {
  outfit_id: string;
  item_ids: string[];
  gesture: SwipeGesture;
  reason_tags: DislikeReason[];
  /** Which piece `dislike_item` is about. That tag is unlearnable without it. */
  reason_item_id: string | null;
  surface: SwipeSurface;
  candidate_source: CandidateSource;
  model_version: string;
  dwell_ms: number;
  position_in_deck: number;
  created_at: string;
}

/** Nothing has been trained yet; the deck is hand-ordered saved Looks. */
export const PROTOTYPE_MODEL_VERSION = "prototype-0";
