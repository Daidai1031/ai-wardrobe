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

import { useMemo, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  ClosetPicker,
  OutfitCanvas,
  defaultLayoutFor,
  layoutsFromRows,
  readDragPayload,
  type CanvasItemLayout,
} from "@/components/outfit/outfit-canvas";
import type { ItemCategory } from "@/types/database";
import type { DailySegmentItem, DailySegmentResponse, DailyWardrobeItem } from "@/types/daily";

export function SegmentCanvasEditor({
  segment,
  availableItems,
  onCancel,
  onSaved,
}: {
  segment: DailySegmentResponse;
  availableItems: DailyWardrobeItem[];
  onCancel: () => void;
  onSaved: (items: DailySegmentItem[]) => void;
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
      [item.subcategory, item.category, item.color, item.brand]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query));
    return inCategory && matchesSearch;
  });

  function addItem(itemId: string, layout?: CanvasItemLayout) {
    if (selectedIds.includes(itemId)) return;
    setLayouts((current) => ({
      ...current,
      [itemId]: layout || defaultLayoutFor(selectedIds.length),
    }));
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

    const { error } = await supabase.rpc("update_outfit_plan_segment_items", {
      p_segment_id: segment.id,
      p_items: items.map((item) => ({
        itemId: item.id,
        x: item.x,
        y: item.y,
        width: item.width,
      })),
    });

    setSaving(false);

    if (error) {
      toast.error(error.message || "Couldn't save this segment");
      return;
    }

    toast.success(`Updated “${segment.label}”`);
    onSaved(items);
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
          onLayoutChange={(id, layout) =>
            setLayouts((current) => ({ ...current, [id]: layout }))
          }
        />
      </div>
    </div>
  );
}
