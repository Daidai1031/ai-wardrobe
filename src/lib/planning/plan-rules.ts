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
 * Five rule families, all checked here and all enforced deterministically after the
 * model has had one repair attempt:
 *   - Composition: what may appear together in ONE segment (per-category caps and
 *     incompatible pairings).
 *   - Weather: what a given day is too hot for.
 *   - Coverage: what a segment must contain to be an outfit at all.
 *   - Comfort: what a segment cannot contain given what it is (heels on a flight,
 *     activewear in a boardroom) and what the day did before it (anything already
 *     sweated in).
 *   - Rotation: how many days of a week the same item may appear on.
 *
 * Enforcement order is composition → weather → coverage → comfort → rotation.
 * Removing something can open a hole and filling a hole can create a repeat, so
 * coverage sits after the two rules that delete and before the one that swaps;
 * comfort runs after coverage because coverage fills the feet slot from the pool
 * and could otherwise put heels back on a flight.
 */

/**
 * The rotation window. Every limit below is "how many DAYS of any seven the same
 * piece may be worn on", measured over a rolling seven-day window, so a limit of
 * `ROTATION_WINDOW_DAYS` is no limit at all.
 */
export const ROTATION_WINDOW_DAYS = 7;

/**
 * Default days-per-week each category may be worn on, before the user's own
 * settings are merged in by `resolveRotationLimits()`.
 *
 * This replaced a "minimum gap in days between wearings" table. The two are close
 * but not the same, and the difference is what users actually complained about: a
 * 2-day gap silently permits three wearings a week (Mon/Wed/Fri), which is exactly
 * how the same sandals kept coming back. Counting days is also the way the rule is
 * naturally stated ("no more than two days a week in the same shoes"), so the
 * setting and the guarantee are the same sentence.
 *
 * Repeats WITHIN one day are never counted — one blazer carrying through several
 * segments is the reason segments exist.
 */
export const MAX_WEAR_DAYS_BY_CATEGORY: Record<string, number> = {
  // Garments are once a week: worn on any day of the window, unavailable on the
  // rest of it.
  Tops: 1,
  Bottoms: 1,
  Dresses: 1,
  Outerwear: 1,
  // A closet holds more pairs of shoes than trousers, and the same boots twice in
  // a week reads as normal in a way the same trousers does not.
  Shoes: 2,
  // Bags and accessories used to be exempt entirely, on the reasoning that
  // carrying the same tote daily is normal. Unlimited turned out to be the wrong
  // reading of that: the generator settled on one clutch and one pair of earrings
  // and reached for them every single day, which is not "normal", it is the
  // wardrobe shrinking to four pieces. Three days a week keeps a genuine everyday
  // bag possible without letting it become the only one.
  Bags: 3,
  Accessories: 3,
};

/** For a category nobody has a rule for — conservative, not exempt. */
const DEFAULT_MAX_WEAR_DAYS = 2;

/** Resolved per-category limits: the defaults above with the user's settings merged over them. */
export type RotationLimits = Record<string, number>;

/**
 * Dates an item is ALREADY committed to outside the days currently being
 * generated — the plans on the surrounding days. Without this, rotation only ever
 * saw the days in one request, so redoing a single day happily put back the same
 * trousers the rest of the week already uses, and next week's plan reached for the
 * same favourites as this week's.
 */
export type WearHistory = Map<string, string[]>;

export interface RotationContext {
  limits: RotationLimits;
  history: WearHistory;
}

export function rotationContext(
  limits: RotationLimits,
  history: WearHistory = new Map()
): RotationContext {
  return { limits, history };
}

/**
 * Merge a user's stored `profiles.rotation_limits` over the defaults, dropping
 * anything unusable rather than trusting the column.
 *
 * Only categories the user actually changed are stored, so tuning a default later
 * moves everyone who never touched it — a full snapshot per user would freeze them
 * on today's numbers forever.
 */
export function resolveRotationLimits(overrides: unknown): RotationLimits {
  const limits: RotationLimits = { ...MAX_WEAR_DAYS_BY_CATEGORY };
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) return limits;

  for (const [category, value] of Object.entries(overrides as Record<string, unknown>)) {
    if (!category.trim()) continue;
    const days = typeof value === "number" ? Math.round(value) : Number.NaN;
    if (!Number.isFinite(days) || days < 1 || days > ROTATION_WINDOW_DAYS) continue;
    limits[category] = days;
  }
  return limits;
}

export function maxWearDaysFor(category: string, limits: RotationLimits): number {
  return limits[category] ?? MAX_WEAR_DAYS_BY_CATEGORY[category] ?? DEFAULT_MAX_WEAR_DAYS;
}

/**
 * The limits as the prompts state them. Built from the resolved map rather than
 * written into the prompt text by hand: a user who sets bottoms to 3 days a week
 * while the prompt still says "once a week" is being aimed at the wrong target,
 * and the deterministic pass then has to hack the result back into shape — which
 * works, but styles worse than asking for the right thing in the first place.
 */
export function describeRotationLimits(limits: RotationLimits): Record<string, string> {
  const categories = [...new Set([...Object.keys(MAX_WEAR_DAYS_BY_CATEGORY), ...Object.keys(limits)])];
  return Object.fromEntries(
    categories.map((category) => {
      const days = maxWearDaysFor(category, limits);
      return [
        category,
        days >= ROTATION_WINDOW_DAYS
          ? "no limit, may repeat freely"
          : `at most ${days} day${days === 1 ? "" : "s"} out of any 7`,
      ];
    })
  );
}

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

/**
 * `eventIds` is optional because most rules only need the item set; the comfort
 * rule needs it, since "is this segment spent on a plane" is a fact about the
 * calendar events the segment covers, not about the clothes.
 */
export interface RuleSegment {
  itemIds: string[];
  eventIds?: string[];
}

export interface RuleDay {
  planDate: string;
  segments: RuleSegment[];
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

/** Whole days from `from` to `to`; negative when `to` is the earlier date. */
function daysFrom(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000
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
  pool: CandidatePool,
  rotation: RotationContext
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
            !wouldExceedRotation(result, candidate, day.planDate, categoryFor, rotation)
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
  rotation: RotationContext,
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
              !wouldExceedRotation(result, itemId, day.planDate, categoryFor, rotation)
          );

        if (filler) segment.itemIds.push(filler);
      }
    }
  }

  return result;
}

// ── Comfort (transit, sweat, activewear where it doesn't belong) ────────────

/**
 * Footwear nobody wants to spend a flight, a train journey or an airport transfer
 * in. Shoes only, and only unambiguous terms: the same conservatism as
 * `isLongSleeve`, for the same reason — a false positive silently removes
 * something the user owns from a look that was otherwise fine.
 *
 * Deliberately limited to footwear even though a tailored suit is also a poor
 * choice on an overnight flight. "Is this shoe a heel" is decidable from the data
 * we store; "is this blazer too stiff to sit in for seven hours" is judgement, and
 * judgement stays with the model — the prompt asks for it, this only guarantees
 * the part that can be guaranteed.
 */
const HARD_TO_TRAVEL_IN_KEYWORDS = [
  "heel",
  "stiletto",
  "pump",
  "slingback",
  "sling-back",
  "court shoe",
  "wedge",
];

export function isHardToTravelIn(item: {
  category: string;
  subcategory?: string | null;
  display_name?: string | null;
}): boolean {
  if (item.category !== "Shoes") return false;
  const text = `${item.subcategory ?? ""} ${item.display_name ?? ""}`.toLowerCase();
  return HARD_TO_TRAVEL_IN_KEYWORDS.some((keyword) => text.includes(keyword));
}

/**
 * Bags and accessories are carried, not worn against the skin. The same tote
 * before and after a tennis match is fine, and forcing a different one would be
 * the same kind of noise that made bags exempt from the rotation limit for so long.
 */
const WORN_AGAINST_SKIN = (category: string) => category !== "Bags" && category !== "Accessories";

/**
 * From this formality upward, sport clothes are the wrong answer however
 * comfortable they are. 3 is where the calendar's own scale turns into work and
 * business-casual; 1–2 is the casual end where a hoodie and trainers are simply
 * what someone wears.
 *
 * An ATHLETIC segment can never trip this: `MAX_FORMALITY_BY_KIND` caps its
 * formality at 2 precisely so that a client's tennis match at a formal club is
 * still dressed as tennis.
 */
export const MIN_FORMALITY_BANNING_ACTIVEWEAR = 3;

const ACTIVEWEAR_KEYWORDS = [
  "activewear",
  "sportswear",
  "athletic",
  "sports bra",
  "gym",
  "workout",
  "running",
  "track pant",
  "track short",
  "tracksuit",
  "sweatpant",
  "sweat pant",
  "jogger",
  "legging",
  "yoga",
  "cleat",
  "rash guard",
  "swim",
];

/** Occasions an item is tagged for that mean it is genuinely dressed-up-able. */
const DRESSED_UP_OCCASIONS = new Set(["work", "formal", "party", "wedding"]);

/**
 * Whether this is sport kit rather than clothes that merely look relaxed.
 *
 * Two signals, both needed, because each is wrong on its own. The classifier's
 * `occasion` array is the strong one — an item tagged only `sport` is activewear
 * by the same vocabulary the rest of planning uses — but plenty of real activewear
 * is tagged `sport, casual` too, so the keyword list catches those. In the other
 * direction a keyword alone over-fires (a "running" print, a silk track-style
 * trouser), so anything the classifier also considers work, formal, party or
 * wedding wear is left alone. As with `isLongSleeve` and `isHardToTravelIn`, a
 * false positive silently removes something the user owns, so the bar is
 * deliberately high.
 */
export function isActivewear(item: {
  category: string;
  subcategory?: string | null;
  display_name?: string | null;
  occasion?: string[] | null;
  style_tags?: string[] | null;
}): boolean {
  const occasions = (item.occasion ?? []).map((tag) => tag.toLowerCase());
  if (occasions.some((tag) => DRESSED_UP_OCCASIONS.has(tag))) return false;

  if (occasions.length > 0 && occasions.every((tag) => tag === "sport")) return true;

  const text = `${item.subcategory ?? ""} ${item.display_name ?? ""} ${(item.style_tags ?? []).join(" ")}`.toLowerCase();
  return ACTIVEWEAR_KEYWORDS.some((keyword) => text.includes(keyword));
}

/** What a segment is — supplied by the caller, who is the one holding the calendar. */
export type SegmentKind = "transit" | "athletic" | "general";

/**
 * Everything about a segment that the rules need but the item list can't say:
 * what it is, and how formal it has to be. Formality is already capped by kind by
 * the caller (see `occasion-groups.ts`), so a flight belonging to a business trip
 * arrives here as the 2 it should be dressed for, not the 4 it was classified as.
 */
export interface SegmentContext {
  kind: SegmentKind;
  formality: number | null;
}

export type SegmentContextLookup = (segment: RuleSegment) => SegmentContext;
export type HardToTravelInLookup = (itemId: string) => boolean;
export type ActivewearLookup = (itemId: string) => boolean;

/** Why an item can't be in this particular segment. */
export type ComfortReason = "transit" | "sweat" | "too_casual";

export interface ComfortViolation {
  planDate: string;
  segmentIndex: number;
  itemId: string;
  reason: ComfortReason;
}

/**
 * Everything worn (not merely carried) in an ATHLETIC segment earlier in the same
 * day. You sweat in it, so it doesn't come back later — this is what makes an
 * athletic occasion more than just a low formality.
 */
function sweatyBefore(
  day: RuleDay,
  segmentIndex: number,
  contextFor: SegmentContextLookup,
  categoryFor: CategoryLookup
): Set<string> {
  const worn = new Set<string>();
  for (let i = 0; i < segmentIndex; i++) {
    if (contextFor(day.segments[i]).kind !== "athletic") continue;
    for (const itemId of day.segments[i].itemIds) {
      if (WORN_AGAINST_SKIN(categoryFor(itemId))) worn.add(itemId);
    }
  }
  return worn;
}

/**
 * Whether this item can be in this segment, given what the segment is and what the
 * day did before it. All three reasons are checked in one place so a fix for one
 * can't introduce another — swapping heels off a flight must not reach for the
 * trainers that were just run in, and neither must reach for gym kit to wear to a
 * board meeting.
 */
function comfortReasonFor(
  itemId: string,
  context: SegmentContext,
  sweaty: Set<string>,
  isHardToTravelInFor: HardToTravelInLookup,
  isActivewearFor: ActivewearLookup
): ComfortReason | null {
  if (sweaty.has(itemId)) return "sweat";
  if (context.kind === "transit" && isHardToTravelInFor(itemId)) return "transit";
  if (
    context.formality !== null &&
    context.formality >= MIN_FORMALITY_BANNING_ACTIVEWEAR &&
    isActivewearFor(itemId)
  ) {
    return "too_casual";
  }
  return null;
}

export function findComfortViolations(
  days: RuleDay[],
  contextFor: SegmentContextLookup,
  isHardToTravelInFor: HardToTravelInLookup,
  isActivewearFor: ActivewearLookup,
  categoryFor: CategoryLookup
): ComfortViolation[] {
  const violations: ComfortViolation[] = [];

  for (const day of days) {
    day.segments.forEach((segment, segmentIndex) => {
      const context = contextFor(segment);
      const sweaty = sweatyBefore(day, segmentIndex, contextFor, categoryFor);
      for (const itemId of segment.itemIds) {
        const reason = comfortReasonFor(
          itemId,
          context,
          sweaty,
          isHardToTravelInFor,
          isActivewearFor
        );
        if (reason) violations.push({ planDate: day.planDate, segmentIndex, itemId, reason });
      }
    });
  }

  return violations;
}

/**
 * Swap out anything a segment can't wear: heels on a flight, and anything already
 * sweated in earlier that day.
 *
 * Unlike `enforceWeather` this never drops the offending item — the substitution is
 * 1:1 or nothing. Removing the only pair of shoes from a segment would leave the
 * wearer barefoot, which is worse than the problem being fixed, so if the closet
 * has no free alternative the item stays and the caller reports it as a warning,
 * the same way rotation handles a wardrobe that is simply too small.
 *
 * Segments are walked in order so that each one sees the *already corrected*
 * versions of the segments before it.
 */
export function enforceComfort(
  days: RuleDay[],
  categoryFor: CategoryLookup,
  contextFor: SegmentContextLookup,
  isHardToTravelInFor: HardToTravelInLookup,
  isActivewearFor: ActivewearLookup,
  pool: CandidatePool,
  rotation: RotationContext
): RuleDay[] {
  const result = days.map((day) => ({
    ...day,
    segments: day.segments.map((segment) => ({ ...segment, itemIds: [...segment.itemIds] })),
  }));

  for (const day of result) {
    day.segments.forEach((segment, segmentIndex) => {
      const context = contextFor(segment);
      const sweaty = sweatyBefore(day, segmentIndex, contextFor, categoryFor);

      for (let i = 0; i < segment.itemIds.length; i++) {
        const itemId = segment.itemIds[i];
        if (!comfortReasonFor(itemId, context, sweaty, isHardToTravelInFor, isActivewearFor)) {
          continue;
        }

        const substitute = (pool.get(categoryFor(itemId)) || []).find(
          (candidate) =>
            !comfortReasonFor(candidate, context, sweaty, isHardToTravelInFor, isActivewearFor) &&
            !segment.itemIds.includes(candidate) &&
            !wouldExceedRotation(result, candidate, day.planDate, categoryFor, rotation)
        );

        if (substitute) segment.itemIds[i] = substitute;
      }
    });
  }

  return result;
}

function countInSegment(itemIds: string[], category: string, categoryFor: CategoryLookup): number {
  return itemIds.filter((itemId) => categoryFor(itemId) === category).length;
}

// ── Rotation ────────────────────────────────────────────────────────────────

/**
 * Every date this item is worn on, whether that comes from the days being
 * generated or from plans that already exist around them. An item counts once per
 * date however many segments of that day it appears in.
 */
function wearDatesFor(itemId: string, days: RuleDay[], rotation: RotationContext): string[] {
  const dates = new Set(rotation.history.get(itemId) ?? []);
  for (const day of days) {
    if (day.segments.some((segment) => segment.itemIds.includes(itemId))) {
      dates.add(day.planDate);
    }
  }
  return [...dates].sort();
}

/** The dates of `dates` that fall inside the rolling window ending on `endDate`. */
function datesInWindowEndingAt(dates: string[], endDate: string): string[] {
  return dates.filter((date) => {
    const distance = daysFrom(date, endDate);
    return distance >= 0 && distance < ROTATION_WINDOW_DAYS;
  });
}

/**
 * True when putting `itemId` on `date` would push it over its category's
 * days-per-week limit — looking both back and forward, since a new wearing can
 * just as easily break the window of a day that is already planned after it.
 */
function wouldExceedRotation(
  days: RuleDay[],
  itemId: string,
  date: string,
  categoryFor: CategoryLookup,
  rotation: RotationContext
): boolean {
  const maxDays = maxWearDaysFor(categoryFor(itemId), rotation.limits);
  if (maxDays >= ROTATION_WINDOW_DAYS) return false;

  const dates = [...new Set([...wearDatesFor(itemId, days, rotation), date])].sort();
  return dates.some((endDate) => datesInWindowEndingAt(dates, endDate).length > maxDays);
}

export interface RotationViolation {
  itemId: string;
  category: string;
  /** The over-the-limit date — the only one rebuilt; the earlier ones are left alone. */
  conflictDate: string;
  /** The other days of the same window it is already worn on. */
  otherDates: string[];
  daysUsed: number;
  maxDays: number;
}

/**
 * Every day an item appears on after it has already used up its category's
 * allowance for that rolling week.
 *
 * Repeats *within* one day are never violations — carrying a blazer from a meeting
 * into dinner is the reason segments exist — so an item counts once per date. Days
 * that come from `rotation.history` are counted but never reported: a plan that is
 * already saved for last Tuesday is not something this generation can rebuild.
 */
export function findRotationViolations(
  days: RuleDay[],
  categoryFor: CategoryLookup,
  rotation: RotationContext
): RotationViolation[] {
  const generatedDates = new Set(days.map((day) => day.planDate));
  const itemIds = new Set(
    days.flatMap((day) => day.segments.flatMap((segment) => segment.itemIds))
  );

  const violations: RotationViolation[] = [];
  for (const itemId of itemIds) {
    const category = categoryFor(itemId);
    const maxDays = maxWearDaysFor(category, rotation.limits);
    if (maxDays >= ROTATION_WINDOW_DAYS) continue;

    const dates = wearDatesFor(itemId, days, rotation);
    for (const date of dates) {
      if (!generatedDates.has(date)) continue;
      const window = datesInWindowEndingAt(dates, date);
      if (window.length > maxDays) {
        violations.push({
          itemId,
          category,
          conflictDate: date,
          otherDates: window.filter((entry) => entry !== date),
          daysUsed: window.length,
          maxDays,
        });
      }
    }
  }

  return violations.sort((a, b) => a.conflictDate.localeCompare(b.conflictDate));
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
  pool: CandidatePool,
  rotation: RotationContext
): RuleDay[] {
  const result = days.map((day) => ({
    ...day,
    segments: day.segments.map((segment) => ({ ...segment, itemIds: [...segment.itemIds] })),
  }));

  // Recompute after every swap: one substitution can resolve or create others.
  // The cap is generous because a week of over-used favourites is exactly the case
  // that needs several swaps, and each pass fixes at most one item.
  const unfixable = new Set<string>();
  for (let pass = 0; pass < 40; pass++) {
    const violation = findRotationViolations(result, categoryFor, rotation).find(
      (entry) => !unfixable.has(`${entry.itemId}@${entry.conflictDate}`)
    );
    if (!violation) break;

    const day = result.find((entry) => entry.planDate === violation.conflictDate);
    if (!day) break;

    const substitute = (pool.get(violation.category) || []).find(
      (itemId) =>
        itemId !== violation.itemId &&
        !day.segments.some((segment) => segment.itemIds.includes(itemId)) &&
        !wouldExceedRotation(result, itemId, day.planDate, categoryFor, rotation)
    );
    // One unfillable repeat must not stop the rest from being fixed; it is
    // reported as a warning instead, which is the "your closet is too small for
    // this setting" case.
    if (!substitute) {
      unfixable.add(`${violation.itemId}@${violation.conflictDate}`);
      continue;
    }

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
  weather: WeatherViolation[] = [],
  comfort: ComfortViolation[] = []
): string[] {
  return [
    ...new Set([
      ...rotation.map((violation) => violation.conflictDate),
      ...composition.map((violation) => violation.planDate),
      ...coverage.map((violation) => violation.planDate),
      ...weather.map((violation) => violation.planDate),
      ...comfort.map((violation) => violation.planDate),
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
  comfort: ComfortViolation[],
  labelFor: LabelLookup
): { planDate: string; problems: string[] }[] {
  const byDate = new Map<string, string[]>();
  const add = (date: string, line: string) =>
    byDate.set(date, [...(byDate.get(date) || []), line]);

  // Named first because the fix is rarely just the shoes: a segment spent in
  // transit usually needs rebuilding, and the model does that better than the
  // deterministic 1:1 swap that runs afterwards if this call doesn't.
  for (const violation of comfort) {
    if (violation.reason === "sweat") {
      add(
        violation.planDate,
        `Segment ${violation.segmentIndex + 1} re-wears "${labelFor(violation.itemId)}" from a workout or match earlier that day. Nothing worn for sport is put back on afterwards — that segment needs a complete change of clothes (bags and accessories aside).`
      );
    } else if (violation.reason === "transit") {
      add(
        violation.planDate,
        `Segment ${violation.segmentIndex + 1} is spent travelling (a flight, train or transfer) but wears "${labelFor(violation.itemId)}". Rebuild that segment for the journey rather than the destination: flat, easy-on shoes and soft, unrestrictive pieces.`
      );
    } else {
      add(
        violation.planDate,
        `Segment ${violation.segmentIndex + 1} is a formal enough occasion that sport kit doesn't belong there, but it wears "${labelFor(violation.itemId)}". Replace it with something that reads as real clothes for that occasion.`
      );
    }
  }

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
      `"${labelFor(violation.itemId)}" (id ${violation.itemId}) is already worn on ${violation.otherDates.join(", ")}; ${violation.category} may only be worn on ${violation.maxDays} day(s) of any seven, and this would be day ${violation.daysUsed}. Use a different piece here.`
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
