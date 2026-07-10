/**
 * Clothing classification via Claude Vision API.
 *
 * Replaces the limited SAM concept labels with rich, accurate metadata.
 * Claude sees the clean (bg-removed) image and returns structured JSON
 * with category, subcategory, colors, material, season, occasion, style tags.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { AIClassification, ItemCategory } from "@/types/database";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const VALID_CATEGORIES: ItemCategory[] = [
  "Tops", "Bottoms", "Dresses", "Outerwear", "Shoes", "Bags", "Accessories",
];

const CLASSIFICATION_PROMPT = `You are an expert fashion stylist AI. Analyze this clothing/accessory image and return a JSON object with these fields:

{
  "category": one of: "Tops", "Bottoms", "Dresses", "Outerwear", "Shoes", "Bags", "Accessories",
  "subcategory": specific type (e.g. "blazer", "midi skirt", "ankle boots", "crossbody bag", "silk scarf"),
  "color": primary color name (e.g. "black", "navy", "cream", "burgundy"),
  "colors": array of all colors present (e.g. ["black", "white"]),
  "material": detected or likely material (e.g. "wool", "leather", "silk", "cotton", "denim"),
  "season": array of suitable seasons ["spring", "summer", "fall", "winter"],
  "occasion": array of suitable occasions from: ["work", "casual", "formal", "date", "travel", "sport", "party", "wedding"],
  "style_tags": array of style descriptors from: ["minimalist", "classic", "creative", "bohemian", "sporty", "elegant", "streetwear", "preppy", "romantic", "edgy"],
  "confidence": 0.0 to 1.0 indicating how confident you are in the classification
}

Return ONLY valid JSON, no markdown fences, no explanation.`;

export async function classifyItem(imageUrl: string): Promise<AIClassification> {
  // Fetch image and convert to base64
  const response = await fetch(imageUrl);
  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");

  // Detect media type
  const contentType = response.headers.get("content-type") || "image/png";
  const mediaType = contentType.startsWith("image/")
    ? contentType as "image/png" | "image/jpeg" | "image/webp" | "image/gif"
    : "image/png";

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64 },
          },
          { type: "text", text: CLASSIFICATION_PROMPT },
        ],
      },
    ],
  });

  const text = msg.content[0].type === "text" ? msg.content[0].text : "";
  const cleaned = text.replace(/```json\n?|```/g, "").trim();

  try {
    const parsed = JSON.parse(cleaned);

    // Validate category
    if (!VALID_CATEGORIES.includes(parsed.category)) {
      parsed.category = "Accessories"; // safe fallback
    }

    return {
      category: parsed.category,
      subcategory: parsed.subcategory || "",
      color: parsed.color || "unknown",
      colors: Array.isArray(parsed.colors) ? parsed.colors : [parsed.color || "unknown"],
      material: parsed.material || "",
      season: Array.isArray(parsed.season) ? parsed.season : [],
      occasion: Array.isArray(parsed.occasion) ? parsed.occasion : [],
      style_tags: Array.isArray(parsed.style_tags) ? parsed.style_tags : [],
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.7,
    };
  } catch {
    // If Claude returns malformed JSON, return a safe default
    return {
      category: "Accessories",
      subcategory: "",
      color: "unknown",
      colors: [],
      material: "",
      season: [],
      occasion: [],
      style_tags: [],
      confidence: 0.3,
    };
  }
}
