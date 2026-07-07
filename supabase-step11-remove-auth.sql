-- ============================================================
-- Cal (formerly Hunter System) — Step 11: remove auth requirement
-- Run this once in Supabase Dashboard → SQL Editor → New query
--
-- The app no longer has a login screen. Both devices now share one
-- hardcoded user id (see SHARED_USER_ID in store.js) and talk to
-- Supabase with only the anon key — no session/JWT from a signed-in
-- user. That breaks two things the old schema assumed:
--   1. Every user_id/id column has a foreign key into auth.users,
--      which would reject the hardcoded id (it's not a real auth user).
--   2. Every RLS policy checks auth.uid() = user_id, which is always
--      null with no session, so every request would be denied.
-- This migration fixes both and seeds the one shared profile row.
-- ============================================================

-- ---------- drop every FK that points at auth.users ----------
do $$
declare
  r record;
begin
  for r in
    select conrelid::regclass::text as table_name, conname
    from pg_constraint
    where confrelid = 'auth.users'::regclass
  loop
    execute format('alter table %s drop constraint %I', r.table_name, r.conname);
  end loop;
end $$;

-- ---------- replace auth.uid()-based RLS with shared open access ----------
drop policy if exists "own profile" on public.profiles;
create policy "shared access" on public.profiles for all using (true) with check (true);

drop policy if exists "own quests" on public.quests;
create policy "shared access" on public.quests for all using (true) with check (true);

drop policy if exists "own completions" on public.completions;
create policy "shared access" on public.completions for all using (true) with check (true);

drop policy if exists "own food log" on public.food_log;
create policy "shared access" on public.food_log for all using (true) with check (true);

drop policy if exists "own bonuses" on public.daily_bonuses;
create policy "shared access" on public.daily_bonuses for all using (true) with check (true);

drop policy if exists "own custom barcodes" on public.custom_barcodes;
create policy "shared access" on public.custom_barcodes for all using (true) with check (true);

drop policy if exists "own weight log" on public.weight_log;
create policy "shared access" on public.weight_log for all using (true) with check (true);

drop policy if exists "own recipes" on public.recipes;
create policy "shared access" on public.recipes for all using (true) with check (true);

-- was auth.role() = 'authenticated'; the anon key has no auth role now
drop policy if exists "anyone can read foods" on public.arabic_foods;
create policy "anyone can read foods" on public.arabic_foods for select using (true);

-- ---------- seed the one shared profile + default quests ----------
-- id must match SHARED_USER_ID in store.js
insert into public.profiles (id, name)
values ('20a9853b-9ef1-452d-862d-3479fa165559', 'Hunter')
on conflict (id) do nothing;

insert into public.quests (user_id, name, stat, xp)
select '20a9853b-9ef1-452d-862d-3479fa165559', d.name, d.stat, d.xp
from (values
  ('Morning workout (15+ min)', 'STR', 15),
  ('Drink 8 glasses of water', 'VIT', 10),
  ('30 min walk or cardio', 'VIT', 15),
  ('Read or learn for 20 min', 'INT', 10),
  ('Meditate or breathe for 10 min', 'SPI', 10),
  ('Eat a balanced meal, skip junk', 'DIS', 15),
  ('Sleep 7+ hours last night', 'VIT', 10)
) as d(name, stat, xp)
where not exists (
  select 1 from public.quests where user_id = '20a9853b-9ef1-452d-862d-3479fa165559'
);
