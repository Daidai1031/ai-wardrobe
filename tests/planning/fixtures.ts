import {
  buildCandidatePool,
  isActivewear,
  isHardToTravelIn,
  isLongSleeve,
  isSportSuitable,
  type CandidatePool,
  type RuleSegment,
  type SegmentContextLookup,
  type SegmentKind,
} from "@/lib/planning/plan-rules";

/**
 * A small but realistic closet, shaped like the columns `wardrobe_items` actually
 * stores. The rule functions take lookups rather than rows, so this is the one
 * place that turns an id into an item — exactly as the weekly and daily routes do.
 */
export const CLOSET = {
  "top-tee": { category: "Tops", subcategory: "cotton t-shirt", occasion: ["casual"] },
  "top-blouse": { category: "Tops", subcategory: "silk blouse", occasion: ["work"] },
  "top-sweater": { category: "Tops", subcategory: "wool sweater", occasion: ["casual"] },
  "top-polo": { category: "Tops", subcategory: "golf polo", occasion: ["sport", "casual"] },

  "bottom-jeans": { category: "Bottoms", subcategory: "straight jeans", occasion: ["casual"] },
  "bottom-trousers": { category: "Bottoms", subcategory: "tailored trousers", occasion: ["work"] },
  "bottom-shorts": { category: "Bottoms", subcategory: "golf shorts", occasion: ["sport"] },
  "bottom-leggings": { category: "Bottoms", subcategory: "leggings", occasion: ["sport"] },

  "dress-midi": { category: "Dresses", subcategory: "cotton midi dress", occasion: ["casual"] },

  "coat-blazer": { category: "Outerwear", subcategory: "wool blazer", occasion: ["work"] },
  "coat-trench": { category: "Outerwear", subcategory: "trench coat", occasion: ["work"] },

  "shoes-pumps": { category: "Shoes", subcategory: "leather pump", occasion: ["work"] },
  "shoes-flats": { category: "Shoes", subcategory: "ballet flat", occasion: ["work", "casual"] },
  "shoes-trainers": { category: "Shoes", subcategory: "running trainer", occasion: ["sport"] },

  "bag-tote": { category: "Bags", subcategory: "canvas tote", occasion: ["casual"] },
  "bag-clutch": { category: "Bags", subcategory: "satin clutch", occasion: ["party"] },

  "acc-belt": { category: "Accessories", subcategory: "leather belt", occasion: ["work"] },
  "acc-scarf": { category: "Accessories", subcategory: "silk scarf", occasion: ["work"] },
  "acc-hat": { category: "Accessories", subcategory: "straw hat", occasion: ["casual"] },
  "acc-sunglasses": { category: "Accessories", subcategory: "sunglasses", occasion: ["casual"] },
  "acc-earrings": { category: "Accessories", subcategory: "gold earrings", occasion: ["party"] },
} as const satisfies Record<
  string,
  { category: string; subcategory: string; occasion: string[] }
>;

export type ItemId = keyof typeof CLOSET;

export const ALL_ITEM_IDS = Object.keys(CLOSET) as ItemId[];

const itemOf = (itemId: string) => {
  const item = CLOSET[itemId as ItemId];
  if (!item) throw new Error(`Test fixture has no item "${itemId}"`);
  // `occasion` is readonly on the const fixture; the predicates take a plain array.
  return { ...item, occasion: [...item.occasion] };
};

export const categoryFor = (itemId: string): string => itemOf(itemId).category;
export const isLongSleeveFor = (itemId: string): boolean => isLongSleeve(itemOf(itemId));
export const isHardToTravelInFor = (itemId: string): boolean => isHardToTravelIn(itemOf(itemId));
export const isActivewearFor = (itemId: string): boolean => isActivewear(itemOf(itemId));
export const isSportSuitableFor = (itemId: string): boolean => isSportSuitable(itemOf(itemId));

/** The candidate pool a repair draws from. Restrict it to model a smaller closet. */
export function poolOf(itemIds: readonly string[] = ALL_ITEM_IDS): CandidatePool {
  return buildCandidatePool([...itemIds], categoryFor);
}

/**
 * Segment context is derived by the caller from the calendar, and the enforcement
 * functions clone segments as they go — so a lookup keyed on object identity would
 * break the moment a rule ran. `eventIds` is spread through every clone, so the
 * marker rides along, which is also how the real routes carry it.
 */
export function seg(kind: SegmentKind, formality: number | null, itemIds: string[]): RuleSegment {
  return { itemIds, eventIds: [`${kind}:${formality ?? "null"}`] };
}

export const contextFor: SegmentContextLookup = (segment) => {
  const [kind, formality] = (segment.eventIds?.[0] ?? "general:3").split(":");
  return {
    kind: kind as SegmentKind,
    formality: formality === "null" ? null : Number(formality),
  };
};

/** Every category present in a segment, for assertions that don't care which item. */
export function categoriesIn(itemIds: string[]): string[] {
  return itemIds.map(categoryFor);
}
