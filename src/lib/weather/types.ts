/**
 * Shared weather types + the provider contract (ROADMAP Phase 6.0-E / decision D2).
 *
 * Two providers live behind this contract:
 *   - openweather.ts  — current conditions for the daily recommendation (already live, unchanged)
 *   - open-meteo.ts   — multi-day forecast for weekly/travel planning (no API key, 16-day range)
 *
 * The abstraction exists so we can swap providers later without touching callers. D2: daily
 * keeps using OpenWeather; weekly/travel use Open-Meteo. When the project turns commercial,
 * Open-Meteo's free tier (non-commercial + CC BY 4.0 attribution) forces a switch — either
 * buy its customer API or route everything back through OpenWeather here.
 */

/** Current conditions — what OpenWeather returns and the daily pick consumes. */
export interface WeatherData {
  city: string;
  temp: number;
  feels_like: number;
  humidity: number;
  description: string;
  icon: string;
  wind_speed: number;
}

/**
 * One day of forecast, normalized across providers.
 * `code` is a WMO weather code (Open-Meteo's native scale).
 * `isEstimate` is true when the date is beyond the live-forecast window and the values are a
 * historical climate average instead of a real forecast — travel mode MUST surface this in the
 * UI and never mix estimates in with real forecast days.
 */
export interface DailyForecast {
  date: string; // YYYY-MM-DD, in the location's local timezone
  tempMin: number; // °C
  tempMax: number; // °C
  precipitation: number; // mm
  code: number; // WMO weather code
  isEstimate: boolean;
}

/** A resolved coordinate, e.g. from geocoding a profile's `city`. */
export interface GeoPoint {
  lat: number;
  lon: number;
  name?: string;
  timezone?: string;
}

/**
 * The provider contract. Each concrete provider implements the subset it supports (OpenWeather
 * → current, Open-Meteo → forecast); callers pick the provider that offers what they need.
 * Kept as a type-level contract rather than forcing every provider into one class, matching the
 * repo's functional style (providers export plain async functions).
 */
export interface WeatherProvider {
  current?(lat: number, lon: number): Promise<WeatherData | null>;
  forecast?(lat: number, lon: number, days: number): Promise<DailyForecast[]>;
}
