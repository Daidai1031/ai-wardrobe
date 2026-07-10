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
│   │   ├── closet/              — browse & upload items
│   │   ├── closet/[id]/         — item detail & edit
│   │   ├── outfits/             — outfit library + freeform Canvas builder
│   │   ├── stylist/             — AI chat stylist (text-only for now)
│   │   ├── analytics/           — closet stats & style DNA
│   │   ├── profile/             — user profile & body data
│   │   └── travel/              — travel planner (placeholder pages only)
│   └── api/ai/                  — AI processing endpoints
│       ├── classify/            — upload → detect count → bg removal or SAM segmentation → classify → store
│       ├── convert/             — HEIC/HEIF → JPEG (client calls this before upload)
│       ├── stylist/             — chat with wardrobe context
│       └── weather/             — OpenWeatherMap proxy
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

There is no dashboard home page yet — `/` just redirects to `/closet` or `/login`. See `CLAUDE.md` and `checklist.md` for the current architecture and in-progress work in detail; this file only covers setup/deployment.

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
