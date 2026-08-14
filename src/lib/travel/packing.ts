/**
 * The packing list: what to take, and in what order to look at it.
 *
 * Two halves with two different sources, on purpose.
 *
 * The garments are **derived, never generated** — they are exactly the union of the
 * items in the days the user confirmed, so the list cannot disagree with the
 * outfits. Nothing here decides what to wear; that already happened.
 *
 * The rest is a **fixed template the user edits** (D11). A model asked for a
 * packing list forgets the phone charger and confidently adds a travel adaptor the
 * user doesn't own, and neither failure is visible until they're on the plane.
 */

import type { DailySegmentItem, DailyWardrobeItem } from "@/types/daily";
import type { WeeklyDay } from "@/types/weekly";
import type {
  PackingExtra,
  PackingGarment,
  TripPackingList,
  TripType,
} from "@/types/travel";

/**
 * The order a suitcase is actually packed and a print card is actually read:
 * big flat things first, small things last. Shared with the print page so a
 * garment sits in the same place in both.
 */
export const PACKING_CATEGORY_ORDER = [
  "Outerwear",
  "Dresses",
  "Tops",
  "Bottoms",
  "Shoes",
  "Bags",
  "Accessories",
];

export function packingCategoryRank(category: string): number {
  const index = PACKING_CATEGORY_ORDER.indexOf(category);
  // An unknown category sorts after everything known rather than to the front.
  return index === -1 ? PACKING_CATEGORY_ORDER.length : index;
}

/** Non-garment essentials every trip gets. Short on purpose — a 40-line list gets ignored wholesale. */
const BASE_TEMPLATE: { id: string; label: string }[] = [
  { id: "phone-charger", label: "Phone charger" },
  { id: "toiletries", label: "Toiletries" },
  { id: "medication", label: "Medication" },
  { id: "id-documents", label: "ID / passport" },
  { id: "wallet-cards", label: "Wallet & cards" },
  { id: "underwear-socks", label: "Underwear & socks" },
  { id: "sleepwear", label: "Sleepwear" },
  { id: "glasses", label: "Glasses / contacts" },
];

/** What the two trip types genuinely differ on. Everything else is the same suitcase. */
const TYPE_TEMPLATE: Record<TripType, { id: string; label: string }[]> = {
  business: [
    { id: "laptop-charger", label: "Laptop & charger" },
    { id: "notebook-pen", label: "Notebook & pen" },
    { id: "garment-bag", label: "Garment bag / steamer" },
  ],
  leisure: [
    { id: "camera", label: "Camera" },
    { id: "sunscreen", label: "Sunscreen" },
    { id: "swimwear", label: "Swimwear" },
  ],
};

export function packingTemplate(tripType: TripType): { id: string; label: string }[] {
  return [...BASE_TEMPLATE, ...TYPE_TEMPLATE[tripType]];
}

const EMPTY_LIST: TripPackingList = { packedItemIds: [], extras: [], hiddenTemplateIds: [] };

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/**
 * The stored column merged over the current template.
 *
 * Template entries are matched by id and keep only their checked state, so
 * relabelling one in code reaches every existing trip instead of leaving old rows
 * showing the old wording forever. An entry the user removed stays removed via
 * `hiddenTemplateIds` rather than by being absent, which is the difference between
 * "I don't need this" and "this trip predates that template entry".
 */
export function resolvePackingList(stored: unknown, tripType: TripType): TripPackingList {
  const raw = (stored && typeof stored === "object" && !Array.isArray(stored)
    ? (stored as Record<string, unknown>)
    : {}) as Partial<Record<keyof TripPackingList, unknown>>;

  const storedExtras = Array.isArray(raw.extras)
    ? (raw.extras as unknown[]).filter(
        (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null
      )
    : [];
  const checkedById = new Map(
    storedExtras.map((entry) => [String(entry.id), Boolean(entry.checked)])
  );
  const hidden = new Set(asStringArray(raw.hiddenTemplateIds));

  const templateEntries: PackingExtra[] = packingTemplate(tripType)
    .filter((entry) => !hidden.has(entry.id))
    .map((entry) => ({
      id: entry.id,
      label: entry.label,
      custom: false,
      checked: checkedById.get(entry.id) ?? false,
    }));

  const templateIds = new Set(packingTemplate(tripType).map((entry) => entry.id));
  const customEntries: PackingExtra[] = storedExtras
    .filter((entry) => entry.custom === true && !templateIds.has(String(entry.id)))
    .map((entry) => ({
      id: String(entry.id),
      label: String(entry.label ?? "").slice(0, 120),
      custom: true,
      checked: Boolean(entry.checked),
    }))
    .filter((entry) => entry.label.trim().length > 0);

  return {
    packedItemIds: asStringArray(raw.packedItemIds),
    extras: [...templateEntries, ...customEntries],
    hiddenTemplateIds: [...hidden],
  };
}

export function emptyPackingList(): TripPackingList {
  return { ...EMPTY_LIST };
}

/**
 * Every garment the confirmed days call for, once each, with the dates it is worn on.
 *
 * Only confirmed days count. A day the user hasn't looked at yet is a suggestion,
 * and packing for suggestions is how a carry-on becomes a hold bag — the whole
 * point of the confirmation step is that the packing list follows a decision.
 */
export function garmentsForDays(
  days: WeeklyDay[],
  confirmedDates: string[],
  packedItemIds: string[] = []
): PackingGarment[] {
  const confirmed = new Set(confirmedDates);
  const packed = new Set(packedItemIds);
  const byItem = new Map<string, { item: DailyWardrobeItem; dates: Set<string> }>();

  for (const day of days) {
    if (!confirmed.has(day.date)) continue;
    for (const segment of day.segments) {
      for (const item of segment.items as DailySegmentItem[]) {
        const entry = byItem.get(item.id) ?? { item, dates: new Set<string>() };
        entry.dates.add(day.date);
        byItem.set(item.id, entry);
      }
    }
  }

  return [...byItem.values()]
    .map(({ item, dates }) => ({
      item,
      dates: [...dates].sort(),
      packed: packed.has(item.id),
    }))
    .sort(
      (a, b) =>
        packingCategoryRank(a.item.category) - packingCategoryRank(b.item.category) ||
        (a.item.subcategory ?? "").localeCompare(b.item.subcategory ?? "")
    );
}
