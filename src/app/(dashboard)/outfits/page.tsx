import { createServerSupabase } from "@/lib/supabase/server";
import { Sparkles } from "lucide-react";
import Link from "next/link";

export default async function OutfitsPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: outfits } = await supabase
    .from("outfits")
    .select("*, outfit_items(item_id, wardrobe_items(id, clean_url, original_url, category, subcategory, color))")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-surface-900">Outfits</h1>
          <p className="text-sm text-surface-500 mt-0.5">
            {outfits?.length || 0} saved outfit{(outfits?.length || 0) !== 1 ? "s" : ""}
          </p>
        </div>
        <Link
          href="/stylist"
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-900 text-white text-sm font-medium hover:bg-surface-800"
        >
          <Sparkles size={15} /> Ask AI to style
        </Link>
      </div>

      {(!outfits || outfits.length === 0) ? (
        <div className="text-center py-20">
          <p className="text-surface-400 text-sm mb-3">
            No outfits yet. Ask the AI Stylist to create your first look.
          </p>
          <Link href="/stylist" className="text-brand-600 text-sm hover:underline">
            Open AI Stylist →
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {outfits.map((outfit) => (
            <div
              key={outfit.id}
              className="bg-white rounded-xl border border-surface-200 p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-surface-800">
                  {outfit.name || "Untitled outfit"}
                </h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface-100 text-surface-500">
                  {outfit.folder}
                </span>
              </div>
              {outfit.rating && (
                <p className="text-xs text-surface-400">
                  {"★".repeat(outfit.rating)}{"☆".repeat(5 - outfit.rating)}
                </p>
              )}
              <p className="text-xs text-surface-400 mt-1">
                Worn {outfit.times_worn} time{outfit.times_worn !== 1 ? "s" : ""}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
