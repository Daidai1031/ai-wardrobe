/**
 * Reading the human stylist's suggestions from the client's side (ROADMAP Phase 10-A).
 *
 * Runs under the client's own session — `stylist_reviews` / `stylist_review_items`
 * carry a "client reads own" SELECT policy (schema 18f), so no service role is needed
 * here and none should be used: this is ordinary owned data.
 *
 * Each card carries both the proposed set and the target's current set, because the
 * question the client is answering is "is this better than what I have", and answering
 * it from a single collage means opening another page to compare.
 */

import type { createServerSupabase } from "@/lib/supabase/server";
import { wardrobeItemLabel } from "@/lib/wardrobe/item-label";
import type {
  StylistReviewItemGeometry,
  StylistReviewStatus,
  StylistReviewTargetKind,
  WardrobeItem,
} from "@/types/database";

type ServerSupabase = Awaited<ReturnType<typeof createServerSupabase>>;

export interface ReviewCardItem {
  id: string;
  display_name: string | null;
  category: string;
  subcategory: string | null;
  color: string | null;
  clean_url: string | null;
  original_url: string;
  x: number | null;
  y: number | null;
  width: number | null;
}

export interface StylistReviewCard {
  id: string;
  targetKind: StylistReviewTargetKind;
  targetLabel: string;
  rating: number | null;
  note: string | null;
  hasProposal: boolean;
  status: StylistReviewStatus;
  createdAt: string;
  current: ReviewCardItem[];
  proposed: ReviewCardItem[];
}

interface RawReview {
  id: string;
  target_kind: StylistReviewTargetKind;
  target_outfit_id: string | null;
  target_segment_id: string | null;
  target_item_id: string | null;
  proposed_name: string | null;
  rating: number | null;
  note: string | null;
  has_proposal: boolean;
  status: StylistReviewStatus;
  created_at: string;
  previous_items: StylistReviewItemGeometry[] | null;
  stylist_review_items: {
    item_id: string;
    position: number;
    x: number | null;
    y: number | null;
    width: number | null;
  }[];
}

const ITEM_SELECT = "id, display_name, category, subcategory, color, clean_url, original_url";

function toCardItem(
  item: Pick<
    WardrobeItem,
    "id" | "display_name" | "category" | "subcategory" | "color" | "clean_url" | "original_url"
  >,
  geometry: { x: number | null; y: number | null; width: number | null }
): ReviewCardItem {
  return { ...item, x: geometry.x, y: geometry.y, width: geometry.width };
}

/**
 * Suggestions worth showing the client: everything still unanswered, plus every
 * answered one, because the inbox now keeps a "Reviewed" history behind its own button
 * — a record the client can look back at, and where an accepted suggestion's undo
 * lives. Answered rows are deliberately not filtered out here: the component splits
 * them by `status`, and a row dropped at this layer could not appear in the history.
 */
export async function readStylistReviewsForClient(
  supabase: ServerSupabase,
  userId: string,
  limit = 20
): Promise<StylistReviewCard[]> {
  const { data, error } = await supabase
    .from("stylist_reviews")
    .select(
      "id, target_kind, target_outfit_id, target_segment_id, target_item_id, proposed_name, rating, note, has_proposal, status, previous_items, created_at, stylist_review_items(item_id, position, x, y, width)"
    )
    .eq("client_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    // A missing table (schema section 18 not applied yet) must not take /home down —
    // the rest of the page is unrelated. PostgREST reports it as PGRST205.
    console.error("readStylistReviewsForClient failed:", error);
    return [];
  }

  const reviews = (data ?? []) as RawReview[];
  if (reviews.length === 0) return [];

  const outfitIds = reviews.map((r) => r.target_outfit_id).filter((id): id is string => Boolean(id));
  const segmentIds = reviews.map((r) => r.target_segment_id).filter((id): id is string => Boolean(id));

  const [outfitsResult, outfitItemsResult, segmentsResult, segmentItemsResult] = await Promise.all([
    outfitIds.length
      ? supabase.from("outfits").select("id, name").in("id", outfitIds)
      : Promise.resolve({ data: [] as { id: string; name: string | null }[] }),
    outfitIds.length
      ? supabase.from("outfit_items").select("outfit_id, item_id, position, x, y, width").in("outfit_id", outfitIds)
      : Promise.resolve({ data: [] as { outfit_id: string; item_id: string; position: number | null; x: number | null; y: number | null; width: number | null }[] }),
    segmentIds.length
      ? supabase
          .from("outfit_plan_segments")
          .select("id, label, outfit_plans(plan_date)")
          .in("id", segmentIds)
      : Promise.resolve({ data: [] as { id: string; label: string; outfit_plans: unknown }[] }),
    segmentIds.length
      ? supabase
          .from("outfit_plan_segment_items")
          .select("segment_id, item_id, position, x, y, width")
          .in("segment_id", segmentIds)
      : Promise.resolve({ data: [] as { segment_id: string; item_id: string; position: number; x: number | null; y: number | null; width: number | null }[] }),
  ]);

  const outfits = new Map((outfitsResult.data ?? []).map((row) => [row.id, row]));
  const outfitItems = outfitItemsResult.data ?? [];
  const segments = new Map((segmentsResult.data ?? []).map((row) => [row.id, row]));
  const segmentItems = segmentItemsResult.data ?? [];

  const itemIds = new Set<string>();
  reviews.forEach((review) => review.stylist_review_items.forEach((row) => itemIds.add(row.item_id)));
  reviews.forEach((review) =>
    (Array.isArray(review.previous_items) ? review.previous_items : []).forEach((row) => {
      if (typeof row?.itemId === "string") itemIds.add(row.itemId);
    })
  );
  outfitItems.forEach((row) => itemIds.add(row.item_id));
  segmentItems.forEach((row) => itemIds.add(row.item_id));
  // An item review's target is itself a wardrobe row, so it rides along in the same
  // lookup instead of a second query.
  reviews.forEach((review) => {
    if (review.target_item_id) itemIds.add(review.target_item_id);
  });

  const { data: itemRows } = await supabase
    .from("wardrobe_items")
    .select(ITEM_SELECT)
    .in("id", Array.from(itemIds));
  const itemById = new Map((itemRows ?? []).map((item) => [item.id, item]));

  return reviews.map((review) => {
    const targetRows =
      review.target_kind === "outfit"
        ? outfitItems
            .filter((row) => row.outfit_id === review.target_outfit_id)
            .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        : review.target_kind === "plan_segment"
          ? segmentItems
              .filter((row) => row.segment_id === review.target_segment_id)
              .sort((a, b) => a.position - b.position)
          : // An item review's "current" is the piece itself, so the card can show what
            // she is talking about without the client opening /closet to find out.
            review.target_item_id
            ? [{ item_id: review.target_item_id, position: 0, x: null, y: null, width: null }]
            : [];

    const previousRows = (Array.isArray(review.previous_items) ? review.previous_items : [])
      .filter((row) => typeof row?.itemId === "string")
      .map((row, position) => ({
        item_id: row.itemId,
        position,
        x: row.x ?? null,
        y: row.y ?? null,
        width: row.width ?? null,
      }));

    // Accept replaces the target itself, so reading its current joins afterwards
    // produces the stylist's version on both sides. The accept RPC snapshots the
    // old version in previous_items specifically so the accepted card can still
    // render a truthful Before comparison (and Undo can restore it).
    const comparisonRows =
      review.status === "accepted" && review.has_proposal && previousRows.length > 0
        ? previousRows
        : targetRows;

    const segment = review.target_segment_id ? segments.get(review.target_segment_id) : undefined;
    const outfit = review.target_outfit_id ? outfits.get(review.target_outfit_id) : undefined;
    const targetItem = review.target_item_id ? itemById.get(review.target_item_id) : undefined;
    // PostgREST types a to-one embed as "object or array of object"; normalize rather
    // than casting, so a shape change surfaces here instead of at runtime.
    const embedded = segment?.outfit_plans;
    const planDate = Array.isArray(embedded)
      ? (embedded[0] as { plan_date?: string } | undefined)?.plan_date
      : (embedded as { plan_date?: string } | null | undefined)?.plan_date;

    return {
      id: review.id,
      targetKind: review.target_kind,
      targetLabel:
        review.target_kind === "outfit"
          ? outfit?.name || "One of your Looks"
          : review.target_kind === "new_outfit"
            ? review.proposed_name || "A new Look"
            : review.target_kind === "item"
              ? targetItem
                ? wardrobeItemLabel(targetItem)
                : "A piece in your closet"
            : // The segment's own label is fine here — this is the client's own data;
              // it is only the *stylist* who must never see it (D17).
              [planDate, segment?.label].filter(Boolean).join(" · ") || "A planned look",
      rating: review.rating,
      note: review.note,
      hasProposal: review.has_proposal,
      status: review.status,
      createdAt: review.created_at,
      current: comparisonRows
        .map((row) => {
          const item = itemById.get(row.item_id);
          return item ? toCardItem(item, row) : null;
        })
        .filter((item): item is ReviewCardItem => Boolean(item)),
      proposed: [...review.stylist_review_items]
        .sort((a, b) => a.position - b.position)
        .map((row) => {
          const item = itemById.get(row.item_id);
          return item ? toCardItem(item, row) : null;
        })
        .filter((item): item is ReviewCardItem => Boolean(item)),
    };
  });
}
