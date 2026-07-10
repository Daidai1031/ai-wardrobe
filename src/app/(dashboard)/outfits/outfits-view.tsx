"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type DragEvent } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Layers3,
  Loader2,
  Maximize2,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Shirt,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { ITEM_CATEGORIES, type ItemCategory, type WardrobeItem } from "@/types/database";

type OutfitItemPreview = Pick<
  WardrobeItem,
  "id" | "clean_url" | "original_url" | "category" | "subcategory" | "color" | "brand"
>;

interface SavedOutfitJoin {
  item_id: string;
  position: number | null;
  x: number | null;
  y: number | null;
  width: number | null;
  wardrobe_items: OutfitItemPreview | null;
}

export interface SavedOutfit {
  id: string;
  name: string | null;
  folder: string | null;
  notes: string | null;
  times_worn: number;
  created_at: string;
  outfit_items: SavedOutfitJoin[];
}

interface OutfitsViewProps {
  outfits: SavedOutfit[];
  wardrobeItems: WardrobeItem[];
  userId: string;
}

type DragPayload =
  | { source: "closet"; itemId: string }
  | { source: "canvas"; itemId: string; index: number };

interface CanvasItemLayout {
  x: number;
  y: number;
  width: number;
}

const OUTFIT_FOLDERS = [
  "Uncategorized",
  "Everyday",
  "Work",
  "Weekend",
  "Date Night",
  "Travel",
  "Special Occasion",
];

function itemName(item: OutfitItemPreview) {
  return item.subcategory || item.category;
}

function imageUrl(item: OutfitItemPreview) {
  return item.clean_url || item.original_url;
}

function writeDragPayload(event: DragEvent, payload: DragPayload) {
  event.dataTransfer.setData("application/x-wardrobe-item", JSON.stringify(payload));
  event.dataTransfer.setData("text/plain", payload.itemId);
}

function readDragPayload(event: DragEvent): DragPayload | null {
  try {
    const raw = event.dataTransfer.getData("application/x-wardrobe-item");
    return raw ? (JSON.parse(raw) as DragPayload) : null;
  } catch {
    return null;
  }
}

function defaultLayoutFor(index: number): CanvasItemLayout {
  const defaultWidth = index >= 6 ? 22 : 28;
  const columns = index >= 6 ? 4 : 3;
  const column = index % columns;
  const row = Math.floor(index / columns);
  const horizontalStep = (94 - defaultWidth) / (columns - 1);
  return {
    x: 3 + column * horizontalStep,
    y: 4 + (row % 3) * 31,
    width: defaultWidth,
  };
}

export function OutfitsView({ outfits, wardrobeItems, userId }: OutfitsViewProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [isCreating, setIsCreating] = useState(false);
  const [editingOutfitId, setEditingOutfitId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [canvasLayouts, setCanvasLayouts] = useState<Record<string, CanvasItemLayout>>({});
  const [activeCategory, setActiveCategory] = useState<ItemCategory | "All">("All");
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("Uncategorized");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [isCanvasOver, setIsCanvasOver] = useState(false);

  const itemById = useMemo(
    () => new Map(wardrobeItems.map((item) => [item.id, item])),
    [wardrobeItems]
  );
  const selectedItems = selectedIds
    .map((id) => itemById.get(id))
    .filter((item): item is WardrobeItem => Boolean(item));
  const filteredItems = wardrobeItems.filter((item) => {
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

    setCanvasLayouts((layouts) => ({
      ...layouts,
      [itemId]: layout || defaultLayoutFor(selectedIds.length),
    }));
    setSelectedIds((current) => (current.includes(itemId) ? current : [...current, itemId]));
  }

  function removeItem(itemId: string) {
    setSelectedIds((current) => current.filter((id) => id !== itemId));
    setCanvasLayouts((current) => {
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

  function resetBuilder() {
    setSelectedIds([]);
    setCanvasLayouts({});
    setName("");
    setFolder("Uncategorized");
    setNotes("");
    setActiveCategory("All");
    setSearch("");
  }

  function closeBuilder() {
    if (saving) return;
    if ((selectedIds.length > 0 || name || notes) && !window.confirm("Discard this outfit draft?")) {
      return;
    }
    resetBuilder();
    setEditingOutfitId(null);
    setIsCreating(false);
  }

  function startCreate() {
    resetBuilder();
    setEditingOutfitId(null);
    setIsCreating(true);
  }

  function startEdit(outfit: SavedOutfit) {
    const joins = [...outfit.outfit_items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const ids: string[] = [];
    const layouts: Record<string, CanvasItemLayout> = {};
    joins.forEach((join, index) => {
      if (!join.wardrobe_items || !itemById.has(join.item_id)) return;
      ids.push(join.item_id);
      layouts[join.item_id] =
        join.x != null && join.y != null && join.width != null
          ? { x: join.x, y: join.y, width: join.width }
          : defaultLayoutFor(index);
    });
    setSelectedIds(ids);
    setCanvasLayouts(layouts);
    setName(outfit.name || "");
    setFolder(outfit.folder || "Uncategorized");
    setNotes(outfit.notes || "");
    setActiveCategory("All");
    setSearch("");
    setEditingOutfitId(outfit.id);
    setIsCreating(true);
  }

  function handleCanvasDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsCanvasOver(false);
    const payload = readDragPayload(event);
    if (payload?.source === "closet") {
      const rect = event.currentTarget.getBoundingClientRect();
      const width = 28;
      const itemHeight = (width * rect.width) / rect.height;
      const x = Math.max(0, Math.min(100 - width, ((event.clientX - rect.left) / rect.width) * 100 - width / 2));
      const y = Math.max(0, Math.min(100 - itemHeight, ((event.clientY - rect.top) / rect.height) * 100 - itemHeight / 2));
      addItem(payload.itemId, { x, y, width });
    }
  }

  function updateCanvasLayout(itemId: string, layout: CanvasItemLayout) {
    setCanvasLayouts((current) => ({ ...current, [itemId]: layout }));
  }

  async function saveOutfit() {
    if (selectedIds.length < 2) {
      toast.error("Add at least two items to save an outfit");
      return;
    }

    setSaving(true);
    const fallbackName = `Outfit · ${new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
    }).format(new Date())}`;
    const outfitItemRows = selectedIds.map((itemId, position) => ({
      item_id: itemId,
      position,
      x: canvasLayouts[itemId]?.x ?? null,
      y: canvasLayouts[itemId]?.y ?? null,
      width: canvasLayouts[itemId]?.width ?? null,
    }));

    if (editingOutfitId) {
      const { error: outfitError } = await supabase
        .from("outfits")
        .update({
          name: name.trim() || fallbackName,
          folder,
          notes: notes.trim() || null,
        })
        .eq("id", editingOutfitId);

      if (outfitError) {
        toast.error(outfitError.message || "Failed to update outfit");
        setSaving(false);
        return;
      }

      const { error: deleteError } = await supabase
        .from("outfit_items")
        .delete()
        .eq("outfit_id", editingOutfitId);
      if (deleteError) {
        toast.error(deleteError.message || "Failed to update outfit items");
        setSaving(false);
        return;
      }

      const { error: itemsError } = await supabase
        .from("outfit_items")
        .insert(outfitItemRows.map((row) => ({ ...row, outfit_id: editingOutfitId })));
      if (itemsError) {
        toast.error(itemsError.message || "Failed to attach items to outfit");
        setSaving(false);
        return;
      }

      toast.success("Outfit updated");
      resetBuilder();
      setEditingOutfitId(null);
      setIsCreating(false);
      setSaving(false);
      router.refresh();
      return;
    }

    const { data: outfit, error: outfitError } = await supabase
      .from("outfits")
      .insert({
        user_id: userId,
        name: name.trim() || fallbackName,
        folder,
        notes: notes.trim() || null,
        ai_generated: false,
      })
      .select("id")
      .single();

    if (outfitError || !outfit) {
      toast.error(outfitError?.message || "Failed to save outfit");
      setSaving(false);
      return;
    }

    const { error: itemsError } = await supabase
      .from("outfit_items")
      .insert(outfitItemRows.map((row) => ({ ...row, outfit_id: outfit.id })));
    if (itemsError) {
      await supabase.from("outfits").delete().eq("id", outfit.id);
      toast.error(itemsError.message || "Failed to attach items to outfit");
      setSaving(false);
      return;
    }

    toast.success("Outfit saved");
    resetBuilder();
    setIsCreating(false);
    setSaving(false);
    router.refresh();
  }

  if (isCreating) {
    return (
      <div className="min-h-[calc(100vh-7rem)]">
        <BuilderHeader
          isEditing={Boolean(editingOutfitId)}
          onClose={closeBuilder}
          onReset={resetBuilder}
          onSave={saveOutfit}
          saving={saving}
          canSave={selectedIds.length >= 2}
          canReset={selectedIds.length > 0}
        />
        <div className="grid gap-4 lg:grid-cols-[minmax(260px,0.8fr)_minmax(380px,1.45fr)_minmax(220px,0.65fr)]">
          <ClosetPicker
            items={filteredItems}
            activeCategory={activeCategory}
            search={search}
            onSearch={setSearch}
            onCategory={setActiveCategory}
            onAdd={addItem}
          />
          <OutfitCanvas
            items={selectedItems}
            layouts={canvasLayouts}
            isOver={isCanvasOver}
            onOver={setIsCanvasOver}
            onDrop={handleCanvasDrop}
            onRemove={removeItem}
            onMove={moveItem}
            onLayoutChange={updateCanvasLayout}
          />
          <OutfitDetails
            name={name}
            folder={folder}
            notes={notes}
            count={selectedItems.length}
            saving={saving}
            onName={setName}
            onFolder={setFolder}
            onNotes={setNotes}
            onSave={saveOutfit}
          />
        </div>
      </div>
    );
  }

  return (
    <OutfitLibrary
      outfits={outfits}
      wardrobeCount={wardrobeItems.length}
      onCreate={startCreate}
      onEdit={startEdit}
    />
  );
}

function BuilderHeader({
  isEditing,
  onClose,
  onReset,
  onSave,
  saving,
  canSave,
  canReset,
}: {
  isEditing: boolean;
  onClose: () => void;
  onReset: () => void;
  onSave: () => void;
  saving: boolean;
  canSave: boolean;
  canReset: boolean;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <button
          type="button"
          onClick={onClose}
          className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-surface-500 transition-colors hover:text-surface-900"
        >
          <ChevronLeft size={14} /> Back to outfits
        </button>
        <h1 className="font-display text-2xl font-semibold text-surface-900">
          {isEditing ? "Edit outfit" : "Build an outfit"}
        </h1>
        <p className="mt-1 text-sm text-surface-500">
          Drag pieces onto the canvas, then reorder them to set the layer order.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onReset}
          disabled={saving || !canReset}
          className="inline-flex items-center gap-2 rounded-lg border border-surface-200 bg-white px-3.5 py-2 text-sm font-medium text-surface-600 transition-colors hover:bg-surface-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RotateCcw size={15} /> Clear
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !canSave}
          className="inline-flex items-center gap-2 rounded-lg bg-surface-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-surface-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
          {saving ? "Saving…" : isEditing ? "Save changes" : "Save outfit"}
        </button>
      </div>
    </div>
  );
}

function ClosetPicker({
  items,
  activeCategory,
  search,
  onSearch,
  onCategory,
  onAdd,
}: {
  items: WardrobeItem[];
  activeCategory: ItemCategory | "All";
  search: string;
  onSearch: (value: string) => void;
  onCategory: (value: ItemCategory | "All") => void;
  onAdd: (id: string) => void;
}) {
  return (
    <section className="flex min-h-[620px] flex-col overflow-hidden rounded-2xl border border-surface-200 bg-white">
      <div className="border-b border-surface-100 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-surface-900">Your closet</h2>
            <p className="mt-0.5 text-xs text-surface-400">Drag or tap to add</p>
          </div>
          <span className="rounded-full bg-surface-100 px-2 py-1 text-[10px] font-semibold text-surface-500">
            {items.length} items
          </span>
        </div>
        <label className="mt-3 flex items-center gap-2 rounded-lg border border-surface-200 bg-surface-50 px-3 py-2 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100">
          <Search size={14} className="shrink-0 text-surface-400" />
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search color, brand, type…"
            className="w-full bg-transparent text-xs text-surface-800 outline-none placeholder:text-surface-400"
          />
        </label>
        <div className="scrollbar-hide mt-3 flex gap-1.5 overflow-x-auto pb-1">
          {["All", ...ITEM_CATEGORIES].map((category) => (
            <button
              type="button"
              key={category}
              onClick={() => onCategory(category as ItemCategory | "All")}
              className={cn(
                "whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors",
                activeCategory === category
                  ? "bg-surface-900 text-white"
                  : "bg-surface-100 text-surface-500 hover:bg-surface-200"
              )}
            >
              {category}
            </button>
          ))}
        </div>
      </div>

      <div className="scrollbar-hide grid max-h-[520px] flex-1 auto-rows-max grid-cols-2 content-start items-start gap-3 overflow-y-auto p-3">
        {items.map((item) => (
            <button
              type="button"
              key={item.id}
              draggable
              onDragStart={(event) => {
                writeDragPayload(event, { source: "closet", itemId: item.id });
                event.dataTransfer.effectAllowed = "copy";
              }}
              onClick={() => onAdd(item.id)}
              className="group relative aspect-square w-full self-start overflow-hidden rounded-xl border border-surface-200 bg-surface-50 text-left transition-all hover:-translate-y-0.5 hover:border-surface-300 hover:shadow-sm"
              aria-label={`Add ${itemName(item)}`}
            >
              <div className="absolute inset-0">
                <Image
                  src={imageUrl(item)}
                  alt={`${item.color || ""} ${itemName(item)}`}
                  fill
                  className="object-contain p-2"
                  sizes="(max-width: 1024px) 25vw, 150px"
                  unoptimized
                />
              </div>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-white via-white/90 to-transparent px-2 pb-1.5 pt-5">
                <p className="truncate text-[10px] font-medium text-surface-700">{itemName(item)}</p>
              </div>
              <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-surface-500 shadow-sm transition-colors group-hover:bg-surface-900 group-hover:text-white">
                <Plus size={13} />
              </span>
            </button>
          ))}
        {items.length === 0 && (
          <div className="col-span-2 flex min-h-48 flex-col items-center justify-center text-center">
            <Shirt size={24} className="mb-2 text-surface-300" />
            <p className="text-xs text-surface-400">No matching pieces</p>
          </div>
        )}
      </div>
    </section>
  );
}

function OutfitCanvas({
  items,
  layouts,
  isOver,
  onOver,
  onDrop,
  onRemove,
  onMove,
  onLayoutChange,
}: {
  items: WardrobeItem[];
  layouts: Record<string, CanvasItemLayout>;
  isOver: boolean;
  onOver: (value: boolean) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onRemove: (id: string) => void;
  onMove: (from: number, to: number) => void;
  onLayoutChange: (id: string, layout: CanvasItemLayout) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [gesture, setGesture] = useState<{
    itemId: string;
    mode: "move" | "resize";
    startClientX: number;
    startClientY: number;
    startLayout: CanvasItemLayout;
  } | null>(null);

  function startGesture(
    event: ReactPointerEvent<HTMLElement>,
    itemId: string,
    index: number,
    mode: "move" | "resize"
  ) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const layout = layouts[itemId];
    if (!layout) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setGesture({
      itemId,
      mode,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startLayout: layout,
    });
    if (index !== items.length - 1) onMove(index, items.length - 1);
  }

  function updateGesture(event: ReactPointerEvent<HTMLElement>) {
    if (!gesture || !canvasRef.current) return;
    event.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const deltaX = event.clientX - gesture.startClientX;
    const deltaY = event.clientY - gesture.startClientY;

    if (gesture.mode === "move") {
      const itemHeight = (gesture.startLayout.width * rect.width) / rect.height;
      onLayoutChange(gesture.itemId, {
        ...gesture.startLayout,
        x: Math.max(
          0,
          Math.min(
            100 - gesture.startLayout.width,
            gesture.startLayout.x + (deltaX / rect.width) * 100
          )
        ),
        y: Math.max(
          0,
          Math.min(100 - itemHeight, gesture.startLayout.y + (deltaY / rect.height) * 100)
        ),
      });
      return;
    }

    const resizeDelta = Math.max(deltaX, deltaY) / rect.width * 100;
    const maxWidthFromRight = 100 - gesture.startLayout.x;
    const maxWidthFromBottom =
      ((100 - gesture.startLayout.y) * rect.height) / rect.width;
    const maxWidth = Math.min(60, maxWidthFromRight, maxWidthFromBottom);
    onLayoutChange(gesture.itemId, {
      ...gesture.startLayout,
      width: Math.max(15, Math.min(maxWidth, gesture.startLayout.width + resizeDelta)),
    });
  }

  function endGesture(event: ReactPointerEvent<HTMLElement>) {
    if (!gesture) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setGesture(null);
  }

  return (
    <section className="rounded-2xl border border-surface-200 bg-[#f1eee9] p-3 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold text-surface-600">
          <Layers3 size={15} /> Outfit canvas
        </div>
        <div className="text-right">
          <span className="block text-[10px] font-medium text-surface-500">
            {items.length} {items.length === 1 ? "piece" : "pieces"}
          </span>
          <span className="block text-[9px] text-surface-400">Drag to move · corner to resize</span>
        </div>
      </div>
      <div
        ref={canvasRef}
        onDragEnter={(event) => {
          event.preventDefault();
          onOver(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onOver(false);
        }}
        onDrop={onDrop}
        className={cn(
          "relative aspect-square overflow-hidden rounded-xl border-2 bg-white transition-all",
          isOver
            ? "scale-[1.01] border-brand-400 bg-brand-50 shadow-lg shadow-brand-900/5"
            : "border-dashed border-surface-300"
        )}
      >
        <div className="pointer-events-none absolute inset-0 opacity-[0.035] [background-image:linear-gradient(to_right,#292524_1px,transparent_1px),linear-gradient(to_bottom,#292524_1px,transparent_1px)] [background-size:32px_32px]" />
        {items.length === 0 ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-8 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface-100 text-surface-400">
              <Shirt size={28} strokeWidth={1.5} />
            </div>
            <h3 className="text-sm font-semibold text-surface-700">Start building your look</h3>
            <p className="mt-1 max-w-56 text-xs leading-5 text-surface-400">
              Drag pieces here from your closet, or tap the + button on any item.
            </p>
          </div>
        ) : (
          items.map((item, index) => {
            const layout = layouts[item.id];
            if (!layout) return null;
            const isActive = gesture?.itemId === item.id;
            return (
              <div
                key={item.id}
                onPointerDown={(event) => {
                  if ((event.target as HTMLElement).closest("button")) return;
                  startGesture(event, item.id, index, "move");
                }}
                onPointerMove={updateGesture}
                onPointerUp={endGesture}
                onPointerCancel={endGesture}
                className={cn(
                  "group absolute touch-none select-none bg-transparent p-0 transition-[filter]",
                  isActive
                    ? "cursor-grabbing drop-shadow-xl"
                    : "cursor-grab hover:drop-shadow-lg"
                )}
                style={{
                  left: `${layout.x}%`,
                  top: `${layout.y}%`,
                  width: `${layout.width}%`,
                  aspectRatio: "1 / 1",
                  zIndex: index + 10,
                }}
              >
                <div className="relative h-full w-full">
                  <Image
                    src={imageUrl(item)}
                    alt={`${item.color || ""} ${itemName(item)}`}
                    fill
                    className="pointer-events-none object-contain"
                    sizes="180px"
                    unoptimized
                    draggable={false}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(item.id)}
                  className="absolute -right-1.5 -top-1.5 z-20 flex h-6 w-6 items-center justify-center rounded-full bg-white text-surface-400 opacity-100 shadow-md transition-all hover:bg-red-50 hover:text-red-500 sm:opacity-0 sm:group-hover:opacity-100"
                  aria-label={`Remove ${itemName(item)}`}
                >
                  <X size={13} />
                </button>
                <button
                  type="button"
                  onPointerDown={(event) => startGesture(event, item.id, index, "resize")}
                  onPointerMove={updateGesture}
                  onPointerUp={endGesture}
                  onPointerCancel={endGesture}
                  className="absolute -bottom-1.5 -right-1.5 z-20 flex h-7 w-7 touch-none items-center justify-center rounded-lg bg-white text-surface-500 opacity-100 shadow-md transition-all hover:text-brand-600 sm:opacity-0 sm:group-hover:opacity-100"
                  aria-label={`Resize ${itemName(item)}`}
                >
                  <Maximize2 size={13} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function OutfitDetails({
  name,
  folder,
  notes,
  count,
  saving,
  onName,
  onFolder,
  onNotes,
  onSave,
}: {
  name: string;
  folder: string;
  notes: string;
  count: number;
  saving: boolean;
  onName: (value: string) => void;
  onFolder: (value: string) => void;
  onNotes: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <aside className="h-fit rounded-2xl border border-surface-200 bg-white p-4">
      <div className="mb-5">
        <h2 className="text-sm font-semibold text-surface-900">Outfit details</h2>
        <p className="mt-0.5 text-xs text-surface-400">Give this look a home.</p>
      </div>
      <label className="block">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-surface-500">Name</span>
        <input
          value={name}
          onChange={(event) => onName(event.target.value)}
          maxLength={80}
          placeholder="e.g. Monday meeting"
          className="mt-1.5 w-full rounded-lg border border-surface-200 px-3 py-2.5 text-sm text-surface-800 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
        />
      </label>
      <label className="mt-4 block">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-surface-500">
          Collection
        </span>
        <select
          value={folder}
          onChange={(event) => onFolder(event.target.value)}
          className="mt-1.5 w-full rounded-lg border border-surface-200 bg-white px-3 py-2.5 text-sm text-surface-700 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
        >
          {OUTFIT_FOLDERS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <label className="mt-4 block">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-surface-500">Notes</span>
        <textarea
          value={notes}
          onChange={(event) => onNotes(event.target.value)}
          maxLength={500}
          rows={4}
          placeholder="Occasion, styling ideas…"
          className="mt-1.5 w-full resize-none rounded-lg border border-surface-200 px-3 py-2.5 text-sm text-surface-700 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
        />
      </label>
      <div className="mt-5 rounded-xl bg-surface-50 p-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-surface-500">Pieces selected</span>
          <span className="font-semibold text-surface-800">{count}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-200">
          <div
            className="h-full rounded-full bg-brand-500 transition-all"
            style={{ width: `${Math.min((count / 5) * 100, 100)}%` }}
          />
        </div>
        <p className="mt-2 text-[10px] leading-4 text-surface-400">
          Add at least 2 pieces. Drag pieces on the canvas to change their saved order.
        </p>
      </div>
      <button
        type="button"
        onClick={onSave}
        disabled={saving || count < 2}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
        {saving ? "Saving…" : "Save this look"}
      </button>
    </aside>
  );
}

function OutfitLibrary({
  outfits,
  wardrobeCount,
  onCreate,
  onEdit,
}: {
  outfits: SavedOutfit[];
  wardrobeCount: number;
  onCreate: () => void;
  onEdit: (outfit: SavedOutfit) => void;
}) {
  return (
    <div>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-600">
            Lookbook
          </p>
          <h1 className="font-display text-3xl font-semibold text-surface-900">Your outfits</h1>
          <p className="mt-1 text-sm text-surface-500">
            {outfits.length} saved {outfits.length === 1 ? "look" : "looks"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/stylist"
            className="inline-flex items-center gap-2 rounded-lg border border-surface-200 bg-white px-4 py-2.5 text-sm font-medium text-surface-700 transition-colors hover:bg-surface-100"
          >
            <Sparkles size={15} className="text-brand-600" /> Ask AI to style
          </Link>
          <button
            type="button"
            onClick={onCreate}
            disabled={wardrobeCount === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-surface-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-surface-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus size={16} /> Create outfit
          </button>
        </div>
      </div>

      {outfits.length === 0 ? (
        <div className="overflow-hidden rounded-2xl border border-surface-200 bg-white">
          <div className="grid min-h-[430px] items-center gap-8 p-8 md:grid-cols-2 md:p-12">
            <div>
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-100 text-brand-700">
                <Layers3 size={23} />
              </div>
              <h2 className="font-display text-2xl font-semibold text-surface-900">
                Turn your closet into looks
              </h2>
              <p className="mt-3 max-w-md text-sm leading-6 text-surface-500">
                Mix pieces from your digital closet, arrange their layer order, and save combinations
                for work, weekends, travel, and everything between.
              </p>
              {wardrobeCount > 0 ? (
                <button
                  type="button"
                  onClick={onCreate}
                  className="mt-6 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
                >
                  Build your first outfit <ChevronRight size={15} />
                </button>
              ) : (
                <Link
                  href="/closet"
                  className="mt-6 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
                >
                  Add closet items first <ChevronRight size={15} />
                </Link>
              )}
            </div>
            <div className="relative mx-auto grid h-72 w-full max-w-sm grid-cols-2 gap-3 rounded-2xl bg-[#f1eee9] p-6">
              {[0, 1, 2, 3].map((index) => (
                <div
                  key={index}
                  className="flex items-center justify-center rounded-xl border border-dashed border-surface-300 bg-white/75"
                >
                  <Plus size={18} className="text-surface-300" />
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <button
            type="button"
            onClick={onCreate}
            className="group flex min-h-[340px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-surface-300 bg-white/50 text-center transition-all hover:border-brand-400 hover:bg-brand-50"
          >
            <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-surface-100 text-surface-500 transition-colors group-hover:bg-brand-100 group-hover:text-brand-700">
              <Plus size={20} />
            </span>
            <span className="text-sm font-semibold text-surface-700">Create a new outfit</span>
            <span className="mt-1 text-xs text-surface-400">Mix and match from your closet</span>
          </button>

          {outfits.map((outfit) => {
            const joinedItems = [...(outfit.outfit_items || [])]
              .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
              .filter(
                (join): join is SavedOutfitJoin & { wardrobe_items: OutfitItemPreview } =>
                  Boolean(join.wardrobe_items)
              );

            return (
              <article
                key={outfit.id}
                className="group overflow-hidden rounded-2xl border border-surface-200 bg-white transition-all hover:-translate-y-0.5 hover:shadow-lg"
              >
                <div className="relative aspect-square overflow-hidden bg-[#f1eee9]">
                  <button
                    type="button"
                    onClick={() => onEdit(outfit)}
                    className="absolute right-3 top-3 z-20 flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-[11px] font-semibold text-surface-600 opacity-0 shadow-sm transition-all hover:bg-surface-900 hover:text-white group-hover:opacity-100"
                  >
                    <Pencil size={12} /> Edit
                  </button>
                  {joinedItems.map((join, index) => {
                    const item = join.wardrobe_items;
                    const layout =
                      join.x != null && join.y != null && join.width != null
                        ? { x: join.x, y: join.y, width: join.width }
                        : defaultLayoutFor(index);
                    return (
                      <div
                        key={item.id}
                        className="absolute"
                        style={{
                          left: `${layout.x}%`,
                          top: `${layout.y}%`,
                          width: `${layout.width}%`,
                          aspectRatio: "1 / 1",
                          zIndex: index + 1,
                        }}
                      >
                        <div className="relative h-full w-full">
                          <Image
                            src={imageUrl(item)}
                            alt={`${item.color || ""} ${itemName(item)}`}
                            fill
                            className="object-contain"
                            sizes="200px"
                            unoptimized
                          />
                        </div>
                      </div>
                    );
                  })}
                  {joinedItems.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center text-surface-300">
                      <Shirt size={36} strokeWidth={1.4} />
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-surface-900">
                        {outfit.name || "Untitled outfit"}
                      </h3>
                      <p className="mt-1 text-xs text-surface-400">
                        {joinedItems.length} {joinedItems.length === 1 ? "piece" : "pieces"} · Worn{" "}
                        {outfit.times_worn || 0}×
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-brand-50 px-2.5 py-1 text-[10px] font-semibold text-brand-700">
                      {outfit.folder || "Uncategorized"}
                    </span>
                  </div>
                  {outfit.notes && (
                    <p className="mt-3 line-clamp-2 text-xs leading-5 text-surface-500">{outfit.notes}</p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
