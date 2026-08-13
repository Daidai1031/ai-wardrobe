/**
 * The three fields bucketing actually reads. Generic over this rather than fixed to
 * `CalendarEvent` so a caller that selected a narrower column set — the stylist
 * occasion projection deliberately never selects `label`-adjacent fields — can still
 * use it and get its own row type back.
 */
export interface BucketableEvent {
  all_day: boolean;
  starts_at: string;
  ends_at: string | null;
}

/**
 * The one place daily AND weekly planning ask "what's on the calendar for this local
 * day" (ROADMAP D4). Two things make this non-trivial enough to be worth sharing
 * instead of each caller re-deriving it:
 *
 * 1. Timezone: `calendar_events.starts_at`/`ends_at` are UTC instants. An event near a
 *    day boundary (e.g. 8:15pm US Eastern) is stored as the *next* UTC calendar date
 *    and must be converted back through the location's IANA timezone to land on the
 *    correct local day — naively slicing the UTC date string is wrong.
 * 2. Multi-day events: an event belongs to a local day if its interval *overlaps* that
 *    day, not just if it starts on it — a 3-day trip must show up on all 3 days.
 *
 * All-day events are a special case of both: Google's all-day dates are timezone-agnostic
 * calendar dates (no real instant), which `/api/google/calendar/sync` encodes as
 * `<date>T00:00:00Z` purely to fit the `timestamptz` column — running that encoding back
 * through `timeZone` would incorrectly shift it onto the previous/next local day in any
 * non-UTC zone. So all-day events are compared by their UTC date components directly,
 * bypassing timezone conversion entirely; only timed events go through it.
 */

/** Adds `days` (may be negative) to a "YYYY-MM-DD" string, handling month/year rollover. */
function addDays(localDate: string, days: number): string {
  const [y, m, d] = localDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * How far `timeZone`'s local wall clock is ahead of UTC, in minutes, at the given
 * instant (e.g. +480 for Asia/Shanghai's fixed UTC+8, -240 for America/New_York in EDT).
 */
function getTimeZoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return (asUTC - instant.getTime()) / 60_000;
}

/**
 * The UTC instant of local midnight for `localDate` ("YYYY-MM-DD") in `timeZone`.
 * Single-correction pass — accurate for real-world IANA zones since DST transitions
 * happen in the small hours, never at midnight, so one offset lookup near midnight is
 * enough; not guaranteed correct for a hypothetical zone that transitions exactly then.
 */
function zonedMidnightToUTC(localDate: string, timeZone: string): Date {
  const [y, m, d] = localDate.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  const offsetMinutes = getTimeZoneOffsetMinutes(new Date(guess), timeZone);
  return new Date(guess - offsetMinutes * 60_000);
}

/** The [start, end) UTC instant range covering local day `localDate` in `timeZone`. */
export function localDayRangeUTC(localDate: string, timeZone: string): { startUTC: Date; endUTC: Date } {
  return {
    startUTC: zonedMidnightToUTC(localDate, timeZone),
    endUTC: zonedMidnightToUTC(addDays(localDate, 1), timeZone),
  };
}

/**
 * Filters `events` down to whichever ones occur on local calendar day `localDate` in
 * `timeZone` — the single function daily/weekly planning should call, once per day
 * they're building a plan for, over an already-fetched batch of events (fetch once for
 * the week, call this per day, rather than re-querying Supabase per day).
 */
export function eventsOnLocalDay<T extends BucketableEvent>(
  events: T[],
  localDate: string,
  timeZone: string
): T[] {
  const { startUTC, endUTC } = localDayRangeUTC(localDate, timeZone);

  return events.filter((event) => {
    if (event.all_day) {
      const startDate = event.starts_at.slice(0, 10);
      const endDate = (event.ends_at ?? event.starts_at).slice(0, 10); // exclusive, per Google's all-day convention
      return startDate <= localDate && localDate < endDate;
    }

    const start = new Date(event.starts_at);
    const end = new Date(event.ends_at ?? event.starts_at);
    return start < endUTC && end > startUTC; // interval overlap, not "starts within"
  });
}
