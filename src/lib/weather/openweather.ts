import type { WeatherData } from "./types";

/**
 * OpenWeather provider — current conditions only (`current(lat, lon)` per the ROADMAP
 * Phase 6.0-E provider contract in `./types`).
 *
 * Takes lat/lon, not a city name — the provider layer doesn't know what a "city" is. Callers
 * that only have a city name (a profile, a trip destination) resolve it once via
 * `geocodeCity()` (`./geocode`) at save time and pass the stored coordinates here, so this
 * never triggers a geocoding call itself. D2: daily keeps using OpenWeather, unchanged.
 * Degrades gracefully to `null` when no `OPENWEATHER_API_KEY` is configured.
 */
export async function getCurrentWeather(lat: number, lon: number): Promise<WeatherData | null> {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${apiKey}`
    );
    const data = await res.json();
    if (!res.ok) return null;

    return {
      city: data.name,
      temp: Math.round(data.main.temp),
      feels_like: Math.round(data.main.feels_like),
      humidity: data.main.humidity,
      description: data.weather?.[0]?.description || "",
      icon: data.weather?.[0]?.icon || "",
      wind_speed: data.wind?.speed || 0,
    };
  } catch (err) {
    console.error("Weather fetch error:", err);
    return null;
  }
}
