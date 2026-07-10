import { createServerSupabase } from "@/lib/supabase/server";
import { DailyRecommendation } from "./daily-recommendation";

export default async function HomePage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("name")
    .eq("id", user.id)
    .single();

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div>
      <h1 className="text-xl font-semibold text-surface-900 mb-1">
        {profile?.name ? `Good morning, ${profile.name.split(" ")[0]}` : "Good morning"}
      </h1>
      <p className="text-sm text-surface-500 mb-6">{today}</p>

      <DailyRecommendation userId={user.id} />
    </div>
  );
}
