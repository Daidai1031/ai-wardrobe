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
  if (/\b(earring|stud|hoop)s?\b/.test(normalized)) {
    return "earring";
  }
  if (/\b(bracelet|bangle|cuff)s?\b/.test(normalized)) {
    return "bracelet";
  }
  return normalized;
}

// Categories that are anatomically sold/worn as a matched pair — if only one
// is detected, mirror it to synthesize the missing side, like shoes.
const MIRROR_IF_LONE_PROMPTS = new Set(["shoe", "earring"]);

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
  // the same visual coordinate system. SAM 3.1 does not reliably honor EXIF
  // orientation itself, so re-encoding and re-uploading (rather than passing
  // the original imageUrl straight through) guarantees SAM segments the exact
  // same pixel grid we extract crops from below.
  const originalBuffer = await sharp(downloadedBuffer).rotate().toBuffer();
  const metadata = await sharp(originalBuffer).metadata();
  const imageWidth = metadata.width ?? 0;
  const imageHeight = metadata.height ?? 0;
  if (imageWidth <= 0 || imageHeight <= 0) {
    throw new Error("Could not read source image dimensions for segmentation");
  }
  const samImageUrl = await fal.storage.upload(
    new Blob([originalBuffer], { type: "image/png" })
  );

  // Claude's count is a useful estimate, not ground truth. Ask SAM for a small
  // amount of headroom so an undercount does not silently drop real objects.
  const maxMasks = Math.min(MAX_SEGMENTS, Math.max(2, expectedCount + 2));
  const settled = await Promise.allSettled(
    prompts.slice(0, MAX_PROMPTS).map((prompt) => segmentForPrompt(samImageUrl, prompt, maxMasks))
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
  const built: Array<{ buffer: Buffer; detection: SamDetection }> = [];
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

      const buffer = await sharp(rgbCrop).joinChannel(alphaCrop).png().toBuffer();
      built.push({ buffer, detection });
    } catch (error) {
      console.error(`[segment] failed to build crop ${index + 1}:`, error);
    }
  }

  if (built.length === 0) {
    throw new Error("SAM 3.1 masks could not be converted into usable crops");
  }

  const crops = await mergeDuplicateAccessories(built);
  return crops;
}

interface SimilarityGrouping {
  pairs: number[][]; // 0-based indices into the group's own array
  singles: number[];
}

function buildDuplicatePrompt(itemLabel: string): string {
  const Label = itemLabel.charAt(0).toUpperCase() + itemLabel.slice(1);
  return `You are looking at cropped photos of individual ${itemLabel}s, taken from the same photo. Each is labeled "${Label} N".

Some of these photos show two photos of the exact same physical item (e.g. a matching pair, or the same product shot from a different angle); others show genuinely different, unrelated ${itemLabel}s. Don't assume either case — judge each one purely on what you see.

For each ${itemLabel}, briefly note its distinguishing features: shape/silhouette, material, color, hardware/closure style, and any visible brand text or logo.

The same physical item, or the two halves of a matched pair, are often photographed at different angles or rotations, or partially overlapping another item — this is normal, not a sign they're different items. Do NOT treat differences that are merely a consequence of camera angle, rotation, or which side/part happens to be visible as disqualifying. What genuinely disqualifies a match is an actual design difference: different shape, material, color, or hardware.

Often two crops show entirely different PARTS of the same item (e.g. one shows the clasp, the other shows the opposite side) — when that happens you cannot compare features only visible on one of them; judge the match using only whichever features are visible on BOTH.

Ask yourself: if I saw these listed as one product online, would that be plausible? If yes, group them together, even if some incidental details differ. If an item truly has no plausible match among the others, it stands alone.

After your analysis, output one final line starting with "FINAL:" followed by JSON only, in exactly this shape:
FINAL:{"pairs":[[1,2]],"singles":[3,4]}

Every index from 1 to N must appear exactly once, either inside "pairs" (grouped in twos) or in "singles". Groups are always exactly two — if three or more crops all show the same item, group the closest two and leave the rest as singles.`;
}

function parseSimilarityGrouping(text: string, count: number): SimilarityGrouping {
  const afterMarker = text.match(/FINAL:\s*([\s\S]*)$/)?.[1] ?? text;
  const json = afterMarker.match(/\{[\s\S]*\}/)?.[0];
  let parsed: { pairs?: unknown; singles?: unknown } = {};

  if (json) {
    try {
      parsed = JSON.parse(json) as typeof parsed;
    } catch {
      // Fall through to the all-singles fallback below.
    }
  }

  const used = new Set<number>();
  const pairs: number[][] = [];
  if (Array.isArray(parsed.pairs)) {
    for (const candidate of parsed.pairs) {
      if (!Array.isArray(candidate) || candidate.length !== 2) continue;
      const [rawA, rawB] = candidate;
      const a = Number(rawA) - 1;
      const b = Number(rawB) - 1;
      if (
        !Number.isInteger(a) || !Number.isInteger(b) ||
        a < 0 || a >= count || b < 0 || b >= count || a === b ||
        used.has(a) || used.has(b)
      ) {
        continue;
      }
      used.add(a);
      used.add(b);
      pairs.push([a, b]);
    }
  }

  // Anything Claude didn't confidently group (including indices it never
  // mentioned) stays single: an incorrect merge of two different items is
  // worse than two correct single-item entries.
  const singles: number[] = [];
  for (let i = 0; i < count; i++) {
    if (!used.has(i)) singles.push(i);
  }

  return { pairs, singles };
}

/** Ask Claude Vision which crops of the same category depict the same physical item. */
async function classifySimilarItems(buffers: Buffer[], itemLabel: string): Promise<SimilarityGrouping> {
  try {
    const resized = await Promise.all(buffers.map((buffer) => resizeForClassification(buffer)));
    const Label = itemLabel.charAt(0).toUpperCase() + itemLabel.slice(1);
    const content: Anthropic.Messages.ContentBlockParam[] = [];
    resized.forEach(({ data, mediaType }, index) => {
      content.push({ type: "text", text: `${Label} ${index + 1}:` });
      content.push({ type: "image", source: { type: "base64", media_type: mediaType, data } });
    });
    content.push({ type: "text", text: buildDuplicatePrompt(itemLabel) });

    // Sonnet, not Haiku: distinguishing the same item photographed at two
    // different angles from two genuinely different items needs stronger
    // visual reasoning than Haiku reliably provides. This call only fires
    // when 2+ crops of the same category are detected in one photo, so the
    // extra cost is rare, not per-item like classify/stylist.
    const message = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 4096,
      messages: [{ role: "user", content }],
    });

    // Sonnet 5 emits an extended-thinking block before the text block by
    // default, so the text is not necessarily content[0].
    const textBlock = message.content.find(
      (block): block is Anthropic.Messages.TextBlock => block.type === "text"
    );
    const text = textBlock?.text.trim() ?? "";
    const grouping = parseSimilarityGrouping(text, buffers.length);
    console.log(
      `[segment] ${itemLabel} similarity grouping for ${buffers.length} crops: ${JSON.stringify(grouping)} (raw: ${JSON.stringify(text)})`
    );
    return grouping;
  } catch (error) {
    console.error(`[segment] ${itemLabel} similarity call failed, treating all crops as singles:`, error);
    return { pairs: [], singles: buffers.map((_, index) => index) };
  }
}

/**
 * A pair of shoes (or earrings) should become one wardrobe item, not two, and
 * two near-identical crops of any other accessory (bracelets, rings, ...)
 * likely depict the same physical item photographed twice rather than two
 * distinct pieces. This groups detections by category, asks Claude Vision
 * which crops within a category depict the same physical item, and
 * composites matched groups into a single side-by-side image — ordered by
 * each item's actual left-to-right position in the source photo (asking a
 * vision model to additionally judge shoe chirality proved unreliable: it
 * contradicted itself on an identical pair, calling both "right foot" and
 * refusing to merge them). For shoes and earrings specifically — categories
 * that are always sold/worn as a matched pair — an unmatched lone item is
 * additionally mirrored to synthesize its missing partner. Other categories
 * (bracelet, etc.) are only merged when a real duplicate is actually
 * detected; a genuinely single bracelet is already a complete item and is
 * left untouched, with no API call spent on it.
 */
async function mergeDuplicateAccessories(
  built: Array<{ buffer: Buffer; detection: SamDetection }>
): Promise<Buffer[]> {
  const byPrompt = new Map<string, Array<{ buffer: Buffer; detection: SamDetection }>>();
  for (const item of built) {
    const group = byPrompt.get(item.detection.prompt);
    if (group) {
      group.push(item);
    } else {
      byPrompt.set(item.detection.prompt, [item]);
    }
  }

  const result: Buffer[] = [];
  for (const [prompt, group] of byPrompt) {
    const mirrorIfLone = MIRROR_IF_LONE_PROMPTS.has(prompt);

    if (group.length === 1) {
      if (mirrorIfLone) {
        const mirrored = await sharp(group[0].buffer).flop().png().toBuffer();
        result.push(await composeSideBySide([group[0].buffer, mirrored]));
      } else {
        result.push(group[0].buffer);
      }
      continue;
    }

    const { pairs, singles } = await classifySimilarItems(group.map(({ buffer }) => buffer), prompt);
    for (const [i, j] of pairs) {
      // box[0] is the normalized center-x in the original photo: place
      // whichever item was physically on the left, on the left.
      const [left, right] =
        group[i].detection.box[0] <= group[j].detection.box[0]
          ? [group[i], group[j]]
          : [group[j], group[i]];
      result.push(await composeSideBySide([left.buffer, right.buffer]));
    }
    for (const i of singles) {
      if (mirrorIfLone) {
        const mirrored = await sharp(group[i].buffer).flop().png().toBuffer();
        result.push(await composeSideBySide([group[i].buffer, mirrored]));
      } else {
        result.push(group[i].buffer);
      }
    }
  }

  return result;
}

const SHOE_PAIR_GAP_PX = 24;

/** Composite same-height crops side by side on a transparent canvas. */
async function composeSideBySide(buffers: Buffer[]): Promise<Buffer> {
  const metas = await Promise.all(buffers.map((buffer) => sharp(buffer).metadata()));
  const targetHeight = Math.max(...metas.map((meta) => meta.height ?? 1));

  const resized = await Promise.all(
    buffers.map((buffer, i) => {
      const meta = metas[i];
      const scale = targetHeight / (meta.height ?? targetHeight);
      const width = Math.max(1, Math.round((meta.width ?? targetHeight) * scale));
      return sharp(buffer).resize({ height: targetHeight, width }).png().toBuffer();
    })
  );
  const resizedMetas = await Promise.all(resized.map((buffer) => sharp(buffer).metadata()));
  const totalWidth =
    resizedMetas.reduce((sum, meta) => sum + (meta.width ?? 0), 0) +
    SHOE_PAIR_GAP_PX * (resized.length - 1);

  let left = 0;
  const composites = resized.map((buffer, i) => {
    const composite = { input: buffer, left, top: 0 };
    left += (resizedMetas[i].width ?? 0) + SHOE_PAIR_GAP_PX;
    return composite;
  });

  return sharp({
    create: {
      width: totalWidth,
      height: targetHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}
