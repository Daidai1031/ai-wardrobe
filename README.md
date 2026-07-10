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
│   │   ├── outfits/             — outfit library
│   │   ├── stylist/             — AI chat stylist
│   │   ├── analytics/           — closet stats & style DNA
│   │   ├── profile/             — user profile & body data
│   │   └── travel/              — travel planner (Phase 5)
│   └── api/ai/                  — AI processing endpoints
│       ├── classify/            — upload → bg removal → classification → store
│       ├── stylist/             — chat with wardrobe context
│       └── weather/             — OpenWeatherMap proxy
├── components/
│   ├── closet/                  — upload zone, item card
│   ├── layout/                  — sidebar navigation
│   └── ui/                      — reusable UI primitives
├── lib/
│   ├── ai/                      — fal.ai & Claude API wrappers
│   └── supabase/                — client & server Supabase instances
└── types/                       — TypeScript domain types
```

## Architecture Decisions

| Decision | Why |
|---|---|
| **fal.ai for bg removal** (not SAM segmentation) | BiRefNet is faster, cheaper, and better for single-item photos. SAM is overkill for MVP. |
| **Claude Vision for classification** | Far more accurate than SAM concept labels. Returns rich metadata (category, color, material, season, occasion, style tags) in one call. |
| **Supabase** | Auth + DB + Storage in one service. Free tier handles 3+ users easily. RLS ensures data isolation. |
| **Next.js App Router** | Server Components for data fetching, API Routes for AI processing, middleware for auth. |
| **New project** (not upgrading Python repo) | Different language, different architecture, different deployment target. The Python pipeline was a prototype. |

## Cost Estimate (3 users, ~50 items each)

| Service | Monthly Cost |
|---|---|
| Supabase (Free tier) | $0 |
| Vercel (Hobby) | $0 |
| fal.ai BiRefNet (~150 calls) | ~$1.50 |
| Claude Sonnet (~150 classify + chat) | ~$3.00 |
| OpenWeatherMap (Free) | $0 |
| **Total** | **~$4.50/mo** |
