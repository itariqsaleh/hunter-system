-- ============================================================
-- Hunter System — Step 10: Recipe Book
-- Run this in Supabase → SQL Editor → New query
-- ============================================================

-- A recipe = a named, reusable multi-ingredient meal.
-- Ingredients are stored as jsonb so recipes stay editable;
-- calories/protein/carbs/fat are the TOTALS for the whole recipe
-- (denormalized so the recipe list renders without recomputing).
create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  emoji text not null default '🍲',
  servings numeric not null default 1,
  ingredients jsonb not null default '[]',
  calories integer not null default 0,
  protein numeric not null default 0,
  carbs numeric not null default 0,
  fat numeric not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.recipes enable row level security;

create policy "own recipes" on public.recipes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Home Chef bonus: +10 Spirit XP the first time each day you log
-- one of your own recipes (cooking at home is a discipline win).
alter table public.daily_bonuses
  add column if not exists recipe_awarded boolean not null default false;
