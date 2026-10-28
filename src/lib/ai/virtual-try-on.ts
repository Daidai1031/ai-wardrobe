import { fal } from "@fal-ai/client";
import sharp from "sharp";
import { withTimeout } from "./async-timeout";
import { wardrobeItemImage } from "@/lib/wardrobe/item-image";
import { VIRTUAL_TRY_ON_MODEL } from "@/lib/try-on/constants";
import { tryOnGarmentsInWearOrder, type TryOnGarment } from "@/lib/try-on/input";

fal.config({ credentials: process.env.FAL_KEY! });

const GENERATION_TIMEOUT_MS = 180_000;
const DOWNLOAD_TIMEOUT_MS = 20_000;
async function downloadImage(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Could not read a garment image (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * FLUX VTO accepts one garment URL. For a saved Look, flatten its transparent
 * closet cutouts into one clean reference sheet, staying below the model's
 * one-megapixel recommendation.
 */
function sheetSize(count: number) {
  if (count <= 1) return { width: 640, height: 832, columns: 1 };
  const columns = 2;
  const rows = Math.ceil(count / columns);
  const height = rows === 1 ? 640 : rows === 2 ? 768 : 960;
  return { width: 768, height, columns };
}

export async function composeGarmentReference(items: TryOnGarment[]) {
  const garments = tryOnGarmentsInWearOrder(items);
  if (garments.length === 0) {
    throw new Error("This look has no supported clothing pieces to try on");
  }

  const { width, height, columns } = sheetSize(garments.length);
  const rows = Math.ceil(garments.length / columns);
  const gap = 16;
  const cellWidth = Math.floor((width - gap * (columns + 1)) / columns);
  const cellHeight = Math.floor((height - gap * (rows + 1)) / rows);
  const paper = { r: 248, g: 247, b: 245 };

  const rendered = await Promise.all(
    garments.map(async (item) => {
      const source = await downloadImage(wardrobeItemImage(item));
      return sharp(source)
        .rotate()
        .resize(cellWidth, cellHeight, { fit: "contain", background: paper })
        .jpeg({ quality: 90 })
        .toBuffer();
    })
  );

  const composite = rendered.map((input, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      input,
      left: gap + column * (cellWidth + gap),
      top: gap + row * (cellHeight + gap),
    };
  });

  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 248, g: 247, b: 245 },
    },
  })
    .composite(composite)
    .jpeg({ quality: 90, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

export interface VirtualTryOnGeneration {
  imageUrl: string;
  seed: number | null;
}

export async function generateVirtualTryOn(
  humanImageUrl: string,
  garmentReference: Buffer,
  prompt: string
): Promise<VirtualTryOnGeneration> {
  const garmentImageUrl = await fal.storage.upload(
    new Blob([new Uint8Array(garmentReference)], { type: "image/jpeg" })
  );

  let requestId: string | null = null;
  const result = await withTimeout(
    fal.subscribe(VIRTUAL_TRY_ON_MODEL, {
      input: {
        prompt,
        human_image_url: humanImageUrl,
        garment_image_url: garmentImageUrl,
        output_format: "jpeg",
        enable_safety_checker: true,
      },
      logs: true,
      onEnqueue: (id) => {
        requestId = id;
        console.info(`[virtual-try-on] FLUX VTO request queued: ${id}`);
      },
      onQueueUpdate: (update) => {
        console.info(`[virtual-try-on] FLUX VTO ${update.status.toLowerCase()}`);
      },
    }),
    GENERATION_TIMEOUT_MS,
    "FLUX virtual try-on",
    async () => {
      if (requestId) await fal.queue.cancel(VIRTUAL_TRY_ON_MODEL, { requestId });
    }
  );

  const data = result.data as {
    images?: Array<{ url?: string }>;
    seed?: number;
    has_nsfw_concepts?: boolean[];
  };
  if (data.has_nsfw_concepts?.[0]) throw new Error("The generated image was blocked by the safety filter");

  const imageUrl = data.images?.[0]?.url;
  if (!imageUrl) throw new Error("The virtual try-on model returned no image");
  return { imageUrl, seed: data.seed ?? null };
}

export async function downloadTryOnResult(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Could not download the try-on result (${response.status})`);
  return sharp(Buffer.from(await response.arrayBuffer()))
    .rotate()
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    .toBuffer();
}
