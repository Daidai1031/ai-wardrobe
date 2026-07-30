-- ============================================================
-- AI Wardrobe — Supabase Schema
-- Run this in Supabase SQL Editor after creating a new project
-- ============================================================

-- 0. Extensions
create extension if not exists "uuid-ossp";

-- ============================================================
-- 1. PROFILES (extends Supabase auth.users)
-- ============================================================
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  name        text,
  city        text,
  -- body profile
  height_cm   numeric,
  weight_kg   numeric,
  body_shape  text check (body_shape in ('pear','apple','hourglass','rectangle','inverted_triangle')),
  bust_cm     numeric,
  waist_cm    numeric,
  hip_cm      numeric,
  -- appearance (for future avatar)
  skin_tone   text,
  hair_color  text,
  hair_length text,
  -- preference DNA (aggregated from swipes, stored as JSONB)
  preference_dna jsonb default '{}',
  -- roles: added now (D3) to avoid an RLS migration in the B2B phase; no B2B logic yet
  roles       text[] default '{client}',
  timezone    text,                    -- D4: user's home timezone (IANA, e.g. America/New_York)
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', ''));
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 2. WARDROBE ITEMS
-- ============================================================
create table public.wardrobe_items (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  -- images
  original_url  text not null,          -- Supabase Storage path
  clean_url     text,                   -- background-removed version
  -- AI-classified metadata (editable by user)
  category      text not null,          -- Tops, Bottoms, Dresses, Outerwear, Shoes, Bags, Accessories
  subcategory   text,                   -- blazer, sneakers, clutch, etc.
  color         text,                   -- primary color
  colors        text[] default '{}',    -- all detected colors
  brand         text,
  material      text,
  season        text[] default '{}',    -- spring, summer, fall, winter
  occasion      text[] default '{}',    -- work, casual, formal, date, travel
  style_tags    text[] default '{}',    -- minimalist, classic, creative, etc.
  -- product link enrichment
  product_url   text,
  -- usage tracking
  times_worn    int default 0,
  last_worn_at  timestamptz,
  favorite      boolean default false,
  archived      boolean default false,
  -- AI confidence
  ai_confidence numeric,
  -- timestamps
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index idx_wardrobe_user on public.wardrobe_items(user_id);
create index idx_wardrobe_category on public.wardrobe_items(user_id, category);

-- ============================================================
-- 3. OUTFITS
-- ============================================================
create table public.outfits (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  name        text,
  folder      text default 'Uncategorized', -- Work, Date Night, Travel, etc.
  image_url   text,                          -- composite outfit image (optional)
  notes       text,
  rating      int check (rating between 1 and 5),
  times_worn  int default 0,
  last_worn_at timestamptz,
  ai_generated boolean default false,
  ai_reasoning text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index idx_outfits_user on public.outfits(user_id);

-- ============================================================
-- 4. OUTFIT ↔ ITEM junction
-- ============================================================
create table public.outfit_items (
  outfit_id   uuid not null references public.outfits(id) on delete cascade,
  item_id     uuid not null references public.wardrobe_items(id) on delete cascade,
  position    int,      -- layering order: 0 = base, 1 = mid, 2 = outer, etc.
  x           numeric,  -- normalized freeform canvas position (0-100), null for outfits saved before this was tracked
  y           numeric,  -- normalized freeform canvas position (0-100)
  width       numeric,  -- normalized freeform canvas width (0-100)
  primary key (outfit_id, item_id)
);

-- Migration for existing databases: x/y/width are included in the consolidated
-- migration block at the bottom of this file (section 15). This block has NOT
-- yet been run against the production DB — run section 15 in the SQL Editor.

-- ============================================================
-- 5. OUTFIT CALENDAR / JOURNAL
-- ============================================================
create table public.outfit_journal (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  outfit_id   uuid references public.outfits(id) on delete set null,
  worn_date   date not null,
  event_name  text,   -- "Board Meeting", "Conference Day 1"
  event_type  text,   -- meeting, presentation, networking, casual, etc.
  notes       text,
  created_at  timestamptz default now()
);

create index idx_journal_user_date on public.outfit_journal(user_id, worn_date);

-- ============================================================
-- 6. FOLDERS (user-defined groupings)
-- ============================================================
create table public.folders (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  name        text not null,
  folder_type text default 'outfit', -- 'outfit' or 'travel'
  created_at  timestamptz default now()
);

-- ============================================================
-- 7. STYLE DNA (computed snapshot, updated periodically)
-- ============================================================
create table public.style_dna (
  user_id       uuid primary key references public.profiles(id) on delete cascade,
  color_dist    jsonb default '{}',   -- {"black": 0.32, "beige": 0.28, ...}
  style_dist    jsonb default '{}',   -- {"office_classic": 0.45, ...}
  category_dist jsonb default '{}',   -- {"tops": 15, "shoes": 8, ...}
  total_items   int default 0,
  updated_at    timestamptz default now()
);

-- ============================================================
-- 8. TRAVEL PLANS
-- ============================================================
create table public.travel_plans (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  destination     text not null,
  start_date      date not null,
  end_date        date not null,
  travel_goals    text[] default '{}',  -- meetings, leisure, networking
  packing_list    jsonb default '[]',
  daily_outfits   jsonb default '[]',   -- [{day: 1, events: [...], outfit_id: ...}]
  weather_data    jsonb default '{}',
  destination_timezone text,            -- D4: destination IANA timezone; plan_date is stored in local date
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ============================================================
-- 9. PREFERENCE SWIPES (Tinder-style)
-- ============================================================
create table public.preference_swipes (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  image_url   text not null,
  action      text not null check (action in ('like','dislike','save')),
  tags        text[] default '{}',
  created_at  timestamptz default now()
);

-- ============================================================
-- 10. GOOGLE CONNECTIONS (OAuth tokens for Calendar / Gmail — Phase 6.0)
-- ============================================================
-- SECURITY: no "users read own row" RLS is defined for this table on purpose.
-- The front-end must NEVER receive these tokens. RLS is enabled with zero
-- policies below, which denies all client access; only the service role
-- (which bypasses RLS) reads/writes here from server-side code.
create table public.google_connections (
  user_id        uuid primary key references public.profiles(id) on delete cascade,
  access_token   text not null,
  refresh_token  text,
  expires_at     timestamptz,
  scopes         text[] default '{}',   -- actual granted scopes; used by hasScope() to gate features
  google_email   text,
  invalid_at     timestamptz,           -- set when a refresh fails (Testing-mode refresh_token expires ~7d)
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

-- ============================================================
-- 11. CALENDAR EVENTS (cache + Claude semantic enrichment — Phase 6.0)
-- ============================================================
create table public.calendar_events (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  google_event_id text not null,
  title           text,
  location        text,
  starts_at       timestamptz not null,
  ends_at         timestamptz,
  all_day         boolean default false,
  attendee_count  int default 0,
  -- Claude semantic output (batched once per week, cached here — not per-event)
  occasion        text,   -- board_meeting / client_dinner / casual / gym / travel / formal...
  formality       int,    -- 1-5
  synced_at       timestamptz default now(),
  unique (user_id, google_event_id)
);

create index idx_calendar_user_start on public.calendar_events(user_id, starts_at);

-- ============================================================
-- 12. OUTFIT PLANS (unified daily/weekly/travel plans — Phase 6.0)
-- ============================================================
-- Replaces the localStorage cache currently used by /home; daily/weekly/travel all write here.
create table public.outfit_plans (
  id             uuid primary key default uuid_generate_v4(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  plan_date      date not null,        -- D4: local date of the plan's location
  source         text not null check (source in ('daily','weekly','travel')),
  travel_plan_id uuid references public.travel_plans(id) on delete cascade,
  outfit_id      uuid references public.outfits(id) on delete set null,
  item_ids       uuid[] default '{}',
  reasoning      text,
  gap            text,
  weather        jsonb default '{}',
  event_ids      uuid[] default '{}',
  status         text default 'suggested' check (status in ('suggested','accepted','rejected','worn')),
  generated_at   timestamptz default now(),  -- D9: rate-limiting regeneration
  created_at     timestamptz default now(),
  unique (user_id, plan_date, source, travel_plan_id)
);

create index idx_plans_user_date on public.outfit_plans(user_id, plan_date);

-- ============================================================
-- 13. ROW-LEVEL SECURITY
-- ============================================================
alter table public.profiles enable row level security;
alter table public.wardrobe_items enable row level security;
alter table public.outfits enable row level security;
alter table public.outfit_items enable row level security;
alter table public.outfit_journal enable row level security;
alter table public.folders enable row level security;
alter table public.style_dna enable row level security;
alter table public.travel_plans enable row level security;
alter table public.preference_swipes enable row level security;
-- google_connections: RLS enabled with NO policies (client denied; service role only)
alter table public.google_connections enable row level security;
alter table public.calendar_events enable row level security;
alter table public.outfit_plans enable row level security;

-- Profiles: users see/edit only their own
create policy "Users read own profile"   on public.profiles for select using (auth.uid() = id);
create policy "Users update own profile" on public.profiles for update using (auth.uid() = id);

-- Wardrobe items: users CRUD only their own
create policy "Users read own items"   on public.wardrobe_items for select using (auth.uid() = user_id);
create policy "Users insert own items" on public.wardrobe_items for insert with check (auth.uid() = user_id);
create policy "Users update own items" on public.wardrobe_items for update using (auth.uid() = user_id);
create policy "Users delete own items" on public.wardrobe_items for delete using (auth.uid() = user_id);

-- Outfits
create policy "Users read own outfits"   on public.outfits for select using (auth.uid() = user_id);
create policy "Users insert own outfits" on public.outfits for insert with check (auth.uid() = user_id);
create policy "Users update own outfits" on public.outfits for update using (auth.uid() = user_id);
create policy "Users delete own outfits" on public.outfits for delete using (auth.uid() = user_id);

-- Outfit items: access through outfit ownership
create policy "Users manage outfit items" on public.outfit_items for all
  using (exists (select 1 from public.outfits where outfits.id = outfit_items.outfit_id and outfits.user_id = auth.uid()));

-- Journal
create policy "Users manage own journal" on public.outfit_journal for all using (auth.uid() = user_id);

-- Folders
create policy "Users manage own folders" on public.folders for all using (auth.uid() = user_id);

-- Style DNA
create policy "Users read own dna"   on public.style_dna for select using (auth.uid() = user_id);
create policy "Users upsert own dna" on public.style_dna for insert with check (auth.uid() = user_id);
create policy "Users update own dna" on public.style_dna for update using (auth.uid() = user_id);

-- Travel
create policy "Users manage own travel" on public.travel_plans for all using (auth.uid() = user_id);

-- Swipes
create policy "Users manage own swipes" on public.preference_swipes for all using (auth.uid() = user_id);

-- Calendar events: users own their rows (server writes may also use the service role, which bypasses RLS)
create policy "Users manage own events" on public.calendar_events for all using (auth.uid() = user_id);

-- Outfit plans
create policy "Users manage own plans" on public.outfit_plans for all using (auth.uid() = user_id);

-- NOTE: public.google_connections has RLS enabled above but intentionally NO policy → client denied entirely.

-- ============================================================
-- 14. STORAGE BUCKETS
-- ============================================================
-- Run these in Supabase Dashboard > Storage, or via SQL:
insert into storage.buckets (id, name, public) values ('wardrobe', 'wardrobe', true);

-- Storage policies: users upload to their own folder
create policy "Users upload own images"
  on storage.objects for insert
  with check (bucket_id = 'wardrobe' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users read own images"
  on storage.objects for select
  using (bucket_id = 'wardrobe' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Public read wardrobe"
  on storage.objects for select
  using (bucket_id = 'wardrobe');

create policy "Users delete own images"
  on storage.objects for delete
  using (bucket_id = 'wardrobe' and (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================
-- 15. MIGRATIONS (existing DB — run this whole block ONCE in the Supabase SQL Editor)
-- ============================================================
-- This repo has no migration tooling. Sections 1-14 above are for building a
-- database from scratch. If you already have a production DB, DO NOT re-run those;
-- copy-paste and run THIS section 15 block once. It is safe to run as a unit:
--   - column adds use `add column if not exists` (idempotent)
--   - `create table if not exists` skips tables that already exist
--   - each policy is dropped-if-exists before create, so re-running won't error

-- 15a. New columns on existing tables (Phase 6.0: D3 roles, D4 timezones; plus the
--      outfit_items x/y/width that were defined in section 4 but never run in prod)
alter table public.profiles      add column if not exists roles text[] default '{client}';
alter table public.profiles      add column if not exists timezone text;
alter table public.travel_plans  add column if not exists destination_timezone text;
alter table public.outfit_items  add column if not exists x numeric;
alter table public.outfit_items  add column if not exists y numeric;
alter table public.outfit_items  add column if not exists width numeric;

-- 15b. New tables (Phase 6.0). Definitions mirror sections 10-12 above.
create table if not exists public.google_connections (
  user_id        uuid primary key references public.profiles(id) on delete cascade,
  access_token   text not null,
  refresh_token  text,
  expires_at     timestamptz,
  scopes         text[] default '{}',
  google_email   text,
  invalid_at     timestamptz,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

create table if not exists public.calendar_events (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  google_event_id text not null,
  title           text,
  location        text,
  starts_at       timestamptz not null,
  ends_at         timestamptz,
  all_day         boolean default false,
  attendee_count  int default 0,
  occasion        text,
  formality       int,
  synced_at       timestamptz default now(),
  unique (user_id, google_event_id)
);
create index if not exists idx_calendar_user_start on public.calendar_events(user_id, starts_at);

create table if not exists public.outfit_plans (
  id             uuid primary key default uuid_generate_v4(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  plan_date      date not null,
  source         text not null check (source in ('daily','weekly','travel')),
  travel_plan_id uuid references public.travel_plans(id) on delete cascade,
  outfit_id      uuid references public.outfits(id) on delete set null,
  item_ids       uuid[] default '{}',
  reasoning      text,
  gap            text,
  weather        jsonb default '{}',
  event_ids      uuid[] default '{}',
  status         text default 'suggested' check (status in ('suggested','accepted','rejected','worn')),
  generated_at   timestamptz default now(),
  created_at     timestamptz default now(),
  unique (user_id, plan_date, source, travel_plan_id)
);
create index if not exists idx_plans_user_date on public.outfit_plans(user_id, plan_date);

-- 15c. RLS for the new tables.
-- google_connections: RLS ON, NO policy → client denied entirely; service role only.
alter table public.google_connections enable row level security;
alter table public.calendar_events    enable row level security;
alter table public.outfit_plans        enable row level security;

drop policy if exists "Users manage own events" on public.calendar_events;
create policy "Users manage own events" on public.calendar_events for all using (auth.uid() = user_id);

drop policy if exists "Users manage own plans" on public.outfit_plans;
create policy "Users manage own plans" on public.outfit_plans for all using (auth.uid() = user_id);
