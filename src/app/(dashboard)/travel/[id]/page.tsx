import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { readTripMeta, readTripProfile } from "@/lib/travel/trips";
import { resolvePackingList } from "@/lib/travel/packing";
import { TripView } from "./trip-view";

/**
 * Server-side only far enough to answer "does this trip exist and is it yours"
 * before anything renders. Everything after that is the client component, which
 * fetches the trip's days from `/api/ai/weekly` — the same endpoint `/plan` uses,
 * against the same stored rows.
 */
export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const profile = await readTripProfile(supabase, user.id);
  const found = await readTripMeta(supabase, user.id, id, profile, profile?.timezone || "UTC");
  if (!found) notFound();

  return (
    <TripView
      initialTrip={found.meta}
      initialPacking={resolvePackingList(found.row.packing_list, found.meta.tripType)}
    />
  );
}
