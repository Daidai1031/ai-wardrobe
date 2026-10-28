/**
 * Loads the company's private brand list into `shop_brands`.
 *
 *   npm run seed:brands [-- --dry-run]
 *
 * The list is read from data/private/brands.json, which is gitignored: the brands are
 * company-internal and must never reach the repository. The table has RLS and no policy,
 * so only the service role (this script, the shop route) can read or write it.
 *
 * Afterwards every unsaved suggestion is marked stale, since it was picked from the old list.
 *
 * Rows are upserted on (name, tier), so re-running updates in place and a brand can sit
 * in two tiers. Brands removed from the file are NOT deleted -- set `active: false` in
 * the file instead, which keeps history and is reversible.
 *
 * File shape: [{ "name": "...", "tier": "lower|contemporary|designer",
 *               "categories": ["Tops", ...], "tags": ["core", ...], "notes": "...", "priority": 0, "active": true }]
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const TIERS = ["lower", "contemporary", "designer"];
const CATEGORIES = ["Tops", "Bottoms", "Dresses", "Outerwear", "Shoes", "Bags", "Accessories"];

interface BrandRow {
  name: string;
  tier: string;
  categories: string[];
  tags?: string[];
  notes?: string;
  /** Higher = preferred by the company; the shop route offers these first. Default 0. */
  priority?: number;
  active?: boolean;
}

// Throws rather than calling process.exit(): see seed-victoria-calendar.mts.
class CliError extends Error {}

function fail(message: string): never {
  throw new CliError(message);
}

function load(): BrandRow[] {
  let raw: string;
  try {
    raw = readFileSync("data/private/brands.json", "utf8");
  } catch {
    fail("data/private/brands.json not found. It is gitignored; create it locally.");
  }
  const rows = JSON.parse(raw) as BrandRow[];
  rows.forEach((r, i) => {
    if (!r.name?.trim()) fail(`Row ${i}: name missing.`);
    if (!TIERS.includes(r.tier)) fail(`Row ${i} (${r.name}): tier must be one of ${TIERS.join(", ")}.`);
    if (r.priority !== undefined && !Number.isInteger(r.priority)) fail(`Row ${i} (${r.name}): priority must be an integer.`);
    if (!Array.isArray(r.categories) || r.categories.length === 0) fail(`Row ${i} (${r.name}): categories missing.`);
    const bad = r.categories.find((c) => !CATEGORIES.includes(c));
    if (bad) fail(`Row ${i} (${r.name}): unknown category "${bad}".`);
  });
  return rows;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const rows = load();

  if (dryRun) {
    const byTier = new Map<string, number>();
    rows.forEach((r) => byTier.set(r.tier, (byTier.get(r.tier) ?? 0) + 1));
    console.log(`Would upsert ${rows.length} brands:`, Object.fromEntries(byTier));
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    fail("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing. Run via `npm run seed:brands` (loads .env.local).");
  }
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const payload = rows.map((r) => ({
    name: r.name.trim(),
    tier: r.tier,
    categories: r.categories,
    tags: r.tags ?? [],
    notes: r.notes ?? null,
    priority: r.priority ?? 0,
    active: r.active ?? true,
  }));
  const { error } = await supabase.from("shop_brands").upsert(payload, { onConflict: "name,tier" });
  if (error) fail(`Upsert failed: ${error.message}`);
  console.log(`Upserted ${payload.length} brands.`);

  // Unsaved suggestions were picked from the old list. Clearing the summary marks them stale,
  // so the user's next "Update where to shop" re-picks; saved and dismissed rows are answers
  // and stay as they are.
  const { error: staleError, count } = await supabase
    .from("shopping_recommendations")
    .update({ summary: null }, { count: "exact" })
    .eq("status", "new");
  if (staleError) fail(`Could not mark suggestions stale: ${staleError.message}`);
  console.log(`Marked ${count ?? 0} unsaved suggestions for refresh.`);
}

main().catch((err) => {
  console.error(err instanceof CliError ? err.message : err);
  process.exitCode = 1;
});
