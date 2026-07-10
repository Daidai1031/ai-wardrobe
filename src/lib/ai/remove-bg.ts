/**
 * Background removal via fal.ai BiRefNet.
 *
 * This replaces the SAM-based segmentation for single-item photos.
 * For flat-lay multi-item photos, we'd still use SAM — but for MVP,
 * single-item upload with background removal is the priority flow.
 */
import { fal } from "@fal-ai/client";

fal.config({ credentials: process.env.FAL_KEY! });

export interface RemoveBgResult {
  cleanImageUrl: string;
}

export async function removeBackground(imageUrl: string): Promise<RemoveBgResult> {
  const result = await fal.subscribe("fal-ai/birefnet/v2", {
    input: {
      image_url: imageUrl,
    },
  });

  const data = result.data as { image: { url: string } };
  return { cleanImageUrl: data.image.url };
}
