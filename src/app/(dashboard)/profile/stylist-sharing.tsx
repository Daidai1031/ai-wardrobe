"use client";

/**
 * What the human stylist may see, controlled by the client (ROADMAP D16/D17).
 *
 * Two independent controls, deliberately not merged into one "share with my stylist"
 * switch: the access window governs the *closet*, the occasions switch governs the
 * *calendar*, and they carry very different privacy weight. Someone may well want a
 * stylist in their wardrobe and nowhere near their week.
 *
 * Per-event detail (L2) is not here — it lives next to each occasion on /plan, where
 * the client can see what they are revealing before revealing it.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, Loader2, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export function StylistSharing({
  userId,
  accessExpiresAt,
  shareOccasions,
}: {
  userId: string;
  accessExpiresAt: string | null;
  shareOccasions: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [sharing, setSharing] = useState(shareOccasions);
  const [busy, setBusy] = useState<"occasions" | "revoke" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const windowOpen = Boolean(accessExpiresAt && new Date(accessExpiresAt) > new Date());

  async function toggleOccasions() {
    const next = !sharing;
    setBusy("occasions");
    setError(null);
    setSharing(next);
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ stylist_share_occasions: next })
      .eq("id", userId);
    if (updateError) {
      setSharing(!next);
      setError(updateError.message);
    }
    setBusy(null);
    router.refresh();
  }

  async function endAccess() {
    if (!window.confirm("End your stylist's access now? They will lose access immediately.")) return;
    setBusy("revoke");
    setError(null);
    // Setting the window to now rather than clearing it: an explicit past timestamp
    // reads as "this ended", where null reads as "never started".
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ access_expires_at: new Date().toISOString() })
      .eq("id", userId);
    if (updateError) setError(updateError.message);
    setBusy(null);
    router.refresh();
  }

  return (
    <section className="max-w-2xl rounded-2xl border border-surface-200 bg-white p-5">
      <div className="flex items-center gap-2">
        <ShieldCheck size={16} className="text-surface-400" />
        <h2 className="text-sm font-semibold text-surface-900">Your stylist</h2>
      </div>
      <p className="mt-1 text-xs text-surface-500">
        Controls what our styling team can see. Nothing here affects the AI Stylist.
      </p>

      {error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      <div className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-surface-100 p-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-surface-800">Closet access</p>
            <p className="mt-0.5 text-[11px] text-surface-500">
              {windowOpen
                ? `Your stylist can see your closet and saved Looks until ${new Date(
                    accessExpiresAt!
                  ).toLocaleDateString()}.`
                : "No one on the styling team can see your closet right now. A window opens for 14 days after a consultation."}
            </p>
          </div>
          {windowOpen && (
            <button
              type="button"
              onClick={endAccess}
              disabled={busy !== null}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-surface-200 px-3 py-1.5 text-[11px] font-medium text-surface-600 transition-colors hover:bg-surface-50 disabled:opacity-50"
            >
              {busy === "revoke" && <Loader2 size={12} className="animate-spin" />}
              End access now
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-surface-100 p-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-medium text-surface-800">
              <CalendarRange size={13} className="text-surface-400" />
              Share what&apos;s coming up
            </p>
            <p className="mt-0.5 max-w-lg text-[11px] leading-relaxed text-surface-500">
              Lets your stylist see the <em>kind</em> of occasion on each of the next seven days
              and how formal it is — &ldquo;dinner with friends&rdquo;, &ldquo;a formal meeting
              with colleagues&rdquo;. Never event titles, times, places or names. You can share a
              specific event&apos;s details one at a time from This Week.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={sharing}
            onClick={toggleOccasions}
            disabled={busy !== null}
            className={cn(
              "relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50",
              sharing ? "bg-brand-600" : "bg-surface-200"
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
                sharing ? "translate-x-[22px]" : "translate-x-0.5"
              )}
            />
          </button>
        </div>
      </div>
    </section>
  );
}
