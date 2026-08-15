import { describe, expect, it } from "vitest";
import {
  describeRotationLimits,
  enforceComfort,
  enforceComposition,
  enforceCoverage,
  enforceRotation,
  enforceWeather,
  findComfortViolations,
  findCompositionViolations,
  findCoverageViolations,
  findRotationViolations,
  findWeatherViolations,
  isActivewear,
  isDroppableCategory,
  isHardToTravelIn,
  isLongSleeve,
  isSportSuitable,
  MAX_WEAR_DAYS_BY_CATEGORY,
  maxWearDaysFor,
  resolveRotationLimits,
  rotationContext,
  ROTATION_WINDOW_DAYS,
  TOO_WARM_FOR_SLEEVES_C,
  type RuleDay,
  type WearHistory,
} from "@/lib/planning/plan-rules";
import {
  categoriesIn,
  categoryFor,
  contextFor,
  isActivewearFor,
  isHardToTravelInFor,
  isLongSleeveFor,
  isSportSuitableFor,
  poolOf,
  seg,
} from "./fixtures";

/**
 * Every case here is a failure that actually shipped and is recorded in
 * `checklist.md`'s debug log — two pairs of trousers in one segment, a day whose
 * whole outfit was one pair of sandals, heels on an overnight flight, golf in a
 * midi dress and pumps, and the same clutch every day of the week.
 *
 * They are tested at the level the rules guarantee: after enforcement the plan
 * satisfies the rule. Which substitute gets chosen is deliberately not asserted —
 * that is the pool's ordering, not the invariant.
 */

const DEFAULTS = resolveRotationLimits(null);
const noHistory = () => rotationContext(DEFAULTS);

function day(planDate: string, ...segments: ReturnType<typeof seg>[]): RuleDay {
  return { planDate, segments };
}

/** A complete, boring outfit, so a test about one rule isn't tripped by another. */
function outfit(extra: string[] = []): string[] {
  return ["top-blouse", "bottom-trousers", "shoes-flats", ...extra];
}

// ── Composition ─────────────────────────────────────────────────────────────

describe("composition", () => {
  it("flags and trims a second pair of trousers", () => {
    const days = [
      day("2026-08-14", seg("general", 3, ["top-blouse", "bottom-trousers", "bottom-jeans", "shoes-flats"])),
    ];

    expect(findCompositionViolations(days, categoryFor)).toEqual([
      { planDate: "2026-08-14", segmentIndex: 0, category: "Bottoms", count: 2, max: 1 },
    ]);

    const fixed = enforceComposition(days, categoryFor);
    expect(fixed[0].segments[0].itemIds).toEqual(["top-blouse", "bottom-trousers", "shoes-flats"]);
    expect(findCompositionViolations(fixed, categoryFor)).toEqual([]);
  });

  it("keeps two tops, because layering is real", () => {
    const days = [day("2026-08-14", seg("general", 3, ["top-tee", "top-sweater", "bottom-jeans", "shoes-flats"]))];
    expect(findCompositionViolations(days, categoryFor)).toEqual([]);
    expect(enforceComposition(days, categoryFor)[0].segments[0].itemIds).toHaveLength(4);
  });

  it("never pairs a dress with a top or trousers, and the dress is the one that stays", () => {
    const days = [
      day("2026-08-14", seg("general", 3, ["dress-midi", "top-blouse", "bottom-trousers", "shoes-flats"])),
    ];

    const violations = findCompositionViolations(days, categoryFor);
    expect(violations.map((v) => v.category).sort()).toEqual(["Bottoms", "Tops"]);
    expect(violations.every((v) => v.incompatibleWith === "Dresses")).toBe(true);

    // Dropping the dress instead would leave a look that also fails coverage.
    expect(enforceComposition(days, categoryFor)[0].segments[0].itemIds).toEqual([
      "dress-midi",
      "shoes-flats",
    ]);
  });

  it("caps accessories, so a closet with five belts is not told to wear five", () => {
    const days = [
      day(
        "2026-08-14",
        seg("general", 3, [
          ...outfit(),
          "acc-belt",
          "acc-scarf",
          "acc-hat",
          "acc-sunglasses",
          "acc-earrings",
        ])
      ),
    ];

    expect(findCompositionViolations(days, categoryFor)).toEqual([
      { planDate: "2026-08-14", segmentIndex: 0, category: "Accessories", count: 5, max: 4 },
    ]);

    const kept = enforceComposition(days, categoryFor)[0].segments[0].itemIds;
    expect(kept.filter((id) => categoryFor(id) === "Accessories")).toHaveLength(4);
  });
});

// ── Coverage ────────────────────────────────────────────────────────────────

describe("coverage", () => {
  it("reports every slot a bare pair of sandals leaves uncovered", () => {
    const days = [day("2026-08-14", seg("general", 3, ["shoes-flats"]))];
    expect(findCoverageViolations(days, categoryFor).map((v) => v.missingSlot)).toEqual([
      "torso",
      "legs",
    ]);
  });

  it("fills the holes from the candidate pool", () => {
    const days = [day("2026-08-14", seg("general", 3, ["shoes-flats"]))];
    const fixed = enforceCoverage(days, categoryFor, poolOf(), noHistory());

    expect(findCoverageViolations(fixed, categoryFor)).toEqual([]);
    expect(fixed[0].segments[0].itemIds).toContain("shoes-flats");
  });

  it("respects a caller's veto while filling, so a hot day stays sleeveless", () => {
    const days = [day("2026-08-14", seg("general", 3, ["bottom-jeans"]))];
    const fixed = enforceCoverage(days, categoryFor, poolOf(), noHistory(), (itemId) =>
      isLongSleeveFor(itemId)
    );

    expect(findCoverageViolations(fixed, categoryFor)).toEqual([]);
    expect(fixed[0].segments[0].itemIds.some(isLongSleeveFor)).toBe(false);
  });

  it("does not add a dress on top of a top, or vice versa", () => {
    const days = [day("2026-08-14", seg("general", 3, ["top-blouse", "shoes-flats"]))];
    const filled = enforceCoverage(days, categoryFor, poolOf(), noHistory())[0].segments[0].itemIds;

    expect(findCoverageViolations([day("2026-08-14", seg("general", 3, filled))], categoryFor)).toEqual([]);
    expect(categoriesIn(filled)).not.toContain("Dresses");
  });

  it("leaves a complete outfit alone", () => {
    const days = [day("2026-08-14", seg("general", 3, outfit()))];
    expect(enforceCoverage(days, categoryFor, poolOf(), noHistory())[0].segments[0].itemIds).toEqual(
      outfit()
    );
  });
});

// ── Weather ─────────────────────────────────────────────────────────────────

describe("weather", () => {
  const hot = () => 32;
  const mild = () => 24;

  it("takes sleeves off a day above the threshold", () => {
    expect(TOO_WARM_FOR_SLEEVES_C).toBe(30);

    const days = [
      day("2026-08-14", seg("general", 3, ["top-sweater", "bottom-jeans", "shoes-flats", "coat-blazer"])),
    ];

    expect(findWeatherViolations(days, isLongSleeveFor, hot).map((v) => v.itemId).sort()).toEqual([
      "coat-blazer",
      "top-sweater",
    ]);

    const fixed = enforceWeather(days, categoryFor, isLongSleeveFor, hot, poolOf(), noHistory());
    const items = fixed[0].segments[0].itemIds;

    expect(findWeatherViolations(fixed, isLongSleeveFor, hot)).toEqual([]);
    // The sweater is swapped, because torso has to stay covered…
    expect(categoriesIn(items)).toContain("Tops");
    // …and the blazer simply goes, because nothing requires outerwear and every
    // piece of outerwear is long-sleeved by definition.
    expect(categoriesIn(items)).not.toContain("Outerwear");
  });

  it("leaves a mild day alone", () => {
    const items = ["top-sweater", "bottom-jeans", "shoes-flats", "coat-blazer"];
    const days = [day("2026-08-14", seg("general", 3, items))];

    expect(findWeatherViolations(days, isLongSleeveFor, mild)).toEqual([]);
    expect(
      enforceWeather(days, categoryFor, isLongSleeveFor, mild, poolOf(), noHistory())[0].segments[0]
        .itemIds
    ).toEqual(items);
  });

  it("does nothing when there is no forecast for the day", () => {
    const days = [day("2026-08-14", seg("general", 3, ["top-sweater", "bottom-jeans", "shoes-flats"]))];
    expect(findWeatherViolations(days, isLongSleeveFor, () => null)).toEqual([]);
  });
});

// ── Comfort ─────────────────────────────────────────────────────────────────

describe("comfort", () => {
  const comfort = (days: RuleDay[], pool = poolOf(), rotation = noHistory()) =>
    enforceComfort(
      days,
      categoryFor,
      contextFor,
      isHardToTravelInFor,
      isActivewearFor,
      isSportSuitableFor,
      pool,
      rotation
    );

  const violations = (days: RuleDay[]) =>
    findComfortViolations(
      days,
      contextFor,
      isHardToTravelInFor,
      isActivewearFor,
      isSportSuitableFor,
      categoryFor
    );

  it("gets heels off a flight", () => {
    const days = [day("2026-08-14", seg("transit", 2, ["top-blouse", "bottom-trousers", "shoes-pumps"]))];

    expect(violations(days)).toEqual([
      { planDate: "2026-08-14", segmentIndex: 0, itemId: "shoes-pumps", reason: "transit" },
    ]);

    const items = comfort(days)[0].segments[0].itemIds;
    expect(items).not.toContain("shoes-pumps");
    expect(categoriesIn(items)).toContain("Shoes"); // barefoot is not the fix
    expect(violations(comfort(days))).toEqual([]);
  });

  it("keeps heels on an ordinary day", () => {
    const days = [day("2026-08-14", seg("general", 4, ["top-blouse", "bottom-trousers", "shoes-pumps"]))];
    expect(violations(days)).toEqual([]);
    expect(comfort(days)[0].segments[0].itemIds).toContain("shoes-pumps");
  });

  it("rebuilds a golf round that arrived in a midi dress and pumps", () => {
    // The exact reported failure: an athletic segment whose pieces were chosen for
    // a client's private club rather than for playing.
    const days = [day("2026-08-14", seg("athletic", 2, ["dress-midi", "shoes-pumps", "bag-tote"]))];

    expect(violations(days).map((v) => [v.itemId, v.reason])).toEqual([
      ["dress-midi", "not_sport"],
      ["shoes-pumps", "not_sport"],
    ]);

    const items = comfort(days)[0].segments[0].itemIds;

    // A 1:1 swap cannot fix the dress — most closets hold no sport dress — so it is
    // dropped and torso + legs are refilled with pieces that can be played in.
    expect(items).not.toContain("dress-midi");
    expect(items).not.toContain("shoes-pumps");
    expect(items.filter((id) => categoryFor(id) !== "Bags").every(isSportSuitableFor)).toBe(true);
    expect(findCoverageViolations(comfort(days), categoryFor)).toEqual([]);
    expect(violations(comfort(days))).toEqual([]);
  });

  it("leaves the tote on the golf course", () => {
    // Bags and accessories are carried, not played in. Flagging them would be noise.
    const days = [day("2026-08-14", seg("athletic", 2, ["top-polo", "bottom-shorts", "shoes-trainers", "bag-tote"]))];
    expect(violations(days)).toEqual([]);
    expect(comfort(days)[0].segments[0].itemIds).toContain("bag-tote");
  });

  it("keeps gym kit out of a formal occasion", () => {
    const days = [day("2026-08-14", seg("general", 4, ["top-polo", "bottom-leggings", "shoes-flats"]))];

    expect(violations(days)).toEqual([
      { planDate: "2026-08-14", segmentIndex: 0, itemId: "bottom-leggings", reason: "too_casual" },
    ]);

    const items = comfort(days)[0].segments[0].itemIds;
    expect(items).not.toContain("bottom-leggings");
    expect(categoriesIn(items)).toContain("Bottoms");
  });

  it("allows the same kit at a casual occasion", () => {
    const days = [day("2026-08-14", seg("general", 2, ["top-polo", "bottom-leggings", "shoes-flats"]))];
    expect(violations(days)).toEqual([]);
  });

  it("does not put anything back on that was sweated in earlier the same day", () => {
    const days = [
      day(
        "2026-08-14",
        seg("athletic", 2, ["top-polo", "bottom-shorts", "shoes-trainers", "bag-tote"]),
        seg("general", 2, ["top-polo", "bottom-jeans", "shoes-flats", "bag-tote"])
      ),
    ];

    expect(violations(days)).toEqual([
      { planDate: "2026-08-14", segmentIndex: 1, itemId: "top-polo", reason: "sweat" },
    ]);

    const later = comfort(days)[0].segments[1].itemIds;
    expect(later).not.toContain("top-polo");
    expect(categoriesIn(later)).toContain("Tops");
    // The same tote before and after the match is normal, and is left alone.
    expect(later).toContain("bag-tote");
  });

  it("does not treat a later athletic segment as sweaty from itself", () => {
    const days = [
      day("2026-08-14", seg("athletic", 2, ["top-polo", "bottom-shorts", "shoes-trainers"])),
    ];
    expect(violations(days)).toEqual([]);
  });

  it("reports rather than strips a segment when the closet cannot dress it", () => {
    // No sport-suitable clothes at all: the item stays, because a look that reads
    // wrong beats one that cannot be worn, and the caller surfaces it as a warning.
    const bareCloset = poolOf(["top-blouse", "bottom-trousers", "shoes-pumps"]);
    const days = [day("2026-08-14", seg("athletic", 2, ["top-blouse", "bottom-trousers", "shoes-pumps"]))];

    const fixed = comfort(days, bareCloset);
    expect(findCoverageViolations(fixed, categoryFor)).toEqual([]);
    expect(violations(fixed).length).toBeGreaterThan(0);
  });
});

// ── Rotation ────────────────────────────────────────────────────────────────

describe("rotation", () => {
  const historyOf = (entries: Record<string, string[]>): WearHistory => new Map(Object.entries(entries));

  it("counts days, not gaps — Mon/Wed/Fri in the same shoes is three days", () => {
    // The bug that motivated replacing a minimum-gap table: a 2-day gap silently
    // permits three wearings a week.
    const days = [
      day("2026-08-10", seg("general", 3, outfit())),
      day("2026-08-12", seg("general", 3, outfit())),
      day("2026-08-14", seg("general", 3, outfit())),
    ];

    const shoes = findRotationViolations(days, categoryFor, noHistory()).filter(
      (v) => v.itemId === "shoes-flats"
    );
    expect(shoes).toHaveLength(1);
    expect(shoes[0]).toMatchObject({ conflictDate: "2026-08-14", daysUsed: 3, maxDays: 2 });
  });

  it("never counts a repeat within one day", () => {
    // One blazer carried from a meeting into dinner is the reason segments exist.
    const days = [
      day(
        "2026-08-14",
        seg("general", 4, [...outfit(), "coat-blazer"]),
        seg("general", 3, [...outfit(), "coat-blazer"])
      ),
    ];
    expect(findRotationViolations(days, categoryFor, noHistory())).toEqual([]);
  });

  it("swaps the repeat on the later day", () => {
    const days = [
      day("2026-08-14", seg("general", 3, outfit())),
      day("2026-08-15", seg("general", 3, outfit())),
    ];

    expect(
      findRotationViolations(days, categoryFor, noHistory()).map((v) => v.itemId).sort()
    ).toEqual(["bottom-trousers", "top-blouse"]);

    const fixed = enforceRotation(days, categoryFor, poolOf(), noHistory());
    expect(findRotationViolations(fixed, categoryFor, noHistory())).toEqual([]);
    expect(fixed[0].segments[0].itemIds).toEqual(outfit()); // the earlier day is untouched
    expect(fixed[1].segments[0].itemIds).not.toContain("top-blouse");
  });

  it("takes off a repeat it cannot replace when nothing needs the slot", () => {
    // A user who owns one blazer and sets Outerwear to one day a week has no
    // substitute by construction. Keeping it is what made the setting look broken.
    const oneBlazer = poolOf(["top-blouse", "top-tee", "bottom-trousers", "bottom-jeans", "shoes-flats", "coat-blazer"]);
    const days = [
      day("2026-08-14", seg("general", 4, [...outfit(), "coat-blazer"])),
      day("2026-08-15", seg("general", 4, ["top-tee", "bottom-jeans", "shoes-flats", "coat-blazer"])),
    ];

    const fixed = enforceRotation(days, categoryFor, oneBlazer, rotationContext(DEFAULTS));
    expect(fixed[0].segments[0].itemIds).toContain("coat-blazer");
    expect(fixed[1].segments[0].itemIds).not.toContain("coat-blazer");
    expect(findRotationViolations(fixed, categoryFor, noHistory())).toEqual([]);
  });

  it("keeps an unreplaceable repeat that covers a required slot, and still reports it", () => {
    // Barefoot is worse than a repeat, so this one survives as a visible warning
    // rather than being papered over.
    const oneShoe = poolOf(["top-tee", "top-blouse", "top-sweater", "bottom-jeans", "bottom-trousers", "bottom-shorts", "shoes-flats"]);
    const days = [
      day("2026-08-14", seg("general", 3, ["top-blouse", "bottom-trousers", "shoes-flats"])),
      day("2026-08-15", seg("general", 3, ["top-tee", "bottom-jeans", "shoes-flats"])),
      day("2026-08-16", seg("general", 3, ["top-sweater", "bottom-shorts", "shoes-flats"])),
    ];

    const fixed = enforceRotation(days, categoryFor, oneShoe, rotationContext(DEFAULTS));
    expect(fixed[2].segments[0].itemIds).toContain("shoes-flats");
    expect(findCoverageViolations(fixed, categoryFor)).toEqual([]);

    const remaining = findRotationViolations(fixed, categoryFor, noHistory());
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ itemId: "shoes-flats", category: "Shoes", maxDays: 2 });
  });

  it("counts the surrounding days, so the window does not restart with the request", () => {
    // Without history, "once a week" restarted every Monday and redoing one day
    // reached straight for whatever the other six already used.
    const rotation = rotationContext(DEFAULTS, historyOf({ "top-blouse": ["2026-08-13"] }));
    const days = [day("2026-08-14", seg("general", 3, outfit()))];

    const violations = findRotationViolations(days, categoryFor, rotation);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      itemId: "top-blouse",
      conflictDate: "2026-08-14",
      otherDates: ["2026-08-13"],
      daysUsed: 2,
      maxDays: 1,
    });

    const fixed = enforceRotation(days, categoryFor, poolOf(), rotation);
    expect(fixed[0].segments[0].itemIds).not.toContain("top-blouse");
  });

  it("never reports a day it cannot rebuild", () => {
    // A plan already saved for last Tuesday counts against the window but is not a
    // violation this generation can act on.
    const rotation = rotationContext(DEFAULTS, historyOf({ "top-blouse": ["2026-08-12", "2026-08-13"] }));
    const days = [day("2026-08-14", seg("general", 3, outfit()))];

    const dates = findRotationViolations(days, categoryFor, rotation).map((v) => v.conflictDate);
    expect(dates).toEqual(["2026-08-14"]);
  });

  it("lets an item return once it is outside the rolling window", () => {
    const rotation = rotationContext(DEFAULTS, historyOf({ "top-blouse": ["2026-08-07"] }));
    const days = [day("2026-08-14", seg("general", 3, outfit()))];
    expect(findRotationViolations(days, categoryFor, rotation)).toEqual([]);
  });
});

// ── The limits themselves ───────────────────────────────────────────────────

describe("rotation limits", () => {
  it("stores only what the user changed, so a later default change reaches them", () => {
    const limits = resolveRotationLimits({ Shoes: 4 });
    expect(limits.Shoes).toBe(4);
    expect(limits.Tops).toBe(MAX_WEAR_DAYS_BY_CATEGORY.Tops);
  });

  it("drops anything unusable rather than trusting the column", () => {
    const limits = resolveRotationLimits({
      Shoes: 0,
      Tops: 99,
      Bottoms: "3",
      Bags: null,
      "": 3,
      Dresses: 2.6,
    });

    expect(limits.Shoes).toBe(MAX_WEAR_DAYS_BY_CATEGORY.Shoes);
    expect(limits.Tops).toBe(MAX_WEAR_DAYS_BY_CATEGORY.Tops);
    expect(limits.Bottoms).toBe(MAX_WEAR_DAYS_BY_CATEGORY.Bottoms);
    expect(limits.Bags).toBe(MAX_WEAR_DAYS_BY_CATEGORY.Bags);
    expect(limits.Dresses).toBe(3); // rounded, and in range
  });

  it("falls back to the defaults for a malformed column", () => {
    for (const bad of [null, undefined, "nope", 7, [1, 2, 3]]) {
      expect(resolveRotationLimits(bad)).toEqual(MAX_WEAR_DAYS_BY_CATEGORY);
    }
  });

  it("is conservative, not exempt, for a category nobody has a rule for", () => {
    expect(maxWearDaysFor("Hats", DEFAULTS)).toBe(2);
  });

  it("treats a full window as no limit at all", () => {
    const limits = resolveRotationLimits({ Tops: ROTATION_WINDOW_DAYS });
    const days = ["2026-08-10", "2026-08-11", "2026-08-12"].map((date) =>
      day(date, seg("general", 3, outfit()))
    );

    expect(
      findRotationViolations(days, categoryFor, rotationContext(limits)).some(
        (v) => v.itemId === "top-blouse"
      )
    ).toBe(false);
    expect(describeRotationLimits(limits).Tops).toBe("no limit, may repeat freely");
  });

  it("says the limit the same way the prompt does", () => {
    const described = describeRotationLimits(DEFAULTS);
    expect(described.Tops).toBe("at most 1 day out of any 7");
    expect(described.Shoes).toBe("at most 2 days out of any 7");
  });
});

// ── The predicates the rules are built from ─────────────────────────────────

describe("item predicates", () => {
  it("treats all outerwear as long-sleeved and is conservative elsewhere", () => {
    expect(isLongSleeve({ category: "Outerwear", subcategory: "gilet" })).toBe(true);
    expect(isLongSleeve({ category: "Tops", subcategory: "wool sweater" })).toBe(true);
    expect(isLongSleeve({ category: "Tops", subcategory: "cotton t-shirt" })).toBe(false);
    expect(isLongSleeve({ category: "Dresses", subcategory: "slip dress" })).toBe(false);
  });

  it("only calls footwear hard to travel in", () => {
    expect(isHardToTravelIn({ category: "Shoes", subcategory: "leather pump" })).toBe(true);
    expect(isHardToTravelIn({ category: "Shoes", subcategory: "ballet flat" })).toBe(false);
    // A stiff blazer is a poor flight choice too, but that is judgement, and
    // judgement stays with the model.
    expect(isHardToTravelIn({ category: "Outerwear", subcategory: "structured blazer" })).toBe(false);
  });

  it("needs two agreeing signals before calling something gym kit", () => {
    expect(isActivewear({ category: "Bottoms", subcategory: "leggings", occasion: ["sport"] })).toBe(true);
    // Tagged for work, so it is not gym kit whatever it is called.
    expect(
      isActivewear({ category: "Bottoms", subcategory: "track-style trouser", occasion: ["work"] })
    ).toBe(false);
    // Plain sneakers are not a war on flat shoes.
    expect(isActivewear({ category: "Shoes", subcategory: "leather sneaker", occasion: ["casual"] })).toBe(
      false
    );
  });

  it("accepts the sport tag on its own when deciding what may stay in a sport segment", () => {
    // The mirror of isActivewear: this decides what STAYS, so demanding the tag is
    // the conservative direction.
    expect(isSportSuitable({ category: "Tops", subcategory: "linen shirt", occasion: ["sport"] })).toBe(true);
    // Club kit that reads as smart still qualifies on the keyword list.
    expect(isSportSuitable({ category: "Tops", subcategory: "golf polo", occasion: ["casual"] })).toBe(true);
    expect(isSportSuitable({ category: "Dresses", subcategory: "cotton midi dress", occasion: ["casual"] })).toBe(
      false
    );
  });

  it("knows which categories can simply be taken off", () => {
    expect(isDroppableCategory("Outerwear")).toBe(true);
    expect(isDroppableCategory("Bags")).toBe(true);
    expect(isDroppableCategory("Accessories")).toBe(true);
    for (const covering of ["Tops", "Bottoms", "Dresses", "Shoes"]) {
      expect(isDroppableCategory(covering)).toBe(false);
    }
  });
});

// ── The pipeline in the order the routes run it ─────────────────────────────

describe("full enforcement order", () => {
  it("produces a wearable plan from a badly broken one", () => {
    // Everything wrong at once: two bottoms, a dress worn with them, sleeves on a
    // 32°C day, heels on a flight, and the same pieces on both days.
    const rotation = noHistory();
    const pool = poolOf();
    const tempFor = () => 32;

    let days: RuleDay[] = [
      day(
        "2026-08-14",
        seg("general", 4, ["dress-midi", "top-sweater", "bottom-trousers", "bottom-jeans", "coat-blazer", "shoes-pumps"]),
        seg("transit", 2, ["top-sweater", "bottom-trousers", "shoes-pumps"])
      ),
      day("2026-08-15", seg("general", 4, ["top-sweater", "bottom-trousers", "shoes-pumps"])),
    ];

    days = enforceComposition(days, categoryFor);
    days = enforceWeather(days, categoryFor, isLongSleeveFor, tempFor, pool, rotation);
    days = enforceCoverage(days, categoryFor, pool, rotation, (itemId) => isLongSleeveFor(itemId));
    days = enforceComfort(
      days,
      categoryFor,
      contextFor,
      isHardToTravelInFor,
      isActivewearFor,
      isSportSuitableFor,
      pool,
      rotation
    );
    days = enforceRotation(days, categoryFor, pool, rotation);

    expect(findCompositionViolations(days, categoryFor)).toEqual([]);
    expect(findWeatherViolations(days, isLongSleeveFor, tempFor)).toEqual([]);
    expect(findCoverageViolations(days, categoryFor)).toEqual([]);
    expect(
      findComfortViolations(days, contextFor, isHardToTravelInFor, isActivewearFor, isSportSuitableFor, categoryFor)
    ).toEqual([]);
    expect(findRotationViolations(days, categoryFor, rotation)).toEqual([]);
  });
});
