/**
 * Seeds one month of "Victoria" -- a ~35-year-old finance executive in New York -- into
 * `calendar_events`, so /plan, /home and /travel have a realistic, dense calendar to plan
 * against without a Google connection.
 *
 *   npm run seed:victoria -- --email you@example.com [--start 2026-09-21] [--days 30]
 *                            [--set-profile] [--dry-run] [--clean]
 *
 * The data lives in src/lib/demo/victoria-calendar.ts, shared with the sync route's demo
 * mode (`DEMO_CALENDAR=victoria`, which makes "Sync calendar" load the same events without
 * this script). Rows are written already labeled, so no model is called and the result is
 * the same on every run. Every id starts with `seed-victoria-`; rows are upserted on that
 * id, so re-running keeps each event's database row (and any plan pointing at it), and
 * `--clean` removes exactly the seeded rows -- a real synced calendar is never touched.
 *
 * Runs on Node's native TypeScript support: no tsx, and only relative imports.
 */
import { createClient } from "@supabase/supabase-js";
import {
  HOME_TZ,
  SEED_PREFIX,
  VICTORIA_DAYS,
  VICTORIA_HOME,
  addDays,
  victoriaRows,
  victoriaStart,
} from "../src/lib/demo/victoria-calendar.ts";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]) {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      values.set(arg, next);
      i++;
    } else {
      flags.add(arg);
    }
  }
  return { flags, values };
}

// Throws rather than calling process.exit(): on Windows, exiting with a fetch socket
// still closing trips a libuv assertion (`UV_HANDLE_CLOSING`) and buries the real message.
class CliError extends Error {}

function fail(message: string): never {
  throw new CliError(message);
}

async function main() {
  const { flags, values } = parseArgs(process.argv.slice(2));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    fail("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing. Run via `npm run seed:victoria` (loads .env.local).");
  }
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const email = values.get("--email");
  const userArg = values.get("--user");
  let query = supabase.from("profiles").select("id, email, name, city, lat, lng, timezone");
  if (userArg) query = query.eq("id", userArg);
  else if (email) query = query.eq("email", email);
  const { data: profiles, error: profileError } = await query;
  if (profileError) fail(`Could not read profiles: ${profileError.message}`);
  if (!profiles || profiles.length === 0) fail("No matching profile. Pass --email <address> or --user <uuid>.");
  if (profiles.length > 1) {
    fail(`${profiles.length} profiles found; pass --email <address> or --user <uuid>:\n` + profiles.map((p) => `  ${p.email}  ${p.id}`).join("\n"));
  }
  const profile = profiles[0];

  const days = Number(values.get("--days") ?? VICTORIA_DAYS);
  const start = values.get("--start") ?? victoriaStart();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) fail("--start must be YYYY-MM-DD.");
  const startDow = new Date(`${start}T00:00:00Z`).getUTCDay();
  if (startDow !== 1) {
    console.warn(`Warning: ${start} is not a Monday. The template assumes day 0 is a Monday, so weekday-specific events (golf on Saturday, the wedding, Sunday flights) will land on the wrong weekday.`);
  }

  // Seed rows for this user, minus `keep` (ids about to be upserted). With no `keep` this is
  // every seed row, which is what `--clean` wants.
  const removeSeedRows = async (keep: string[] = []) => {
    let query = supabase.from("calendar_events").delete().eq("user_id", profile.id).like("google_event_id", `${SEED_PREFIX}%`);
    if (keep.length > 0) query = query.not("google_event_id", "in", `(${keep.join(",")})`);
    const { error } = await query;
    if (error) fail(`Could not remove earlier seed rows: ${error.message}`);
  };

  if (flags.has("--clean")) {
    if (!flags.has("--dry-run")) await removeSeedRows();
    console.log(flags.has("--dry-run") ? "--dry-run: nothing removed." : `Removed seeded events for ${profile.email}.`);
    return;
  }

  const rows = victoriaRows(profile.id, start, days);

  const homeLocalDate = (iso: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: HOME_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const perDay = new Map<string, number>();
  for (const row of rows) {
    const key = row.all_day ? row.starts_at.slice(0, 10) : homeLocalDate(row.starts_at);
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }

  console.log(`Victoria's calendar: ${rows.length} events, ${start} to ${addDays(start, days - 1)}, for ${profile.email}`);
  for (const [date, n] of [...perDay].sort()) console.log(`  ${date}  ${"#".repeat(n)} ${n}`);

  if (flags.has("--dry-run")) {
    console.log("\n--dry-run: nothing written.");
    return;
  }

  // Upsert rather than delete-and-insert: an event keeps its row id across re-runs, and
  // plan segments reference events by that id. Only rows no longer in the set are removed
  // (a shorter --days).
  const { error: upsertError } = await supabase.from("calendar_events").upsert(rows, { onConflict: "user_id,google_event_id" });
  if (upsertError) fail(`Upsert failed: ${upsertError.message}`);
  await removeSeedRows(rows.map((row) => row.google_event_id));
  console.log(`\nWrote ${rows.length} events.`);

  if (flags.has("--set-profile")) {
    const { error } = await supabase.from("profiles").update(VICTORIA_HOME).eq("id", profile.id);
    if (error) fail(`Events inserted, but updating the profile failed: ${error.message}`);
    console.log("Profile set to New York (city, lat/lng, America/New_York).");
  } else {
    const missing = [
      profile.lat == null || profile.lng == null ? "city coordinates (trips can't be detected without a home to compare against)" : null,
      profile.timezone ? null : "timezone (plans will bucket days in UTC)",
    ].filter(Boolean);
    if (missing.length > 0) {
      console.warn(`\nThis profile has no ${missing.join(" and no ")}. Re-run with --set-profile, or set them on /profile.`);
    } else if (profile.city && profile.city !== VICTORIA_HOME.city) {
      console.warn(`\nNote: the profile's city is "${profile.city}", but this calendar is a New York life; London and Hamptons only read as "away" relative to New York.`);
    }
  }
}

await main().catch((err: unknown) => {
  console.error(`\n${err instanceof CliError ? err.message : err}\n`);
  process.exitCode = 1;
});
