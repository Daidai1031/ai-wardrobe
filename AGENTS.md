# AGENTS.md

This file is the entry point for coding agents that read `AGENTS.md` (Codex, etc.).

**This project keeps a single source of truth in `CLAUDE.md` — do not duplicate its content here.**
An earlier version of this file was a stale copy of `CLAUDE.md` with the model names wrongly
rewritten to "Codex" (the app calls the **Claude / Anthropic** API regardless of which agent
reads this doc). To avoid that drift, `AGENTS.md` is intentionally a thin pointer.

## Read the right doc for the job

- **`CLAUDE.md`** — how the current code is laid out (architecture, routes, the upload pipeline,
  data model, env vars, commands). **Read this first** for any code navigation or change.
- **`Roadmap.md`** — what's next, in what order, and the technical design for unbuilt features.
  Read before starting any new feature so schema/route decisions match the plan.
- **`checklist.md`** — what's already built, per-phase feature status, and the running debug log.
  Check before assuming a feature is unimplemented or re-solving a previously-fixed build error.

## Quick reference

```bash
npm run dev        # start dev server (Next.js, http://localhost:3000)
npm run build      # production build
npm run start      # run production build
npm run lint       # ESLint CLI (Next 16 removed `next lint`)
npm run typecheck  # tsc --noEmit, over src/ and tests/
npm test           # vitest run
```

Tests cover the deterministic planning/travel/calendar core only, never a route, component or
live query — see `CLAUDE.md`'s Commands section before adding to them. Stack: Next.js 16 App Router, Supabase (auth/DB/storage),
**Claude** Vision (classify/stylist/detect), fal.ai (background removal + SAM 3.1 segmentation).
Required env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `FAL_KEY`,
`ANTHROPIC_API_KEY`. Optional: `OPENWEATHER_API_KEY`.
