import { NextRequest, NextResponse } from "next/server";
import { geocodeCity } from "@/lib/weather/geocode";

/**
 * GET /api/geocode?city=New+York
 *
 * The one place city names get turned into coordinates. Called only at the two moments a
 * user types a city — profile save (`profiles.city` → `lat`/`lng`, see profile-form.tsx) and
 * trip creation (`travel_plans.destination` → `destination_lat`/`destination_lng`, Phase 6.3)
 * — never on every weather fetch. Callers persist the result themselves.
 */
export async function GET(request: NextRequest) {
  const city = request.nextUrl.searchParams.get("city");
  if (!city) {
    return NextResponse.json({ error: "city parameter required" }, { status: 400 });
  }

  const geo = await geocodeCity(city);
  if (!geo) {
    return NextResponse.json({ error: "Could not resolve city" }, { status: 502 });
  }

  return NextResponse.json(geo);
}
