-- ============================================================
-- Hunter System — Step 5: profile/goals + meal categories
-- Run this in Supabase → SQL Editor → New query
-- ============================================================

alter table public.profiles
  add column if not exists height_cm numeric,
  add column if not exists weight_kg numeric,
  add column if not exists age integer,
  add column if not exists sex text check (sex in ('male', 'female')),
  add column if not exists activity_level text default 'moderate'
    check (activity_level in ('sedentary', 'light', 'moderate', 'active', 'very_active')),
  add column if not exists goal text default 'maintain'
    check (goal in ('lose', 'maintain', 'gain'));

alter table public.food_log
  add column if not exists meal text not null default 'snack'
    check (meal in ('breakfast', 'lunch', 'dinner', 'snack'));
