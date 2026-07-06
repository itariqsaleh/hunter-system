-- ============================================================
-- Hunter System — Final step: macro XP bonuses
-- Run this in Supabase → SQL Editor → New query
-- (Barcode scanning and the Gemini coach need no new tables —
--  Open Food Facts is called directly, and the coach goes through
--  an Edge Function, not the database.)
-- ============================================================

create table public.daily_bonuses (
  user_id uuid references auth.users(id) on delete cascade not null,
  bonus_date date not null default current_date,
  protein_awarded boolean not null default false,
  calorie_awarded boolean not null default false,
  primary key (user_id, bonus_date)
);

alter table public.daily_bonuses enable row level security;

create policy "own bonuses" on public.daily_bonuses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
