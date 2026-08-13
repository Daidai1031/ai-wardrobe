import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getAccessibleClient, logWardrobeAccess } from "@/lib/stylist/access";
import type { StylistReviewTargetKind } from "@/types/database";

export const dynamic = "force-dynamic";

/**
 * The human stylist's suggestions (ROADMAP Phase 10-A).
 *
 * Writes go through the service role rather than her own session, even though she
 * could technically be given an INSERT policy. The row spans two users — it belongs
 * to the pair, references a target owned by the client, and points at items from the
 * client's wardrobe — so validating it in one server route means ownership is checked
 * in exactly one place instead of across three RLS predicates. `stylist_reviews` and
 * `stylist_review_items` therefore carry read policies only (schema 18f).
 *
 * The client answers a suggestion through /api/stylist/reviews/[id]/respond, which
 * calls the accept/decline/revert RPCs under their own session.
 */

interface ProposedItem {
  itemId: string;
  x: number | null;
  y: number | null;
  width: number | null;
}

function parseItems(raw: unknown): ProposedItem[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;

  const items: ProposedItem[] = [];
  for (const entry of raw) {
    const itemId =
      typeof entry === "string" ? entry : typeof entry?.itemId === "string" ? entry.itemId : null;
    if (!itemId) return null;
    const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
    items.push({
      itemId,
      x: typeof entry === "string" ? null : num(entry.x),
      y: typeof entry === "string" ? null : num(entry.y),
      width: typeof entry === "string" ? null : num(entry.width),
    });
  }

  if (new Set(items.map((item) => item.itemId)).size !== items.length) return null;
  return items;
}

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const clientId = request.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

  if (!(await getAccessibleClient(user.id, clientId))) {
    return NextResponse.json({ error: "No access to this client" }, { status: 403 });
  }

  // Her own session, so the "Stylist reads reviews she made" policy is what allows it.
  const { data, error } = await supabase
    .from("stylist_reviews")
    .select("*, stylist_review_items(item_id, position, x, y, width)")
    .eq("client_id", clientId)
    .eq("stylist_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("stylist reviews list failed:", error);
    return NextResponse.json({ error: "Failed to load suggestions" }, { status: 500 });
  }

  return NextResponse.json({ reviews: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const clientId = typeof body?.clientId === "string" ? body.clientId : null;
  const targetKind = body?.targetKind as StylistReviewTargetKind | undefined;
  const targetId = typeof body?.targetId === "string" ? body.targetId : null;
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  const proposedName = typeof body?.proposedName === "string" ? body.proposedName.trim() : "";
  const rating =
    typeof body?.rating === "number" && Number.isInteger(body.rating) && body.rating >= 1 && body.rating <= 5
      ? body.rating
      : null;

  const KINDS: StylistReviewTargetKind[] = ["outfit", "plan_segment", "item", "new_outfit"];
  if (!clientId || !targetKind || !KINDS.includes(targetKind)) {
    return NextResponse.json(
      { error: `clientId and targetKind (${KINDS.join(" | ")}) are required` },
      { status: 400 }
    );
  }
  // 'new_outfit' is the only kind with no target: the Look doesn't exist until the
  // client accepts, so there is nothing to point at.
  if (targetKind !== "new_outfit" && !targetId) {
    return NextResponse.json({ error: "targetId is required for this kind" }, { status: 400 });
  }

  const items = parseItems(body?.items);
  if (items === null) {
    return NextResponse.json({ error: "items must be a list of distinct wardrobe item ids" }, { status: 400 });
  }

  const client = await getAccessibleClient(user.id, clientId);
  if (!client) return NextResponse.json({ error: "No access to this client" }, { status: 403 });

  const service = createServiceSupabase();

  // The target must belong to this client. Without this a stylist with a live window
  // on client A could attach a suggestion to client B's Look.
  if (targetKind === "outfit") {
    const { data: outfit } = await service
      .from("outfits")
      .select("id")
      .eq("id", targetId)
      .eq("user_id", clientId)
      .maybeSingle();
    if (!outfit) return NextResponse.json({ error: "Look not found" }, { status: 404 });
  } else if (targetKind === "item") {
    const { data: item } = await service
      .from("wardrobe_items")
      .select("id")
      .eq("id", targetId)
      .eq("user_id", clientId)
      .maybeSingle();
    if (!item) return NextResponse.json({ error: "Piece not found" }, { status: 404 });
  } else if (targetKind === "plan_segment") {
    const { data: segment } = await service
      .from("outfit_plan_segments")
      .select("id, outfit_plans!inner(user_id)")
      .eq("id", targetId)
      .eq("outfit_plans.user_id", clientId)
      .maybeSingle();
    if (!segment) return NextResponse.json({ error: "Planned look not found" }, { status: 404 });
  }

  const hasProposal = items.length > 0;
  // One piece has no arrangement to propose. Rejecting this here rather than dropping
  // the items silently means a caller that sent them learns its request was wrong.
  if (hasProposal && targetKind === "item") {
    return NextResponse.json(
      { error: "A review of a single piece carries a rating and a note, not an arrangement" },
      { status: 400 }
    );
  }
  if (!hasProposal && rating === null && !note) {
    return NextResponse.json(
      { error: "A suggestion needs a rating, a note, or a new arrangement" },
      { status: 400 }
    );
  }
  if (hasProposal && !note) {
    return NextResponse.json(
      { error: "Add an updated outfit description before sending this change" },
      { status: 400 }
    );
  }
  // The /outfits builder never lets a Look drop below two pieces; a suggestion that
  // would take one there on accept has to be rejected here, not at accept time.
  if (hasProposal && (targetKind === "outfit" || targetKind === "new_outfit") && items.length < 2) {
    return NextResponse.json({ error: "A Look needs at least two pieces" }, { status: 400 });
  }
  // A Look built from scratch has no target to describe it and no existing name to
  // fall back on, so both are required rather than optional here. The schema's target
  // check enforces the same pair.
  if (targetKind === "new_outfit") {
    if (!hasProposal) {
      return NextResponse.json({ error: "A new Look needs pieces in it" }, { status: 400 });
    }
    if (!proposedName) {
      return NextResponse.json({ error: "Give the new Look a name" }, { status: 400 });
    }
  }

  if (hasProposal) {
    const { data: owned } = await service
      .from("wardrobe_items")
      .select("id")
      .eq("user_id", clientId)
      .in(
        "id",
        items.map((item) => item.itemId)
      );
    if ((owned?.length ?? 0) !== items.length) {
      return NextResponse.json({ error: "A proposed piece is not in this wardrobe" }, { status: 400 });
    }
  }

  const { data: review, error: reviewError } = await service
    .from("stylist_reviews")
    .insert({
      client_id: clientId,
      stylist_id: user.id,
      target_kind: targetKind,
      target_outfit_id: targetKind === "outfit" ? targetId : null,
      target_segment_id: targetKind === "plan_segment" ? targetId : null,
      target_item_id: targetKind === "item" ? targetId : null,
      proposed_name: targetKind === "new_outfit" ? proposedName : null,
      rating,
      note: note || null,
      has_proposal: hasProposal,
    })
    .select("id")
    .single();

  if (reviewError || !review) {
    console.error("stylist review insert failed:", reviewError);
    return NextResponse.json({ error: "Failed to save the suggestion" }, { status: 500 });
  }

  if (hasProposal) {
    const { error: itemsError } = await service.from("stylist_review_items").insert(
      items.map((item, index) => ({
        review_id: review.id,
        item_id: item.itemId,
        position: index,
        x: item.x,
        y: item.y,
        width: item.width,
      }))
    );

    if (itemsError) {
      // A review row whose items failed to write would reach the client as an empty
      // proposal they can accept, wiping the Look. Roll it back instead.
      await service.from("stylist_reviews").delete().eq("id", review.id);
      console.error("stylist review items insert failed:", itemsError);
      return NextResponse.json({ error: "Failed to save the suggestion" }, { status: 500 });
    }
  }

  await logWardrobeAccess(user.id, clientId, `review:create:${targetKind}`);

  return NextResponse.json({ id: review.id });
}
