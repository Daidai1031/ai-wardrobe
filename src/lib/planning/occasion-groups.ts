/**
 * How many distinct looks a day actually needs, decided in TypeScript.
 *
 * Segment count used to be left entirely to the model ("merge adjacent occasions
 * of similar formality, split when meaningfully different"). That judgement turned
 * out to be unstable: the same day — a 9:45am board meeting (formality 4), a 3pm
 * client call (3) and an 8:15pm dinner (3) — sometimes came back correctly as
 * two segments and sometimes collapsed into one.
 *
 * Grouping consecutive occasions by formality is arithmetic, so it belongs here,
 * consistent with D8 and with `plan-rules.ts`. The model still decides the hard
 * part: what to actually wear for each group.
 */

/** Formality difference that forces a new look. 1 means 3 and 4 don't share an outfit. */
export const FORMALITY_BREAK = 1;

export interface GroupableOccasion {
  id: string;
  title: string;
  occasion: string;
  formality: number | null;
  time: string;
}

export interface OccasionGroup {
  /** Representative formality — the highest in the group, which is what to dress for. */
  formality: number | null;
  occasions: GroupableOccasion[];
}

/**
 * Consecutive occasions whose formality is close enough to wear one outfit for.
 *
 * An occasion with unknown formality joins whatever group is open rather than
 * forcing a split — missing data shouldn't manufacture an extra outfit change.
 */
export function groupOccasions(occasions: GroupableOccasion[]): OccasionGroup[] {
  const groups: OccasionGroup[] = [];

  for (const occasion of occasions) {
    const current = groups[groups.length - 1];

    if (!current) {
      groups.push({ formality: occasion.formality, occasions: [occasion] });
      continue;
    }

    const known = current.occasions
      .map((entry) => entry.formality)
      .filter((value): value is number => typeof value === "number");

    const breaksGroup =
      typeof occasion.formality === "number" &&
      known.length > 0 &&
      known.some((value) => Math.abs(value - occasion.formality!) >= FORMALITY_BREAK);

    if (breaksGroup) {
      groups.push({ formality: occasion.formality, occasions: [occasion] });
      continue;
    }

    current.occasions.push(occasion);
    if (typeof occasion.formality === "number") {
      current.formality = Math.max(current.formality ?? occasion.formality, occasion.formality);
    }
  }

  return groups;
}

/** The prompt-facing shape: exactly which segments to build, in order. */
export function describeGroups(groups: OccasionGroup[]) {
  return groups.map((group, index) => ({
    segment: index + 1,
    formality: group.formality,
    eventIds: group.occasions.map((occasion) => occasion.id),
    covers: group.occasions.map((occasion) => `${occasion.time} · ${occasion.title}`),
  }));
}
