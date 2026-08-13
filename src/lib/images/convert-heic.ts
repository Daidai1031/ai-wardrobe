/**
 * HEIC/HEIF (iPhone's default) is not natively viewable or processable in the
 * browser or by Sharp downstream, so it has to become JPEG *before* upload.
 * Conversion itself happens server-side in /api/ai/convert; this is the shared
 * client-side guard both the closet upload flow and the item-detail extra-angle
 * uploader call, so the two can't drift on which extensions count as HEIC.
 */
export async function convertIfNeeded(file: File): Promise<File> {
  const name = file.name.toLowerCase();
  const isHeic =
    name.endsWith(".heic") ||
    name.endsWith(".heif") ||
    file.type === "image/heic" ||
    file.type === "image/heif";

  if (!isHeic) return file;

  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch("/api/ai/convert", { method: "POST", body: formData });
  if (!res.ok) throw new Error("Failed to convert HEIC image");

  const blob = await res.blob();
  return new File(
    [blob],
    file.name.replace(/\.heic$/i, ".jpg").replace(/\.heif$/i, ".jpg"),
    { type: "image/jpeg" }
  );
}
