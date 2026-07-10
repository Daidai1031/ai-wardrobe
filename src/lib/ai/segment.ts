/**
 * Multi-item detection and segmentation.
 *
 * Claude first decides whether segmentation is needed and supplies concrete
 * object nouns for SAM 3.1. SAM 3.1 is text-prompted, so a count alone is not
 * enough: "purse" finds the four purses in a photo while a broad prompt such
 * as "fashion item" may find nothing.
 */
import { fal } from "@fal-ai/client";
import sharp from "sharp";
import Anthropic from "@anthropic-ai/sdk";
import { resizeForClassification } from "./classify";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

fal.config({ credentials: process.env.FAL_KEY! });

const DETECTION_PROMPT = `Look at this photo of clothing and accessories.

Return JSON only in exactly this shape:
{"count":4,"prompts":["purse"]}

- count: number of separate, distinct wearable/carryable items. Ignore the background, hangers, mannequins, and props.
- prompts: the smallest possible set of short, concrete English nouns that covers every item. These are segmentation prompts, not classification labels: do not split colors, styles, or subtypes. If all items share an everyday noun, use it once (four handbags, clutches, or pouches -> ["purse"]). Only genuinely different kinds need separate prompts (a mixed flat-lay -> ["shirt","pants","shoe"]). Prefer a visible noun such as purse, dress, belt, shoe, necklace, or jacket; never use vague catch-alls such as fashion item, wearable item, clothing, or accessory.
- Use at most 6 prompts.`;

export interface ItemDetection {
  count: number;
  prompts: string[];
}

interface FalImage {
  url: string;
  width?: number;
  height?: number;
  content_type?: string;
}

interface SamMaskMetadata {
  index: number;
  score?: number;
  box?: number[];
}

interface Sam31Response {
  masks?: FalImage[];
  boxes?: number[][];
  scores?: number[];
  metadata?: SamMaskMetadata[] | null;
}

interface SamDetection {
  box: [number, number, number, number]; // normalized [centerX, centerY, width, height]
  score: number;
  prompt: string;
  maskUrl: string;
}

const SAM_MODEL = "fal-ai/sam-3-1/image";
const MAX_SEGMENTS = 12;
const MAX_PROMPTS = 6;
const MIN_AREA_FRACTION = 0.01;
const BOX_PADDING_FRACTION = 0.06;
// Thin objects such as belts need some background context on their short axis.
// A percentage of the box itself is only a few pixels and causes background
// removal models to erase objects that touch the crop boundary.
const MIN_BOX_PADDING_FRACTION = 0.02;
const DUPLICATE_IOU_THRESHOLD = 0.65;
const SAM_TIMEOUT_MS = 45_000;

function normalizeSamPrompt(prompt: string): string {
  const normalized = prompt.trim().toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ");

  // Haiku may classify purse subtypes separately even though SAM needs one
  // shared visual concept. Collapsing these synonyms avoids duplicate calls.
  if (/\b(handbag|purse|clutch|pouch|tote bag|shoulder bag|crossbody bag)\b/.test(normalized)) {
    return "purse";
  }
  if (/\b(sneaker|trainer|boot|sandal|heel|loafer)s?\b/.test(normalized)) {
    return "shoe";
  }
  return normalized;
}

function parseDetection(text: string): ItemDetection {
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  let parsed: { count?: unknown; prompts?: unknown } = {};

  if (json) {
    try {
      parsed = JSON.parse(json) as typeof parsed;
    } catch {
      // The numeric fallback below preserves the old single-item behavior.
    }
  }

  const rawCount =
    typeof parsed.count === "number"
      ? parsed.count
      : Number.parseInt(text.match(/\d+/)?.[0] ?? "1", 10);
  const count = Number.isFinite(rawCount) && rawCount > 0 ? Math.round(rawCount) : 1;
  const prompts = Array.isArray(parsed.prompts)
    ? [...new Set(
        parsed.prompts
          .filter((prompt): prompt is string => typeof prompt === "string")
          .map(normalizeSamPrompt)
          .filter((prompt) => prompt.length > 0 && prompt.length <= 40)
      )].slice(0, MAX_PROMPTS)
    : [];

  return { count, prompts };
}

/** Count the items and obtain concrete text prompts for SAM 3.1 in one call. */
export async function detectItems(imageUrl: string): Promise<ItemDetection> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to download image for item detection (${response.status})`);
  }

  const imageBuffer = Buffer.from(await response.arrayBuffer());
  const { data: base64, mediaType } = await resizeForClassification(imageBuffer);
  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 120,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: DETECTION_PROMPT },
        ],
      },
    ],
  });

  const text = message.content[0]?.type === "text" ? message.content[0].text.trim() : "";
  const detection = parseDetection(text);
  console.log(
    `[segment] detected item count: ${detection.count}; SAM prompts: ${JSON.stringify(detection.prompts)} (raw: ${JSON.stringify(text)})`
  );
  return detection;
}

/** Kept for callers that only need the inexpensive count. */
export async function detectItemCount(imageUrl: string): Promise<number> {
  return (await detectItems(imageUrl)).count;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function isNormalizedBox(box: number[] | undefined): box is [number, number, number, number] {
  return (
    Array.isArray(box) &&
    box.length === 4 &&
    box.every(Number.isFinite) &&
    box[0] >= 0 &&
    box[0] <= 1 &&
    box[1] >= 0 &&
    box[1] <= 1 &&
    box[2] > 0 &&
    box[2] <= 1 &&
    box[3] > 0 &&
    box[3] <= 1
  );
}

function intersectionOverUnion(a: SamDetection, b: SamDetection): number {
  const [acx, acy, aw, ah] = a.box;
  const [bcx, bcy, bw, bh] = b.box;
  const left = Math.max(acx - aw / 2, bcx - bw / 2);
  const top = Math.max(acy - ah / 2, bcy - bh / 2);
  const right = Math.min(acx + aw / 2, bcx + bw / 2);
  const bottom = Math.min(acy + ah / 2, bcy + bh / 2);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = aw * ah + bw * bh - intersection;
  return union > 0 ? intersection / union : 0;
}

async function downloadBuffer(url: string, label: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${label} (${response.status})`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function segmentForPrompt(
  imageUrl: string,
  prompt: string,
  maxMasks: number
): Promise<SamDetection[]> {
  console.log(`[segment] calling ${SAM_MODEL} with prompt ${JSON.stringify(prompt)}...`);
  const result = await withTimeout(
    fal.subscribe(SAM_MODEL, {
      input: {
        image_url: imageUrl,
        prompt,
        // Return the binary mask rather than an image composited onto black.
        // We use it as the alpha channel of the original pixels below.
        apply_mask: false,
        output_format: "png",
        return_multiple_masks: true,
        max_masks: maxMasks,
        include_scores: true,
        include_boxes: true,
      },
    }),
    SAM_TIMEOUT_MS,
    `${SAM_MODEL} (${prompt})`
  );
  const data = result.data as Sam31Response;
  console.log(
    `[segment] SAM 3.1 prompt ${JSON.stringify(prompt)} returned ${data.masks?.length ?? 0} masks`
  );

  const maskCount = data.masks?.length ?? 0;
  const detections: SamDetection[] = [];
  for (let index = 0; index < maskCount; index++) {
    const box = data.boxes?.[index] ?? data.metadata?.[index]?.box;
    const maskUrl = data.masks?.[index]?.url;
    if (!maskUrl || !isNormalizedBox(box) || box[2] * box[3] < MIN_AREA_FRACTION) continue;
    detections.push({
      box,
      score: data.scores?.[index] ?? data.metadata?.[index]?.score ?? 0,
      prompt,
      maskUrl,
    });
  }
  return detections;
}

/**
 * Run prompt-based SAM 3.1 segmentation, crop each detected object from the
 * original image, and use SAM's binary mask as the crop's alpha channel.
 * This avoids a second background-removal model, which can erase very long,
 * thin objects such as belts and return a completely transparent image.
 */
export async function segmentItems(
  imageUrl: string,
  prompts: string[],
  expectedCount: number
): Promise<Buffer[]> {
  if (prompts.length === 0) {
    throw new Error("Item detection returned no concrete SAM 3.1 prompts");
  }

  const originalResponse = await fetch(imageUrl);
  if (!originalResponse.ok) {
    throw new Error(`Failed to download image for segmentation (${originalResponse.status})`);
  }
  const downloadedBuffer = Buffer.from(await originalResponse.arrayBuffer());
  // Normalize EXIF orientation so source pixels and SAM mask coordinates use
  // the same visual coordinate system.
  const originalBuffer = await sharp(downloadedBuffer).rotate().toBuffer();
  const metadata = await sharp(originalBuffer).metadata();
  const imageWidth = metadata.width ?? 0;
  const imageHeight = metadata.height ?? 0;
  if (imageWidth <= 0 || imageHeight <= 0) {
    throw new Error("Could not read source image dimensions for segmentation");
  }

  // Claude's count is a useful estimate, not ground truth. Ask SAM for a small
  // amount of headroom so an undercount does not silently drop real objects.
  const maxMasks = Math.min(MAX_SEGMENTS, Math.max(2, expectedCount + 2));
  const settled = await Promise.allSettled(
    prompts.slice(0, MAX_PROMPTS).map((prompt) => segmentForPrompt(imageUrl, prompt, maxMasks))
  );
  const detections: SamDetection[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      detections.push(...result.value);
    } else {
      console.error("[segment] SAM 3.1 prompt failed:", result.reason);
    }
  }

  const unique = detections
    .sort((a, b) => b.score - a.score)
    .filter((candidate, index, all) =>
      all.slice(0, index).every((kept) => intersectionOverUnion(candidate, kept) < DUPLICATE_IOU_THRESHOLD)
    )
    .slice(0, MAX_SEGMENTS);

  if (unique.length === 0) {
    throw new Error(
      `SAM 3.1 returned no usable masks for prompts: ${prompts
        .map((prompt) => JSON.stringify(prompt))
        .join(", ")}`
    );
  }

  console.log(`[segment] keeping ${unique.length}/${detections.length} SAM 3.1 detections`);
  const crops: Buffer[] = [];
  // Process full-resolution masks sequentially to keep memory bounded for
  // large phone photos (each decoded mask can occupy tens of megabytes).
  for (const [index, detection] of unique.entries()) {
    try {
      const {
        box: [centerX, centerY, width, height],
        maskUrl,
      } = detection;
      const padX = Math.max(width * BOX_PADDING_FRACTION, MIN_BOX_PADDING_FRACTION);
      const padY = Math.max(height * BOX_PADDING_FRACTION, MIN_BOX_PADDING_FRACTION);
      const left = Math.max(0, Math.floor((centerX - width / 2 - padX) * imageWidth));
      const top = Math.max(0, Math.floor((centerY - height / 2 - padY) * imageHeight));
      const right = Math.min(imageWidth, Math.ceil((centerX + width / 2 + padX) * imageWidth));
      const bottom = Math.min(imageHeight, Math.ceil((centerY + height / 2 + padY) * imageHeight));
      const cropWidth = Math.max(1, right - left);
      const cropHeight = Math.max(1, bottom - top);
      const extract = { left, top, width: cropWidth, height: cropHeight };
      const maskBuffer = await downloadBuffer(maskUrl, "SAM mask");
      const maskMetadata = await sharp(maskBuffer).metadata();
      if (maskMetadata.width !== imageWidth || maskMetadata.height !== imageHeight) {
        throw new Error(
          `SAM mask dimensions ${maskMetadata.width}x${maskMetadata.height} do not match source ${imageWidth}x${imageHeight}`
        );
      }

      const [rgbCrop, alphaCrop] = await Promise.all([
        sharp(originalBuffer).extract(extract).removeAlpha().toBuffer(),
        sharp(maskBuffer).extract(extract).greyscale().toBuffer(),
      ]);

      crops.push(await sharp(rgbCrop).joinChannel(alphaCrop).png().toBuffer());
    } catch (error) {
      console.error(`[segment] failed to build crop ${index + 1}:`, error);
    }
  }

  if (crops.length === 0) {
    throw new Error("SAM 3.1 masks could not be converted into usable crops");
  }
  return crops;
}
