/**
 * Rules a multi-day plan must satisfy, verified in TypeScript rather than trusted
 * to the prompt.
 *
 * Decision D8 says don't expect the LLM to satisfy hard constraints. Weekly
 * planning proved it on run after run: the same brown shoes on three consecutive
 * days, two pairs of trousers in one outfit, a whole day whose outfit was a single
 * pair of sandals, a dress worn with trousers. Each was stated in the prompt and
 * each is exactly decidable in code, so each lives here; the model's job stays the
 * soft part — which of the valid options look right together.
 *
 * Four rule families, all checked here and all enforced deterministically after the
 * model has had one repair attempt:
 *   - Composition: what may appear together in ONE segment (per-category caps and
 *     incompatible pairings).
 *   - Weather: what a given day is too hot for.
 *   - Coverage: what a segment must contain to be an outfit at all.
 *   - Rotation: how soon an item may reappear on a LATER day.
 *
 * Enforcement order is composition → weather → coverage → rotation, because
 * removing something can open a hole and filling a hole can create a repeat.
 */

/**
 * Minimum whole days between two wearings of the same item, per category. A gap of
 * 2 means Monday and Wednesday are fine but Monday and Tuesday are not; a gap of 7
 * means once per planning window.
 *
 * Accessories and bags are exempt (0): carrying the same work bag or wearing the
 * same sunglasses every day is normal, and flagging it produced pure noise. This
 * table is the single place to tune any of it.
 */
export const REPEAT_GAP_BY_CATEGORY: Record<string, number> = {
  // Garments are once-per-window: a 7-day gap inside a 7-day plan means an item
  // worn on any day is unavailable for every other day in it. Repeats within a
  // single day are still fine and never counted.
  Tops: 7,
  Bottoms: 7,
  Dresses: 7,
  Outerwear: 7,
  // Shoes keep a shorter gap: a closet holds more pairs than garments, and wearing
  // the same boots twice in a week reads as normal in a way that re-wearing the
  // same trousers does not.
  Shoes: 2,
  Bags: 0,
  Accessories: 0,
};

const DEFAULT_REPEAT_GAP_DAYS = 2;

/**
 * Above this the day is too hot for sleeves: no outerwear, no long-sleeve tops or
 * dresses. Season tags alone don't catch this — plenty of items are tagged for
 * spring *and* summer — and the candidate filter works on the whole week's range,
 * so a week containing one 32°C day still has to keep sweaters available for the
 * cold days. It therefore has to be a per-day rule, checked like the others.
 */
export const TOO_WARM_FOR_SLEEVES_C = 30;

const LONG_SLEEVE_KEYWORDS = [
  "long sleeve",
  "long-sleeve",
  "longsleeve",
  "sweater",
  "cardigan",
  "turtleneck",
  "pullover",
  "hoodie",
  "sweatshirt",
  "knit",
  "blazer",
  "jacket",
  "coat",
  "trench",
  "parka",
  "puffer",
];

/**
 * Whether an item covers the arms. All outerwear counts by definition; for tops
 * and dresses it's inferred from subcategory/material text, since there is no
 * sleeve field. Deliberately conservative — only unambiguous terms — because a
 * false positive removes something the user owns from a hot day for no reason.
 */
export function isLongSleeve(item: {
  category: string;
  subcategory?: string | null;
  material?: string | null;
}): boolean {
  if (item.category === "Outerwear") return true;
  const text = `${item.subcategory ?? ""} ${item.material ?? ""}`.toLowerCase();
  return LONG_SLEEVE_KEYWORDS.some((keyword) => text.includes(keyword));
}

/**
 * How many items of a category may appear in ONE segment. Tops and outerwear allow
 * two because layering is real: a shirt under a cardigan, a vest under a blazer.
 *
 * Bags and accessories were unbounded at first, on the reasoning that several
 * bracelets is a look while several pairs of trousers is a bug. That left no upper
 * bound on outfit size at all — a wardrobe with ten belts could legitimately be
 * told to wear six of them. Every category is now capped, which also bounds a
 * segment at 11 items in the worst case (2 tops + 1 bottom + 2 outerwear + 1 shoes
 * + 1 bag + 4 accessories); realistic outfits land around 5–7.
 */
export const MAX_PER_CATEGORY_IN_SEGMENT: Record<string, number> = {
  Bottoms: 1,
  Dresses: 1,
  Shoes: 1,
  Tops: 2,
  Outerwear: 2,
  Bags: 1,
  Accessories: 4,
};

/**
 * Categories that cannot be worn together. A dress already covers torso and legs,
 * so pairing it with a top or trousers is not a look, it's a bug — and per-category
 * limits alone allowed it, since each was under its own cap.
 *
 * Outerwear is deliberately NOT on this list: a blazer, vest or cardigan over a
 * dress is a real outfit. The classifier now puts every layering piece in
 * `Outerwear` for exactly this reason — see `classify.ts`'s category rule.
 */
export const INCOMPATIBLE_WITH: Record<string, string[]> = {
  Dresses: ["Tops", "Bottoms"],
};

/**
 * What a segment must contain to be a wearable outfit at all. The generator once
 * produced a day whose entire outfit was one pair of sandals — nothing covering
 * the body — because the rules until then only said how many items were *too
 * many*, never how few were too few.
 *
 * Each slot is satisfied by any one of its categories, so a dress covers both
 * torso and legs on its own.
 */
export const REQUIRED_SLOTS: { slot: string; anyOf: string[] }[] = [
  { slot: "torso", anyOf: ["Dresses", "Tops"] },
  { slot: "legs", anyOf: ["Dresses", "Bottoms"] },
  { slot: "feet", anyOf: ["Shoes"] },
];

export interface RuleDay {
  planDate: string;
  segments: { itemIds: string[] }[];
}

/** Candidate item ids per category, best first — the pool deterministic repairs draw from. */
export type CandidatePool = Map<string, string[]>;

export function buildCandidatePool(
  itemIds: string[],
  categoryFor: CategoryLookup
): CandidatePool {
  const pool: CandidatePool = new Map();
  for (const itemId of itemIds) {
    const category = categoryFor(itemId);
    pool.set(category, [...(pool.get(category) || []), itemId]);
  }
  return pool;
}

export type CategoryLookup = (itemId: string) => string;
export type LabelLookup = (itemId: string) => string;

export function gapForCategory(category: string): number {
  return REPEAT_GAP_BY_CATEGORY[category] ?? DEFAULT_REPEAT_GAP_DAYS;
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    Math.abs(new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) /
      86_400_000
  );
}

// ── Composition ─────────────────────────────────────────────────────────────

export interface CompositionViolation {
  planDate: string;
  segmentIndex: number;
  category: string;
  count: number;
  max: number;
  /** Set when the problem is an incompatible pairing rather than a count. */
  incompatibleWith?: string;
}

export function findCompositionViolations(
  days: RuleDay[],
  categoryFor: CategoryLookup
): CompositionViolation[] {
  const violations: CompositionViolation[] = [];

  for (const day of days) {
    day.segments.forEach((segment, segmentIndex) => {
      const counts = new Map<string, number>();
      for (const itemId of segment.itemIds) {
        const category = categoryFor(itemId);
        counts.set(category, (counts.get(category) ?? 0) + 1);
      }
      for (const [category, count] of counts) {
        const max = MAX_PER_CATEGORY_IN_SEGMENT[category];
        if (max !== undefined && count > max) {
          violations.push({ planDate: day.planDate, segmentIndex, category, count, max });
        }
      }
      for (const [category, incompatible] of Object.entries(INCOMPATIBLE_WITH)) {
        if (!counts.has(category)) continue;
        for (const other of incompatible) {
          if (counts.has(other)) {
            violations.push({
              planDate: day.planDate,
              segmentIndex,
              category: other,
              count: counts.get(other) ?? 0,
              max: 0,
              incompatibleWith: category,
            });
          }
        }
      }
    });
  }

  return violations;
}

/**
 * Deterministically trim a segment down to a wearable set, keeping the first item
 * of each over-represented category in the order the model listed them.
 *
 * Deliberately not a model call: there is no styling judgement in "one pair of
 * trousers, not two", and running this as the last step means an impossible outfit
 * can never reach the database even if a repair call misbehaves.
 */
export function enforceComposition(days: RuleDay[], categoryFor: CategoryLookup): RuleDay[] {
  return days.map((day) => ({
    ...day,
    segments: day.segments.map((segment) => {
      // A dress wins over the top/trousers it conflicts with: it is the piece that
      // makes the outfit coherent on its own, and dropping it would leave a look
      // that also fails the coverage rule.
      const present = new Set(segment.itemIds.map(categoryFor));
      const banned = new Set<string>();
      for (const [category, incompatible] of Object.entries(INCOMPATIBLE_WITH)) {
        if (present.has(category)) incompatible.forEach((other) => banned.add(other));
      }

      const kept: string[] = [];
      const counts = new Map<string, number>();
      for (const itemId of segment.itemIds) {
        const category = categoryFor(itemId);
        if (banned.has(category)) continue;
        const used = counts.get(category) ?? 0;
        const max = MAX_PER_CATEGORY_IN_SEGMENT[category];
        if (max !== undefined && used >= max) continue;
        counts.set(category, used + 1);
        kept.push(itemId);
      }
      return { ...segment, itemIds: kept };
    }),
  })) as RuleDay[];
}

// ── Weather ─────────────────────────────────────────────────────────────────

export type TempLookup = (planDate: string) => number | null;
export type LongSleeveLookup = (itemId: string) => boolean;

export interface WeatherViolation {
  planDate: string;
  segmentIndex: number;
  itemId: string;
  temp: number;
}

export function findWeatherViolations(
  days: RuleDay[],
  isLongSleeveFor: LongSleeveLookup,
  tempFor: TempLookup
): WeatherViolation[] {
  const violations: WeatherViolation[] = [];

  for (const day of days) {
    const temp = tempFor(day.planDate);
    if (temp == null || temp <= TOO_WARM_FOR_SLEEVES_C) continue;

    day.segments.forEach((segment, segmentIndex) => {
      for (const itemId of segment.itemIds) {
        if (isLongSleeveFor(itemId)) {
          violations.push({ planDate: day.planDate, segmentIndex, itemId, temp });
        }
      }
    });
  }

  return violations;
}

/**
 * Strip sleeves off days that are too hot for them. Swaps for a short-sleeve item
 * of the same category when one is available and not worn too close by; otherwise
 * drops it, which is safe because `enforceCoverage` runs after this and will refill
 * a slot that actually needs filling (outerwear is optional and simply disappears).
 */
export function enforceWeather(
  days: RuleDay[],
  categoryFor: CategoryLookup,
  isLongSleeveFor: LongSleeveLookup,
  tempFor: TempLookup,
  pool: CandidatePool
): RuleDay[] {
  const result = days.map((day) => ({
    ...day,
    segments: day.segments.map((segment) => ({ ...segment, itemIds: [...segment.itemIds] })),
  }));

  for (const day of result) {
    const temp = tempFor(day.planDate);
    if (temp == null || temp <= TOO_WARM_FOR_SLEEVES_C) continue;

    for (const segment of day.segments) {
      for (let i = segment.itemIds.length - 1; i >= 0; i--) {
        const itemId = segment.itemIds[i];
        if (!isLongSleeveFor(itemId)) continue;

        const substitute = (pool.get(categoryFor(itemId)) || []).find(
          (candidate) =>
            !isLongSleeveFor(candidate) &&
            !segment.itemIds.includes(candidate) &&
            !usedTooCloseTo(result, candidate, day.planDate, categoryFor)
        );

        if (substitute) segment.itemIds[i] = substitute;
        else segment.itemIds.splice(i, 1);
      }
    }
  }

  return result;
}

// ── Coverage ────────────────────────────────────────────────────────────────

export interface CoverageViolation {
  planDate: string;
  segmentIndex: number;
  missingSlot: string;
  anyOf: string[];
}

export function findCoverageViolations(
  days: RuleDay[],
  categoryFor: CategoryLookup
): CoverageViolation[] {
  const violations: CoverageViolation[] = [];

  for (const day of days) {
    day.segments.forEach((segment, segmentIndex) => {
      const present = new Set(segment.itemIds.map(categoryFor));
      for (const { slot, anyOf } of REQUIRED_SLOTS) {
        if (!anyOf.some((category) => present.has(category))) {
          violations.push({ planDate: day.planDate, segmentIndex, missingSlot: slot, anyOf });
        }
      }
    });
  }

  return violations;
}

/**
 * Fill any slot a segment is still missing after the model has had its chance.
 *
 * Picks the first candidate of a suitable category that isn't already in the
 * segment and isn't worn too close to this date, so filling a hole can't create a
 * rotation violation. A deterministic pick is a worse stylist than the model, but
 * it is unconditionally better than shipping a day whose entire outfit is one pair
 * of sandals — which is what happened before this existed.
 */
export function enforceCoverage(
  days: RuleDay[],
  categoryFor: CategoryLookup,
  pool: CandidatePool,
  /** Optional veto, e.g. "no sleeves on a 32°C day" — filling a hole must not create a new violation. */
  isBanned: (itemId: string, planDate: string) => boolean = () => false
): RuleDay[] {
  const result = days.map((day) => ({
    ...day,
    segments: day.segments.map((segment) => ({ ...segment, itemIds: [...segment.itemIds] })),
  }));

  for (const day of result) {
    for (const segment of day.segments) {
      for (const { anyOf } of REQUIRED_SLOTS) {
        const present = new Set(segment.itemIds.map(categoryFor));
        if (anyOf.some((category) => present.has(category))) continue;

        // Prefer the earlier categories in `anyOf` (a top before a dress, since a
        // dress would also have satisfied the other slot and the model didn't pick one).
        const banned = new Set<string>();
        for (const [category, incompatible] of Object.entries(INCOMPATIBLE_WITH)) {
          if (present.has(category)) incompatible.forEach((other) => banned.add(other));
          if (incompatible.some((other) => present.has(other))) banned.add(category);
        }

        const filler = anyOf
          .filter((category) => !banned.has(category))
          .flatMap((category) => pool.get(category) || [])
          .find(
            (itemId) =>
              !segment.itemIds.includes(itemId) &&
              !isBanned(itemId, day.planDate) &&
              countInSegment(segment.itemIds, categoryFor(itemId), categoryFor) <
                (MAX_PER_CATEGORY_IN_SEGMENT[categoryFor(itemId)] ?? Number.POSITIVE_INFINITY) &&
              !usedTooCloseTo(result, itemId, day.planDate, categoryFor)
          );

        if (filler) segment.itemIds.push(filler);
      }
    }
  }

  return result;
}

function countInSegment(itemIds: string[], category: string, categoryFor: CategoryLookup): number {
  return itemIds.filter((itemId) => categoryFor(itemId) === category).length;
}

/** True when using `itemId` on `date` would break that category's repeat gap. */
function usedTooCloseTo(
  days: RuleDay[],
  itemId: string,
  date: string,
  categoryFor: CategoryLookup
): boolean {
  const requiredGapDays = gapForCategory(categoryFor(itemId));
  if (requiredGapDays <= 1) return false;

  return days.some(
    (day) =>
      day.planDate !== date &&
      daysBetween(day.planDate, date) < requiredGapDays &&
      day.segments.some((segment) => segment.itemIds.includes(itemId))
  );
}

// ── Rotation ────────────────────────────────────────────────────────────────

export interface RotationViolation {
  itemId: string;
  category: string;
  /** The earlier date, left alone — only the later one is rebuilt. */
  keptDate: string;
  conflictDate: string;
  gapDays: number;
  requiredGapDays: number;
}

/**
 * Every pair of wearings closer together than that category's minimum gap.
 * Repeats *within* one day are never violations — carrying a blazer from a meeting
 * into dinner is the reason segments exist — so an item counts once per date.
 */
export function findRotationViolations(
  days: RuleDay[],
  categoryFor: CategoryLookup
): RotationViolation[] {
  const datesByItem = new Map<string, string[]>();

  for (const day of [...days].sort((a, b) => a.planDate.localeCompare(b.planDate))) {
    const onThisDay = new Set(day.segments.flatMap((segment) => segment.itemIds));
    for (const itemId of onThisDay) {
      datesByItem.set(itemId, [...(datesByItem.get(itemId) || []), day.planDate]);
    }
  }

  const violations: RotationViolation[] = [];
  for (const [itemId, dates] of datesByItem) {
    const category = categoryFor(itemId);
    const requiredGapDays = gapForCategory(category);
    if (requiredGapDays <= 1) continue;

    for (let i = 1; i < dates.length; i++) {
      const gapDays = daysBetween(dates[i - 1], dates[i]);
      if (gapDays < requiredGapDays) {
        violations.push({
          itemId,
          category,
          keptDate: dates[i - 1],
          conflictDate: dates[i],
          gapDays,
          requiredGapDays,
        });
      }
    }
  }

  return violations;
}

/**
 * Deterministic last resort for rotation, run after the repair call. Swaps the
 * too-soon repeat on the LATER date for another item of the same category that
 * isn't already in the segment and isn't worn too close by.
 *
 * A code-chosen substitute styles worse than the model would, but three rounds of
 * "the prompt says so and it did it anyway" is enough evidence that the invariant
 * has to be guaranteed rather than requested. If no substitute exists the item
 * stays and the caller reports it as a warning — that case is a genuinely too-small
 * wardrobe, which the user should see rather than have papered over.
 */
export function enforceRotation(
  days: RuleDay[],
  categoryFor: CategoryLookup,
  pool: CandidatePool
): RuleDay[] {
  const result = days.map((day) => ({
    ...day,
    segments: day.segments.map((segment) => ({ ...segment, itemIds: [...segment.itemIds] })),
  }));

  // Recompute after every swap: one substitution can resolve or create others.
  for (let pass = 0; pass < 10; pass++) {
    const violations = findRotationViolations(result, categoryFor);
    if (violations.length === 0) break;

    const violation = violations[0];
    const day = result.find((entry) => entry.planDate === violation.conflictDate);
    if (!day) break;

    const substitute = (pool.get(violation.category) || []).find(
      (itemId) =>
        itemId !== violation.itemId &&
        !day.segments.some((segment) => segment.itemIds.includes(itemId)) &&
        !usedTooCloseTo(result, itemId, day.planDate, categoryFor)
    );
    if (!substitute) break;

    for (const segment of day.segments) {
      const index = segment.itemIds.indexOf(violation.itemId);
      if (index >= 0) segment.itemIds[index] = substitute;
    }
  }

  return result;
}

/** Dates that need rebuilding, in chronological order. */
export function datesNeedingRepair(
  rotation: RotationViolation[],
  composition: CompositionViolation[] = [],
  coverage: CoverageViolation[] = [],
  weather: WeatherViolation[] = []
): string[] {
  return [
    ...new Set([
      ...rotation.map((violation) => violation.conflictDate),
      ...composition.map((violation) => violation.planDate),
      ...coverage.map((violation) => violation.planDate),
      ...weather.map((violation) => violation.planDate),
    ]),
  ].sort();
}

/**
 * A brief for the repair call. Names the exact items and dates rather than
 * restating the rule — restating the rule is what already failed.
 */
export function describeViolations(
  rotation: RotationViolation[],
  composition: CompositionViolation[],
  coverage: CoverageViolation[],
  weather: WeatherViolation[],
  labelFor: LabelLookup
): { planDate: string; problems: string[] }[] {
  const byDate = new Map<string, string[]>();
  const add = (date: string, line: string) =>
    byDate.set(date, [...(byDate.get(date) || []), line]);

  for (const violation of weather) {
    add(
      violation.planDate,
      `"${labelFor(violation.itemId)}" covers the arms but ${violation.planDate} reaches ${violation.temp}°C; nothing long-sleeved (and no outerwear) above ${TOO_WARM_FOR_SLEEVES_C}°C.`
    );
  }

  for (const violation of coverage) {
    add(
      violation.planDate,
      `Segment ${violation.segmentIndex + 1} has nothing covering the ${violation.missingSlot} — it needs at least one of: ${violation.anyOf.join(" or ")}.`
    );
  }

  for (const violation of rotation) {
    add(
      violation.conflictDate,
      `"${labelFor(violation.itemId)}" (id ${violation.itemId}) is already worn on ${violation.keptDate}, only ${violation.gapDays} day(s) earlier; ${violation.category} needs at least ${violation.requiredGapDays} days between wearings.`
    );
  }

  for (const violation of composition) {
    add(
      violation.planDate,
      violation.incompatibleWith
        ? `Segment ${violation.segmentIndex + 1} pairs ${violation.category} with ${violation.incompatibleWith}; a dress already covers torso and legs, so it cannot be worn with a top or trousers. Use outerwear if you want a layer.`
        : `Segment ${violation.segmentIndex + 1} contains ${violation.count} ${violation.category} items; at most ${violation.max} can be worn at once.`
    );
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([planDate, problems]) => ({ planDate, problems }));
}
