-- Run this once in Supabase Dashboard → SQL Editor.
create table if not exists public.user_backups (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.user_backups enable row level security;
grant select, insert, update on table public.user_backups to authenticated;

drop policy if exists "Users can read their own backup" on public.user_backups;
create policy "Users can read their own backup"
  on public.user_backups for select
  using (auth.uid() = user_id);

drop policy if exists "Users can create their own backup" on public.user_backups;
create policy "Users can create their own backup"
  on public.user_backups for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own backup" on public.user_backups;
create policy "Users can update their own backup"
  on public.user_backups for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
