export interface LabelableWardrobeItem {
  display_name?: string | null;
  category: string;
  subcategory?: string | null;
  color?: string | null;
  brand?: string | null;
}

/** User-authored names are authoritative; AI metadata is only the fallback. */
export function wardrobeItemName(item: LabelableWardrobeItem): string {
  const custom = item.display_name?.trim();
  return custom || item.subcategory?.trim() || item.category;
}

/** A compact label for lists and generated-plan item breakdowns. */
export function wardrobeItemLabel(item: LabelableWardrobeItem): string {
  if (item.display_name?.trim()) return item.display_name.trim();
  return [item.color, item.subcategory || item.category, item.brand].filter(Boolean).join(" · ");
}
