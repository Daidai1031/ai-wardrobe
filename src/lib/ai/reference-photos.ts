import Anthropic from "@anthropic-ai/sdk";
import { resizeForClassification } from "./classify";
import type { ReferencePhotoKind } from "@/types/database";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const REFERENCE_DOWNLOAD_TIMEOUT_MS = 15_000;
const REFERENCE_ANALYSIS_TIMEOUT_MS = 30_000;

const VALID_KINDS = new Set<ReferencePhotoKind>([
  "front",
  "back",
  "side",
  "detail",
  "logo_pattern",
  "material",
  "label",
  "worn",
  "other",
]);

export interface ReferencePhotoInput {
  id: string;
  url: string;
}

export interface ReferencePhotoAnalysis {
  id: string;
  kind: ReferencePhotoKind;
  brand: string | null;
  material: string | null;
  confidence: number;
}

const PROMPT = `Analyze each numbered reference photo for one wardrobe item.

Return ONLY a JSON array with one object per photo:
{"index":1,"kind":"front","brand":null,"material":null,"confidence":0.95}

kind must be exactly one of:
front, back, side, detail, logo_pattern, material, label, worn, other

Rules:
- label means a sewn-in brand, size, care, or fiber-composition tag, or a retail hang tag photographed for its text.
- logo_pattern means a close view of a visible logo, print, embroidery, hardware, or pattern that belongs to the garment.
- material means a fabric/texture close-up, not a written composition label.
- Extract brand and material ONLY when readable from a label/tag. Never guess them from appearance.
- Preserve exact percentages when a fiber composition is readable, such as "80% cotton, 20% polyester".
- Unreadable or absent values must be null.
- index is one-based and must match the numbered photo.`;

function parseAnalysis(text: string, inputs: ReferencePhotoInput[]): ReferencePhotoAnalysis[] {
  const cleaned = text.replace(/```json\n?|```/g, "").trim();
  try {
    const value = JSON.parse(cleaned) as unknown;
    if (!Array.isArray(value)) return [];

    const byIndex = new Map<number, ReferencePhotoAnalysis>();
    for (const raw of value) {
      if (!raw || typeof raw !== "object") continue;
      const entry = raw as Record<string, unknown>;
      const index = Number(entry.index);
      const input = inputs[index - 1];
      const kind = entry.kind;
      if (!input || typeof kind !== "string" || !VALID_KINDS.has(kind as ReferencePhotoKind)) {
        continue;
      }
      byIndex.set(index, {
        id: input.id,
        kind: kind as ReferencePhotoKind,
        brand: typeof entry.brand === "string" && entry.brand.trim() ? entry.brand.trim() : null,
        material:
          typeof entry.material === "string" && entry.material.trim()
            ? entry.material.trim()
            : null,
        confidence:
          typeof entry.confidence === "number"
            ? Math.max(0, Math.min(1, entry.confidence))
            : 0.5,
      });
    }

    return inputs.map((input, offset) =>
      byIndex.get(offset + 1) ?? {
        id: input.id,
        kind: "other",
        brand: null,
        material: null,
        confidence: 0,
      }
    );
  } catch {
    return [];
  }
}

/**
 * One small cached vision call for all newly-added references. Besides routing
 * label photos away from generation, this extracts authoritative tag text.
 */
export async function analyzeReferencePhotos(
  inputs: ReferencePhotoInput[]
): Promise<ReferencePhotoAnalysis[]> {
  if (inputs.length === 0) return [];

  const prepared = await Promise.all(
    inputs.slice(0, 8).map(async (input) => {
      const response = await fetch(input.url, {
        signal: AbortSignal.timeout(REFERENCE_DOWNLOAD_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Failed to download reference photo (${response.status})`);
      return resizeForClassification(Buffer.from(await response.arrayBuffer()));
    })
  );

  const content: Anthropic.Messages.ContentBlockParam[] = [];
  prepared.forEach(({ data, mediaType }, index) => {
    content.push({ type: "text", text: `Reference photo ${index + 1}:` });
    content.push({
      type: "image",
      source: { type: "base64", media_type: mediaType, data },
    });
  });
  content.push({ type: "text", text: PROMPT });

  const message = await anthropic.messages.create(
    {
      model: "claude-haiku-4-5-20251001",
      max_tokens: 900,
      messages: [{ role: "user", content }],
    },
    { timeout: REFERENCE_ANALYSIS_TIMEOUT_MS }
  );
  const block = message.content.find(
    (entry): entry is Anthropic.Messages.TextBlock => entry.type === "text"
  );
  return parseAnalysis(block?.text ?? "", inputs.slice(0, 8));
}
