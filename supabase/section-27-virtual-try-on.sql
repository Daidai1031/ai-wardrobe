alter table public.profiles add column if not exists full_body_photo_path text;
alter table public.profiles add column if not exists full_body_photo_updated_at timestamptz;

create table if not exists public.virtual_try_ons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  outfit_id uuid not null references public.outfits(id) on delete cascade,
  person_photo_path text not null,
  item_fingerprint text not null,
  result_path text,
  model text not null default 'fal-ai/flux-pro/v1/vto',
  prompt text not null,
  seed bigint,
  status text not null default 'processing',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.virtual_try_ons drop constraint if exists virtual_try_ons_status_check;
alter table public.virtual_try_ons add constraint virtual_try_ons_status_check check (status in ('processing','complete','failed'));
alter table public.virtual_try_ons drop constraint if exists virtual_try_ons_input_key;
alter table public.virtual_try_ons add constraint virtual_try_ons_input_key unique (user_id, outfit_id, person_photo_path, item_fingerprint);
create index if not exists virtual_try_ons_user_idx on public.virtual_try_ons (user_id, created_at desc);
alter table public.virtual_try_ons enable row level security;

drop policy if exists "virtual_try_ons_select_own" on public.virtual_try_ons;
create policy "virtual_try_ons_select_own" on public.virtual_try_ons for select using (auth.uid() = user_id);
drop policy if exists "virtual_try_ons_insert_own" on public.virtual_try_ons;
create policy "virtual_try_ons_insert_own" on public.virtual_try_ons for insert with check (auth.uid() = user_id);
drop policy if exists "virtual_try_ons_update_own" on public.virtual_try_ons;
create policy "virtual_try_ons_update_own" on public.virtual_try_ons for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "virtual_try_ons_delete_own" on public.virtual_try_ons;
create policy "virtual_try_ons_delete_own" on public.virtual_try_ons for delete using (auth.uid() = user_id);

insert into storage.buckets (id, name, public) values ('try-on', 'try-on', false) on conflict (id) do update set public = false;
drop policy if exists "Users upload own try-on images" on storage.objects;
create policy "Users upload own try-on images" on storage.objects for insert with check (bucket_id = 'try-on' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users read own try-on images" on storage.objects;
create policy "Users read own try-on images" on storage.objects for select using (bucket_id = 'try-on' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users update own try-on images" on storage.objects;
create policy "Users update own try-on images" on storage.objects for update using (bucket_id = 'try-on' and (storage.foldername(name))[1] = auth.uid()::text) with check (bucket_id = 'try-on' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users delete own try-on images" on storage.objects;
create policy "Users delete own try-on images" on storage.objects for delete using (bucket_id = 'try-on' and (storage.foldername(name))[1] = auth.uid()::text);

notify pgrst, 'reload schema';
