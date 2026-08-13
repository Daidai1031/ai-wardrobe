import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getAccessibleClient, logWardrobeAccess } from "@/lib/stylist/access";
import { readClientOverview } from "@/lib/stylist/client-overview";
import { projectOccasionsForStylist } from "@/lib/stylist/occasion-projection";
import type { WardrobeItem } from "@/types/database";
import { ClientConsole, type ConsoleOutfit, type ConsoleReview } from "./client-console";

export const dynamic = "force-dynamic";

/**
 * One client's workspace (ROADMAP Phase 10-A).
 *
 * Two different read paths on purpose. The closet and Looks are read through the
 * stylist's *own* session, so schema 18b's whitelist policies are what grant them —
 * if a window lapses mid-session the rows simply stop arriving. Occasions come from
 * the service-role projection instead, because she has no RLS access to
 * `calendar_events` or the plan tables at all and must not: only the enum-derived
 * wording crosses to her browser (D13/D17).
 */
export default async function ProClientPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const client = await getAccessibleClient(user.id, clientId);
  if (!client) notFound();

  const [{ data: wardrobeItems }, { data: outfits }, { data: reviews }, occasions, overview] =
    await Promise.all([
      supabase
        .from("wardrobe_items")
        .select("*")
        .eq("user_id", clientId)
        .eq("archived", false)
        .order("created_at", { ascending: false }),
      supabase
        .from("outfits")
        .select(
          "id, name, folder, notes, rating, times_worn, ai_generated, created_at, outfit_items(item_id, position, x, y, width)"
        )
        .eq("user_id", clientId)
        .order("created_at", { ascending: false }),
      supabase
        .from("stylist_reviews")
        .select(
          // The items ride along so the Build tab can render what she already sent as a
          // collage rather than a line of text; the other tabs ignore them.
          "id, target_kind, target_outfit_id, target_segment_id, target_item_id, proposed_name, rating, note, has_proposal, status, created_at, stylist_review_items(item_id, position, x, y, width)"
        )
        .eq("client_id", clientId)
        .eq("stylist_id", user.id)
        .order("created_at", { ascending: false }),
      projectOccasionsForStylist(clientId),
      readClientOverview(clientId),
    ]);

  await logWardrobeAccess(user.id, clientId, "console:view");

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/pro" className="text-xs font-medium text-surface-400 hover:text-surface-700">
            ← Clients
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-surface-900">
            {client.name || client.email || "Client"}
          </h1>
          <p className="mt-1 text-sm text-surface-500">
            {(wardrobeItems || []).length} pieces · {(outfits || []).length} saved Looks
            {client.city ? ` · ${client.city}` : ""}
          </p>
        </div>
        <p className="rounded-full bg-surface-100 px-3 py-1 text-[11px] font-medium text-surface-500">
          Access until {new Date(client.accessExpiresAt).toLocaleDateString()}
        </p>
      </header>

      <ClientConsole
        clientId={clientId}
        clientName={client.name || client.email || "this client"}
        wardrobeItems={(wardrobeItems || []) as WardrobeItem[]}
        outfits={(outfits || []) as ConsoleOutfit[]}
        reviews={(reviews || []) as ConsoleReview[]}
        occasions={occasions}
        overview={overview}
        accessExpiresAt={client.accessExpiresAt}
        shareOccasions={client.shareOccasions}
      />
    </div>
  );
}
