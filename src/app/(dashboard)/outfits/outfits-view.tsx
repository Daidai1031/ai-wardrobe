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
  Pencil,
  Plus,
  RotateCcw,
  Shirt,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { type ItemCategory, type WardrobeItem } from "@/types/database";
import {
  ClosetPicker,
  OutfitCanvas,
  defaultLayoutFor,
  imageUrl,
  itemName,
  readDragPayload,
  writeDragPayload,
  type CanvasItemLayout,
} from "@/components/outfit/outfit-canvas";

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

const OUTFIT_FOLDERS = [
  "Uncategorized",
  "Everyday",
  "Work",
  "Weekend",
  "Date Night",
  "Travel",
  "Special Occasion",
];

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
  const [deletingOutfitId, setDeletingOutfitId] = useState<string | null>(null);
  const [deletedOutfitIds, setDeletedOutfitIds] = useState<Set<string>>(() => new Set());
  const [isCanvasOver, setIsCanvasOver] = useState(false);
  const visibleOutfits = outfits.filter((outfit) => !deletedOutfitIds.has(outfit.id));

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

  async function deleteOutfit(outfit: SavedOutfit) {
    if (deletingOutfitId) return;

    const outfitName = outfit.name || "Untitled outfit";
    const confirmed = window.confirm(
      `Delete “${outfitName}”? This removes the saved look, but keeps every item in your closet.`
    );
    if (!confirmed) return;

    setDeletingOutfitId(outfit.id);
    const { data: deletedOutfit, error } = await supabase
      .from("outfits")
      .delete()
      .eq("id", outfit.id)
      .eq("user_id", userId)
      .select("id")
      .maybeSingle();

    if (error || !deletedOutfit) {
      toast.error(error?.message || "Failed to delete saved look");
      setDeletingOutfitId(null);
      return;
    }

    setDeletedOutfitIds((current) => {
      const next = new Set(current);
      next.add(outfit.id);
      return next;
    });
    setDeletingOutfitId(null);
    toast.success("Saved look deleted");
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
      outfits={visibleOutfits}
      wardrobeCount={wardrobeItems.length}
      onCreate={startCreate}
      onEdit={startEdit}
      onDelete={deleteOutfit}
      deletingOutfitId={deletingOutfitId}
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
  onDelete,
  deletingOutfitId,
}: {
  outfits: SavedOutfit[];
  wardrobeCount: number;
  onCreate: () => void;
  onEdit: (outfit: SavedOutfit) => void;
  onDelete: (outfit: SavedOutfit) => void;
  deletingOutfitId: string | null;
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
                  <div className="absolute right-3 top-3 z-20 flex items-center gap-1.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                    <button
                      type="button"
                      onClick={() => onEdit(outfit)}
                      disabled={deletingOutfitId === outfit.id}
                      className="flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-[11px] font-semibold text-surface-600 shadow-sm transition-colors hover:bg-surface-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Pencil size={12} /> Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(outfit)}
                      disabled={deletingOutfitId === outfit.id}
                      aria-label={`Delete ${outfit.name || "untitled outfit"}`}
                      title="Delete saved look"
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-surface-500 shadow-sm transition-colors hover:bg-red-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {deletingOutfitId === outfit.id ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Trash2 size={13} />
                      )}
                    </button>
                  </div>
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
