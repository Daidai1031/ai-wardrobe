/**
 * What the human stylist is allowed to know about the client's week (ROADMAP D13/D17).
 *
 * D13 makes raw calendar entries a hard boundary — titles routinely contain things
 * that have nothing to do with clothes and everything to do with privacy ("annual
 * physical", "interview · <company>", "meeting my lawyer"). D17 turns that boundary
 * into three levels:
 *
 *   L0  nothing (default). The stylist sees the closet and the saved Looks only.
 *   L1  `profiles.stylist_share_occasions` — per day: generalized wording, formality,
 *       and whatever outfit is already planned.
 *   L2  `calendar_events.stylist_share_detail` — that one event's time and raw title.
 *
 * The L1 wording is assembled from two enums (`occasion` + `companion`) through the
 * lookup tables below. It never passes through the event title, so it *structurally*
 * cannot leak a name — as opposed to asking a model to redact the title, which works
 * until the one time it doesn't. For the same reason `outfit_plan_segments.label` and
 * `.reasoning` are never projected: Haiku wrote those from the title and will happily
 * say "for your meeting with Sarah".
 *
 * Everything here runs server-side against the service-role client, because the
 * stylist has no RLS access to calendar_events or the plan tables at all (schema 18b
 * is a whitelist). Only the projected shape crosses to her browser.
 */

import { eventsOnLocalDay, type BucketableEvent } from "@/lib/calendar/day-bucket";
import { createServiceSupabase } from "@/lib/supabase/service";

/**
 * Display wording per occasion. A fixed table rather than humanizing the stored
 * string: `occasion` is free-form snake_case chosen by the model, so echoing an
 * unrecognized value would reintroduce exactly the "model-authored text reaches the
 * stylist" risk this module exists to remove. Unknown values fall back to formality.
 */
const OCCASION_LABELS: Record<string, string> = {
  board_meeting: "A board meeting",
  meeting: "A meeting",
  client_meeting: "A client meeting",
  client_call: "A client call",
  client_dinner: "A client dinner",
  presentation: "A presentation",
  interview: "An interview",
  conference: "A conference day",
  networking_event: "A networking event",
  work: "A work day",
  office: "A day in the office",
  casual: "Something casual",
  errands: "Errands",
  brunch: "Brunch",
  lunch: "Lunch",
  dinner: "Dinner",
  coffee: "Coffee",
  drinks: "Drinks",
  party: "A party",
  date_night: "A date night",
  wedding: "A wedding",
  formal: "A formal event",
  gala: "A gala",
  concert: "A concert",
  theater: "A night at the theater",
  museum: "A museum visit",
  gym: "A gym session",
  workout: "A workout",
  yoga: "A yoga class",
  run: "A run",
  hike: "A hike",
  travel: "A travel day",
  flight: "A flight",
  commute: "Commuting",
  doctor_appointment: "An appointment",
  appointment: "An appointment",
  class: "A class",
  study: "Study time",
  volunteering: "Volunteering",
  family_event: "A family gathering",
  birthday: "A birthday",
  funeral: "A funeral",
  religious_service: "A religious service",
  photoshoot: "A photoshoot",
  unknown: "Something on the calendar",
};

/**
 * The trailing "who with" clause. `solo` contributes nothing rather than an awkward
 * "on their own" after every gym session; `unknown` is the deliberately vague phrasing
 * the client asked for — better to say "with someone" than to guess.
 */
const COMPANION_CLAUSES: Record<string, string> = {
  colleague: "with colleagues",
  client: "with a client",
  friend: "with friends",
  family: "with family",
  partner: "with their partner",
  professional: "with a professional",
  solo: "",
  unknown: "with someone",
};

function formalityFallback(formality: number | null): string {
  if (formality === null) return "Something on the calendar";
  if (formality <= 2) return "Something casual";
  if (formality === 3) return "A smart-casual engagement";
  if (formality === 4) return "A formal engagement";
  return "A black-tie event";
}

/** The one place an occasion + companion pair becomes words the stylist reads. */
export function describeOccasion(
  occasion: string | null,
  companion: string | null,
  formality: number | null
): string {
  const base =
    (occasion && OCCASION_LABELS[occasion]) ||
    formalityFallback(formality);
  const clause = COMPANION_CLAUSES[companion ?? "unknown"] ?? COMPANION_CLAUSES.unknown;
  return clause ? `${base} ${clause}` : base;
}

export interface StylistOccasion {
  id: string;
  description: string;
  formality: number | null;
  /** L2 only — present exactly when the client opted this single event in. */
  detail: { title: string | null; timeLabel: string } | null;
}

export interface StylistPlannedSegment {
  /** The review target id. */
  id: string;
  /** Derived from the segment's events, never from the model-written label (D17). */
  name: string;
  items: { itemId: string; x: number | null; y: number | null; width: number | null }[];
}

export interface StylistOccasionDay {
  date: string;
  occasions: StylistOccasion[];
  segments: StylistPlannedSegment[];
}

export interface StylistOccasionProjection {
  /**
   * False when the client hasn't switched L1 on. It gates the `occasions` lists only —
   * `segments` are populated either way, because a planned outfit is wardrobe data, not
   * calendar data. Hiding "what you're planning to wear Thursday" behind the calendar
   * switch conflated the two and left the stylist unable to review the very thing the
   * feature exists for.
   */
  occasionsShared: boolean;
  timeZone: string;
  days: StylistOccasionDay[];
}

interface CalendarRow extends BucketableEvent {
  id: string;
  title: string | null;
  occasion: string | null;
  formality: number | null;
  companion: string | null;
  stylist_share_detail: boolean;
}

function localDates(count: number, timeZone: string): string[] {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const today = new Date();
  return Array.from({ length: count }, (_, offset) =>
    formatter.format(new Date(today.getTime() + offset * 24 * 60 * 60 * 1000))
  );
}

function timeLabel(event: CalendarRow, timeZone: string): string {
  if (event.all_day) return "All day";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(event.starts_at));
}

/**
 * The next `days` local days for one client: always the planned looks, plus the
 * generalized occasions when the client has shared them. When L1 is off the calendar is
 * not read at all — not read and then filtered, actually not queried.
 */
export async function projectOccasionsForStylist(
  clientId: string,
  days = 7
): Promise<StylistOccasionProjection> {
  const supabase = createServiceSupabase();

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone, stylist_share_occasions")
    .eq("id", clientId)
    .maybeSingle();

  const timeZone = profile?.timezone || "UTC";
  const occasionsShared = Boolean(profile?.stylist_share_occasions);

  const dates = localDates(days, timeZone);
  // A generous UTC window around the local range; day-bucket does the precise work.
  const windowStart = new Date(`${dates[0]}T00:00:00Z`);
  windowStart.setUTCDate(windowStart.getUTCDate() - 1);
  const windowEnd = new Date(`${dates[dates.length - 1]}T00:00:00Z`);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + 2);

  const [{ data: eventRows }, { data: planRows }] = await Promise.all([
    occasionsShared
      ? supabase
          .from("calendar_events")
          .select(
            "id, title, starts_at, ends_at, all_day, occasion, formality, companion, stylist_share_detail"
          )
          .eq("user_id", clientId)
          .gte("starts_at", windowStart.toISOString())
          .lte("starts_at", windowEnd.toISOString())
      : Promise.resolve({ data: [] as CalendarRow[] }),
    supabase
      .from("outfit_plans")
      .select("id, plan_date")
      .eq("user_id", clientId)
      .in("plan_date", dates)
      .is("travel_plan_id", null),
  ]);

  const events = (eventRows ?? []) as CalendarRow[];
  const plans = planRows ?? [];

  let segments: {
    id: string;
    outfit_plan_id: string;
    position: number;
    event_ids: string[] | null;
  }[] = [];
  let segmentItems: {
    segment_id: string;
    item_id: string;
    position: number;
    x: number | null;
    y: number | null;
    width: number | null;
  }[] = [];

  if (plans.length > 0) {
    // label and reasoning are deliberately not selected — see the module header.
    const { data: segmentRows } = await supabase
      .from("outfit_plan_segments")
      .select("id, outfit_plan_id, position, event_ids")
      .in(
        "outfit_plan_id",
        plans.map((plan) => plan.id)
      )
      .order("position");
    segments = segmentRows ?? [];

    if (segments.length > 0) {
      const { data: itemRows } = await supabase
        .from("outfit_plan_segment_items")
        .select("segment_id, item_id, position, x, y, width")
        .in(
          "segment_id",
          segments.map((segment) => segment.id)
        )
        .order("position");
      segmentItems = itemRows ?? [];
    }
  }

  const eventsById = new Map(events.map((event) => [event.id, event]));
  const planIdByDate = new Map(plans.map((plan) => [plan.plan_date as string, plan.id as string]));

  return {
    occasionsShared,
    timeZone,
    days: dates.map((date) => {
      const dayEvents = eventsOnLocalDay(events, date, timeZone);

      const planId = planIdByDate.get(date);
      const daySegments = planId
        ? segments.filter((segment) => segment.outfit_plan_id === planId)
        : [];

      return {
        date,
        occasions: dayEvents.map((event) => ({
          id: event.id,
          description: describeOccasion(event.occasion, event.companion, event.formality),
          formality: event.formality,
          detail: event.stylist_share_detail
            ? { title: event.title, timeLabel: timeLabel(event, timeZone) }
            : null,
        })),
        segments: daySegments.map((segment, index) => {
          // Name the look after the occasions it was planned for; fall back to a
          // position label. This is the reason event_ids is fetched at all.
          const linked = (segment.event_ids ?? [])
            .map((id) => eventsById.get(id))
            .filter((event): event is CalendarRow => Boolean(event));
          // With occasions shared this reads "A client dinner with a client"; without,
          // it degrades to a position label rather than leaking the segment's own
          // model-written label (D17).
          const name =
            linked.length > 0
              ? linked
                  .map((event) =>
                    describeOccasion(event.occasion, event.companion, event.formality)
                  )
                  .join(" · ")
              : `Look ${index + 1}`;

          return {
            id: segment.id,
            name,
            items: segmentItems
              .filter((item) => item.segment_id === segment.id)
              .sort((a, b) => a.position - b.position)
              .map((item) => ({
                itemId: item.item_id,
                x: item.x,
                y: item.y,
                width: item.width,
              })),
          };
        }),
      };
    }),
  };
}
