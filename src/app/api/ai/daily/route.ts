import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase/server";
import { getWeather, type WeatherData } from "@/lib/weather";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

interface DailyPick {
  itemIds: string[];
  reasoning: string;
  gap?: string;
}

function parseDailyPick(text: string): DailyPick | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed.itemIds)) return null;
    return {
      itemIds: parsed.itemIds.filter((id: unknown) => typeof id === "string"),
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
      gap: typeof parsed.gap === "string" ? parsed.gap : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * GET /api/ai/daily
 * Server-side pulls today's weather (via profile city) + the user's active wardrobe,
 * asks Claude to pick one outfit from owned items only, returns it plus the weather
 * used to make the pick. Calendar context is not wired up yet (no OAuth/schema for it).
 */
export async function GET() {
  try {
    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("name, city, body_shape, preference_dna")
      .eq("id", user.id)
      .single();

    const { data: items } = await supabase
      .from("wardrobe_items")
      .select("id, category, subcategory, color, material, season, occasion, style_tags, brand, clean_url, original_url")
      .eq("user_id", user.id)
      .eq("archived", false)
      .limit(150);

    const wardrobe = items || [];
    if (wardrobe.length < 2) {
      return NextResponse.json({
        weather: null,
        outfit: null,
        message: "Add at least a couple of items to your closet to get a daily recommendation.",
      });
    }

    let weather: WeatherData | null = null;
    if (profile?.city) {
      weather = await getWeather(profile.city);
    }

    const wardrobeSummary = wardrobe.map((item) => ({
      id: item.id,
      type: `${item.category} — ${item.subcategory || "unknown"}`,
      color: item.color,
      material: item.material,
      seasons: item.season,
      occasions: item.occasion,
      tags: item.style_tags,
    }));

    const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

    const systemPrompt = `You are an expert personal stylist AI. Pick exactly ONE outfit for today from the user's ACTUAL wardrobe below — never invent items.

TODAY: ${today}
${weather ? `WEATHER: ${weather.temp}°C (feels like ${weather.feels_like}°C), ${weather.description}, wind ${weather.wind_speed} m/s, in ${weather.city}` : "WEATHER: unknown, no city set in profile"}

USER PROFILE:
${profile ? `Name: ${profile.name || "User"}, Body Shape: ${profile.body_shape || "Unknown"}` : "No profile data"}
${profile?.preference_dna ? `Preferences: ${JSON.stringify(profile.preference_dna)}` : ""}

USER'S WARDROBE (${wardrobeSummary.length} items):
${JSON.stringify(wardrobeSummary, null, 2)}

Pick 2-5 items by id that form one coherent outfit appropriate for the weather (if known) and generally versatile for a workday if weather is unknown. Respond with ONLY this JSON, no other text:
{"itemIds": ["<id>", "<id>"], "reasoning": "1-2 sentences on why this works today", "gap": "optional: one thing missing from their wardrobe that would improve this outfit, omit if nothing"}`;

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: "user", content: "Pick today's outfit." }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const text = textBlock && textBlock.type === "text" ? textBlock.text : "";
    const pick = parseDailyPick(text);

    if (!pick || pick.itemIds.length === 0) {
      return NextResponse.json({
        weather,
        outfit: null,
        message: "Couldn't put together a recommendation right now. Try the AI Stylist chat instead.",
      });
    }

    const byId = new Map(wardrobe.map((item) => [item.id, item]));
    const outfitItems = pick.itemIds
      .map((id) => byId.get(id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    if (outfitItems.length === 0) {
      return NextResponse.json({
        weather,
        outfit: null,
        message: "Couldn't put together a recommendation right now. Try the AI Stylist chat instead.",
      });
    }

    return NextResponse.json({
      weather,
      outfit: {
        items: outfitItems,
        reasoning: pick.reasoning,
        gap: pick.gap,
      },
    });
  } catch (err) {
    console.error("Daily recommendation error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Daily recommendation failed" },
      { status: 500 }
    );
  }
}
