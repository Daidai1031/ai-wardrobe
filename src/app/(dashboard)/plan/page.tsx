import { createServerSupabase } from "@/lib/supabase/server";
import { WeekView } from "./week-view";

export default async function PlanPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Both feed the "Repeat rules" panel in the week header: the user's own limits,
  // and how many pieces of each category the closet actually holds, so the panel
  // can say up front that a 7-day rule is unfillable with three pairs of trousers
  // instead of leaving them to discover it as a warning after a generation.
  const [{ data: profile }, { data: wardrobe }] = await Promise.all([
    supabase.from("profiles").select("rotation_limits").eq("id", user.id).single(),
    supabase
      .from("wardrobe_items")
      .select("category")
      .eq("user_id", user.id)
      .eq("archived", false)
      .limit(1000),
  ]);

  const itemCounts: Record<string, number> = {};
  for (const item of wardrobe ?? []) {
    const category = String((item as { category: string }).category);
    itemCounts[category] = (itemCounts[category] ?? 0) + 1;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-surface-900">This week</h1>
        <p className="mt-1 text-sm text-surface-500">
          Seven days planned together, so the same standout piece doesn&apos;t show up twice.
        </p>
      </div>
      <WeekView
        rotationLimits={(profile?.rotation_limits as Record<string, number>) ?? {}}
        itemCounts={itemCounts}
      />
    </div>
  );
}
