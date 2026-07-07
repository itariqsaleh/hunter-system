-- ============================================================
-- Hunter System — Step 7b: guaranteed condiments
-- Run this in Supabase → SQL Editor → New query
-- These always show up instantly regardless of USDA/external API status.
-- ============================================================

insert into public.arabic_foods (name, serving_size, calories, protein, carbs, fat) values
  ('Ketchup', '1 tbsp', 20, 0.2, 5, 0),
  ('Mayonnaise', '1 tbsp', 95, 0.1, 0.4, 10),
  ('Mustard', '1 tbsp', 10, 0.6, 1, 0.6),
  ('Chili sauce / harissa', '1 tbsp', 15, 0.3, 3, 0.2),
  ('Ranch dressing', '1 tbsp', 70, 0.2, 1, 7),
  ('BBQ sauce', '1 tbsp', 30, 0.2, 7, 0.1),
  ('Soy sauce', '1 tbsp', 10, 1, 1, 0);
