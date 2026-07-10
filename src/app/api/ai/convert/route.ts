import { NextRequest, NextResponse } from "next/server";
import convert from "heic-convert";
import sharp from "sharp";

/**
 * POST /api/ai/convert
 *
 * Converts HEIC/HEIF images to JPEG.
 * Uses heic-convert for decoding (handles iPhone edge cases),
 * then Sharp for final compression.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const inputBuffer = Buffer.from(arrayBuffer);

    // Step 1: HEIC → raw JPEG via heic-convert
    const converted = await convert({
      buffer: inputBuffer,
      format: "JPEG",
      quality: 0.92,
    });

    // Step 2: Resize if huge (saves storage + downstream processing)
    const jpegBuffer = await sharp(Buffer.from(converted))
      .resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();

    return new NextResponse(jpegBuffer, {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": jpegBuffer.length.toString(),
      },
    });
  } catch (err) {
    console.error("HEIC conversion error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Conversion failed" },
      { status: 500 },
    );
  }
}