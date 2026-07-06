-- ============================================================
-- Hunter System — Step 2: Supabase schema
-- Run this once in Supabase Dashboard → SQL Editor → New query
-- ============================================================

create extension if not exists "pgcrypto";

-- One row per user: name, overall XP, per-stat XP
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text default 'Hunter',
  total_xp integer default 0,
  stats jsonb default '{"STR":{"xp":0},"VIT":{"xp":0},"INT":{"xp":0},"DIS":{"xp":0},"SPI":{"xp":0}}'::jsonb,
  created_at timestamptz default now()
);

-- Each user's quest list
create table public.quests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  stat text not null check (stat in ('STR','VIT','INT','DIS','SPI')),
  xp integer not null default 10,
  created_at timestamptz default now()
);

-- Which quests were completed on which day
create table public.completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  quest_id uuid references public.quests(id) on delete cascade not null,
  done_on date not null default current_date,
  created_at timestamptz default now(),
  unique (user_id, quest_id, done_on)
);

-- ---------- Row Level Security: users only ever touch their own rows ----------
alter table public.profiles enable row level security;
alter table public.quests enable row level security;
alter table public.completions enable row level security;

create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "own quests" on public.quests
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own completions" on public.completions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- Auto-create profile + default quests on signup ----------
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name) values (new.id, 'Hunter');

  insert into public.quests (user_id, name, stat, xp) values
    (new.id, 'Morning workout (15+ min)', 'STR', 15),
    (new.id, 'Drink 8 glasses of water', 'VIT', 10),
    (new.id, '30 min walk or cardio', 'VIT', 15),
    (new.id, 'Read or learn for 20 min', 'INT', 10),
    (new.id, 'Meditate or breathe for 10 min', 'SPI', 10),
    (new.id, 'Eat a balanced meal, skip junk', 'DIS', 15),
    (new.id, 'Sleep 7+ hours last night', 'VIT', 10);

  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
