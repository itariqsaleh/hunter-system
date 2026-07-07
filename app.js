import {
  STAT_DEFS, loadData, saveProfile, saveProfileGoals, calculateTargets,
  addQuestRemote, deleteQuestRemote, toggleCompletionRemote,
  searchArabicFoods, searchUSDAFoods, searchUSDABranded, searchOpenFoodFactsProxy,
  addFoodLogRemote, deleteFoodLogRemote,
  lookupBarcode, saveCustomBarcode, logWeight,
  getOrCreateDailyBonus, markBonusAwarded, askCoach,
  overallLevel, statLevel, rankFromLevel, todayKey,
  PROFILES, getActiveProfileKey, setActiveProfileKey, clearActiveProfileKey
} from './store.js';

let data = null; // filled by loadData() once a profile is picked

const MEAL_DEFS = [
  { key: 'breakfast', label: 'Breakfast', icon: 'wb_twilight', bg: 'bg-primary-container text-on-primary-container' },
  { key: 'lunch', label: 'Lunch', icon: 'sunny', bg: 'bg-secondary-container text-on-secondary-container' },
  { key: 'dinner', label: 'Dinner', icon: 'bedtime', bg: 'bg-tertiary-container text-on-tertiary-container' },
  { key: 'snack', label: 'Snack', icon: 'restaurant', bg: 'bg-surface-container-highest text-on-surface-variant' }
];

// ---------- water tracker (localStorage, resets daily, scoped per profile) ----------
function waterTodayKey() { return `water_${getActiveProfileKey()}_` + new Date().toISOString().slice(0, 10); }
function waterHistoryKey(d) { return `wh_${getActiveProfileKey()}_` + d; }

function getWaterToday() { return parseInt(localStorage.getItem(waterTodayKey()) || '0'); }
function setWaterToday(n) {
  const key = waterTodayKey();
  localStorage.setItem(key, Math.max(0, n));
  // also persist in weekly history
  localStorage.setItem(waterHistoryKey(new Date().toISOString().slice(0, 10)), Math.max(0, n));
}
function getWaterGoal() { return parseInt(localStorage.getItem(`water_goal_${getActiveProfileKey()}`) || '8'); }
function setWaterGoal(n) { localStorage.setItem(`water_goal_${getActiveProfileKey()}`, Math.max(1, n)); }

function waterMsg(glasses, goal) {
  if (glasses === 0) return '💀 Zero water. Body cry.';
  if (glasses < Math.floor(goal * 0.4)) return '🏜️ Very dry. Drink more.';
  if (glasses < Math.floor(goal * 0.7)) return '👍 Getting there. Keep going.';
  if (glasses < goal) return '🌊 Almost there. One more!';
  return '🏆 Goal crushed. Hunter hydrated!';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- in-app toast (replaces native alert()) ----------
// type: 'error' | 'success' | 'info'
function toast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);

  // keep the stack short if toasts fire in rapid succession
  while (container.children.length > 3) {
    container.removeChild(container.firstChild);
  }

  setTimeout(() => {
    el.classList.add('toast-leave');
    setTimeout(() => el.remove(), 200);
  }, 2500);
}

// ---------- in-app confirm dialog (replaces native confirm()) ----------
// Returns a Promise<boolean> — resolves true on confirm, false on cancel/backdrop.
function confirmDialog(message, { confirmText = 'Confirm', cancelText = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('confirmOverlay');
    const msgEl = document.getElementById('confirmMessage');
    const cancelBtn = document.getElementById('confirmCancelBtn');
    const confirmBtn = document.getElementById('confirmConfirmBtn');

    msgEl.textContent = message;
    cancelBtn.textContent = cancelText;
    confirmBtn.textContent = confirmText;
    confirmBtn.style.background = danger ? 'var(--error)' : '';

    const cleanup = (result) => {
      overlay.classList.remove('open');
      cancelBtn.removeEventListener('click', onCancel);
      confirmBtn.removeEventListener('click', onConfirm);
      overlay.removeEventListener('click', onBackdrop);
      resolve(result);
    };
    const onCancel = () => cleanup(false);
    const onConfirm = () => cleanup(true);
    const onBackdrop = (e) => { if (e.target === overlay) cleanup(false); };

    cancelBtn.addEventListener('click', onCancel);
    confirmBtn.addEventListener('click', onConfirm);
    overlay.addEventListener('click', onBackdrop);
    overlay.classList.add('open');
  });
}

// ---------- profile picture (localStorage base64, scoped per profile) ----------
function getProfilePic() { return localStorage.getItem(`profile_pic_${getActiveProfileKey()}`) || null; }
function setProfilePic(dataUrl) { localStorage.setItem(`profile_pic_${getActiveProfileKey()}`, dataUrl); }

// One search across all four food sources — used by the food modal AND the recipe builder.
const SOURCE_ICON = { arabic_db: '🇯🇴', usda: '🧪', usda_branded: '🏭', off_proxy: '🌍' };

async function combinedFoodSearch(q) {
  const [arabicResults, usdaResults, usdaBrandedResults, offResults] = await Promise.all([
    searchArabicFoods(q).catch(() => []),
    searchUSDAFoods(q).catch(() => []),
    searchUSDABranded(q).catch(() => []),
    searchOpenFoodFactsProxy(q).catch(() => [])
  ]);
  return [...arabicResults, ...usdaResults, ...usdaBrandedResults, ...offResults];
}

// ---------- streak ----------
function allCompletedOn(dateKey) {
  if (!data) return false;
  const done = data.completions[dateKey] || [];
  return data.quests.length > 0 && data.quests.every((q) => done.includes(q.id));
}

function completionPctOn(dateKey) {
  if (!data || data.quests.length === 0) return 0;
  const done = data.completions[dateKey] || [];
  return Math.round((done.filter((id) => data.quests.some((q) => q.id === id)).length / data.quests.length) * 100);
}

function computeStreak() {
  let streak = 0;
  let cursor = new Date();
  if (!allCompletedOn(todayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (allCompletedOn(todayKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// ============================================================
// RENDER: master
// ============================================================
function render() {
  if (!data) return;
  renderHome();
  renderDiary();
  renderProgress();
  renderWater();
}

// ---------- HOME ----------
const RING_CIRCUMFERENCE = 2 * Math.PI * 44;

function renderHome() {
  document.getElementById('hunterName').textContent = data.name || 'Hunter';

  const ov = overallLevel(data.totalXP);
  const rank = rankFromLevel(ov.level);
  document.getElementById('rankLabel').textContent = `${rank.name} · LV ${ov.level}`;
  const badge = document.getElementById('rankBadge');
  badge.textContent = rank.label;
  badge.style.background = rank.color;
  document.getElementById('xpText').textContent = `${ov.remaining} / ${ov.need}`;
  const xpPct = Math.min(1, ov.remaining / ov.need);
  const xpRing = document.getElementById('xpRing');
  xpRing.setAttribute('stroke-dasharray', RING_CIRCUMFERENCE.toFixed(1));
  xpRing.setAttribute('stroke-dashoffset', (RING_CIRCUMFERENCE * (1 - xpPct)).toFixed(1));

  // quests
  const tKey = todayKey();
  const doneToday = data.completions[tKey] || [];
  const list = document.getElementById('questList');
  list.innerHTML = '';
  data.quests.forEach((q) => {
    const isDone = doneToday.includes(q.id);
    const def = STAT_DEFS[q.stat] || STAT_DEFS.STR;
    const row = document.createElement('div');
    row.className = `flex items-center gap-3 bg-surface-container-low rounded-xl p-sm shadow-card transition-opacity${isDone ? ' opacity-60' : ''}`;
    row.innerHTML = `
      <div class="quest-check w-8 h-8 rounded-full border-2 flex-shrink-0 flex items-center justify-center cursor-pointer transition-all ${isDone ? 'bg-primary border-primary text-on-primary' : 'border-outline-variant text-transparent'}" data-id="${q.id}">
        <span class="material-symbols-outlined text-lg">check</span>
      </div>
      <div class="flex-1 min-w-0">
        <div class="font-body-md font-semibold text-on-surface ${isDone ? 'line-through' : ''}">${escapeHtml(q.name)}</div>
        <div class="flex items-center gap-1 text-xs text-on-surface-variant font-semibold mt-0.5">
          <span class="material-symbols-outlined text-sm">${def.icon}</span>${def.label}
        </div>
      </div>
      <div class="font-label-md text-label-md text-secondary whitespace-nowrap">+${q.xp} XP</div>
      <button class="quest-del text-on-surface-variant/50 hover:text-error transition-colors" data-id="${q.id}" title="Delete quest">
        <span class="material-symbols-outlined text-lg">close</span>
      </button>
    `;
    list.appendChild(row);
  });
  list.querySelectorAll('.quest-check').forEach((el) => el.addEventListener('click', () => toggleQuest(el.dataset.id)));
  list.querySelectorAll('.quest-del').forEach((el) => el.addEventListener('click', () => deleteQuest(el.dataset.id)));

  document.getElementById('streakVal').textContent = computeStreak();

  // weekly activity chart — last 7 days, oldest to newest
  const chartEl = document.getElementById('activityChart');
  chartEl.innerHTML = '';
  const dayLetters = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const pct = completionPctOn(todayKey(d));
    const col = document.createElement('div');
    col.className = 'activity-col';
    col.innerHTML = `
      <div class="activity-track"><div class="activity-fill" style="height:${pct}%"></div></div>
      <div class="activity-label">${dayLetters[d.getDay()]}</div>
    `;
    chartEl.appendChild(col);
  }

  // recent activity feed: today's completed quests + today's food log
  const feedEl = document.getElementById('recentFeed');
  const feedItems = [];
  data.quests.forEach((q) => {
    if (doneToday.includes(q.id)) {
      const def = STAT_DEFS[q.stat] || STAT_DEFS.STR;
      feedItems.push({ type: 'quest', icon: def.icon, title: q.name, sub: `Quest · ${def.label}`, val: `+${q.xp} XP` });
    }
  });
  data.foodLog.forEach((f) => {
    feedItems.push({ type: 'food', icon: 'restaurant', title: f.name, sub: `Food · ${f.meal || 'snack'}`, val: `${f.calories} kcal` });
  });
  feedEl.innerHTML = feedItems.length
    ? feedItems.slice(-8).reverse().map((item) => `
        <div class="flex items-center gap-3 py-2.5 border-b border-outline-variant/20 last:border-0">
          <div class="w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center ${item.type === 'quest' ? 'bg-primary-container text-on-primary-container' : 'bg-secondary-container text-on-secondary-container'}">
            <span class="material-symbols-outlined text-lg">${item.icon}</span>
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-semibold text-on-surface">${escapeHtml(item.title)}</div>
            <div class="text-xs text-on-surface-variant mt-0.5">${item.sub}</div>
          </div>
          <div class="text-sm font-bold text-primary whitespace-nowrap">${item.val}</div>
        </div>`).join('')
    : `<div class="text-on-surface-variant text-sm text-center py-2">Nothing logged yet today.</div>`;
}

// ---------- DIARY (FOOD) ----------
function renderDiary() {
  const totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  data.foodLog.forEach((f) => {
    totals.calories += f.calories;
    totals.protein += f.protein;
    totals.carbs += f.carbs;
    totals.fat += f.fat;
  });

  const target = data.targets.calories || 1;
  const remaining = Math.max(0, target - totals.calories);
  const pctEaten = Math.min(1, totals.calories / target);
  document.getElementById('calRing').setAttribute('stroke-dasharray', RING_CIRCUMFERENCE.toFixed(1));
  document.getElementById('calRing').setAttribute('stroke-dashoffset', (RING_CIRCUMFERENCE * (1 - pctEaten)).toFixed(1));
  document.getElementById('calRemaining').textContent = Math.round(remaining);

  document.getElementById('proteinMini').textContent = `${Math.round(totals.protein)}g`;
  document.getElementById('carbsMini').textContent = `${Math.round(totals.carbs)}g`;
  document.getElementById('fatMini').textContent = `${Math.round(totals.fat)}g`;

  const mealCardsEl = document.getElementById('mealCards');
  mealCardsEl.innerHTML = '';
  MEAL_DEFS.forEach((meal) => {
    const items = data.foodLog.filter((f) => (f.meal || 'snack') === meal.key);
    const mealKcal = items.reduce((sum, f) => sum + f.calories, 0);
    const card = document.createElement('div');
    card.className = 'bg-surface-container-low p-md rounded-xl shadow-card flex flex-col';
    card.innerHTML = `
      <div class="flex items-center gap-2 mb-1">
        <div class="w-9 h-9 rounded-xl flex items-center justify-center ${meal.bg}"><span class="material-symbols-outlined text-lg">${meal.icon}</span></div>
        <h3 class="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider flex-1">${meal.label}</h3>
        <span class="font-stats-number text-sm text-primary font-bold">${mealKcal} kcal</span>
      </div>
      ${items.length ? items.map((f) => `
        <div class="flex items-center justify-between gap-2 py-2 border-t border-outline-variant/20">
          <div class="min-w-0">
            <div class="text-sm font-semibold text-on-surface truncate">${escapeHtml(f.name)}</div>
            <div class="text-xs text-on-surface-variant mt-0.5">P ${f.protein}g · C ${f.carbs}g · F ${f.fat}g</div>
          </div>
          <button class="meal-item-del text-on-surface-variant/50 hover:text-error transition-colors flex-shrink-0" data-id="${f.id}" title="Remove">
            <span class="material-symbols-outlined text-lg">close</span>
          </button>
        </div>`).join('') : `<div class="text-on-surface-variant text-sm italic py-2">Nothing logged yet.</div>`}
      <button class="meal-add-btn w-full mt-2 flex items-center justify-center gap-2 py-2 rounded-full border-2 border-secondary text-secondary font-label-md text-label-md hover:bg-secondary hover:text-on-secondary transition-all active:scale-95" data-meal="${meal.key}">
        <span class="material-symbols-outlined text-lg">add</span> Add
      </button>
    `;
    mealCardsEl.appendChild(card);
  });
  mealCardsEl.querySelectorAll('.meal-item-del').forEach((btn) => btn.addEventListener('click', () => deleteFood(btn.dataset.id)));
  mealCardsEl.querySelectorAll('.meal-add-btn').forEach((btn) => btn.addEventListener('click', () => {
    clearFoodForm();
    openFoodModal(btn.dataset.meal);
    setTimeout(() => document.getElementById('foodSearchInput').focus(), 50);
  }));
}

// ---------- PROGRESS ----------
function renderProgress() {
  const grid = document.getElementById('statGrid');
  grid.innerHTML = '';
  Object.keys(STAT_DEFS).forEach((key) => {
    const def = STAT_DEFS[key];
    const sxp = (data.stats[key] && data.stats[key].xp) || 0;
    const sl = statLevel(sxp);
    const pct = Math.min(100, (sl.remaining / sl.need) * 100);
    const row = document.createElement('div');
    row.className = 'space-y-1';
    row.innerHTML = `
      <div class="flex justify-between items-center">
        <span class="font-label-md text-label-md text-on-surface-variant flex items-center gap-1.5">
          <span class="material-symbols-outlined text-base">${def.icon}</span>${def.label}
        </span>
        <span class="font-label-md text-label-md text-primary">LV ${sl.level}</span>
      </div>
      <div class="h-3 w-full bg-surface-container-high rounded-full overflow-hidden">
        <div class="h-full bg-secondary-fixed transition-all duration-700" style="width:${pct}%; box-shadow:0 0 12px rgba(112,224,0,0.4);"></div>
      </div>
    `;
    grid.appendChild(row);
  });
}

function renderProfileTab() {
  const pd = data.profileDetails || {};
  document.getElementById('profileHeight').value = pd.heightCm || '';
  document.getElementById('profileWeight').value = pd.weightKg || '';
  document.getElementById('profileAge').value = pd.age || '';
  document.getElementById('profileSex').value = pd.sex || 'male';
  document.getElementById('profileActivity').value = pd.activityLevel || 'moderate';
  document.getElementById('profileGoal').value = pd.goal || 'maintain';
  document.getElementById('profileGoalWeight').value = pd.goalWeightKg || '';
  document.getElementById('targetCalories').value = data.targets.calories;
  document.getElementById('targetProtein').value = data.targets.protein;
  document.getElementById('targetCarbs').value = data.targets.carbs;
  document.getElementById('targetFat').value = data.targets.fat;

  // profile pic
  const pic = getProfilePic();
  const picEl = document.getElementById('profilePicDisplay');
  if (pic) {
    picEl.style.backgroundImage = `url(${pic})`;
    picEl.style.backgroundSize = 'cover';
    picEl.style.backgroundPosition = 'center';
    picEl.innerHTML = '';
  } else {
    picEl.style.backgroundImage = '';
    picEl.innerHTML = '<span class="material-symbols-outlined text-5xl text-on-primary-container">person</span>';
  }

  // hero name + rank
  const ov = overallLevel(data.totalXP);
  const rank = rankFromLevel(ov.level);
  document.getElementById('profileHeroName').textContent = data.name || 'Hunter';
  document.getElementById('profileHeroRank').textContent = `${rank.name} · LV ${ov.level}`;

  renderWeight();
}

// ---------- weight tracker (current / goal / trend) ----------
function latestWeight() {
  const log = data.weightLog || [];
  if (!log.length) return (data.profileDetails && data.profileDetails.weightKg) || null;
  return log[log.length - 1].weight;
}

function renderWeight() {
  const log = (data.weightLog || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const current = latestWeight();
  const goal = (data.profileDetails && data.profileDetails.goalWeightKg) || null;

  document.getElementById('weightCurrentVal').textContent = current != null ? `${current} kg` : '--';
  document.getElementById('weightGoalVal').textContent = goal != null ? `${goal} kg` : '--';

  const toGoEl = document.getElementById('weightToGoMsg');
  if (current != null && goal != null) {
    const diff = current - goal;
    if (Math.abs(diff) < 0.1) toGoEl.textContent = "You're at your goal weight!";
    else if (diff > 0) toGoEl.textContent = `${diff.toFixed(1)} kg to go (lose)`;
    else toGoEl.textContent = `${Math.abs(diff).toFixed(1)} kg to go (gain)`;
  } else {
    toGoEl.textContent = '';
  }

  // trend chart — last 14 logged days
  const chartEl = document.getElementById('weightChart');
  const captionEl = document.getElementById('weightChartCaption');
  const recent = log.slice(-14);
  chartEl.innerHTML = '';
  if (recent.length < 2) {
    chartEl.classList.add('hidden');
    captionEl.textContent = recent.length === 1
      ? 'Log another day to see your trend.'
      : 'No weight logged yet — log today to get started.';
    return;
  }
  chartEl.classList.remove('hidden');
  const weights = recent.map((w) => w.weight);
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  const range = max - min || 1;
  recent.forEach((w) => {
    const pct = Math.max(6, ((w.weight - min) / range) * 100);
    const d = new Date(w.date + 'T00:00:00');
    const col = document.createElement('div');
    col.className = 'activity-col';
    col.innerHTML = `
      <div class="activity-track"><div class="activity-fill" style="height:${pct}%"></div></div>
      <div class="activity-label">${d.getMonth() + 1}/${d.getDate()}</div>
    `;
    chartEl.appendChild(col);
  });
  captionEl.textContent = `Last ${recent.length} logged days`;
}

// ============================================================
// QUESTS
// ============================================================
async function toggleQuest(id) {
  const q = data.quests.find((q) => q.id === id);
  if (!q) return;
  const tKey = todayKey();
  const doneList = data.completions[tKey] || (data.completions[tKey] = []);
  const idx = doneList.indexOf(id);
  const wasDone = idx !== -1;

  const beforeOverall = overallLevel(data.totalXP).level;
  const beforeStat = statLevel((data.stats[q.stat] && data.stats[q.stat].xp) || 0).level;

  if (wasDone) {
    doneList.splice(idx, 1);
    data.totalXP = Math.max(0, data.totalXP - q.xp);
    data.stats[q.stat].xp = Math.max(0, data.stats[q.stat].xp - q.xp);
  } else {
    doneList.push(id);
    data.totalXP += q.xp;
    data.stats[q.stat].xp += q.xp;
  }
  render();

  try {
    await toggleCompletionRemote(id, tKey, wasDone);
    await saveProfile({ name: data.name, totalXP: data.totalXP, stats: data.stats });
  } catch (e) {
    console.error('toggleQuest failed, reverting', e);
    if (wasDone) { doneList.push(id); data.totalXP += q.xp; data.stats[q.stat].xp += q.xp; }
    else { doneList.splice(doneList.indexOf(id), 1); data.totalXP -= q.xp; data.stats[q.stat].xp -= q.xp; }
    render();
    toast('Could not save that — check your connection and try again.', 'error');
    return;
  }

  const afterOverall = overallLevel(data.totalXP).level;
  const afterStat = statLevel(data.stats[q.stat].xp).level;
  if (afterOverall > beforeOverall) showLevelUp(`LV ${afterOverall}`, `Overall level increased to ${afterOverall}.`);
  else if (afterStat > beforeStat) showLevelUp('LEVEL UP', `${STAT_DEFS[q.stat].label} increased to LV ${afterStat}.`);
}

async function deleteQuest(id) {
  const prevQuests = data.quests;
  data.quests = data.quests.filter((q) => q.id !== id);
  render();
  try {
    await deleteQuestRemote(id);
  } catch (e) {
    console.error('deleteQuest failed, reverting', e);
    data.quests = prevQuests;
    render();
    toast('Could not delete that quest — check your connection and try again.', 'error');
  }
}

// ============================================================
// FOOD
// ============================================================
async function deleteFood(id) {
  const prevLog = data.foodLog;
  data.foodLog = data.foodLog.filter((f) => f.id !== id);
  renderDiary();
  renderHome();
  try {
    await deleteFoodLogRemote(id);
  } catch (e) {
    console.error('deleteFood failed, reverting', e);
    data.foodLog = prevLog;
    renderDiary();
    renderHome();
    toast('Could not remove that entry — check your connection and try again.', 'error');
  }
}

async function logFood({ name, calories, protein, carbs, fat, source, meal }) {
  const entry = await addFoodLogRemote({ name, calories, protein, carbs, fat, source, meal });
  data.foodLog.push(entry);
  renderDiary();
  renderHome();
  checkMacroBonuses(source === 'recipe');
}

async function checkMacroBonuses(justLoggedRecipe = false) {
  const totals = { calories: 0, protein: 0 };
  data.foodLog.forEach((f) => { totals.calories += f.calories; totals.protein += f.protein; });

  try {
    const bonus = await getOrCreateDailyBonus();

    if (justLoggedRecipe && bonus.recipe_awarded === false) {
      await markBonusAwarded('recipe_awarded');
      data.stats.SPI.xp += 10;
      data.totalXP += 10;
      await saveProfile({ name: data.name, totalXP: data.totalXP, stats: data.stats });
      render();
      showLevelUp('HOME CHEF +10 XP', 'You cooked one of your own recipes today.');
      return;
    }

    if (!bonus.protein_awarded && data.targets.protein > 0 && totals.protein >= data.targets.protein) {
      data.stats.VIT.xp += 20;
      data.totalXP += 20;
      await saveProfile({ name: data.name, totalXP: data.totalXP, stats: data.stats });
      await markBonusAwarded('protein_awarded');
      render();
      showLevelUp('BONUS +20 XP', 'Hit your protein target today.');
      return;
    }

    if (!bonus.calorie_awarded && data.targets.calories > 0) {
      const pct = totals.calories / data.targets.calories;
      if (pct >= 0.85 && pct <= 1.1) {
        data.stats.DIS.xp += 15;
        data.totalXP += 15;
        await saveProfile({ name: data.name, totalXP: data.totalXP, stats: data.stats });
        await markBonusAwarded('calorie_awarded');
        render();
        showLevelUp('BONUS +15 XP', 'Stayed on target with calories today.');
      }
    }
  } catch (e) {
    console.error('bonus check failed', e);
  }
}

// ============================================================
// WATER TRACKER
// ============================================================
function renderWater() {
  const glasses = getWaterToday();
  const goal = getWaterGoal();
  const pct = Math.min(1, glasses / goal);
  const ringEl = document.getElementById('waterRing');
  if (ringEl) {
    ringEl.setAttribute('stroke-dasharray', RING_CIRCUMFERENCE.toFixed(1));
    ringEl.setAttribute('stroke-dashoffset', (RING_CIRCUMFERENCE * (1 - pct)).toFixed(1));
  }
  const numEl = document.getElementById('waterNum');
  if (numEl) numEl.textContent = glasses;
  const labelEl = document.getElementById('waterLabel');
  if (labelEl) labelEl.textContent = `/ ${goal} glasses`;
  const msgEl = document.getElementById('waterMsg');
  if (msgEl) msgEl.textContent = waterMsg(glasses, goal);
  document.getElementById('waterGoalInput').value = goal;
  renderWaterChart();
}

// ============================================================
// WATER CHART
// ============================================================
function renderWaterChart() {
  const chartEl = document.getElementById('waterChart');
  if (!chartEl) return;
  const goal = getWaterGoal();
  const dayLetters = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  chartEl.innerHTML = '';
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const glasses = parseInt(localStorage.getItem(waterHistoryKey(d.toISOString().slice(0, 10))) || '0');
    const pct = goal > 0 ? Math.min(100, (glasses / goal) * 100) : 0;
    const col = document.createElement('div');
    col.className = 'activity-col';
    col.innerHTML = `
      <div class="activity-track"><div class="activity-fill" style="height:${pct}%; background:#326b00;"></div></div>
      <div class="activity-label">${dayLetters[d.getDay()]}</div>
    `;
    chartEl.appendChild(col);
  }
}

// ============================================================
// LEVEL UP OVERLAY
// ============================================================
let luTimeout;
function showLevelUp(titleText, subtext) {
  const overlay = document.getElementById('levelupOverlay');
  document.getElementById('luLevelText').textContent = titleText;
  document.getElementById('luSub').textContent = subtext;
  overlay.classList.add('show');
  clearTimeout(luTimeout);
  luTimeout = setTimeout(() => overlay.classList.remove('show'), 2200);
}

// ============================================================
// BOOT
// ============================================================
function showBootLoader() {
  const el = document.getElementById('bootLoader');
  if (el) el.classList.add('show');
}
function hideBootLoader() {
  const el = document.getElementById('bootLoader');
  if (el) el.classList.remove('show');
}

async function bootApp() {
  showBootLoader();
  restoreCoachHistory();
  try {
    data = await loadData();
    render();
    renderProfileTab();
    renderWater();
    hideBootLoader();
    checkMacroBonuses();
  } catch (e) {
    console.error('loadData failed', e);
    hideBootLoader();
    toast('Could not load your data — pull to refresh.', 'error');
  }
}

// ============================================================
// WELCOME SPLASH
// ============================================================
const WELCOME_SEEN_KEY = 'cal_welcome_seen';
function showWelcomeSplashIfNeeded() {
  const splash = document.getElementById('welcomeSplash');
  if (localStorage.getItem(WELCOME_SEEN_KEY)) {
    splash.remove();
    return;
  }
  localStorage.setItem(WELCOME_SEEN_KEY, '1');
  splash.classList.add('show');
  setTimeout(() => {
    splash.classList.add('dismiss');
    setTimeout(() => splash.remove(), 600);
  }, 2500);
}

// ============================================================
// PROFILE PICKER — one device, one of two fixed people, no password
// ============================================================
function updateActiveProfileTag() {
  const profile = PROFILES[getActiveProfileKey()];
  document.getElementById('activeProfileTag').textContent = profile ? `· ${profile.label}` : '';
}

function initProfilePicker() {
  document.querySelectorAll('.profile-picker-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      setActiveProfileKey(btn.dataset.profile);
      document.getElementById('profilePicker').classList.remove('show');
      updateActiveProfileTag();
      await bootApp();
    });
  });

  document.getElementById('switchProfileBtn').addEventListener('click', async () => {
    const ok = await confirmDialog('Switch to the other profile on this device?', { confirmText: 'Switch' });
    if (!ok) return;
    clearActiveProfileKey();
    location.reload();
  });
}

// ============================================================
// TABS
// ============================================================
function initTabs() {
  const buttons = document.querySelectorAll('.tab-btn');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'tab-profile') renderProfileTab();
    });
  });
}

// ============================================================
// BARCODE SCANNER
// ============================================================
let html5QrCode = null;
let lastScannedBarcode = null;

async function openScanner() {
  const overlay = document.getElementById('scannerOverlay');
  const statusEl = document.getElementById('scannerStatus');
  statusEl.textContent = 'Point your camera at a barcode...';
  overlay.classList.add('open');

  try {
    html5QrCode = new Html5Qrcode('qr-reader');
    const formats = [
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E
    ];
    await html5QrCode.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: 220, formatsToSupport: formats },
      onScanSuccess,
      () => {}
    );
  } catch (e) {
    console.error('scanner start failed', e);
    statusEl.textContent = 'Could not access the camera. Check permissions and try again.';
  }
}

async function closeScanner() {
  const overlay = document.getElementById('scannerOverlay');
  overlay.classList.remove('open');
  if (html5QrCode) {
    try { await html5QrCode.stop(); await html5QrCode.clear(); } catch (e) { /* already stopped */ }
    html5QrCode = null;
  }
}

async function onScanSuccess(decodedText) {
  const statusEl = document.getElementById('scannerStatus');
  statusEl.textContent = 'Found a barcode, looking it up...';
  try {
    const product = await lookupBarcode(decodedText);
    await closeScanner();
    lastScannedBarcode = decodedText;
    if (!product) {
      toast('Not found — enter it manually below, then tick "Remember this barcode" so next scan auto-fills it.', 'error');
      clearFoodForm();
      openFoodModal();
      document.getElementById('unitField').style.display = 'block';
      document.getElementById('rememberBarcodeField').style.display = 'block';
      return;
    }
    clearFoodForm();
    openFoodModal();
    applyFoodBase(product);
  } catch (e) {
    console.error('barcode lookup failed', e);
    await closeScanner();
    toast('Could not look up that barcode — check your connection and try again.', 'error');
  }
}

// ============================================================
// COACH
// ============================================================
const COACH_HISTORY_LIMIT = 50;
function coachHistoryKey() { return `coach_history_${getActiveProfileKey()}`; }

function loadCoachHistory() {
  try {
    return JSON.parse(localStorage.getItem(coachHistoryKey()) || '[]');
  } catch (e) {
    return [];
  }
}

function saveCoachMessage(text, who) {
  const history = loadCoachHistory();
  history.push({ text, who });
  const trimmed = history.slice(-COACH_HISTORY_LIMIT);
  localStorage.setItem(coachHistoryKey(), JSON.stringify(trimmed));
}

// Restores saved chat history into #coachMessages on boot. If there's no
// history yet, the initial greeting bubble already in the markup stays put.
function restoreCoachHistory() {
  const history = loadCoachHistory();
  if (!history.length) return;
  const wrap = document.getElementById('coachMessages');
  wrap.innerHTML = '';
  history.forEach((m) => appendCoachMessage(m.text, m.who));
}

function appendCoachMessage(text, who) {
  const wrap = document.getElementById('coachMessages');
  const isUser = who === 'user';
  const row = document.createElement('div');
  row.className = `flex gap-3 max-w-[85%] ${isUser ? 'ml-auto flex-row-reverse' : ''}`;
  row.innerHTML = `
    <div class="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center ${isUser ? 'bg-secondary-fixed text-on-secondary-fixed' : 'bg-primary text-on-primary'}">
      <span class="material-symbols-outlined text-sm">${isUser ? 'person' : 'smart_toy'}</span>
    </div>
    <div class="p-sm rounded-xl shadow-card ${isUser ? 'bg-primary text-on-primary rounded-tr-none' : 'bg-surface-container-low text-on-surface rounded-tl-none'}">
      <p class="coach-msg-text font-body-md text-body-md"></p>
    </div>
  `;
  const textEl = row.querySelector('.coach-msg-text');
  textEl.textContent = text;
  wrap.appendChild(row);
  row.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return textEl;
}

async function sendCoachMessage() {
  const input = document.getElementById('coachInput');
  const sendBtn = document.getElementById('coachSendBtn');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  appendCoachMessage(msg, 'user');
  saveCoachMessage(msg, 'user');

  input.disabled = true;
  sendBtn.disabled = true;

  const loadingEl = appendCoachMessage('Thinking...', 'bot');
  loadingEl.classList.add('italic', 'text-on-surface-variant');

  try {
    const reply = await askCoach(msg);
    loadingEl.textContent = reply;
    loadingEl.classList.remove('italic', 'text-on-surface-variant');
    saveCoachMessage(reply, 'bot');
  } catch (e) {
    console.error('coach request failed', e);
    const errText = "Couldn't reach the coach — check your connection and that the Edge Function is deployed.";
    loadingEl.textContent = errText;
    loadingEl.classList.remove('italic', 'text-on-surface-variant');
    saveCoachMessage(errText, 'bot');
  } finally {
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

// ============================================================
// MODAL HELPERS (food)
// ============================================================
let foodBase = null;
const GRAMS_PER_UNIT = { g: 1, tsp: 5, tbsp: 15, cup: 240 };

function applyFoodBase(food) {
  foodBase = { calories: food.calories, protein: food.protein, carbs: food.carbs, fat: food.fat, mode: food.mode };
  document.getElementById('foodNameInput').value = food.name;

  if (food.mode === 'per100g') {
    document.getElementById('servingsField').style.display = 'none';
    document.getElementById('unitField').style.display = 'block';
    document.getElementById('foodAmountInput').value = 100;
    document.getElementById('foodUnitInput').value = 'g';
    fillFieldsFromGrams(100);
  } else {
    document.getElementById('unitField').style.display = 'none';
    document.getElementById('servingsField').style.display = 'block';
    document.getElementById('servingsLabel').textContent = `Quantity (x ${food.servingLabel || '1 serving'})`;
    document.getElementById('foodServingsInput').value = 1;
    fillFieldsFromServings(1);
  }

  document.getElementById('rememberBarcodeField').style.display = lastScannedBarcode ? 'block' : 'none';
}

function fillFieldsFromServings(servings) {
  if (!foodBase) return;
  document.getElementById('foodCalInput').value = Math.round(foodBase.calories * servings);
  document.getElementById('foodProteinInput').value = Math.round(foodBase.protein * servings * 10) / 10;
  document.getElementById('foodCarbsInput').value = Math.round(foodBase.carbs * servings * 10) / 10;
  document.getElementById('foodFatInput').value = Math.round(foodBase.fat * servings * 10) / 10;
}

function fillFieldsFromGrams(grams) {
  if (!foodBase) return;
  const multiplier = grams / 100;
  document.getElementById('foodCalInput').value = Math.round(foodBase.calories * multiplier);
  document.getElementById('foodProteinInput').value = Math.round(foodBase.protein * multiplier * 10) / 10;
  document.getElementById('foodCarbsInput').value = Math.round(foodBase.carbs * multiplier * 10) / 10;
  document.getElementById('foodFatInput').value = Math.round(foodBase.fat * multiplier * 10) / 10;
}

function recomputeFromUnitInputs() {
  const amount = parseFloat(document.getElementById('foodAmountInput').value) || 0;
  const unit = document.getElementById('foodUnitInput').value;
  const grams = amount * (GRAMS_PER_UNIT[unit] || 1);
  fillFieldsFromGrams(grams);
}

function openFoodModal(presetMeal) {
  document.getElementById('foodMealInput').value = presetMeal || defaultMealForNow();
  document.getElementById('foodModalOverlay').classList.add('open');
}

function defaultMealForNow() {
  const h = new Date().getHours();
  if (h < 11) return 'breakfast';
  if (h < 16) return 'lunch';
  if (h < 21) return 'dinner';
  return 'snack';
}

function clearFoodForm() {
  foodBase = null;
  lastScannedBarcode = null;
  document.getElementById('foodSearchInput').value = '';
  document.getElementById('foodNameInput').value = '';
  document.getElementById('foodCalInput').value = '';
  document.getElementById('foodProteinInput').value = '';
  document.getElementById('foodCarbsInput').value = '';
  document.getElementById('foodFatInput').value = '';
  document.getElementById('servingsField').style.display = 'none';
  document.getElementById('unitField').style.display = 'none';
  document.getElementById('rememberBarcodeField').style.display = 'none';
  document.getElementById('rememberBarcodeCheckbox').checked = false;
  document.getElementById('foodSearchResults').innerHTML = '';
}

// ============================================================
// EVENT WIRING
// ============================================================
function initAppEvents() {
  document.getElementById('hunterName').addEventListener('blur', async (e) => {
    const newName = e.target.textContent.trim() || 'Hunter';
    if (newName === data.name) return;
    data.name = newName;
    try {
      await saveProfile({ name: data.name, totalXP: data.totalXP, stats: data.stats });
    } catch (err) {
      console.error('rename failed', err);
    }
  });

  document.getElementById('levelupOverlay').addEventListener('click', () => {
    document.getElementById('levelupOverlay').classList.remove('show');
  });

  // ---- quest modal ----
  const questOverlayEl = document.getElementById('modalOverlay');
  document.getElementById('addQuestBtn').addEventListener('click', () => {
    document.getElementById('questNameInput').value = '';
    document.getElementById('questXpInput').value = 10;
    questOverlayEl.classList.add('open');
    setTimeout(() => document.getElementById('questNameInput').focus(), 50);
  });
  document.getElementById('cancelQuestBtn').addEventListener('click', () => questOverlayEl.classList.remove('open'));
  questOverlayEl.addEventListener('click', (e) => { if (e.target === questOverlayEl) questOverlayEl.classList.remove('open'); });

  document.getElementById('saveQuestBtn').addEventListener('click', async () => {
    const name = document.getElementById('questNameInput').value.trim();
    const stat = document.getElementById('questStatInput').value;
    const xp = Math.max(1, parseInt(document.getElementById('questXpInput').value) || 10);
    if (!name) return;
    questOverlayEl.classList.remove('open');
    try {
      const newQuest = await addQuestRemote({ name, stat, xp });
      data.quests.push(newQuest);
      render();
    } catch (e) {
      console.error('addQuest failed', e);
      toast('Could not add that quest — check your connection and try again.', 'error');
    }
  });

  document.getElementById('resetBtn').addEventListener('click', async () => {
    const ok = await confirmDialog('Reset your XP and stats back to zero? Quests and history stay.', { confirmText: 'Reset', danger: true });
    if (!ok) return;
    data.totalXP = 0;
    Object.keys(data.stats).forEach((k) => (data.stats[k].xp = 0));
    render();
    try {
      await saveProfile({ name: data.name, totalXP: 0, stats: data.stats });
    } catch (e) {
      console.error('reset failed', e);
    }
  });

  // ---- food modal ----
  const foodOverlayEl = document.getElementById('foodModalOverlay');
  const foodSearchInput = document.getElementById('foodSearchInput');
  const foodResultsEl = document.getElementById('foodSearchResults');
  const servingsInput = document.getElementById('foodServingsInput');
  const amountInput = document.getElementById('foodAmountInput');
  const unitInput = document.getElementById('foodUnitInput');

  document.getElementById('scanBarcodeBtn').addEventListener('click', openScanner);
  document.getElementById('cancelScanBtn').addEventListener('click', closeScanner);

  document.getElementById('cancelFoodBtn').addEventListener('click', () => foodOverlayEl.classList.remove('open'));
  foodOverlayEl.addEventListener('click', (e) => { if (e.target === foodOverlayEl) foodOverlayEl.classList.remove('open'); });

  servingsInput.addEventListener('input', () => fillFieldsFromServings(parseFloat(servingsInput.value) || 0));
  amountInput.addEventListener('input', recomputeFromUnitInputs);
  unitInput.addEventListener('change', recomputeFromUnitInputs);

  let searchDebounce;
  foodSearchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    const q = foodSearchInput.value;
    searchDebounce = setTimeout(async () => {
      if (!q.trim()) { foodResultsEl.innerHTML = ''; return; }
      try {
        const results = await combinedFoodSearch(q);
        foodResultsEl.innerHTML = results.map((f, i) => `
          <div class="food-search-item flex justify-between items-center gap-2 bg-surface-container-low rounded-lg px-3 py-2 cursor-pointer hover:bg-surface-container-high transition-colors" data-idx="${i}">
            <span class="text-sm text-on-surface">${SOURCE_ICON[f.source] || '🍽️'} ${escapeHtml(f.name)} <span class="text-on-surface-variant text-xs">(${escapeHtml(f.servingLabel)})</span></span>
            <span class="text-xs font-semibold text-on-surface-variant whitespace-nowrap">${f.calories} kcal</span>
          </div>`).join('') || `<div class="text-on-surface-variant text-xs p-1">No matches — enter manually below.</div>`;
        foodResultsEl.querySelectorAll('.food-search-item').forEach((el) => {
          el.addEventListener('click', () => {
            lastScannedBarcode = null;
            applyFoodBase(results[parseInt(el.dataset.idx)]);
          });
        });
      } catch (e) {
        console.error('food search failed', e);
      }
    }, 300);
  });

  document.getElementById('saveFoodBtn').addEventListener('click', async () => {
    const name = document.getElementById('foodNameInput').value.trim();
    const calories = parseInt(document.getElementById('foodCalInput').value) || 0;
    const protein = parseFloat(document.getElementById('foodProteinInput').value) || 0;
    const carbs = parseFloat(document.getElementById('foodCarbsInput').value) || 0;
    const fat = parseFloat(document.getElementById('foodFatInput').value) || 0;
    const meal = document.getElementById('foodMealInput').value;
    if (!name || calories <= 0) { toast('Enter at least a food name and calories.', 'error'); return; }

    const shouldRemember = lastScannedBarcode && document.getElementById('rememberBarcodeCheckbox').checked;
    foodOverlayEl.classList.remove('open');

    try {
      await logFood({ name, calories, protein, carbs, fat, source: foodBase ? 'database' : 'manual', meal });
      if (shouldRemember) {
        const amount = parseFloat(amountInput.value) || 100;
        const unit = unitInput.value;
        const grams = amount * (GRAMS_PER_UNIT[unit] || 1);
        const per100Multiplier = 100 / grams;
        await saveCustomBarcode(lastScannedBarcode, {
          name,
          calories: Math.round(calories * per100Multiplier),
          protein: Math.round(protein * per100Multiplier * 10) / 10,
          carbs: Math.round(carbs * per100Multiplier * 10) / 10,
          fat: Math.round(fat * per100Multiplier * 10) / 10
        });
      }
    } catch (e) {
      console.error('log food failed', e);
      toast('Could not log that food — check your connection and try again.', 'error');
    }
  });

  // ---- profile / goals ----
  document.getElementById('calcTargetsBtn').addEventListener('click', () => {
    const heightCm = parseFloat(document.getElementById('profileHeight').value);
    const weightKg = parseFloat(document.getElementById('profileWeight').value);
    const age = parseInt(document.getElementById('profileAge').value);
    const sex = document.getElementById('profileSex').value;
    const activityLevel = document.getElementById('profileActivity').value;
    const goal = document.getElementById('profileGoal').value;
    if (!heightCm || !weightKg || !age) {
      toast('Fill in height, weight, and age first.', 'error');
      return;
    }
    const targets = calculateTargets({ heightCm, weightKg, age, sex, activityLevel, goal });
    document.getElementById('targetCalories').value = targets.calories;
    document.getElementById('targetProtein').value = targets.protein;
    document.getElementById('targetCarbs').value = targets.carbs;
    document.getElementById('targetFat').value = targets.fat;
  });

  document.getElementById('saveGoalsBtn').addEventListener('click', async () => {
    const heightCm = parseFloat(document.getElementById('profileHeight').value) || null;
    const weightKg = parseFloat(document.getElementById('profileWeight').value) || null;
    const age = parseInt(document.getElementById('profileAge').value) || null;
    const sex = document.getElementById('profileSex').value;
    const activityLevel = document.getElementById('profileActivity').value;
    const goal = document.getElementById('profileGoal').value;
    const goalWeightKg = parseFloat(document.getElementById('profileGoalWeight').value) || null;
    const targets = {
      calories: parseInt(document.getElementById('targetCalories').value) || 0,
      protein: parseInt(document.getElementById('targetProtein').value) || 0,
      carbs: parseInt(document.getElementById('targetCarbs').value) || 0,
      fat: parseInt(document.getElementById('targetFat').value) || 0
    };
    const msgEl = document.getElementById('goalsSavedMsg');
    try {
      await saveProfileGoals({ heightCm, weightKg, age, sex, activityLevel, goal, goalWeightKg, targets });
      data.targets = targets;
      data.profileDetails = { heightCm, weightKg, age, sex, activityLevel, goal, goalWeightKg };
      renderDiary();
      renderProgress();
      msgEl.style.color = '#1b4332';
      msgEl.textContent = 'Saved!';
      setTimeout(() => { msgEl.textContent = ''; }, 2000);
    } catch (e) {
      console.error('saveProfileGoals failed', e);
      msgEl.style.color = '#ba1a1a';
      msgEl.textContent = 'Could not save — check your connection.';
    }
  });

  // ---- coach chat ----
  document.getElementById('coachSendBtn').addEventListener('click', sendCoachMessage);
  document.getElementById('coachInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendCoachMessage();
  });

  // ---- water tracker ----
  document.getElementById('waterAddBtn').addEventListener('click', () => {
    setWaterToday(getWaterToday() + 1);
    renderWater();
  });
  document.getElementById('waterRemoveBtn').addEventListener('click', () => {
    setWaterToday(getWaterToday() - 1);
    renderWater();
  });
  document.getElementById('saveWaterGoalBtn').addEventListener('click', () => {
    const v = parseInt(document.getElementById('waterGoalInput').value);
    if (v > 0) { setWaterGoal(v); renderWater(); }
  });

  // ---- profile picture ----
  document.getElementById('profilePicBtn').addEventListener('click', () => {
    document.getElementById('profilePicInput').click();
  });
  document.getElementById('profilePicInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setProfilePic(ev.target.result);
      renderProfileTab();
    };
    reader.readAsDataURL(file);
  });

  // ---- weight tracker ----
  const weightOverlayEl = document.getElementById('weightModalOverlay');
  document.getElementById('logWeightBtn').addEventListener('click', () => {
    const current = latestWeight();
    document.getElementById('weightInput').value = current || '';
    weightOverlayEl.classList.add('open');
    setTimeout(() => document.getElementById('weightInput').focus(), 50);
  });
  document.getElementById('cancelWeightBtn').addEventListener('click', () => weightOverlayEl.classList.remove('open'));
  weightOverlayEl.addEventListener('click', (e) => { if (e.target === weightOverlayEl) weightOverlayEl.classList.remove('open'); });

  document.getElementById('saveWeightBtn').addEventListener('click', async () => {
    const val = parseFloat(document.getElementById('weightInput').value);
    if (!val || val <= 0) { toast('Enter a valid weight.', 'error'); return; }
    weightOverlayEl.classList.remove('open');

    const tKey = todayKey();
    const prevLog = data.weightLog;
    data.weightLog = (data.weightLog || []).filter((w) => w.date !== tKey);
    data.weightLog.push({ date: tKey, weight: val });
    renderWeight();

    try {
      await logWeight(val);
    } catch (e) {
      console.error('logWeight failed, reverting', e);
      data.weightLog = prevLog;
      renderWeight();
      toast('Could not save that — check your connection and try again.', 'error');
    }
  });

  // ---- PWA install prompt ----
  let deferredPrompt;
  const banner = document.getElementById('installBanner');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    banner.classList.add('show');
  });
  document.getElementById('installBtn').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    banner.classList.remove('show');
  });
  window.addEventListener('appinstalled', () => banner.classList.remove('show'));
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch((e) => console.error('SW registration failed', e));
  });
}

(async function init() {
  showWelcomeSplashIfNeeded();
  initAppEvents();
  initProfilePicker();
  initTabs();
  if (getActiveProfileKey()) {
    updateActiveProfileTag();
    await bootApp();
  } else {
    document.getElementById('profilePicker').classList.add('show');
  }
})();
