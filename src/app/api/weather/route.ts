import { NextRequest, NextResponse } from "next/server";
import { getWeather } from "@/lib/weather";

/**
 * GET /api/weather?city=New+York
 */
export async function GET(request: NextRequest) {
  const city = request.nextUrl.searchParams.get("city");
  if (!city) {
    return NextResponse.json({ error: "city parameter required" }, { status: 400 });
  }

  if (!process.env.OPENWEATHER_API_KEY) {
    return NextResponse.json({ error: "Weather API not configured" }, { status: 503 });
  }

  const weather = await getWeather(city);
  if (!weather) {
    return NextResponse.json({ error: "Weather fetch failed" }, { status: 502 });
  }

  return NextResponse.json(weather);
}
