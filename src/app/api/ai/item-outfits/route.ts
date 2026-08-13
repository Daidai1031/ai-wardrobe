import Anthropic from "@anthropic-ai/sdk";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  findCompositionViolations,
  findCoverageViolations,
  type RuleDay,
} from "@/lib/planning/plan-rules";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

interface GeneratedLook {
  name: string;
  summary: string;
  itemIds: string[];
  stylingNotes: string[];
}

const ITEM_LOOKS_TOOL: Tool = {
  name: "return_item_looks",
  description: "Return exactly three complete, distinct looks built around the required item.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      looks: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            summary: { type: "string" },
            itemIds: {
              type: "array",
              minItems: 2,
              maxItems: 6,
              uniqueItems: true,
              items: { type: "string" },
            },
            stylingNotes: {
              type: "array",
              maxItems: 4,
              items: { type: "string" },
            },
          },
          required: ["name", "summary", "itemIds", "stylingNotes"],
        },
      },
    },
    required: ["looks"],
  },
};

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function strings(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
    .map((entry) => entry.trim())
    .slice(0, limit);
}

function normalizeLooks(input: unknown): GeneratedLook[] {
  if (!input || typeof input !== "object") return [];
  const raw = (input as { looks?: unknown }).looks;
  if (!Array.isArray(raw)) return [];

  return raw.slice(0, 3).map((entry, index) => {
    const look = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    return {
      name: text(look.name, `Three ways look ${index + 1}`),
      summary: text(look.summary, "A complete look built around this piece."),
      itemIds: [...new Set(strings(look.itemIds, 6))],
      stylingNotes: strings(look.stylingNotes, 4),
    };
  });
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { itemId?: unknown };
  try {
    body = (await request.json()) as { itemId?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const itemId = typeof body.itemId === "string" ? body.itemId : "";
  if (!itemId) return NextResponse.json({ error: "An item id is required" }, { status: 400 });

  try {
    const [{ data: wardrobeRows, error: wardrobeError }, { data: profile, error: profileError }] =
      await Promise.all([
        supabase
          .from("wardrobe_items")
          .select(
            "id, display_name, user_notes, category, subcategory, color, colors, material, season, occasion, style_tags, brand, favorite"
          )
          .eq("user_id", user.id)
          .eq("archived", false)
          .limit(120),
        supabase
          .from("profiles")
          .select("name, body_shape, preference_dna")
          .eq("id", user.id)
          .single(),
      ]);

    if (wardrobeError) throw wardrobeError;
    if (profileError) throw profileError;

    const wardrobe = wardrobeRows ?? [];
    const target = wardrobe.find((item) => item.id === itemId);
    if (!target) {
      return NextResponse.json({ error: "Item not found in your active closet" }, { status: 404 });
    }

    const { data: existing, error: existingError } = await supabase
      .from("outfit_items")
      .select("outfit_id")
      .eq("item_id", itemId)
      .limit(1);
    if (existingError) throw existingError;
    if ((existing ?? []).length > 0) {
      return NextResponse.json(
        { error: "This piece already appears in a saved Look. Refresh to see it." },
        { status: 409 }
      );
    }

    const categoryById = new Map(wardrobe.map((item) => [item.id, item.category]));
    const availableCategories = new Set(wardrobe.map((item) => item.category));
    const hasBody =
      availableCategories.has("Dresses") ||
      (availableCategories.has("Tops") && availableCategories.has("Bottoms"));
    if (!hasBody || !availableCategories.has("Shoes")) {
      return NextResponse.json(
        { error: "Add enough tops/bottoms or a dress, plus shoes, before generating complete looks." },
        { status: 422 }
      );
    }

    const wardrobeSummary = wardrobe.map((item) => ({
      id: item.id,
      name: item.display_name || null,
      type: `${item.category} — ${item.subcategory || "unknown"}`,
      color: item.color,
      colors: item.colors,
      brand: item.brand,
      material: item.material,
      seasons: item.season,
      occasions: item.occasion,
      tags: item.style_tags,
      favorite: item.favorite,
      userNotes: item.user_notes || null,
    }));

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1_800,
      system: `You are a thoughtful personal stylist. Build exactly three polished, materially different ways to wear one required piece, using only the supplied wardrobe.

CLIENT PROFILE:
${profile ? `Name: ${profile.name || "User"}; Body shape: ${profile.body_shape || "Unknown"}` : "No profile data"}
${profile?.preference_dna ? `Preferences: ${JSON.stringify(profile.preference_dna)}` : ""}

REQUIRED ITEM ID: ${itemId}

ACTIVE WARDROBE:
${JSON.stringify(wardrobeSummary)}

RULES:
- Every look must include REQUIRED ITEM ID and 2–6 unique owned item ids.
- Return exactly three distinct complete outfits. Vary the mood or styling purpose, not just an accessory.
- Every look must cover torso, legs, and feet: a dress covers torso and legs; otherwise use a top and bottom; always include shoes.
- Never combine a dress with a top or bottom. Use at most one bottom, dress, pair of shoes, or bag; at most two tops or outerwear pieces.
- A non-empty "name" is the user's authoritative item name. Use it verbatim in copy. Treat "userNotes" as authoritative constraints.
- Give each look a concise name, one useful summary, and practical styling notes. Write in English.

You MUST finish by calling return_item_looks exactly once.`,
      messages: [
        {
          role: "user",
          content: "Create three complete and genuinely different looks around the required item.",
        },
      ],
      tools: [ITEM_LOOKS_TOOL],
      tool_choice: {
        type: "tool",
        name: ITEM_LOOKS_TOOL.name,
        disable_parallel_tool_use: true,
      },
    });

    const toolBlock = response.content.find(
      (block) => block.type === "tool_use" && block.name === ITEM_LOOKS_TOOL.name
    );
    const looks = normalizeLooks(toolBlock?.type === "tool_use" ? toolBlock.input : null);
    const ownedIds = new Set(wardrobe.map((item) => item.id));
    const distinctSets = new Set<string>();

    const valid =
      looks.length === 3 &&
      looks.every((look) => {
        if (
          look.itemIds.length < 2 ||
          !look.itemIds.includes(itemId) ||
          look.itemIds.some((id) => !ownedIds.has(id))
        ) {
          return false;
        }

        const day: RuleDay[] = [{ planDate: "generated", segments: [{ itemIds: look.itemIds }] }];
        if (
          findCompositionViolations(day, (id) => categoryById.get(id) || "Unknown").length > 0 ||
          findCoverageViolations(day, (id) => categoryById.get(id) || "Unknown").length > 0
        ) {
          return false;
        }

        distinctSets.add([...look.itemIds].sort().join(","));
        return true;
      }) &&
      distinctSets.size === 3;

    if (!valid) {
      return NextResponse.json(
        { error: "The stylist couldn't produce three complete distinct looks. Please try again." },
        { status: 502 }
      );
    }

    // Recheck after the model call so a second browser tab cannot usually create
    // another batch while this request is generating.
    const { data: appearedWhileGenerating, error: recheckError } = await supabase
      .from("outfit_items")
      .select("outfit_id")
      .eq("item_id", itemId)
      .limit(1);
    if (recheckError) throw recheckError;
    if ((appearedWhileGenerating ?? []).length > 0) {
      return NextResponse.json(
        { error: "Looks for this piece were added while generation was running. Refresh to see them." },
        { status: 409 }
      );
    }

    const createdIds: string[] = [];
    try {
      for (const look of looks) {
        const notes = [look.summary, ...look.stylingNotes].filter(Boolean).join("\n");
        const { data: outfit, error: outfitError } = await supabase
          .from("outfits")
          .insert({
            user_id: user.id,
            name: look.name,
            folder: "Uncategorized",
            notes,
            ai_generated: true,
            ai_reasoning: look.summary,
          })
          .select("id")
          .single();
        if (outfitError || !outfit) throw outfitError || new Error("Outfit insert failed");
        createdIds.push(outfit.id);

        const { error: itemsError } = await supabase.from("outfit_items").insert(
          look.itemIds.map((generatedItemId, position) => ({
            outfit_id: outfit.id,
            item_id: generatedItemId,
            position,
            x: null,
            y: null,
            width: null,
          }))
        );
        if (itemsError) throw itemsError;
      }
    } catch (writeError) {
      if (createdIds.length > 0) {
        await supabase.from("outfits").delete().eq("user_id", user.id).in("id", createdIds);
      }
      throw writeError;
    }

    return NextResponse.json({ created: createdIds.length, outfitIds: createdIds });
  } catch (error) {
    console.error("Generate item looks failed:", error);
    return NextResponse.json({ error: "Couldn't generate looks right now. Please try again." }, { status: 500 });
  }
}
