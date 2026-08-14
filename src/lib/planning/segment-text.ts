/**
 * Keeping a segment's words true to its items.
 *
 * Everything in `plan-rules.ts` runs *after* the model has written its reasoning,
 * and every one of those rules can change what the segment contains. So the model
 * would explain a look it no longer describes: a golf segment whose reasoning read
 * "Retained the brown wedge sandals" while the canvas showed the white pumps the
 * comfort rule had swapped in, and a first segment carrying a "changeFromPrevious"
 * inherited from the repair call, describing a change from the previous *version of
 * the plan* rather than from the previous segment of the day.
 *
 * Neither is fixable in the prompt — the text is written before the change exists —
 * and asking a second model call to rewrite it would cost a generation to restate
 * facts we already hold exactly. So the transition line is derived from the actual
 * item diff, and any sentence of the reasoning that names a piece no longer in the
 * segment is dropped. What survives is the model's styling voice about the clothes
 * that are really there.
 */

export interface AlignableSegment {
  label: string;
  itemIds: string[];
  reasoning: string;
  changeFromPrevious?: string;
  /** What the model asked for, before the rule engine had its say. */
  originalItemIds?: string[];
  /** Set by `mergeAdjacentEquivalentSegments` when this segment absorbed the next. */
  merged?: boolean;
}

/**
 * Words too common to identify a garment. Colors are deliberately absent: "brown"
 * is weak alone but decisive next to "sandals", and the match below needs two
 * words agreeing anyway.
 */
const UNDISTINGUISHING_WORDS = new Set([
  "the",
  "and",
  "with",
  "for",
  "from",
  "her",
  "his",
  "your",
  "one",
  "pair",
  "piece",
  "item",
  "women",
  "womens",
  "mens",
  "men",
  "size",
  "new",
]);

function significantWords(label: string): string[] {
  return [
    ...new Set(
      label
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length >= 3 && !UNDISTINGUISHING_WORDS.has(word))
    ),
  ];
}

/**
 * Whether a sentence is talking about this item.
 *
 * Two agreeing words, because one is routinely a coincidence — a sentence about a
 * black belt should not be deleted for describing "black" trousers — and because
 * the model rarely quotes a label verbatim ("the brown wedge sandals" for
 * `brown · platform wedge sandals`), so exact substring matching finds nothing.
 * A single-word label has nothing else to agree with and matches on its own.
 */
function sentenceMentions(sentence: string, itemLabel: string): boolean {
  const words = significantWords(itemLabel);
  if (words.length === 0) return false;
  const text = sentence.toLowerCase();
  const hits = words.filter((word) => new RegExp(`\\b${word}s?\\b`).test(text)).length;
  return hits >= Math.min(2, words.length);
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/** "a", "a and b", "a, b and c", "a, b and 2 more". */
function listLabels(labels: string[]): string {
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  const shown = labels.slice(0, 3);
  const rest = labels.length - shown.length;
  const tail = rest > 0 ? `${rest} more` : shown.pop()!;
  return `${shown.join(", ")} and ${tail}`;
}

function difference(from: string[], to: string[]): string[] {
  const present = new Set(to);
  return from.filter((itemId) => !present.has(itemId));
}

function sameSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const leftIds = new Set(left);
  return leftIds.size === right.length && right.every((id) => leftIds.has(id));
}

/**
 * The transition sentence, from what actually differs between two segments.
 * Exported for the single-segment redo, which rewrites one segment between two it
 * is not allowed to touch.
 */
export function describeTransition(
  previousItemIds: string[],
  itemIds: string[],
  labelFor: (itemId: string) => string
): string | undefined {
  const removed = difference(previousItemIds, itemIds).map(labelFor);
  const added = difference(itemIds, previousItemIds).map(labelFor);

  // Listing both halves of a head-to-toe change reads as a paragraph of nouns, and
  // the interesting half is what is being put on. Transit and sport segments are
  // full changes by design, so this is the common case, not the edge one.
  if (removed.length > 2 && added.length > 2) {
    return `A complete change of clothes: ${listLabels(added)}.`;
  }
  if (removed.length > 0 && added.length > 0) {
    return `Swapped ${listLabels(removed)} for ${listLabels(added)}.`;
  }
  if (added.length > 0) return `Same pieces, plus ${listLabels(added)}.`;
  if (removed.length > 0) return `Same pieces, without ${listLabels(removed)}.`;
  return undefined;
}

/**
 * Drop every sentence that describes a piece the segment no longer contains.
 *
 * Exported because the single-segment redo path rewrites one segment in place and
 * needs the same scrub without the surrounding day.
 */
export function scrubReasoning(
  reasoning: string,
  removedLabels: string[],
  fallback: () => string
): string {
  if (removedLabels.length === 0) return reasoning;

  const kept = splitSentences(reasoning).filter(
    (sentence) => !removedLabels.some((label) => sentenceMentions(sentence, label))
  );
  const result = kept.join(" ").trim();
  return result || fallback();
}

/** `originalItemIds` and `merged` are bookkeeping for this pass; they never persist. */
function stripInternals<T extends AlignableSegment>(segment: T): T {
  const copy = { ...segment };
  delete copy.originalItemIds;
  delete copy.merged;
  return copy;
}

/**
 * Make one day's segment text describe the segments as they will actually be
 * stored. Run this last — after every rule has been enforced and after adjacent
 * duplicates have been merged — so it sees the final item sets.
 */
export function alignSegmentText<T extends AlignableSegment>(
  segments: T[],
  labelFor: (itemId: string) => string
): T[] {
  return segments.map((segment, index) => {
    const original = segment.originalItemIds;
    const changedByRules = Boolean(original) && !sameSet(original!, segment.itemIds);
    const removedLabels = original
      ? difference(original, segment.itemIds).map(labelFor)
      : [];

    const reasoning = scrubReasoning(segment.reasoning, removedLabels, () =>
      `${listLabels(segment.itemIds.slice(0, 3).map(labelFor))} for ${segment.label}.`
    );

    // The first segment of a day has nothing to have changed from. A repair call
    // that rewrote the whole day happily filled this in with what it changed about
    // the previous *plan*, which reads to the user as a transition that never
    // happened.
    if (index === 0) {
      const first = stripInternals(segment);
      delete first.changeFromPrevious;
      return { ...first, reasoning };
    }

    const previous = segments[index - 1];
    // Keep the model's own wording only when nothing on either side moved: it says
    // *why* the change was made, which a diff can't. Otherwise it is describing a
    // pair of outfits that no longer exist.
    const stale =
      changedByRules ||
      previous.merged ||
      (previous.originalItemIds
        ? !sameSet(previous.originalItemIds, previous.itemIds)
        : false) ||
      !segment.changeFromPrevious;

    const changeFromPrevious = stale
      ? describeTransition(previous.itemIds, segment.itemIds, labelFor)
      : segment.changeFromPrevious;

    return { ...stripInternals(segment), reasoning, changeFromPrevious };
  });
}
