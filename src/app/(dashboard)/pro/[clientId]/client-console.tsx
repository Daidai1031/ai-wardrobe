"use client";

/**
 * The stylist's workspace for one client (ROADMAP Phase 10-A).
 *
 * Five tabs rather than one long page, because a full closet under everything else is
 * a scroll, not a workspace:
 *
 *   1. Overview     — who they are, where the service stands, what has been booked.
 *   2. The week ahead — the days they've planned, reviewed one planned look at a time.
 *   3. Saved Looks  — the collages they kept.
 *   4. Every piece  — the closet itself, one garment at a time.
 *   5. Build a look — a new Look she assembles from their pieces.
 *
 * Overview leads because it is the only tab that answers "who am I looking at" — every
 * other tab assumes you already know. It is also the only read-only one.
 *
 * Three of the four working tabs open the shared Canvas and can therefore carry a
 * proposal. *Every piece* cannot — a lone garment has no arrangement — so a piece
 * review is a rating and a comment, and the schema's target check enforces that rather
 * than trusting this file.
 *
 * The editor is the same `OutfitCanvas`/`ClosetPicker` pair the client uses in /outfits
 * and /home — D12's "the stylist sees the client's own interface", and the reason there
 * is no second pointer-gesture implementation to keep in sync.
 *
 * Nothing here writes to the client's rows. Sending produces a `stylist_reviews`
 * proposal; the client's own accept is what applies it.
 */

import { useMemo, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarRange,
  Check,
  Eye,
  Loader2,
  Plus,
  Shirt,
  Sparkles,
  Star,
  UserRound,
  Video,
  X,
} from "lucide-react";
import {
  ClosetPicker,
  OutfitCanvas,
  OutfitCollage,
  defaultLayoutFor,
  layoutsFromRows,
  readDragPayload,
  type CanvasItemLayout,
} from "@/components/outfit/outfit-canvas";
import type { StylistClientOverview } from "@/lib/stylist/client-overview";
import type { StylistOccasionProjection } from "@/lib/stylist/occasion-projection";
import { wardrobeItemLabel, wardrobeItemName } from "@/lib/wardrobe/item-label";
import { cn } from "@/lib/utils";
import {
  ITEM_CATEGORIES,
  type ItemCategory,
  type StylistReviewStatus,
  type StylistReviewTargetKind,
  type WardrobeItem,
} from "@/types/database";

export interface ConsoleOutfit {
  id: string;
  name: string | null;
  folder: string | null;
  notes: string | null;
  rating: number | null;
  times_worn: number | null;
  ai_generated: boolean | null;
  created_at: string;
  outfit_items: {
    item_id: string;
    position: number | null;
    x: number | null;
    y: number | null;
    width: number | null;
  }[];
}

export interface ConsoleReview {
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
  stylist_review_items: {
    item_id: string;
    position: number;
    x: number | null;
    y: number | null;
    width: number | null;
  }[];
}

/**
 * What the Canvas is currently editing. `id` is empty for `new_outfit` — that kind has
 * no target row, which is exactly what makes it a new Look rather than an edit.
 */
interface EditorTarget {
  kind: Exclude<StylistReviewTargetKind, "item">;
  id: string;
  title: string;
  itemIds: string[];
  layouts: Record<string, CanvasItemLayout>;
}

type ConsoleTab = "overview" | "week" | "looks" | "closet" | "build";

const TABS: { id: ConsoleTab; label: string; icon: typeof CalendarRange }[] = [
  { id: "overview", label: "Overview", icon: UserRound },
  { id: "week", label: "The week ahead", icon: CalendarRange },
  { id: "looks", label: "Saved Looks", icon: Sparkles },
  { id: "closet", label: "Every piece", icon: Shirt },
  { id: "build", label: "Build a look", icon: Plus },
];

const STATUS_LABEL: Record<StylistReviewStatus, string> = {
  pending: "Waiting on the client",
  accepted: "Accepted",
  declined: "Declined",
  reverted: "Undone by the client",
};

function formatDay(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function ClientConsole({
  clientId,
  clientName,
  wardrobeItems,
  outfits,
  reviews,
  occasions,
  overview,
  accessExpiresAt,
  shareOccasions,
}: {
  clientId: string;
  clientName: string;
  wardrobeItems: WardrobeItem[];
  outfits: ConsoleOutfit[];
  reviews: ConsoleReview[];
  occasions: StylistOccasionProjection;
  overview: StylistClientOverview;
  accessExpiresAt: string;
  shareOccasions: boolean;
}) {
  const router = useRouter();
  const itemById = useMemo(
    () => new Map(wardrobeItems.map((item) => [item.id, item])),
    [wardrobeItems]
  );

  const [tab, setTab] = useState<ConsoleTab>("overview");
  const [newLookName, setNewLookName] = useState("");
  const [target, setTarget] = useState<EditorTarget | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [layouts, setLayouts] = useState<Record<string, CanvasItemLayout>>({});
  const [rating, setRating] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [activeCategory, setActiveCategory] = useState<ItemCategory | "All">("All");
  const [search, setSearch] = useState("");
  const [isCanvasOver, setIsCanvasOver] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTargets, setSentTargets] = useState<Set<string>>(() => new Set());
  // The piece being reviewed on the closet tab. Its own state rather than the editor's:
  // it opens a panel, not the Canvas, and the two must not half-share a draft.
  const [itemTarget, setItemTarget] = useState<WardrobeItem | null>(null);

  const reviewsByTarget = useMemo(() => {
    const map = new Map<string, ConsoleReview[]>();
    for (const review of reviews) {
      const key = review.target_outfit_id ?? review.target_segment_id ?? review.target_item_id;
      if (!key) continue;
      map.set(key, [...(map.get(key) ?? []), review]);
    }
    return map;
  }, [reviews]);

  const selectedItems = selectedIds
    .map((id) => itemById.get(id))
    .filter((item): item is WardrobeItem => Boolean(item));

  const pickerItems = wardrobeItems.filter((item) => {
    if (selectedIds.includes(item.id)) return false;
    const inCategory = activeCategory === "All" || item.category === activeCategory;
    const query = search.trim().toLowerCase();
    const matchesSearch =
      !query ||
      [item.display_name, item.user_notes, item.subcategory, item.category, item.color, item.brand]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query));
    return inCategory && matchesSearch;
  });

  // The stylist changed something only if the set or the arrangement differs. A
  // rating-and-note-only review is legitimate, so this decides whether to send items
  // at all rather than whether to allow sending.
  const hasProposal = useMemo(() => {
    if (!target) return false;
    if (selectedIds.length !== target.itemIds.length) return true;
    if (selectedIds.some((id, index) => id !== target.itemIds[index])) return true;
    return selectedIds.some((id) => {
      const before = target.layouts[id];
      const now = layouts[id];
      if (!before || !now) return true;
      return before.x !== now.x || before.y !== now.y || before.width !== now.width;
    });
  }, [target, selectedIds, layouts]);

  function openEditor(next: EditorTarget) {
    setItemTarget(null);
    setTarget(next);
    setSelectedIds(next.itemIds);
    setLayouts(next.layouts);
    setRating(null);
    setNote("");
    setNewLookName("");
    setActiveCategory("All");
    setSearch("");
    setError(null);
  }

  /** A Look that doesn't exist yet: empty Canvas, no target, name supplied by her. */
  function openNewLook() {
    openEditor({
      kind: "new_outfit",
      id: "",
      title: "New look",
      itemIds: [],
      layouts: {},
    });
  }

  function openItem(item: WardrobeItem) {
    setItemTarget(item);
    setRating(null);
    setNote("");
    setError(null);
  }

  function closeItem() {
    if (sending) return;
    setItemTarget(null);
  }

  function closeEditor() {
    if (sending) return;
    setTarget(null);
    setSelectedIds([]);
    setLayouts({});
  }

  function openOutfit(outfit: ConsoleOutfit) {
    const joins = [...outfit.outfit_items]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .filter((join) => itemById.has(join.item_id));
    openEditor({
      kind: "outfit",
      id: outfit.id,
      title: outfit.name || "Untitled Look",
      itemIds: joins.map((join) => join.item_id),
      layouts: layoutsFromRows(joins.map((join) => ({ id: join.item_id, ...join }))),
    });
  }

  function openSegment(segmentId: string, title: string, items: { itemId: string; x: number | null; y: number | null; width: number | null }[]) {
    const known = items.filter((item) => itemById.has(item.itemId));
    openEditor({
      kind: "plan_segment",
      id: segmentId,
      title,
      itemIds: known.map((item) => item.itemId),
      layouts: layoutsFromRows(known.map((item) => ({ id: item.itemId, ...item }))),
    });
  }

  function addItem(itemId: string, layout?: CanvasItemLayout) {
    if (selectedIds.includes(itemId)) return;
    setLayouts((current) => ({ ...current, [itemId]: layout || defaultLayoutFor(selectedIds.length) }));
    setSelectedIds((current) => [...current, itemId]);
  }

  function removeItem(itemId: string) {
    setSelectedIds((current) => current.filter((id) => id !== itemId));
    setLayouts((current) => {
      const next = { ...current };
      delete next[itemId];
      return next;
    });
  }

  function moveItem(from: number, to: number) {
    setSelectedIds((current) => {
      if (from === to || from < 0 || to < 0 || from >= current.length || to >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  function handleCanvasDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsCanvasOver(false);
    const payload = readDragPayload(event);
    if (payload?.source !== "closet") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 28;
    const itemHeight = (width * rect.width) / rect.height;
    const x = Math.max(0, Math.min(100 - width, ((event.clientX - rect.left) / rect.width) * 100 - width / 2));
    const y = Math.max(0, Math.min(100 - itemHeight, ((event.clientY - rect.top) / rect.height) * 100 - itemHeight / 2));
    addItem(payload.itemId, { x, y, width });
  }

  /**
   * Both review paths end here. The route re-checks everything this function sends —
   * ownership of the target, ownership of every proposed piece, and that a piece review
   * carries no arrangement — so the guards above it are for the stylist's benefit, not
   * the database's.
   */
  async function postReview(
    targetKind: StylistReviewTargetKind,
    targetId: string,
    items: { itemId: string; x: number | null; y: number | null; width: number | null }[],
    onSent: () => void
  ) {
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/stylist/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          targetKind,
          targetId: targetId || undefined,
          rating,
          note: note.trim() || undefined,
          proposedName: targetKind === "new_outfit" ? newLookName.trim() : undefined,
          items,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Could not send this suggestion");

      // A new Look has no target id to mark as reviewed; the refresh below is what
      // makes it appear in the sent list.
      if (targetId) setSentTargets((current) => new Set(current).add(targetId));
      onSent();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send this suggestion");
    } finally {
      setSending(false);
    }
  }

  async function send() {
    if (!target) return;
    if (target.kind === "new_outfit") {
      if (selectedIds.length < 2) {
        setError("A Look needs at least two pieces.");
        return;
      }
      if (!newLookName.trim()) {
        setError("Give the look a name — it becomes the name in their Looks.");
        return;
      }
      if (!note.trim()) {
        setError("Add a description so they know what this look is for.");
        return;
      }
    } else {
      if (!hasProposal && rating === null && !note.trim()) {
        setError("Add a rating, a note, or change the arrangement first.");
        return;
      }
      if (hasProposal && !note.trim()) {
        setError("Add an updated outfit description for the client.");
        return;
      }
      if (hasProposal && target.kind === "outfit" && selectedIds.length < 2) {
        setError("A Look needs at least two pieces.");
        return;
      }
    }

    await postReview(
      target.kind,
      target.id,
      hasProposal
        ? selectedIds.map((id) => ({
            itemId: id,
            x: layouts[id]?.x ?? null,
            y: layouts[id]?.y ?? null,
            width: layouts[id]?.width ?? null,
          }))
        : [],
      // Not closeEditor: that one refuses to run while a send is in flight, which is
      // right for a Cancel button and wrong for the send's own success path.
      () => {
        setTarget(null);
        setSelectedIds([]);
        setLayouts({});
      }
    );
  }

  async function sendItemReview() {
    if (!itemTarget) return;
    if (rating === null && !note.trim()) {
      setError("Add a rating or a comment first.");
      return;
    }
    await postReview("item", itemTarget.id, [], () => setItemTarget(null));
  }

  if (target) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-surface-200 bg-white px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-surface-900">
              {target.kind === "new_outfit" ? newLookName.trim() || target.title : target.title}
            </p>
            <p className="text-xs text-surface-400">
              {target.kind === "new_outfit"
                ? `New look · ${selectedIds.length} ${selectedIds.length === 1 ? "piece" : "pieces"}`
                : `${target.kind === "outfit" ? "Saved Look" : "Planned look"} · ${
                    hasProposal ? "You changed this arrangement" : "Unchanged so far"
                  }`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={closeEditor}
              disabled={sending}
              className="rounded-lg border border-surface-200 px-3 py-1.5 text-xs font-medium text-surface-600 transition-colors hover:bg-surface-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={send}
              disabled={sending}
              className="flex items-center gap-1.5 rounded-lg bg-surface-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-surface-800 disabled:opacity-50"
            >
              {sending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              Send to {clientName.split(" ")[0]}
            </button>
          </div>
        </div>

        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        )}

        <div className="grid gap-4 lg:grid-cols-[280px_1fr_260px]">
          <ClosetPicker
            items={pickerItems}
            activeCategory={activeCategory}
            search={search}
            onSearch={setSearch}
            onCategory={setActiveCategory}
            onAdd={(id) => addItem(id)}
            minHeightClass="min-h-[480px]"
            maxListHeightClass="max-h-[420px]"
          />

          <OutfitCanvas
            items={selectedItems}
            layouts={layouts}
            isOver={isCanvasOver}
            onOver={setIsCanvasOver}
            onDrop={handleCanvasDrop}
            onRemove={removeItem}
            onMove={moveItem}
            onLayoutChange={(id, layout) => setLayouts((current) => ({ ...current, [id]: layout }))}
          />

          <section className="space-y-4 rounded-2xl border border-surface-200 bg-white p-4">
            {target.kind === "new_outfit" ? (
              <div>
                <label htmlFor="new-look-name" className="text-xs font-semibold text-surface-700">
                  Name this look
                </label>
                <input
                  id="new-look-name"
                  value={newLookName}
                  onChange={(event) => setNewLookName(event.target.value)}
                  placeholder="Monday client meeting"
                  className="mt-2 w-full rounded-lg border border-surface-200 bg-surface-50 px-3 py-2 text-xs text-surface-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                />
                <p className="mt-1 text-[11px] text-surface-400">
                  Required — this is how it will be titled in their Looks.
                </p>
              </div>
            ) : (
              <div>
                <p className="text-xs font-semibold text-surface-700">Your rating</p>
                <div className="mt-2 flex gap-1">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setRating(rating === value ? null : value)}
                      aria-label={`${value} out of 5`}
                      className="rounded p-0.5 transition-transform hover:scale-110"
                    >
                      <Star
                        size={20}
                        className={cn(
                          rating !== null && value <= rating
                            ? "fill-amber-400 text-amber-400"
                            : "text-surface-300"
                        )}
                      />
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-surface-400">Optional. Tap again to clear.</p>
              </div>
            )}

            <div>
              <label htmlFor="stylist-note" className="text-xs font-semibold text-surface-700">
                {target.kind === "new_outfit"
                  ? "What this look is for"
                  : hasProposal
                    ? "Updated outfit description"
                    : "Note to the client"}
              </label>
              <textarea
                id="stylist-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={7}
                placeholder="Why this works, what to swap, how to wear it…"
                className="mt-2 w-full resize-none rounded-lg border border-surface-200 bg-surface-50 p-3 text-xs text-surface-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
              />
              <p className="mt-1 text-[11px] text-surface-400">
                {target.kind === "new_outfit"
                  ? "Required. It becomes the note saved with the Look."
                  : hasProposal
                    ? "Required. If accepted, this replaces the description shown with the outfit."
                    : "Optional unless you change the outfit."}
              </p>
            </div>

            <p className="rounded-lg bg-surface-50 p-3 text-[11px] leading-relaxed text-surface-500">
              {target.kind === "new_outfit"
                ? `Sending offers this look to ${clientName}. It only appears in their Looks if they accept, and they can undo that afterwards.`
                : `Sending creates a suggestion. Nothing in ${clientName}'s closet changes until they accept it, and they can undo an accept afterwards.`}
            </p>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap gap-1.5 rounded-xl border border-surface-200 bg-white p-1.5">
        {TABS.map(({ id, label, icon: Icon }) => {
          const count = id === "looks" ? outfits.length : id === "closet" ? wardrobeItems.length : null;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                tab === id
                  ? "bg-surface-900 text-white"
                  : "text-surface-600 hover:bg-surface-100 hover:text-surface-900"
              )}
            >
              <Icon size={13} strokeWidth={tab === id ? 2 : 1.5} />
              {label}
              {count !== null && (
                <span className={cn("text-[10px]", tab === id ? "text-white/60" : "text-surface-400")}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {tab === "overview" && (
        <OverviewPanel
          overview={overview}
          reviews={reviews}
          accessExpiresAt={accessExpiresAt}
          shareOccasions={shareOccasions}
          itemCount={wardrobeItems.length}
          lookCount={outfits.length}
        />
      )}

      {tab === "week" && (
        <OccasionsPanel occasions={occasions} itemById={itemById} onOpenSegment={openSegment} />
      )}

      {tab === "build" && (
        <BuildPanel
          reviews={reviews}
          itemById={itemById}
          clientName={clientName}
          onStart={openNewLook}
        />
      )}

      {tab === "closet" && (
        <ClosetPanel
          items={wardrobeItems}
          reviewsByTarget={reviewsByTarget}
          sentTargets={sentTargets}
          onOpen={openItem}
        />
      )}

      {itemTarget && (
        <ItemReviewPanel
          item={itemTarget}
          clientName={clientName}
          existing={reviewsByTarget.get(itemTarget.id) ?? []}
          rating={rating}
          note={note}
          sending={sending}
          error={error}
          onRating={setRating}
          onNote={setNote}
          onCancel={closeItem}
          onSend={sendItemReview}
        />
      )}

      {tab === "looks" && (
      <section>
        <h2 className="text-sm font-semibold text-surface-900">Saved Looks</h2>
        <p className="mt-0.5 text-xs text-surface-400">
          Rate one, leave a note, or re-arrange it and send it back as a suggestion.
        </p>

        {outfits.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-dashed border-surface-200 bg-white p-8 text-center text-xs text-surface-400">
            This client hasn&apos;t saved any Looks yet.
          </p>
        ) : (
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {outfits.map((outfit) => {
              const joins = [...outfit.outfit_items]
                .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
                .filter((join) => itemById.has(join.item_id));
              const items = joins
                .map((join) => itemById.get(join.item_id))
                .filter((item): item is WardrobeItem => Boolean(item));
              const sent = sentTargets.has(outfit.id);
              const existing = reviewsByTarget.get(outfit.id) ?? [];

              return (
                <li
                  key={outfit.id}
                  className="overflow-hidden rounded-2xl border border-surface-200 bg-white"
                >
                  <OutfitCollage
                    items={items}
                    layouts={layoutsFromRows(joins.map((join) => ({ id: join.item_id, ...join })))}
                    className="rounded-none"
                  />
                  <div className="space-y-2 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-surface-900">
                          {outfit.name || "Untitled Look"}
                        </p>
                        <p className="text-[11px] text-surface-400">
                          {items.length} pieces · worn {outfit.times_worn ?? 0}×
                        </p>
                      </div>
                      {outfit.ai_generated && (
                        <span className="shrink-0 rounded-full bg-surface-100 px-2 py-0.5 text-[10px] font-medium text-surface-500">
                          AI
                        </span>
                      )}
                    </div>

                    {existing.length > 0 && (
                      <p className="text-[10px] text-surface-400">
                        {existing.length} suggestion{existing.length > 1 ? "s" : ""} sent ·{" "}
                        {STATUS_LABEL[existing[0].status]}
                      </p>
                    )}

                    <button
                      type="button"
                      onClick={() => openOutfit(outfit)}
                      className="w-full rounded-lg border border-surface-200 px-3 py-1.5 text-[11px] font-medium text-surface-700 transition-colors hover:bg-surface-50"
                    >
                      {sent ? "Send another suggestion" : "Review this Look"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      )}
    </div>
  );
}

function OccasionsPanel({
  occasions,
  itemById,
  onOpenSegment,
}: {
  occasions: StylistOccasionProjection;
  itemById: Map<string, WardrobeItem>;
  onOpenSegment: (
    segmentId: string,
    title: string,
    items: { itemId: string; x: number | null; y: number | null; width: number | null }[]
  ) => void;
}) {
  const busyDays = occasions.days.filter(
    (day) => day.occasions.length > 0 || day.segments.length > 0
  );

  return (
    <section>
      <div className="flex items-center gap-2">
        <CalendarRange size={15} className="text-surface-400" />
        <h2 className="text-sm font-semibold text-surface-900">The week ahead</h2>
      </div>
      <p className="mt-0.5 flex items-start gap-1.5 text-xs text-surface-400">
        {occasions.occasionsShared ? (
          "Occasions are generalized on purpose — you see the kind of event and how formal it is, not the client's calendar entries."
        ) : (
          <>
            <Eye size={13} className="mt-0.5 shrink-0" />
            This client hasn&apos;t shared what&apos;s on their calendar, so you see the looks
            they&apos;ve planned but not what they&apos;re for.
          </>
        )}
      </p>

      {busyDays.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-dashed border-surface-200 bg-white p-6 text-center text-xs text-surface-400">
          {occasions.occasionsShared
            ? "Nothing on the next seven days."
            : "No looks planned for the next seven days."}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {busyDays.map((day) => (
            <li key={day.date} className="rounded-2xl border border-surface-200 bg-white p-4">
              <p className="text-xs font-semibold text-surface-900">{formatDay(day.date)}</p>

              {day.occasions.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {day.occasions.map((occasion) => (
                    <li key={occasion.id} className="flex flex-wrap items-center gap-2 text-xs text-surface-600">
                      <span>{occasion.description}</span>
                      {occasion.formality !== null && (
                        <span className="rounded-full bg-surface-100 px-2 py-0.5 text-[10px] font-medium text-surface-500">
                          formality {occasion.formality}/5
                        </span>
                      )}
                      {occasion.detail && (
                        <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-700">
                          {occasion.detail.timeLabel}
                          {occasion.detail.title ? ` · ${occasion.detail.title}` : ""}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {day.segments.length > 0 && (
                <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {day.segments.map((segment) => {
                    const items = segment.items
                      .map((item) => itemById.get(item.itemId))
                      .filter((item): item is WardrobeItem => Boolean(item));
                    if (items.length === 0) return null;
                    return (
                      <li key={segment.id} className="rounded-xl border border-surface-100 p-2">
                        <OutfitCollage
                          items={items}
                          layouts={layoutsFromRows(
                            segment.items
                              .filter((item) => itemById.has(item.itemId))
                              .map((item) => ({ id: item.itemId, ...item }))
                          )}
                        />
                        <p className="mt-2 truncate text-[11px] font-medium text-surface-700">
                          {segment.name}
                        </p>
                        <button
                          type="button"
                          onClick={() => onOpenSegment(segment.id, segment.name, segment.items)}
                          className="mt-1.5 w-full rounded-lg border border-surface-200 px-2 py-1 text-[10px] font-medium text-surface-700 transition-colors hover:bg-surface-50"
                        >
                          Review this look
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const SERVICE_LABEL: Record<string, string> = {
  online_30: "Online consultation (30 min)",
  in_person_day: "In-person day",
};

function formatSession(startsAt: string, endsAt: string) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const day = start.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const time = (value: Date) =>
    value.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${day} · ${time(start)}–${time(end)}`;
}

/**
 * Who this client is, where the service stands, and what has already passed between
 * them. Read-only: the one tab that isn't a review surface.
 *
 * "Past communication" is deliberately only what the product actually records —
 * booked consultations and the suggestions she has sent. There is no message store or
 * CRM sync in this repo yet (ROADMAP: Folk integration), and inventing a section that
 * is always empty would read as a bug rather than as an unbuilt feature.
 */
function OverviewPanel({
  overview,
  reviews,
  accessExpiresAt,
  shareOccasions,
  itemCount,
  lookCount,
}: {
  overview: StylistClientOverview;
  reviews: ConsoleReview[];
  accessExpiresAt: string;
  shareOccasions: boolean;
  itemCount: number;
  lookCount: number;
}) {
  const { profile, sessions } = overview;
  const now = Date.now();
  const upcoming = sessions.filter(
    (session) => session.status === "confirmed" && new Date(session.startsAt).getTime() >= now
  );
  const past = sessions.filter(
    (session) => session.status !== "confirmed" || new Date(session.startsAt).getTime() < now
  );
  const daysLeft = Math.max(
    0,
    Math.ceil((new Date(accessExpiresAt).getTime() - now) / (24 * 60 * 60 * 1000))
  );
  const answered = reviews.filter((review) => review.status !== "pending").length;
  const pending = reviews.length - answered;

  const measurements: [string, string | null][] = profile
    ? [
        ["Height", profile.heightCm ? `${profile.heightCm} cm` : null],
        ["Weight", profile.weightKg ? `${profile.weightKg} kg` : null],
        ["Body shape", profile.bodyShape ? profile.bodyShape.replace(/_/g, " ") : null],
        ["Bust", profile.bustCm ? `${profile.bustCm} cm` : null],
        ["Waist", profile.waistCm ? `${profile.waistCm} cm` : null],
        ["Hip", profile.hipCm ? `${profile.hipCm} cm` : null],
        ["Skin tone", profile.skinTone],
        ["Hair", [profile.hairColor, profile.hairLength].filter(Boolean).join(", ") || null],
      ]
    : [];
  const knownMeasurements = measurements.filter(([, value]) => Boolean(value));

  return (
    <div className="space-y-6">
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-surface-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-surface-900">Client</h2>
          <dl className="mt-3 space-y-1.5 text-xs">
            {[
              ["Name", profile?.name],
              ["Email", profile?.email],
              ["City", profile?.city],
              ["Timezone", profile?.timezone],
              [
                "With us since",
                profile?.memberSince ? new Date(profile.memberSince).toLocaleDateString() : null,
              ],
            ].map(([label, value]) => (
              <div key={label as string} className="flex justify-between gap-3">
                <dt className="text-surface-400">{label}</dt>
                <dd className="truncate text-surface-800">{value || "—"}</dd>
              </div>
            ))}
          </dl>

          {knownMeasurements.length > 0 ? (
            <>
              <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-surface-400">
                Fit
              </p>
              <dl className="mt-2 space-y-1.5 text-xs">
                {knownMeasurements.map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <dt className="text-surface-400">{label}</dt>
                    <dd className="truncate capitalize text-surface-800">{value}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : (
            <p className="mt-4 rounded-lg bg-surface-50 p-3 text-[11px] text-surface-500">
              They haven&apos;t filled in measurements or colouring yet.
            </p>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-surface-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-surface-900">Service status</h2>
            <dl className="mt-3 space-y-1.5 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-surface-400">Access window</dt>
                <dd className="text-surface-800">
                  {daysLeft} {daysLeft === 1 ? "day" : "days"} left ·{" "}
                  {new Date(accessExpiresAt).toLocaleDateString()}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-surface-400">Calendar occasions</dt>
                <dd className={shareOccasions ? "text-surface-800" : "text-surface-500"}>
                  {shareOccasions ? "Shared" : "Private"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-surface-400">Closet</dt>
                <dd className="text-surface-800">
                  {itemCount} pieces · {lookCount} Looks
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-surface-400">Suggestions sent</dt>
                <dd className="text-surface-800">
                  {reviews.length}
                  {pending > 0 ? ` · ${pending} awaiting an answer` : ""}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-2xl border border-surface-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-surface-900">Sessions</h2>
            {sessions.length === 0 ? (
              <p className="mt-2 text-xs text-surface-400">
                No consultations booked. The access window is opened by the consultation
                webhook, so a client can have a window without a booking on file.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                {upcoming.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-surface-400">
                      Upcoming
                    </p>
                    <ul className="mt-1.5 space-y-1.5">
                      {upcoming.map((session) => (
                        <li key={session.id} className="flex items-start gap-2 text-xs">
                          <Video size={13} className="mt-0.5 shrink-0 text-brand-600" />
                          <span className="text-surface-700">
                            {formatSession(session.startsAt, session.endsAt)}
                            <span className="block text-[11px] text-surface-400">
                              {SERVICE_LABEL[session.serviceType] || session.serviceType}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {past.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-surface-400">
                      Past
                    </p>
                    <ul className="mt-1.5 space-y-1.5">
                      {past.slice(0, 8).map((session) => (
                        <li key={session.id} className="flex items-start gap-2 text-xs">
                          <Video size={13} className="mt-0.5 shrink-0 text-surface-300" />
                          <span className="text-surface-500">
                            {formatSession(session.startsAt, session.endsAt)}
                            <span className="block text-[11px] text-surface-400">
                              {SERVICE_LABEL[session.serviceType] || session.serviceType}
                              {session.status === "cancelled" ? " · cancelled" : ""}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-surface-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-surface-900">What you&apos;ve sent</h2>
        {reviews.length === 0 ? (
          <p className="mt-2 text-xs text-surface-400">
            Nothing yet. Everything you send from the other tabs is listed here.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {reviews.slice(0, 10).map((review) => (
              <li
                key={review.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-50 px-3 py-2 text-xs"
              >
                <span className="text-surface-700">
                  {review.target_kind === "new_outfit"
                    ? `New look — ${review.proposed_name || "unnamed"}`
                    : review.target_kind === "item"
                      ? "A piece"
                      : review.target_kind === "outfit"
                        ? "A saved Look"
                        : "A planned look"}
                  <span className="ml-2 text-surface-400">
                    {new Date(review.created_at).toLocaleDateString()}
                  </span>
                </span>
                <span className="text-surface-500">{STATUS_LABEL[review.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * The fifth tab: a Look she builds from scratch out of the client's own pieces.
 *
 * It is still a proposal, not a write — accepting is what creates the `outfits` row.
 * That keeps the one rule the whole console runs on ("nothing here touches the client's
 * rows") true for the one feature that would most plausibly break it.
 */
function BuildPanel({
  reviews,
  itemById,
  clientName,
  onStart,
}: {
  reviews: ConsoleReview[];
  itemById: Map<string, WardrobeItem>;
  clientName: string;
  onStart: () => void;
}) {
  const built = reviews.filter((review) => review.target_kind === "new_outfit");

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-surface-900">Build a look</h2>
          <p className="mt-0.5 max-w-xl text-xs text-surface-400">
            Put together something new from {clientName}&apos;s own pieces. It arrives as a
            suggestion — it only lands in their Looks once they accept it.
          </p>
        </div>
        <button
          type="button"
          onClick={onStart}
          className="flex items-center gap-1.5 rounded-lg bg-surface-900 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-surface-800"
        >
          <Plus size={14} />
          Start a new look
        </button>
      </div>

      {built.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-dashed border-surface-200 bg-white p-8 text-center text-xs text-surface-400">
          You haven&apos;t built a look for this client yet.
        </p>
      ) : (
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {built.map((review) => {
            const rows = [...review.stylist_review_items]
              .sort((a, b) => a.position - b.position)
              .filter((row) => itemById.has(row.item_id));
            const items = rows
              .map((row) => itemById.get(row.item_id))
              .filter((item): item is WardrobeItem => Boolean(item));

            return (
              <li
                key={review.id}
                className="overflow-hidden rounded-2xl border border-surface-200 bg-white"
              >
                <OutfitCollage
                  items={items}
                  layouts={layoutsFromRows(rows.map((row) => ({ id: row.item_id, ...row })))}
                  className="rounded-none"
                />
                <div className="space-y-1 p-3">
                  <p className="truncate text-xs font-semibold text-surface-900">
                    {review.proposed_name || "Unnamed look"}
                  </p>
                  <p className="text-[11px] text-surface-400">
                    {items.length} pieces · {STATUS_LABEL[review.status]}
                  </p>
                  {review.note && (
                    <p className="line-clamp-3 text-[11px] leading-relaxed text-surface-500">
                      {review.note}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * The third reviewable thing: the closet itself, piece by piece.
 *
 * Its own filter state rather than the editor's, so moving between tabs doesn't reset
 * a search the stylist was in the middle of — and so the Canvas picker's filters and
 * this grid's filters can never surprise each other by being the same two variables.
 */
function ClosetPanel({
  items,
  reviewsByTarget,
  sentTargets,
  onOpen,
}: {
  items: WardrobeItem[];
  reviewsByTarget: Map<string, ConsoleReview[]>;
  sentTargets: Set<string>;
  onOpen: (item: WardrobeItem) => void;
}) {
  const [category, setCategory] = useState<ItemCategory | "All">("All");
  const [query, setQuery] = useState("");

  const visible = items.filter((item) => {
    const inCategory = category === "All" || item.category === category;
    const text = query.trim().toLowerCase();
    const matches =
      !text ||
      [item.display_name, item.subcategory, item.category, item.color, item.brand]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(text));
    return inCategory && matches;
  });

  return (
    <section>
      <h2 className="text-sm font-semibold text-surface-900">Every piece</h2>
      <p className="mt-0.5 text-xs text-surface-400">
        Open any piece to rate it and leave a comment. A single garment has no arrangement
        to change, so these go over as your thoughts on the piece itself.
      </p>

      <div className="mt-4 space-y-3">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, colour, brand…"
          className="w-full rounded-lg border border-surface-200 bg-white px-3 py-2 text-xs text-surface-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
        />
        <div className="flex flex-wrap gap-1.5">
          {(["All", ...ITEM_CATEGORIES] as (ItemCategory | "All")[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setCategory(value)}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                category === value
                  ? "bg-surface-900 text-white"
                  : "bg-surface-100 text-surface-600 hover:bg-surface-200"
              )}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-dashed border-surface-200 bg-white p-8 text-center text-xs text-surface-400">
          {items.length === 0
            ? "This client hasn't added any pieces yet."
            : "No pieces match that filter."}
        </p>
      ) : (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {visible.map((item) => {
            const existing = reviewsByTarget.get(item.id) ?? [];
            const reviewed = existing.length > 0 || sentTargets.has(item.id);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onOpen(item)}
                  className="group w-full overflow-hidden rounded-xl border border-surface-200 bg-white text-left transition-all hover:-translate-y-0.5 hover:border-surface-300 hover:shadow-sm"
                >
                  <div className="relative aspect-square bg-surface-50 p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.clean_url || item.original_url}
                      alt={wardrobeItemName(item)}
                      className="h-full w-full object-contain"
                    />
                    {reviewed && (
                      <span className="absolute right-1.5 top-1.5 rounded-full bg-brand-600 p-1 text-white">
                        <Check size={10} strokeWidth={3} />
                      </span>
                    )}
                  </div>
                  <div className="border-t border-surface-100 p-2">
                    <p className="truncate text-[11px] font-medium text-surface-800">
                      {wardrobeItemName(item)}
                    </p>
                    <p className="truncate text-[10px] text-surface-400">
                      {existing.length > 0
                        ? `${existing.length} sent · ${STATUS_LABEL[existing[0].status]}`
                        : [item.color, item.brand].filter(Boolean).join(" · ") || item.category}
                    </p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * Rating and comment on one piece. A panel rather than the Canvas view the other two
 * targets open: there is nothing to drag, and taking over the page would lose the
 * stylist's place in a closet she is working through item by item.
 */
function ItemReviewPanel({
  item,
  clientName,
  existing,
  rating,
  note,
  sending,
  error,
  onRating,
  onNote,
  onCancel,
  onSend,
}: {
  item: WardrobeItem;
  clientName: string;
  existing: ConsoleReview[];
  rating: number | null;
  note: string;
  sending: boolean;
  error: string | null;
  onRating: (value: number | null) => void;
  onNote: (value: string) => void;
  onCancel: () => void;
  onSend: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-6">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-white sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-surface-100 px-5 py-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-surface-900">
              {wardrobeItemName(item)}
            </p>
            <p className="truncate text-xs text-surface-400">{wardrobeItemLabel(item)}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={sending}
            className="rounded-lg p-1 text-surface-400 transition-colors hover:bg-surface-100 hover:text-surface-700 disabled:opacity-50"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid gap-5 p-5 sm:grid-cols-[220px_1fr]">
          <div>
            <div className="aspect-square rounded-xl border border-surface-100 bg-surface-50 p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.clean_url || item.original_url}
                alt={wardrobeItemName(item)}
                className="h-full w-full object-contain"
              />
            </div>
            <dl className="mt-3 space-y-1 text-[11px] text-surface-500">
              <div className="flex justify-between gap-2">
                <dt>Category</dt>
                <dd className="text-surface-800">{item.subcategory || item.category}</dd>
              </div>
              {item.color && (
                <div className="flex justify-between gap-2">
                  <dt>Colour</dt>
                  <dd className="text-surface-800">{item.color}</dd>
                </div>
              )}
              {item.brand && (
                <div className="flex justify-between gap-2">
                  <dt>Brand</dt>
                  <dd className="truncate text-surface-800">{item.brand}</dd>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <dt>Worn</dt>
                <dd className="text-surface-800">{item.times_worn ?? 0}×</dd>
              </div>
            </dl>
          </div>

          <div className="space-y-4">
            {existing.length > 0 && (
              <ul className="space-y-2">
                {existing.map((review) => (
                  <li
                    key={review.id}
                    className="rounded-lg border border-surface-100 bg-surface-50 p-3 text-[11px] text-surface-600"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-surface-700">
                        {new Date(review.created_at).toLocaleDateString()}
                      </span>
                      <span className="text-surface-400">{STATUS_LABEL[review.status]}</span>
                    </div>
                    {review.rating !== null && (
                      <div className="mt-1 flex gap-0.5">
                        {[1, 2, 3, 4, 5].map((value) => (
                          <Star
                            key={value}
                            size={11}
                            className={cn(
                              value <= review.rating!
                                ? "fill-amber-400 text-amber-400"
                                : "text-surface-200"
                            )}
                          />
                        ))}
                      </div>
                    )}
                    {review.note && <p className="mt-1 whitespace-pre-wrap">{review.note}</p>}
                  </li>
                ))}
              </ul>
            )}

            <div>
              <p className="text-xs font-semibold text-surface-700">Your rating</p>
              <div className="mt-2 flex gap-1">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => onRating(rating === value ? null : value)}
                    aria-label={`${value} out of 5`}
                    className="rounded p-0.5 transition-transform hover:scale-110"
                  >
                    <Star
                      size={20}
                      className={cn(
                        rating !== null && value <= rating
                          ? "fill-amber-400 text-amber-400"
                          : "text-surface-300"
                      )}
                    />
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-surface-400">Tap again to clear.</p>
            </div>

            <div>
              <label htmlFor="stylist-item-note" className="text-xs font-semibold text-surface-700">
                Comment
              </label>
              <textarea
                id="stylist-item-note"
                value={note}
                onChange={(event) => onNote(event.target.value)}
                rows={6}
                placeholder="What it works with, when to reach for it, what to replace it with…"
                className="mt-2 w-full resize-none rounded-lg border border-surface-200 bg-surface-50 p-3 text-xs text-surface-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
              />
              <p className="mt-1 text-[11px] text-surface-400">
                A rating or a comment — either on its own is enough to send.
              </p>
            </div>

            {error && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={onCancel}
                disabled={sending}
                className="rounded-lg border border-surface-200 px-3 py-1.5 text-xs font-medium text-surface-600 transition-colors hover:bg-surface-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onSend}
                disabled={sending}
                className="flex items-center gap-1.5 rounded-lg bg-surface-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-surface-800 disabled:opacity-50"
              >
                {sending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                Send to {clientName.split(" ")[0]}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
