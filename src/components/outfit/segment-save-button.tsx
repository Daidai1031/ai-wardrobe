"use client";

import { useMemo, useState } from "react";
import { Check, CopyPlus, ListPlus, Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { DailySegmentResponse } from "@/types/daily";

export function SegmentSaveButton({
  segment,
  date,
  disabled = false,
  onSaved,
}: {
  segment: DailySegmentResponse;
  date: string;
  disabled?: boolean;
  onSaved: (outfitId: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [saving, setSaving] = useState<"new" | "update" | null>(null);
  const [choosing, setChoosing] = useState(false);

  async function save(mode: "new" | "update") {
    if (segment.items.length < 2) {
      toast.error("Need at least two items to save this look");
      return;
    }

    setSaving(mode);
    const fallbackName = `${segment.label} · ${new Intl.DateTimeFormat("en", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
    }).format(new Date(`${date}T12:00:00Z`))}`;

    const { data: outfitId, error } = await supabase.rpc(
      "save_outfit_plan_segment_choice",
      {
        p_segment_id: segment.id,
        p_items: segment.items.map((item) => ({
          itemId: item.id,
          x: item.x,
          y: item.y,
          width: item.width,
        })),
        p_name: fallbackName,
        p_mode: mode,
        p_source_outfit_id: segment.sourceOutfitId,
      }
    );

    setSaving(null);

    if (error || !outfitId) {
      toast.error(error?.message || "Failed to save look");
      return;
    }

    const id = String(outfitId);
    setChoosing(false);
    onSaved(id);
    toast.success(mode === "update" ? "Original outfit updated" : "Saved as a new outfit");
  }

  function beginSave() {
    if (segment.sourceOutfitId) {
      setChoosing(true);
    } else {
      void save("new");
    }
  }

  return (
    <>
      <button
        onClick={beginSave}
        disabled={disabled || Boolean(saving) || Boolean(segment.savedOutfitId)}
        className="flex items-center gap-1.5 rounded-lg bg-surface-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-surface-800 disabled:opacity-50"
      >
        {saving ? (
          <Loader2 size={13} className="animate-spin" />
        ) : segment.savedOutfitId ? (
          <Check size={13} />
        ) : (
          <ListPlus size={13} />
        )}
        {segment.savedOutfitId ? "Saved" : saving ? "Saving…" : "Save"}
      </button>

      {choosing && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-surface-950/40 p-0 backdrop-blur-sm sm:items-center sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`save-outfit-title-${segment.id}`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) setChoosing(false);
          }}
        >
          <div className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2
                  id={`save-outfit-title-${segment.id}`}
                  className="text-base font-semibold text-surface-900"
                >
                  Save your changes
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-surface-500">
                  This look started from a saved outfit. Keep the original and make a copy, or
                  update the original saved outfit.
                </p>
              </div>
              <button
                onClick={() => setChoosing(false)}
                disabled={Boolean(saving)}
                aria-label="Cancel saving"
                className="rounded-lg p-1.5 text-surface-400 hover:bg-surface-50 hover:text-surface-700 disabled:opacity-50"
              >
                <X size={17} />
              </button>
            </div>

            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <button
                onClick={() => void save("update")}
                disabled={Boolean(saving)}
                className="flex items-center justify-center gap-2 rounded-xl border border-surface-200 px-4 py-3 text-sm font-semibold text-surface-700 hover:bg-surface-50 disabled:opacity-50"
              >
                {saving === "update" ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <RefreshCw size={15} />
                )}
                Update original
              </button>
              <button
                onClick={() => void save("new")}
                disabled={Boolean(saving)}
                className="flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {saving === "new" ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <CopyPlus size={15} />
                )}
                Save as new
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
