/*
  store.js — data layer, final combined version.
*/
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://rrjkghhwwqcjyxniawou.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJyamtnaGh3d3Fjanl4bmlhd291Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyODI3ODEsImV4cCI6MjA5ODg1ODc4MX0.idKNtLfH_qMfCOI7URiS2vEcgceE2O16uvGMQ2V4zkk';
const GEMINI_PROXY_URL = 'https://rrjkghhwwqcjyxniawou.supabase.co/functions/v1/macro-chat';
const OFF_SEARCH_PROXY_URL = 'https://rrjkghhwwqcjyxniawou.supabase.co/functions/v1/off-search';
// Free key from https://api.data.gov/signup — no cost, just a rate limit (1,000 req/hr on free tier)
const USDA_API_KEY = 'kRnYGiyTKW8hzu4rxOGaRIibp0Qg9JGkQaPrV762';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const STAT_DEFS = {
  STR: { label: 'Strength', icon: 'fitness_center' },
  VIT: { label: 'Vitality', icon: 'favorite' },
  INT: { label: 'Intelligence', icon: 'psychology' },
  DIS: { label: 'Discipline', icon: 'shield' },
  SPI: { label: 'Spirit', icon: 'auto_awesome' }
};

// No login — instead each device picks one of these two fixed profiles once
// (see the picker in app.js) and everything from then on is scoped to that
// profile's id, so food/quests/XP/weight never cross between the two of you.
// Ids must match the rows seeded in supabase-step11-remove-auth.sql /
// supabase-step12-second-profile.sql.
export const PROFILES = {
  tariq: { id: '20a9853b-9ef1-452d-862d-3479fa165559', label: 'Tariq' },
  hala: { id: '2789628f-a040-4668-9c6a-0b7c93166fb1', label: 'Hala' }
};

const ACTIVE_PROFILE_KEY = 'cal_active_profile';

export function getActiveProfileKey() {
  return localStorage.getItem(ACTIVE_PROFILE_KEY);
}

export function setActiveProfileKey(key) {
  localStorage.setItem(ACTIVE_PROFILE_KEY, key);
}

export function clearActiveProfileKey() {
  localStorage.removeItem(ACTIVE_PROFILE_KEY);
}

function currentUserId() {
  const profile = PROFILES[getActiveProfileKey()];
  return Promise.resolve(profile ? profile.id : null);
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
    { data: foodLog, error: fErr },
    { data: weightLog, error: wErr }
  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', uid).single(),
    supabase.from('quests').select('*').eq('user_id', uid).order('created_at'),
    supabase.from('completions').select('quest_id, done_on').eq('user_id', uid)
      .gte('done_on', new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10)),
    supabase.from('food_log').select('*').eq('user_id', uid).eq('logged_on', tKey).order('created_at'),
    supabase.from('weight_log').select('weight_kg, logged_on').eq('user_id', uid).order('logged_on')
  ]);

  if (pErr) throw pErr;
  if (qErr) throw qErr;
  if (cErr) throw cErr;
  if (fErr) throw fErr;
  if (wErr) throw wErr;

  // Recipes load separately and fail soft: if supabase-step10.sql hasn't been
  // run yet, the rest of the app still boots normally.
  let recipes = [];
  try {
    const { data: rRows, error: rErr } = await supabase
      .from('recipes').select('*').eq('user_id', uid).order('created_at');
    if (rErr) throw rErr;
    recipes = (rRows || []).map(mapRecipeRow);
  } catch (e) {
    console.warn('Recipes unavailable — run supabase-step10.sql in the SQL Editor.', e);
  }

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
      goal: profile.goal || 'maintain',
      goalWeightKg: profile.goal_weight_kg
    },
    foodLog: (foodLog || []).map((f) => ({
      id: f.id, name: f.name, calories: f.calories, protein: f.protein, carbs: f.carbs, fat: f.fat,
      source: f.source, meal: f.meal || 'snack'
    })),
    weightLog: (weightLog || []).map((w) => ({ date: w.logged_on, weight: w.weight_kg })),
    recipes
  };
}

// ---------- recipes ----------
function mapRecipeRow(r) {
  return {
    id: r.id, name: r.name, emoji: r.emoji || '🍲', servings: Number(r.servings) || 1,
    ingredients: Array.isArray(r.ingredients) ? r.ingredients : [],
    calories: r.calories, protein: Number(r.protein), carbs: Number(r.carbs), fat: Number(r.fat)
  };
}

// Insert when no id, update when id is present. Returns the saved recipe.
export async function saveRecipeRemote({ id, name, emoji, servings, ingredients, calories, protein, carbs, fat }) {
  const uid = await currentUserId();
  if (!uid) throw new Error('Not signed in');
  const row = {
    name, emoji, servings, ingredients,
    calories, protein, carbs, fat, updated_at: new Date().toISOString()
  };
  let res;
  if (id) {
    res = await supabase.from('recipes').update(row).eq('id', id).eq('user_id', uid).select().single();
  } else {
    res = await supabase.from('recipes').insert({ ...row, user_id: uid }).select().single();
  }
  if (res.error) throw res.error;
  return mapRecipeRow(res.data);
}

export async function deleteRecipeRemote(id) {
  const { error } = await supabase.from('recipes').delete().eq('id', id);
  if (error) throw error;
}

// ---------- profile / quests ----------
export async function saveProfile({ name, totalXP, stats }) {
  const uid = await currentUserId();
  if (!uid) throw new Error('Not signed in');
  const { error } = await supabase.from('profiles').update({ name, total_xp: totalXP, stats }).eq('id', uid);
  if (error) throw error;
}

// Saves body details, goal settings, and macro targets together (Profile tab "Save").
export async function saveProfileGoals({ heightCm, weightKg, age, sex, activityLevel, goal, goalWeightKg, targets }) {
  const uid = await currentUserId();
  if (!uid) throw new Error('Not signed in');
  const { error } = await supabase.from('profiles').update({
    height_cm: heightCm,
    weight_kg: weightKg,
    age,
    sex,
    activity_level: activityLevel,
    goal,
    goal_weight_kg: goalWeightKg,
    calorie_target: targets.calories,
    protein_target: targets.protein,
    carb_target: targets.carbs,
    fat_target: targets.fat
  }).eq('id', uid);
  if (error) throw error;
}

// One entry per day — logging again on the same day overwrites it.
export async function logWeight(weightKg) {
  const uid = await currentUserId();
  if (!uid) throw new Error('Not signed in');
  const { error } = await supabase.from('weight_log')
    .upsert({ user_id: uid, weight_kg: weightKg, logged_on: todayKey() }, { onConflict: 'user_id,logged_on' });
  if (error) throw error;
}

// ---------- water tracking (best-effort sync layer; app.js keeps localStorage
// as the instant/offline source of truth and merges this in on top) ----------
// Reads the last N days of glasses plus the saved goal for the active profile.
// Throws on any error (missing table, network, etc.) — the caller is expected
// to catch and fall back to localStorage-only if supabase-step14-water.sql
// hasn't been run yet.
export async function fetchWaterRemote(days = 14) {
  const uid = await currentUserId();
  if (!uid) return null;
  const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
  const [{ data: logRows, error: logErr }, { data: goalRow, error: goalErr }] = await Promise.all([
    supabase.from('water_log').select('logged_on, glasses').eq('user_id', uid).gte('logged_on', since),
    supabase.from('water_goal').select('glasses').eq('user_id', uid).maybeSingle()
  ]);
  if (logErr) throw logErr;
  if (goalErr) throw goalErr;
  const log = {};
  (logRows || []).forEach((r) => { log[r.logged_on] = r.glasses; });
  return { log, goal: goalRow ? goalRow.glasses : null };
}

export async function setWaterGlassesRemote(dateKey, glasses) {
  const uid = await currentUserId();
  if (!uid) return;
  const { error } = await supabase.from('water_log')
    .upsert({ user_id: uid, logged_on: dateKey, glasses }, { onConflict: 'user_id,logged_on' });
  if (error) throw error;
}

export async function setWaterGoalRemote(glasses) {
  const uid = await currentUserId();
  if (!uid) return;
  const { error } = await supabase.from('water_goal')
    .upsert({ user_id: uid, glasses, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
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

// Open Food Facts text search via our own Edge Function proxy — real access to
// OFF's full 3M+ product catalog, working around the browser CORS block.
export async function searchOpenFoodFactsProxy(query) {
  const res = await fetch(OFF_SEARCH_PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'apikey': SUPABASE_ANON_KEY
    },
    body: JSON.stringify({ query })
  });

  if (!res.ok) throw new Error('OFF search proxy failed (' + res.status + ')');
  const data = await res.json();
  if (data.error) throw new Error(data.error);

  return (data.results || []).map((r) => ({
    name: r.name, servingLabel: 'per 100g',
    calories: r.calories, protein: r.protein, carbs: r.carbs, fat: r.fat,
    source: 'off_proxy', mode: 'per100g'
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

// Edits an existing entry in place (Diary tab row tap → edit mode). Mirrors
// addFoodLogRemote's shape so the caller can swap the in-memory entry 1:1.
export async function updateFoodLogRemote(id, { name, calories, protein, carbs, fat, meal }) {
  const { data, error } = await supabase.from('food_log').update({
    name, calories,
    protein: protein || 0, carbs: carbs || 0, fat: fat || 0,
    meal: meal || 'snack'
  }).eq('id', id).select().single();
  if (error) throw error;
  return {
    id: data.id, name: data.name, calories: data.calories, protein: data.protein,
    carbs: data.carbs, fat: data.fat, source: data.source, meal: data.meal
  };
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
  const res = await fetch(GEMINI_PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
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
  if (level >= 60) return { label: 'S', color: '#c9971f', name: 'S-RANK' };
  if (level >= 45) return { label: 'A', color: '#a93349', name: 'A-RANK' };
  if (level >= 30) return { label: 'B', color: '#7c5cff', name: 'B-RANK' };
  if (level >= 20) return { label: 'C', color: '#006877', name: 'C-RANK' };
  if (level >= 10) return { label: 'D', color: '#3b82c4', name: 'D-RANK' };
  return { label: 'E', color: '#012d1d', name: 'E-RANK' };
}

export function todayKey(d) {
  d = d || new Date();
  return d.toISOString().slice(0, 10);
}
