import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createServiceSupabase } from "@/lib/supabase/service";
import { readStoredWeatherByDate, readTripRenderData } from "@/lib/travel/trip-render";
import { TripPrintout } from "@/components/travel/trip-printout";
import type { createServerSupabase } from "@/lib/supabase/server";
import type { TravelPlan } from "@/types/database";

/**
 * A trip shared by link.
 *
 * Public and unauthenticated by design — the point is forwarding it to someone who
 * doesn't have an account — so the token in the URL is the entire credential. It is
 * 128 bits of CSPRNG (see the PATCH route), the row is looked up *by* the token
 * rather than by an id the caller supplies, and revoking clears it, which 404s every
 * copy of the link at once.
 *
 * The service role is what makes it readable at all: every table involved is scoped
 * to `auth.uid()`, and there is no anonymous session here to match. That is exactly
 * why this file reads a fixed shape through `readTripRenderData` and renders it, and
 * never takes a user-supplied id, table or column.
 */
export const metadata: Metadata = {
  title: "A shared trip",
  // A share link handed to one person should not turn up in a search result.
  robots: { index: false, follow: false },
};

export default async function SharedTripPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  // Cheap guard before touching the database: the token is always 32 hex characters,
  // so anything else is a probe rather than a link someone was given.
  if (!/^[0-9a-f]{32}$/.test(token)) notFound();

  const service = createServiceSupabase() as unknown as Awaited<
    ReturnType<typeof createServerSupabase>
  >;

  const { data, error } = await service
    .from("travel_plans")
    .select("*")
    .eq("share_token", token)
    .maybeSingle();

  if (error) throw error;
  if (!data) notFound();
  const row = data as TravelPlan;

  const { data: profile } = await service
    .from("profiles")
    .select("timezone")
    .eq("id", row.user_id)
    .maybeSingle();

  const timeZone = (profile as { timezone?: string | null } | null)?.timezone || "UTC";
  const render = await readTripRenderData(service, row.user_id, row, timeZone);
  const weatherByDate = await readStoredWeatherByDate(service, row.user_id, render.trip.dates);

  return (
    <div className="min-h-screen bg-surface-50 print:bg-white">
      <TripPrintout
        data={render}
        weatherByDate={weatherByDate}
        intro={
          <p className="mt-3 rounded-lg bg-surface-100 px-3 py-2 text-[11px] text-surface-500 print:hidden">
            You&apos;re looking at a shared, read-only copy of this trip. The person who shared it
            can revoke this link at any time.
          </p>
        }
      />
    </div>
  );
}
