/*
  store.js — data layer, final combined version.
*/
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://rrjkghhwwqcjyxniawou.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJyamtnaGh3d3Fjanl4bmlhd291Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyODI3ODEsImV4cCI6MjA5ODg1ODc4MX0.idKNtLfH_qMfCOI7URiS2vEcgceE2O16uvGMQ2V4zkk';
const GEMINI_PROXY_URL = 'https://rrjkghhwwqcjyxniawou.supabase.co/functions/v1/macro-chat';
// Free key from https://api.data.gov/signup — no cost, just a rate limit (1,000 req/hr on free tier)
const USDA_API_KEY = 'YOUR_USDA_API_KEY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const STAT_DEFS = {
  STR: { label: 'Strength', icon: '💪' },
  VIT: { label: 'Vitality', icon: '❤️' },
  INT: { label: 'Intelligence', icon: '🧠' },
  DIS: { label: 'Discipline', icon: '🛡️' },
  SPI: { label: 'Spirit', icon: '✨' }
};

// ---------- auth ----------
export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function signUpWithEmail(email, password) {
  return supabase.auth.signUp({ email, password });
}

export async function signInWithEmail(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  return supabase.auth.signOut();
}

export function onAuthChange(callback) {
  supabase.auth.onAuthStateChange((_event, session) => callback(session));
}

function currentUserId() {
  return supabase.auth.getUser().then((r) => r.data.user?.id);
}

// ---------- load everything into the shape app.js expects ----------
export async function loadData() {
  const uid = await currentUserId();
  if (!uid) throw new Error('Not signed in');
  const tKey = todayKey();

  const [
    { data: profile, error: pErr },
    { data: quests, error: qErr },
    { data: completions, error: cErr },
    { data: foodLog, error: fErr }
  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', uid).single(),
    supabase.from('quests').select('*').eq('user_id', uid).order('created_at'),
    supabase.from('completions').select('quest_id, done_on').eq('user_id', uid)
      .gte('done_on', new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10)),
    supabase.from('food_log').select('*').eq('user_id', uid).eq('logged_on', tKey).order('created_at')
  ]);

  if (pErr) throw pErr;
  if (qErr) throw qErr;
  if (cErr) throw cErr;
  if (fErr) throw fErr;

  const completionsMap = {};
  (completions || []).forEach((row) => {
    if (!completionsMap[row.done_on]) completionsMap[row.done_on] = [];
    completionsMap[row.done_on].push(row.quest_id);
  });

  return {
    name: profile.name,
    stats: profile.stats,
    totalXP: profile.total_xp,
    quests: (quests || []).map((q) => ({ id: q.id, name: q.name, stat: q.stat, xp: q.xp })),
    completions: completionsMap,
    targets: {
      calories: profile.calorie_target,
      protein: profile.protein_target,
      carbs: profile.carb_target,
      fat: profile.fat_target
    },
    profileDetails: {
      heightCm: profile.height_cm,
      weightKg: profile.weight_kg,
      age: profile.age,
      sex: profile.sex,
      activityLevel: profile.activity_level || 'moderate',
      goal: profile.goal || 'maintain'
    },
    foodLog: (foodLog || []).map((f) => ({
      id: f.id, name: f.name, calories: f.calories, protein: f.protein, carbs: f.carbs, fat: f.fat,
      source: f.source, meal: f.meal || 'snack'
    }))
  };
}

// ---------- profile / quests ----------
export async function saveProfile({ name, totalXP, stats }) {
  const uid = await currentUserId();
  if (!uid) throw new Error('Not signed in');
  const { error } = await supabase.from('profiles').update({ name, total_xp: totalXP, stats }).eq('id', uid);
  if (error) throw error;
}

// Saves body details, goal settings, and macro targets together (Profile tab "Save").
export async function saveProfileGoals({ heightCm, weightKg, age, sex, activityLevel, goal, targets }) {
  const uid = await currentUserId();
  if (!uid) throw new Error('Not signed in');
  const { error } = await supabase.from('profiles').update({
    height_cm: heightCm,
    weight_kg: weightKg,
    age,
    sex,
    activity_level: activityLevel,
    goal,
    calorie_target: targets.calories,
    protein_target: targets.protein,
    carb_target: targets.carbs,
    fat_target: targets.fat
  }).eq('id', uid);
  if (error) throw error;
}

// Mifflin-St Jeor BMR → TDEE → macro split. Pure function, no network call.
export function calculateTargets({ heightCm, weightKg, age, sex, activityLevel, goal }) {
  const bmr = sex === 'female'
    ? 10 * weightKg + 6.25 * heightCm - 5 * age - 161
    : 10 * weightKg + 6.25 * heightCm - 5 * age + 5;

  const activityMultipliers = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 };
  const tdee = bmr * (activityMultipliers[activityLevel] || 1.55);

  const goalAdjust = { lose: -500, maintain: 0, gain: 300 };
  const calories = Math.round(tdee + (goalAdjust[goal] ?? 0));

  const protein = Math.round(weightKg * 1.8);
  const fat = Math.round((calories * 0.28) / 9);
  const carbs = Math.round(Math.max(0, calories - protein * 4 - fat * 9) / 4);

  return { calories, protein, carbs, fat };
}

export async function addQuestRemote({ name, stat, xp }) {
  const uid = await currentUserId();
  if (!uid) throw new Error('Not signed in');
  const { data, error } = await supabase.from('quests').insert({ user_id: uid, name, stat, xp }).select().single();
  if (error) throw error;
  return { id: data.id, name: data.name, stat: data.stat, xp: data.xp };
}

export async function deleteQuestRemote(questId) {
  const { error } = await supabase.from('quests').delete().eq('id', questId);
  if (error) throw error;
}

export async function toggleCompletionRemote(questId, dateKey, isCurrentlyDone) {
  const uid = await currentUserId();
  if (!uid) throw new Error('Not signed in');
  if (isCurrentlyDone) {
    const { error } = await supabase.from('completions').delete()
      .eq('user_id', uid).eq('quest_id', questId).eq('done_on', dateKey);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('completions').insert({ user_id: uid, quest_id: questId, done_on: dateKey });
    if (error) throw error;
  }
}

// ---------- food logging ----------
export async function searchArabicFoods(query) {
  if (!query || !query.trim()) return [];
  const { data, error } = await supabase.from('arabic_foods').select('*').ilike('name', `%${query.trim()}%`).limit(8);
  if (error) throw error;
  return data.map((f) => ({
    name: f.name, servingLabel: f.serving_size,
    calories: f.calories, protein: f.protein, carbs: f.carbs, fat: f.fat,
    source: 'arabic_db', mode: 'perServing'
  }));
}

// USDA FoodData Central — generic/whole foods, complements the Arabic table and Open Food Facts.
export async function searchUSDAFoods(query) {
  if (!query || !query.trim()) return [];
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${USDA_API_KEY}&query=${encodeURIComponent(query.trim())}&pageSize=6&dataType=Foundation,SR%20Legacy`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('USDA request failed');
  const data = await res.json();

  const nutrientId = { calories: 1008, protein: 1003, carbs: 1005, fat: 1004 };
  const getNutrient = (food, id) => {
    const hit = (food.foodNutrients || []).find((n) => n.nutrientId === id);
    return hit ? Math.round(hit.value * 10) / 10 : 0;
  };

  return (data.foods || []).map((food) => ({
    name: food.description,
    servingLabel: 'per 100g',
    calories: Math.round(getNutrient(food, nutrientId.calories)),
    protein: getNutrient(food, nutrientId.protein),
    carbs: getNutrient(food, nutrientId.carbs),
    fat: getNutrient(food, nutrientId.fat),
    source: 'usda', mode: 'per100g'
  }));
}

// USDA Branded Foods — hundreds of thousands of packaged products with real labels.
export async function searchUSDABranded(query) {
  if (!query || !query.trim()) return [];
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${USDA_API_KEY}&query=${encodeURIComponent(query.trim())}&pageSize=6&dataType=Branded`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('USDA branded request failed');
  const data = await res.json();

  const nutrientId = { calories: 1008, protein: 1003, carbs: 1005, fat: 1004 };
  const getNutrient = (food, id) => {
    const hit = (food.foodNutrients || []).find((n) => n.nutrientId === id);
    return hit ? Math.round(hit.value * 10) / 10 : 0;
  };

  return (data.foods || []).map((food) => ({
    name: food.brandName ? `${food.description} (${food.brandName})` : food.description,
    servingLabel: 'per 100g',
    calories: Math.round(getNutrient(food, nutrientId.calories)),
    protein: getNutrient(food, nutrientId.protein),
    carbs: getNutrient(food, nutrientId.carbs),
    fat: getNutrient(food, nutrientId.fat),
    source: 'usda_branded', mode: 'per100g'
  }));
}

// Open Food Facts text search (not barcode) — millions of crowd-sourced global products,
// including many Middle Eastern/Jordanian brands that don't show up via barcode lookup alone.
export async function searchOpenFoodFactsText(query) {
  if (!query || !query.trim()) return [];
  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query.trim())}&search_simple=1&json=1&page_size=6`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Open Food Facts search failed');
  const data = await res.json();

  return (data.products || [])
    .filter((p) => p.product_name && p.nutriments)
    .map((p) => ({
      name: p.brands ? `${p.product_name} (${p.brands})` : p.product_name,
      servingLabel: 'per 100g',
      calories: Math.round(p.nutriments['energy-kcal_100g'] || 0),
      protein: Math.round((p.nutriments['proteins_100g'] || 0) * 10) / 10,
      carbs: Math.round((p.nutriments['carbohydrates_100g'] || 0) * 10) / 10,
      fat: Math.round((p.nutriments['fat_100g'] || 0) * 10) / 10,
      source: 'off_text', mode: 'per100g'
    }));
}

export async function addFoodLogRemote({ name, calories, protein, carbs, fat, source, meal }) {
  const uid = await currentUserId();
  if (!uid) throw new Error('Not signed in');
  const { data, error } = await supabase.from('food_log').insert({
    user_id: uid, name, calories,
    protein: protein || 0, carbs: carbs || 0, fat: fat || 0,
    source: source || 'manual', meal: meal || 'snack', logged_on: todayKey()
  }).select().single();
  if (error) throw error;
  return {
    id: data.id, name: data.name, calories: data.calories, protein: data.protein,
    carbs: data.carbs, fat: data.fat, source: data.source, meal: data.meal
  };
}

export async function deleteFoodLogRemote(id) {
  const { error } = await supabase.from('food_log').delete().eq('id', id);
  if (error) throw error;
}

// ---------- barcode lookup: personal library first, then Open Food Facts ----------
export async function lookupBarcode(barcode) {
  const uid = await currentUserId();

  if (uid) {
    const { data: custom, error: customErr } = await supabase
      .from('custom_barcodes').select('*').eq('user_id', uid).eq('barcode', barcode).maybeSingle();
    if (customErr) throw customErr;
    if (custom) {
      return {
        name: custom.name, servingLabel: 'per 100g',
        calories: custom.calories, protein: custom.protein, carbs: custom.carbs, fat: custom.fat,
        source: 'custom', mode: 'per100g'
      };
    }
  }

  const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`);
  if (!res.ok) throw new Error('Open Food Facts request failed');
  const data = await res.json();
  if (data.status !== 1 || !data.product) return null;

  const p = data.product;
  const n = p.nutriments || {};
  return {
    name: p.product_name || p.generic_name || `Product ${barcode}`,
    servingLabel: 'per 100g',
    calories: Math.round(n['energy-kcal_100g'] || n['energy-kcal_serving'] || 0),
    protein: Math.round((n['proteins_100g'] || 0) * 10) / 10,
    carbs: Math.round((n['carbohydrates_100g'] || 0) * 10) / 10,
    fat: Math.round((n['fat_100g'] || 0) * 10) / 10,
    source: 'barcode',
    mode: 'per100g'
  };
}

export async function saveCustomBarcode(barcode, { name, calories, protein, carbs, fat }) {
  const uid = await currentUserId();
  if (!uid) throw new Error('Not signed in');
  const { error } = await supabase.from('custom_barcodes').upsert({
    user_id: uid, barcode, name, calories, protein: protein || 0, carbs: carbs || 0, fat: fat || 0
  });
  if (error) throw error;
}

// ---------- macro XP bonuses ----------
export async function getOrCreateDailyBonus() {
  const uid = await currentUserId();
  const tKey = todayKey();
  let { data, error } = await supabase.from('daily_bonuses').select('*')
    .eq('user_id', uid).eq('bonus_date', tKey).maybeSingle();
  if (error) throw error;
  if (!data) {
    const { data: inserted, error: insErr } = await supabase.from('daily_bonuses')
      .insert({ user_id: uid, bonus_date: tKey }).select().single();
    if (insErr) throw insErr;
    data = inserted;
  }
  return data;
}

export async function markBonusAwarded(field) {
  const uid = await currentUserId();
  const tKey = todayKey();
  const patch = {};
  patch[field] = true;
  const { error } = await supabase.from('daily_bonuses').update(patch).eq('user_id', uid).eq('bonus_date', tKey);
  if (error) throw error;
}

// ---------- Gemini macro coach (via Edge Function proxy) ----------
export async function askCoach(message) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');

  const res = await fetch(GEMINI_PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': SUPABASE_ANON_KEY
    },
    body: JSON.stringify({ message })
  });

  if (!res.ok) throw new Error('Coach request failed (' + res.status + ')');
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.reply;
}

// ---------- leveling math ----------
export function levelFromXP(xp, baseCost, growth) {
  let level = 1, remaining = xp, need = baseCost;
  while (remaining >= need) {
    remaining -= need;
    level++;
    need = baseCost + (level - 1) * growth;
  }
  return { level, remaining, need };
}

export function overallLevel(xp) { return levelFromXP(xp, 100, 25); }
export function statLevel(xp) { return levelFromXP(xp, 50, 10); }

export function rankFromLevel(level) {
  if (level >= 60) return { label: 'S', color: 'var(--gold)', name: 'S-RANK' };
  if (level >= 45) return { label: 'A', color: '#ff8fd6', name: 'A-RANK' };
  if (level >= 30) return { label: 'B', color: 'var(--arcane)', name: 'B-RANK' };
  if (level >= 20) return { label: 'C', color: 'var(--glow)', name: 'C-RANK' };
  if (level >= 10) return { label: 'D', color: '#6ea8ff', name: 'D-RANK' };
  return { label: 'E', color: 'var(--muted)', name: 'E-RANK' };
}

export function todayKey(d) {
  d = d || new Date();
  return d.toISOString().slice(0, 10);
}
