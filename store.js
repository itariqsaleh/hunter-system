/*
  store.js — data layer for the Hunter System app.
  Step 1: backed by localStorage (fully offline, on-device).
  Step 2 will swap the internals of these functions for Supabase calls
  without changing anything that calls loadData()/saveData() elsewhere.
*/

const STORAGE_KEY = 'hunter-system-data';

export const STAT_DEFS = {
  STR: { label: 'Strength', icon: '💪' },
  VIT: { label: 'Vitality', icon: '❤️' },
  INT: { label: 'Intelligence', icon: '🧠' },
  DIS: { label: 'Discipline', icon: '🛡️' },
  SPI: { label: 'Spirit', icon: '✨' }
};

export const DEFAULT_QUESTS = [
  { id: 'q1', name: 'Morning workout (15+ min)', stat: 'STR', xp: 15 },
  { id: 'q2', name: 'Drink 8 glasses of water', stat: 'VIT', xp: 10 },
  { id: 'q3', name: '30 min walk or cardio', stat: 'VIT', xp: 15 },
  { id: 'q4', name: 'Read or learn for 20 min', stat: 'INT', xp: 10 },
  { id: 'q5', name: 'Meditate or breathe for 10 min', stat: 'SPI', xp: 10 },
  { id: 'q6', name: 'Eat a balanced meal, skip junk', stat: 'DIS', xp: 15 },
  { id: 'q7', name: 'Sleep 7+ hours last night', stat: 'VIT', xp: 10 }
];

function defaultData() {
  const stats = {};
  Object.keys(STAT_DEFS).forEach((k) => (stats[k] = { xp: 0 }));
  return {
    name: 'Hunter',
    stats,
    totalXP: 0,
    quests: JSON.parse(JSON.stringify(DEFAULT_QUESTS)),
    completions: {} // { 'YYYY-MM-DD': [questId, ...] }
  };
}

export function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData();
    const data = JSON.parse(raw);
    // backfill in case of an older save shape
    if (!data.stats) data.stats = defaultData().stats;
    if (!data.completions) data.completions = {};
    if (!data.quests) data.quests = JSON.parse(JSON.stringify(DEFAULT_QUESTS));
    return data;
  } catch (e) {
    console.error('loadData failed, resetting to defaults', e);
    return defaultData();
  }
}

export function saveData(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.error('saveData failed', e);
    return false;
  }
}

export function resetData() {
  const fresh = defaultData();
  saveData(fresh);
  return fresh;
}

// ---------- leveling math (shared by app.js) ----------
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
