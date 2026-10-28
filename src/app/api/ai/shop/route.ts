import Anthropic from "@anthropic-ai/sdk";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { readRotationLimits } from "@/lib/planning/plans";
import { closetFingerprint, detectGaps, type ClosetGap } from "@/lib/shop/detect-gaps";
import { brandSearchUrl, candidateBrands, type ShopBrand } from "@/lib/shop/brands";
import { SHOPPING_TIERS, type ShoppingRecommendation, type ShoppingTier } from "@/types/database";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

/** Brands named per gap. */
const MAX_BRANDS_PER_GAP = 3;

const SHOP_TOOL: Tool = {
  name: "return_gap_recommendations",
  description: "Return one recommendation per closet gap.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      recommendations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            gapKey: { type: "string" },
            summary: { type: "string" },
            brands: { type: "array", minItems: 1, maxItems: MAX_BRANDS_PER_GAP, items: { type: "string" } },
          },
          required: ["gapKey", "summary", "brands"],
        },
      },
    },
    required: ["recommendations"],
  },
};

// Notes the seed file uses to flag a row for review; the model has no use for them.
const REVIEW_MARKER = /;?\s*Draft category\/tier by Claude, please review/i;

/**
 * Closet gaps → where to shop for them (ROADMAP Phase 9-A).
 *
 * The gaps are detected in TypeScript and the brands each gap may be offered are chosen
 * in TypeScript; the one model call only words each gap for this person and picks two or
 * three brands from its own candidate list. Anything it names outside that list is dropped,
 * and a gap it skips falls back to the top candidates with the plain description, so a bad
 * response degrades to a less personal answer rather than to none.
 *
 * Results are cached per gap in `shopping_recommendations` and regenerated only when the
 * closet or the tier changed since. Saved and dismissed rows are the user's answer and are
 * never overwritten.
 */
export async function POST() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [{ data: profile }, { data: items, error: itemsError }, rotationLimits, { data: existing }] = await Promise.all([
    supabase.from("profiles").select("shopping_tier, body_shape, city").eq("id", user.id).single(),
    supabase
      .from("wardrobe_items")
      .select("id, category, subcategory, display_name, color, colors, season, occasion, style_tags, brand")
      .eq("user_id", user.id)
      .eq("archived", false),
    readRotationLimits(supabase, user.id),
    supabase.from("shopping_recommendations").select("*").eq("user_id", user.id),
  ]);

  if (itemsError) return NextResponse.json({ error: "Could not read your closet" }, { status: 500 });

  const tier = profile?.shopping_tier as ShoppingTier | null;
  if (!tier || !SHOPPING_TIERS.includes(tier)) {
    return NextResponse.json({ error: "Choose a price range first" }, { status: 400 });
  }

  const closet = items ?? [];
  const gaps = detectGaps(closet, rotationLimits);
  const fingerprint = closetFingerprint(closet);
  const byKey = new Map(((existing ?? []) as ShoppingRecommendation[]).map((row) => [row.gap_key, row]));

  const stale = gaps.filter((gap) => {
    const row = byKey.get(gap.key);
    if (!row) return true;
    if (row.status !== "new") return false;
    return row.closet_fingerprint !== fingerprint || row.tier !== tier || !row.summary;
  });

  if (stale.length > 0) {
    const { data: brandRows, error: brandError } = await createServiceSupabase()
      .from("shop_brands")
      .select("name, categories, tier, tags, notes, priority")
      .eq("active", true);
    if (brandError) {
      console.error("shop_brands read failed:", brandError.message);
      return NextResponse.json({ error: "Brand list unavailable" }, { status: 500 });
    }
    const brands = (brandRows ?? []) as ShopBrand[];
    const candidates = new Map(stale.map((gap) => [gap.key, candidateBrands(brands, gap, tier)]));

    const written = await wordAndPick(stale, candidates, closet, profile);

    const rows = stale.map((gap) => {
      const pick = written.get(gap.key);
      const offered = candidates.get(gap.key) ?? [];
      const allowed = new Map(offered.map((b) => [b.name.toLowerCase(), b.name]));
      let names = (pick?.brands ?? [])
        .map((name) => allowed.get(name.trim().toLowerCase()))
        .filter((name): name is string => Boolean(name));
      names = [...new Set(names)].slice(0, MAX_BRANDS_PER_GAP);
      if (names.length === 0) names = offered.slice(0, 2).map((b) => b.name);

      return {
        user_id: user.id,
        gap_key: gap.key,
        gap,
        summary: pick?.summary || gap.description,
        brands: names.map((name) => ({ name, url: brandSearchUrl(name, gap) })),
        tier,
        closet_fingerprint: fingerprint,
        status: "new",
        updated_at: new Date().toISOString(),
      };
    });

    const { error: upsertError } = await supabase
      .from("shopping_recommendations")
      .upsert(rows, { onConflict: "user_id,gap_key" });
    if (upsertError) {
      console.error("shopping_recommendations upsert failed:", upsertError.message);
      return NextResponse.json({ error: "Could not save suggestions" }, { status: 500 });
    }
  }

  const { data: fresh } = await supabase.from("shopping_recommendations").select("*").eq("user_id", user.id);
  return NextResponse.json({ recommendations: fresh ?? [], fingerprint });
}

async function wordAndPick(
  gaps: ClosetGap[],
  candidates: Map<string, ShopBrand[]>,
  closet: { category: string; color: string | null; style_tags: string[] | null; brand: string | null }[],
  profile: { body_shape: string | null; city: string | null } | null
): Promise<Map<string, { summary: string; brands: string[] }>> {
  const result = new Map<string, { summary: string; brands: string[] }>();
  const askable = gaps.filter((gap) => (candidates.get(gap.key) ?? []).length > 0);
  if (askable.length === 0) return result;

  const count = (values: (string | null | undefined)[]) => {
    const tally = new Map<string, number>();
    values.filter(Boolean).forEach((v) => tally.set(v!.toLowerCase(), (tally.get(v!.toLowerCase()) ?? 0) + 1));
    return [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([v]) => v);
  };
  const closetSummary = {
    pieces: closet.length,
    topColors: count(closet.map((i) => i.color)),
    styleTags: count(closet.flatMap((i) => i.style_tags ?? [])),
    brandsOwned: count(closet.map((i) => i.brand)),
  };

  const brief = askable.map((gap) => ({
    gapKey: gap.key,
    whatIsMissing: gap.description,
    category: gap.category,
    occasion: gap.occasion,
    season: gap.season,
    wouldGoWithOwnedPieces: gap.pairsWith,
    brandsInOrderOfPreference: (candidates.get(gap.key) ?? []).map((b) => ({
      name: b.name,
      tier: b.tier,
      tags: b.tags,
      note: b.notes?.replace(REVIEW_MARKER, "").trim() || undefined,
    })),
  }));

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1_500,
      system: `You are a personal stylist explaining what a client's closet is missing and where to shop for it.

CLIENT: ${JSON.stringify({ bodyShape: profile?.body_shape ?? null, city: profile?.city ?? null, ...closetSummary })}

GAPS (detected from the closet; do not add, remove or question them):
${JSON.stringify(brief)}

RULES:
- One recommendation per gap, using its exact gapKey.
- "summary": one or two sentences in English saying what to look for (cut, colour, material) so it works with what the client already owns. Mention how many owned pieces it would go with when that number is useful.
- "brands": 2 or 3 names copied exactly from that gap's brandsInOrderOfPreference. Prefer earlier names; skip one only when a later brand clearly fits the gap or the client's style better. Never name a brand that is not in the list.
- No prices, no product names, no links.

You MUST finish by calling return_gap_recommendations exactly once.`,
      messages: [{ role: "user", content: "Write the recommendations." }],
      tools: [SHOP_TOOL],
      tool_choice: { type: "tool", name: SHOP_TOOL.name, disable_parallel_tool_use: true },
    });

    const block = response.content.find((b) => b.type === "tool_use" && b.name === SHOP_TOOL.name);
    const input = block?.type === "tool_use" ? (block.input as { recommendations?: unknown }) : null;
    const list = Array.isArray(input?.recommendations) ? input.recommendations : [];
    for (const raw of list) {
      const rec = raw as { gapKey?: unknown; summary?: unknown; brands?: unknown };
      if (typeof rec.gapKey !== "string") continue;
      result.set(rec.gapKey, {
        summary: typeof rec.summary === "string" ? rec.summary.trim() : "",
        brands: Array.isArray(rec.brands) ? rec.brands.filter((b): b is string => typeof b === "string") : [],
      });
    }
  } catch (error) {
    // Falls back to the plain description and the top-ranked brands for every gap.
    console.error("Shop recommendation call failed:", error);
  }
  return result;
}
