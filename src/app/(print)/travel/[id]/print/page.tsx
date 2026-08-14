import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { readTripProfile } from "@/lib/travel/trips";
import { readStoredWeatherByDate, readTripRenderData } from "@/lib/travel/trip-render";
import { TripPrintout, type PrintSection } from "@/components/travel/trip-printout";
import type { TravelPlan } from "@/types/database";

/**
 * The printable trip (D7): a normal page plus `@media print`, not a server-side PDF
 * renderer. Vercel's serverless runtime would need `@sparticuz/chromium` bundled to
 * run headless Chrome, and the cold start and bundle size cost more than the browser's
 * own "Save as PDF" — which the user already has.
 *
 * Its own route group, so the dashboard sidebar and chrome are simply not in the tree
 * rather than being hidden with `print:hidden` and hoping nothing else leaks in.
 */
export default async function TripPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ section?: string }>;
}) {
  const { id } = await params;
  const { section } = await searchParams;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("travel_plans")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw error;
  if (!data) notFound();

  const profile = await readTripProfile(supabase, user.id);
  const row = data as TravelPlan;
  const render = await readTripRenderData(supabase, user.id, row, profile?.timezone || "UTC");
  const weatherByDate = await readStoredWeatherByDate(supabase, user.id, render.trip.dates);

  const chosen: PrintSection =
    section === "cards" || section === "packing" ? section : "all";

  return (
    <>
      <div className="no-print mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-6 pt-6">
        <Link href={`/travel/${id}`} className="text-xs font-medium text-surface-500 hover:text-surface-800">
          ← Back to trip
        </Link>
        <div className="flex items-center gap-2 text-xs">
          {/* The two halves are used at different moments — the list before leaving,
              the cards after arriving — so each prints on its own. */}
          <SectionLink id={id} value="all" current={chosen} label="Everything" />
          <SectionLink id={id} value="cards" current={chosen} label="Cards only" />
          <SectionLink id={id} value="packing" current={chosen} label="List only" />
        </div>
      </div>
      <p className="no-print mx-auto max-w-3xl px-6 pt-3 text-[11px] text-surface-400">
        Use your browser&apos;s Print (⌘P / Ctrl+P) and choose “Save as PDF”.
      </p>
      <TripPrintout data={render} weatherByDate={weatherByDate} section={chosen} />
    </>
  );
}

function SectionLink({
  id,
  value,
  current,
  label,
}: {
  id: string;
  value: PrintSection;
  current: PrintSection;
  label: string;
}) {
  return (
    <Link
      href={`/travel/${id}/print?section=${value}`}
      className={
        value === current
          ? "rounded-lg bg-surface-900 px-3 py-1.5 font-medium text-white"
          : "rounded-lg border border-surface-200 px-3 py-1.5 font-medium text-surface-600 hover:bg-surface-50"
      }
    >
      {label}
    </Link>
  );
}
