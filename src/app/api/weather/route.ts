import { NextRequest, NextResponse } from "next/server";
import { getCurrentWeather } from "@/lib/weather/openweather";
import { geocodeCity } from "@/lib/weather/geocode";

/**
 * GET /api/weather?lat=..&lon=.. or ?city=New+York
 *
 * Ad-hoc lookup endpoint, not part of the daily/weekly/travel hot path (those read a
 * profile's/trip's stored lat/lng and never geocode per request). `city` is accepted here
 * purely for convenience and geocodes on every call — fine for occasional ad-hoc use, not a
 * pattern to copy for anything called repeatedly.
 */
export async function GET(request: NextRequest) {
  if (!process.env.OPENWEATHER_API_KEY) {
    return NextResponse.json({ error: "Weather API not configured" }, { status: 503 });
  }

  const latParam = request.nextUrl.searchParams.get("lat");
  const lonParam = request.nextUrl.searchParams.get("lon");
  const city = request.nextUrl.searchParams.get("city");

  let lat: number, lon: number;
  if (latParam && lonParam) {
    lat = Number(latParam);
    lon = Number(lonParam);
  } else if (city) {
    const geo = await geocodeCity(city);
    if (!geo) {
      return NextResponse.json({ error: "Could not resolve city" }, { status: 502 });
    }
    lat = geo.lat;
    lon = geo.lon;
  } else {
    return NextResponse.json({ error: "lat/lon or city parameter required" }, { status: 400 });
  }

  const weather = await getCurrentWeather(lat, lon);
  if (!weather) {
    return NextResponse.json({ error: "Weather fetch failed" }, { status: 502 });
  }

  return NextResponse.json(weather);
}
