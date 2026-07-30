import type { DailyForecast, WeatherData } from "./types";

/**
 * Open-Meteo provider — multi-day forecast for weekly (Phase 6.2) and travel (Phase 6.3)
 * planning (ROADMAP Phase 6.0-E / decision D2).
 *
 * No API key required. Free tier is 16-day forecast + historical archive back to 1940, but is
 * limited to non-commercial use and requires CC BY 4.0 attribution — see D2 for the commercial
 * exit. Weather codes are WMO codes (their native scale), carried through on `DailyForecast.code`.
 *
 * Dates beyond the 16-day live window (a trip booked further out) degrade to a historical climate
 * average from the archive API and are marked `isEstimate: true`. Callers MUST render estimates
 * distinctly and never mix them in with real forecast days.
 *
 * This module only takes lat/lon — it knows nothing about city names. For city → coordinates,
 * see `./geocode` (`geocodeCity`), called once at profile-save/trip-creation time, not here.
 */

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";

/** Open-Meteo forecast tops out at 16 days; past that we fall back to historical climate. */
const MAX_FORECAST_DAYS = 16;
/** How many prior years to average for the historical estimate. */
const CLIMATE_YEARS = 3;

const DAILY_VARS = "temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code";

interface DailyBlock {
  time?: string[];
  temperature_2m_max?: number[];
  temperature_2m_min?: number[];
  precipitation_sum?: number[];
  weather_code?: number[];
}

/** Format a Date as YYYY-MM-DD (UTC parts) — used only for archive query bounds. */
function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setUTCDate(copy.getUTCDate() + n);
  return copy;
}

/** Map an aligned daily block into DailyForecast rows. */
function mapDaily(daily: DailyBlock, isEstimate: boolean): DailyForecast[] {
  const dates = daily.time || [];
  return dates.map((date, i) => ({
    date,
    tempMax: Math.round(daily.temperature_2m_max?.[i] ?? 0),
    tempMin: Math.round(daily.temperature_2m_min?.[i] ?? 0),
    precipitation: Math.round((daily.precipitation_sum?.[i] ?? 0) * 10) / 10,
    code: daily.weather_code?.[i] ?? 0,
    isEstimate,
  }));
}

/** Live forecast for the first (≤16) days. */
async function fetchLiveForecast(lat: number, lon: number, days: number): Promise<DailyForecast[]> {
  const res = await fetch(
    `${FORECAST_URL}?latitude=${lat}&longitude=${lon}&daily=${DAILY_VARS}` +
      `&timezone=auto&forecast_days=${Math.min(days, MAX_FORECAST_DAYS)}`
  );
  if (!res.ok) throw new Error(`Open-Meteo forecast HTTP ${res.status}`);
  const data = await res.json();
  return mapDaily(data.daily || {}, false);
}

/**
 * Historical climate estimate for a [start, end] date range, averaged over the last
 * CLIMATE_YEARS years of the archive. Each requested date maps to the mean of that same calendar
 * day across those years; the weather code comes from the most recent year as a representative.
 * Returns rows keyed to the *original* (this-year) dates, all marked isEstimate: true.
 */
async function fetchClimateEstimate(
  lat: number,
  lon: number,
  start: Date,
  end: Date
): Promise<DailyForecast[]> {
  const spanDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (spanDays <= 0) return [];

  const yearBlocks: DailyBlock[] = [];
  for (let y = 1; y <= CLIMATE_YEARS; y++) {
    const s = new Date(start);
    s.setUTCFullYear(s.getUTCFullYear() - y);
    const e = new Date(end);
    e.setUTCFullYear(e.getUTCFullYear() - y);
    try {
      const res = await fetch(
        `${ARCHIVE_URL}?latitude=${lat}&longitude=${lon}&start_date=${toISODate(s)}` +
          `&end_date=${toISODate(e)}&daily=${DAILY_VARS}&timezone=auto`
      );
      if (res.ok) {
        const data = await res.json();
        if (data.daily?.time) yearBlocks.push(data.daily);
      }
    } catch (err) {
      console.error("Open-Meteo archive error:", err);
    }
  }
  if (yearBlocks.length === 0) return [];

  const out: DailyForecast[] = [];
  for (let i = 0; i < spanDays; i++) {
    const maxes: number[] = [];
    const mins: number[] = [];
    const precips: number[] = [];
    let code = 0;
    for (const block of yearBlocks) {
      const mx = block.temperature_2m_max?.[i];
      const mn = block.temperature_2m_min?.[i];
      const pr = block.precipitation_sum?.[i];
      if (typeof mx === "number") maxes.push(mx);
      if (typeof mn === "number") mins.push(mn);
      if (typeof pr === "number") precips.push(pr);
      if (typeof block.weather_code?.[i] === "number") code = block.weather_code[i];
    }
    if (maxes.length === 0) continue;
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    out.push({
      date: toISODate(addDays(start, i)),
      tempMax: Math.round(avg(maxes)),
      tempMin: Math.round(avg(mins)),
      precipitation: Math.round(avg(precips) * 10) / 10,
      code,
      isEstimate: true,
    });
  }
  return out;
}

/**
 * `days`-long daily forecast starting today. The first ≤16 days are a real forecast
 * (`isEstimate: false`); any remaining days fall back to a historical climate average
 * (`isEstimate: true`). Throws only if the live forecast request itself fails — the estimate
 * portion degrades to an empty tail rather than throwing.
 */
/** WMO weather codes → plain English, so a forecast can describe itself the way OpenWeather's `description` does. */
const WMO_DESCRIPTIONS: Record<number, string> = {
  0: "clear sky",
  1: "mainly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "fog",
  48: "freezing fog",
  51: "light drizzle",
  53: "drizzle",
  55: "heavy drizzle",
  56: "freezing drizzle",
  57: "heavy freezing drizzle",
  61: "light rain",
  63: "rain",
  65: "heavy rain",
  66: "freezing rain",
  67: "heavy freezing rain",
  71: "light snow",
  73: "snow",
  75: "heavy snow",
  77: "snow grains",
  80: "light rain showers",
  81: "rain showers",
  82: "violent rain showers",
  85: "light snow showers",
  86: "snow showers",
  95: "thunderstorm",
  96: "thunderstorm with hail",
  99: "thunderstorm with heavy hail",
};

export function describeWeatherCode(code: number): string {
  return WMO_DESCRIPTIONS[code] ?? "unsettled";
}

/**
 * A forecast day expressed in the `WeatherData` shape the daily plan stores and
 * renders. Needed because a plan can be generated for a date that isn't today —
 * regenerating Thursday from the week view must reason about Thursday's weather,
 * not this moment's. `temp` is the midpoint of the day's range and `feels_like`
 * mirrors it, since a daily forecast has no apparent-temperature equivalent;
 * `wind_speed` is 0 for the same reason. Returns null when the date is outside the
 * forecast horizon rather than guessing.
 */
export async function getForecastAsCurrent(
  lat: number,
  lon: number,
  date: string,
  city: string | null
): Promise<WeatherData | null> {
  const today = new Date().toISOString().slice(0, 10);
  const offset = Math.round(
    (new Date(`${date}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000
  );
  if (offset < 0) return null;

  try {
    const forecast = await getForecast(lat, lon, offset + 1);
    const day = forecast.find((entry) => entry.date === date);
    if (!day) return null;

    return {
      city: city || "your location",
      temp: Math.round((day.tempMin + day.tempMax) / 2),
      feels_like: Math.round((day.tempMin + day.tempMax) / 2),
      humidity: 0,
      description: describeWeatherCode(day.code),
      icon: "",
      wind_speed: 0,
    };
  } catch (err) {
    console.error("getForecastAsCurrent error:", err);
    return null;
  }
}

export async function getForecast(
  lat: number,
  lon: number,
  days: number
): Promise<DailyForecast[]> {
  const live = await fetchLiveForecast(lat, lon, days);
  if (days <= MAX_FORECAST_DAYS) return live;

  // Extended dates start the day after the live window and run to the requested horizon.
  const today = new Date(`${toISODate(new Date())}T00:00:00Z`);
  const estimateStart = addDays(today, MAX_FORECAST_DAYS);
  const estimateEnd = addDays(today, days - 1);
  const estimate = await fetchClimateEstimate(lat, lon, estimateStart, estimateEnd);

  return [...live, ...estimate];
}
