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
- `src/app/api/ai/` — server-side AI pipeline endpoints: `classify`, `convert`, `stylist`, `daily`; `src/app/api/weather/` proxies OpenWeatherMap.
- `src/app/api/keep-alive/` — a Vercel Cron target (schedule in `vercel.json`, every 3 days) that runs a trivial `select id from profiles limit 1` and returns an empty `200`, purely to keep the free-tier Supabase project from being paused after ~7 days of inactivity. Not part of any user flow; no auth (runs as anon under RLS, which is fine — the query still counts as DB activity). See README's "Keeping Supabase awake" for details.

### Auth & routing

`src/proxy.ts` is this Next.js 16 project's `middleware.ts` equivalent — Next 16 renamed the convention (`middleware()` → default-exported `proxy()`, `config` → `proxyConfig`). It refreshes the Supabase session on every request, redirects unauthenticated users away from dashboard routes (`/closet`, `/outfits`, `/stylist`, `/profile`, `/analytics`, `/travel`), and redirects authenticated users away from `/login`/`/signup`. When adding a new protected top-level route, add its path prefix to the `isDashboard` check here.

Two Supabase client factories exist and are not interchangeable:
- `src/lib/supabase/client.ts` — browser client, for use in Client Components.
- `src/lib/supabase/server.ts` — server client bound to Next's `cookies()`, for use in Server Components / Route Handlers.

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

`supabase/schema.sql` is the source of truth for the DB; `src/types/database.ts` are the hand-maintained TS mirrors — keep both in sync when changing schema. Twelve tables: `profiles`, `wardrobe_items`, `outfits`, `outfit_items` (junction, with `position` for layering order), `outfit_journal` (calendar), `folders`, `style_dna` (aggregated color/style/category distributions), `travel_plans`, `preference_swipes`, plus the three Phase 6.0 planning tables `google_connections`, `calendar_events`, `outfit_plans`. Most tables use Supabase RLS keyed on `auth.uid() = user_id` (or via join to an owned outfit for `outfit_items`). **Exception: `google_connections` has RLS enabled with *no* policy** — this is deliberate, so the client is denied entirely and only the service role (which bypasses RLS) ever touches OAuth tokens; never add a "users read own row" policy to it. `calendar_events` and `outfit_plans` follow the usual `auth.uid() = user_id` pattern. Storage RLS on the `wardrobe` bucket scopes objects by `(storage.foldername(name))[1] = auth.uid()::text` but also has a public-read policy on the whole bucket (since `clean_url`/`original_url` are served directly as public URLs to the client).

Note: `src/types/database.ts` has **not** yet been updated for the three Phase 6.0 tables — that sync is deferred until the code that reads/writes them (OAuth, event enrichment, plan persistence) is built.

When adding a schema change, update it in `supabase/schema.sql` and apply manually via the Supabase SQL Editor — there is no migration tooling in this repo. Migrations for an existing DB are collected in a single re-runnable block at the bottom of `schema.sql` (section 15 "MIGRATIONS"); sections 1-14 are for building a database from scratch.

### Environment variables

Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `FAL_KEY`, `ANTHROPIC_API_KEY`. Optional: `OPENWEATHER_API_KEY` (weather-dependent features degrade gracefully without it); `KEEP_ALIVE_ALERT_WEBHOOK` (Slack/Discord webhook the keep-alive cron pings on failure — unset means log-only).

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

Current state in one paragraph: multi-item SAM 3.1 segmentation is live-verified for shoes (the earring/bracelet generalization is not); the remaining upload UX gap is that there is no frontend checkbox UI to deselect individual detected items before they're all auto-classified. The outfit builder is complete including freeform Canvas geometry persistence (`outfit_items.x/y/width`) and an edit entry point for saved outfits — but note the `alter table` for those three columns at the bottom of `schema.sql` still has to be run by hand in the Supabase SQL Editor (no migration tooling in this repo). `/home` exists and serves a weather + wardrobe daily pick via `GET /api/ai/daily`, cached per-day in `localStorage`. `POST /api/ai/stylist` still only returns plain text (`{ reply }`) — no structured/Canvas output and no way to edit a recommended look.

Not built yet, in priority order (details in `ROADMAP.md`): Google OAuth for Calendar + Gmail and the three tables it needs (`google_connections`, `calendar_events`, `outfit_plans`) → daily planning with calendar context → weekly (7-day) planning → travel mode with capsule generation and packing list. After that: onboarding/cold-start questions, fal.ai avatar, shopping recommendations, human stylist consultation booking, and a second B2B/stylist-facing surface (which will require re-auditing every RLS policy, since they all currently assume `auth.uid() = user_id`). Also still schema-only with no frontend: folders, outfit journal/calendar view, preference swipes.