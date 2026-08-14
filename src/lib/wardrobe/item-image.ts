export interface WardrobeImageSource {
  optimized_url?: string | null;
  clean_url: string | null;
  original_url: string;
}

/** One display rule for Closet, Looks, plans, and the stylist console. */
export function wardrobeItemImage(item: WardrobeImageSource): string {
  return item.optimized_url || item.clean_url || item.original_url;
}
