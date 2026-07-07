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

-- ---------- drop every FK that points at auth.users, but only on OUR tables ----------
-- (auth.users is also referenced by Supabase's own internal auth.* tables like
-- auth.identities — those are owned by the platform, not us, and must stay untouched)
do $$
declare
  r record;
begin
  for r in
    select c.conrelid::regclass::text as table_name, c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.confrelid = 'auth.users'::regclass
      and n.nspname = 'public'
  loop
    execute format('alter table %s drop constraint %I', r.table_name, r.conname);
  end loop;
end $$;

-- ---------- replace auth.uid()-based RLS with shared open access ----------
-- Guarded with to_regclass so this runs cleanly whether or not you've run
-- every optional step file (custom_barcodes/weight_log/recipes are from
-- steps 6/9/10 — skip harmlessly if you never ran those).
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('profiles', 'own profile'),
      ('quests', 'own quests'),
      ('completions', 'own completions'),
      ('food_log', 'own food log'),
      ('daily_bonuses', 'own bonuses'),
      ('custom_barcodes', 'own custom barcodes'),
      ('weight_log', 'own weight log'),
      ('recipes', 'own recipes')
    ) as x(table_name, old_policy)
  loop
    if to_regclass('public.' || t.table_name) is not null then
      execute format('drop policy if exists %I on public.%I', t.old_policy, t.table_name);
      execute format('create policy "shared access" on public.%I for all using (true) with check (true)', t.table_name);
    end if;
  end loop;
end $$;

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
