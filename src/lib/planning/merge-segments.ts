export interface MergeableSegment {
  label: string;
  itemIds: string[];
  eventIds: string[];
  reasoning: string;
  changeFromPrevious?: string;
}

function sameItemSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const leftIds = new Set(left);
  return leftIds.size === right.length && right.every((id) => leftIds.has(id));
}

function joinUniqueText(left: string, right: string, separator: string): string {
  const values = [left.trim(), right.trim()].filter(Boolean);
  return [...new Set(values)].join(separator);
}

/**
 * Collapse consecutive occasion segments when they recommend the exact same
 * complete outfit. Only adjacent entries can be combined: merging the same look
 * across an intervening outfit change would erase a real transition.
 */
export function mergeAdjacentEquivalentSegments<T extends MergeableSegment>(segments: T[]): T[] {
  const merged: T[] = [];

  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (!previous || !sameItemSet(previous.itemIds, segment.itemIds)) {
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
      reasoning: joinUniqueText(previous.reasoning, segment.reasoning, " "),
    };
  }

  return merged;
}
