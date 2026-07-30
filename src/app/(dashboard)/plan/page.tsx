import { createServerSupabase } from "@/lib/supabase/server";
import { WeekView } from "./week-view";

export default async function PlanPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-surface-900">This week</h1>
        <p className="mt-1 text-sm text-surface-500">
          Seven days planned together, so the same standout piece doesn&apos;t show up twice.
        </p>
      </div>
      <WeekView />
    </div>
  );
}
