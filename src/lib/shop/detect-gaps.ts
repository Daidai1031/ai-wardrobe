import { MAX_WEAR_DAYS_BY_CATEGORY, ROTATION_WINDOW_DAYS, isSportSuitable, maxWearDaysFor, type RotationLimits } from "@/lib/planning/plan-rules";
import type { ItemCategory } from "@/types/database";

/**
 * What the closet is missing, decided in TypeScript (D8). Every rule here is exactly
 * decidable from the columns we store, so none of it is asked of a model: a model asked
 * twice would report two different gaps, and the gap is also the cache key for what we
 * recommend. The model only ever sees the result, to word it and to pick brands.
 *
 * Missing data never manufactures a gap. As in `selectCandidates`, an item with no
 * occasion tag counts as fitting any occasion; a closet the classifier left untagged
 * simply reports fewer gaps rather than invented ones.
 */

/** Below this the closet is mostly "not uploaded yet", and any gap would be noise. */
export const MIN_ITEMS_FOR_GAPS = 8;

/** Most gaps reported at once; the rest are lower severity than all of these. */
export const MAX_GAPS = 6;

export type GapReason = "missing_slot" | "occasion" | "season" | "thin" | "neutral";
export type GapOccasion = "work" | "formal" | "casual" | "sport";
export type GapSeverity = "high" | "medium" | "low";

export interface GapItem {
  id: string;
  category: string;
  subcategory?: string | null;
  display_name?: string | null;
  color?: string | null;
  colors?: string[] | null;
  season?: string[] | null;
  occasion?: string[] | null;
  style_tags?: string[] | null;
}

export interface ClosetGap {
  /** Stable across runs for the same gap: it keys `shopping_recommendations`. */
  key: string;
  reason: GapReason;
  category: ItemCategory;
  occasion: GapOccasion | null;
  season: string | null;
  severity: GapSeverity;
  /** How many items the closet has that count toward this gap. */
  have: number;
  /** How many it would need, where the rule is a count; null when the rule is "none at all". */
  need: number | null;
  /** How many existing pieces a new item here would go with. */
  pairsWith: number;
  /** Plain fallback wording; the model rewrites it, the UI can show it as is. */
  description: string;
}

const SEVERITY_RANK: Record<GapSeverity, number> = { high: 0, medium: 1, low: 2 };

const OCCASION_TAGS: Record<Exclude<GapOccasion, "sport">, string[]> = {
  work: ["work"],
  formal: ["formal", "party", "wedding"],
  casual: ["casual"],
};

const OCCASION_SEVERITY: Record<GapOccasion, GapSeverity> = {
  work: "high",
  formal: "medium",
  casual: "medium",
  sport: "low",
};

const COLD_SEASONS = ["fall", "winter"];

const NEUTRALS = [
  "black", "white", "ivory", "cream", "beige", "tan", "camel", "khaki", "navy",
  "gray", "grey", "charcoal", "brown", "nude", "off-white", "off white",
];

function fitsOccasion(item: GapItem, occasion: GapOccasion): boolean {
  if (occasion === "sport") return isSportSuitable({ category: item.category, subcategory: item.subcategory, display_name: item.display_name, occasion: item.occasion, style_tags: item.style_tags });
  const tags = (item.occasion ?? []).map((tag) => tag.toLowerCase());
  if (tags.length === 0) return true;
  return OCCASION_TAGS[occasion].some((tag) => tags.includes(tag));
}

function isNeutral(item: GapItem): boolean {
  const colors = [item.color, ...(item.colors ?? [])].filter(Boolean).map((c) => (c as string).toLowerCase());
  return colors.some((color) => NEUTRALS.some((neutral) => color.includes(neutral)));
}

function warmEnoughSeason(item: GapItem): boolean {
  const seasons = (item.season ?? []).map((s) => s.toLowerCase());
  return seasons.length === 0 || seasons.some((s) => COLD_SEASONS.includes(s));
}

const byCategory = (items: GapItem[], ...categories: string[]) => items.filter((i) => categories.includes(i.category));

/**
 * How many existing pieces a new item of `category` would be worn with, among those that
 * suit the same occasion. Shoes and bags go with any outfit piece; a top needs a bottom or
 * a dress to land on, and the reverse.
 */
function pairsWith(items: GapItem[], category: ItemCategory, occasion: GapOccasion | null): number {
  const partners: Record<ItemCategory, string[]> = {
    Tops: ["Bottoms"],
    Bottoms: ["Tops"],
    Dresses: ["Shoes", "Outerwear", "Bags"],
    Outerwear: ["Tops", "Bottoms", "Dresses"],
    Shoes: ["Tops", "Bottoms", "Dresses"],
    Bags: ["Tops", "Bottoms", "Dresses"],
    Accessories: ["Tops", "Bottoms", "Dresses"],
  };
  return byCategory(items, ...partners[category]).filter((i) => !occasion || fitsOccasion(i, occasion)).length;
}

/**
 * The rotation rules already say how many pieces a week takes: a slot worn once a week
 * needs seven, shoes worn twice need four. A closet well below half of that will repeat
 * the same few things whatever the planner does, which is what "thin" means here.
 */
function thinThreshold(category: string, limits?: RotationLimits): number {
  const perWeek = maxWearDaysFor(category, limits ?? MAX_WEAR_DAYS_BY_CATEGORY);
  return Math.ceil(Math.ceil(ROTATION_WINDOW_DAYS / Math.max(1, perWeek)) / 2);
}

export function detectGaps(items: GapItem[], rotationLimits?: RotationLimits): ClosetGap[] {
  if (items.length < MIN_ITEMS_FOR_GAPS) return [];

  const gaps: ClosetGap[] = [];
  const push = (gap: Omit<ClosetGap, "key" | "pairsWith"> & { pairsWith?: number }) =>
    gaps.push({
      ...gap,
      key: [gap.reason, gap.category, gap.occasion ?? gap.season ?? ""].join(":"),
      pairsWith: gap.pairsWith ?? pairsWith(items, gap.category, gap.occasion),
    });

  const tops = byCategory(items, "Tops");
  const bottoms = byCategory(items, "Bottoms");
  const dresses = byCategory(items, "Dresses");
  const shoes = byCategory(items, "Shoes");
  const outerwear = byCategory(items, "Outerwear");
  const bags = byCategory(items, "Bags");

  // 1. A whole slot with nothing in it. Outranks the per-occasion checks, which would
  // otherwise report the same hole once per occasion.
  const missing: ItemCategory[] = [];
  if (shoes.length === 0) missing.push("Shoes");
  if (dresses.length === 0 && tops.length === 0) missing.push("Tops");
  if (dresses.length === 0 && bottoms.length === 0) missing.push("Bottoms");
  for (const category of missing) {
    push({ reason: "missing_slot", category, occasion: null, season: null, severity: "high", have: 0, need: null, description: `No ${category.toLowerCase()} in the closet at all.` });
  }

  // 2. An occasion with no way to dress for it. A dress covers torso and legs, so a
  // dress alone satisfies both halves; shoes are always needed.
  const occasions: GapOccasion[] = ["work", "formal", "casual", "sport"];
  for (const occasion of occasions) {
    const fit = (list: GapItem[]) => list.filter((i) => fitsOccasion(i, occasion));
    const hasDress = fit(dresses).length > 0;
    const slots: { category: ItemCategory; have: number; needed: boolean }[] = [
      { category: "Tops", have: fit(tops).length, needed: !hasDress && !missing.includes("Tops") },
      { category: "Bottoms", have: fit(bottoms).length, needed: !hasDress && !missing.includes("Bottoms") },
      { category: "Shoes", have: fit(shoes).length, needed: !missing.includes("Shoes") },
    ];
    for (const slot of slots) {
      if (!slot.needed || slot.have > 1) continue;
      if (slot.have === 0) {
        push({ reason: "occasion", category: slot.category, occasion, season: null, severity: OCCASION_SEVERITY[occasion], have: 0, need: null, description: `No ${slot.category.toLowerCase()} you could wear for ${occasion}.` });
      } else {
        // One option is an outfit, not a choice: the rotation rules allow it once a week, and
        // a well-stocked closet would otherwise never report anything worth buying.
        push({ reason: "occasion", category: slot.category, occasion, season: null, severity: "low", have: 1, need: 2, description: `Only one option in ${slot.category.toLowerCase()} for ${occasion}.` });
      }
    }
  }

  // 3. Nothing warm enough for a cold season.
  if (outerwear.filter(warmEnoughSeason).length === 0) {
    push({ reason: "season", category: "Outerwear", occasion: null, season: "winter", severity: "medium", have: outerwear.length, need: null, description: outerwear.length === 0 ? "No coats or jackets." : "No coat or jacket suited to cold weather." });
  }

  // 4. Enough of a category to avoid repeating, by the app's own rotation rules.
  const thin: { category: ItemCategory; have: number }[] = [
    { category: "Tops", have: tops.length + dresses.length },
    { category: "Bottoms", have: bottoms.length + dresses.length },
    { category: "Shoes", have: shoes.length },
    { category: "Bags", have: bags.length },
  ];
  for (const { category, have } of thin) {
    if (have === 0) continue; // already a missing_slot, or bags, which are optional
    const need = thinThreshold(category, rotationLimits);
    if (have < need) {
      push({ reason: "thin", category, occasion: null, season: null, severity: "low", have, need, description: `Only ${have} ${category.toLowerCase()} — a week's rotation would keep repeating them.` });
    }
  }
  if (bags.length === 0) {
    push({ reason: "thin", category: "Bags", occasion: null, season: null, severity: "low", have: 0, need: thinThreshold("Bags", rotationLimits), description: "No bags in the closet." });
  }

  // 5. Nothing in a neutral colour to anchor the rest.
  for (const [category, list] of [["Bottoms", bottoms], ["Shoes", shoes]] as const) {
    if (list.length >= 3 && !list.some(isNeutral)) {
      push({ reason: "neutral", category, occasion: null, season: null, severity: "low", have: list.length, need: null, description: `No neutral-coloured ${category.toLowerCase()} to build outfits around.` });
    }
  }

  return gaps
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    .slice(0, MAX_GAPS);
}

/**
 * A short, stable hash of everything detection reads, so a cached recommendation is reused
 * until the closet actually changes. Order-independent: reordering rows must not bust it.
 */
export function closetFingerprint(items: GapItem[]): string {
  const rows = items
    .map((i) => [i.id, i.category, (i.occasion ?? []).join(","), (i.season ?? []).join(","), i.color ?? ""].join("|"))
    .sort()
    .join("\n");
  let hash = 5381;
  for (let n = 0; n < rows.length; n++) hash = ((hash << 5) + hash + rows.charCodeAt(n)) | 0;
  return (hash >>> 0).toString(36);
}
