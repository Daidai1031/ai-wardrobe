import { NextRequest, NextResponse } from "next/server";
import { geocodeCity } from "@/lib/weather/geocode";

/**
 * GET /api/geocode?city=New+York
 *
 * The public convenience entry point for turning a user-entered city into coordinates.
 * Profile and future trip forms persist the result themselves. Calendar sync and the
 * authenticated event-location route call geocodeCity() server-side and persist there.
 * Weather fetches never geocode again.
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
