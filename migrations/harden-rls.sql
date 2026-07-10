-- ============================================================
-- Cal — Harden row-level security (run once in Supabase → SQL Editor)
--
-- WHAT THIS DOES
-- Step 11 replaced the login-based RLS with a fully-open policy
-- (`using (true) with check (true)`), meaning anyone holding the public
-- anon key could read, write, or delete ANY row in these tables. This
-- migration replaces that with policies scoped to your two real profile
-- UUIDs, so the database can only ever hold — and only ever hand back —
-- data belonging to Tariq or Hala. Random rows can't be inserted, and the
-- DB can't be abused as free anonymous storage.
--
-- WHAT THIS DOES *NOT* DO — READ THIS
-- Because the app has no login, every visitor (your app or an attacker)
-- talks to Supabase with the same public anon key. RLS has no identity to
-- check, so it CANNOT stop someone who has your site URL from reading or
-- editing these two profiles' data. Truly fixing that requires adding a
-- login (Supabase Auth) or moving all DB access behind an authenticated
-- Edge Function. This migration limits the damage; it does not make the
-- data private. Keep the site URL unlisted, and rotate the anon key in the
-- Supabase dashboard if it ever leaks somewhere public.
-- ============================================================

-- The two real profiles (must match PROFILES in store.js).
-- Postgres has no easy "reusable constant", so the UUID pair is repeated
-- inline in each policy below.
--   Tariq: 20a9853b-9ef1-452d-862d-3479fa165559
--   Hala:  2789628f-a040-4668-9c6a-0b7c93166fb1

-- ---------- per-profile tables: scope to the two known ids ----------
-- `profiles` keys on its own `id`; every other table keys on `user_id`.
do $$
declare
  t record;
  id_col text;
begin
  for t in
    select * from (values
      ('profiles'),
      ('quests'),
      ('completions'),
      ('food_log'),
      ('daily_bonuses'),
      ('custom_barcodes'),
      ('weight_log'),
      ('recipes'),
      ('water_log'),
      ('water_goal')
    ) as x(table_name)
  loop
    if to_regclass('public.' || t.table_name) is not null then
      id_col := case when t.table_name = 'profiles' then 'id' else 'user_id' end;
      execute format('alter table public.%I enable row level security', t.table_name);
      execute format('drop policy if exists "shared access" on public.%I', t.table_name);
      execute format('drop policy if exists "known profiles only" on public.%I', t.table_name);
      execute format($f$
        create policy "known profiles only" on public.%I
        for all
        using (%I in (
          '20a9853b-9ef1-452d-862d-3479fa165559',
          '2789628f-a040-4668-9c6a-0b7c93166fb1'
        ))
        with check (%I in (
          '20a9853b-9ef1-452d-862d-3479fa165559',
          '2789628f-a040-4668-9c6a-0b7c93166fb1'
        ))
      $f$, t.table_name, id_col, id_col);
    end if;
  end loop;
end $$;

-- ---------- reference tables: read-only for anon ----------
-- arabic_foods is a shared lookup table; anyone may read it, nobody may
-- write it through the anon key. (Drop any lingering write policy, keep select.)
do $$
begin
  if to_regclass('public.arabic_foods') is not null then
    execute 'alter table public.arabic_foods enable row level security';
    execute 'drop policy if exists "anyone can read foods" on public.arabic_foods';
    execute 'create policy "anyone can read foods" on public.arabic_foods for select using (true)';
  end if;
end $$;
