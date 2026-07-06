import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://rrjkghhwwqcjyxniawou.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJyamtnaGh3d3Fjanl4bmlhd291Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyODI3ODEsImV4cCI6MjA5ODg1ODc4MX0.idKNtLfH_qMfCOI7URiS2vEcgceE2O16uvGMQ2V4zkk';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const STAT_DEFS = {
  STR: { label: 'Strength', icon: '💪' },
  VIT: { label: 'Vitality', icon: '❤️' },
  INT: { label: 'Intelligence', icon: '🧠' },
  DIS: { label: 'Discipline', icon: '🛡️' },
  SPI: { label: 'Spirit', icon: '✨' }
};

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

export async function loadData() {
  const uid = await currentUserId();
  if (!uid) throw new Error('Not signed in');
  const tKey = todayKey();

  const [{ data: profile, error: pErr }, { data: quests, error: qErr }, { data: completions, error: cErr }, { data: foodLog, error: fErr }] =
    await Promise.all([
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
    foodLog: (foodLog || []).map((f) => ({
      id: f.id, name: f.name, calories: f.calories, protein: f.protein, carbs: f.carbs, fat: f.fat, source: f.source
    }))
  };
}

export async function saveProfile({ name, totalXP, stats }) {
  const uid = await currentUserId();
  if (!uid) throw new Error('Not signed in');
  const { error } = await supabase.from('profiles').update({ name, total_xp: totalXP, stats }).eq('id', uid);
  if (error) throw error;
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
    const { error } = await supabase.from('completions').delete().eq('user_id', uid).eq('quest_id', questId).eq('done_on', dateKey);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('completions').insert({ user_id: uid, quest_id: questId, done_on: dateKey });
    if (error) throw error;
  }
}

export async function searchArabicFoods(query) {
  if (!query || !query.trim()) return [];
  const { data, error } = await supabase.from('arabic_foods').select('*').ilike('name', `%${query.trim()}%`).limit(8);
  if (error) throw error;
  return data;
}

export async function addFoodLogRemote({ name, calories, protein, carbs, fat, source }) {
  const uid = await currentUserId();
  if (!uid) throw new Error('Not signed in');
  const { data, error } = await supabase.from('food_log').insert({
    user_id: uid, name, calories,
    protein: protein || 0, carbs: carbs || 0, fat: fat || 0,
    source: source || 'manual', logged_on: todayKey()
  }).select().single();
  if (error) throw error;
  return { id: data.id, name: data.name, calories: data.calories, protein: data.protein, carbs: data.carbs, fat: data.fat, source: data.source };
}

export async function deleteFoodLogRemote(id) {
  const { error } = await supabase.from('food_log').delete().eq('id', id);
  if (error) throw error;
}

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