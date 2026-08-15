import { describe, expect, it } from "vitest";
import { eventsOnLocalDay, localDayRangeUTC, type BucketableEvent } from "@/lib/calendar/day-bucket";

/**
 * The regressions these lock in are the ones CLAUDE.md records as live-verified on
 * 2026-07-30 against 8 real Google Calendar events. Both failure modes are silent —
 * an outfit is simply planned for the wrong day — so they are worth a test rather
 * than a second manual run:
 *
 *   1. a timed event that crosses the UTC date boundary must still land on the
 *      local day it happens on;
 *   2. an all-day event must NOT be run through timezone conversion, because
 *      Google's all-day dates have no real instant and converting shifts them onto
 *      the adjacent local day in every non-UTC zone.
 */

const NY = "America/New_York"; // UTC-4 in August (EDT)
const SHANGHAI = "Asia/Shanghai"; // UTC+8 year round

function timed(starts_at: string, ends_at: string): BucketableEvent {
  return { all_day: false, starts_at, ends_at };
}

function allDay(startDate: string, exclusiveEndDate: string): BucketableEvent {
  // Exactly how `/api/google/calendar/sync` encodes them: a timezone-agnostic
  // calendar date forced into a `timestamptz` column at midnight UTC.
  return {
    all_day: true,
    starts_at: `${startDate}T00:00:00Z`,
    ends_at: `${exclusiveEndDate}T00:00:00Z`,
  };
}

describe("localDayRangeUTC", () => {
  it("maps a local day to the UTC instants that actually bound it", () => {
    const { startUTC, endUTC } = localDayRangeUTC("2026-08-14", NY);
    expect(startUTC.toISOString()).toBe("2026-08-14T04:00:00.000Z");
    expect(endUTC.toISOString()).toBe("2026-08-15T04:00:00.000Z");
  });

  it("is not hardcoded to one zone", () => {
    const { startUTC } = localDayRangeUTC("2026-08-14", SHANGHAI);
    expect(startUTC.toISOString()).toBe("2026-08-13T16:00:00.000Z");
  });
});

describe("eventsOnLocalDay — timed events", () => {
  // The real test day: a 9:45am board meeting, a 3pm client call, and an 8:15pm
  // dinner. Only the dinner crosses into the next UTC calendar date.
  const morning = timed("2026-08-14T13:45:00Z", "2026-08-14T14:45:00Z"); // 9:45am EDT
  const afternoon = timed("2026-08-14T19:00:00Z", "2026-08-14T20:00:00Z"); // 3:00pm EDT
  const evening = timed("2026-08-15T00:15:00Z", "2026-08-15T01:15:00Z"); // 8:15pm EDT
  const day = [morning, afternoon, evening];

  it("puts all three occasions of one local day on that day", () => {
    expect(eventsOnLocalDay(day, "2026-08-14", NY)).toEqual([morning, afternoon, evening]);
  });

  it("does not leak the late event onto the next local day", () => {
    // This is the bug: the evening event's UTC date string is 2026-08-15, so any
    // implementation that slices the timestamp instead of converting it puts a
    // dinner outfit on Saturday.
    expect(evening.starts_at.slice(0, 10)).toBe("2026-08-15");
    expect(eventsOnLocalDay(day, "2026-08-15", NY)).toEqual([]);
  });

  it("buckets by the timezone it is given, not a fixed one", () => {
    // In Shanghai (UTC+8) the same three instants straddle a different boundary:
    // only the 9:45am EDT meeting is still Friday there; the 3pm call is 3am
    // Saturday and the 8:15pm dinner is 8:15am Saturday.
    expect(eventsOnLocalDay(day, "2026-08-14", SHANGHAI)).toEqual([morning]);
    expect(eventsOnLocalDay(day, "2026-08-15", SHANGHAI)).toEqual([afternoon, evening]);
  });

  it("puts a multi-day event on every local day it overlaps, not just its first", () => {
    const conference = timed("2026-08-14T13:00:00Z", "2026-08-16T13:00:00Z");
    const on = (date: string) => eventsOnLocalDay([conference], date, NY).length;

    expect(on("2026-08-13")).toBe(0);
    expect(on("2026-08-14")).toBe(1);
    expect(on("2026-08-15")).toBe(1); // no event boundary on this day at all
    expect(on("2026-08-16")).toBe(1);
    expect(on("2026-08-17")).toBe(0);
  });
});

describe("eventsOnLocalDay — all-day events", () => {
  // Google's all-day end date is exclusive: a two-day trip on the 14th and 15th
  // ends on the 16th.
  const trip = allDay("2026-08-14", "2026-08-16");

  it("covers every day of the trip and stops before the exclusive end", () => {
    expect(eventsOnLocalDay([trip], "2026-08-13", NY)).toEqual([]);
    expect(eventsOnLocalDay([trip], "2026-08-14", NY)).toEqual([trip]);
    expect(eventsOnLocalDay([trip], "2026-08-15", NY)).toEqual([trip]);
    expect(eventsOnLocalDay([trip], "2026-08-16", NY)).toEqual([]);
  });

  it("does not shift by timezone, in either direction", () => {
    // The whole reason all-day events bypass conversion. A UTC-behind zone would
    // pull the trip back a day and a UTC-ahead zone would push it forward, and
    // both are wrong: an all-day date has no instant to convert.
    for (const zone of [NY, SHANGHAI, "UTC", "Pacific/Auckland"]) {
      expect(eventsOnLocalDay([trip], "2026-08-14", zone)).toEqual([trip]);
      expect(eventsOnLocalDay([trip], "2026-08-13", zone)).toEqual([]);
      expect(eventsOnLocalDay([trip], "2026-08-16", zone)).toEqual([]);
    }
  });

  it("handles a single all-day event", () => {
    const holiday = allDay("2026-08-14", "2026-08-15");
    expect(eventsOnLocalDay([holiday], "2026-08-14", NY)).toEqual([holiday]);
    expect(eventsOnLocalDay([holiday], "2026-08-15", NY)).toEqual([]);
  });
});
