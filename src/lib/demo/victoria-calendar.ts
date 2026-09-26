/**
 * "Victoria" -- a ~35-year-old finance executive in New York -- as one month of
 * `calendar_events` rows, already labeled the way /api/google/calendar/sync leaves them
 * after classification (occasion / formality / companion / weather coordinates).
 *
 * Two callers share this: the sync route in demo mode (`DEMO_CALENDAR=victoria`), and
 * `scripts/seed-victoria-calendar.mts`. It is deliberately self-contained -- no `@/`
 * imports -- because the script runs on Node's native TypeScript support, where the alias
 * doesn't resolve. See docs/test-case-victoria.md for what each scenario is there to break.
 */

export const SEED_PREFIX = "seed-victoria-";

export type Companion =
  | "colleague"
  | "client"
  | "friend"
  | "family"
  | "partner"
  | "professional"
  | "solo"
  | "unknown";

// ---------------------------------------------------------------------------
// Places. Coordinates are what detect-trips compares against profiles.lat/lng
// (AWAY_RADIUS_KM = 120), so the away/home split below is deliberate:
//   home:  nyc, greatneck, westchester   away: london, hamptons, boston
// ---------------------------------------------------------------------------
export const PLACES = {
  nyc: { city: "New York", lat: 40.7128, lng: -74.006, tz: "America/New_York" },
  greatneck: { city: "Great Neck", lat: 40.8007, lng: -73.7285, tz: "America/New_York" },
  westchester: { city: "White Plains", lat: 41.034, lng: -73.7629, tz: "America/New_York" },
  london: { city: "London", lat: 51.5072, lng: -0.1276, tz: "Europe/London" },
  hamptons: { city: "East Hampton", lat: 40.9634, lng: -72.1848, tz: "America/New_York" },
  boston: { city: "Boston", lat: 42.3601, lng: -71.0589, tz: "America/New_York" },
} as const;
type PlaceKey = keyof typeof PLACES;

export const HOME_TZ = PLACES.nyc.tz;

export interface SeedEvent {
  /** Days after the window's first day (day 0 is a Monday by default). */
  day: number;
  /** "HH:MM-HH:MM" local to `place`, or null for an all-day event. */
  span: string | null;
  /** All-day only: how many days it covers. */
  days?: number;
  title: string;
  occasion: string;
  formality: number;
  companion: Companion;
  attendees: number;
  place?: PlaceKey;
  location?: string;
  /** Timed only: end lands on a later day and/or in another zone (flights). */
  endDay?: number;
  endPlace?: PlaceKey;
}

const timed = (
  day: number,
  span: string,
  title: string,
  occasion: string,
  formality: number,
  companion: Companion,
  attendees: number,
  place?: PlaceKey,
  location?: string,
  more: Pick<SeedEvent, "endDay" | "endPlace"> = {}
): SeedEvent => ({
  day, span, title, occasion, formality, companion, attendees, place, location, ...more,
});

const allDay = (
  day: number,
  days: number,
  title: string,
  occasion: string,
  formality: number,
  companion: Companion,
  place?: PlaceKey
): SeedEvent => ({
  day, span: null, days, title, occasion, formality, companion, attendees: 0, place,
});

// ---------------------------------------------------------------------------
// The month. Day 0 = Monday. Each block is one calendar week.
//
// Things this deliberately exercises (all from failures recorded in checklist.md):
//   - sweat rule:        6:30 training / spin / run, then meetings the same day
//   - client golf:       formality 4 on a sport event (must be capped to 2), then a
//                        clubhouse lunch
//   - transit split:     overnight flights and the drive to the Hamptons
//   - 3+ looks in a day: TV interview -> board meeting -> gala (day 1)
//   - business trip:     "Business Trip (London)" all-day container + flights
//   - vacation:          "Vacation: Hamptons" container, no location field
//   - one-day errand:    Boston keynote by train is NOT a trip (needs 2+ days)
//   - multi-city days:   Boston day, London days, home days
// ---------------------------------------------------------------------------
export const EVENTS: SeedEvent[] = [
  // ===== Week 1 (days 0-6): dense home week, gala, keynote =====
  timed(0, "06:30-07:30", "Personal training with Marco", "workout", 1, "professional", 2, "nyc", "Equinox Hudson Yards"),
  timed(0, "09:30-10:30", "Weekly leadership team meeting", "team_meeting", 3, "colleague", 8, "nyc", "Firm HQ, 45th floor"),
  timed(0, "12:00-13:30", "Lunch with Elena Park, Head of Client Coverage", "client_lunch", 3, "colleague", 2, "nyc", "Marea, Central Park South"),
  timed(0, "15:00-16:00", "Quarterly portfolio review - Meridian Pension Fund", "client_meeting", 4, "client", 5, "nyc", "Firm HQ, Conference Room A"),
  timed(0, "19:00-21:00", "Dinner with Sarah and college friends", "friends_dinner", 2, "friend", 4, "nyc", "Via Carota, West Village"),

  timed(1, "07:30-08:30", "Live TV interview: CNBC Squawk Box", "media_interview", 5, "professional", 4, "nyc", "CNBC Studios, Englewood Cliffs"),
  timed(1, "10:00-13:00", "Board of Directors meeting", "board_meeting", 5, "colleague", 12, "nyc", "Firm HQ, Boardroom"),
  timed(1, "14:00-15:00", "Interview: Financial Times, markets outlook", "media_interview", 4, "professional", 2, "nyc", "Firm HQ, Conference Room B"),
  timed(1, "18:30-22:30", "Firm Annual Gala (black tie)", "gala", 5, "colleague", 300, "nyc", "Lincoln Center, David H. Koch Theater"),

  timed(2, "07:00-07:45", "Peloton ride", "workout", 1, "solo", 0),
  timed(2, "09:00-10:00", "1:1 with the CFO", "one_on_one", 3, "colleague", 2, "nyc", "Firm HQ, CFO office"),
  timed(2, "11:00-12:00", "Keynote: Women in Finance Summit", "keynote", 4, "unknown", 400, "nyc", "Javits Center, Main Stage"),
  timed(2, "13:00-14:00", "Speaker lunch, Women in Finance Summit", "networking_lunch", 3, "unknown", 12, "nyc", "Javits Center, Speaker Lounge"),
  timed(2, "18:00-19:30", "Networking reception, Women in Finance", "networking_event", 3, "unknown", 150, "nyc", "The Rainbow Room"),

  timed(3, "08:00-08:45", "Coffee chat with a junior analyst (mentoring)", "coffee_chat", 2, "colleague", 2, "nyc", "Blue Bottle, Rockefeller Center"),
  timed(3, "09:00-10:00", "Investor relations sync", "team_meeting", 3, "colleague", 6, "nyc", "Firm HQ"),
  timed(3, "12:30-14:00", "Lunch with mentor, Dr. Ingrid Vaughn", "business_lunch", 3, "colleague", 2, "nyc", "The Modern"),
  timed(3, "15:00-16:30", "Deep work: annual strategy memo", "focus_block", 2, "solo", 0, "nyc", "Firm HQ"),
  timed(3, "19:30-22:30", "Date night: Broadway show with Daniel", "date_night", 3, "partner", 2, "nyc", "Broadway, Theater District"),

  timed(4, "08:30-09:45", "Client breakfast - Hargrove Family Office", "client_breakfast", 4, "client", 3, "nyc", "The Regency Hotel"),
  timed(4, "11:00-12:00", "Q3 earnings call", "earnings_call", 4, "colleague", 40, "nyc", "Firm HQ, Broadcast Room"),
  timed(4, "13:00-14:00", "Team lunch (casual Friday)", "team_lunch", 2, "colleague", 9, "nyc", "Firm HQ, Terrace"),
  timed(4, "17:30-19:00", "Happy hour with the team", "happy_hour", 2, "colleague", 10, "nyc", "Dead Rabbit, Financial District"),

  timed(5, "08:00-12:30", "Golf with clients", "golf", 4, "client", 4, "westchester", "Hudson Valley Country Club, White Plains"),
  timed(5, "12:45-14:15", "Clubhouse lunch after the round", "client_lunch", 3, "client", 4, "westchester", "Hudson Valley Country Club, Grill Room"),
  timed(5, "18:00-20:30", "Family dinner at Mom and Dad's", "family_time", 2, "family", 6, "greatneck", "Great Neck, NY"),

  timed(6, "10:30-12:00", "Brunch with Mia and Chloe", "brunch", 2, "friend", 3, "nyc", "Balthazar, SoHo"),
  timed(6, "14:00-17:00", "Family time: Sunday afternoon in Central Park", "family_time", 1, "family", 4, "nyc", "Central Park, Sheep Meadow"),

  // ===== Week 2 (days 7-13): investor day, hiring, charity dinner, wedding, overnight flight =====
  timed(7, "06:45-07:45", "Morning run with Central Park run club", "workout", 1, "friend", 12, "nyc", "Central Park, Engineers' Gate"),
  timed(7, "10:00-12:00", "Investor Day: keynote presentation", "keynote", 5, "client", 250, "nyc", "Convene, 360 Madison Ave"),
  timed(7, "14:00-16:00", "Investor Day: analyst Q&A", "client_meeting", 4, "client", 60, "nyc", "Convene, 360 Madison Ave"),
  timed(7, "18:30-20:00", "Dinner with the CEO of Northbridge Capital", "client_dinner", 4, "client", 3, "nyc", "Per Se, Columbus Circle"),

  timed(8, "07:30-08:30", "Live TV interview: Bloomberg Surveillance", "media_interview", 5, "professional", 3, "nyc", "Bloomberg HQ, 731 Lexington"),
  timed(8, "10:30-11:30", "Candidate interview: VP, Portfolio Management", "hiring_interview", 3, "colleague", 3, "nyc", "Firm HQ, Conference Room C"),
  timed(8, "12:00-13:30", "Client lunch - Northbridge Capital", "client_lunch", 4, "client", 4, "nyc", "Gramercy Tavern"),
  timed(8, "19:00-22:30", "Charity benefit dinner: Women's Health Foundation", "gala", 5, "unknown", 220, "nyc", "The Plaza Hotel, Grand Ballroom"),

  timed(9, "06:30-07:30", "Hot yoga", "workout", 1, "solo", 0, "nyc", "CorePower, Flatiron"),
  timed(9, "09:30-11:30", "Audit committee meeting", "board_meeting", 4, "colleague", 8, "nyc", "Firm HQ, Boardroom"),
  timed(9, "16:00-17:00", "Dentist appointment", "medical_appointment", 2, "professional", 1, "nyc", "Midtown Dental"),
  timed(9, "19:00-21:30", "Wine dinner with Priya", "friends_dinner", 3, "friend", 2, "nyc", "Frenchette, Tribeca"),

  timed(10, "08:15-09:00", "Coffee chat with a prospective hire", "coffee_chat", 3, "unknown", 2, "nyc", "Culture Espresso, Midtown"),
  timed(10, "09:00-10:00", "Portfolio strategy huddle", "team_meeting", 3, "colleague", 5, "nyc", "Firm HQ"),
  timed(10, "13:00-14:30", "Panel: The Future of Asset Management", "panel_talk", 4, "unknown", 300, "nyc", "Bloomberg Invest, Javits Center"),
  timed(10, "17:00-19:00", "Cocktail reception, Bloomberg Invest", "networking_event", 3, "unknown", 200, "nyc", "Javits Center, Level 3"),

  timed(11, "09:00-12:00", "Working from home: focus block", "focus_block", 1, "solo", 0),
  timed(11, "14:00-15:00", "Video call with the Tokyo desk (Zoom)", "team_meeting", 2, "colleague", 10, undefined, "Zoom"),
  timed(11, "19:00-21:30", "Date night: dinner with Daniel at Le Bernardin", "date_night", 4, "partner", 2, "nyc", "Le Bernardin, West 51st St"),

  timed(12, "09:00-10:00", "Golf lesson with the club pro", "golf", 1, "professional", 2, "westchester", "Hudson Valley Country Club, Practice Range"),
  timed(12, "11:30-13:30", "Girls' brunch with Mia, Chloe and Priya", "brunch", 2, "friend", 4, "nyc", "Sadelle's, SoHo"),
  timed(12, "16:30-23:00", "Wedding: Jess and Tom", "wedding", 5, "friend", 120, "nyc", "The Foundry, Long Island City"),

  timed(13, "11:00-13:30", "Family time: Sunday lunch at Mom and Dad's", "family_time", 2, "family", 6, "greatneck", "Great Neck, NY"),
  timed(13, "21:00-09:00", "Flight UA17 JFK to Heathrow (overnight)", "flight", 3, "unknown", 0, "nyc", "JFK Airport, Terminal 7", { endDay: 14, endPlace: "london" }),

  // ===== Week 3 (days 14-20): London business trip (fly out Sun night, back Thu evening) =====
  allDay(14, 4, "Business Trip (London)", "business_trip", 4, "colleague", "london"),
  timed(14, "11:00-12:30", "London office leadership meeting", "team_meeting", 4, "colleague", 10, "london", "Canary Wharf, London"),
  timed(14, "13:00-14:30", "Lunch with Charlotte Hughes, UK regulatory liaison", "business_lunch", 3, "professional", 2, "london", "Fitzrovia, London"),
  timed(14, "16:00-17:30", "Client meeting - Whitfield Asset Management", "client_meeting", 4, "client", 5, "london", "St James's, London"),
  timed(14, "19:30-22:00", "Client dinner, Mayfair", "client_dinner", 4, "client", 4, "london", "Mayfair, London"),

  timed(15, "08:30-10:00", "Fintech roundtable breakfast", "networking_event", 3, "unknown", 20, "london", "The Savoy, London"),
  timed(15, "10:30-12:00", "Keynote: Global Markets Outlook, City Conference", "keynote", 5, "unknown", 500, "london", "Guildhall, London"),
  timed(15, "14:00-15:30", "Pre-earnings investor meeting", "client_meeting", 4, "client", 6, "london", "Bishopsgate, London"),
  timed(15, "18:30-22:30", "Opera night with clients", "client_event", 5, "client", 6, "london", "Royal Opera House, Covent Garden"),

  timed(16, "06:45-07:30", "Morning run along the Thames", "workout", 1, "solo", 0, "london", "South Bank, London"),
  timed(16, "08:00-08:45", "Coffee with Oliver, former colleague", "coffee_chat", 2, "friend", 2, "london", "Monmouth Coffee, Borough Market"),
  timed(16, "09:30-16:30", "Executive strategy retreat", "offsite", 3, "colleague", 15, "london", "Surrey Hills, England"),
  timed(16, "19:00-21:30", "Dinner with Amelia, friend from Oxford", "friends_dinner", 3, "friend", 2, "london", "Notting Hill, London"),

  timed(17, "10:00-11:00", "Interview: Financial Times London, private markets", "media_interview", 4, "professional", 2, "london", "Bracken House, London"),
  timed(17, "12:30-14:00", "Farewell lunch with the London team", "team_lunch", 3, "colleague", 8, "london", "Spitalfields, London"),
  timed(17, "18:00-21:00", "Flight UA15 Heathrow to JFK", "flight", 2, "unknown", 0, "london", "Heathrow Airport, Terminal 2", { endPlace: "nyc" }),

  timed(18, "09:30-11:00", "Recovery morning: working from home", "focus_block", 1, "solo", 0),
  timed(18, "14:00-15:00", "Debrief with the leadership team", "team_meeting", 3, "colleague", 6, "nyc", "Firm HQ"),
  timed(18, "17:00-18:00", "Massage", "spa_appointment", 1, "professional", 1, "nyc", "Bluemercury Spa, Upper East Side"),

  timed(19, "10:00-11:00", "Coffee with Mia", "coffee_chat", 1, "friend", 2, "nyc", "Café Grumpy, West Village"),
  timed(19, "13:00-16:00", "Family time: niece's birthday party", "family_time", 2, "family", 20, "greatneck", "Great Neck, NY"),
  timed(19, "19:30-22:00", "Dinner with Daniel's colleagues", "dinner_party", 3, "partner", 6, "nyc", "Upper West Side"),

  timed(20, "10:00-11:00", "Pilates", "workout", 1, "professional", 8, "nyc", "Tracy Anderson Studio"),
  timed(20, "15:00-18:00", "Family time: Sunday at home", "family_time", 1, "family", 3),

  // ===== Week 4 (days 21-27): day trip to Boston (NOT a trip), then the Hamptons vacation =====
  timed(21, "07:00-08:00", "Spin class", "workout", 1, "solo", 20, "nyc", "SoulCycle, Flatiron"),
  timed(21, "09:30-11:00", "Weekly leadership team meeting", "team_meeting", 3, "colleague", 8, "nyc", "Firm HQ, 45th floor"),
  timed(21, "13:00-14:30", "Lunch with Grace Lin, prospective client", "client_lunch", 3, "client", 2, "nyc", "Le Coucou, SoHo"),
  timed(21, "19:00-21:00", "Board dinner", "board_dinner", 4, "colleague", 14, "nyc", "The Core Club"),

  timed(22, "08:00-08:45", "Coffee chat with a fintech founder", "coffee_chat", 3, "unknown", 2, "nyc", "Stumptown, Ace Hotel"),
  timed(22, "09:00-10:30", "Risk committee meeting", "board_meeting", 4, "colleague", 9, "nyc", "Firm HQ, Boardroom"),
  timed(22, "12:00-13:00", "Lunch: quick salad at desk", "focus_block", 1, "solo", 0, "nyc"),
  timed(22, "16:00-17:30", "Podcast interview: leadership and markets", "media_interview", 3, "professional", 3, "nyc", "Podcast studio, Chelsea"),
  timed(22, "18:30-20:30", "Art gallery opening with Priya", "party", 4, "friend", 80, "nyc", "Chelsea Gallery District"),

  timed(23, "06:15-08:45", "Train to Boston (Acela)", "travel", 3, "solo", 0, "nyc", "Penn Station, New York"),
  timed(23, "10:00-11:30", "Keynote: Harvard Business School Women's Summit", "keynote", 4, "unknown", 350, "boston", "Harvard Business School, Boston"),
  timed(23, "12:00-13:30", "Faculty lunch, HBS", "business_lunch", 3, "professional", 8, "boston", "Harvard Business School, Boston"),
  timed(23, "15:00-16:30", "Meeting with a Boston client", "client_meeting", 4, "client", 4, "boston", "Boston Financial District"),
  timed(23, "17:30-20:00", "Train back to New York", "travel", 2, "solo", 0, "boston", "South Station, Boston", { endPlace: "nyc" }),

  timed(24, "09:00-10:00", "Compensation committee call", "team_meeting", 3, "colleague", 6, "nyc", "Firm HQ"),
  timed(24, "11:00-12:00", "Hair appointment", "salon_appointment", 2, "professional", 1, "nyc", "Sally Hershberger, SoHo"),
  timed(24, "14:00-16:00", "Media prep with the comms team", "media_prep", 3, "colleague", 4, "nyc", "Firm HQ, Conference Room D"),
  timed(24, "18:30-21:00", "Cocktail party: Museum of Modern Art benefit", "gala", 4, "unknown", 250, "nyc", "MoMA, Sculpture Garden"),

  timed(25, "09:00-11:00", "Hand-off meeting before vacation", "team_meeting", 3, "colleague", 5, "nyc", "Firm HQ"),
  allDay(25, 4, "Vacation: Hamptons", "vacation", 1, "family", "hamptons"),
  timed(25, "14:00-17:30", "Drive to the Hamptons", "travel", 1, "partner", 2, "nyc", "Manhattan to East Hampton"),
  timed(25, "19:30-21:30", "Dinner at the house with Daniel", "dinner", 2, "partner", 2, "hamptons", "East Hampton, NY"),

  timed(26, "09:00-11:00", "Beach morning with the girls", "beach", 1, "friend", 4, "hamptons", "Main Beach, East Hampton"),
  timed(26, "13:00-15:00", "Lunch at the Montauk Yacht Club", "lunch", 2, "friend", 6, "hamptons", "Montauk, NY"),
  timed(26, "19:00-22:00", "Dinner party with friends, Sag Harbor", "friends_dinner", 3, "friend", 10, "hamptons", "Sag Harbor, NY"),

  timed(27, "08:30-10:00", "Tennis with Daniel", "tennis", 1, "partner", 2, "hamptons", "East Hampton Racquet Club"),
  timed(27, "11:30-14:00", "Family brunch with Daniel's parents", "family_time", 2, "family", 6, "hamptons", "East Hampton, NY"),
  timed(27, "18:00-20:00", "Sunset drinks on the deck", "casual", 2, "partner", 2, "hamptons"),

  // ===== Week 5 (days 28-29): back from vacation =====
  timed(28, "15:30-19:00", "Drive back to the city", "travel", 1, "partner", 2, "hamptons", "East Hampton to Manhattan", { endPlace: "nyc" }),
  timed(29, "09:30-10:30", "Weekly leadership team meeting", "team_meeting", 3, "colleague", 8, "nyc", "Firm HQ, 45th floor"),
  timed(29, "12:00-13:30", "Lunch with the head of Private Wealth", "business_lunch", 3, "colleague", 2, "nyc", "Firm HQ, Executive Dining Room"),
  timed(29, "18:30-21:00", "Client dinner: welcome-back dinner", "client_dinner", 4, "client", 4, "nyc", "Upper East Side"),
];

// ---------------------------------------------------------------------------
// Dates and zones
// ---------------------------------------------------------------------------

/** Offset (ms) of `timeZone` from UTC at the instant `utcMs`; positive east of Greenwich. */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** The UTC instant at which a wall clock reads `date` `hhmm` in `timeZone`. */
function zonedToUtc(date: string, hhmm: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  // Two passes: the first offset is measured at the wrong instant when the wall clock
  // sits on the far side of a DST change from the guess.
  const first = wall - zoneOffsetMs(wall, timeZone);
  return new Date(wall - zoneOffsetMs(first, timeZone));
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function localToday(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Monday of the week containing `date`. */
export function mondayOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(date, -((dow + 6) % 7));
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export function toRow(event: SeedEvent, index: number, start: string, userId: string) {
  const date = addDays(start, event.day);
  const place = event.place ? PLACES[event.place] : null;

  let startsAt: string;
  let endsAt: string;
  if (event.span === null) {
    // Google's all-day dates are calendar dates with no instant; sync encodes them as
    // <date>T00:00:00Z and the end date is exclusive. Match that exactly.
    startsAt = `${date}T00:00:00Z`;
    endsAt = `${addDays(date, event.days ?? 1)}T00:00:00Z`;
  } else {
    const [from, to] = event.span.split("-");
    const startTz = place?.tz ?? HOME_TZ;
    const endTz = event.endPlace ? PLACES[event.endPlace].tz : startTz;
    startsAt = zonedToUtc(date, from, startTz).toISOString();
    endsAt = zonedToUtc(addDays(start, event.endDay ?? event.day), to, endTz).toISOString();
  }

  return {
    user_id: userId,
    google_event_id: `${SEED_PREFIX}${String(index).padStart(3, "0")}`,
    title: event.title,
    location: event.location ?? null,
    starts_at: startsAt,
    ends_at: endsAt,
    all_day: event.span === null,
    attendee_count: event.attendees,
    occasion: event.occasion,
    formality: event.formality,
    companion: event.companion,
    // A located event carries its city's coordinates, like sync leaves it. A locationless
    // one (Zoom, at home) is still marked resolved so nothing retries it forever.
    weather_city: place?.city ?? null,
    weather_lat: place?.lat ?? null,
    weather_lng: place?.lng ?? null,
    weather_timezone: place?.tz ?? null,
    weather_location_resolved: true,
    synced_at: new Date().toISOString(),
  };
}


/** Days the template spans; `EVENTS` holds nothing past day 29. */
export const VICTORIA_DAYS = 30;

/** Monday of the current week in New York -- day 0 of the template. */
export function victoriaStart(): string {
  return mondayOf(localToday(HOME_TZ));
}

/**
 * Every event of the template that falls inside `days`, as insertable rows. Ids are
 * positional (`seed-victoria-007`), so the same event keeps the same id -- and therefore
 * the same database row -- whichever week it is anchored to.
 */
export function victoriaRows(userId: string, start: string = victoriaStart(), days: number = VICTORIA_DAYS) {
  return EVENTS.flatMap((event, index) => (event.day < days ? [toRow(event, index, start, userId)] : []));
}

/** What a demo profile needs for trips to detect and days to bucket in New York time. */
export const VICTORIA_HOME = {
  city: PLACES.nyc.city,
  lat: PLACES.nyc.lat,
  lng: PLACES.nyc.lng,
  timezone: HOME_TZ,
} as const;
