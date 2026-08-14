import { packingCategoryRank } from "@/lib/travel/packing";
import { wardrobeItemLabel } from "@/lib/wardrobe/item-label";
import type { PrintedWeather } from "@/lib/travel/trip-render";
import type { DailySegmentItem } from "@/types/daily";
import type { TripRenderData } from "@/types/travel";

export type PrintSection = "all" | "cards" | "packing";

/**
 * The printable trip: one card per look, plus the packing list.
 *
 * Deliberately a deterministic grid rather than the freeform Canvas collage (D6).
 * Generated segments carry no `x/y/width` — layout only exists where a human
 * arranged one in `/outfits` — and a printed card wants "which pieces am I taking",
 * which a fixed category order answers better than a collage does on A5 paper.
 *
 * Images are plain eager `<img>`, never `next/image`: a lazily-loaded or blurred
 * placeholder prints as an empty box, and the failure only shows up on paper.
 *
 * The two sections have genuinely different moments — the list is used before
 * leaving, the cards after arriving — so each can be printed on its own.
 */
export function TripPrintout({
  data,
  weatherByDate,
  section = "all",
  intro,
}: {
  data: TripRenderData;
  weatherByDate: Map<string, PrintedWeather[]>;
  section?: PrintSection;
  intro?: React.ReactNode;
}) {
  const { trip, days, garments, packing } = data;
  const plannedDays = days.filter((day) => day.segments.length > 0);
  const confirmed = new Set(trip.confirmedDates);

  const cards = plannedDays.flatMap((day, dayIndex) =>
    day.segments.map((segment, segmentIndex) => ({
      key: segment.id,
      dayNumber: days.findIndex((entry) => entry.date === day.date) + 1 || dayIndex + 1,
      date: day.date,
      confirmed: confirmed.has(day.date),
      // A day with two looks is "Day 3 · Look 1 / Look 2"; a day with one is just the day.
      lookLabel: day.segments.length > 1 ? `Look ${segmentIndex + 1}` : null,
      segment,
      occasions: day.occasions,
    }))
  );

  const garmentsByCategory = new Map<string, typeof garments>();
  for (const garment of garments) {
    const category = garment.item.category;
    garmentsByCategory.set(category, [...(garmentsByCategory.get(category) ?? []), garment]);
  }
  const categories = [...garmentsByCategory.keys()].sort(
    (a, b) => packingCategoryRank(a) - packingCategoryRank(b)
  );

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 text-surface-900 print:max-w-none print:px-0 print:py-0">
      <style>{PRINT_CSS}</style>

      <header className="mb-6 border-b border-surface-300 pb-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-surface-400">
          {trip.tripType === "business" ? "Business trip" : "Trip"}
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold">{trip.destination}</h1>
        <p className="mt-1 text-sm text-surface-500">
          {formatRange(trip.startDate, trip.endDate)} · {trip.dates.length} day
          {trip.dates.length === 1 ? "" : "s"}
          {trip.cities.length > 1 ? ` · ${trip.cities.join(" → ")}` : ""}
        </p>
        {intro}
      </header>

      {section !== "packing" && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-surface-500">
            Outfit cards
          </h2>
          {cards.length === 0 ? (
            <p className="text-sm text-surface-400">No outfits planned for this trip yet.</p>
          ) : (
            <div className="space-y-4">
              {cards.map((card) => (
                <article key={card.key} className="trip-card rounded-2xl border border-surface-300 p-4">
                  <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-surface-200 pb-2">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-surface-400">
                        Day {card.dayNumber}
                        {card.lookLabel ? ` · ${card.lookLabel}` : ""}
                        {card.confirmed ? " · confirmed" : ""}
                      </p>
                      <h3 className="text-base font-semibold">{card.segment.label}</h3>
                      <p className="text-xs text-surface-500">{formatFullDate(card.date)}</p>
                    </div>
                    <div className="text-right text-xs text-surface-500">
                      {(weatherByDate.get(card.date) ?? []).map((weather, index) => (
                        <p key={index}>
                          {weather.city ? `${weather.city} ` : ""}
                          {weather.summary}
                          {/* D2: an estimate is a historical average, and on a trip
                              booked weeks out most days are. Never print it as a forecast. */}
                          {weather.isEstimate && (
                            <span className="text-surface-400"> (historical average)</span>
                          )}
                        </p>
                      ))}
                    </div>
                  </div>

                  {card.occasions.length > 0 && (
                    <p className="mb-3 text-xs text-surface-500">
                      {card.occasions
                        .map(
                          (occasion) =>
                            `${occasion.time} · ${occasion.title}${
                              occasion.location ? ` (${occasion.location})` : ""
                            }`
                        )
                        .join("   ·   ")}
                    </p>
                  )}

                  <ul className="mb-3 grid grid-cols-4 gap-3 sm:grid-cols-6">
                    {[...(card.segment.items as DailySegmentItem[])]
                      .sort(
                        (a, b) => packingCategoryRank(a.category) - packingCategoryRank(b.category)
                      )
                      .map((item) => (
                        <li key={item.id} className="text-center">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={item.clean_url || item.original_url}
                            alt=""
                            loading="eager"
                            decoding="sync"
                            className="mx-auto h-20 w-full rounded-lg bg-surface-50 object-contain"
                          />
                          <p className="mt-1 text-[9px] leading-tight text-surface-600">
                            {wardrobeItemLabel(item)}
                          </p>
                        </li>
                      ))}
                  </ul>

                  {card.segment.reasoning && (
                    <p className="text-xs leading-relaxed text-surface-600">
                      {card.segment.reasoning}
                    </p>
                  )}

                  {/* A ruled line, because a printed card gets written on. */}
                  <div className="mt-4 border-t border-dashed border-surface-300 pt-3">
                    <p className="text-[9px] uppercase tracking-wide text-surface-300">Notes</p>
                    <div className="mt-3 h-4 border-b border-surface-200" />
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {section !== "cards" && (
        <section className="trip-card">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-surface-500">
            Packing list
          </h2>

          {garments.length === 0 ? (
            <p className="mb-4 text-sm text-surface-400">
              No days confirmed yet, so there are no clothes on the list.
            </p>
          ) : (
            <div className="mb-6 space-y-4">
              {categories.map((category) => (
                <div key={category}>
                  <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-surface-400">
                    {category}
                  </h3>
                  <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                    {garmentsByCategory.get(category)!.map((garment) => (
                      <li key={garment.item.id} className="flex items-start gap-2 text-xs">
                        <span className="mt-0.5 inline-block h-3 w-3 shrink-0 border border-surface-400" />
                        <span>
                          {wardrobeItemLabel(garment.item)}
                          <span className="text-surface-400">
                            {" "}
                            — {garment.dates.map(formatShortDate).join(", ")}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          <div>
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-surface-400">
              Everything else
            </h3>
            <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {packing.extras.map((extra) => (
                <li key={extra.id} className="flex items-start gap-2 text-xs">
                  <span className="mt-0.5 inline-block h-3 w-3 shrink-0 border border-surface-400" />
                  <span>{extra.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}

function formatRange(start: string, end: string): string {
  const format = (date: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(`${date}T12:00:00Z`));
  return start === end ? format(start) : `${format(start)} – ${format(end)}`;
}

function formatFullDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
}

function formatShortDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(
    new Date(`${date}T12:00:00Z`)
  );
}

/**
 * Print rules that Tailwind's `print:` variants can't express cleanly.
 * `page-break-inside` is the one that actually matters: a card split across two
 * sheets is worse than a mostly-empty page.
 */
const PRINT_CSS = `
@media print {
  @page { size: A4; margin: 12mm; }
  body { background: #fff; }
  .no-print { display: none !important; }
  .trip-card {
    page-break-inside: avoid;
    break-inside: avoid;
  }
  a[href]:after { content: none !important; }
}
`;
