import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/weather?city=New+York
 */
export async function GET(request: NextRequest) {
  const city = request.nextUrl.searchParams.get("city");
  if (!city) {
    return NextResponse.json({ error: "city parameter required" }, { status: 400 });
  }

  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Weather API not configured" }, { status: 503 });
  }

  try {
    const res = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&units=metric&appid=${apiKey}`
    );
    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json({ error: data.message || "Weather fetch failed" }, { status: res.status });
    }

    return NextResponse.json({
      city: data.name,
      temp: Math.round(data.main.temp),
      feels_like: Math.round(data.main.feels_like),
      humidity: data.main.humidity,
      description: data.weather?.[0]?.description || "",
      icon: data.weather?.[0]?.icon || "",
      wind_speed: data.wind?.speed || 0,
    });
  } catch (err) {
    console.error("Weather error:", err);
    return NextResponse.json({ error: "Weather service unavailable" }, { status: 500 });
  }
}
