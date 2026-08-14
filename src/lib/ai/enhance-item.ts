import { fal } from "@fal-ai/client";
import sharp from "sharp";
import { removeBackground } from "./remove-bg";
import { withTimeout } from "./async-timeout";
import type { ItemCategory, ReferencePhotoKind } from "@/types/database";

fal.config({ credentials: process.env.FAL_KEY! });

export const ITEM_ENHANCEMENT_MODEL = "bytedance/seedream/v5/lite/edit";
export const MAX_VISUAL_REFERENCES = 4;
const GENERATION_TIMEOUT_MS = 110_000;
const CUTOUT_DOWNLOAD_TIMEOUT_MS = 20_000;

export interface EnhancementReference {
  url: string;
  kind: ReferencePhotoKind | null;
}

export interface EnhancementItem {
  original_url: string;
  clean_url: string | null;
  category: ItemCategory;
  subcategory: string | null;
  color: string | null;
  brand: string | null;
  material: string | null;
}

const CATEGORY_BOX: Record<ItemCategory, { width: number; height: number }> = {
  Tops: { width: 800, height: 820 },
  Bottoms: { width: 650, height: 860 },
  Dresses: { width: 720, height: 880 },
  Outerwear: { width: 820, height: 850 },
  Shoes: { width: 840, height: 620 },
  Bags: { width: 760, height: 760 },
  Accessories: { width: 720, height: 720 },
};

function referenceDescription(references: EnhancementReference[]) {
  if (references.length === 0) return "No additional identity reference images are provided.";
  return references
    .map((reference, index) => `Figure ${index + 2}: ${reference.kind || "additional angle/detail"}`)
    .join("\n");
}

function buildPrompt(item: EnhancementItem, references: EnhancementReference[]) {
  return `Figure 1 is the base photograph of one real wardrobe item. The remaining figures are photographs of the exact same physical item and are identity evidence only.

${referenceDescription(references)}

Create a clean, front-facing e-commerce flat-lay presentation of this exact item on a plain white background. Remove the hanger, hands, person, props, distracting shadows, and background. Correct mild camera perspective, uneven laying, and poor lighting. Arrange the item naturally and neatly, with realistic soft studio light.

IDENTITY LOCK — preserve exactly:
- category: ${item.category}
- subtype: ${item.subcategory || "unknown"}
- color: ${item.color || "use the reference images exactly"}
- brand: ${item.brand || "unknown; do not invent a logo"}
- material: ${item.material || "use the reference texture exactly"}
- the exact silhouette, proportions, neckline, sleeve length, hem, seams, closures, button count, pockets, hardware, logo, print, embroidery, texture, wear marks, and all construction details visible in any figure

Do not redesign, restyle, recolor, beautify the design itself, add symmetry that changes construction, add or remove details, invent hidden details, put it on a model or mannequin, or copy a care label/tag into the final image. Output exactly one item, fully visible, centered, with no clipping.`;
}

/** Keep generation semantic; make padding and category scale deterministic. */
async function normalizeTransparentItem(imageBuffer: Buffer, category: ItemCategory) {
  const trimmed = await sharp(imageBuffer)
    .ensureAlpha()
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
    .png()
    .toBuffer();
  const box = CATEGORY_BOX[category];
  const fitted = await sharp(trimmed)
    .resize(box.width, box.height, { fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer();
  const metadata = await sharp(fitted).metadata();
  const width = metadata.width ?? box.width;
  const height = metadata.height ?? box.height;
  const left = Math.floor((1024 - width) / 2);
  const right = 1024 - width - left;
  const top = Math.floor((1024 - height) / 2);
  const bottom = 1024 - height - top;

  return sharp(fitted)
    .extend({
      top,
      bottom,
      left,
      right,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export async function enhanceWardrobeItem(
  item: EnhancementItem,
  references: EnhancementReference[]
): Promise<Buffer> {
  const visualReferences = references
    .filter((reference) => reference.kind !== "label")
    .slice(0, MAX_VISUAL_REFERENCES);
  const imageUrls = [item.original_url, ...visualReferences.map((reference) => reference.url)];

  const generationStartedAt = Date.now();
  let requestId: string | null = null;
  let lastQueueStatus = "";
  console.info(
    `[item-enhance] Starting ${ITEM_ENHANCEMENT_MODEL} with ${visualReferences.length} visual reference(s)`
  );
  const result = await withTimeout(
    fal.subscribe(ITEM_ENHANCEMENT_MODEL, {
      input: {
        prompt: buildPrompt(item, visualReferences),
        image_urls: imageUrls,
        image_size: "square_hd",
        num_images: 1,
        max_images: 1,
        enable_safety_checker: true,
      },
      logs: true,
      onEnqueue: (id) => {
        requestId = id;
        console.info(`[item-enhance] Seedream request queued: ${id}`);
      },
      onQueueUpdate: (update) => {
        if (update.status !== lastQueueStatus) {
          lastQueueStatus = update.status;
          console.info(`[item-enhance] Seedream ${update.status.toLowerCase()}`);
        }
      },
    }),
    GENERATION_TIMEOUT_MS,
    "Seedream photo enhancement",
    async () => {
      if (requestId) await fal.queue.cancel(ITEM_ENHANCEMENT_MODEL, { requestId });
    }
  );
  console.info(
    `[item-enhance] Seedream completed in ${Math.round((Date.now() - generationStartedAt) / 1000)}s`
  );
  const data = result.data as { images?: Array<{ url?: string }> };
  const generatedUrl = data.images?.[0]?.url;
  if (!generatedUrl) throw new Error("The enhancement model returned no image");

  // The existing product uses transparent cutouts everywhere. Re-segment the
  // generated studio image, then standardize its alpha bounds locally.
  const { cleanImageUrl } = await removeBackground(generatedUrl);
  const cleanResponse = await fetch(cleanImageUrl, {
    signal: AbortSignal.timeout(CUTOUT_DOWNLOAD_TIMEOUT_MS),
  });
  if (!cleanResponse.ok) {
    throw new Error(`Failed to download enhanced cutout (${cleanResponse.status})`);
  }
  return normalizeTransparentItem(Buffer.from(await cleanResponse.arrayBuffer()), item.category);
}
