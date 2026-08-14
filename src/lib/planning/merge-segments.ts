/**
 * Consolidating a day's looks after generation.
 *
 * `groupOccasions` decides how many segments a day *may* have, from the calendar
 * alone. This decides how many it actually earns, from the clothes: two entries
 * that arrive wearing the same outfit are one look however different their
 * occasions were.
 */

/** Categories that decide whether two segments are the same OUTFIT or two outfits. */
const CORE_CATEGORIES = new Set(["Tops", "Bottoms", "Dresses", "Outerwear"]);

export interface MergeableSegment {
  label: string;
  itemIds: string[];
  eventIds: string[];
  reasoning: string;
  changeFromPrevious?: string;
  /**
   * Set when this segment absorbed the one after it. `alignSegmentText` reads it:
   * whatever followed the pair now transitions from a look that was never described
   * to the model, so its "what changed" line has to be rebuilt from the real diff.
   */
  merged?: boolean;
}

export interface MergeOptions {
  categoryFor: (itemId: string) => string;
  /**
   * What each segment is, from `occasion-groups.ts`. Two segments of different
   * kinds are never merged even when they somehow wear the same clothes, and an
   * athletic segment is never merged with anything: it is a separate look by
   * definition — you change out of it — so collapsing one into its neighbour would
   * hide a rule failure rather than tidy a duplicate.
   */
  kindFor?: (segment: MergeableSegment) => string;
}

function sameSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const leftIds = new Set(left);
  return leftIds.size === right.length && right.every((id) => leftIds.has(id));
}

function coreOf(itemIds: string[], categoryFor: (itemId: string) => string): string[] {
  return itemIds.filter((itemId) => CORE_CATEGORIES.has(categoryFor(itemId)));
}

function joinUniqueText(left: string, right: string, separator: string): string {
  const values = [left.trim(), right.trim()].filter(Boolean);
  return [...new Set(values)].join(separator);
}

/**
 * Whether these two adjacent segments are really one look.
 *
 * The original test was set equality, which only caught the case where the model
 * returned literally identical lists. What it actually returned, over and over, was
 * a board meeting and the client lunch after it in the same blazer, trousers,
 * shirt, bag and belt with the ankle boots changed for wedges — three "different"
 * outfits a day that were one outfit and a shoe rack. So the test is on the CORE:
 * if the tops, bottoms, dresses and outerwear are identical, swapping the shoes or
 * the bag is not a change of outfit and does not deserve its own segment.
 *
 * A real change of clothes — a work suit becoming a cocktail dress, office clothes
 * becoming sport kit — moves a core piece, so it never merges. That is the line the
 * user drew and it is the one this draws.
 */
function isSameLook(
  previous: MergeableSegment,
  segment: MergeableSegment,
  options: MergeOptions
): boolean {
  const kindFor = options.kindFor;
  if (kindFor) {
    const previousKind = kindFor(previous);
    if (previousKind !== kindFor(segment)) return false;
    if (previousKind === "athletic") return false;
  }

  if (sameSet(previous.itemIds, segment.itemIds)) return true;

  const previousCore = coreOf(previous.itemIds, options.categoryFor);
  // A segment with no core at all is not an outfit; coverage should have caught it,
  // and treating two of them as "the same look" would merge on the absence of data.
  if (previousCore.length === 0) return false;
  return sameSet(previousCore, coreOf(segment.itemIds, options.categoryFor));
}

/**
 * Collapse consecutive occasion segments that wear the same look. Only adjacent
 * entries can be combined: merging the same outfit across an intervening change
 * would erase a real transition.
 *
 * The surviving segment keeps the FIRST one's items. A day generally runs from its
 * most formal occasion downward, and where it doesn't, the clothes themselves
 * differ and nothing merges — so the earlier entry is the safe one to dress for.
 * Its reasoning is kept whole rather than concatenated with the second's, because
 * the second's reasoning exists to explain a change that no longer happened
 * ("brown wedges offer a fresh footwear change") and would contradict what the
 * canvas now shows.
 */
export function mergeAdjacentEquivalentSegments<T extends MergeableSegment>(
  segments: T[],
  options: MergeOptions
): T[] {
  const merged: T[] = [];

  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (!previous || !isSameLook(previous, segment, options)) {
      merged.push({
        ...segment,
        itemIds: [...segment.itemIds],
        eventIds: [...segment.eventIds],
      });
      continue;
    }

    merged[merged.length - 1] = {
      ...previous,
      label: joinUniqueText(previous.label, segment.label, " + "),
      eventIds: [...new Set([...previous.eventIds, ...segment.eventIds])],
      reasoning: sameSet(previous.itemIds, segment.itemIds)
        ? joinUniqueText(previous.reasoning, segment.reasoning, " ")
        : previous.reasoning,
      merged: true,
    };
  }

  return merged;
}
