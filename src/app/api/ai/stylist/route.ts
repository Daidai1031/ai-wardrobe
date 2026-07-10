import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase/server";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

/**
 * POST /api/ai/stylist
 * Body: { message: string, context?: { weather?, calendar?, wardrobe_summary? } }
 *
 * The AI stylist has access to the user's wardrobe items (passed as context)
 * and can recommend outfits from their actual closet.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { message, context } = await request.json();

    // Fetch user's wardrobe for context
    const { data: items } = await supabase
      .from("wardrobe_items")
      .select("id, category, subcategory, color, colors, material, season, occasion, style_tags, brand, clean_url")
      .eq("user_id", user.id)
      .eq("archived", false)
      .limit(100);

    // Fetch user profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("name, city, body_shape, preference_dna")
      .eq("id", user.id)
      .single();

    const wardrobeSummary = (items || []).map((item) => ({
      id: item.id,
      type: `${item.category} — ${item.subcategory || "unknown"}`,
      color: item.color,
      material: item.material,
      seasons: item.season,
      occasions: item.occasion,
      tags: item.style_tags,
    }));

    const systemPrompt = `You are an expert personal stylist AI for executive women. You have access to the user's actual wardrobe and should ONLY recommend items they own.

USER PROFILE:
${profile ? `Name: ${profile.name || "User"}, City: ${profile.city || "Unknown"}, Body Shape: ${profile.body_shape || "Unknown"}` : "No profile data"}
${profile?.preference_dna ? `Preferences: ${JSON.stringify(profile.preference_dna)}` : ""}

USER'S WARDROBE (${wardrobeSummary.length} items):
${JSON.stringify(wardrobeSummary, null, 2)}

${context?.weather ? `WEATHER TODAY: ${JSON.stringify(context.weather)}` : ""}
${context?.calendar ? `CALENDAR: ${JSON.stringify(context.calendar)}` : ""}

GUIDELINES:
- Reference specific items from the wardrobe by their type, color, and material
- Explain WHY each piece works for the occasion
- Suggest 1 main outfit + 1 alternative
- Keep advice practical and confidence-building
- If the wardrobe lacks something, note it as a "gap" they could fill
- Respond in the same language the user writes in`;

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: message }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";

    return NextResponse.json({ reply: text });
  } catch (err) {
    console.error("Stylist error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Stylist failed" },
      { status: 500 }
    );
  }
}
