"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import type { WardrobeItem, ItemCategory } from "@/types/database";
import { ITEM_CATEGORIES } from "@/types/database";
import { ArrowLeft, Save, Trash2, Heart } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function ItemDetail({ item }: { item: WardrobeItem }) {
  const router = useRouter();
  const supabase = createClient();

  const [category, setCategory] = useState(item.category);
  const [subcategory, setSubcategory] = useState(item.subcategory || "");
  const [color, setColor] = useState(item.color || "");
  const [brand, setBrand] = useState(item.brand || "");
  const [material, setMaterial] = useState(item.material || "");
  const [season, setSeason] = useState<string[]>(item.season);
  const [occasion, setOccasion] = useState<string[]>(item.occasion);
  const [saving, setSaving] = useState(false);

  const SEASONS = ["spring", "summer", "fall", "winter"];
  const OCCASIONS = ["work", "casual", "formal", "date", "travel", "sport", "party", "wedding"];

  function toggleArray(arr: string[], val: string) {
    return arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val];
  }

  async function handleSave() {
    setSaving(true);
    const { error } = await supabase
      .from("wardrobe_items")
      .update({
        category, subcategory, color, brand, material, season, occasion,
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id);

    if (error) {
      toast.error("Failed to save");
    } else {
      toast.success("Saved");
      router.refresh();
    }
    setSaving(false);
  }

  async function handleDelete() {
    if (!confirm("Delete this item? This cannot be undone.")) return;
    await supabase.from("wardrobe_items").delete().eq("id", item.id);
    toast.success("Item deleted");
    router.push("/closet");
    router.refresh();
  }

  async function toggleFavorite() {
    await supabase
      .from("wardrobe_items")
      .update({ favorite: !item.favorite })
      .eq("id", item.id);
    router.refresh();
  }

  return (
    <div>
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1.5 text-sm text-surface-500 hover:text-surface-700 mb-4"
      >
        <ArrowLeft size={16} /> Back to closet
      </button>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Image side */}
        <div className="space-y-3">
          <div className="relative aspect-square bg-white rounded-2xl border border-surface-200 overflow-hidden">
            <Image
              src={item.clean_url || item.original_url}
              alt={`${item.color} ${item.subcategory || item.category}`}
              fill
              className="object-contain p-4"
              unoptimized
            />
            <button
              onClick={toggleFavorite}
              className="absolute top-3 right-3 p-2 rounded-full bg-white/80 backdrop-blur-sm"
            >
              <Heart
                size={18}
                className={cn(
                  item.favorite ? "fill-red-500 text-red-500" : "text-surface-400"
                )}
              />
            </button>
          </div>
          {item.original_url !== item.clean_url && item.clean_url && (
            <p className="text-xs text-surface-400 text-center">
              Background removed by AI · <button onClick={() => window.open(item.original_url)} className="underline">View original</button>
            </p>
          )}
          {item.ai_confidence && (
            <p className="text-xs text-surface-400 text-center">
              AI confidence: {Math.round(item.ai_confidence * 100)}%
            </p>
          )}
        </div>

        {/* Edit form */}
        <div className="space-y-5">
          <h2 className="text-lg font-semibold text-surface-900">Item Details</h2>
          <p className="text-xs text-surface-400 -mt-3">
            Auto-classified by AI — edit anything below
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as ItemCategory)}
                className="w-full px-3 py-2 rounded-lg border border-surface-200 text-sm bg-white"
              >
                {ITEM_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1">Subcategory</label>
              <input
                value={subcategory}
                onChange={(e) => setSubcategory(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-surface-200 text-sm"
                placeholder="e.g. blazer, ankle boots"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1">Color</label>
              <input
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-surface-200 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1">Brand</label>
              <input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-surface-200 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1">Material</label>
              <input
                value={material}
                onChange={(e) => setMaterial(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-surface-200 text-sm"
              />
            </div>
          </div>

          {/* Season chips */}
          <div>
            <label className="block text-xs font-medium text-surface-600 mb-2">Season</label>
            <div className="flex gap-2">
              {SEASONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setSeason(toggleArray(season, s))}
                  className={cn(
                    "px-3 py-1 rounded-full text-xs font-medium capitalize transition-colors",
                    season.includes(s)
                      ? "bg-brand-100 text-brand-700"
                      : "bg-surface-100 text-surface-500"
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Occasion chips */}
          <div>
            <label className="block text-xs font-medium text-surface-600 mb-2">Occasion</label>
            <div className="flex flex-wrap gap-2">
              {OCCASIONS.map((o) => (
                <button
                  key={o}
                  onClick={() => setOccasion(toggleArray(occasion, o))}
                  className={cn(
                    "px-3 py-1 rounded-full text-xs font-medium capitalize transition-colors",
                    occasion.includes(o)
                      ? "bg-brand-100 text-brand-700"
                      : "bg-surface-100 text-surface-500"
                  )}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>

          {/* Style tags (read-only for now) */}
          {item.style_tags.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-surface-600 mb-2">Style Tags</label>
              <div className="flex flex-wrap gap-1.5">
                {item.style_tags.map((tag) => (
                  <span key={tag} className="px-2 py-0.5 rounded bg-surface-100 text-xs text-surface-600 capitalize">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-surface-900 text-white text-sm font-medium hover:bg-surface-800 disabled:opacity-50"
            >
              <Save size={15} />
              {saving ? "Saving…" : "Save changes"}
            </button>
            <button
              onClick={handleDelete}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-red-200 text-red-600 text-sm hover:bg-red-50"
            >
              <Trash2 size={15} />
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
