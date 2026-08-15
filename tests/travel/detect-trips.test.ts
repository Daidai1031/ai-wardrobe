import { describe, expect, it } from "vitest";
import { detectTrips, suggestionsForTrips, tripSignature, type HomeLocation } from "@/lib/travel/detect-trips";
import type { CalendarEvent } from "@/types/database";
import type { TripDecision } from "@/types/travel";

/**
 * Trip detection is a pure function of the calendar (D8), which is the only reason
 * it can be tested at all — and the reason it has to be: a model asked "how many
 * trips are in this calendar" answered differently on consecutive runs, which would
 * re-key every stored trip and strand its packing list.
 *
 * The two adjacency cases below are the ones that actually shipped wrong. A
 * Hamptons weekend and a London week bridged into one 8-day "Hamptons" trip planned
 * against the wrong city's weather; and, in the other direction, one real calendar
 * geocoded the same word "Hamptons" to East Hampton NY on one event and Auburndale,
 * Florida on another, which a coordinate-first comparison would split in two.
 */

const HOME_TZ = "America/New_York";
const NYC: HomeLocation = { city: "New York", lat: 40.7128, lng: -74.006, timezone: HOME_TZ };
const NO_HOME: HomeLocation = { city: null, lat: null, lng: null, timezone: HOME_TZ };

const LONDON = { lat: 51.5074, lng: -0.1278 };
const WESTMINSTER = { lat: 51.4975, lng: -0.1357 }; // ~1km from London: the same week
const EAST_HAMPTON = { lat: 40.9634, lng: -72.1848 }; // ~155km from home: away
const AUBURNDALE_FL = { lat: 28.0653, lng: -81.7887 }; // the bad geocode of "Hamptons"
const BOSTON = { lat: 42.3601, lng: -71.0589 };
const JFK = { lat: 40.6413, lng: -73.7781 }; // ~21km from home: NOT away

let sequence = 0;

interface EventSpec {
  title: string;
  /** Local date for a timed event; midday UTC keeps it clear of any boundary. */
  date?: string;
  allDay?: { from: string; toExclusive: string };
  at?: { lat: number; lng: number };
  city?: string;
  occasion?: string;
  formality?: number;
  /** For the one case that has to sit near a day boundary. */
  startsAt?: string;
}

function event(spec: EventSpec): CalendarEvent {
  sequence += 1;
  const id = `ev-${sequence}`;
  const starts_at =
    spec.startsAt ??
    (spec.allDay ? `${spec.allDay.from}T00:00:00Z` : `${spec.date}T15:00:00Z`);
  const ends_at = spec.allDay
    ? `${spec.allDay.toExclusive}T00:00:00Z`
    : spec.startsAt
      ? new Date(new Date(spec.startsAt).getTime() + 2 * 3600_000).toISOString()
      : `${spec.date}T17:00:00Z`;

  return {
    id,
    user_id: "user-1",
    google_event_id: `g-${id}`,
    title: spec.title,
    location: spec.city ?? null,
    location_override: null,
    weather_city: spec.city ?? null,
    weather_lat: spec.at?.lat ?? null,
    weather_lng: spec.at?.lng ?? null,
    weather_timezone: null,
    weather_city_override: null,
    weather_lat_override: null,
    weather_lng_override: null,
    weather_timezone_override: null,
    weather_location_resolved: true,
    starts_at,
    ends_at,
    all_day: Boolean(spec.allDay),
    attendee_count: 2,
    occasion: spec.occasion ?? "meeting",
    formality: spec.formality ?? 3,
    companion: "colleague",
    stylist_share_detail: false,
    synced_at: "2026-08-14T00:00:00Z",
  };
}

const WINDOW = { start: "2026-09-01", end: "2026-09-30" };

function detect(events: CalendarEvent[], home: HomeLocation = NYC, decisions: TripDecision[] = []) {
  return detectTrips(events, home, HOME_TZ, WINDOW.start, WINDOW.end, decisions);
}

// ── The basic shapes ────────────────────────────────────────────────────────

describe("detectTrips", () => {
  it("finds nothing in a calendar spent at home", () => {
    const events = [
      event({ title: "Team standup", date: "2026-09-02" }),
      event({ title: "Dentist", date: "2026-09-03", at: JFK, city: "New York" }),
      event({ title: "Dinner with Sam", date: "2026-09-04" }),
    ];
    expect(detect(events)).toEqual([]);
  });

  it("treats one day in another city as an errand, not a trip", () => {
    const events = [event({ title: "Boston office check-in", date: "2026-09-20", at: BOSTON, city: "Boston" })];
    expect(detect(events)).toEqual([]);
  });

  it("finds a business trip and absorbs the flights either side of it", () => {
    const events = [
      // Geocoded to the *home* airport, which is exactly what a departure is.
      event({ title: "Depart for JFK", startsAt: "2026-09-01T21:00:00Z", at: JFK, city: "New York", occasion: "travel", formality: 2 }),
      event({ title: "Client meeting", date: "2026-09-02", at: LONDON, city: "London", formality: 4 }),
      event({ title: "Team dinner", date: "2026-09-03", at: LONDON, city: "London", occasion: "client_dinner", formality: 3 }),
      event({ title: "Flight home", date: "2026-09-04", occasion: "flight", formality: 2 }),
    ];

    const [trip, ...rest] = detect(events);
    expect(rest).toEqual([]);
    expect(trip).toMatchObject({
      destination: "London",
      startDate: "2026-09-01", // the departure day, though the flight leaves from home
      endDate: "2026-09-04",
      tripType: "business",
      signature: "2026-09-01|london",
    });
    expect(trip.dates).toHaveLength(4);
    expect(trip.destinationLat).toBeCloseTo(LONDON.lat, 3);
  });

  it("believes a title that states the destination, with no coordinates at all", () => {
    const events = [event({ title: "Vacation: Hamptons", allDay: { from: "2026-09-10", toExclusive: "2026-09-13" } })];

    const [trip] = detect(events);
    expect(trip).toMatchObject({
      destination: "Hamptons",
      startDate: "2026-09-10",
      endDate: "2026-09-12", // the all-day end date is exclusive
      tripType: "leisure",
    });
    expect(trip.typeReason).toContain("Vacation: Hamptons");
  });

  it("bridges a day with nothing on the calendar", () => {
    const events = [
      event({ title: "Kickoff", date: "2026-09-02", at: LONDON, city: "London" }),
      // 2026-09-03 is empty; still London.
      event({ title: "Wrap-up", date: "2026-09-04", at: LONDON, city: "London" }),
    ];

    const [trip, ...rest] = detect(events);
    expect(rest).toEqual([]);
    expect(trip.dates).toEqual(["2026-09-02", "2026-09-03", "2026-09-04"]);
  });

  it("needs a home to compare against before a located event reads as away", () => {
    const events = [
      event({ title: "Kickoff", date: "2026-09-02", at: LONDON, city: "London" }),
      event({ title: "Wrap-up", date: "2026-09-03", at: LONDON, city: "London" }),
      event({ title: "Business Trip (Chicago)", allDay: { from: "2026-09-10", toExclusive: "2026-09-13" } }),
    ];

    // Without home coordinates every located event would read as a trip, so only
    // the stated one counts.
    const trips = detect(events, NO_HOME);
    expect(trips.map((trip) => trip.destination)).toEqual(["Chicago"]);
    expect(trips[0].tripType).toBe("business");
  });

  it("clips a trip to the planning window", () => {
    const events = [
      event({ title: "Kickoff", date: "2026-08-30", at: LONDON, city: "London" }),
      event({ title: "Wrap-up", date: "2026-09-02", at: LONDON, city: "London" }),
    ];

    const [trip] = detect(events);
    expect(trip.startDate).toBe(WINDOW.start);
    expect(trip.endDate).toBe("2026-09-02");
  });
});

// ── Where one trip ends and the next begins ─────────────────────────────────

describe("trip boundaries", () => {
  const hamptonsThenLondon = () => [
    event({ title: "Vacation: Hamptons", allDay: { from: "2026-09-10", toExclusive: "2026-09-13" } }),
    event({ title: "Client kickoff", date: "2026-09-13", at: LONDON, city: "London", formality: 4 }),
    event({ title: "Workshop", date: "2026-09-14", at: LONDON, city: "London", formality: 4 }),
    event({ title: "Review", date: "2026-09-15", at: LONDON, city: "London", formality: 4 }),
  ];

  it("ends a run when the destination changes, however well the dates bridge", () => {
    const trips = detect(hamptonsThenLondon());

    expect(trips.map((trip) => trip.destination)).toEqual(["Hamptons", "London"]);
    expect(trips[0]).toMatchObject({ startDate: "2026-09-10", endDate: "2026-09-12", tripType: "leisure" });
    expect(trips[1]).toMatchObject({ startDate: "2026-09-13", endDate: "2026-09-15", tripType: "business" });
  });

  it("never lets two trips claim the same date", () => {
    // A date has exactly one plan, so two trips holding one date would each try to
    // plan it. The day you leave belongs to where you are going.
    const overlapping = [
      event({ title: "Vacation: Hamptons", allDay: { from: "2026-09-10", toExclusive: "2026-09-15" } }),
      event({ title: "Client kickoff", date: "2026-09-13", at: LONDON, city: "London" }),
      event({ title: "Workshop", date: "2026-09-14", at: LONDON, city: "London" }),
      event({ title: "Review", date: "2026-09-15", at: LONDON, city: "London" }),
    ];

    const trips = detect(overlapping);
    const claimed = trips.flatMap((trip) => trip.dates);
    expect(new Set(claimed).size).toBe(claimed.length);
    expect(trips[0].endDate).toBe("2026-09-12");
    expect(trips[1].startDate).toBe("2026-09-13");
  });

  it("compares the name before the coordinates, so one word geocoded twice stays one trip", () => {
    // The real failure: the same "Hamptons" resolved to New York on one event and
    // to Florida on another. Coordinate-first would call this two trips.
    const events = [
      event({ title: "Beach day", date: "2026-09-10", at: EAST_HAMPTON, city: "Hamptons" }),
      event({ title: "Dinner", date: "2026-09-11", at: AUBURNDALE_FL, city: "Hamptons" }),
    ];

    const trips = detect(events);
    expect(trips).toHaveLength(1);
    expect(trips[0].dates).toEqual(["2026-09-10", "2026-09-11"]);
  });

  it("uses the coordinates when the names differ but the place does not", () => {
    // "London" and "Westminster" are different words for the same week, which the
    // 120km radius absorbs.
    const events = [
      event({ title: "Kickoff", date: "2026-09-02", at: LONDON, city: "London" }),
      event({ title: "Committee", date: "2026-09-03", at: WESTMINSTER, city: "Westminster" }),
    ];

    const trips = detect(events);
    expect(trips).toHaveLength(1);
    expect(trips[0].cities).toEqual(["London", "Westminster"]);
  });
});

// ── The signature, which the stored row is keyed on ─────────────────────────

describe("tripSignature", () => {
  it("normalizes the destination so casing and spacing cannot fork a row", () => {
    expect(tripSignature("2026-09-01", "  New   York ")).toBe(tripSignature("2026-09-01", "new york"));
  });

  it("survives the trip gaining a meeting or losing a day", () => {
    const base = [
      event({ title: "Kickoff", date: "2026-09-02", at: LONDON, city: "London" }),
      event({ title: "Wrap-up", date: "2026-09-04", at: LONDON, city: "London" }),
    ];
    const before = detect(base)[0];

    // Re-keying on the end date or the event ids would strand the packing list.
    const after = detect([
      ...base,
      event({ title: "Extra review", date: "2026-09-03", at: LONDON, city: "London" }),
      event({ title: "One more day", date: "2026-09-05", at: LONDON, city: "London" }),
    ])[0];

    expect(after.endDate).not.toBe(before.endDate);
    expect(after.signature).toBe(before.signature);
  });
});

// ── The two questions detection knows it might be wrong about ───────────────

describe("suggestionsForTrips", () => {
  const twoLegs = () => [
    event({ title: "Kickoff", date: "2026-09-02", at: LONDON, city: "London" }),
    event({ title: "Workshop", date: "2026-09-03", at: LONDON, city: "London" }),
    event({ title: "Committee", date: "2026-09-04", at: WESTMINSTER, city: "Westminster" }),
    event({ title: "Debrief", date: "2026-09-05", at: WESTMINSTER, city: "Westminster" }),
  ];

  it("offers to split a trip whose legs name two cities, at a concrete date", () => {
    const trips = detect(twoLegs());
    const suggestion = suggestionsForTrips(trips, []).get(trips[0].signature);

    expect(suggestion).toMatchObject({ kind: "split", boundaryDate: "2026-09-04" });
    expect(suggestion?.question).toContain("London and Westminster");
  });

  it("offers to merge two trips that sit back to back", () => {
    const trips = detect([
      event({ title: "Vacation: Hamptons", allDay: { from: "2026-09-10", toExclusive: "2026-09-13" } }),
      event({ title: "Client kickoff", date: "2026-09-13", at: LONDON, city: "London" }),
      event({ title: "Workshop", date: "2026-09-14", at: LONDON, city: "London" }),
    ]);

    const suggestion = suggestionsForTrips(trips, []).get(trips[0].signature);
    expect(suggestion).toMatchObject({ kind: "merge" });
    expect(suggestion?.question).toContain("Hamptons");
  });

  it("does not ask again once the trip has an answer, including a dismissal", () => {
    const trips = detect(twoLegs());
    const dismissed: TripDecision[] = [
      { action: "keep", anchorSignature: trips[0].signature, boundaryDate: null },
    ];
    expect(suggestionsForTrips(trips, dismissed).has(trips[0].signature)).toBe(false);
  });

  it("stays quiet about an unremarkable single-city trip", () => {
    const trips = detect([
      event({ title: "Kickoff", date: "2026-09-02", at: LONDON, city: "London" }),
      event({ title: "Wrap-up", date: "2026-09-03", at: LONDON, city: "London" }),
    ]);
    expect(suggestionsForTrips(trips, [])).toEqual(new Map());
  });
});

// ── The user overruling detection ───────────────────────────────────────────

describe("trip decisions", () => {
  const twoLegs = [
    event({ title: "Kickoff", date: "2026-09-02", at: LONDON, city: "London" }),
    event({ title: "Workshop", date: "2026-09-03", at: LONDON, city: "London" }),
    event({ title: "Committee", date: "2026-09-04", at: WESTMINSTER, city: "Westminster" }),
    event({ title: "Debrief", date: "2026-09-05", at: WESTMINSTER, city: "Westminster" }),
  ];

  const backToBack = [
    event({ title: "Vacation: Hamptons", allDay: { from: "2026-09-10", toExclusive: "2026-09-13" } }),
    event({ title: "Client kickoff", date: "2026-09-13", at: LONDON, city: "London" }),
    event({ title: "Workshop", date: "2026-09-14", at: LONDON, city: "London" }),
    event({ title: "Review", date: "2026-09-15", at: LONDON, city: "London" }),
  ];

  it("cuts one trip in two at the boundary the user picked", () => {
    const detected = detect(twoLegs);
    const split: TripDecision[] = [
      { action: "split", anchorSignature: detected[0].signature, boundaryDate: "2026-09-04" },
    ];

    const trips = detect(twoLegs, NYC, split);
    expect(trips.map((trip) => [trip.destination, trip.startDate, trip.endDate])).toEqual([
      ["London", "2026-09-02", "2026-09-03"],
      ["Westminster", "2026-09-04", "2026-09-05"],
    ]);
  });

  it("joins two trips the user says are one journey", () => {
    const detected = detect(backToBack);
    expect(detected).toHaveLength(2);

    const merge: TripDecision[] = [
      { action: "merge", anchorSignature: detected[0].signature, boundaryDate: null },
    ];

    const trips = detect(backToBack, NYC, merge);
    expect(trips).toHaveLength(1);
    expect(trips[0]).toMatchObject({ startDate: "2026-09-10", endDate: "2026-09-15" });
    expect(trips[0].cities).toEqual(expect.arrayContaining(["Hamptons", "London"]));
  });

  it("stops applying a decision once the calendar has reshaped the trip", () => {
    // The decision anchors on the signature the user was looking at. When the trip
    // moves, detection is believed again rather than a stale answer quietly
    // reshaping something nobody has seen.
    const detected = detect(twoLegs);
    const split: TripDecision[] = [
      { action: "split", anchorSignature: detected[0].signature, boundaryDate: "2026-09-04" },
    ];

    const movedByOneDay = twoLegs.map((entry) =>
      event({
        title: entry.title!,
        date: entry.starts_at.slice(0, 10).replace(/-(\d\d)$/, (_, day) => `-${String(Number(day) + 1).padStart(2, "0")}`),
        at: { lat: entry.weather_lat!, lng: entry.weather_lng! },
        city: entry.weather_city!,
      })
    );

    const trips = detect(movedByOneDay, NYC, split);
    expect(trips).toHaveLength(1);
    expect(trips[0].startDate).toBe("2026-09-03");
  });

  it("leaves a decision that matches nothing entirely alone", () => {
    const trips = detect(twoLegs, NYC, [
      { action: "split", anchorSignature: "2020-01-01|nowhere", boundaryDate: "2020-01-02" },
    ]);
    expect(trips).toHaveLength(1);
  });
});
