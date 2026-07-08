-- ============================================================
-- Cal — Step 14: sync water tracking to Supabase
-- Run this once in Supabase Dashboard → SQL Editor → New query
--
-- Water was the only tracker still living purely in localStorage, so it
-- never synced between devices the way quests/food/weight already do.
-- This adds a per-day glass count and a per-profile daily goal, scoped by
-- user_id the same way weight_log/food_log are (no auth.users FK — see
-- step 11's shared, no-login RLS model; both PROFILES ids from store.js
-- are allowed through).
--
-- app.js/store.js keep working exactly as before if you never run this
-- file: water reads/writes are best-effort against these tables and every
-- call is wrapped so a missing table fails silently, falling back to the
-- existing localStorage-only behavior.
-- ============================================================

create table if not exists public.water_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  logged_on date not null default current_date,
  glasses integer not null default 0,
  created_at timestamptz default now(),
  unique (user_id, logged_on)
);

alter table public.water_log enable row level security;

drop policy if exists "shared access" on public.water_log;
create policy "shared access" on public.water_log for all using (true) with check (true);

create table if not exists public.water_goal (
  user_id uuid primary key,
  glasses integer not null default 8,
  updated_at timestamptz default now()
);

alter table public.water_goal enable row level security;

drop policy if exists "shared access" on public.water_goal;
create policy "shared access" on public.water_goal for all using (true) with check (true);
