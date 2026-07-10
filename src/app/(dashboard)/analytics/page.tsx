import { createServerSupabase } from "@/lib/supabase/server";

export default async function AnalyticsPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: items } = await supabase
    .from("wardrobe_items")
    .select("category, color, times_worn, favorite, season, occasion, style_tags, created_at")
    .eq("user_id", user.id)
    .eq("archived", false);

  const all = items || [];
  const total = all.length;
  const favorites = all.filter((i) => i.favorite).length;
  const neverWorn = all.filter((i) => i.times_worn === 0).length;
  const frequentlyWorn = all.filter((i) => i.times_worn >= 5).length;

  // Category distribution
  const catCounts: Record<string, number> = {};
  all.forEach((i) => { catCounts[i.category] = (catCounts[i.category] || 0) + 1; });

  // Color distribution
  const colorCounts: Record<string, number> = {};
  all.forEach((i) => { if (i.color) colorCounts[i.color] = (colorCounts[i.color] || 0) + 1; });
  const topColors = Object.entries(colorCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);

  // Style tags
  const tagCounts: Record<string, number> = {};
  all.forEach((i) => { (i.style_tags || []).forEach((t: string) => { tagCounts[t] = (tagCounts[t] || 0) + 1; }); });
  const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);

  const statBox = (label: string, value: number | string) => (
    <div className="bg-white rounded-xl border border-surface-200 p-4">
      <p className="text-2xl font-semibold text-surface-900">{value}</p>
      <p className="text-xs text-surface-500 mt-0.5">{label}</p>
    </div>
  );

  return (
    <div>
      <h1 className="text-xl font-semibold text-surface-900 mb-1">Closet Analytics</h1>
      <p className="text-sm text-surface-500 mb-6">Understand your wardrobe</p>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {statBox("Total Items", total)}
        {statBox("Favorites", favorites)}
        {statBox("Frequently Worn", frequentlyWorn)}
        {statBox("Never Worn", neverWorn)}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Categories */}
        <div className="bg-white rounded-xl border border-surface-200 p-5">
          <h2 className="text-sm font-semibold text-surface-700 mb-3">By Category</h2>
          <div className="space-y-2">
            {Object.entries(catCounts).sort((a, b) => b[1] - a[1]).map(([cat, count]) => (
              <div key={cat} className="flex items-center justify-between">
                <span className="text-sm text-surface-600">{cat}</span>
                <div className="flex items-center gap-2">
                  <div className="w-24 h-2 bg-surface-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-brand-400 rounded-full"
                      style={{ width: `${total > 0 ? (count / total) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="text-xs text-surface-400 w-6 text-right">{count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Colors */}
        <div className="bg-white rounded-xl border border-surface-200 p-5">
          <h2 className="text-sm font-semibold text-surface-700 mb-3">Top Colors</h2>
          <div className="space-y-2">
            {topColors.map(([color, count]) => (
              <div key={color} className="flex items-center gap-2">
                <span
                  className="w-4 h-4 rounded-full border border-surface-200 flex-shrink-0"
                  style={{ backgroundColor: color.toLowerCase() }}
                />
                <span className="text-sm text-surface-600 capitalize flex-1">{color}</span>
                <span className="text-xs text-surface-400">
                  {total > 0 ? Math.round((count / total) * 100) : 0}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Style DNA */}
        {topTags.length > 0 && (
          <div className="bg-white rounded-xl border border-surface-200 p-5">
            <h2 className="text-sm font-semibold text-surface-700 mb-3">Style DNA</h2>
            <div className="flex flex-wrap gap-2">
              {topTags.map(([tag, count]) => (
                <span
                  key={tag}
                  className="px-3 py-1.5 rounded-full bg-brand-50 text-brand-700 text-xs font-medium capitalize"
                >
                  {tag} ({total > 0 ? Math.round((count / total) * 100) : 0}%)
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Declutter suggestion */}
        {neverWorn > 0 && (
          <div className="bg-white rounded-xl border border-surface-200 p-5">
            <h2 className="text-sm font-semibold text-surface-700 mb-2">Declutter Suggestion</h2>
            <p className="text-sm text-surface-600">
              You have <span className="font-semibold">{neverWorn} item{neverWorn > 1 ? "s" : ""}</span> that
              {neverWorn > 1 ? " have" : " has"} never been worn. Consider selling, donating, or archiving them.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
