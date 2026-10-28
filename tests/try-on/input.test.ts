import { describe, expect, it } from "vitest";
import {
  eligibleTryOnGarments,
  tryOnFingerprint,
  tryOnGarmentsInWearOrder,
  type TryOnGarment,
} from "@/lib/try-on/input";
import type { ItemCategory } from "@/types/database";

function garment(
  partial: Partial<TryOnGarment> & Pick<TryOnGarment, "id" | "category">
): TryOnGarment {
  return {
    display_name: null,
    subcategory: null,
    color: null,
    optimized_url: null,
    clean_url: `https://example.com/${partial.id}.png`,
    original_url: `https://example.com/${partial.id}-original.png`,
    ...partial,
  };
}

describe("virtual try-on input", () => {
  it("drops bags and accessories and keeps at most six wearable pieces", () => {
    const tops = ["a", "b", "c", "d", "e", "f", "g"].map((id) =>
      garment({ id, category: "Tops" })
    );
    const items = [
      garment({ id: "bag", category: "Bags" }),
      garment({ id: "belt", category: "Accessories" }),
      ...tops,
    ];
    expect(eligibleTryOnGarments(items).map((item) => item.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
    ]);
  });

  it("draws the reference as outer layer, torso, legs, then shoes", () => {
    const items = [
      garment({ id: "shoe", category: "Shoes" }),
      garment({ id: "coat", category: "Outerwear" }),
      garment({ id: "trouser", category: "Bottoms" }),
      garment({ id: "shirt", category: "Tops" }),
      garment({ id: "bag", category: "Bags" as ItemCategory }),
    ];
    expect(tryOnGarmentsInWearOrder(items).map((item) => item.id)).toEqual([
      "coat",
      "shirt",
      "trouser",
      "shoe",
    ]);
  });

  it("keeps the same fingerprint when only piece order changes", () => {
    const shirt = garment({ id: "shirt", category: "Tops", optimized_url: "https://example.com/shirt-v2.jpg" });
    const shoe = garment({ id: "shoe", category: "Shoes" });
    const bag = garment({ id: "bag", category: "Bags" });
    expect(tryOnFingerprint("photo.jpg", [shirt, shoe, bag])).toBe(
      tryOnFingerprint("photo.jpg", [bag, shoe, shirt])
    );
    expect(tryOnFingerprint("other.jpg", [shirt, shoe])).not.toBe(
      tryOnFingerprint("photo.jpg", [shirt, shoe])
    );
    expect(tryOnFingerprint("photo.jpg", [shirt, shoe])).not.toBe(
      tryOnFingerprint("photo.jpg", [{ ...shirt, optimized_url: "https://example.com/shirt-v3.jpg" }, shoe])
    );
  });
});
