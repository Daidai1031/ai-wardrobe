import { createServerSupabase } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { ItemDetail } from "./item-detail";

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: item } = await supabase
    .from("wardrobe_items")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!item) notFound();

  return <ItemDetail item={item} />;
}
