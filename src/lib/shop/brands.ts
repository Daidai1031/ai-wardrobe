import type { ShoppingTier } from "@/types/database";
import { SHOPPING_TIERS } from "@/types/database";
import type { ClosetGap } from "./detect-gaps";

/**
 * Which brands may be offered for a gap. Deterministic, so the model only ever chooses
 * among brands we already decided are right for the category and price, and can't name
 * one that isn't in the company's list.
 *
 * The list itself is NOT in this repo: it lives in `shop_brands` (RLS, no policy) and is
 * read with the service role by `/api/ai/shop`. Never add brand names here or in tests.
 */

export interface ShopBrand {
  name: string;
  categories: string[];
  tier: ShoppingTier;
  tags: string[];
  notes: string | null;
  /** Higher = the company's preferred brand. */
  priority: number;
}

/** How many brands the model gets to choose from per gap. */
export const MAX_CANDIDATES_PER_GAP = 8;

/** The chosen tier first, then its neighbours: a "contemporary" shopper also sees both ends. */
export function tiersFor(tier: ShoppingTier): ShoppingTier[] {
  const index = SHOPPING_TIERS.indexOf(tier);
  return [tier, ...SHOPPING_TIERS.filter((_, i) => Math.abs(i - index) === 1)];
}

/** Brand tags that suit a gap, used only to order brands that are otherwise equal. */
function preferredTags(gap: ClosetGap): string[] {
  if (gap.occasion === "work") return ["core", "suits", "shirts", "smart-price"];
  if (gap.occasion === "formal") return ["statement", "evening", "advanced", "fine"];
  if (gap.occasion === "casual") return ["core", "denim"];
  if (gap.occasion === "sport") return ["sport", "travel"];
  if (gap.reason === "season") return ["coat", "wrap"];
  return ["core"];
}

/**
 * The brands to offer for one gap, best first: preferred brands (priority), then a tag that
 * suits the gap, then the user's exact tier before a neighbouring one. A brand listed in
 * two tiers appears once, at its best position.
 */
export function candidateBrands(
  brands: ShopBrand[],
  gap: ClosetGap,
  tier: ShoppingTier,
  limit = MAX_CANDIDATES_PER_GAP
): ShopBrand[] {
  const tiers = tiersFor(tier);
  const wanted = preferredTags(gap);
  const tagScore = (brand: ShopBrand) => (brand.tags.some((t) => wanted.includes(t)) ? 1 : 0);

  let pool = brands.filter((b) => tiers.includes(b.tier) && b.categories.includes(gap.category));
  // Sport kit is a different shop, not a nicer version of the same one: when any brand is
  // tagged for it, nothing else is offered. Found live — ten preferred tailoring brands
  // outranked the one sport brand and pushed it off the list for "sport bottoms".
  if (gap.occasion === "sport" && pool.some((b) => b.tags.includes("sport"))) {
    pool = pool.filter((b) => b.tags.includes("sport"));
  }

  const ranked = pool.sort(
    (a, b) =>
      b.priority - a.priority ||
      tagScore(b) - tagScore(a) ||
      tiers.indexOf(a.tier) - tiers.indexOf(b.tier) ||
      a.name.localeCompare(b.name)
  );

  const seen = new Set<string>();
  const unique: ShopBrand[] = [];
  for (const brand of ranked) {
    const key = brand.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(brand);
  }
  return unique.slice(0, limit);
}

const CATEGORY_NOUN: Record<string, string> = {
  Tops: "tops",
  Bottoms: "trousers",
  Dresses: "dresses",
  Outerwear: "coats",
  Shoes: "shoes",
  Bags: "handbags",
  Accessories: "jewelry",
};

/** What to search for at a brand to fill this gap, e.g. "work shoes", "winter coats". */
export function gapSearchPhrase(gap: ClosetGap): string {
  const noun = CATEGORY_NOUN[gap.category] ?? gap.category.toLowerCase();
  const qualifier = gap.occasion ?? (gap.reason === "season" ? gap.season : gap.reason === "neutral" ? "black" : null);
  return qualifier ? `${qualifier} ${noun}` : noun;
}

/**
 * A shopping search rather than a deep link into the brand's site: we hold no product
 * data, and a guessed URL would be a link that breaks the day the brand reorganises.
 */
export function brandSearchUrl(brandName: string, gap: ClosetGap): string {
  return `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(`${brandName} ${gapSearchPhrase(gap)}`)}`;
}
