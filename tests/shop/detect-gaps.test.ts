import { describe, expect, it } from "vitest";
import {
  MAX_GAPS,
  MIN_ITEMS_FOR_GAPS,
  closetFingerprint,
  detectGaps,
  type GapItem,
} from "@/lib/shop/detect-gaps";

/**
 * Gaps are decided in TypeScript so that the same closet always reports the same gaps:
 * the gap key is also what a cached recommendation hangs off, so a model deciding "what
 * is missing" would re-key every stored recommendation on each run.
 */

let n = 0;
function item(category: string, extra: Partial<GapItem> = {}): GapItem {
  n += 1;
  return { id: `i-${n}`, category, occasion: [], season: [], color: "black", ...extra };
}

/** A closet that is complete for work and casual wear: no rule should fire. */
function fullCloset(): GapItem[] {
  return [
    ...Array.from({ length: 4 }, () => item("Tops", { occasion: ["work", "casual"] })),
    ...Array.from({ length: 4 }, () => item("Bottoms", { occasion: ["work", "casual"] })),
    ...Array.from({ length: 2 }, () => item("Shoes", { occasion: ["work", "casual", "formal"] })),
    item("Outerwear", { season: ["fall", "winter"], occasion: ["work"] }),
    ...Array.from({ length: 2 }, () => item("Bags")),
  ];
}

/** Covers every occasion with at least two options, so a test sees only the gap it builds. */
function completeCloset(): GapItem[] {
  return [
    ...fullCloset().map((i) => ({ ...i, occasion: [...(i.occasion ?? []), "formal"] })),
    ...Array.from({ length: 2 }, () => item("Tops", { occasion: ["sport"] })),
    ...Array.from({ length: 2 }, () => item("Bottoms", { occasion: ["sport"] })),
  ];
}

const keys = (gaps: ReturnType<typeof detectGaps>) => gaps.map((g) => g.key);

describe("detectGaps", () => {
  it("reports nothing for a closet too small to judge", () => {
    expect(detectGaps(Array.from({ length: MIN_ITEMS_FOR_GAPS - 1 }, () => item("Tops")))).toEqual([]);
  });

  it("does not flag occasions the classifier left untagged", () => {
    // Missing data must never manufacture a gap.
    const untagged = fullCloset().map((i) => ({ ...i, occasion: [] }));
    expect(keys(detectGaps(untagged)).filter((k) => k.startsWith("occasion:") && !k.endsWith(":sport"))).toEqual([]);
  });

  it("finds a missing whole slot once, not once per occasion", () => {
    const closet = fullCloset().filter((i) => i.category !== "Shoes");
    const found = keys(detectGaps(closet));
    expect(found).toContain("missing_slot:Shoes:");
    expect(found.filter((k) => k.includes(":Shoes:"))).toHaveLength(1);
  });

  it("finds no shoes for a formal occasion when every pair is casual", () => {
    const closet = fullCloset().map((i) =>
      i.category === "Shoes" ? { ...i, occasion: ["casual"] } : { ...i, occasion: i.occasion?.concat("formal") }
    );
    const gap = detectGaps(closet).find((g) => g.key === "occasion:Shoes:formal");
    expect(gap).toBeDefined();
    expect(gap?.severity).toBe("medium");
  });

  it("lets a dress stand in for both a top and a bottom on an occasion", () => {
    const closet = [
      ...fullCloset().filter((i) => i.category !== "Bottoms" && i.category !== "Tops"),
      ...Array.from({ length: 4 }, () => item("Dresses", { occasion: ["work", "casual"] })),
    ];
    const found = keys(detectGaps(closet));
    expect(found).not.toContain("missing_slot:Tops:");
    expect(found).not.toContain("missing_slot:Bottoms:");
    // The dresses are tagged work and casual, so those two occasions need no top or bottom.
    expect(found.filter((k) => /^occasion:(Tops|Bottoms):(work|casual)$/.test(k))).toEqual([]);
  });

  it("rates a missing work outfit above a missing sport one", () => {
    // Complete for everything but shoes, so the 6-gap cap keeps both of the gaps compared.
    const closet = [
      ...fullCloset().map((i) => (i.category === "Shoes" ? { ...i, occasion: ["casual"] } : { ...i, occasion: [...(i.occasion ?? []), "formal"] })),
      item("Tops", { occasion: ["sport"] }),
      item("Bottoms", { occasion: ["sport"] }),
    ];
    const gaps = detectGaps(closet);
    const work = gaps.find((g) => g.key === "occasion:Shoes:work");
    const sport = gaps.find((g) => g.key === "occasion:Shoes:sport");
    expect(work?.severity).toBe("high");
    expect(sport?.severity).toBe("low");
    expect(gaps.indexOf(work!)).toBeLessThan(gaps.indexOf(sport!));
  });

  it("reports a single option for an occasion as a low-severity gap", () => {
    // A well-stocked closet with one pair of sport bottoms: allowed once a week, so worth a second.
    const closet = [
      ...fullCloset().map((i) => ({ ...i, occasion: [...(i.occasion ?? []), "formal"] })),
      ...Array.from({ length: 2 }, () => item("Tops", { occasion: ["sport"] })),
      item("Bottoms", { occasion: ["sport"] }),
      ...Array.from({ length: 2 }, () => item("Shoes", { occasion: ["sport"] })),
    ];
    const gaps = detectGaps(closet);
    const single = gaps.find((g) => g.key === "occasion:Bottoms:sport");
    expect(single).toMatchObject({ severity: "low", have: 1, need: 2 });
    expect(gaps.find((g) => g.key === "occasion:Tops:sport")).toBeUndefined();
  });

  it("counts a tagged sport piece as sport clothing", () => {
    const closet = [
      ...fullCloset(),
      ...Array.from({ length: 2 }, () => item("Tops", { occasion: ["sport"] })),
      item("Bottoms", { subcategory: "leggings" }),
      item("Bottoms", { subcategory: "tennis skirt" }),
      ...Array.from({ length: 2 }, () => item("Shoes", { subcategory: "running trainer" })),
    ];
    expect(keys(detectGaps(closet)).filter((k) => k.endsWith(":sport"))).toEqual([]);
  });

  it("flags no coat for cold weather, including a closet of summer-only coats", () => {
    const summerOnly = fullCloset().map((i) => (i.category === "Outerwear" ? { ...i, season: ["spring", "summer"] } : i));
    expect(keys(detectGaps(summerOnly))).toContain("season:Outerwear:winter");
    expect(keys(detectGaps(fullCloset()))).not.toContain("season:Outerwear:winter");
  });

  it("treats an untagged coat as warm enough", () => {
    const untagged = fullCloset().map((i) => (i.category === "Outerwear" ? { ...i, season: [] } : i));
    expect(keys(detectGaps(untagged))).not.toContain("season:Outerwear:winter");
  });

  it("flags a thin category from the user's own rotation limits", () => {
    // Shoes worn on 2 days of 7 want 4 pairs; below half of that (2) is thin.
    const oneShoe = completeCloset()
      .filter((i) => i.category !== "Shoes")
      .concat(item("Shoes", { occasion: ["work", "casual", "formal", "sport"] }));
    expect(keys(detectGaps(oneShoe))).toContain("thin:Shoes:");
    // A user who allows shoes on every day needs fewer pairs, so one pair is no longer thin.
    expect(keys(detectGaps(oneShoe, { Shoes: 7 }))).not.toContain("thin:Shoes:");
  });

  it("flags a missing neutral only when there are enough pieces to judge", () => {
    const bright = (category: string) => Array.from({ length: 3 }, () => item(category, { color: "red", occasion: ["work", "casual", "formal"] }));
    const closet = [...bright("Bottoms"), ...fullCloset().filter((i) => i.category !== "Bottoms")];
    expect(keys(detectGaps(closet))).toContain("neutral:Bottoms:");
    const two = [...bright("Bottoms").slice(0, 2), ...fullCloset().filter((i) => i.category !== "Bottoms")];
    expect(keys(detectGaps(two))).not.toContain("neutral:Bottoms:");
  });

  it("counts how many existing pieces a new item would go with", () => {
    const closet = fullCloset().map((i) => (i.category === "Shoes" ? { ...i, occasion: ["casual"] } : i));
    const gap = detectGaps(closet).find((g) => g.key === "occasion:Shoes:work");
    // Four work tops + four work bottoms, no dresses.
    expect(gap?.pairsWith).toBe(8);
  });

  it("caps the list and keeps the most severe gaps", () => {
    const sparse = Array.from({ length: 10 }, () => item("Accessories"));
    const gaps = detectGaps(sparse);
    expect(gaps.length).toBeLessThanOrEqual(MAX_GAPS);
    // Sorted by severity before the cut, so the three missing slots survive it.
    expect(gaps.slice(0, 3).every((g) => g.severity === "high")).toBe(true);
  });

  it("returns the same gaps, keys included, however the rows are ordered", () => {
    const closet = fullCloset().filter((i) => i.category !== "Shoes");
    expect(keys(detectGaps([...closet].reverse()))).toEqual(keys(detectGaps(closet)));
  });
});

describe("closetFingerprint", () => {
  it("is stable under reordering and changes when the closet does", () => {
    const closet = fullCloset();
    expect(closetFingerprint([...closet].reverse())).toBe(closetFingerprint(closet));
    expect(closetFingerprint(closet.slice(1))).not.toBe(closetFingerprint(closet));
    const retagged = closet.map((i, idx) => (idx === 0 ? { ...i, occasion: ["party"] } : i));
    expect(closetFingerprint(retagged)).not.toBe(closetFingerprint(closet));
  });
});
