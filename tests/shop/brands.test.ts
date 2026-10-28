import { describe, expect, it } from "vitest";
import { brandSearchUrl, candidateBrands, tiersFor, type ShopBrand } from "@/lib/shop/brands";
import type { ClosetGap } from "@/lib/shop/detect-gaps";

/**
 * The model may only name brands this function offers, so the ranking IS the policy:
 * the company's preferred brands first, the user's own price range before its neighbours.
 * Brand names here are invented on purpose -- the real list is private and never in the repo.
 */

function brand(name: string, extra: Partial<ShopBrand> = {}): ShopBrand {
  return { name, categories: ["Shoes"], tier: "contemporary", tags: [], notes: null, priority: 0, ...extra };
}

const shoeGap: ClosetGap = {
  key: "occasion:Shoes:work",
  reason: "occasion",
  category: "Shoes",
  occasion: "work",
  season: null,
  severity: "high",
  have: 0,
  need: null,
  pairsWith: 8,
  description: "No shoes you could wear for work.",
};

const names = (list: ShopBrand[]) => list.map((b) => b.name);

describe("tiersFor", () => {
  it("puts the chosen tier first and adds only its neighbours", () => {
    expect(tiersFor("lower")).toEqual(["lower", "contemporary"]);
    expect(tiersFor("contemporary")).toEqual(["contemporary", "lower", "designer"]);
    expect(tiersFor("designer")).toEqual(["designer", "contemporary"]);
  });
});

describe("candidateBrands", () => {
  it("offers only brands that sell the missing category", () => {
    const list = [brand("Alpha"), brand("Bravo", { categories: ["Tops"] })];
    expect(names(candidateBrands(list, shoeGap, "contemporary"))).toEqual(["Alpha"]);
  });

  it("never reaches two tiers away from the user's range", () => {
    const list = [brand("Alpha", { tier: "designer" }), brand("Bravo", { tier: "lower" })];
    expect(names(candidateBrands(list, shoeGap, "lower"))).toEqual(["Bravo"]);
  });

  it("ranks a preferred brand above everything else, even from a neighbouring tier", () => {
    const list = [
      brand("Alpha", { tier: "contemporary", tags: ["core"] }),
      brand("Bravo", { tier: "designer", priority: 1 }),
    ];
    expect(names(candidateBrands(list, shoeGap, "contemporary"))).toEqual(["Bravo", "Alpha"]);
  });

  it("prefers a tag that suits the gap, then the user's own tier", () => {
    const list = [
      brand("Alpha", { tier: "lower", tags: ["core"] }),
      brand("Bravo", { tier: "contemporary" }),
      brand("Charlie", { tier: "contemporary", tags: ["core"] }),
    ];
    expect(names(candidateBrands(list, shoeGap, "contemporary"))).toEqual(["Charlie", "Alpha", "Bravo"]);
  });

  it("offers only sport brands for a sport gap, however many preferred brands outrank them", () => {
    const sportGap: ClosetGap = { ...shoeGap, key: "occasion:Bottoms:sport", category: "Bottoms", occasion: "sport" };
    const list = [
      ...Array.from({ length: 10 }, (_, i) => brand(`Tailor ${i}`, { categories: ["Bottoms"], priority: 1 })),
      brand("Sporty", { categories: ["Bottoms"], tier: "lower", tags: ["sport"], priority: 1 }),
    ];
    expect(names(candidateBrands(list, sportGap, "contemporary"))).toEqual(["Sporty"]);
    // With no sport brand at all, the gap still gets something to shop.
    expect(candidateBrands(list.slice(0, 10), sportGap, "contemporary")).toHaveLength(8);
  });

  it("lists a brand stocked in two tiers once, at its better position", () => {
    const list = [brand("Alpha", { tier: "lower" }), brand("Alpha", { tier: "contemporary" }), brand("Bravo", { tier: "lower" })];
    expect(names(candidateBrands(list, shoeGap, "contemporary"))).toEqual(["Alpha", "Bravo"]);
  });

  it("caps the list", () => {
    const list = Array.from({ length: 20 }, (_, i) => brand(`Brand ${String(i).padStart(2, "0")}`));
    expect(candidateBrands(list, shoeGap, "contemporary", 5)).toHaveLength(5);
  });
});

describe("brandSearchUrl", () => {
  it("searches for the missing piece at the brand, not a guessed product page", () => {
    const url = new URL(brandSearchUrl("Alpha & Co", shoeGap));
    expect(url.hostname).toBe("www.google.com");
    expect(url.searchParams.get("q")).toBe("Alpha & Co work shoes");
  });
});
