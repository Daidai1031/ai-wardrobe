import Anthropic from "@anthropic-ai/sdk";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import type {
  StylistQuestionResponse,
  StylistRecommendationResponse,
  StylistResponse,
  StylistWardrobeItem,
} from "@/types/stylist";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

interface ClientMessage {
  role: "user" | "assistant";
  content: string;
}

interface ModelQuestion {
  type: "question";
  reply?: unknown;
  questions?: unknown;
}

interface ModelRecommendation {
  type: "recommendation";
  reply?: unknown;
  look?: {
    name?: unknown;
    summary?: unknown;
    itemIds?: unknown;
    reasoning?: unknown;
    stylingNotes?: unknown;
    gap?: unknown;
  };
}

const STYLIST_RESPONSE_TOOL: Tool = {
  name: "return_stylist_response",
  description:
    "Return either the next focused discovery questions or one visual wardrobe recommendation. This is the only allowed final response.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      type: {
        type: "string",
        enum: ["question", "recommendation"],
        description:
          "Use question when essential context is missing; otherwise use recommendation.",
      },
      reply: {
        type: "string",
        description: "A brief empathetic setup in the same language as the client.",
      },
      questions: {
        type: "array",
        maxItems: 2,
        items: { type: "string" },
        description: "For type=question, the 1–2 highest-value questions. Otherwise omit.",
      },
      look: {
        type: "object",
        additionalProperties: false,
        description: "Required for type=recommendation. Otherwise omit.",
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
          reasoning: {
            type: "array",
            maxItems: 5,
            items: { type: "string" },
          },
          stylingNotes: {
            type: "array",
            maxItems: 5,
            items: { type: "string" },
          },
          gap: {
            type: ["string", "null"],
          },
        },
        required: ["name", "summary", "itemIds", "reasoning", "stylingNotes", "gap"],
      },
    },
    required: ["type", "reply"],
  },
};

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringArray(value: unknown, limit: number) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
    .map((entry) => entry.trim())
    .slice(0, limit);
}

function parseModelResponse(text: string): ModelQuestion | ModelRecommendation | null {
  const afterMarker = text.match(/FINAL:\s*([\s\S]*)$/)?.[1] ?? text;
  const start = afterMarker.indexOf("{");
  const end = afterMarker.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  try {
    const parsed = JSON.parse(afterMarker.slice(start, end + 1)) as
      | ModelQuestion
      | ModelRecommendation;
    return parsed?.type === "question" || parsed?.type === "recommendation" ? parsed : null;
  } catch {
    return null;
  }
}

function readToolResponse(input: unknown): ModelQuestion | ModelRecommendation | null {
  if (!input || typeof input !== "object") return null;
  const candidate = input as { type?: unknown };
  return candidate.type === "question" || candidate.type === "recommendation"
    ? (input as ModelQuestion | ModelRecommendation)
    : null;
}

function normalizeMessages(body: unknown): ClientMessage[] {
  if (!body || typeof body !== "object") return [];
  const value = body as { message?: unknown; messages?: unknown };
  const rawMessages = Array.isArray(value.messages)
    ? value.messages
    : typeof value.message === "string"
      ? [{ role: "user", content: value.message }]
      : [];

  const normalized: ClientMessage[] = [];
  for (const raw of rawMessages.slice(-14)) {
    if (!raw || typeof raw !== "object") continue;
    const candidate = raw as { role?: unknown; content?: unknown };
    if (
      (candidate.role !== "user" && candidate.role !== "assistant") ||
      typeof candidate.content !== "string" ||
      !candidate.content.trim()
    ) {
      continue;
    }

    const message: ClientMessage = {
      role: candidate.role,
      content: candidate.content.trim().slice(0, 4_000),
    };
    const previous = normalized.at(-1);
    if (previous?.role === message.role) {
      previous.content = `${previous.content}\n\n${message.content}`.slice(0, 6_000);
    } else {
      normalized.push(message);
    }
  }

  while (normalized[0]?.role === "assistant") normalized.shift();
  return normalized;
}

function toWardrobeItem(item: {
  id: string;
  display_name: string | null;
  user_notes: string | null;
  category: string;
  subcategory: string | null;
  color: string | null;
  brand: string | null;
  clean_url: string | null;
  original_url: string;
}): StylistWardrobeItem {
  return item as StylistWardrobeItem;
}

/**
 * Conversational stylist with a two-stage contract:
 * 1. Ask focused questions until the occasion, desired impression and practical
 *    constraints are clear enough.
 * 2. Return a validated wardrobe-only look that the client renders as a Canvas.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const messages = normalizeMessages(await request.json());
    if (messages.length === 0 || messages.at(-1)?.role !== "user") {
      return NextResponse.json({ error: "A user message is required" }, { status: 400 });
    }

    const [{ data: items, error: itemsError }, { data: profile, error: profileError }] =
      await Promise.all([
        supabase
          .from("wardrobe_items")
          .select(
            "id, display_name, user_notes, category, subcategory, color, colors, material, season, occasion, style_tags, brand, clean_url, original_url"
          )
          .eq("user_id", user.id)
          .eq("archived", false)
          .limit(100),
        supabase
          .from("profiles")
          .select("name, city, timezone, body_shape, preference_dna")
          .eq("id", user.id)
          .single(),
      ]);

    if (itemsError) throw itemsError;
    if (profileError) throw profileError;

    const wardrobe = items || [];
    if (wardrobe.length < 2) {
      const response: StylistQuestionResponse = {
        type: "question",
        reply:
          "I need at least two active pieces in your digital closet before I can build a visual look.",
        questions: ["Add a few pieces in Closet, then tell me what you are dressing for."],
      };
      return NextResponse.json(response);
    }

    const wardrobeSummary = wardrobe.map((item) => ({
      id: item.id,
      name: item.display_name,
      type: `${item.category} — ${item.subcategory || "unknown"}`,
      color: item.color,
      colors: item.colors,
      brand: item.brand,
      material: item.material,
      seasons: item.season,
      occasions: item.occasion,
      tags: item.style_tags,
      userNotes: item.user_notes,
    }));
    const userTurns = messages.filter((message) => message.role === "user").length;

    const systemPrompt = `You are a thoughtful personal stylist for executive women. You do not jump to an outfit before understanding what the client actually needs. You can only recommend garments from the supplied wardrobe.

USER PROFILE:
${profile ? `Name: ${profile.name || "User"}; City: ${profile.city || "Unknown"}; Timezone: ${profile.timezone || "Unknown"}; Body shape: ${profile.body_shape || "Unknown"}` : "No profile data"}
${profile?.preference_dna ? `Preferences: ${JSON.stringify(profile.preference_dna)}` : ""}

ACTIVE WARDROBE (${wardrobeSummary.length} items):
${JSON.stringify(wardrobeSummary)}

DISCOVERY METHOD:
- Work out the occasion and timing/dress code, the impression the client wants to create, and practical constraints such as weather, walking, comfort, coverage, rewearing or items they do not want.
- Infer what is already obvious. Never repeat a question the client answered.
- If essential context is missing, ask only the 1–2 highest-value questions in this turn. Make the questions specific and easy to answer.
- This is user turn ${userTurns}. By the second user answer, recommend a look unless a truly critical fact is still missing. State reasonable assumptions instead of interrogating indefinitely. If the client says "you decide", recommend immediately.
- Once there is enough context, return one decisive main look rather than another paragraph of generic advice.

RECOMMENDATION RULES:
- A non-empty wardrobe "name" is the client's authoritative name for that piece. Use it verbatim when mentioning the item; never replace it with a generic color/type label. Treat "userNotes" as authoritative fit, comfort, provenance, and wearing constraints.
- Use 2–6 unique item ids exactly as written in ACTIVE WARDROBE. Never invent an id.
- The summary explains the overall styling idea. The reasoning array explains why the pieces work for the person's goal and occasion, not merely what each item is.
- stylingNotes contains practical finishing instructions (tuck, sleeve, bag, jewelry, shoe, layering).
- Mention a gap only when the owned wardrobe genuinely cannot meet part of the request.
- Reply in the same language as the client.

You MUST finish by calling return_stylist_response exactly once. Do not give the
client-facing answer as ordinary text outside that tool call.`;

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1_500,
      system: systemPrompt,
      messages,
      tools: [STYLIST_RESPONSE_TOOL],
      tool_choice: {
        type: "tool",
        name: STYLIST_RESPONSE_TOOL.name,
        disable_parallel_tool_use: true,
      },
    });

    const toolBlock = response.content.find(
      (block) => block.type === "tool_use" && block.name === STYLIST_RESPONSE_TOOL.name
    );
    const textBlock = response.content.find((block) => block.type === "text");
    const rawText = textBlock?.type === "text" ? textBlock.text : "";
    const parsed =
      (toolBlock?.type === "tool_use" ? readToolResponse(toolBlock.input) : null) ||
      parseModelResponse(rawText);

    if (!parsed) {
      // Forced tool choice should make this path exceptionally rare. Still do not
      // turn a perfectly useful natural-language discovery question into a 502 if
      // a provider/model regression emits text instead of the requested tool block.
      if (rawText.trim()) {
        console.warn("Stylist skipped the structured tool; returning text safely:", rawText);
        const fallback: StylistQuestionResponse = {
          type: "question",
          reply: rawText.trim(),
          questions: [],
        };
        return NextResponse.json(fallback);
      }

      console.error("Stylist returned neither a tool response nor usable text:", response.content);
      return NextResponse.json(
        { error: "The stylist couldn't structure that answer. Please try again." },
        { status: 502 }
      );
    }

    if (parsed.type === "question") {
      const questions = stringArray(parsed.questions, 2);
      const result: StylistQuestionResponse = {
        type: "question",
        reply: stringValue(parsed.reply, "A little more context will help me make this feel like you."),
        questions:
          questions.length > 0
            ? questions
            : ["What matters most about how you want to feel in this outfit?"],
      };
      return NextResponse.json(result);
    }

    const requestedIds = stringArray(parsed.look?.itemIds, 6);
    const requestedSet = new Set(requestedIds);
    const selected = wardrobe
      .filter((item) => requestedSet.has(item.id))
      .sort((a, b) => requestedIds.indexOf(a.id) - requestedIds.indexOf(b.id))
      .map(toWardrobeItem);

    if (selected.length < 2) {
      console.error("Stylist recommendation did not contain two valid owned item ids:", rawText);
      return NextResponse.json(
        { error: "The stylist couldn't map that look to enough owned items. Please try again." },
        { status: 502 }
      );
    }

    const look = parsed.look;
    const result: StylistRecommendationResponse = {
      type: "recommendation",
      reply: stringValue(parsed.reply, "Here is the look I would build from your closet."),
      look: {
        name: stringValue(look?.name, "Stylist look"),
        summary: stringValue(look?.summary, "A considered look built from pieces you already own."),
        reasoning: stringArray(look?.reasoning, 5),
        stylingNotes: stringArray(look?.stylingNotes, 5),
        gap: typeof look?.gap === "string" && look.gap.trim() ? look.gap.trim() : null,
        items: selected,
      },
      availableItems: wardrobe.map(toWardrobeItem),
    };

    return NextResponse.json(result satisfies StylistResponse);
  } catch (error) {
    console.error("Stylist error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Stylist failed" },
      { status: 500 }
    );
  }
}
