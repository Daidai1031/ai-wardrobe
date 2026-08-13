"use client";

/**
 * "How often may the same piece come back?", per category.
 *
 * Lives here rather than in /profile — where the rest of the `profiles` columns
 * are edited — because this is the one setting whose effect you only ever see on
 * this page. The complaint that produced it ("why is it the same clutch every
 * single day?") is had while looking at the week, and sending someone to another
 * page to answer it loses them.
 *
 * Per category rather than one global slider, deliberately. The first real weekly
 * runs proved a single number is wrong in both directions at once: flagging the
 * same sunglasses twice was pure noise, while three wearings of the same trousers
 * was the actual problem.
 */

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, RotateCw, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  MAX_WEAR_DAYS_BY_CATEGORY,
  ROTATION_WINDOW_DAYS,
  maxWearDaysFor,
  resolveRotationLimits,
  type RotationLimits,
} from "@/lib/planning/plan-rules";
import { ITEM_CATEGORIES } from "@/types/database";

/**
 * Whole maps rather than a multiplier on the defaults: most people will pick one
 * of these and never open the per-category rows, so each preset has to be a
 * complete, defensible answer on its own.
 */
const PRESETS: { id: string; label: string; hint: string; limits: RotationLimits }[] = [
  {
    id: "strict",
    label: "Never repeat",
    hint: "Everything once a week, bags and jewellery twice.",
    limits: {
      Tops: 1,
      Bottoms: 1,
      Dresses: 1,
      Outerwear: 1,
      Shoes: 1,
      Bags: 2,
      Accessories: 2,
    },
  },
  {
    id: "balanced",
    label: "Balanced",
    hint: "Clothes once a week, shoes twice, bags and jewellery three days.",
    limits: { ...MAX_WEAR_DAYS_BY_CATEGORY },
  },
  {
    id: "relaxed",
    label: "Repeat freely",
    hint: "For a smaller closet — most things can come back mid-week.",
    limits: {
      Tops: 2,
      Bottoms: 3,
      Dresses: 2,
      Outerwear: 4,
      Shoes: 4,
      Bags: ROTATION_WINDOW_DAYS,
      Accessories: ROTATION_WINDOW_DAYS,
    },
  },
];

function sameLimits(a: RotationLimits, b: RotationLimits): boolean {
  return ITEM_CATEGORIES.every((category) => maxWearDaysFor(category, a) === maxWearDaysFor(category, b));
}

function describeDays(days: number): string {
  if (days >= ROTATION_WINDOW_DAYS) return "no limit";
  return days === 1 ? "1 day a week" : `${days} days a week`;
}

export function RotationSettings({
  initialLimits,
  itemCounts,
}: {
  /** The raw `profiles.rotation_limits` value; only the categories the user changed. */
  initialLimits: Record<string, number>;
  /** How many active items the closet holds per category, for the feasibility hint. */
  itemCounts: Record<string, number>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [limits, setLimits] = useState<RotationLimits>(() => resolveRotationLimits(initialLimits));
  const [saving, setSaving] = useState(false);

  const activePreset = PRESETS.find((preset) => sameLimits(preset.limits, limits));

  function setCategory(category: string, days: number) {
    setLimits((current) => ({
      ...current,
      [category]: Math.min(ROTATION_WINDOW_DAYS, Math.max(1, days)),
    }));
  }

  async function save() {
    setSaving(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("You've been signed out.");

      // Store only what differs from the defaults. A full snapshot would freeze
      // this user on today's numbers forever, so a later change to a default they
      // never touched would silently pass them by.
      const overrides = Object.fromEntries(
        ITEM_CATEGORIES.filter(
          (category) => limits[category] !== MAX_WEAR_DAYS_BY_CATEGORY[category]
        ).map((category) => [category, maxWearDaysFor(category, limits)])
      );

      const { error } = await supabase
        .from("profiles")
        .update({ rotation_limits: overrides })
        .eq("id", user.id);
      if (error) throw error;

      toast.success("Saved — this applies the next time you plan or redo a day.");
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save your repeat rules.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Choose how often the same piece may come back"
        className="flex items-center gap-1.5 rounded-lg border border-surface-200 px-3 py-2 text-xs font-medium text-surface-600 hover:bg-surface-50"
      >
        <RotateCw size={14} />
        Repeat rules
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-surface-950/40 p-0 backdrop-blur-sm sm:items-center sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rotation-settings-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) setOpen(false);
          }}
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="rotation-settings-title" className="text-sm font-semibold text-surface-900">
                  How often can the same piece come back?
                </h2>
                <p className="mt-1 text-xs text-surface-500">
                  Counted in days, not outfits — wearing one blazer through three parts of a day
                  is still one day.
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                disabled={saving}
                aria-label="Close"
                className="rounded-lg p-1 text-surface-400 hover:bg-surface-50 hover:text-surface-700 disabled:opacity-40"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => setLimits({ ...preset.limits })}
                  disabled={saving}
                  className={cn(
                    "rounded-xl border p-3 text-left transition-colors disabled:opacity-40",
                    activePreset?.id === preset.id
                      ? "border-brand-400 bg-brand-50/60"
                      : "border-surface-200 hover:border-surface-300"
                  )}
                >
                  <p className="text-xs font-semibold text-surface-900">{preset.label}</p>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-surface-500">
                    {preset.hint}
                  </p>
                </button>
              ))}
            </div>

            <div className="mt-4 space-y-1.5 border-t border-surface-100 pt-4">
              {ITEM_CATEGORIES.map((category) => {
                const days = maxWearDaysFor(category, limits);
                const owned = itemCounts[category] ?? 0;
                // A week needs this many distinct pieces of the category to be
                // filled without repeating past the limit. Saying so here beats
                // discovering it as a warning after a generation.
                const needed = Math.ceil(ROTATION_WINDOW_DAYS / days);
                const short = days < ROTATION_WINDOW_DAYS && owned > 0 && owned < needed;

                return (
                  <div
                    key={category}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-1 py-1.5"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-surface-800">{category}</p>
                      <p className="text-[10px] text-surface-400">
                        {owned} in your closet
                        {short && (
                          <span className="text-amber-600">
                            {" "}
                            · needs {needed} to fill a week at {describeDays(days)}
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setCategory(category, days - 1)}
                        disabled={saving || days <= 1}
                        aria-label={`Fewer days for ${category}`}
                        className="h-7 w-7 rounded-lg border border-surface-200 text-surface-600 hover:bg-surface-50 disabled:opacity-30"
                      >
                        −
                      </button>
                      <span className="w-24 text-center text-[11px] font-medium text-surface-700">
                        {describeDays(days)}
                      </span>
                      <button
                        onClick={() => setCategory(category, days + 1)}
                        disabled={saving || days >= ROTATION_WINDOW_DAYS}
                        aria-label={`More days for ${category}`}
                        className="h-7 w-7 rounded-lg border border-surface-200 text-surface-600 hover:bg-surface-50 disabled:opacity-30"
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <p className="mt-3 text-[10px] leading-relaxed text-surface-400">
              Changes apply the next time you plan the week or redo a day. Outfits already on
              the calendar are left exactly as they are.
            </p>

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                disabled={saving}
                className="rounded-lg border border-surface-200 px-4 py-2 text-xs font-medium text-surface-600 hover:bg-surface-50 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={() => void save()}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {saving && <Loader2 size={13} className="animate-spin" />}
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
