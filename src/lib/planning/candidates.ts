/**
 * Decision D8: hard-filter the wardrobe in TypeScript before it reaches Claude,
 * rather than asking the model to satisfy hard constraints itself.
 *
 * Weekly planning is where this starts to matter. A 7-day plan has to reason about
 * every item against every day, so sending a whole closet is both expensive and
 * worse — models are unreliable at "never use a winter coat when it's 28°C", but
 * that rule is trivial and exact in code. What the model is actually good at is the
 * soft part: which of these 40 plausible pieces look right together.
 *
 * The filter's real risk is over-filtering into uselessness — a wardrobe where
 * nothing is tagged for the right season, or a closet small enough that any filter
 * empties it. So it relaxes in stages and guarantees per-category coverage rather
 * than trusting a single pass.
 */

/** The wardrobe fields this module needs; deliberately looser than WardrobeItem. */
export interface CandidateItem {
  id: string;
  category: string;
  season?: string[] | null;
  occasion?: string[] | null;
  favorite?: boolean | null;
  times_worn?: number | null;
  last_worn_at?: string | null;
}

export interface CandidateFilterOptions {
  /** Coldest and warmest °C across the planning window. */
  tempMin: number;
  tempMax: number;
  /** Formality levels (1-5) of the window's calendar events; empty = no signal. */
  formalityLevels: number[];
  /** Upper bound on what reaches the prompt. */
  limit?: number;
  /** An item worn this recently is deprioritized, never hard-dropped. */
  recentlyWornDays?: number;
  /**
   * Items the surrounding days already plan to use. Deprioritized, never dropped:
   * the rotation rules decide what is actually allowed, this only stops the prompt
   * being handed the same forty pieces it was handed last week.
   */
  recentlyPlannedIds?: Set<string>;
  /**
   * How much random spread to add to the ranking, in score points. The scoring
   * below is otherwise fully deterministic, so the same wardrobe produced the same
   * top 45 on every single generation and the model — reasonably — kept choosing
   * the same standouts out of them. Regenerating is supposed to give you something
   * else; a little noise in what it is offered is what makes that true.
   */
  variety?: number;
  now?: Date;
}

const DEFAULT_LIMIT = 45;
/** Below this the filter is doing more harm than good and relaxes a stage. */
const RELAX_FLOOR = 24;
/** Every category the user owns keeps at least this many candidates. */
const MIN_PER_CATEGORY = 3;
const DEFAULT_RECENTLY_WORN_DAYS = 2;
/**
 * Enough to reshuffle items whose scores are close (the usual case — most of a
 * wardrobe scores 4 or 4.5), not enough to promote something the filter genuinely
 * ranked badly, which is a 3+ point gap away.
 */
const DEFAULT_VARIETY = 1.5;

/**
 * Seasons plausible at a given temperature. Overlapping on purpose: a 16°C day is
 * genuinely spring, fall and light-summer territory, and being generous here is the
 * safe direction — a wrong inclusion costs a few tokens, a wrong exclusion silently
 * removes the item the user wanted.
 */
function seasonsForTemp(temp: number): string[] {
  if (temp >= 24) return ["summer"];
  if (temp >= 16) return ["summer", "spring", "fall"];
  if (temp >= 8) return ["spring", "fall"];
  if (temp >= 0) return ["fall", "winter"];
  return ["winter"];
}

function seasonsForRange(tempMin: number, tempMax: number): Set<string> {
  return new Set([...seasonsForTemp(tempMin), ...seasonsForTemp(tempMax)]);
}

/**
 * `occasion` tags the classifier emits ("work", "casual", "formal", "date",
 * "travel", "sport", "party", "wedding") mapped onto the 1-5 formality scale the
 * calendar classifier emits. The two vocabularies were designed independently, so
 * this is the one place they get reconciled.
 */
const OCCASIONS_BY_FORMALITY: Record<number, string[]> = {
  1: ["casual", "sport"],
  2: ["casual", "travel", "date"],
  3: ["work", "casual", "date", "travel"],
  4: ["work", "formal", "party", "date"],
  5: ["formal", "wedding", "party"],
};

function occasionsForFormality(levels: number[]): Set<string> {
  const tags = new Set<string>();
  for (const level of levels) {
    for (const tag of OCCASIONS_BY_FORMALITY[level] || []) tags.add(tag);
  }
  return tags;
}

/** Untagged is treated as "fits anything" — absent data must not exclude an item. */
function matches(tags: string[] | null | undefined, wanted: Set<string>): boolean {
  if (wanted.size === 0) return true;
  if (!tags || tags.length === 0) return true;
  return tags.some((tag) => wanted.has(tag.toLowerCase()));
}

export interface CandidateResult<T> {
  items: T[];
  /** How much relaxation was needed — surfaced for logging, not for the prompt. */
  relaxedTo: "both" | "either" | "none";
}

export function selectCandidates<T extends CandidateItem>(
  items: T[],
  options: CandidateFilterOptions
): CandidateResult<T> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const recentlyWornDays = options.recentlyWornDays ?? DEFAULT_RECENTLY_WORN_DAYS;
  const now = options.now ?? new Date();
  const recentCutoff = now.getTime() - recentlyWornDays * 86_400_000;

  const wantedSeasons = seasonsForRange(options.tempMin, options.tempMax);
  const wantedOccasions = occasionsForFormality(options.formalityLevels);

  const seasonOk = (item: T) => matches(item.season, wantedSeasons);
  const occasionOk = (item: T) => matches(item.occasion, wantedOccasions);

  // Stage down rather than returning something unusable.
  let pool = items.filter((item) => seasonOk(item) && occasionOk(item));
  let relaxedTo: CandidateResult<T>["relaxedTo"] = "both";
  if (pool.length < Math.min(RELAX_FLOOR, items.length)) {
    pool = items.filter((item) => seasonOk(item) || occasionOk(item));
    relaxedTo = "either";
  }
  if (pool.length < Math.min(RELAX_FLOOR, items.length)) {
    pool = [...items];
    relaxedTo = "none";
  }

  const score = (item: T) => {
    let value = 0;
    if (seasonOk(item)) value += 2;
    if (occasionOk(item)) value += 2;
    if (item.favorite) value += 1;
    // Nudge toward pieces the user owns but never reaches for; this is the same
    // signal Analytics calls "never worn", used here to widen rotation.
    if (!item.times_worn) value += 0.5;
    const lastWorn = item.last_worn_at ? new Date(item.last_worn_at).getTime() : 0;
    if (lastWorn && lastWorn >= recentCutoff) value -= 3;
    // `last_worn_at` only moves when a day is confirmed worn, which most days
    // aren't, so on its own it barely separates anything. What the surrounding
    // days already plan to use is the signal that actually exists.
    if (options.recentlyPlannedIds?.has(item.id)) value -= 2;
    return value;
  };

  const variety = options.variety ?? DEFAULT_VARIETY;
  const jitter = new Map(pool.map((item) => [item.id, Math.random() * variety]));
  const rankOf = (item: T) => score(item) + (jitter.get(item.id) ?? 0);

  const ranked = [...pool].sort((a, b) => rankOf(b) - rankOf(a));
  if (ranked.length <= limit) return { items: ranked, relaxedTo };

  // Take the top `limit`, but never let ranking wipe out a whole category — a week
  // with no shoes in the candidate set is not a plan the model can rescue.
  const selected = ranked.slice(0, limit);
  const selectedIds = new Set(selected.map((item) => item.id));
  const byCategory = new Map<string, T[]>();
  for (const item of ranked) {
    byCategory.set(item.category, [...(byCategory.get(item.category) || []), item]);
  }

  for (const [, categoryItems] of byCategory) {
    const present = categoryItems.filter((item) => selectedIds.has(item.id));
    const needed = Math.min(MIN_PER_CATEGORY, categoryItems.length) - present.length;
    for (let i = 0; i < needed; i++) {
      const addition = categoryItems.find((item) => !selectedIds.has(item.id));
      if (!addition) break;
      // Displace the lowest-ranked item from an over-represented category.
      const removable = [...selected]
        .reverse()
        .find(
          (item) =>
            item.category !== addition.category &&
            (byCategory.get(item.category) || []).filter((candidate) =>
              selectedIds.has(candidate.id)
            ).length > MIN_PER_CATEGORY
        );
      if (!removable) break;
      selected.splice(selected.indexOf(removable), 1);
      selectedIds.delete(removable.id);
      selected.push(addition);
      selectedIds.add(addition.id);
    }
  }

  return { items: selected, relaxedTo };
}
