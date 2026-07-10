"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { WardrobeItem } from "@/types/database";
import { ITEM_CATEGORIES } from "@/types/database";
import { UploadZone } from "@/components/closet/upload-zone";
import { ItemCard } from "@/components/closet/item-card";
import { cn } from "@/lib/utils";
import { Plus, X, ListChecks, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface ClosetViewProps {
  items: WardrobeItem[];
  colors: string[];
  categoryCounts: Record<string, number>;
  activeCategory?: string;
  activeColor?: string;
  activeSeason?: string;
}

const SEASONS = ["spring", "summer", "fall", "winter"];

export function ClosetView({
  items,
  colors,
  categoryCounts,
  activeCategory,
  activeColor,
  activeSeason,
}: ClosetViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const [showUpload, setShowUpload] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  function setFilter(key: string, value: string | undefined) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(`/closet?${params.toString()}`);
  }

  async function toggleFavorite(id: string, current: boolean) {
    const { error } = await supabase
      .from("wardrobe_items")
      .update({ favorite: !current })
      .eq("id", id);

    if (error) {
      toast.error("Failed to update favorite");
    } else {
      router.refresh();
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function cancelSelecting() {
    setSelecting(false);
    setSelectedIds(new Set());
  }

  async function deleteSelected() {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (!confirm(`Delete ${count} item${count !== 1 ? "s" : ""}? This cannot be undone.`)) return;

    const { error } = await supabase
      .from("wardrobe_items")
      .delete()
      .in("id", Array.from(selectedIds));

    if (error) {
      toast.error("Failed to delete items");
    } else {
      toast.success(`Deleted ${count} item${count !== 1 ? "s" : ""}`);
      setSelectedIds(new Set());
      setSelecting(false);
      router.refresh();
    }
  }

  const totalItems = Object.values(categoryCounts).reduce((s, n) => s + n, 0);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-surface-900">My Closet</h1>
          <p className="text-sm text-surface-500 mt-0.5">
            {totalItems} item{totalItems !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selecting ? (
            <>
              <button
                onClick={deleteSelected}
                disabled={selectedIds.size === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:hover:bg-red-600 transition-colors"
              >
                <Trash2 size={16} />
                Delete{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
              </button>
              <button
                onClick={cancelSelecting}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-surface-200 text-surface-700 hover:bg-surface-300 transition-colors"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setSelecting(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-surface-200 text-surface-700 hover:bg-surface-100 transition-colors"
              >
                <ListChecks size={16} />
                Select
              </button>
              <button
                onClick={() => setShowUpload(!showUpload)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                  showUpload
                    ? "bg-surface-200 text-surface-700"
                    : "bg-surface-900 text-white hover:bg-surface-800"
                )}
              >
                {showUpload ? <X size={16} /> : <Plus size={16} />}
                {showUpload ? "Close" : "Add item"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Upload zone */}
      {showUpload && (
        <div className="mb-6">
          <UploadZone />
        </div>
      )}

      {/* Category filter */}
      <div className="flex gap-2 mb-4 overflow-x-auto scrollbar-hide pb-1">
        <button
          onClick={() => setFilter("category", undefined)}
          className={cn(
            "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors",
            !activeCategory
              ? "bg-surface-900 text-white"
              : "bg-surface-100 text-surface-600 hover:bg-surface-200"
          )}
        >
          All ({totalItems})
        </button>
        {ITEM_CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setFilter("category", activeCategory === cat ? undefined : cat)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors",
              activeCategory === cat
                ? "bg-surface-900 text-white"
                : "bg-surface-100 text-surface-600 hover:bg-surface-200"
            )}
          >
            {cat} ({categoryCounts[cat] || 0})
          </button>
        ))}
      </div>

      {/* Color + Season filters */}
      <div className="flex gap-4 mb-6">
        {colors.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-surface-400">Color:</span>
            {colors.slice(0, 8).map((c) => (
              <button
                key={c}
                onClick={() => setFilter("color", activeColor === c ? undefined : c)}
                className={cn(
                  "w-5 h-5 rounded-full border-2 transition-all",
                  activeColor === c ? "border-surface-900 scale-125" : "border-surface-200 hover:scale-110"
                )}
                style={{ backgroundColor: c.toLowerCase() }}
                title={c}
              />
            ))}
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-surface-400">Season:</span>
          {SEASONS.map((s) => (
            <button
              key={s}
              onClick={() => setFilter("season", activeSeason === s ? undefined : s)}
              className={cn(
                "px-2 py-0.5 rounded text-[10px] font-medium capitalize transition-colors",
                activeSeason === s
                  ? "bg-brand-100 text-brand-700"
                  : "bg-surface-100 text-surface-500 hover:bg-surface-200"
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {items.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-surface-400 text-sm">
            {totalItems === 0
              ? "Your closet is empty. Add your first item to get started."
              : "No items match your filters."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              onToggleFavorite={toggleFavorite}
              selecting={selecting}
              selected={selectedIds.has(item.id)}
              onToggleSelect={toggleSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
