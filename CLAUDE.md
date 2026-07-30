# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # start dev server (Next.js, http://localhost:3000)
npm run build    # production build
npm run start    # run production build
npm run lint     # next lint
```

There is no test suite configured. There is no single-test command.

## Architecture

Next.js 16 App Router app ("ai-wardrobe") using Server Components + Route Handlers, Supabase (auth/DB/storage), Claude Vision for classification, and fal.ai for background removal. It replaces an earlier Python prototype — this is a from-scratch rewrite, not an upgrade.

### Route groups

- `src/app/(auth)/` — `login`, `signup` pages, unauthenticated.
- `src/app/(dashboard)/` — the main app: `closet`, `closet/[id]`, `outfits`, `stylist`, `analytics`, `profile`, `travel`. Protected by `src/proxy.ts`.
- `src/app/api/ai/` — server-side AI pipeline endpoints: `classify`, `convert`, `stylist`, `daily`; `src/app/api/weather/` proxies OpenWeatherMap; `src/app/api/geocode/` resolves a city name to coordinates (see "Weather & geocoding" below).
- `src/app/api/google/` — `auth` and `callback` implement Calendar OAuth (see "Google Calendar OAuth" below).
- `src/app/api/keep-alive/` — a Vercel Cron target (schedule in `vercel.json`, every 3 days) that runs a trivial `select id from profiles limit 1` and returns an empty `200`, purely to keep the free-tier Supabase project from being paused after ~7 days of inactivity. Not part of any user flow; no auth (runs as anon under RLS, which is fine — the query still counts as DB activity). See README's "Keeping Supabase awake" for details.

### Auth & routing

`src/proxy.ts` is this Next.js 16 project's `middleware.ts` equivalent — Next 16 renamed the convention (`middleware()` → default-exported `proxy()`, `config` → `proxyConfig`). It refreshes the Supabase session on every request, redirects unauthenticated users away from dashboard routes (`/closet`, `/outfits`, `/stylist`, `/profile`, `/analytics`, `/travel`), and redirects authenticated users away from `/login`/`/signup`. When adding a new protected top-level route, add its path prefix to the `isDashboard` check here.

Three Supabase client factories exist and are not interchangeable:
- `src/lib/supabase/client.ts` — browser client, for use in Client Components.
- `src/lib/supabase/server.ts` — server client bound to Next's `cookies()`, for use in Server Components / Route Handlers.
- `src/lib/supabase/service.ts` — service-role client that bypasses RLS entirely. Only for tables with no client-facing policy by design (currently just `google_connections`); never import it into a Client Component.

### Weather & geocoding

`src/lib/weather/` is a provider abstraction (ROADMAP Phase 6.0-E / decision D2), split so the providers only ever deal in coordinates:

- `types.ts` — shared `WeatherData`/`DailyForecast`/`GeoPoint` types and the `WeatherProvider` contract (`current(lat, lon)`, `forecast(lat, lon, days)`).
- `openweather.ts` — `getCurrentWeather(lat, lon)`, used by `/api/ai/daily` (unchanged behavior, D2).
- `open-meteo.ts` — `getForecast(lat, lon, days)`, for weekly/travel planning (not wired up yet — Phase 6.2/6.3). No API key; free tier is non-commercial + CC BY 4.0 attribution, see D2 for the commercial exit.
- `geocode.ts` — `geocodeCity(city)`, the **only** place a city name becomes coordinates. Neither provider above knows what a city is.

Coordinates are geocoded once and cached on the row, not re-derived per weather call — geocoding on every fetch would be a wasted external request per daily/weekly/travel generation for a city that never moves. The two call sites:
- `profiles.city` → `profiles.lat`/`lng`, geocoded in `profile-form.tsx`'s `handleSave()` only when the city text actually changed (via `GET /api/geocode?city=`), then saved in the same `profiles` update.
- `travel_plans.destination` → `destination_lat`/`destination_lng`, meant to be geocoded once at trip-creation time the same way — not implemented yet since `/travel` is still a placeholder (Phase 6.3).

`GET /api/weather` is a standalone ad-hoc lookup endpoint (not on the daily/weekly/travel hot path) — it accepts either `lat`/`lon` directly or a `city` param that it geocodes per-request for convenience; that per-request geocode is fine there specifically because the endpoint isn't called repeatedly for the same city, unlike the cached paths above.

### Google Calendar OAuth

ROADMAP 6.0-A / decision D1. This is deliberately its own OAuth flow, separate from the Supabase Google *login* provider — Supabase only hands back `provider_refresh_token` once, at initial sign-in, and doesn't persist it, which isn't workable for a long-lived Calendar connection. Calendar and Gmail are (and will remain) two independent consent grants, not one combined "Connect Google" button — see D1's reasoning: `gmail.readonly` is a restricted scope that requires a paid CASA review once the app leaves Testing mode, and bundling it with Calendar would mean a user declining Gmail also loses Calendar. Only the Calendar leg is implemented so far; Gmail is a deliberately separate future task and shares nothing with this code path yet beyond the same `google_connections` table.

- `GET /api/google/auth?scope=calendar` — the only accepted `scope` value right now (anything else 400s). Requires an existing Supabase session; generates a CSRF `state`, stashes it in an httpOnly cookie scoped to `/api/google`, and redirects to Google's consent screen requesting `calendar.readonly` with `access_type=offline&prompt=consent` (forces a `refresh_token` back on every authorization, not just the first).
- `GET /api/google/callback` — validates `state` against the cookie, exchanges `code` for tokens, and upserts `google_connections` (one row per user; access/refresh token, `expires_at`, and the actual granted `scopes` array from Google's response — never assumed from what was requested). Redirects to `/profile?google_calendar=connected|error`; there's no settings-page toggle reading that flag yet, it just avoids a dead-end redirect after consent.
- `src/lib/google/client.ts` — the only code that touches Google's OAuth endpoints or `google_connections` directly:
  - `getAccessToken(userId)` — the one function calendar-fetching code (Phase 6.1+) should call. Returns a valid access token, transparently refreshing if expired; returns `null` (never throws) if there's no connection, it was already marked invalid, or the refresh itself fails. A failed refresh sets `google_connections.invalid_at` so the caller can prompt for reconnection instead of retrying every call — this matters because Testing-mode refresh tokens expire after ~7 days (see README's Google Calendar OAuth setup section) until the Cloud project passes verification.
  - `hasScope(userId, scope)` — gate any Calendar-dependent UI/route on this before assuming the feature is usable.
  - Both read/write through `createServiceSupabase()` (`src/lib/supabase/service.ts`), since `google_connections` has RLS enabled with no policy — tokens are never reachable from a user's own session, by design.

### Calendar event sync, semantic enrichment, and local-day bucketing

ROADMAP 6.0-C. Three separable pieces:

- `src/lib/google/calendar.ts` — `listCalendarEvents(accessToken, timeMin, timeMax)`, a thin wrapper around Google Calendar v3 `events.list` on the primary calendar (`singleEvents=true` so recurring events arrive pre-expanded). Knows nothing about our DB or auth; callers supply an already-valid access token from `getAccessToken()`.
- `GET /api/google/calendar/sync?timeMin=&timeMax=` (`src/app/api/google/calendar/sync/route.ts`) — the orchestrator: checks `hasScope`, gets a token, fetches events, upserts the raw fields (title/location/starts_at/ends_at/all_day/attendee_count) into `calendar_events` via the normal session-scoped `createServerSupabase()` client (this table has an ordinary `auth.uid() = user_id` RLS policy, unlike `google_connections` — no service role needed here). Defaults to `[start of today UTC, +14 days]` when no range is given.
- `src/lib/calendar/classify-events.ts` — `classifyEvents()`, one batched Haiku call that takes every event still missing `occasion`/`formality` and returns both per event. The sync route only ever passes rows where `occasion IS NULL`, so a given `google_event_id` gets classified exactly once no matter how many times sync reruns — this is the cost lever ROADMAP 6.0-C calls out (batch weekly, not per-event). Deliberately fed only title/location/attendee_count, never the event's `description` — a user's own manual notes on an event (e.g. an expected-answer key for testing this pipeline) must never leak into the classification input.
- `src/lib/calendar/day-bucket.ts` — `eventsOnLocalDay(events, localDate, timeZone)`, the single function daily (6.1) and weekly (6.2) planning both call to answer "what's on the calendar for this local day," instead of each re-deriving it. Two things it handles that are easy to get wrong once, let alone twice: an event's UTC instant near a day boundary must convert through the location's IANA `timeZone` to land on the correct local day (naive UTC-date slicing is wrong), and a multi-day event must appear on every local day its interval overlaps, not just the day it starts. All-day events are handled as a special case of both: Google's all-day dates are timezone-agnostic calendar dates with no real instant, encoded by the sync route as `<date>T00:00:00Z` purely to fit the `timestamptz` column, so `eventsOnLocalDay` compares those by raw UTC date-string components and skips timezone conversion for them entirely — running an all-day event through `timeZone` conversion would incorrectly shift it onto the adjacent local day in any non-UTC zone. **Verified 2026-07-30** against 8 real events synced from a live Google Calendar spanning 7/30–8/7: confirmed three same-day events (9:45am, 3pm, and 8:15pm local) all correctly bucket onto the same `America/New_York` local day despite the 8:15pm one crossing into the next UTC calendar date; confirmed a 2-day all-day trip appears on both of its local days and not the exclusive end date; confirmed bucketing genuinely shifts under a different `timeZone` (`Asia/Shanghai`) rather than being hardcoded to one zone.
- `GET /api/ai/daily` now calls `eventsOnLocalDay` before building its dynamic segment prompt. There is still no "current week" boundary anywhere — `/api/google/calendar/sync`'s window is caller-specified, not tied to a Mon–Sun week; that's a Phase 6.2 concern.
- `POST /api/ai/daily` has two modes. Without `segmentId` it rebuilds the whole day (the original Dislike path). **With `segmentId` it regenerates only that segment** — rerunning the whole plan to fix one bad look discarded the segments the user was happy with and paid for a full generation. The single-segment prompt gets the whole day as context and returns both the new segment and `nextChangeFromPrevious`: the following segment's "what changed" line describes the transition from the segment being replaced, so leaving it alone would point at an outfit that no longer exists. Getting it in the same call keeps it accurate at no extra cost. Only the target segment's own items are excluded — items in the segments being kept stay available, since wearing the same blazer through two parts of a day is normal. Weather is read from the stored plan rather than refetched, so the regenerated segment reasons about the same conditions as the rest of the plan.
- Two things about `/api/ai/daily` that are easy to trip over. **Timezone**: it resolves as `?timezone=` → `profiles.timezone` → `"UTC"`, and the `/home` client passes neither `?timezone=` nor `?date=` — so a user who never set a timezone silently plans in UTC, which lands events near a day boundary on the wrong local day without any error. Both query params exist and are useful for testing a specific day from the browser. **Weather** is snapshotted into `outfit_plans.weather` at generation time and is not refreshed for the rest of that local day; changing `profiles.city` does not update an already-generated plan (the DB is the only cache), only a Dislike regeneration does.

### The shared outfit Canvas

`src/components/outfit/outfit-canvas.tsx` owns the freeform collage interaction — drag to move, corner to resize, bring-to-front on manipulation, bounds and 15%–60% width clamping — plus the closet picker beside it. It lived inside `outfits-view.tsx` until `/home` needed the same editor for "Adjust this segment"; two copies of pointer-gesture code would drift.

Everything is generic over `CanvasItem`, the minimal shape (`id`, `category`, `subcategory?`, `color?`, `clean_url`, `original_url`) that both `WardrobeItem` and `DailyWardrobeItem` already satisfy, so neither caller converts its data first. `layoutsFromRows()` builds a layout map from rows whose `x/y/width` may be null, filling gaps from `defaultLayoutFor(index)` — null geometry means either a pre-layout record or an AI-generated look, since the model never produces layout. `OutfitCollage` is the read-only render used by `/home` to display a segment with the arrangement the user actually made.

### The upload pipeline (core flow)

`POST /api/ai/classify` (`src/app/api/ai/classify/route.ts`) is the central pipeline:
1. Client already uploaded the original image to Supabase Storage (`wardrobe` bucket) and passes `{ originalUrl, storagePath, mode }`. `mode` is `"single" | "multi"`, set by a toggle in `UploadZone` (`src/components/closet/upload-zone.tsx`) that the user picks *before* uploading — defaults to `"single"`.
   - `mode: "single"` **skips the detection vision call entirely** — the route sets `itemCount = 1` and goes straight to the single-item branch. This is the common case, so it's the one worth not paying detection tokens for.
   - `mode: "multi"` still calls `detectItems()` (still needed for concrete SAM prompts) but trusts the user's claim over Claude's count guess: `itemCount = Math.max(2, detection.count)`.
   - `mode` omitted (older client) falls back to the original auto-detect behavior below, for backward compatibility.
2. `detectItems()` (`src/lib/ai/segment.ts`) — only called when `mode` isn't `"single"` — makes a Claude Haiku vision call asking for both the distinct-item count and concrete English object nouns for SAM 3.1. Before the `mode` toggle existed, this ran unconditionally on every upload; see `checklist.md` for why running SAM first instead would cost money on every single-item photo just to find out it's one item.
3. **Single item (count ≤ 1)** — unchanged original pipeline: `removeBackground()` (`src/lib/ai/remove-bg.ts`, fal.ai `fal-ai/birefnet/v2`) → re-upload clean PNG to Storage (`_clean.png` suffix) → `classifyItem()` → insert one `wardrobe_items` row. Response: `{ item, classification, multiItem: false }`.
4. **Multi item (count ≥ 2)** — `segmentItems()` (`src/lib/ai/segment.ts`) calls fal.ai `fal-ai/sam-3-1/image` once per distinct concrete noun, requests multiple masks plus scores/boxes, deduplicates overlapping detections, and crops the original pixels locally from normalized `[cx,cy,w,h]` boxes. It deliberately does not crop the SAM applied-mask PNGs because those use a black background. Before returning, `mergeDuplicateAccessories()` groups every detection by its normalized prompt (`shoe`, `earring`, `bracelet`, or whatever noun Claude used) and, for any group with 2+ crops, calls `classifySimilarItems()` to ask **Claude Sonnet** (not Haiku — see below) whether any of them depict the same physical item photographed twice — it must describe shape/material/color/hardware/brand per crop before deciding pairs vs. singles (returned as `FINAL:{"pairs":[[1,2]],"singles":[3,4]}`); a proximity/color-only heuristic was tried first and wrongly merged unrelated items that happened to sit near each other, so grouping is deliberately vision-verified, not geometric. Confirmed pairs are composited side-by-side via `composeSideBySide()`, ordered by each item's actual `detection.box[0]` (normalized center-x) in the source photo so the one physically on the left ends up on the left of the composite — asking Claude to additionally judge shoe chirality (which one is the left/right foot) was tried and abandoned because it was unreliable (it once called both shoes of an identical pair "right foot" and refused to merge them); geometric photo position is deterministic and doesn't have that failure mode. `shoe` and `earring` are in `MIRROR_IF_LONE_PROMPTS` — categories that are always sold/worn as a matched pair — so an unmatched lone item there is additionally mirrored with `sharp().flop()` (a literal pixel-flip, so it can't fabricate a different design) and composited next to its mirror. Any other category (bracelet, etc.) is left as a genuine single with no mirroring — a lone bracelet is already a complete item — and a group with only 1 detection skips the Sonnet call entirely (no cost for the common non-duplicate case). Any item Claude doesn't confidently group defaults to single — an incorrect merge is worse than two single-item entries. Each resulting crop is uploaded to Storage, then run through the *same* remove-bg → classify → insert steps as the single-item path (shared via `processOneItem()` in the route file) — one `wardrobe_items` row per detected item/pair. A failed segment is skipped, not fatal. Response: `{ items: [...], multiItem: true, count }`.
   - **Verified 2026-07-10**: a live `fal-ai/sam-3-1/image` call on the four-purse test image returned four entries in `masks`, `scores`, `boxes`, and `metadata`. The endpoint requires a concrete text prompt and explicit `return_multiple_masks`; broad prompts can return no masks.
   - **Verified 2026-07-10 (shoe pairing)**: a 3-real-pairs photo correctly yields 3 shoe entries, and a 6-unrelated-single-shoes + 2-bag photo correctly yields 6 mirrored singles + 2 bags with no cross-pairing. `classifySimilarItems` deliberately uses **Sonnet, not Haiku** — Haiku's per-shoe descriptions were unstable across camera angles (a crossed-over pair with one shoe sole-up and the other side-on got described as if they were different designs) and it kept missing genuine pairs; this call only fires when 2+ crops of the same category are detected, so the cost of a stronger model here is rare, not per-item like `classifyItem`/stylist. Two gotchas from that switch: Sonnet 5 emits an extended-thinking block before its text block, so `message.content[0]` is not the text — find it with `content.find(b => b.type === "text")`; and Sonnet's verbose per-item reasoning needs `max_tokens: 4096` or the response gets cut off before the `FINAL:{...}` JSON, silently falling back to "all singles". See `checklist.md` Debug Log ("鞋子配对") for the full history.
   - **Not yet live-verified**: the bracelet/earring generalization (only the shoe case has been tested against a real photo so far).
5. `classifyItem()` (`src/lib/ai/classify.ts`) downsizes with Sharp (max 1024px, JPEG q85 — Claude rejects images >10MB, and smaller images cost fewer tokens); `resizeForClassification()` is exported and reused by `detectItems()` too.

HEIC photos (iPhone default) are not natively viewable/processable, so `POST /api/ai/convert` (`src/app/api/ai/convert/route.ts`) converts HEIC→JPEG via `heic-convert` + Sharp resize *before* the client kicks off the classify pipeline above — this must happen client-side prior to upload, not inside `/api/ai/classify`.

Model choice is deliberately Haiku (not Sonnet) for classify, stylist, and the item-count check, to keep cost down; see `checklist.md` cost table before changing models.

### AI Stylist

`POST /api/ai/stylist` (`src/app/api/ai/stylist/route.ts`) fetches the user's full active (`archived = false`) wardrobe and profile, inlines a compact JSON summary of both into the system prompt, and asks Claude to recommend outfits using only owned items. It is a single-turn call (no server-side conversation history) — the client is responsible for any chat history it wants to resend.

### Outfit builder

`/outfits` is split between a Server Component data loader (`src/app/(dashboard)/outfits/page.tsx`) and the interactive Client Component (`outfits-view.tsx`). The page fetches the user's saved outfits with joined `outfit_items`/wardrobe previews and all active wardrobe items in parallel. The client renders both the saved-look library and the create flow.

The builder's left-hand Closet is an available-item pool with category filters and text search. Items are square `object-contain` thumbnails; adding one by click or HTML drag removes it from the pool, and removing it from the Canvas returns it. Do not reintroduce selected items into both places at once. The Canvas is freeform rather than a CSS grid: each selected item has client-side normalized `{ x, y, width }` layout state, can be moved with pointer events (mouse or touch), is brought to the top when manipulated, and is resized from its bottom-right handle. Movement and the 15%–60% width range are clamped to the Canvas bounds. A Closet drag uses the drop coordinates as the initial position; click-add uses staggered defaults.

Canvas items deliberately render `clean_url` first (falling back to `original_url`) without a card background, gray border, label footer, or opaque wrapper, so background-removed wardrobe images read as a collage. Delete/resize controls appear as overlays. Keep the transparent presentation separate from the left-hand Closet cards, which retain their square thumbnail treatment.

Saving requires at least two items. It inserts `outfits` metadata (name, folder/collection, notes, `ai_generated: false`) and then inserts `outfit_items` in current z/layer order via `position`; if the junction insert fails, the newly-created outfit is deleted as rollback. Important current limitation: freeform `x/y/width` values are UI-only and are not persisted because `outfit_items` currently has only `position`. A future edit/reopen feature that restores the exact collage must add layout columns to `supabase/schema.sql`, update the hand-maintained DB types/query, and save/load those values—do not encode geometry into `position`.

### Data model

`supabase/schema.sql` is the source of truth for the DB; `src/types/database.ts` are the hand-maintained TS mirrors — keep both in sync when changing schema. Fourteen tables: the original nine (`profiles`, `wardrobe_items`, `outfits`, `outfit_items`, `outfit_journal`, `folders`, `style_dna`, `travel_plans`, `preference_swipes`), the Phase 6.0 tables (`google_connections`, `calendar_events`, `outfit_plans`), and the Phase 6.1 segment tables (`outfit_plan_segments`, `outfit_plan_segment_items`). An `outfit_plans` row is one local date/source/travel scope; ordered child segments hold labels/reasoning/event refs and the segment-item junction holds the complete ordered wardrobe set. Most tables use Supabase RLS keyed on `auth.uid() = user_id` (or an ownership join for junction/child rows). **Exception: `google_connections` has RLS enabled with *no* policy** — this is deliberate, so the client is denied entirely and only the service role ever touches OAuth tokens. Storage RLS on the `wardrobe` bucket scopes objects by the user's folder but also has a public-read policy because item image URLs are served directly.

`src/types/database.ts` contains the hand-maintained mirrors for all Phase 6.0/6.1 planning rows: `GoogleConnection`, `CalendarEvent`, `OutfitPlan`, `OutfitPlanSegment`, and `OutfitPlanSegmentItem`.

`outfit_plan_segment_items` carries `x/y/width` with the same meaning as `outfit_items` — normalized Canvas geometry, null until a human arranges the segment. Section 15d's `apply_plan_segment_items()` is the single writer every path funnels through, and it exists for three reasons that are each easy to get wrong: `(segment_id, position)` is unique and **not** deferrable so renumbering in place can transiently collide (surviving rows are parked at `+1000` first); ownership is enforced by joining `wardrobe_items` on the caller's id so a foreign id simply fails to join and trips the count check; and **only an explicit Canvas save rewrites geometry** — regenerating or confirming a segment must not silently discard an arrangement. `save_outfit_plan_segment` copies that geometry into `outfit_items`, so a segment saved to Looks reopens in `/outfits` as the same collage.

When adding a schema change, update it in `supabase/schema.sql` and apply manually via the Supabase SQL Editor — there is no migration tooling in this repo. Existing databases run the single re-runnable section 15 block; a fresh database runs the whole file because section 15d also installs the shared transactional RPC functions.

### Environment variables

Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `FAL_KEY`, `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-only; backs `src/lib/supabase/service.ts`, needed for `google_connections`), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (Calendar OAuth — see README's "Google Calendar OAuth" for the Cloud Console setup these require). Optional: `OPENWEATHER_API_KEY` (weather-dependent features degrade gracefully without it); `KEEP_ALIVE_ALERT_WEBHOOK` (Slack/Discord webhook the keep-alive cron pings on failure — unset means log-only).

## Doc maintenance (keep these files in sync with the code)

After making a change, update the matching doc **in the same working session** — don't leave it for later. This repo has no migration tooling and no test suite, so these docs are the only record of intent and state; a stale doc is worse than none.

Route the update by *what kind of change it was*:

| If the change is… | Update… |
|---|---|
| Architecture, code layout, a new/renamed route or module, a pipeline behavior change | `CLAUDE.md` (this file) |
| A feature reaching "done", or a bug fixed (root cause + fix) | `checklist.md` (feature-status table and/or Debug Log) |
| A plan, priority, or technical design for unbuilt work | `Roadmap.md` |
| Setup, environment variables, or deployment steps | `README.md` |

`AGENTS.md` is a thin pointer to this file — never copy content into it; it needs no per-change update.

Scope, so this stays signal not noise:
- **Update on**: meaningful changes to architecture, feature status, plans, or setup — the things above.
- **Skip for**: styling tweaks, variable renames, comment edits, and other changes that don't alter behavior, status, or plan. Not every commit needs a doc edit.
- When code and a doc disagree, the code is truth — fix the doc, and note the correction if it was a documented decision.

## Status / in-progress work

Three docs, three jobs — read the right one:

- **`checklist.md`** — what's already been built, per-phase feature status, and a running debug log. Check it before assuming a feature is unimplemented or before re-solving a previously-fixed build error (e.g. Next 16 `proxy.ts` rename, Sharp image resizing for Claude's 10MB limit, HEIC conversion, the shoe-pairing history).
- **`ROADMAP.md`** — what's next, in what order, and the technical design for unbuilt features. Read this before starting any new feature so the schema/route decisions match the plan.
- **`CLAUDE.md`** (this file) — how the current code is laid out.

Current state in one paragraph: multi-item SAM 3.1 segmentation is live-verified for shoes (the earring/bracelet generalization is not); the remaining upload UX gap is that there is no frontend checkbox UI to deselect individual detected items before they're all auto-classified. The outfit builder is complete including freeform Canvas geometry persistence (`outfit_items.x/y/width`) and an edit entry point for saved outfits. `/home` now serves a calendar-aware, dynamic multi-segment daily plan: the database is the only cache, Dislike regenerates while excluding rejected item IDs, each segment can be adjusted and saved separately, and Worn confirmation atomically snapshots one journal row per segment while incrementing every distinct item once for the day. **Live-verified end-to-end 2026-07-30** against a real account and the production DB after the section 15 migration ran (see `checklist.md` 任务 1 for what each step confirmed). The two gaps that verification surfaced are now closed: Dislike works per segment as well as per day, and "Adjust this segment" opens the shared `/outfits` Canvas with its arrangement persisted — that also fixed a quieter bug, since segment edits used to be client-only state and were silently lost on refresh. `POST /api/ai/stylist` still only returns plain text (`{ reply }`) — no structured/Canvas output and no way to edit a recommended look.

Not built yet, in priority order (details in `ROADMAP.md`): Gmail's independent OAuth leg → weekly (7-day) planning → travel mode with capsule generation and packing list. After that: onboarding/cold-start questions, fal.ai avatar, shopping recommendations, human stylist consultation booking, and stylist authorization/Folk CRM integration. The journal now receives real daily wear rows, but a calendar/history UI for those rows is still not built; folders and preference swipes also remain schema-only.
