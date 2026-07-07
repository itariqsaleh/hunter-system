-- ============================================================
-- Cal — Step 12: second profile (Hala)
-- Run this once in Supabase Dashboard → SQL Editor → New query
--
-- Step 11 gave the app one shared user id. Now each device picks
-- "Tariq" or "Hala" locally (see PROFILES in store.js) so food,
-- quests, XP, and weight stay separate per person. This just seeds
-- the second person's profile + default quests — step 11's open
-- RLS policies (using (true)) already allow either id through.
-- ============================================================

insert into public.profiles (id, name)
values ('2789628f-a040-4668-9c6a-0b7c93166fb1', 'Hala')
on conflict (id) do nothing;

insert into public.quests (user_id, name, stat, xp)
select '2789628f-a040-4668-9c6a-0b7c93166fb1', d.name, d.stat, d.xp
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
  select 1 from public.quests where user_id = '2789628f-a040-4668-9c6a-0b7c93166fb1'
);
