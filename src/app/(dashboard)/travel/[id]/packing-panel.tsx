"use client";

import { useState } from "react";
import { Check, Luggage, Plus, Shirt, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { wardrobeItemLabel } from "@/lib/wardrobe/item-label";
import { packingCategoryRank } from "@/lib/travel/packing";
import type { PackingExtra, PackingGarment, TripPackingList } from "@/types/travel";

function shortDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
}

/**
 * The packing list.
 *
 * The garment half is not editable here on purpose: it is exactly the pieces in the
 * days the user confirmed, so the only honest way to change it is to change an
 * outfit. A checkbox next to a garment means "this is in the bag", not "this is on
 * the list" — the second would let the list and the outfits disagree, which is the
 * one thing a packing list must never do.
 */
export function PackingPanel({
  garments,
  packing,
  confirmedCount,
  plannedCount,
  saving,
  onChange,
  onGoToOutfits,
}: {
  garments: PackingGarment[];
  packing: TripPackingList;
  confirmedCount: number;
  plannedCount: number;
  saving: boolean;
  onChange: (next: TripPackingList) => void;
  onGoToOutfits: () => void;
}) {
  const [draft, setDraft] = useState("");

  function toggleGarment(itemId: string) {
    const packed = new Set(packing.packedItemIds);
    if (packed.has(itemId)) packed.delete(itemId);
    else packed.add(itemId);
    onChange({ ...packing, packedItemIds: [...packed] });
  }

  function toggleExtra(id: string) {
    onChange({
      ...packing,
      extras: packing.extras.map((extra) =>
        extra.id === id ? { ...extra, checked: !extra.checked } : extra
      ),
    });
  }

  function removeExtra(extra: PackingExtra) {
    onChange({
      ...packing,
      extras: packing.extras.filter((entry) => entry.id !== extra.id),
      // A template entry has to be remembered as removed; a custom one just goes.
      hiddenTemplateIds: extra.custom
        ? packing.hiddenTemplateIds
        : [...new Set([...packing.hiddenTemplateIds, extra.id])],
    });
  }

  function addExtra() {
    const label = draft.trim();
    if (!label) return;
    onChange({
      ...packing,
      extras: [
        ...packing.extras,
        { id: `custom-${Date.now().toString(36)}`, label, custom: true, checked: false },
      ],
    });
    setDraft("");
  }

  const byCategory = new Map<string, PackingGarment[]>();
  for (const garment of garments) {
    const category = garment.item.category;
    byCategory.set(category, [...(byCategory.get(category) ?? []), garment]);
  }
  const categories = [...byCategory.keys()].sort(
    (a, b) => packingCategoryRank(a) - packingCategoryRank(b)
  );

  const packedGarments = garments.filter((garment) => garment.packed).length;
  const checkedExtras = packing.extras.filter((extra) => extra.checked).length;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-surface-200 bg-white px-4 py-3">
        <p className="flex items-center gap-2 text-sm text-surface-600">
          <Luggage size={16} className="text-brand-500" />
          <span className="font-medium text-surface-900">
            {packedGarments + checkedExtras} of {garments.length + packing.extras.length} packed
          </span>
          <span className="text-surface-400">
            · from {confirmedCount} confirmed day{confirmedCount === 1 ? "" : "s"}
          </span>
        </p>
      </div>

      {garments.length === 0 ? (
        <div className="rounded-2xl border border-surface-200 bg-white py-12 text-center">
          <Shirt size={28} className="mx-auto mb-3 text-surface-300" />
          <p className="text-sm text-surface-600">Nothing to pack yet.</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-surface-400">
            {plannedCount === 0
              ? "Plan the trip first, then confirm the days you're happy with — the clothes on this list come straight from them."
              : "Confirm a day on the Outfits tab and its pieces appear here. Packing follows what you decided, not what was suggested."}
          </p>
          <button
            onClick={onGoToOutfits}
            className="mt-4 rounded-lg border border-surface-200 px-4 py-2 text-xs font-medium text-surface-600 hover:bg-surface-50"
          >
            Go to outfits
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-surface-200 bg-white p-5">
          <h2 className="mb-1 text-sm font-semibold text-surface-900">From your closet</h2>
          <p className="mb-4 text-xs text-surface-400">
            Every piece your confirmed outfits use, once each. Change an outfit to change this list.
          </p>
          <div className="space-y-5">
            {categories.map((category) => (
              <section key={category}>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-surface-400">
                  {category}
                  <span className="ml-1.5 font-normal text-surface-300">
                    {byCategory.get(category)!.length}
                  </span>
                </h3>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {byCategory.get(category)!.map((garment) => (
                    <li key={garment.item.id}>
                      <button
                        onClick={() => toggleGarment(garment.item.id)}
                        disabled={saving}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl border p-2 text-left transition-colors disabled:opacity-60",
                          garment.packed
                            ? "border-emerald-200 bg-emerald-50/60"
                            : "border-surface-200 hover:border-surface-300"
                        )}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={garment.item.clean_url || garment.item.original_url}
                          alt=""
                          className="h-12 w-12 shrink-0 rounded-lg bg-surface-50 object-contain"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium text-surface-800">
                            {wardrobeItemLabel(garment.item)}
                          </span>
                          <span className="block truncate text-[10px] text-surface-400">
                            {garment.dates.map(shortDate).join(", ")}
                          </span>
                        </span>
                        <span
                          className={cn(
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                            garment.packed
                              ? "border-emerald-500 bg-emerald-500 text-white"
                              : "border-surface-300"
                          )}
                        >
                          {garment.packed && <Check size={12} />}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-surface-200 bg-white p-5">
        <h2 className="mb-1 text-sm font-semibold text-surface-900">Everything else</h2>
        <p className="mb-4 text-xs text-surface-400">
          A fixed starting list you can edit — deliberately not generated, so it never forgets your
          charger or invents an adaptor you don&apos;t own.
        </p>

        <ul className="space-y-1.5">
          {packing.extras.map((extra) => (
            <li key={extra.id} className="flex items-center gap-2">
              <button
                onClick={() => toggleExtra(extra.id)}
                disabled={saving}
                className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-surface-50 disabled:opacity-60"
              >
                <span
                  className={cn(
                    "flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border",
                    extra.checked
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-surface-300"
                  )}
                  style={{ height: "1.125rem", width: "1.125rem" }}
                >
                  {extra.checked && <Check size={11} />}
                </span>
                <span
                  className={cn(
                    "truncate text-xs",
                    extra.checked ? "text-surface-400 line-through" : "text-surface-700"
                  )}
                >
                  {extra.label}
                </span>
              </button>
              <button
                onClick={() => removeExtra(extra)}
                disabled={saving}
                title="Remove from this trip's list"
                className="shrink-0 rounded-md p-1 text-surface-300 hover:text-surface-600 disabled:opacity-50"
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>

        <form
          className="mt-3 flex items-center gap-2 border-t border-surface-100 pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            addExtra();
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={120}
            placeholder="Add something else…"
            aria-label="Add a packing list item"
            className="min-w-0 flex-1 rounded-lg border border-surface-200 px-3 py-2 text-xs outline-none focus:border-brand-400"
          />
          <button
            type="submit"
            disabled={saving || !draft.trim()}
            className="flex items-center gap-1 rounded-lg border border-surface-200 px-3 py-2 text-xs font-medium text-surface-600 hover:bg-surface-50 disabled:opacity-40"
          >
            <Plus size={13} />
            Add
          </button>
        </form>
      </div>
    </div>
  );
}
