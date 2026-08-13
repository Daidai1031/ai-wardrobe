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
  lat         numeric,                  -- geocoded once from `city` via geocodeCity() on profile save, not re-derived per weather call
  lng         numeric,
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
  display_name  text,                   -- user-authored detailed/product name; authoritative in UI + prompts
  user_notes    text,                   -- fit, provenance, comfort, styling constraints, etc.
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
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  outfit_id       uuid references public.outfits(id) on delete set null,
  plan_segment_id uuid,       -- FK is added after outfit_plan_segments is created below
  item_ids        uuid[] not null default '{}', -- immutable snapshot of what was actually worn
  worn_date       date not null,
  event_name      text,       -- "Board Meeting", "Conference Day 1"
  event_type      text,       -- meeting, presentation, networking, casual, etc.
  notes           text,
  created_at      timestamptz default now()
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
  destination_lat numeric,              -- geocoded once from `destination` via geocodeCity() on trip creation
  destination_lng numeric,
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
  location_override text,
  weather_city    text,
  weather_lat     numeric,
  weather_lng     numeric,
  weather_timezone text,
  weather_city_override text,
  weather_lat_override numeric,
  weather_lng_override numeric,
  weather_timezone_override text,
  weather_location_resolved boolean not null default false,
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
-- 12. OUTFIT PLANS (unified daily/weekly/travel plans — Phase 6.0 / 6.1)
-- ============================================================
-- One parent row represents one local date. A date can contain any number of
-- ordered segments, and each segment owns an ordered set of wardrobe items.
create table public.outfit_plans (
  id             uuid primary key default uuid_generate_v4(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  plan_date      date not null,        -- D4: local date of the plan's location
  source         text not null check (source in ('daily','weekly','travel')),
  travel_plan_id uuid references public.travel_plans(id) on delete cascade,
  gap            text,
  weather        jsonb default '{}',
  status         text default 'suggested' check (status in ('suggested','accepted','rejected','worn')),
  generated_at   timestamptz default now(),  -- D9: rate-limiting regeneration
  created_at     timestamptz default now(),
  updated_at     timestamptz default now(),
  constraint outfit_plans_source_travel_check check (
    (source = 'travel' and travel_plan_id is not null)
    or (source <> 'travel' and travel_plan_id is null)
  ),
  -- `nulls not distinct` is required: ordinary UNIQUE allows duplicate daily/
  -- weekly rows because their travel_plan_id is NULL.
  constraint outfit_plans_cache_key unique nulls not distinct
    (user_id, plan_date, source, travel_plan_id)
);

create index idx_plans_user_date on public.outfit_plans(user_id, plan_date);

create table public.outfit_plan_segments (
  id                   uuid primary key default uuid_generate_v4(),
  outfit_plan_id       uuid not null references public.outfit_plans(id) on delete cascade,
  position             int not null check (position >= 0),
  label                text not null,
  reasoning            text not null default '',
  change_from_previous text,
  event_ids            uuid[] not null default '{}',
  saved_outfit_id      uuid references public.outfits(id) on delete set null,
  source_outfit_id     uuid references public.outfits(id) on delete set null,
  created_at           timestamptz default now(),
  updated_at           timestamptz default now(),
  unique (outfit_plan_id, position)
);

create index idx_plan_segments_plan on public.outfit_plan_segments(outfit_plan_id, position);

-- x/y/width mirror outfit_items: normalized freeform Canvas geometry (percent of
-- the canvas), null until the user actually arranges the segment, in which case
-- the UI falls back to a deterministic default grid. Generated plans always start
-- null — only a human Canvas edit produces layout.
create table public.outfit_plan_segment_items (
  segment_id uuid not null references public.outfit_plan_segments(id) on delete cascade,
  item_id    uuid not null references public.wardrobe_items(id) on delete cascade,
  position   int not null check (position >= 0),
  x          numeric,
  y          numeric,
  width      numeric,
  created_at timestamptz default now(),
  primary key (segment_id, item_id),
  unique (segment_id, position)
);

create index idx_plan_segment_items_item on public.outfit_plan_segment_items(item_id);

alter table public.outfit_journal
  add constraint outfit_journal_plan_segment_id_fkey
  foreign key (plan_segment_id) references public.outfit_plan_segments(id) on delete set null;

create unique index idx_journal_plan_segment
  on public.outfit_journal(plan_segment_id)
  where plan_segment_id is not null;

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
alter table public.outfit_plan_segments enable row level security;
alter table public.outfit_plan_segment_items enable row level security;

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
create policy "Users manage own journal" on public.outfit_journal for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

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
create policy "Users manage own plans" on public.outfit_plans for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage own plan segments" on public.outfit_plan_segments for all
  using (
    exists (
      select 1
      from public.outfit_plans
      where outfit_plans.id = outfit_plan_segments.outfit_plan_id
        and outfit_plans.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.outfit_plans
      where outfit_plans.id = outfit_plan_segments.outfit_plan_id
        and outfit_plans.user_id = auth.uid()
    )
  );

create policy "Users manage own plan segment items" on public.outfit_plan_segment_items for all
  using (
    exists (
      select 1
      from public.outfit_plan_segments
      join public.outfit_plans
        on outfit_plans.id = outfit_plan_segments.outfit_plan_id
      where outfit_plan_segments.id = outfit_plan_segment_items.segment_id
        and outfit_plans.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.outfit_plan_segments
      join public.outfit_plans
        on outfit_plans.id = outfit_plan_segments.outfit_plan_id
      where outfit_plan_segments.id = outfit_plan_segment_items.segment_id
        and outfit_plans.user_id = auth.uid()
    )
  );

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
-- 15. MIGRATIONS + DATABASE FUNCTIONS
-- ============================================================
-- This repo has no migration tooling. For an existing production DB, DO NOT
-- re-run sections 1-14; copy-paste and run THIS section 15 block. For a fresh DB,
-- run the whole file so the shared RPC functions in 15d are installed too.
-- This section is safe to re-run as a unit:
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
alter table public.wardrobe_items add column if not exists display_name text;
alter table public.wardrobe_items add column if not exists user_notes text;

-- 15a-2. Weather provider lat/lng caching (Phase 6.0-E follow-up): geocoded once via
--        geocodeCity() when the user saves a city / creates a trip, not per weather call.
alter table public.profiles      add column if not exists lat numeric;
alter table public.profiles      add column if not exists lng numeric;
alter table public.travel_plans  add column if not exists destination_lat numeric;
alter table public.travel_plans  add column if not exists destination_lng numeric;

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
  location_override text,
  weather_city    text,
  weather_lat     numeric,
  weather_lng     numeric,
  weather_timezone text,
  weather_city_override text,
  weather_lat_override numeric,
  weather_lng_override numeric,
  weather_timezone_override text,
  weather_location_resolved boolean not null default false,
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
  gap            text,
  weather        jsonb default '{}',
  status         text default 'suggested' check (status in ('suggested','accepted','rejected','worn')),
  generated_at   timestamptz default now(),
  created_at     timestamptz default now(),
  updated_at     timestamptz default now(),
  constraint outfit_plans_source_travel_check check (
    (source = 'travel' and travel_plan_id is not null)
    or (source <> 'travel' and travel_plan_id is null)
  ),
  -- One plan per (user, local date). `source` is NOT part of this key: it records
  -- how the plan was produced, not which plan a date has. Keying on it would let a
  -- date carry both a 'daily' and a 'weekly' row -- two independent generations
  -- with different inputs and different constraints, which would show the user
  -- different outfits for the same day on /home and /plan with nothing syncing them.
  constraint outfit_plans_cache_key unique nulls not distinct
    (user_id, plan_date, travel_plan_id)
);

-- Upgrade the already-created Phase 6.0 table from one flat outfit/day to the
-- Phase 6.1 parent row. The table had no application reads/writes before this
-- migration, so the obsolete flat columns contain no production plan data.
alter table public.outfit_plans add column if not exists updated_at timestamptz default now();
alter table public.outfit_plans drop column if exists outfit_id;
alter table public.outfit_plans drop column if exists item_ids;
alter table public.outfit_plans drop column if exists reasoning;
alter table public.outfit_plans drop column if exists event_ids;
alter table public.outfit_plans
  drop constraint if exists outfit_plans_user_id_plan_date_source_travel_plan_id_key;
alter table public.outfit_plans
  drop constraint if exists outfit_plans_source_travel_check;
alter table public.outfit_plans
  add constraint outfit_plans_source_travel_check check (
    (source = 'travel' and travel_plan_id is not null)
    or (source <> 'travel' and travel_plan_id is null)
  );
-- Phase 6.2: drop `source` from the cache key so a date has exactly one plan.
-- Collapse any pre-existing duplicates first, preferring a worn row (that one is
-- history and must not be discarded) and otherwise the most recently generated.
delete from public.outfit_plans p
using public.outfit_plans q
where p.user_id = q.user_id
  and p.plan_date = q.plan_date
  and p.travel_plan_id is not distinct from q.travel_plan_id
  and p.id <> q.id
  and (
    (q.status = 'worn') > (p.status = 'worn')
    or ((q.status = 'worn') = (p.status = 'worn') and q.generated_at > p.generated_at)
    or ((q.status = 'worn') = (p.status = 'worn')
        and q.generated_at = p.generated_at and q.id > p.id)
  );

alter table public.outfit_plans
  drop constraint if exists outfit_plans_cache_key;
alter table public.outfit_plans
  add constraint outfit_plans_cache_key unique nulls not distinct
    (user_id, plan_date, travel_plan_id);

create index if not exists idx_plans_user_date on public.outfit_plans(user_id, plan_date);

create table if not exists public.outfit_plan_segments (
  id                   uuid primary key default uuid_generate_v4(),
  outfit_plan_id       uuid not null references public.outfit_plans(id) on delete cascade,
  position             int not null check (position >= 0),
  label                text not null,
  reasoning            text not null default '',
  change_from_previous text,
  event_ids            uuid[] not null default '{}',
  saved_outfit_id      uuid references public.outfits(id) on delete set null,
  source_outfit_id     uuid references public.outfits(id) on delete set null,
  created_at           timestamptz default now(),
  updated_at           timestamptz default now(),
  unique (outfit_plan_id, position)
);
create index if not exists idx_plan_segments_plan
  on public.outfit_plan_segments(outfit_plan_id, position);

create table if not exists public.outfit_plan_segment_items (
  segment_id uuid not null references public.outfit_plan_segments(id) on delete cascade,
  item_id    uuid not null references public.wardrobe_items(id) on delete cascade,
  position   int not null check (position >= 0),
  x          numeric,
  y          numeric,
  width      numeric,
  created_at timestamptz default now(),
  primary key (segment_id, item_id),
  unique (segment_id, position)
);
create index if not exists idx_plan_segment_items_item
  on public.outfit_plan_segment_items(item_id);

-- Phase 6.1 收尾: freeform Canvas geometry for a plan segment, same shape as
-- outfit_items.x/y/width so saving a segment to Looks carries the collage over.
alter table public.outfit_plan_segment_items add column if not exists x numeric;
alter table public.outfit_plan_segment_items add column if not exists y numeric;
alter table public.outfit_plan_segment_items add column if not exists width numeric;

alter table public.outfit_journal
  add column if not exists plan_segment_id uuid;
alter table public.outfit_journal
  add column if not exists item_ids uuid[] not null default '{}';
alter table public.outfit_journal
  drop constraint if exists outfit_journal_plan_segment_id_fkey;
alter table public.outfit_journal
  add constraint outfit_journal_plan_segment_id_fkey
  foreign key (plan_segment_id) references public.outfit_plan_segments(id) on delete set null;
create unique index if not exists idx_journal_plan_segment
  on public.outfit_journal(plan_segment_id)
  where plan_segment_id is not null;

-- 15c. RLS for the new tables.
-- google_connections: RLS ON, NO policy → client denied entirely; service role only.
alter table public.google_connections enable row level security;
alter table public.calendar_events    enable row level security;
alter table public.outfit_plans        enable row level security;
alter table public.outfit_plan_segments enable row level security;
alter table public.outfit_plan_segment_items enable row level security;

drop policy if exists "Users manage own events" on public.calendar_events;
create policy "Users manage own events" on public.calendar_events for all using (auth.uid() = user_id);

drop policy if exists "Users manage own plans" on public.outfit_plans;
create policy "Users manage own plans" on public.outfit_plans for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users manage own plan segments" on public.outfit_plan_segments;
create policy "Users manage own plan segments" on public.outfit_plan_segments for all
  using (
    exists (
      select 1
      from public.outfit_plans
      where outfit_plans.id = outfit_plan_segments.outfit_plan_id
        and outfit_plans.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.outfit_plans
      where outfit_plans.id = outfit_plan_segments.outfit_plan_id
        and outfit_plans.user_id = auth.uid()
    )
  );

drop policy if exists "Users manage own plan segment items" on public.outfit_plan_segment_items;
create policy "Users manage own plan segment items" on public.outfit_plan_segment_items for all
  using (
    exists (
      select 1
      from public.outfit_plan_segments
      join public.outfit_plans
        on outfit_plans.id = outfit_plan_segments.outfit_plan_id
      where outfit_plan_segments.id = outfit_plan_segment_items.segment_id
        and outfit_plans.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.outfit_plan_segments
      join public.outfit_plans
        on outfit_plans.id = outfit_plan_segments.outfit_plan_id
      where outfit_plan_segments.id = outfit_plan_segment_items.segment_id
        and outfit_plans.user_id = auth.uid()
    )
  );

drop policy if exists "Users manage own journal" on public.outfit_journal;
create policy "Users manage own journal" on public.outfit_journal for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- 15d. Atomic plan replacement, segment regeneration/saving, Canvas edits, and
-- Worn-today confirmation. Supabase JS does not expose multi-statement
-- transactions, so these workflows enter through security-invoker functions and
-- remain covered by RLS.

-- Shared item-writing helper. Every path that rewrites a segment's items goes
-- through this so the three tricky parts live in exactly one place:
--   1. (segment_id, position) is unique and NOT deferrable, so renumbering in
--      place can transiently collide -- surviving rows are parked at +1000 first.
--   2. Ownership is enforced by joining wardrobe_items on the caller's user_id;
--      a foreign or non-existent id simply fails to join and trips the count check.
--   3. Canvas geometry must survive item edits. Only an explicit Canvas save
--      (p_apply_layout) writes x/y/width; every other path leaves whatever the
--      user already arranged untouched.
-- Accepts either a plain ["<uuid>", ...] array or the richer Canvas form
-- [{"itemId": "...", "x": 0, "y": 0, "width": 28}, ...], so the generation path
-- never has to know layout exists.
create or replace function public.apply_plan_segment_items(
  p_segment_id uuid,
  p_items jsonb,
  p_user_id uuid,
  p_apply_layout boolean
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_requested jsonb;
  v_requested_count int;
  v_distinct_count int;
  v_written_count int;
begin
  select coalesce(
    jsonb_agg(
      case
        when jsonb_typeof(entry.value) = 'object' then entry.value
        else jsonb_build_object('itemId', entry.value #>> '{}')
      end
      order by entry.ordinality
    ),
    '[]'::jsonb
  )
  into v_requested
  from jsonb_array_elements(p_items) with ordinality as entry(value, ordinality);

  v_requested_count := jsonb_array_length(v_requested);

  select count(distinct entry.value ->> 'itemId')
  into v_distinct_count
  from jsonb_array_elements(v_requested) entry(value);

  -- on conflict do update cannot touch the same row twice, and a duplicate here
  -- would silently mean "worn twice in one segment" anyway.
  if v_distinct_count <> v_requested_count then
    raise exception 'A segment cannot contain the same item twice';
  end if;

  update public.outfit_plan_segment_items
  set position = position + 1000
  where segment_id = p_segment_id;

  delete from public.outfit_plan_segment_items
  where segment_id = p_segment_id
    and item_id not in (
      select (entry.value ->> 'itemId')::uuid
      from jsonb_array_elements(v_requested) entry(value)
    );

  insert into public.outfit_plan_segment_items (segment_id, item_id, position, x, y, width)
  select
    p_segment_id,
    requested.item_id,
    requested.position,
    case when p_apply_layout then requested.x else null end,
    case when p_apply_layout then requested.y else null end,
    case when p_apply_layout then requested.width else null end
  from (
    select
      (entry.value ->> 'itemId')::uuid   as item_id,
      (entry.ordinality - 1)::int        as position,
      (entry.value ->> 'x')::numeric     as x,
      (entry.value ->> 'y')::numeric     as y,
      (entry.value ->> 'width')::numeric as width
    from jsonb_array_elements(v_requested) with ordinality as entry(value, ordinality)
  ) requested
  join public.wardrobe_items
    on wardrobe_items.id = requested.item_id
   and wardrobe_items.user_id = p_user_id
  on conflict (segment_id, item_id) do update
  set
    position = excluded.position,
    x        = case when p_apply_layout then excluded.x     else outfit_plan_segment_items.x     end,
    y        = case when p_apply_layout then excluded.y     else outfit_plan_segment_items.y     end,
    width    = case when p_apply_layout then excluded.width else outfit_plan_segment_items.width end;

  get diagnostics v_written_count = row_count;
  if v_written_count <> v_requested_count then
    raise exception 'A segment contains an invalid wardrobe item';
  end if;
end;
$$;

create or replace function public.replace_outfit_plan(
  p_plan_date date,
  p_source text,
  p_travel_plan_id uuid,
  p_gap text,
  p_weather jsonb,
  p_segments jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_plan_id uuid;
  v_segment jsonb;
  v_segment_id uuid;
  v_segment_position int;
begin
  if v_user_id is null then
    raise exception 'Unauthorized';
  end if;

  if p_source not in ('daily', 'weekly', 'travel') then
    raise exception 'Invalid plan source';
  end if;

  if (p_source = 'travel' and p_travel_plan_id is null)
    or (p_source <> 'travel' and p_travel_plan_id is not null) then
    raise exception 'travel_plan_id does not match plan source';
  end if;

  if coalesce(jsonb_typeof(p_segments), 'null') <> 'array'
    or jsonb_array_length(p_segments) = 0 then
    raise exception 'A plan must contain at least one segment';
  end if;

  if p_source = 'travel' and not exists (
    select 1
    from public.travel_plans
    where travel_plans.id = p_travel_plan_id
      and travel_plans.user_id = v_user_id
  ) then
    raise exception 'Travel plan not found';
  end if;

  insert into public.outfit_plans (
    user_id,
    plan_date,
    source,
    travel_plan_id,
    gap,
    weather,
    status,
    generated_at,
    updated_at
  )
  values (
    v_user_id,
    p_plan_date,
    p_source,
    p_travel_plan_id,
    nullif(p_gap, ''),
    coalesce(p_weather, '{}'::jsonb),
    'suggested',
    now(),
    now()
  )
  on conflict on constraint outfit_plans_cache_key
  do update set
    -- `source` is no longer part of the key, so an existing row must be retagged:
    -- a week generation taking over a day previously planned ad hoc becomes
    -- 'weekly', and regenerating one day from /home turns it back into 'daily'
    -- because it is no longer bound by the week's cross-day constraints.
    source = excluded.source,
    gap = excluded.gap,
    weather = excluded.weather,
    status = 'suggested',
    generated_at = now(),
    updated_at = now()
  returning id into v_plan_id;

  delete from public.outfit_plan_segments
  where outfit_plan_id = v_plan_id;

  for v_segment, v_segment_position in
    select entry.value, (entry.ordinality - 1)::int
    from jsonb_array_elements(p_segments) with ordinality as entry(value, ordinality)
  loop
    if coalesce(jsonb_typeof(v_segment -> 'itemIds'), 'null') <> 'array'
      or jsonb_array_length(v_segment -> 'itemIds') = 0 then
      raise exception 'Every segment must contain at least one item';
    end if;

    insert into public.outfit_plan_segments (
      outfit_plan_id,
      position,
      label,
      reasoning,
      change_from_previous,
      event_ids
    )
    values (
      v_plan_id,
      v_segment_position,
      coalesce(nullif(v_segment ->> 'label', ''), 'Outfit'),
      coalesce(v_segment ->> 'reasoning', ''),
      nullif(v_segment ->> 'changeFromPrevious', ''),
      coalesce(
        (
          select array_agg(requested.event_id order by requested.ordinality)
          from (
            select value::uuid as event_id, ordinality
            from jsonb_array_elements_text(
              coalesce(v_segment -> 'eventIds', '[]'::jsonb)
            ) with ordinality
          ) requested
          join public.calendar_events
            on calendar_events.id = requested.event_id
           and calendar_events.user_id = v_user_id
        ),
        '{}'::uuid[]
      )
    )
    returning id into v_segment_id;

    -- A freshly inserted segment has no rows yet, so there is no layout to keep.
    perform public.apply_plan_segment_items(
      v_segment_id, v_segment -> 'itemIds', v_user_id, false
    );
  end loop;

  return v_plan_id;
end;
$$;

-- Write a whole week in one transaction (Phase 6.2). A partial week is worse than
-- no week: the cross-day constraints that justify weekly planning at all (a
-- statement piece not repeating inside 7 days, laundry realism) only hold if every
-- day lands together.
--
-- Days already marked worn are skipped rather than overwritten -- that row records
-- what the user actually wore, and a plan generated afterwards must not rewrite
-- history. The skipped dates are returned so the UI can explain why a day was left
-- alone instead of appearing to have silently failed.
create or replace function public.replace_weekly_plans(p_days jsonb)
returns date[]
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_day jsonb;
  v_plan_date date;
  v_skipped date[] := '{}';
begin
  if v_user_id is null then
    raise exception 'Unauthorized';
  end if;

  if coalesce(jsonb_typeof(p_days), 'null') <> 'array'
    or jsonb_array_length(p_days) = 0 then
    raise exception 'A weekly plan must contain at least one day';
  end if;

  for v_day in select value from jsonb_array_elements(p_days)
  loop
    v_plan_date := (v_day ->> 'planDate')::date;

    if exists (
      select 1
      from public.outfit_plans
      where user_id = v_user_id
        and plan_date = v_plan_date
        and travel_plan_id is null
        and status = 'worn'
    ) then
      v_skipped := v_skipped || v_plan_date;
      continue;
    end if;

    perform public.replace_outfit_plan(
      v_plan_date,
      'weekly',
      null,
      v_day ->> 'gap',
      coalesce(v_day -> 'weather', '{}'::jsonb),
      coalesce(v_day -> 'segments', '[]'::jsonb)
    );
  end loop;

  return v_skipped;
end;
$$;

create or replace function public.mark_outfit_plan_worn(
  p_plan_id uuid,
  p_segments jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_plan public.outfit_plans%rowtype;
  v_segment public.outfit_plan_segments%rowtype;
  v_payload_segment jsonb;
  v_segment_id uuid;
  v_item_ids uuid[];
  v_all_item_ids uuid[];
  v_journal_outfit_id uuid;
  v_now timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'Unauthorized';
  end if;

  -- No `source` filter (Phase 6.2): a date has exactly one plan, and confirming
  -- what was worn is about the day, not about how the plan happened to be produced.
  -- Restricting to 'daily' here would make a day taken over by a week plan
  -- unconfirmable from /home.
  select *
  into v_plan
  from public.outfit_plans
  where id = p_plan_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Plan not found';
  end if;

  if v_plan.status = 'worn' then
    raise exception 'This plan is already marked as worn';
  end if;

  if coalesce(jsonb_typeof(p_segments), 'null') <> 'array'
    or jsonb_array_length(p_segments) = 0 then
    raise exception 'Worn confirmation requires every segment';
  end if;

  if jsonb_array_length(p_segments) <> (
    select count(*)
    from public.outfit_plan_segments
    where outfit_plan_id = p_plan_id
  ) or (
    select count(distinct (entry.value ->> 'segmentId'))
    from jsonb_array_elements(p_segments) entry(value)
  ) <> jsonb_array_length(p_segments) then
    raise exception 'Worn confirmation must include every segment exactly once';
  end if;

  for v_payload_segment in
    select value
    from jsonb_array_elements(p_segments)
  loop
    v_segment_id := (v_payload_segment ->> 'segmentId')::uuid;

    select *
    into v_segment
    from public.outfit_plan_segments
    where id = v_segment_id
      and outfit_plan_id = p_plan_id;

    if not found then
      raise exception 'A segment does not belong to this plan';
    end if;

    if coalesce(jsonb_typeof(v_payload_segment -> 'itemIds'), 'null') <> 'array'
      or jsonb_array_length(v_payload_segment -> 'itemIds') = 0 then
      raise exception 'Every worn segment must contain at least one item';
    end if;

    -- Confirming what was actually worn must not discard the Canvas arrangement.
    perform public.apply_plan_segment_items(
      v_segment_id, v_payload_segment -> 'itemIds', v_user_id, false
    );

    select array_agg(item_id order by position)
    into v_item_ids
    from public.outfit_plan_segment_items
    where segment_id = v_segment_id;

    v_journal_outfit_id := null;
    if v_segment.saved_outfit_id is not null
      and (
        select array_agg(item_id order by item_id)
        from public.outfit_items
        where outfit_id = v_segment.saved_outfit_id
      ) = (
        select array_agg(item_id order by item_id)
        from unnest(v_item_ids) item_id
      ) then
      v_journal_outfit_id := v_segment.saved_outfit_id;
    end if;

    insert into public.outfit_journal (
      user_id,
      outfit_id,
      plan_segment_id,
      item_ids,
      worn_date,
      event_name
    )
    values (
      v_user_id,
      v_journal_outfit_id,
      v_segment_id,
      v_item_ids,
      v_plan.plan_date,
      v_segment.label
    );
  end loop;

  -- Count a physical item once for the whole local day even if it appears in
  -- several segments (for example, the same blazer from morning through dinner).
  select array_agg(distinct segment_items.item_id)
  into v_all_item_ids
  from public.outfit_plan_segment_items segment_items
  join public.outfit_plan_segments segments
    on segments.id = segment_items.segment_id
  where segments.outfit_plan_id = p_plan_id;

  update public.wardrobe_items
  set
    times_worn = coalesce(times_worn, 0) + 1,
    last_worn_at = v_now,
    updated_at = v_now
  where user_id = v_user_id
    and id = any(v_all_item_ids);

  update public.outfit_plans
  set
    status = 'worn',
    updated_at = v_now
  where id = p_plan_id;
end;
$$;

create or replace function public.save_outfit_plan_segment(
  p_segment_id uuid,
  p_item_ids jsonb,
  p_name text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_segment public.outfit_plan_segments%rowtype;
  v_outfit_id uuid;
  v_now timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'Unauthorized';
  end if;

  select segments.*
  into v_segment
  from public.outfit_plan_segments segments
  join public.outfit_plans plans
    on plans.id = segments.outfit_plan_id
  where segments.id = p_segment_id
    and plans.user_id = v_user_id
  for update of segments;

  if not found then
    raise exception 'Plan segment not found';
  end if;

  if v_segment.saved_outfit_id is not null then
    return v_segment.saved_outfit_id;
  end if;

  if coalesce(jsonb_typeof(p_item_ids), 'null') <> 'array'
    or jsonb_array_length(p_item_ids) < 2 then
    raise exception 'At least two items are required to save an outfit';
  end if;

  perform public.apply_plan_segment_items(p_segment_id, p_item_ids, v_user_id, false);

  insert into public.outfits (
    user_id,
    name,
    folder,
    ai_generated,
    ai_reasoning,
    created_at,
    updated_at
  )
  values (
    v_user_id,
    coalesce(nullif(p_name, ''), v_segment.label),
    'Everyday',
    true,
    nullif(v_segment.reasoning, ''),
    v_now,
    v_now
  )
  returning id into v_outfit_id;

  -- Carry the segment's Canvas geometry into the saved Look so reopening it in
  -- /outfits shows the same collage the user arranged on /home. Null x/y/width
  -- means the segment was never arranged; outfits-view falls back to its default
  -- grid for those, exactly as it does for pre-layout outfits.
  insert into public.outfit_items (outfit_id, item_id, position, x, y, width)
  select v_outfit_id, item_id, position, x, y, width
  from public.outfit_plan_segment_items
  where segment_id = p_segment_id
  order by position;

  update public.outfit_plan_segments
  set
    saved_outfit_id = v_outfit_id,
    source_outfit_id = v_outfit_id,
    updated_at = v_now
  where id = p_segment_id;

  return v_outfit_id;
end;
$$;

-- Persist a Canvas edit of one segment: the item set AND its freeform geometry.
-- Without this the /home Canvas would be throwaway client state -- a refresh
-- re-reads the plan from the database and would discard the arrangement.
-- p_items is the Canvas form: [{"itemId": "...", "x": 0, "y": 0, "width": 28}, ...]
create or replace function public.update_outfit_plan_segment_items(
  p_segment_id uuid,
  p_items jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_plan public.outfit_plans%rowtype;
begin
  if v_user_id is null then
    raise exception 'Unauthorized';
  end if;

  select plans.*
  into v_plan
  from public.outfit_plans plans
  join public.outfit_plan_segments segments
    on segments.outfit_plan_id = plans.id
  where segments.id = p_segment_id
    and plans.user_id = v_user_id
  for update of plans;

  if not found then
    raise exception 'Plan segment not found';
  end if;

  if v_plan.status = 'worn' then
    raise exception 'This plan is already marked as worn';
  end if;

  if coalesce(jsonb_typeof(p_items), 'null') <> 'array'
    or jsonb_array_length(p_items) = 0 then
    raise exception 'A segment must contain at least one item';
  end if;

  perform public.apply_plan_segment_items(p_segment_id, p_items, v_user_id, true);

  -- The already-saved Look is a snapshot of the pre-edit segment, so it no
  -- longer represents this segment. Drop the link (the Look itself is left
  -- alone in the library) so the user can save the edited version.
  update public.outfit_plan_segments
  set source_outfit_id = coalesce(source_outfit_id, saved_outfit_id),
      saved_outfit_id = null,
      updated_at = now()
  where id = p_segment_id;

  update public.outfit_plans
  set updated_at = now()
  where id = v_plan.id;
end;
$$;

-- Regenerate ONE segment instead of the whole day (Phase 6.1 收尾). Rerunning the
-- whole plan to fix a single bad segment discards the good ones and costs a full
-- generation, so this replaces just the target segment in place.
-- p_next_change_from_previous updates the FOLLOWING segment's "what changed"
-- line, which would otherwise describe an outfit that no longer exists -- the
-- model returns it in the same call, so keeping it accurate costs nothing extra.
create or replace function public.regenerate_outfit_plan_segment(
  p_segment_id uuid,
  p_label text,
  p_reasoning text,
  p_change_from_previous text,
  p_event_ids jsonb,
  p_item_ids jsonb,
  p_next_change_from_previous text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_plan public.outfit_plans%rowtype;
  v_segment public.outfit_plan_segments%rowtype;
  v_now timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'Unauthorized';
  end if;

  select segments.*
  into v_segment
  from public.outfit_plan_segments segments
  join public.outfit_plans plans
    on plans.id = segments.outfit_plan_id
  where segments.id = p_segment_id
    and plans.user_id = v_user_id
  for update of segments;

  if not found then
    raise exception 'Plan segment not found';
  end if;

  select *
  into v_plan
  from public.outfit_plans
  where id = v_segment.outfit_plan_id
  for update;

  if v_plan.status = 'worn' then
    raise exception 'This plan is already marked as worn';
  end if;

  if coalesce(jsonb_typeof(p_item_ids), 'null') <> 'array'
    or jsonb_array_length(p_item_ids) = 0 then
    raise exception 'A segment must contain at least one item';
  end if;

  -- Brand new items, so any previous Canvas arrangement is meaningless: pass
  -- p_apply_layout = true with layout-free ids to reset x/y/width to null.
  perform public.apply_plan_segment_items(p_segment_id, p_item_ids, v_user_id, true);

  update public.outfit_plan_segments
  set
    label = coalesce(nullif(p_label, ''), v_segment.label),
    reasoning = coalesce(p_reasoning, ''),
    change_from_previous = nullif(p_change_from_previous, ''),
    event_ids = coalesce(
      (
        select array_agg(requested.event_id order by requested.ordinality)
        from (
          select value::uuid as event_id, ordinality
          from jsonb_array_elements_text(coalesce(p_event_ids, '[]'::jsonb)) with ordinality
        ) requested
        join public.calendar_events
          on calendar_events.id = requested.event_id
         and calendar_events.user_id = v_user_id
      ),
      '{}'::uuid[]
    ),
    -- Same reasoning as update_outfit_plan_segment_items: the saved Look is a
    -- snapshot of an outfit this segment no longer proposes.
    saved_outfit_id = null,
    source_outfit_id = null,
    updated_at = v_now
  where id = p_segment_id;

  if p_next_change_from_previous is not null then
    update public.outfit_plan_segments
    set change_from_previous = nullif(p_next_change_from_previous, ''), updated_at = v_now
    where outfit_plan_id = v_segment.outfit_plan_id
      and position = v_segment.position + 1;
  end if;

  -- D9 rate limiting counts a single-segment redo as a generation too.
  update public.outfit_plans
  set generated_at = v_now, updated_at = v_now, status = 'suggested'
  where id = v_segment.outfit_plan_id;
end;
$$;

revoke execute on function public.apply_plan_segment_items(uuid, jsonb, uuid, boolean)
  from public, anon;
grant execute on function public.apply_plan_segment_items(uuid, jsonb, uuid, boolean)
  to authenticated;

revoke execute on function public.update_outfit_plan_segment_items(uuid, jsonb)
  from public, anon;
grant execute on function public.update_outfit_plan_segment_items(uuid, jsonb)
  to authenticated;

revoke execute on function public.regenerate_outfit_plan_segment(uuid, text, text, text, jsonb, jsonb, text)
  from public, anon;
grant execute on function public.regenerate_outfit_plan_segment(uuid, text, text, text, jsonb, jsonb, text)
  to authenticated;

revoke execute on function public.replace_outfit_plan(date, text, uuid, text, jsonb, jsonb)
  from public, anon;
grant execute on function public.replace_outfit_plan(date, text, uuid, text, jsonb, jsonb)
  to authenticated;

revoke execute on function public.replace_weekly_plans(jsonb)
  from public, anon;
grant execute on function public.replace_weekly_plans(jsonb)
  to authenticated;

revoke execute on function public.mark_outfit_plan_worn(uuid, jsonb)
  from public, anon;
grant execute on function public.mark_outfit_plan_worn(uuid, jsonb)
  to authenticated;

revoke execute on function public.save_outfit_plan_segment(uuid, jsonb, text)
  from public, anon;
grant execute on function public.save_outfit_plan_segment(uuid, jsonb, text)
  to authenticated;

-- ============================================================
-- 16. HUMAN STYLIST BOOKINGS
-- Re-runnable against an existing database. Availability is generated from the
-- service schedule in /api/stylist/bookings; this table is the source of truth
-- for occupied intervals. The exclusion constraint prevents two requests from
-- racing into overlapping bookings, including a full in-person day colliding
-- with one or more 30-minute online slots.
-- ============================================================
create table if not exists public.stylist_bookings (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  service_type text not null check (service_type in ('online_30', 'in_person_day')),
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  timezone     text not null,
  status       text not null default 'confirmed'
               check (status in ('confirmed', 'cancelled')),
  notes        text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  constraint stylist_bookings_valid_interval check (ends_at > starts_at),
  constraint stylist_bookings_no_overlap
    exclude using gist (
      tstzrange(starts_at, ends_at, '[)') with &&
    )
    where (status = 'confirmed')
);

create index if not exists idx_stylist_bookings_user_start
  on public.stylist_bookings(user_id, starts_at);

-- `create table if not exists` cannot add a constraint to a pre-existing table.
-- Keep the race-proof overlap guard present when this section is re-run.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'stylist_bookings_no_overlap'
      and conrelid = 'public.stylist_bookings'::regclass
  ) then
    alter table public.stylist_bookings
      add constraint stylist_bookings_no_overlap
      exclude using gist (
        tstzrange(starts_at, ends_at, '[)') with &&
      )
      where (status = 'confirmed');
  end if;
end
$$;

alter table public.stylist_bookings enable row level security;

drop policy if exists "Users read own stylist bookings" on public.stylist_bookings;
create policy "Users read own stylist bookings"
  on public.stylist_bookings for select
  using (auth.uid() = user_id);

-- There is deliberately no client insert/update/delete policy. The authenticated
-- booking route validates offered slots, checks the global calendar through the
-- service role, and writes on the caller's behalf. Direct browser writes are denied.

-- Consultation access window (set by n8n via /api/webhooks/consult-ended)
alter table public.profiles
  add column if not exists access_expires_at timestamptz;

-- ============================================================
-- 17. WARDROBE ITEM PHOTOS (extra reference angles)
-- Re-runnable against an existing database.
--
-- Deliberately a separate table rather than more columns on wardrobe_items:
-- these are *reference* photos (back, side, detail, care tag) a user adds from
-- the item detail page, and every styling path — the Canvas, selectCandidates,
-- the stylist and plan prompts — reads wardrobe_items.clean_url / original_url
-- only. Keeping the extra angles off that row means no styling code has to
-- learn to ignore them; they simply aren't reachable from there.
--
-- No AI runs on these: no detection, no background removal, no classification.
-- The item's own classification stays authoritative.
-- ============================================================
create table if not exists public.wardrobe_item_photos (
  id           uuid primary key default uuid_generate_v4(),
  item_id      uuid not null references public.wardrobe_items(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  url          text not null,   -- public Storage URL, as uploaded (no clean version)
  storage_path text,            -- kept so deleting a photo can also drop the object
  angle        text,            -- optional free-text label: back, side, detail, tag
  position     int not null default 0,
  created_at   timestamptz default now()
);

create index if not exists idx_item_photos_item
  on public.wardrobe_item_photos(item_id, position);

alter table public.wardrobe_item_photos enable row level security;

drop policy if exists "Users read own item photos"   on public.wardrobe_item_photos;
drop policy if exists "Users insert own item photos" on public.wardrobe_item_photos;
drop policy if exists "Users update own item photos" on public.wardrobe_item_photos;
drop policy if exists "Users delete own item photos" on public.wardrobe_item_photos;

create policy "Users read own item photos"
  on public.wardrobe_item_photos for select using (auth.uid() = user_id);
create policy "Users insert own item photos"
  on public.wardrobe_item_photos for insert with check (auth.uid() = user_id);
create policy "Users update own item photos"
  on public.wardrobe_item_photos for update using (auth.uid() = user_id);
create policy "Users delete own item photos"
  on public.wardrobe_item_photos for delete using (auth.uid() = user_id);

-- ============================================================
-- 18. STYLIST REVIEW & SUGGESTIONS (Phase 10-A)
-- Re-runnable against an existing database.
--
-- A human stylist reviews a client's wardrobe and Looks, rates them, writes a
-- note, and optionally re-arranges the outfit on the shared Canvas. What she
-- saves is a *proposal*: it never touches the client's own rows until the client
-- accepts. See ROADMAP decisions D15/D16/D17 and section "Phase 10-A".
-- ============================================================

-- 18a. Access gate (D16). Only one stylist exists, so there is deliberately no
--      wardrobe_grants table: every row's stylist_id would carry the same value.
--      The window itself is already maintained by the automation webhook
--      (/api/webhooks/consult-ended writes profiles.access_expires_at, D14), and
--      the client can end it early from /profile by setting it to now().
--
-- security definer is required, not a style choice: this function is called from
-- a policy ON public.profiles and itself reads public.profiles. As an invoker
-- function that policy would recurse. Definer runs as the owner, so the inner
-- reads are not re-filtered.
create or replace function public.stylist_can_view(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_client_id is not null
    and auth.uid() is not null
    and auth.uid() <> p_client_id
    and exists (
      select 1 from public.profiles viewer
      where viewer.id = auth.uid()
        and 'stylist' = any(coalesce(viewer.roles, '{}'))
    )
    and exists (
      select 1 from public.profiles client
      where client.id = p_client_id
        and client.access_expires_at is not null
        and client.access_expires_at > now()
    );
$$;

-- 18b. Read access for the stylist. This is a WHITELIST, one extra permissive
--      SELECT policy per table she legitimately needs. Tables NOT listed here --
--      calendar_events, google_connections, outfit_journal, outfit_plans and its
--      segment tables -- stay unreachable, and so does any table added later.
--      Missing a table is safe; adding one by reflex is not (D13/D17).
--
--      Occasion projection and plan segments reach her through a server route
--      that reads with the service role and emits only enum-derived text. Raw
--      calendar rows never leave the server.
drop policy if exists "Stylist reads granted client profile" on public.profiles;
create policy "Stylist reads granted client profile"
  on public.profiles for select
  using (public.stylist_can_view(id));

drop policy if exists "Stylist reads granted client items" on public.wardrobe_items;
create policy "Stylist reads granted client items"
  on public.wardrobe_items for select
  using (public.stylist_can_view(user_id));

drop policy if exists "Stylist reads granted client outfits" on public.outfits;
create policy "Stylist reads granted client outfits"
  on public.outfits for select
  using (public.stylist_can_view(user_id));

drop policy if exists "Stylist reads granted client outfit items" on public.outfit_items;
create policy "Stylist reads granted client outfit items"
  on public.outfit_items for select
  using (
    exists (
      select 1 from public.outfits
      where outfits.id = outfit_items.outfit_id
        and public.stylist_can_view(outfits.user_id)
    )
  );

drop policy if exists "Stylist reads granted client item photos" on public.wardrobe_item_photos;
create policy "Stylist reads granted client item photos"
  on public.wardrobe_item_photos for select
  using (public.stylist_can_view(user_id));

-- 18c. Occasion sharing switches (D17). Both default to the most private state.
--      stylist_share_occasions is the L1 master switch; stylist_share_detail is
--      the per-event L2 opt-in that additionally reveals time and raw title.
alter table public.profiles
  add column if not exists stylist_share_occasions boolean not null default false;

alter table public.calendar_events
  add column if not exists stylist_share_detail boolean not null default false;

-- companion is the second enum the L1 wording is assembled from, so the phrase
-- shown to the stylist is never derived from the event title. classifyEvents()
-- fills it in the same batched call that fills occasion -- no extra model call.
alter table public.calendar_events
  add column if not exists companion text;

-- Calendar locations are enriched once during sync and cached here. Planning
-- can then fetch weather for the event city without re-geocoding on every open
-- or generation. `resolved` is true even when no reliable city was present, so
-- online/locationless events are not repeatedly sent through classification.
alter table public.calendar_events
  add column if not exists weather_city text,
  add column if not exists weather_lat numeric,
  add column if not exists weather_lng numeric,
  add column if not exists weather_timezone text,
  add column if not exists weather_location_resolved boolean not null default false;

-- A user can correct the city/region used for weather from the week planner.
-- Keep that override separate from Google's raw `location`: Calendar access is
-- read-only, and a later sync must neither claim to edit Google nor erase the
-- user's local correction. Clearing these fields restores the synced location.
alter table public.calendar_events
  add column if not exists location_override text,
  add column if not exists weather_city_override text,
  add column if not exists weather_lat_override numeric,
  add column if not exists weather_lng_override numeric,
  add column if not exists weather_timezone_override text;

-- 18d. The review itself.
create table if not exists public.stylist_reviews (
  id                uuid primary key default uuid_generate_v4(),
  client_id         uuid not null references public.profiles(id) on delete cascade,
  stylist_id        uuid not null references public.profiles(id) on delete cascade,
  target_kind       text not null
                      constraint stylist_reviews_target_kind_check
                      check (target_kind in ('outfit','plan_segment','item','new_outfit')),
  -- Exactly one of these is set; the check constraint below enforces it. All
  -- three cascade, so a Look the client deletes (or a plan segment a
  -- regeneration replaces, or a piece they remove from the closet) takes its
  -- pending suggestions with it instead of leaving the client an accept button
  -- pointing at nothing.
  target_outfit_id  uuid references public.outfits(id) on delete cascade,
  target_segment_id uuid references public.outfit_plan_segments(id) on delete cascade,
  -- 'item': a rating/comment on one piece of the closet, with no arrangement to
  -- propose (a single garment has nothing to re-arrange), which is why the
  -- target check below additionally forces has_proposal = false for this kind.
  target_item_id    uuid references public.wardrobe_items(id) on delete cascade,
  -- 'new_outfit' is the one kind with no target at all: a look the stylist built
  -- from scratch out of the client's own pieces. It doesn't exist yet, so there
  -- is nothing to point at -- accepting is what creates it.
  --
  -- The name she gave it. A look arriving in the client's Looks as "Untitled"
  -- because the proposal had nowhere to carry a name would be a worse Look than
  -- one they saved themselves, so the target check requires it for this kind.
  proposed_name     text,
  -- What accepting created, so undo can remove exactly that row and nothing else.
  -- on delete set null, not cascade: if the client later deletes the Look
  -- themselves, the record that she once proposed it should survive.
  created_outfit_id uuid references public.outfits(id) on delete set null,
  rating            int check (rating between 1 and 5),
  note              text,
  has_proposal      boolean not null default false,
  status            text not null default 'pending'
                      check (status in ('pending','accepted','declined','reverted')),
  -- Written at accept time, not at create time: [{"itemId":..,"x":..,"y":..,"width":..}].
  -- Geometry is included on purpose -- restoring only the ids would silently
  -- discard the collage the client had arranged, which is the thing undo exists
  -- to protect.
  previous_items    jsonb,
  -- Copy shown beside the target is replaced together with a proposed outfit.
  -- This snapshot also carries the target/next segment transition copy so undo
  -- restores every piece of text that acceptance invalidated.
  previous_text     jsonb,
  resolved_at       timestamptz,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  constraint stylist_reviews_target_check check (
    (target_kind = 'outfit'       and target_outfit_id  is not null and target_segment_id is null and target_item_id is null)
    or
    (target_kind = 'plan_segment' and target_segment_id is not null and target_outfit_id  is null and target_item_id is null)
    or
    (target_kind = 'item'         and target_item_id    is not null and target_outfit_id  is null and target_segment_id is null
                                  and has_proposal = false)
    or
    (target_kind = 'new_outfit'   and target_outfit_id  is null and target_segment_id is null and target_item_id is null
                                  and has_proposal = true and coalesce(proposed_name, '') <> '')
  ),
  -- A review carrying neither a score, nor words, nor a re-arrangement is not a
  -- review; it would show up in the client's inbox as an empty card.
  constraint stylist_reviews_not_empty check (
    rating is not null or coalesce(note, '') <> '' or has_proposal
  )
);

-- create table if not exists does not add columns to an existing installation,
-- and it does not widen constraints either. The block below brings an existing
-- section-18 install up to the definition above; on a fresh database it is a
-- no-op that re-states what was just created.
alter table public.stylist_reviews add column if not exists previous_text jsonb;
alter table public.stylist_reviews
  add column if not exists target_item_id uuid references public.wardrobe_items(id) on delete cascade;
alter table public.stylist_reviews add column if not exists proposed_name text;
alter table public.stylist_reviews
  add column if not exists created_outfit_id uuid references public.outfits(id) on delete set null;

alter table public.stylist_reviews drop constraint if exists stylist_reviews_target_kind_check;
alter table public.stylist_reviews add constraint stylist_reviews_target_kind_check
  check (target_kind in ('outfit','plan_segment','item','new_outfit'));

alter table public.stylist_reviews drop constraint if exists stylist_reviews_target_check;
alter table public.stylist_reviews add constraint stylist_reviews_target_check check (
  (target_kind = 'outfit'       and target_outfit_id  is not null and target_segment_id is null and target_item_id is null)
  or
  (target_kind = 'plan_segment' and target_segment_id is not null and target_outfit_id  is null and target_item_id is null)
  or
  (target_kind = 'item'         and target_item_id    is not null and target_outfit_id  is null and target_segment_id is null
                                and has_proposal = false)
  or
  (target_kind = 'new_outfit'   and target_outfit_id  is null and target_segment_id is null and target_item_id is null
                                and has_proposal = true and coalesce(proposed_name, '') <> '')
);

create index if not exists idx_stylist_reviews_client
  on public.stylist_reviews(client_id, status, created_at desc);
create index if not exists idx_stylist_reviews_outfit
  on public.stylist_reviews(target_outfit_id) where target_outfit_id is not null;
create index if not exists idx_stylist_reviews_segment
  on public.stylist_reviews(target_segment_id) where target_segment_id is not null;
create index if not exists idx_stylist_reviews_item
  on public.stylist_reviews(target_item_id) where target_item_id is not null;

-- The proposed set, structurally identical to outfit_items / outfit_plan_segment_items
-- so the arrangement she made transfers verbatim.
create table if not exists public.stylist_review_items (
  review_id  uuid not null references public.stylist_reviews(id) on delete cascade,
  item_id    uuid not null references public.wardrobe_items(id) on delete cascade,
  position   int not null check (position >= 0),
  x          numeric,
  y          numeric,
  width      numeric,
  created_at timestamptz default now(),
  primary key (review_id, item_id),
  unique (review_id, position)
);

create index if not exists idx_stylist_review_items_review
  on public.stylist_review_items(review_id, position);

-- 18e. Audit log (D16: build it now -- a log added later has no history).
create table if not exists public.wardrobe_access_log (
  id          uuid primary key default uuid_generate_v4(),
  stylist_id  uuid not null references public.profiles(id) on delete cascade,
  client_id   uuid not null references public.profiles(id) on delete cascade,
  resource    text not null,
  accessed_at timestamptz default now()
);

create index if not exists idx_wardrobe_access_log_client
  on public.wardrobe_access_log(client_id, accessed_at desc);

-- 18f. RLS. Reviews are readable by both sides and writable by neither: the
--      stylist creates them through a server route (service role) that validates
--      every proposed item against the *client's* wardrobe, and the client
--      resolves them through the security-definer RPCs below. Keeping both write
--      paths server-side means there is exactly one place ownership is checked.
alter table public.stylist_reviews      enable row level security;
alter table public.stylist_review_items enable row level security;
alter table public.wardrobe_access_log  enable row level security;

drop policy if exists "Client reads own reviews"       on public.stylist_reviews;
drop policy if exists "Stylist reads reviews she made" on public.stylist_reviews;
drop policy if exists "Client reads own review items"  on public.stylist_review_items;
drop policy if exists "Stylist reads own review items" on public.stylist_review_items;
drop policy if exists "Client reads own access log"    on public.wardrobe_access_log;

create policy "Client reads own reviews"
  on public.stylist_reviews for select using (auth.uid() = client_id);
create policy "Stylist reads reviews she made"
  on public.stylist_reviews for select using (auth.uid() = stylist_id);

create policy "Client reads own review items"
  on public.stylist_review_items for select
  using (
    exists (
      select 1 from public.stylist_reviews
      where stylist_reviews.id = stylist_review_items.review_id
        and stylist_reviews.client_id = auth.uid()
    )
  );
create policy "Stylist reads own review items"
  on public.stylist_review_items for select
  using (
    exists (
      select 1 from public.stylist_reviews
      where stylist_reviews.id = stylist_review_items.review_id
        and stylist_reviews.stylist_id = auth.uid()
    )
  );

-- The client can see who looked at their closet and when. The stylist cannot
-- read the log at all -- an audit trail whose subject can inspect it for gaps is
-- not an audit trail.
create policy "Client reads own access log"
  on public.wardrobe_access_log for select using (auth.uid() = client_id);

-- 18g. Resolving a review. security definer because these cross the line between
--      two users' rows: the review belongs to the pair, the target belongs to the
--      client. auth.uid() = client_id is checked explicitly at the top of each.
--
--      Note these deliberately bypass the plan rule engine (composition, weather,
--      rotation -- src/lib/planning/plan-rules.ts). Those rules exist to stop a
--      model from producing an unwearable look; a human stylist outranks them.

-- Snapshot a target's current items *with geometry*, in the shape previous_items
-- and the RPCs below both speak. 'item' and 'new_outfit' both yield '[]', for
-- opposite reasons: an item review is a rating and a comment on one piece and
-- never replaces anything, while a new_outfit has no prior version because the
-- Look does not exist until the client accepts it. Undo handles the latter by
-- deleting what accept created (created_outfit_id), not by restoring a snapshot.
create or replace function public.stylist_target_items(
  p_target_kind text,
  p_outfit_id uuid,
  p_segment_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select jsonb_agg(
               jsonb_build_object('itemId', t.item_id, 'x', t.x, 'y', t.y, 'width', t.width)
               order by t.position, t.item_id
             )
      from (
        select item_id, position, x, y, width
        from public.outfit_items
        where p_target_kind = 'outfit' and outfit_id = p_outfit_id
        union all
        select item_id, position, x, y, width
        from public.outfit_plan_segment_items
        where p_target_kind = 'plan_segment' and segment_id = p_segment_id
      ) t
    ),
    '[]'::jsonb
  );
$$;

-- Overwrite an outfit's items from a jsonb array of {itemId,x,y,width}. Mirrors
-- apply_plan_segment_items' contract for the outfits side, which had no shared
-- writer because until now only outfits-view.tsx ever wrote it.
create or replace function public.stylist_apply_outfit_items(
  p_outfit_id uuid,
  p_items jsonb,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested_count int := jsonb_array_length(p_items);
  v_written_count int;
begin
  delete from public.outfit_items where outfit_id = p_outfit_id;

  insert into public.outfit_items (outfit_id, item_id, position, x, y, width)
  select
    p_outfit_id,
    requested.item_id,
    requested.position,
    requested.x,
    requested.y,
    requested.width
  from (
    select
      (entry.value ->> 'itemId')::uuid   as item_id,
      (entry.ordinality - 1)::int        as position,
      (entry.value ->> 'x')::numeric     as x,
      (entry.value ->> 'y')::numeric     as y,
      (entry.value ->> 'width')::numeric as width
    from jsonb_array_elements(p_items) with ordinality as entry(value, ordinality)
  ) requested
  join public.wardrobe_items
    on wardrobe_items.id = requested.item_id
   and wardrobe_items.user_id = p_user_id;

  get diagnostics v_written_count = row_count;
  if v_written_count <> v_requested_count then
    raise exception 'The proposal contains an item that is not in this wardrobe';
  end if;

  update public.outfits set updated_at = now() where id = p_outfit_id;
end;
$$;

create or replace function public.accept_stylist_review(p_review_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_review public.stylist_reviews%rowtype;
  v_previous jsonb;
  v_previous_text jsonb;
  v_proposed jsonb;
  v_created_outfit_id uuid;
  v_now timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'Unauthorized';
  end if;

  select * into v_review
  from public.stylist_reviews
  where id = p_review_id and client_id = v_user_id
  for update;

  if not found then
    raise exception 'Review not found';
  end if;
  if v_review.status <> 'pending' then
    raise exception 'This suggestion has already been answered';
  end if;

  v_previous := public.stylist_target_items(
    v_review.target_kind, v_review.target_outfit_id, v_review.target_segment_id
  );

  if v_review.has_proposal then
    if nullif(btrim(coalesce(v_review.note, '')), '') is null then
      raise exception 'An outfit change needs an updated description';
    end if;

    select coalesce(
      jsonb_agg(
        jsonb_build_object('itemId', item_id, 'x', x, 'y', y, 'width', width)
        order by position
      ),
      '[]'::jsonb
    )
    into v_proposed
    from public.stylist_review_items
    where review_id = p_review_id;

    if jsonb_array_length(v_proposed) = 0 then
      raise exception 'This suggestion has no items to apply';
    end if;

    if v_review.target_kind = 'new_outfit' then
      -- The one kind that creates rather than overwrites. ai_generated stays false:
      -- a human built this, and /outfits badges that flag as "AI".
      insert into public.outfits (user_id, name, notes, ai_generated)
      values (v_user_id, btrim(v_review.proposed_name), btrim(v_review.note), false)
      returning id into v_created_outfit_id;

      perform public.stylist_apply_outfit_items(v_created_outfit_id, v_proposed, v_user_id);

    elsif v_review.target_kind = 'outfit' then
      select jsonb_build_object('description', notes)
      into v_previous_text
      from public.outfits
      where id = v_review.target_outfit_id and user_id = v_user_id;

      perform public.stylist_apply_outfit_items(v_review.target_outfit_id, v_proposed, v_user_id);

      update public.outfits
      set notes = btrim(v_review.note), updated_at = v_now
      where id = v_review.target_outfit_id and user_id = v_user_id;
    else
      select jsonb_build_object(
        'description', target_segment.reasoning,
        'changeFromPrevious', target_segment.change_from_previous,
        'nextSegmentId', following_segment.id,
        'nextChangeFromPrevious', following_segment.change_from_previous
      )
      into v_previous_text
      from public.outfit_plan_segments as target_segment
      left join public.outfit_plan_segments as following_segment
        on following_segment.outfit_plan_id = target_segment.outfit_plan_id
       and following_segment.position = target_segment.position + 1
      where target_segment.id = v_review.target_segment_id;

      -- p_apply_layout = true: the stylist arranged this collage on purpose, so
      -- her geometry is the point of accepting it.
      perform public.apply_plan_segment_items(v_review.target_segment_id, v_proposed, v_user_id, true);

      update public.outfit_plan_segments
      set reasoning = btrim(v_review.note),
          change_from_previous = null,
          updated_at = v_now
      where id = v_review.target_segment_id;

      -- This transition was written against the old target outfit and is no
      -- longer trustworthy. Clear it instead of displaying incorrect advice.
      update public.outfit_plan_segments as following_segment
      set change_from_previous = null, updated_at = v_now
      from public.outfit_plan_segments as target_segment
      where target_segment.id = v_review.target_segment_id
        and following_segment.outfit_plan_id = target_segment.outfit_plan_id
        and following_segment.position = target_segment.position + 1;
    end if;
  end if;

  update public.stylist_reviews
  set status = 'accepted',
      previous_items = v_previous,
      previous_text = v_previous_text,
      created_outfit_id = v_created_outfit_id,
      resolved_at = v_now,
      updated_at = v_now
  where id = p_review_id;

  return jsonb_build_object(
    'status', 'accepted',
    'previousCount', jsonb_array_length(v_previous),
    'createdOutfitId', v_created_outfit_id
  );
end;
$$;

create or replace function public.decline_stylist_review(p_review_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'Unauthorized';
  end if;

  update public.stylist_reviews
  set status = 'declined', resolved_at = v_now, updated_at = v_now
  where id = p_review_id and client_id = v_user_id and status = 'pending';

  if not found then
    raise exception 'Review not found';
  end if;
end;
$$;

-- Undo an accept. Restores the snapshot taken at accept time, geometry included.
-- Lands in 'reverted' rather than back in 'pending' so it does not reappear in
-- the inbox as an unanswered suggestion.
create or replace function public.revert_stylist_review(p_review_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_review public.stylist_reviews%rowtype;
  v_now timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'Unauthorized';
  end if;

  select * into v_review
  from public.stylist_reviews
  where id = p_review_id and client_id = v_user_id
  for update;

  if not found then
    raise exception 'Review not found';
  end if;
  if v_review.status <> 'accepted' then
    raise exception 'Only an accepted suggestion can be undone';
  end if;

  if v_review.target_kind = 'new_outfit' then
    -- Nothing to restore: undoing a look that did not exist before means removing
    -- the one accept created. outfit_items cascades, and the FK's on delete set
    -- null clears created_outfit_id for us. A row already deleted by the client
    -- is not an error -- the undo they asked for has effectively happened.
    if v_review.created_outfit_id is not null then
      delete from public.outfits
      where id = v_review.created_outfit_id and user_id = v_user_id;
    end if;

  elsif v_review.has_proposal then
    if coalesce(jsonb_array_length(v_review.previous_items), 0) = 0 then
      raise exception 'There is no earlier version to restore';
    end if;

    if v_review.target_kind = 'outfit' then
      perform public.stylist_apply_outfit_items(
        v_review.target_outfit_id, v_review.previous_items, v_user_id
      );

      if v_review.previous_text is not null then
        update public.outfits
        set notes = v_review.previous_text ->> 'description', updated_at = v_now
        where id = v_review.target_outfit_id and user_id = v_user_id;
      end if;
    else
      perform public.apply_plan_segment_items(
        v_review.target_segment_id, v_review.previous_items, v_user_id, true
      );

      if v_review.previous_text is not null then
        update public.outfit_plan_segments
        set reasoning = coalesce(v_review.previous_text ->> 'description', ''),
            change_from_previous = v_review.previous_text ->> 'changeFromPrevious',
            updated_at = v_now
        where id = v_review.target_segment_id;

        if nullif(v_review.previous_text ->> 'nextSegmentId', '') is not null then
          update public.outfit_plan_segments
          set change_from_previous = v_review.previous_text ->> 'nextChangeFromPrevious',
              updated_at = v_now
          where id = (v_review.previous_text ->> 'nextSegmentId')::uuid;
        end if;
      end if;
    end if;
  end if;

  update public.stylist_reviews
  set status = 'reverted', resolved_at = v_now, updated_at = v_now
  where id = p_review_id;
end;
$$;

-- ============================================================
-- 20. REUSE SAVED OUTFITS IN DAILY / WEEKLY PLANS
-- Section 19 is reserved by ROADMAP for user-defined rotation gaps.
-- Re-runnable against an existing database.
--
-- saved_outfit_id means the plan segment is an exact saved snapshot. The separate
-- source_outfit_id survives Canvas changes so Save can ask whether to update that
-- original Look or create a new one.
-- ============================================================
alter table public.outfit_plan_segments
  add column if not exists source_outfit_id uuid references public.outfits(id) on delete set null;

update public.outfit_plan_segments
set source_outfit_id = saved_outfit_id
where source_outfit_id is null
  and saved_outfit_id is not null;

create or replace function public.update_outfit_plan_segment_from_canvas(
  p_segment_id uuid,
  p_items jsonb,
  p_source_outfit_id uuid,
  p_source_matches boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_plan public.outfit_plans%rowtype;
  v_saved_outfit_id uuid;
begin
  if v_user_id is null then
    raise exception 'Unauthorized';
  end if;

  select plans.*
  into v_plan
  from public.outfit_plans plans
  join public.outfit_plan_segments segments
    on segments.outfit_plan_id = plans.id
  where segments.id = p_segment_id
    and plans.user_id = v_user_id
  for update of plans;

  if not found then
    raise exception 'Plan segment not found';
  end if;
  if v_plan.status = 'worn' then
    raise exception 'This plan is already marked as worn';
  end if;
  if coalesce(jsonb_typeof(p_items), 'null') <> 'array'
    or jsonb_array_length(p_items) = 0 then
    raise exception 'A segment must contain at least one item';
  end if;

  if p_source_outfit_id is not null and not exists (
    select 1 from public.outfits
    where id = p_source_outfit_id and user_id = v_user_id
  ) then
    raise exception 'Saved outfit not found';
  end if;

  perform public.apply_plan_segment_items(p_segment_id, p_items, v_user_id, true);

  v_saved_outfit_id := case
    when coalesce(p_source_matches, false)
      and p_source_outfit_id is not null
      and (
        select array_agg(item_id order by item_id)
        from public.outfit_plan_segment_items
        where segment_id = p_segment_id
      ) = (
        select array_agg(item_id order by item_id)
        from public.outfit_items
        where outfit_id = p_source_outfit_id
      )
    then p_source_outfit_id
    else null
  end;

  update public.outfit_plan_segments
  set saved_outfit_id = v_saved_outfit_id,
      source_outfit_id = p_source_outfit_id,
      updated_at = now()
  where id = p_segment_id;

  update public.outfit_plans
  set updated_at = now()
  where id = v_plan.id;

  return jsonb_build_object(
    'savedOutfitId', v_saved_outfit_id,
    'sourceOutfitId', p_source_outfit_id
  );
end;
$$;

create or replace function public.save_outfit_plan_segment_choice(
  p_segment_id uuid,
  p_items jsonb,
  p_name text,
  p_mode text,
  p_source_outfit_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_segment public.outfit_plan_segments%rowtype;
  v_plan_status text;
  v_outfit_id uuid;
  v_now timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'Unauthorized';
  end if;
  if p_mode is null or p_mode not in ('new', 'update') then
    raise exception 'Save mode must be new or update';
  end if;
  if coalesce(jsonb_typeof(p_items), 'null') <> 'array'
    or jsonb_array_length(p_items) < 2 then
    raise exception 'At least two items are required to save an outfit';
  end if;

  select segments.*
  into v_segment
  from public.outfit_plan_segments segments
  where segments.id = p_segment_id
    and exists (
      select 1
      from public.outfit_plans plans
      where plans.id = segments.outfit_plan_id
        and plans.user_id = v_user_id
    )
  for update of segments;

  if not found then
    raise exception 'Plan segment not found';
  end if;

  select status into v_plan_status
  from public.outfit_plans
  where id = v_segment.outfit_plan_id
    and user_id = v_user_id;

  if v_plan_status = 'worn' then
    raise exception 'This plan is already marked as worn';
  end if;

  perform public.apply_plan_segment_items(p_segment_id, p_items, v_user_id, true);

  if p_mode = 'update' then
    v_outfit_id := coalesce(
      p_source_outfit_id,
      v_segment.source_outfit_id,
      v_segment.saved_outfit_id
    );

    if v_outfit_id is null or not exists (
      select 1 from public.outfits
      where id = v_outfit_id and user_id = v_user_id
    ) then
      raise exception 'Original saved outfit not found';
    end if;

    -- Updating a Look means older plan segments that pointed at its previous
    -- exact snapshot are now only based on it, not exact copies of it.
    update public.outfit_plan_segments
    set source_outfit_id = coalesce(source_outfit_id, saved_outfit_id),
        saved_outfit_id = null,
        updated_at = v_now
    where saved_outfit_id = v_outfit_id
      and id <> p_segment_id;

    update public.outfits
    set updated_at = v_now
    where id = v_outfit_id and user_id = v_user_id;
  else
    insert into public.outfits (
      user_id,
      name,
      folder,
      ai_generated,
      ai_reasoning,
      created_at,
      updated_at
    )
    values (
      v_user_id,
      coalesce(nullif(p_name, ''), v_segment.label),
      'Everyday',
      true,
      nullif(v_segment.reasoning, ''),
      v_now,
      v_now
    )
    returning id into v_outfit_id;
  end if;

  delete from public.outfit_items
  where outfit_id = v_outfit_id;

  insert into public.outfit_items (outfit_id, item_id, position, x, y, width)
  select v_outfit_id, item_id, position, x, y, width
  from public.outfit_plan_segment_items
  where segment_id = p_segment_id
  order by position;

  update public.outfit_plan_segments
  set saved_outfit_id = v_outfit_id,
      source_outfit_id = v_outfit_id,
      updated_at = v_now
  where id = p_segment_id;

  return v_outfit_id;
end;
$$;

revoke execute on function public.update_outfit_plan_segment_from_canvas(uuid, jsonb, uuid, boolean)
  from public, anon;
grant execute on function public.update_outfit_plan_segment_from_canvas(uuid, jsonb, uuid, boolean)
  to authenticated;

revoke execute on function public.save_outfit_plan_segment_choice(uuid, jsonb, text, text, uuid)
  from public, anon;
grant execute on function public.save_outfit_plan_segment_choice(uuid, jsonb, text, text, uuid)
  to authenticated;

notify pgrst, 'reload schema';

-- ============================================================
-- 19. USER-DEFINED ROTATION LIMITS
-- Re-runnable against an existing database.
--
-- "How many DAYS of any seven may the same piece be worn on", per category. This
-- is the user's call, not the code's: "I own six tops, of course I repeat them"
-- and "I never want to be seen in the same thing twice" are both reasonable, and
-- until now both got the same hard-coded numbers.
--
-- JSONB rather than a column per category, because the category vocabulary can
-- change and each change would otherwise be another alter table. Keys are
-- `wardrobe_items.category` values, values are integers 1..7 (7 = no limit inside
-- a 7-day window). ONLY categories the user actually changed are stored, so a
-- later change to the defaults moves everyone who never touched them, instead of
-- freezing each user on a full snapshot of today's numbers.
--
-- Read and sanitised by resolveRotationLimits() in src/lib/planning/plan-rules.ts;
-- the column is never trusted directly.
-- ============================================================
alter table public.profiles
  add column if not exists rotation_limits jsonb default '{}'::jsonb;

notify pgrst, 'reload schema';
