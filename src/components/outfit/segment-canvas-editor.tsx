"use client";

/**
 * Editing one plan segment on the shared freeform Canvas.
 *
 * Extracted from /home once /plan needed the same thing: the week view could show
 * any of seven days but could only send the user to /home, which always shows
 * today — so every day except today was uneditable. The RPCs behind this were
 * never date-limited, only the UI was.
 *
 * Edits are persisted immediately on Save. The plan is re-read from the database
 * on every load, so purely client-side edits were silently lost on refresh.
 */

import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { Check, Layers3, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  ClosetPicker,
  OutfitCanvas,
  OutfitCollage,
  defaultLayoutFor,
  layoutsFromRows,
  readDragPayload,
  type CanvasItemLayout,
} from "@/components/outfit/outfit-canvas";
import type { ItemCategory } from "@/types/database";
import type { DailySegmentItem, DailySegmentResponse, DailyWardrobeItem } from "@/types/daily";

interface SavedLookItemRow {
  item_id: string;
  position: number | null;
  x: number | null;
  y: number | null;
  width: number | null;
}

interface SavedLookRow {
  id: string;
  name: string | null;
  folder: string | null;
  outfit_items: SavedLookItemRow[];
}

export interface SegmentCanvasSaveResult {
  items: DailySegmentItem[];
  savedOutfitId: string | null;
  sourceOutfitId: string | null;
}

export function SegmentCanvasEditor({
  segment,
  availableItems,
  showSavedLooksInitially = false,
  onCancel,
  onSaved,
}: {
  segment: DailySegmentResponse;
  availableItems: DailyWardrobeItem[];
  showSavedLooksInitially?: boolean;
  onCancel: () => void;
  onSaved: (result: SegmentCanvasSaveResult) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    segment.items.map((item) => item.id)
  );
  const [layouts, setLayouts] = useState<Record<string, CanvasItemLayout>>(() =>
    layoutsFromRows(segment.items)
  );
  const [activeCategory, setActiveCategory] = useState<ItemCategory | "All">("All");
  const [search, setSearch] = useState("");
  const [isCanvasOver, setIsCanvasOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showSavedLooks, setShowSavedLooks] = useState(showSavedLooksInitially);
  const [savedLooks, setSavedLooks] = useState<SavedLookRow[] | null>(null);
  const [loadingSavedLooks, setLoadingSavedLooks] = useState(false);
  const [sourceOutfitId, setSourceOutfitId] = useState<string | null>(
    segment.sourceOutfitId ?? segment.savedOutfitId
  );
  const [matchesSourceOutfit, setMatchesSourceOutfit] = useState(
    Boolean(segment.savedOutfitId && (segment.sourceOutfitId ?? segment.savedOutfitId))
  );

  const itemById = useMemo(
    () => new Map(availableItems.map((item) => [item.id, item])),
    [availableItems]
  );

  const selectedItems = selectedIds
    .map((id) => itemById.get(id))
    .filter((item): item is DailyWardrobeItem => Boolean(item));

  const pickerItems = availableItems.filter((item) => {
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

  const loadSavedLooks = useCallback(async () => {
    if (savedLooks || loadingSavedLooks) return;

    setLoadingSavedLooks(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setSavedLooks([]);
      setLoadingSavedLooks(false);
      return;
    }

    const { data, error } = await supabase
      .from("outfits")
      .select("id, name, folder, outfit_items(item_id, position, x, y, width)")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });

    if (error) {
      toast.error(error.message || "Couldn't load your saved outfits");
      setSavedLooks([]);
    } else {
      setSavedLooks((data || []) as SavedLookRow[]);
    }
    setLoadingSavedLooks(false);
  }, [loadingSavedLooks, savedLooks, supabase]);

  useEffect(() => {
    if (showSavedLooks) void loadSavedLooks();
  }, [loadSavedLooks, showSavedLooks]);

  function markSourceModified() {
    if (sourceOutfitId) setMatchesSourceOutfit(false);
  }

  function addItem(itemId: string, layout?: CanvasItemLayout) {
    if (selectedIds.includes(itemId)) return;
    markSourceModified();
    setLayouts((current) => ({
      ...current,
      [itemId]: layout || defaultLayoutFor(selectedIds.length),
    }));
    setSelectedIds((current) => [...current, itemId]);
  }

  function removeItem(itemId: string) {
    markSourceModified();
    setSelectedIds((current) => current.filter((id) => id !== itemId));
    setLayouts((current) => {
      const next = { ...current };
      delete next[itemId];
      return next;
    });
  }

  function moveItem(from: number, to: number) {
    if (from !== to) markSourceModified();
    setSelectedIds((current) => {
      if (from === to || from < 0 || to < 0 || from >= current.length || to >= current.length) {
        return current;
      }
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
    const x = Math.max(
      0,
      Math.min(100 - width, ((event.clientX - rect.left) / rect.width) * 100 - width / 2)
    );
    const y = Math.max(
      0,
      Math.min(100 - itemHeight, ((event.clientY - rect.top) / rect.height) * 100 - itemHeight / 2)
    );
    addItem(payload.itemId, { x, y, width });
  }

  function selectSavedLook(look: SavedLookRow) {
    const rows = [...look.outfit_items]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .filter((row) => itemById.has(row.item_id));

    if (rows.length === 0) {
      toast.error("None of this outfit's items are currently available in your closet");
      return;
    }

    const ids = rows.map((row) => row.item_id);
    const nextLayouts: Record<string, CanvasItemLayout> = {};
    rows.forEach((row, index) => {
      nextLayouts[row.item_id] =
        row.x != null && row.y != null && row.width != null
          ? { x: row.x, y: row.y, width: row.width }
          : defaultLayoutFor(index);
    });

    setSelectedIds(ids);
    setLayouts(nextLayouts);
    setSourceOutfitId(look.id);
    setMatchesSourceOutfit(rows.length === look.outfit_items.length);
    setShowSavedLooks(false);
    toast.success(`Using “${look.name || "Untitled outfit"}”`);
  }

  async function save() {
    if (selectedIds.length === 0) {
      toast.error("Keep at least one item in this segment");
      return;
    }

    setSaving(true);
    const items: DailySegmentItem[] = selectedItems.map((item) => ({
      ...item,
      x: layouts[item.id]?.x ?? null,
      y: layouts[item.id]?.y ?? null,
      width: layouts[item.id]?.width ?? null,
    }));

    const { data: result, error } = await supabase.rpc("update_outfit_plan_segment_from_canvas", {
      p_segment_id: segment.id,
      p_items: items.map((item) => ({
        itemId: item.id,
        x: item.x,
        y: item.y,
        width: item.width,
      })),
      p_source_outfit_id: sourceOutfitId,
      p_source_matches: matchesSourceOutfit,
    });

    setSaving(false);

    if (error) {
      toast.error(error.message || "Couldn't save this segment");
      return;
    }

    toast.success(`Updated “${segment.label}”`);
    const saved = (result || {}) as {
      savedOutfitId?: string | null;
      sourceOutfitId?: string | null;
    };
    onSaved({
      items,
      savedOutfitId: saved.savedOutfitId ?? null,
      sourceOutfitId: saved.sourceOutfitId ?? sourceOutfitId,
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-surface-200 bg-white px-4 py-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-surface-400">Adjusting segment</p>
          <h2 className="text-sm font-semibold text-surface-900">{segment.label}</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            disabled={saving}
            className="px-3 py-2 rounded-lg border border-surface-200 text-xs font-medium text-surface-600 hover:bg-surface-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={saving || selectedIds.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 text-white text-xs font-semibold hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {saving ? "Saving…" : "Done"}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-surface-200 bg-white p-3">
        <button
          type="button"
          onClick={() => setShowSavedLooks((current) => !current)}
          className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-1 text-left"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-surface-800">
            <Layers3 size={15} className="text-brand-500" />
            Reuse a saved outfit
          </span>
          <span className="text-xs font-medium text-brand-600">
            {showSavedLooks ? "Hide" : sourceOutfitId ? "Choose another" : "Choose"}
          </span>
        </button>

        {sourceOutfitId && !showSavedLooks && (
          <p className="mt-1 px-1 text-xs text-surface-500">
            This segment is based on a saved outfit. You can keep editing it on the Canvas.
          </p>
        )}

        {showSavedLooks && (
          <div className="mt-3 border-t border-surface-100 pt-3">
            {loadingSavedLooks ? (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-surface-400">
                <Loader2 size={14} className="animate-spin" /> Loading saved outfits…
              </div>
            ) : savedLooks && savedLooks.length > 0 ? (
              <div className="grid max-h-72 grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-5">
                {savedLooks.map((look) => {
                  const rows = [...look.outfit_items]
                    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
                    .filter((row) => itemById.has(row.item_id));
                  const lookItems = rows.map((row) => ({
                    ...itemById.get(row.item_id)!,
                    x: row.x,
                    y: row.y,
                    width: row.width,
                  }));
                  const isActive = look.id === sourceOutfitId;

                  return (
                    <button
                      key={look.id}
                      type="button"
                      onClick={() => selectSavedLook(look)}
                      disabled={rows.length === 0}
                      className={`rounded-xl border p-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                        isActive
                          ? "border-brand-300 bg-brand-50"
                          : "border-surface-200 hover:border-brand-200 hover:bg-surface-50"
                      }`}
                    >
                      <OutfitCollage
                        items={lookItems}
                        layouts={layoutsFromRows(lookItems)}
                        className="rounded-lg"
                      />
                      <p className="mt-2 truncate text-xs font-semibold text-surface-800">
                        {look.name || "Untitled outfit"}
                      </p>
                      <p className="truncate text-[10px] text-surface-400">
                        {look.folder || "Uncategorized"} · {rows.length} items
                      </p>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="py-5 text-center text-xs text-surface-500">
                No saved outfits yet. Save a plan or create one in Your outfits first.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <ClosetPicker
          items={pickerItems}
          activeCategory={activeCategory}
          search={search}
          onSearch={setSearch}
          onCategory={setActiveCategory}
          onAdd={addItem}
          minHeightClass="min-h-[420px]"
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
          onLayoutChange={(id, layout) => {
            markSourceModified();
            setLayouts((current) => ({ ...current, [id]: layout }));
          }}
        />
      </div>
    </div>
  );
}
