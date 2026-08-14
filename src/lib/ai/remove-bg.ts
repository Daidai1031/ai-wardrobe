/**
 * Background removal via fal.ai BiRefNet.
 *
 * This replaces the SAM-based segmentation for single-item photos.
 * For flat-lay multi-item photos, we'd still use SAM — but for MVP,
 * single-item upload with background removal is the priority flow.
 */
import { fal } from "@fal-ai/client";
import { withTimeout } from "./async-timeout";

fal.config({ credentials: process.env.FAL_KEY! });

const BACKGROUND_REMOVAL_TIMEOUT_MS = 45_000;

export interface RemoveBgResult {
  cleanImageUrl: string;
}

export async function removeBackground(imageUrl: string): Promise<RemoveBgResult> {
  const model = "fal-ai/birefnet/v2";
  const startedAt = Date.now();
  let requestId: string | null = null;
  let lastQueueStatus = "";
  const result = await withTimeout(
    fal.subscribe(model, {
      input: {
        image_url: imageUrl,
      },
      logs: true,
      onEnqueue: (id) => {
        requestId = id;
        console.info(`[remove-bg] BiRefNet request queued: ${id}`);
      },
      onQueueUpdate: (update) => {
        if (update.status !== lastQueueStatus) {
          lastQueueStatus = update.status;
          console.info(`[remove-bg] BiRefNet ${update.status.toLowerCase()}`);
        }
      },
    }),
    BACKGROUND_REMOVAL_TIMEOUT_MS,
    "BiRefNet background removal",
    async () => {
      if (requestId) await fal.queue.cancel(model, { requestId });
    }
  );
  console.info(`[remove-bg] BiRefNet completed in ${Math.round((Date.now() - startedAt) / 1000)}s`);

  const data = result.data as { image: { url: string } };
  return { cleanImageUrl: data.image.url };
}
