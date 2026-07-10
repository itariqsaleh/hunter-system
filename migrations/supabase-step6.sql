-- ============================================================
-- Hunter System — Step 6: custom barcode library + bigger food dataset
-- Run this in Supabase → SQL Editor → New query
-- ============================================================

-- Personal barcode library: when Open Food Facts doesn't have a product
-- (common for local Jordanian brands), the user fills it in once here.
-- Next scan of the same barcode recognizes it instantly.
create table public.custom_barcodes (
  user_id uuid references auth.users(id) on delete cascade not null,
  barcode text not null,
  name text not null,
  calories integer not null,
  protein numeric not null default 0,
  carbs numeric not null default 0,
  fat numeric not null default 0,
  created_at timestamptz default now(),
  primary key (user_id, barcode)
);

alter table public.custom_barcodes enable row level security;

create policy "own custom barcodes" on public.custom_barcodes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- Expand the Arabic/Levantine foods reference table ----------
-- All values are per listed serving, reasonable estimates for common
-- home-style preparations — treat as approximate, same as any food app.
insert into public.arabic_foods (name, serving_size, calories, protein, carbs, fat) values
  -- Breakfast
  ('Foul with olive oil', '1 cup', 320, 15, 42, 10),
  ('Labneh with olive oil', '3 tbsp', 140, 5, 3, 12),
  ('Za''atar manakeesh', '1 piece', 320, 7, 42, 14),
  ('Cheese manakeesh', '1 piece', 350, 12, 38, 16),
  ('Halloumi (fried)', '100g', 320, 22, 2, 25),
  ('Akkawi cheese', '50g', 140, 9, 1, 11),
  ('Boiled egg', '1 large', 78, 6, 0.6, 5),
  ('Fried egg', '1 large', 95, 6, 0.5, 7),
  ('Jibneh Arabiyeh', '1 slice', 90, 6, 1, 7),
  ('Pita bread (small)', '1 piece', 165, 5, 33, 1),
  -- Mains / dishes
  ('Kibbeh (fried)', '3 pieces', 330, 14, 22, 20),
  ('Kibbeh Nayyeh', '150g', 320, 24, 18, 16),
  ('Freekeh with chicken', '1 plate', 520, 30, 60, 16),
  ('Yalanji (stuffed grape leaves, veg)', '6 pieces', 220, 4, 32, 9),
  ('Waraq Enab bil Lahmeh (meat)', '6 pieces', 300, 14, 28, 14),
  ('Musakhan (chicken w/ sumac)', '1 plate', 620, 34, 55, 28),
  ('Mujadara (lentils & rice)', '1 plate', 420, 14, 65, 12),
  ('Shakshuka', '1 plate', 320, 16, 18, 20),
  ('Grilled fish (sayadieh style)', '1 plate', 480, 32, 55, 14),
  ('Chicken Fatteh', '1 plate', 560, 30, 48, 26),
  ('Hummus with meat', '1 plate', 480, 24, 36, 26),
  ('Batata Harra', '1 cup', 260, 4, 32, 13),
  ('Grilled lamb chops', '3 pieces', 420, 30, 0, 32),
  ('Shish Tawook', '1 skewer', 260, 30, 4, 13),
  ('Kofta bil Sanieh (tray-baked)', '1 serving', 450, 26, 18, 30),
  ('Vermicelli rice (rez bi shaghriyeh)', '1 cup', 230, 4, 45, 4),
  ('Warak dawali (rice only, vegan)', '6 pieces', 210, 3, 34, 7),
  -- Soups
  ('Lentil soup (shorbet adas)', '1 bowl', 220, 12, 32, 5),
  ('Freekeh soup', '1 bowl', 200, 9, 30, 5),
  ('Chicken soup', '1 bowl', 180, 14, 12, 8),
  -- Snacks / street food
  ('Sambousek (meat, fried)', '3 pieces', 300, 12, 24, 18),
  ('Sambousek (cheese, baked)', '3 pieces', 240, 10, 22, 12),
  ('Rakwet shay w falafel sandwich', '1 sandwich', 420, 13, 48, 20),
  ('Ka''ak with sesame', '1 piece', 280, 8, 45, 8),
  ('Roasted chickpeas', '1/2 cup', 210, 11, 33, 4),
  ('Salted nuts mix', '1/4 cup', 220, 7, 8, 19),
  ('Green olives', '10 pieces', 60, 0.5, 3, 6),
  ('Black olives', '10 pieces', 70, 0.5, 2, 7),
  -- Salads / sides
  ('Baba Ghanouj', '1/2 cup', 130, 3, 10, 9),
  ('Moutabal', '1/2 cup', 140, 3, 8, 11),
  ('Jarjeer salad (arugula)', '1 cup', 40, 2, 4, 2),
  ('Pickles (mixed)', '1/2 cup', 25, 1, 5, 0),
  ('Toum (garlic sauce)', '1 tbsp', 90, 0, 2, 9),
  ('Tahini sauce', '2 tbsp', 180, 5, 6, 16),
  -- Sweets / desserts
  ('Qatayef (with nuts, fried)', '2 pieces', 320, 6, 38, 16),
  ('Halawet El Jibn', '1 piece', 180, 4, 26, 7),
  ('Maamoul (date)', '1 piece', 180, 3, 26, 8),
  ('Basbousa', '1 piece', 250, 4, 34, 11),
  ('Znoud El Sit', '1 piece', 220, 4, 24, 12),
  ('Halwa (sesame)', '30g', 170, 4, 15, 11),
  ('Rice pudding (riz bi haleeb)', '1 cup', 260, 6, 42, 7),
  ('Mahalabia', '1 cup', 230, 4, 38, 6),
  -- Drinks
  ('Arabic coffee (unsweetened)', '1 small cup', 5, 0.2, 1, 0),
  ('Turkish coffee (sweetened)', '1 small cup', 35, 0.2, 8, 0),
  ('Karak tea', '1 cup', 90, 2, 14, 3),
  ('Jallab', '1 cup', 160, 0.5, 40, 0),
  ('Tamarind juice', '1 cup', 120, 0.3, 30, 0),
  ('Sahlab (plain)', '1 cup', 180, 4, 30, 5),
  ('Ayran / Laban drink', '1 cup', 90, 5, 8, 4),
  ('Fresh orange juice', '1 cup', 110, 2, 26, 0.5),
  -- Fruits & vegetables (generic, useful fallback vs USDA for common local names)
  ('Dates (Medjool)', '3 pieces', 200, 1.5, 54, 0.3),
  ('Fresh figs', '3 pieces', 90, 1, 24, 0.4),
  ('Pomegranate seeds', '1 cup', 145, 3, 33, 2),
  ('Watermelon', '1 cup diced', 46, 1, 12, 0.2),
  ('Cucumber', '1 medium', 45, 2, 11, 0.3),
  ('Tomato', '1 medium', 22, 1, 5, 0.2),
  -- Common staples / cooking basics
  ('Olive oil', '1 tbsp', 120, 0, 0, 14),
  ('White rice (cooked)', '1 cup', 205, 4, 45, 0.5),
  ('Bulgur (cooked)', '1 cup', 150, 6, 34, 0.4),
  ('Lentils (cooked)', '1 cup', 230, 18, 40, 1),
  ('Chickpeas (cooked)', '1 cup', 270, 15, 45, 4),
  ('Plain yogurt', '1 cup', 150, 8, 11, 8),
  ('Flatbread saj', '1 piece', 120, 4, 24, 1);
