import type { GeoPoint } from "./types";

/**
 * City name → coordinates, via Open-Meteo's free geocoding endpoint (no API key).
 *
 * Call this only when a location is entered or imported: profile save,
 * trip creation, Calendar enrichment, or a user's Calendar-location correction.
 * Persist the result on that row. Every other weather
 * call reads the stored coordinates. The provider layer (openweather.ts, open-meteo.ts)
 * deliberately only accepts lat/lon and knows nothing about city names, so callers never
 * have to re-geocode just to fetch today's forecast — city names barely ever change
 * coordinates, so caching this is pure savings, not a correctness tradeoff.
 */
const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";

// Open-Meteo indexes municipalities more reliably than colloquial regions. Keep
// the user's familiar label while anchoring a well-known region to a representative
// municipality inside it. This is weather-scale resolution, not street navigation.
const PLACE_ALIASES: Record<
  string,
  { query: string; name: string; countryCode: string; admin1: string }
> = {
  hamptons: {
    query: "East Hampton",
    name: "Hamptons",
    countryCode: "US",
    admin1: "New York",
  },
  "the hamptons": {
    query: "East Hampton",
    name: "Hamptons",
    countryCode: "US",
    admin1: "New York",
  },
};

export async function geocodeCity(city: string): Promise<GeoPoint | null> {
  try {
    const alias = PLACE_ALIASES[city.trim().toLowerCase()];
    const res = await fetch(
      `${GEOCODE_URL}?name=${encodeURIComponent(alias?.query ?? city)}&count=${alias ? 10 : 1}&language=en&format=json`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    const hit = alias
      ? results.find(
          (entry: { country_code?: unknown; admin1?: unknown }) =>
            entry.country_code === alias.countryCode && entry.admin1 === alias.admin1
        )
      : results[0];
    if (!hit || typeof hit.latitude !== "number" || typeof hit.longitude !== "number") {
      return null;
    }
    return {
      lat: hit.latitude,
      lon: hit.longitude,
      name: alias?.name ?? hit.name,
      timezone: hit.timezone,
    };
  } catch (err) {
    console.error("geocodeCity error:", err);
    return null;
  }
}
