import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { geocodeCity } from "@/lib/weather/geocode";

export const dynamic = "force-dynamic";

interface LocationBody {
  location?: unknown;
}

/**
 * PATCH /api/calendar/events/:id/location
 *
 * Saves a planning-only city/region override for a synced Google event. The raw
 * Google location remains untouched, so subsequent read-only Calendar syncs cannot
 * overwrite the user's correction. An empty location clears the override and makes
 * planning use the original Calendar location again.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as LocationBody | null;
  if (!body || typeof body.location !== "string") {
    return NextResponse.json(
      { error: "location must be a city or region, or an empty string to reset it" },
      { status: 400 }
    );
  }

  const location = body.location.trim();
  if (location.length > 160) {
    return NextResponse.json({ error: "Location is too long" }, { status: 400 });
  }

  if (!location) {
    const { data, error } = await supabase
      .from("calendar_events")
      .update({
        location_override: null,
        weather_city_override: null,
        weather_lat_override: null,
        weather_lng_override: null,
        weather_timezone_override: null,
      })
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id, location, weather_city")
      .maybeSingle();

    if (error) {
      console.error("calendar location reset failed:", error);
      return NextResponse.json({ error: "Couldn't reset the event location" }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Calendar event not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      eventId: data.id,
      location: data.location,
      weatherCity: data.weather_city,
      overridden: false,
    });
  }

  const geo = await geocodeCity(location);
  if (!geo) {
    return NextResponse.json(
      { error: "Couldn't find that city or region. Try adding a state or country." },
      { status: 422 }
    );
  }

  const { data, error } = await supabase
    .from("calendar_events")
    .update({
      location_override: location,
      weather_city_override: geo.name ?? location,
      weather_lat_override: geo.lat,
      weather_lng_override: geo.lon,
      weather_timezone_override: geo.timezone ?? null,
    })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("calendar location override failed:", error);
    return NextResponse.json({ error: "Couldn't save the event location" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Calendar event not found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    eventId: data.id,
    location,
    weatherCity: geo.name ?? location,
    overridden: true,
  });
}
