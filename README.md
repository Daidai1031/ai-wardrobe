# AI Wardrobe — Setup & Deployment Guide

## Quick Start

### 1. Create Supabase Project

Go to [supabase.com](https://supabase.com) → New Project.

After creation, go to **SQL Editor** → paste the contents of `supabase/schema.sql` → Run.

Then go to **Settings → API** and copy:
- `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
- `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### 2. Configure Auth

In Supabase Dashboard → **Authentication → Providers**:
- Email: enabled by default (disable "Confirm email" for dev)
- Google: optional — add OAuth client ID/secret from Google Cloud Console

### 3. Create Storage Bucket

Go to **Storage** → the schema.sql already creates the `wardrobe` bucket via SQL.
If it didn't run, manually create a bucket named `wardrobe` with Public access.

### 4. Environment Variables

```bash
cp .env.local.example .env.local
```

Fill in:
- `NEXT_PUBLIC_SUPABASE_URL` — from step 1
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from step 1
- `FAL_KEY` — your existing fal.ai key
- `ANTHROPIC_API_KEY` — from console.anthropic.com
- `OPENWEATHER_API_KEY` — free at openweathermap.org/api (optional for Phase 1)
- `KEEP_ALIVE_ALERT_WEBHOOK` — optional Slack/Discord incoming webhook; if set, the keep-alive cron pings it when the Supabase check fails (see "Keeping Supabase awake")
- `SUPABASE_SERVICE_ROLE_KEY` — Settings → API → `service_role` key. Server-only, never expose via `NEXT_PUBLIC_`. Needed for `google_connections` (see "Google Calendar OAuth" below), which has RLS enabled with no client policy — only the service role can read/write it.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — see "Google Calendar OAuth" below.
- `STYLIST_TIME_ZONE` — optional IANA timezone for the Human Stylist's working calendar (defaults to `America/New_York`). Slots are generated in this timezone, then displayed in each client's browser timezone.

### Google Calendar OAuth (Phase 6.0-A)

This is separate from the Supabase Google *login* provider in step 2 above — that one is sign-in only and Supabase doesn't persist a long-lived `provider_refresh_token`. Calendar access is its own OAuth flow (`/api/google/auth` → `/api/google/callback`) with its own token storage (`google_connections`).

Manual setup in [Google Cloud Console](https://console.cloud.google.com):
1. Create (or reuse) a project → **APIs & Services → Library** → enable the **Google Calendar API**.
2. **APIs & Services → OAuth consent screen** → User type **External** → keep publishing status at **Testing** (ROADMAP D1 — going to Production would require a paid CASA security review for the `gmail.readonly` scope planned in a later task; Testing mode caps you at 100 test users, which is fine pre-launch).
3. Under the consent screen's **Test users**, add the Google account(s) you'll sign in with during development — Testing-mode apps reject any Google account not on this list.
4. **APIs & Services → Credentials** → **Create Credentials → OAuth client ID** → type **Web application**.
   - Authorized redirect URIs: add `http://localhost:3000/api/google/callback` for local dev, and `https://<your-prod-domain>/api/google/callback` for the deployed app. The redirect URI is derived from the request's own origin at runtime (no separate `GOOGLE_REDIRECT_URI` env var needed) — it just has to be registered here so Google will accept it.
   - Copy the generated **Client ID** → `GOOGLE_CLIENT_ID`, **Client secret** → `GOOGLE_CLIENT_SECRET`.
5. Under **Scopes** on the consent screen, add `.../auth/calendar.readonly` (marked "sensitive" — that's fine in Testing mode, it only triggers CASA review in Production).

Testing-mode refresh tokens expire after ~7 days — `src/lib/google/client.ts`'s `getAccessToken()` handles a failed refresh by marking `google_connections.invalid_at` instead of throwing, so the app degrades to "please reconnect Calendar" rather than a 500. Re-running the `/api/google/auth?scope=calendar` flow (it always sends `prompt=consent`) re-authorizes and clears that flag.

### 5. Install & Run

```bash
npm install
npm run dev
```

Open http://localhost:3000 → Sign up → Start uploading clothes.

## Deploy to Vercel

```bash
npm install -g vercel
vercel
```

Add the same env vars in Vercel Dashboard → Project → Settings → Environment Variables.

### Keeping Supabase awake (free tier)

Supabase pauses a free-tier project after ~7 days with no activity. `vercel.json` registers a Vercel Cron job (`0 0 */3 * *` — every 3 days at 00:00 UTC, comfortably inside the 7-day window) that hits `GET /api/keep-alive`. That route runs a trivial `select id from profiles limit 1` — enough DB activity to reset the inactivity timer — and returns an empty `200` (no body, `no-store`, `noindex`). No auth cookie is present on a cron request, so the query runs as the anon role and returns zero rows under RLS; that still counts as activity and is not an error. Vercel Cron is picked up automatically from `vercel.json` on deploy — no extra dashboard config. If you self-host or move off Vercel, replace this with any external uptime pinger on the same endpoint.

**Failure alerts:** if the DB check itself fails (Supabase actually unreachable), the route best-effort POSTs to `KEEP_ALIVE_ALERT_WEBHOOK` (a Slack or Discord incoming webhook — the payload includes both `text` and `content` so either works) before returning `500`. Leave the env var unset to just log. **Limitation:** this only catches a *failed* run — it cannot detect the cron *not firing at all* (a route that never runs can't alert on itself). For a true dead-man's-switch, point an external monitor (e.g. a healthchecks.io "expected every N days" check) at this endpoint too.

### Custom Domain

In Vercel Dashboard → Project → Settings → Domains → Add `closet.daidingrdesigns.com`.
Then in your domain registrar, add a CNAME record:
- Name: `closet`
- Value: `cname.vercel-dns.com`

## Project Structure

```
src/
├── app/
│   ├── (auth)/login, signup     — auth pages
│   ├── (dashboard)/             — main app (sidebar layout)
│   │   ├── home/                — daily pick (weather + wardrobe)
│   │   ├── closet/              — browse & upload items
│   │   ├── closet/[id]/         — item detail & edit
│   │   ├── outfits/             — outfit library + freeform Canvas builder
│   │   ├── stylist/             — AI chat stylist (text-only for now)
│   │   ├── analytics/           — closet stats & style DNA
│   │   ├── profile/             — user profile & body data
│   │   └── travel/              — travel planner (placeholder pages only)
│   ├── api/ai/                  — AI processing endpoints
│   │   ├── classify/            — upload → detect count → bg removal or SAM segmentation → classify → store
│   │   ├── convert/             — HEIC/HEIF → JPEG (client calls this before upload)
│   │   ├── daily/               — Home daily pick (profile.city → weather → Claude selects a look)
│   │   └── stylist/             — chat with wardrobe context
│   ├── api/weather/             — OpenWeatherMap proxy
│   └── api/keep-alive/          — Vercel Cron target; pings Supabase so the free tier isn't paused
├── components/
│   ├── closet/                  — upload zone (single/multi toggle), item card
│   ├── layout/                  — sidebar navigation
│   └── ui/                      — reusable UI primitives
├── lib/
│   ├── ai/                      — fal.ai bg removal, Claude classify, SAM 3.1 multi-item segmentation
│   └── supabase/                — client & server Supabase instances
├── proxy.ts                     — Next.js 16's middleware equivalent (auth/session refresh, route protection)
└── types/                       — TypeScript domain types
```

`/` redirects to `/home` (authenticated) or `/login`. `/home` is the dashboard landing page: it reads `profile.city` → OpenWeather → active wardrobe and asks Claude for a daily outfit pick (cached per-day in `localStorage`).

Three docs cover the rest, and this file only covers setup/deployment:
- `CLAUDE.md` — current architecture / code layout
- `checklist.md` — what's already built + debug log
- `Roadmap.md` — what's next + technical design for unbuilt features

## Architecture Decisions

| Decision | Why |
|---|---|
| **fal.ai BiRefNet for single-item bg removal, SAM 3.1 for multi-item segmentation** | BiRefNet is fast/cheap and the common case is one item per photo; a cheap Claude Haiku call decides item count first so SAM (and its extra cost) only runs on photos that actually need splitting. See `checklist.md`/`CLAUDE.md` for the full pipeline. |
| **Claude Vision for classification** | Far more accurate than SAM concept labels. Returns rich metadata (category, color, material, season, occasion, style tags) in one call. |
| **Claude Haiku (not Sonnet) for classify/stylist/detection** | ~3x cheaper than Sonnet with acceptable accuracy for these calls; see the cost table below. One exception: the shoe/jewelry duplicate-pairing check in `segment.ts` uses Sonnet, since it only fires on multi-item photos and needs stronger visual reasoning. |
| **Supabase** | Auth + DB + Storage in one service. Free tier handles 3+ users easily. RLS ensures data isolation. |
| **Next.js App Router** | Server Components for data fetching, API Routes for AI processing, `proxy.ts` (Next 16's renamed middleware) for auth. |
| **New project** (not upgrading Python repo) | Different language, different architecture, different deployment target. The Python pipeline was a prototype. |

## Cost Estimate (3 users, ~50 items each)

Rough total after switching classify/stylist from Sonnet to Haiku: **~$1.20/mo** (down from ~$4.50/mo on Sonnet). See `checklist.md`'s cost table ("成本优化") for the full before/after breakdown, including the per-model rates.
