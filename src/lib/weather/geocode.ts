import type { GeoPoint } from "./types";

/**
 * City name → coordinates, via Open-Meteo's free geocoding endpoint (no API key).
 *
 * Call this ONLY at the two moments a city name is entered by a user — profile save
 * (`profiles.city` → `lat`/`lng`) and trip creation (`travel_plans.destination` →
 * `destination_lat`/`destination_lng`) — then persist the result. Every other weather
 * call reads the stored coordinates. The provider layer (openweather.ts, open-meteo.ts)
 * deliberately only accepts lat/lon and knows nothing about city names, so callers never
 * have to re-geocode just to fetch today's forecast — city names barely ever change
 * coordinates, so caching this is pure savings, not a correctness tradeoff.
 */
const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";

export async function geocodeCity(city: string): Promise<GeoPoint | null> {
  try {
    const res = await fetch(
      `${GEOCODE_URL}?name=${encodeURIComponent(city)}&count=1&language=en&format=json`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const hit = data?.results?.[0];
    if (!hit || typeof hit.latitude !== "number" || typeof hit.longitude !== "number") {
      return null;
    }
    return {
      lat: hit.latitude,
      lon: hit.longitude,
      name: hit.name,
      timezone: hit.timezone,
    };
  } catch (err) {
    console.error("geocodeCity error:", err);
    return null;
  }
}
