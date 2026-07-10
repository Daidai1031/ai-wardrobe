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
- `src/app/api/ai/` — server-side AI pipeline endpoints: `classify`, `convert`, `stylist`; `src/app/api/weather/` proxies OpenWeatherMap.

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

### Data model

`supabase/schema.sql` is the source of truth for the DB; `src/types/database.ts` are the hand-maintained TS mirrors — keep both in sync when changing schema. Nine tables: `profiles`, `wardrobe_items`, `outfits`, `outfit_items` (junction, with `position` for layering order), `outfit_journal` (calendar), `folders`, `style_dna` (aggregated color/style/category distributions), `travel_plans`, `preference_swipes`. All tables use Supabase RLS keyed on `auth.uid() = user_id` (or via join to an owned outfit for `outfit_items`). Storage RLS on the `wardrobe` bucket scopes objects by `(storage.foldername(name))[1] = auth.uid()::text` but also has a public-read policy on the whole bucket (since `clean_url`/`original_url` are served directly as public URLs to the client).

When adding a schema change, update it in `supabase/schema.sql` and apply manually via the Supabase SQL Editor — there is no migration tooling in this repo.

### Environment variables

Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `FAL_KEY`, `ANTHROPIC_API_KEY`. Optional: `OPENWEATHER_API_KEY` (weather-dependent features degrade gracefully without it).

## Status / in-progress work

`checklist.md` tracks feature status per phase and a running debug log — check it before assuming a feature is unimplemented or before re-solving a previously-fixed build error (e.g. Next 16 `proxy.ts` rename, Sharp image resizing for Claude's 10MB limit, HEIC conversion). Multi-item SAM 3.1 segmentation is live-verified; the remaining UX gap is that there is no frontend checkbox UI to deselect individual detected items before they're all auto-classified. Also incomplete: outfit drag-and-drop builder UI, daily home-page recommendations, Google Calendar integration, travel/capsule wardrobe features (placeholder pages only).
