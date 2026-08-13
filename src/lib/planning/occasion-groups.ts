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

/**
 * What an occasion is, when that alone decides you can't wear the same clothes as
 * the occasion before it. Formality distance is a spectrum and merges things that
 * are merely close; these are not on that spectrum at all.
 *
 * - `transit`: hours spent getting somewhere. Dressed for the journey, not the
 *   destination, however formal the destination is.
 * - `athletic`: sport or a workout. Dressed to move in, and — the reason it can't
 *   just be a low formality — you sweat in it, so nothing worn here can come back
 *   later in the day.
 * - `general`: everything else, grouped by formality as before.
 */
export type OccasionKind = "transit" | "athletic" | "general";

/**
 * However formal the surrounding day is, these are dressed for the activity. A
 * flight rated 4 because it belongs to a business trip, or golf at a private club
 * rated 4 because the club is formal, would otherwise pull the segment up to
 * boardroom tailoring.
 */
export const MAX_FORMALITY_BY_KIND: Partial<Record<OccasionKind, number>> = {
  transit: 2,
  athletic: 2,
};

/**
 * Time spent getting somewhere. The classifier's label and the user's own event
 * title are checked separately, because neither is reliable alone and they fail in
 * opposite directions.
 *
 * `occasion` is a deliberate one-word answer to "what kind of event is this", so a
 * bare `travel` or `train` there means the journey. A title is prose, where the
 * same bare words are ambiguous — "Travel budget review" and "Train the new hire"
 * are meetings — so titles only match phrasings that can't be anything else.
 */
const TRANSIT_OCCASION_PATTERNS = [
  /\bflights?\b/,
  /\bflying\b/,
  /\bairports?\b/,
  /\bdepart(?:s|ed|ing|ure|ures)?\b/,
  /\blayover\b/,
  /\bred[\s-]?eye\b/,
  /\btrains?\b/,
  /\brailway\b/,
  /\bcommut(?:e|es|ing)\b/,
  /\btransit\b/,
  /\btravel(?:s|ing|ling)?\b/,
  /\bdriv(?:e|ing)\b/,
  /\broad trip\b/,
];

const TRANSIT_TITLE_PATTERNS = [
  /\bflights?\b/,
  /\bflying to\b/,
  /\bairports?\b/,
  /\bdepart(?:s|ed|ing|ure|ures)?\b/,
  /\bboarding\b/,
  /\blayover\b/,
  /\bred[\s-]?eye\b/,
  /\btrain (?:to|from|back)\b/,
  /\bby train\b/,
  /\btrain station\b/,
  /\bcommut(?:e|es|ing)\b/,
  /\bin transit\b/,
  /\btravel(?:ing|ling) to\b/,
  /\btravel to\b/,
  /\btravel day\b/,
  /\bdrive to\b/,
  /\broad trip\b/,
];

/**
 * Sport and exercise, split the same two ways and for the same reason. Golf and
 * tennis matter most here: they are the ones a classifier is most likely to rate
 * as formal, because they happen at clubs, with clients, in the middle of a
 * working day.
 */
const ATHLETIC_OCCASION_PATTERNS = [
  /\bgym\b/,
  /\bworkouts?\b/,
  /\bexercise\b/,
  /\btraining\b/,
  /\bfitness\b/,
  /\bsports?\b/,
  /\bathletics?\b/,
  /\btennis\b/,
  /\bgolf\b/,
  /\bpickleball\b/,
  /\bsquash\b/,
  /\byoga\b/,
  /\bpilates\b/,
  /\bbarre\b/,
  /\bspin\b/,
  /\bcrossfit\b/,
  /\bruns?\b/,
  /\brunning\b/,
  /\bjog(?:ging)?\b/,
  /\bswim(?:ming)?\b/,
  /\bhik(?:e|ing)\b/,
  /\bcycling\b/,
  /\bsoccer\b/,
  /\bbasketball\b/,
  /\bclimbing\b/,
  /\bski(?:ing)?\b/,
  /\bboxing\b/,
];

const ATHLETIC_TITLE_PATTERNS = [
  /\bgym\b/,
  /\bworkouts?\b/,
  /\bwork out\b/,
  /\btennis\b/,
  /\bgolf\b/,
  /\bpickleball\b/,
  /\bsquash court\b/,
  /\byoga\b/,
  /\bpilates\b/,
  /\bbarre class\b/,
  /\bspin class\b/,
  /\bcrossfit\b/,
  /\bpeloton\b/,
  /\bpersonal training\b/,
  /\b(?:morning|evening|trail|long) run\b/,
  /\brun club\b/,
  /\b\d+ ?k run\b/,
  /\bjog(?:ging)?\b/,
  /\bswim(?:ming)?\b/,
  /\bhik(?:e|ing)\b/,
  /\bcycling\b/,
  /\bbike ride\b/,
  /\bsoccer\b/,
  /\bbasketball\b/,
  /\bmarathon\b/,
  /\bclimbing\b/,
  /\bski(?:ing)?\b/,
  /\bboxing\b/,
];

function normalizeForMatching(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[_-]+/g, " ");
}

/**
 * What kind of occasion this is, for segmentation purposes.
 *
 * All-day events are deliberately never `transit`. "Business Trip (London)" is a
 * container spanning every hour of the day — meetings included — and it matches
 * `travel`/`trip` wording, so treating it as transit would dress a whole workday
 * for a plane. What counts is the timed event that *is* the journey. All-day
 * `athletic` is left alone, because an all-day "Golf Tournament" really is a day
 * of sport rather than a container around one.
 *
 * `athletic` is checked first: an event that is somehow both (a run to the train)
 * still has to be dressed to sweat in and changed out of afterwards, which is the
 * stricter of the two.
 */
export function occasionKind(occasion: {
  occasion?: string | null;
  title?: string | null;
  allDay?: boolean;
}): OccasionKind {
  const label = normalizeForMatching(occasion.occasion);
  const title = normalizeForMatching(occasion.title);

  if (
    ATHLETIC_OCCASION_PATTERNS.some((pattern) => pattern.test(label)) ||
    ATHLETIC_TITLE_PATTERNS.some((pattern) => pattern.test(title))
  ) {
    return "athletic";
  }

  if (
    !occasion.allDay &&
    (TRANSIT_OCCASION_PATTERNS.some((pattern) => pattern.test(label)) ||
      TRANSIT_TITLE_PATTERNS.some((pattern) => pattern.test(title)))
  ) {
    return "transit";
  }

  return "general";
}

export interface GroupableOccasion {
  id: string;
  title: string;
  occasion: string;
  formality: number | null;
  time: string;
  allDay?: boolean;
  location?: string | null;
  weatherCity?: string | null;
}

export interface OccasionGroup {
  /** Representative formality — the highest in the group, which is what to dress for. */
  formality: number | null;
  /** What this group is. Anything but `general` is dressed for the activity, not the formality. */
  kind: OccasionKind;
  occasions: GroupableOccasion[];
}

/** The formality to dress a finished group for, capped for the kinds that have a ceiling. */
function groupFormality(formality: number | null, kind: OccasionKind): number | null {
  if (formality == null) return null;
  const ceiling = MAX_FORMALITY_BY_KIND[kind];
  return ceiling === undefined ? formality : Math.min(formality, ceiling);
}

/**
 * Consecutive occasions whose formality is close enough to wear one outfit for.
 *
 * An occasion with unknown formality joins whatever group is open rather than
 * forcing a split — missing data shouldn't manufacture an extra outfit change.
 *
 * A change of `kind` splits a group regardless of formality, and it is the only
 * thing besides formality that does. A 5pm departure and an 8:30pm flight came
 * back classified at the same formality as that morning's meeting, so the
 * arithmetic saw one continuous block and the day was planned in tailoring and
 * heels all the way onto an overnight flight; tennis and golf fail the same way,
 * and worse, because a client match at a club reads as formal to the classifier.
 * Whether you are on a plane or on a court is not a matter of degree, so it is
 * not left to the formality distance.
 */
export function groupOccasions(occasions: GroupableOccasion[]): OccasionGroup[] {
  const groups: OccasionGroup[] = [];

  for (const occasion of occasions) {
    const current = groups[groups.length - 1];
    const kind = occasionKind(occasion);

    if (!current) {
      groups.push({
        formality: groupFormality(occasion.formality, kind),
        kind,
        occasions: [occasion],
      });
      continue;
    }

    const known = current.occasions
      .map((entry) => entry.formality)
      .filter((value): value is number => typeof value === "number");

    const breaksGroup =
      current.kind !== kind ||
      // Two athletic occasions never share a segment either, unlike two transit
      // ones. You don't change between the taxi and the plane, but you do change
      // between a round of golf and a tennis match — each is its own sweat and,
      // usually, its own kit. Back-to-back entries for a single session ("warmup"
      // then "match") are the cost, and the sweat rule would separate their
      // outfits anyway.
      kind === "athletic" ||
      (typeof occasion.formality === "number" &&
        known.length > 0 &&
        known.some((value) => Math.abs(value - occasion.formality!) >= FORMALITY_BREAK));

    if (breaksGroup) {
      groups.push({
        formality: groupFormality(occasion.formality, kind),
        kind,
        occasions: [occasion],
      });
      continue;
    }

    current.occasions.push(occasion);
    if (typeof occasion.formality === "number") {
      current.formality = groupFormality(
        Math.max(current.formality ?? occasion.formality, occasion.formality),
        current.kind
      );
    }
  }

  return groups;
}

/** The prompt-facing shape: exactly which segments to build, in order. */
export function describeGroups(groups: OccasionGroup[]) {
  return groups.map((group, index) => ({
    segment: index + 1,
    formality: group.formality,
    kind: group.kind,
    eventIds: group.occasions.map((occasion) => occasion.id),
    covers: group.occasions.map((occasion) => `${occasion.time} · ${occasion.title}`),
    locations: [
      ...new Set(
        group.occasions
          .map((occasion) => occasion.location || occasion.weatherCity)
          .filter((location): location is string => Boolean(location))
      ),
    ],
  }));
}
