-- ============================================================
-- Hunter System — Step 9: weight tracking + goal weight
-- Run this in Supabase → SQL Editor → New query
-- ============================================================

alter table public.profiles
  add column if not exists goal_weight_kg numeric;

create table public.weight_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  weight_kg numeric not null,
  logged_on date not null default current_date,
  created_at timestamptz default now(),
  unique (user_id, logged_on)
);

alter table public.weight_log enable row level security;

create policy "own weight log" on public.weight_log
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
