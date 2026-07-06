-- ============================================================
-- Hunter System — Step 3: Food logging
-- Run this in Supabase → SQL Editor → New query
-- ============================================================

-- Add daily macro targets to each user's profile
alter table public.profiles
  add column if not exists calorie_target integer default 2000,
  add column if not exists protein_target integer default 150,
  add column if not exists carb_target integer default 200,
  add column if not exists fat_target integer default 70;

-- ---------- Arabic foods: shared reference data, read-only to users ----------
create table public.arabic_foods (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  serving_size text not null default '1 serving',
  calories integer not null,
  protein numeric not null,
  carbs numeric not null,
  fat numeric not null
);

alter table public.arabic_foods enable row level security;

-- anyone signed in can read; nobody can insert/update/delete from the client
create policy "anyone can read foods" on public.arabic_foods
  for select using (auth.role() = 'authenticated');

insert into public.arabic_foods (name, serving_size, calories, protein, carbs, fat) values
  ('Mansaf', '1 plate', 650, 35, 55, 30),
  ('Chicken Mandi', '1 plate', 700, 40, 75, 25),
  ('Kabsa (chicken)', '1 plate', 620, 32, 70, 22),
  ('Falafel', '5 pieces', 330, 13, 32, 18),
  ('Hummus', '1 cup', 400, 19, 36, 22),
  ('Shawarma (chicken wrap)', '1 wrap', 500, 30, 45, 22),
  ('Shawarma (beef wrap)', '1 wrap', 560, 28, 42, 28),
  ('Tabbouleh', '1 cup', 120, 3, 15, 6),
  ('Fattoush', '1 cup', 150, 3, 18, 8),
  ('Manakeesh Zaatar', '1 piece', 300, 7, 40, 12),
  ('Maqluba', '1 plate', 600, 28, 70, 24),
  ('Molokhia with rice', '1 plate', 480, 22, 55, 16),
  ('Kunafa', '1 slice', 450, 9, 55, 22),
  ('Baklava', '1 piece', 230, 4, 26, 13),
  ('Foul Medames', '1 cup', 280, 14, 40, 8),
  ('Grilled chicken breast', '150g', 250, 45, 0, 7),
  ('Grilled kofta', '4 pieces', 420, 26, 8, 32),
  ('Plain rice', '1 cup cooked', 205, 4, 45, 0.5),
  ('Arabic bread (khubz)', '1 piece', 165, 5, 34, 1),
  ('Labneh', '2 tbsp', 60, 3, 2, 5);

-- ---------- Food log: what a user actually ate ----------
create table public.food_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  calories integer not null,
  protein numeric not null default 0,
  carbs numeric not null default 0,
  fat numeric not null default 0,
  source text not null default 'manual', -- 'manual' | 'arabic_db' | 'barcode' (step 5)
  logged_on date not null default current_date,
  created_at timestamptz default now()
);

alter table public.food_log enable row level security;

create policy "own food log" on public.food_log
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
