# Test case: Victoria, a month in the life of a finance executive

A reproducible, synthetic stress test for the planning pipeline. One command fills a
month of a New York finance executive's calendar; from there `/plan`, `/home` and
`/travel` can be exercised against a schedule dense enough to break naive outfit
planning.

Everything here is invented: the people are fictional, and the venues are real public
places used only as location flavor.

## Persona

**Victoria**, about 35, a senior executive at an asset manager in New York. Her calendar
is what makes dressing hard for this kind of person: several completely different
dress codes in one day, sport in the middle of a working day, client hospitality that
is formal *and* athletic at once, and a business trip whose flights sit between
meetings.

## Reproduce it

**Local development only.** The demo is tracked in git (so it can be read, reviewed and
reasoned about) but is inert in a deployment: the sync route requires
`NODE_ENV !== "production"` as well as the env flag, and loads the data by dynamic import,
so a production build does not contain it. That was checked by building and grepping the
output. The script under `scripts/` is never part of the Next.js bundle.

Two ways in, same data (`src/lib/demo/victoria-calendar.ts`):

**1. Click "Sync calendar" (no Google connection needed).** Add this to `.env.local` and
restart the dev server:

```
DEMO_CALENDAR=victoria
```

"Sync calendar" on `/plan` and `/travel` then loads Victoria's month instead of calling
Google. The month is anchored to the current week, so it always spans today. If the
profile has no home coordinates or timezone, New York is filled in (a profile that already
has them is left alone). Remove the variable to go back to the real Google sync. Setting it on a deployment does nothing.

**2. The script**, for choosing the account, the start date, or cleaning up:

```bash
npm run seed:victoria -- --email <account email> --set-profile
# optional: --start 2026-09-28 (must be a Monday)  --dry-run  --clean
```

- Writes **108 events over 30 days** straight into `calendar_events`, already labeled
  (occasion, formality, companion, weather coordinates), so no model call is involved and
  every run is identical.
- Every seeded id is prefixed `seed-victoria-` and rows are upserted on it: re-running
  refreshes the same rows, `--clean` removes exactly those, and a real synced calendar in
  the same window is untouched.
- `--set-profile` sets the home to New York. Trip detection needs a home to compare
  against, and the timezone decides how days are cut.

Script: [`scripts/seed-victoria-calendar.mts`](../scripts/seed-victoria-calendar.mts)

## The month

Day 0 is a Monday. Dates below are for the default start of 2026-09-21.

| Week | Shape | Highlights |
|---|---|---|
| 1 (9/21) | Dense home week | 6:30 personal training then a leadership meeting; live TV interview, board meeting and a black-tie gala on one day; keynote at a women-in-finance summit; Broadway date night; client golf then clubhouse lunch; family dinner |
| 2 (9/28) | Home, more public-facing | Investor Day keynote; Bloomberg TV; a hiring interview; charity benefit dinner; panel and cocktail reception; a wedding; overnight flight to London on Sunday |
| 3 (10/5) | **London business trip** | All-day "Business Trip (London)"; client meetings and dinner; keynote; opera night with clients; morning run on the Thames; return flight Thursday; recovery day at home |
| 4 (10/12) | Boston day trip, then **Hamptons vacation** | Train to Boston, keynote, client meeting, train back the same day; hand-off meeting; "Vacation: Hamptons" with the drive out, beach, dinner party, tennis, family brunch |
| 5 (10/19) | Back to work | Drive back from the Hamptons; leadership meeting; welcome-back client dinner |

Scenarios covered: travel, work, meetings, galas, keynotes, interviews, gym, golf,
vacation, friends, business meals, flights, family time, and five coffee chats
(mentoring, a prospective hire, a founder, a former colleague in London, a friend).

## What each scenario is there to break

Every case below reproduces a failure that actually shipped and is recorded in the
`checklist.md` debug log. The rule that now handles it lives in the deterministic
core, in TypeScript, not in a prompt.

| Scenario in the calendar | Failure it guards against | Where the rule lives |
|---|---|---|
| 6:30 training, spin or a run, then meetings the same day | Sweaty kit carried into the next segment | `plan-rules.ts`, comfort reason `sweat` |
| Client golf classified as formality 4 | A private club rated formal, so golf merges into the surrounding suits and comes back in a midi dress and pumps | `occasion-groups.ts` (athletic kind capped at formality 2), `plan-rules.ts` reason `not_sport` |
| Overnight flight, return flight, Acela, the drive to the Hamptons | Heels on a flight; a day of meetings and a flight planned as one outfit | `occasion-groups.ts` (`transit` kind splits the day), `plan-rules.ts` reason `transit` |
| TV interview, board meeting, gala in one day | Model returning a different segment count on each run | `groupOccasions()` decides the count from the calendar |
| "Business Trip (London)" all-day container plus timed meetings | Dressing a whole workday for a plane | all-day events are never `transit` |
| "Vacation: Hamptons" with an empty location field | Trip lost because the only destination is in the title | `explicitTravelDestinationFromTitle()` |
| One day in Boston and back by train | A single errand shown as a trip card | a run needs 2+ days unless the calendar says otherwise |
| Overnight flight spanning two time zones and two calendar days; London events under a New York profile | An event landing on the wrong local day, or planned against the wrong city's weather | `day-bucket.ts`, per-event weather coordinates |

## What has been verified, and what has not

**Verified offline (deterministic, no network).** The seed was run through the
repository's own `detectTrips`, `occasionKind`, `eventsOnLocalDay` and `groupOccasions`:

- Two trips are detected: **London, 10/4 to 10/8** (with both flights absorbed) and
  **East Hampton, 10/16 to 10/19**. The Boston day is correctly *not* a trip.
- All six flights, trains and drives resolve to `transit`, and the ten gym, run, golf,
  yoga, Pilates, spin and tennis events resolve to `athletic`.
- The calendar asks for **100 segments across 30 days, at most 5 in a day**. That is
  the ceiling from `groupOccasions()` before `merge-segments.ts` collapses look-alike
  neighbours, so real plans will have fewer.
- Flight times convert correctly across zones (21:00 New York departure is 01:00 UTC,
  09:00 London arrival is 08:00 UTC).

**Not yet run.** Generating plans from this calendar with the live model, and looking
at the result in a browser. That is the part that needs a real wardrobe and a real
account; nothing above should be read as evidence of how the generated outfits look.

## For the portfolio

Screens worth capturing once a plan has been generated, each tied to a claim above:

1. `/plan` week view for the London week, showing London weather on the trip days and
   the flight days either side.
2. Tuesday 9/22 (TV interview, board meeting, gala): three segments, three dress
   codes, the reason each was chosen.
3. A golf day: the segment dressed for sport while the calendar said formality 4, next
   to the clubhouse-lunch segment after it.
4. `/travel`: the London and Hamptons trip cards, and the absence of a Boston card.
5. The trip's print page or packing list, derived from the confirmed days.

## Limits worth stating honestly

- Events are seeded pre-labeled, so this does **not** test the Claude classification
  step. To test that, clear `occasion`, `formality` and `companion` and run a real sync.
- It tests the planning layer, not Google OAuth or the sync itself.
- The template assumes day 0 is a Monday; weekday-specific events (Saturday golf, the
  Sunday flight) land on the wrong weekday otherwise.
