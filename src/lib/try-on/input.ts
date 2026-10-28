import { createHash } from "node:crypto";
import { wardrobeItemImage } from "@/lib/wardrobe/item-image";
import { VIRTUAL_TRY_ON_CATEGORIES } from "./constants";
import type { ItemCategory, WardrobeItem } from "@/types/database";

const SUPPORTED_CATEGORIES = new Set<ItemCategory>(VIRTUAL_TRY_ON_CATEGORIES);
const MAX_GARMENTS = 6;
const WEAR_ORDER: ItemCategory[] = ["Outerwear", "Tops", "Dresses", "Bottoms", "Shoes"];

export type TryOnGarment = Pick<
  WardrobeItem,
  | "id"
  | "display_name"
  | "category"
  | "subcategory"
  | "color"
  | "optimized_url"
  | "clean_url"
  | "original_url"
>;

export function eligibleTryOnGarments(items: TryOnGarment[]) {
  return items.filter((item) => SUPPORTED_CATEGORIES.has(item.category)).slice(0, MAX_GARMENTS);
}

/** Outer layer, torso, legs, then shoes — the order the reference sheet is drawn in. */
export function tryOnGarmentsInWearOrder(items: TryOnGarment[]) {
  return [...eligibleTryOnGarments(items)].sort(
    (a, b) => WEAR_ORDER.indexOf(a.category) - WEAR_ORDER.indexOf(b.category)
  );
}

export function tryOnFingerprint(personPhotoPath: string, items: TryOnGarment[]) {
  const revision = eligibleTryOnGarments(items)
    .map((item) => `${item.id}:${wardrobeItemImage(item)}`)
    .sort()
    .join("|");
  return createHash("sha256").update(`${personPhotoPath}|${revision}`).digest("hex");
}

export function virtualTryOnPrompt(items: TryOnGarment[]) {
  const garments = tryOnGarmentsInWearOrder(items);
  const description = garments
    .map((item) => [item.color, item.display_name || item.subcategory || item.category].filter(Boolean).join(" "))
    .join(", ");

  return `Create a realistic, natural full-body fashion photograph of the same person wearing the exact garments shown in the garment reference: ${description}. Preserve the person's identity, face, hair, skin tone, body proportions, pose, hands, and the original background. Preserve each garment's exact color, pattern, material, silhouette, length, closures, and visible details. Arrange the pieces as one coherent outfit with tops naturally tucked or untucked as appropriate and outerwear layered over tops. Do not add logos, garments, accessories, bags, jewelry, hats, or text that are not in the references.`;
}
