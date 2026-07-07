import {
  STAT_DEFS, loadData, saveProfile, saveProfileGoals, calculateTargets,
  addQuestRemote, deleteQuestRemote, toggleCompletionRemote,
  searchArabicFoods, searchUSDAFoods, searchUSDABranded, searchOpenFoodFactsProxy,
  addFoodLogRemote, deleteFoodLogRemote,
  lookupBarcode, saveCustomBarcode, logWeight,
  saveRecipeRemote, deleteRecipeRemote,
  getOrCreateDailyBonus, markBonusAwarded, askCoach,
  overallLevel, statLevel, rankFromLevel, todayKey,
  getSession, signUpWithEmail, signInWithEmail, signOut, onAuthChange
} from './store.js';

let data = null; // filled by loadData() once signed in

const MEAL_DEFS = [
  { key: 'breakfast', label: 'Breakfast', icon: '🌅', bg: 'var(--primary-container)' },
  { key: 'lunch', label: 'Lunch', icon: '☀️', bg: 'var(--secondary-container)' },
  { key: 'dinner', label: 'Dinner', icon: '🌙', bg: 'var(--tertiary-container)' },
  { key: 'snack', label: 'Snack', icon: '🍿', bg: 'var(--surface-container-highest)' }
];

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// One search across all four food sources — used by the food modal AND the recipe builder.
const SOURCE_ICON = { arabic_db: '🇯🇴', usda: '🧪', usda_branded: '🏭', off_proxy: '🌍' };

async function combinedFoodSearch(q) {
  const [arabicResults, usdaResults, usdaBrandedResults, offResults] = await Promise.all([
    searchArabicFoods(q).catch((e) => { console.error('arabic search failed', e); return []; }),
    searchUSDAFoods(q).catch((e) => { console.error('usda search failed', e); return []; }),
    searchUSDABranded(q).catch((e) => { console.error('usda branded search failed', e); return []; }),
    searchOpenFoodFactsProxy(q).catch((e) => { console.error('off proxy search failed', e); return []; })
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
  renderRecipes();
}

// ---------- HOME ----------
function renderHome() {
  document.getElementById('hunterName').textContent = data.name || 'Hunter';

  const ov = overallLevel(data.totalXP);
  const rank = rankFromLevel(ov.level);
  document.getElementById('rankLabel').textContent = `${rank.name} · LV ${ov.level}`;
  const badge = document.getElementById('rankBadge');
  badge.textContent = rank.label;
  badge.style.setProperty('--rank-color', rank.color);
  document.getElementById('xpText').textContent = `${ov.remaining} / ${ov.need}`;
  document.getElementById('xpBar').style.width = Math.min(100, (ov.remaining / ov.need) * 100) + '%';

  // quests
  const tKey = todayKey();
  const doneToday = data.completions[tKey] || [];
  const list = document.getElementById('questList');
  list.innerHTML = '';
  data.quests.forEach((q) => {
    const isDone = doneToday.includes(q.id);
    const def = STAT_DEFS[q.stat] || STAT_DEFS.STR;
    const row = document.createElement('div');
    row.className = 'quest' + (isDone ? ' done' : '');
    row.innerHTML = `
      <div class="quest-check" data-id="${q.id}">✓</div>
      <div class="quest-body">
        <div class="quest-name">${escapeHtml(q.name)}</div>
        <div class="quest-meta">${def.icon} ${def.label}</div>
      </div>
      <div class="quest-xp">+${q.xp} XP</div>
      <button class="quest-del" data-id="${q.id}" title="Delete quest">✕</button>
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
    feedItems.push({ type: 'food', icon: '🍽️', title: f.name, sub: `Food · ${f.meal || 'snack'}`, val: `${f.calories} kcal` });
  });
  feedEl.innerHTML = feedItems.length
    ? feedItems.slice(-8).reverse().map((item) => `
        <div class="feed-row">
          <div class="feed-icon ${item.type}">${item.icon}</div>
          <div class="feed-body">
            <div class="feed-title">${escapeHtml(item.title)}</div>
            <div class="feed-sub">${item.sub}</div>
          </div>
          <div class="feed-val">${item.val}</div>
        </div>`).join('')
    : `<div style="color:var(--outline); font-size:13px; text-align:center; padding:8px 0;">Nothing logged yet today.</div>`;
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
  const circumference = 2 * Math.PI * 64;
  const pctEaten = Math.min(1, totals.calories / target);
  document.getElementById('calRing').setAttribute('stroke-dasharray', circumference.toFixed(1));
  document.getElementById('calRing').setAttribute('stroke-dashoffset', (circumference * (1 - pctEaten)).toFixed(1));
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
    card.className = 'glass-card meal-card';
    card.innerHTML = `
      <div class="meal-head">
        <div class="meal-head-left">
          <div class="meal-icon" style="background:${meal.bg};">${meal.icon}</div>
          <div class="meal-title">${meal.label}</div>
        </div>
        <div class="meal-kcal">${mealKcal} kcal</div>
      </div>
      ${items.length ? items.map((f) => `
        <div class="meal-item">
          <div>
            <div class="meal-item-name">${escapeHtml(f.name)}</div>
            <div class="meal-item-macro">P ${f.protein}g · C ${f.carbs}g · F ${f.fat}g</div>
          </div>
          <button class="meal-item-del" data-id="${f.id}" title="Remove">✕</button>
        </div>`).join('') : `<div class="meal-empty">Nothing logged yet.</div>`}
      <button class="meal-add-btn" data-meal="${meal.key}">+ Add ${meal.label}</button>
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
    const card = document.createElement('div');
    card.className = 'stat-card';
    card.innerHTML = `
      <div class="stat-name"><span>${def.icon}</span>${def.label}</div>
      <div class="stat-lv">LV ${sl.level}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, (sl.remaining / sl.need) * 100)}%"></div></div>
    `;
    grid.appendChild(card);
  });

  renderWeightChart();
  renderMilestones();
}

function renderWeightChart() {
  const wrap = document.getElementById('weightChartWrap');
  const log = data.weightLog || [];
  if (log.length < 2) {
    wrap.innerHTML = `<div style="display:flex; align-items:center; justify-content:center; height:100%; color:var(--outline); font-size:13px; text-align:center; padding:0 20px;">Log your weight a few days in a row to see a trend line here.</div>`;
    document.getElementById('weightLogList').style.display = 'none';
    return;
  }

  const weights = log.map((w) => w.weight);
  const min = Math.min(...weights), max = Math.max(...weights);
  const pad = (max - min) * 0.15 || 1;
  const yMin = min - pad, yMax = max + pad;
  const W = 400, H = 160;
  const points = log.map((w, i) => {
    const x = (i / (log.length - 1)) * W;
    const y = H - ((w.weight - yMin) / (yMax - yMin)) * H;
    return [x, y];
  });
  const pathD = points.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(' ');
  const areaD = `${pathD} L${W},${H} L0,${H} Z`;

  wrap.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs>
        <lineargradient id="wgGrad" x1="0%" x2="0%" y1="0%" y2="100%">
          <stop offset="0%" style="stop-color:#3fe1fd;stop-opacity:0.35"/>
          <stop offset="100%" style="stop-color:#3fe1fd;stop-opacity:0"/>
        </lineargradient>
      </defs>
      <path d="${areaD}" fill="url(#wgGrad)"/>
      <path d="${pathD}" fill="none" stroke="#006877" stroke-width="3" stroke-linecap="round"/>
      ${points.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="#006877"/>`).join('')}
    </svg>
  `;

  const listEl = document.getElementById('weightLogList');
  listEl.style.display = 'block';
  listEl.innerHTML = [...log].reverse().slice(0, 10).map((w) => `
    <div class="weight-log-row">
      <span style="color:var(--outline); font-size:13px;">${w.date}</span>
      <span style="font-weight:700;">${w.weight} kg</span>
    </div>
  `).join('');
}

function renderMilestones() {
  const grid = document.getElementById('milestoneGrid');
  const cards = [];
  const streak = computeStreak();
  const ov = overallLevel(data.totalXP);
  const rank = rankFromLevel(ov.level);

  cards.push(`
    <div class="glass-card milestone-card">
      <div class="milestone-head">
        <div class="milestone-icon" style="background:var(--tertiary-container); color:var(--tertiary);">🔥</div>
        <div>
          <div class="milestone-title">Consistency Streak</div>
          <div class="milestone-sub">${streak} day${streak === 1 ? '' : 's'} tracked</div>
        </div>
      </div>
      <div class="milestone-text">${
        streak >= 30 ? "A full month of consistency — that's the habit locked in."
        : streak >= 14 ? "Two weeks straight. This is becoming who you are."
        : streak >= 7 ? "A full week! Momentum is building."
        : streak >= 1 ? "Keep it going — every streak starts with day one."
        : "Complete all your quests today to start a streak."
      }</div>
    </div>
  `);

  cards.push(`
    <div class="glass-card milestone-card">
      <div class="milestone-head">
        <div class="milestone-icon" style="background:var(--primary-container); color:var(--primary);">🏆</div>
        <div>
          <div class="milestone-title">${rank.name}</div>
          <div class="milestone-sub">Overall Level ${ov.level}</div>
        </div>
      </div>
      <div class="milestone-text">${ov.remaining} / ${ov.need} XP to Level ${ov.level + 1}.</div>
    </div>
  `);

  const log = data.weightLog || [];
  const pd = data.profileDetails || {};
  if (log.length >= 1) {
    const startWeight = log[0].weight;
    const currentWeight = log[log.length - 1].weight;
    const change = Math.round((startWeight - currentWeight) * 10) / 10;
    let progressText = `${Math.abs(change)} kg ${change >= 0 ? 'lost' : 'gained'} since you started tracking.`;
    if (pd.goalWeightKg) {
      const totalNeeded = startWeight - pd.goalWeightKg;
      const pct = totalNeeded !== 0 ? Math.round(((startWeight - currentWeight) / totalNeeded) * 100) : 0;
      progressText += ` That's ${Math.max(0, Math.min(100, pct))}% of the way to your ${pd.goalWeightKg}kg goal.`;
    }
    cards.push(`
      <div class="glass-card milestone-card">
        <div class="milestone-head">
          <div class="milestone-icon" style="background:var(--secondary-container); color:var(--secondary);">⚖️</div>
          <div>
            <div class="milestone-title">Weight Progress</div>
            <div class="milestone-sub">${currentWeight} kg currently</div>
          </div>
        </div>
        <div class="milestone-text">${progressText}</div>
      </div>
    `);
  }

  grid.innerHTML = cards.join('');
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
    alert('Could not save that — check your connection and try again.');
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
    alert('Could not delete that quest — check your connection and try again.');
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
    alert('Could not remove that entry — check your connection and try again.');
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

    // Home Chef: first home recipe cooked each day feeds the Spirit.
    // (strict === false so this silently skips if step10 SQL hasn't been run)
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
// RECIPES
// ============================================================
const RECIPE_EMOJIS = ['🍲', '🥘', '🍛', '🥗', '🍳', '🥙', '🫓', '🍚', '🍗', '🐟', '🥞', '🍰'];

// Draft edited in the builder modal. Ingredient shape:
// { name, mode: 'per100g'|'perServing', servingLabel, calories, protein, carbs, fat, amount }
//   per100g    → macros are per 100g, amount = grams used
//   perServing → macros are per 1 serving, amount = servings used
let recipeDraft = null;

function ingredientMacros(ing) {
  const m = ing.mode === 'per100g' ? (ing.amount || 0) / 100 : (ing.amount || 0);
  return {
    calories: ing.calories * m,
    protein: ing.protein * m,
    carbs: ing.carbs * m,
    fat: ing.fat * m
  };
}

function recipeDraftTotals() {
  const t = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  (recipeDraft?.ingredients || []).forEach((ing) => {
    const m = ingredientMacros(ing);
    t.calories += m.calories; t.protein += m.protein; t.carbs += m.carbs; t.fat += m.fat;
  });
  return t;
}

function renderRecipes() {
  const listEl = document.getElementById('recipeList');
  const recipes = data.recipes || [];
  if (!recipes.length) {
    listEl.innerHTML = `
      <div class="glass-card recipe-empty">
        <div style="font-size:34px; margin-bottom:8px;">📖</div>
        <div style="font-weight:700; margin-bottom:4px;">Your Recipe Book is empty</div>
        <div style="font-size:13px; color:var(--outline); line-height:1.5;">
          Build a dish once — mansaf, overnight oats, your protein shake —
          and log the whole thing next time with one tap.
        </div>
      </div>`;
    return;
  }

  listEl.innerHTML = recipes.map((r) => {
    const per = r.servings > 0 ? {
      calories: Math.round(r.calories / r.servings),
      protein: Math.round((r.protein / r.servings) * 10) / 10,
      carbs: Math.round((r.carbs / r.servings) * 10) / 10,
      fat: Math.round((r.fat / r.servings) * 10) / 10
    } : { calories: r.calories, protein: r.protein, carbs: r.carbs, fat: r.fat };
    return `
      <div class="glass-card recipe-card">
        <div class="recipe-head">
          <div class="recipe-emoji">${r.emoji || '🍲'}</div>
          <div class="recipe-head-body">
            <div class="recipe-name">${escapeHtml(r.name)}</div>
            <div class="recipe-sub">Makes ${r.servings} serving${r.servings === 1 ? '' : 's'} · ${(r.ingredients || []).length} ingredient${(r.ingredients || []).length === 1 ? '' : 's'}</div>
          </div>
          <div class="recipe-kcal">${per.calories}<span> kcal/serv</span></div>
        </div>
        <div class="recipe-macros">
          <span class="macro-chip chip-p">P ${per.protein}g</span>
          <span class="macro-chip chip-c">C ${per.carbs}g</span>
          <span class="macro-chip chip-f">F ${per.fat}g</span>
        </div>
        <div class="recipe-actions">
          <button class="btn btn-primary recipe-log-btn" data-id="${r.id}">🍽️ Log</button>
          <button class="btn btn-ghost recipe-edit-btn" data-id="${r.id}">Edit</button>
          <button class="btn btn-ghost recipe-del-btn" data-id="${r.id}" title="Delete">✕</button>
        </div>
      </div>`;
  }).join('');

  listEl.querySelectorAll('.recipe-log-btn').forEach((b) => b.addEventListener('click', () => openLogRecipe(b.dataset.id)));
  listEl.querySelectorAll('.recipe-edit-btn').forEach((b) => b.addEventListener('click', () => openRecipeBuilder(b.dataset.id)));
  listEl.querySelectorAll('.recipe-del-btn').forEach((b) => b.addEventListener('click', () => deleteRecipe(b.dataset.id)));
}

// ---------- builder ----------
function openRecipeBuilder(recipeId) {
  const existing = recipeId ? (data.recipes || []).find((r) => r.id === recipeId) : null;
  recipeDraft = existing
    ? { id: existing.id, name: existing.name, emoji: existing.emoji, servings: existing.servings,
        ingredients: existing.ingredients.map((i) => ({ ...i })) }
    : { id: null, name: '', emoji: '🍲', servings: 4, ingredients: [] };

  document.getElementById('recipeModalTitle').textContent = existing ? 'Edit Recipe' : 'New Recipe';
  document.getElementById('recipeNameInput').value = recipeDraft.name;
  document.getElementById('recipeServingsInput').value = recipeDraft.servings;
  document.getElementById('recipeSearchInput').value = '';
  document.getElementById('recipeSearchResults').innerHTML = '';
  document.getElementById('manualIngFields').style.display = 'none';
  renderEmojiRow();
  renderIngredientList();
  document.getElementById('recipeModalOverlay').classList.add('open');
  if (!existing) setTimeout(() => document.getElementById('recipeNameInput').focus(), 50);
}

function renderEmojiRow() {
  const row = document.getElementById('emojiRow');
  row.innerHTML = RECIPE_EMOJIS.map((e) =>
    `<button type="button" class="emoji-opt${recipeDraft.emoji === e ? ' selected' : ''}" data-emoji="${e}">${e}</button>`
  ).join('');
  row.querySelectorAll('.emoji-opt').forEach((btn) => btn.addEventListener('click', () => {
    recipeDraft.emoji = btn.dataset.emoji;
    renderEmojiRow();
  }));
}

function renderIngredientList() {
  const listEl = document.getElementById('ingredientList');
  const ings = recipeDraft.ingredients;

  listEl.innerHTML = ings.length ? ings.map((ing, i) => {
    const m = ingredientMacros(ing);
    const unitHint = ing.mode === 'per100g' ? 'g' : `× ${escapeHtml(ing.servingLabel || 'serving')}`;
    return `
      <div class="ingredient-row">
        <div class="ing-body">
          <div class="ing-name">${escapeHtml(ing.name)}</div>
          <div class="ing-macro">${Math.round(m.calories)} kcal · P ${Math.round(m.protein * 10) / 10}g · C ${Math.round(m.carbs * 10) / 10}g · F ${Math.round(m.fat * 10) / 10}g</div>
        </div>
        <div class="ing-amount">
          <input type="number" min="0" step="${ing.mode === 'per100g' ? '1' : '0.25'}" value="${ing.amount}" data-idx="${i}">
          <span class="ing-unit">${unitHint}</span>
        </div>
        <button class="ing-del" data-idx="${i}" title="Remove">✕</button>
      </div>`;
  }).join('') : `<div class="meal-empty">No ingredients yet — search above or add one manually.</div>`;

  listEl.querySelectorAll('.ing-amount input').forEach((inp) => inp.addEventListener('input', () => {
    recipeDraft.ingredients[+inp.dataset.idx].amount = parseFloat(inp.value) || 0;
    renderRecipeTotals();
    // update just this row's macro line without rebuilding (keeps input focus)
    const m = ingredientMacros(recipeDraft.ingredients[+inp.dataset.idx]);
    inp.closest('.ingredient-row').querySelector('.ing-macro').textContent =
      `${Math.round(m.calories)} kcal · P ${Math.round(m.protein * 10) / 10}g · C ${Math.round(m.carbs * 10) / 10}g · F ${Math.round(m.fat * 10) / 10}g`;
  }));
  listEl.querySelectorAll('.ing-del').forEach((btn) => btn.addEventListener('click', () => {
    recipeDraft.ingredients.splice(+btn.dataset.idx, 1);
    renderIngredientList();
  }));

  renderRecipeTotals();
}

function renderRecipeTotals() {
  const t = recipeDraftTotals();
  const servings = parseFloat(document.getElementById('recipeServingsInput').value) || 1;
  document.getElementById('recipeTotals').innerHTML = `
    <div class="rt-row"><span>Whole recipe</span><b>${Math.round(t.calories)} kcal · P ${Math.round(t.protein)}g · C ${Math.round(t.carbs)}g · F ${Math.round(t.fat)}g</b></div>
    <div class="rt-row rt-per"><span>Per serving (÷${servings})</span><b>${Math.round(t.calories / servings)} kcal · P ${Math.round(t.protein / servings)}g · C ${Math.round(t.carbs / servings)}g · F ${Math.round(t.fat / servings)}g</b></div>`;
}

async function saveRecipeFromDraft() {
  const name = document.getElementById('recipeNameInput').value.trim();
  const servings = parseFloat(document.getElementById('recipeServingsInput').value) || 0;
  if (!name) { alert('Give your recipe a name.'); return; }
  if (servings <= 0) { alert('Servings must be at least 0.5.'); return; }
  if (!recipeDraft.ingredients.length) { alert('Add at least one ingredient.'); return; }

  const t = recipeDraftTotals();
  const payload = {
    id: recipeDraft.id,
    name,
    emoji: recipeDraft.emoji,
    servings,
    ingredients: recipeDraft.ingredients,
    calories: Math.round(t.calories),
    protein: Math.round(t.protein * 10) / 10,
    carbs: Math.round(t.carbs * 10) / 10,
    fat: Math.round(t.fat * 10) / 10
  };

  document.getElementById('recipeModalOverlay').classList.remove('open');
  try {
    const saved = await saveRecipeRemote(payload);
    if (!data.recipes) data.recipes = [];
    const idx = data.recipes.findIndex((r) => r.id === saved.id);
    if (idx !== -1) data.recipes[idx] = saved;
    else data.recipes.push(saved);
    renderRecipes();
  } catch (e) {
    console.error('saveRecipe failed', e);
    alert('Could not save the recipe. If this is your first one, make sure supabase-step10.sql has been run in the SQL Editor.');
  }
}

async function deleteRecipe(id) {
  const r = (data.recipes || []).find((x) => x.id === id);
  if (!r || !confirm(`Delete "${r.name}" from your Recipe Book?`)) return;
  const prev = data.recipes;
  data.recipes = data.recipes.filter((x) => x.id !== id);
  renderRecipes();
  try {
    await deleteRecipeRemote(id);
  } catch (e) {
    console.error('deleteRecipe failed, reverting', e);
    data.recipes = prev;
    renderRecipes();
    alert('Could not delete that recipe — check your connection and try again.');
  }
}

// ---------- logging a recipe ----------
let recipeBeingLogged = null;

function openLogRecipe(id) {
  recipeBeingLogged = (data.recipes || []).find((r) => r.id === id);
  if (!recipeBeingLogged) return;
  document.getElementById('logRecipeTitle').textContent = `${recipeBeingLogged.emoji} ${recipeBeingLogged.name}`;
  document.getElementById('logRecipeServings').value = 1;
  document.getElementById('logRecipeMeal').value = defaultMealForNow();
  renderLogRecipePreview();
  document.getElementById('logRecipeModalOverlay').classList.add('open');
}

function scaledRecipeMacros(recipe, servingsEaten) {
  const perServ = recipe.servings > 0 ? recipe.servings : 1;
  const m = servingsEaten / perServ;
  return {
    calories: Math.round(recipe.calories * m),
    protein: Math.round(recipe.protein * m * 10) / 10,
    carbs: Math.round(recipe.carbs * m * 10) / 10,
    fat: Math.round(recipe.fat * m * 10) / 10
  };
}

function renderLogRecipePreview() {
  if (!recipeBeingLogged) return;
  const servings = parseFloat(document.getElementById('logRecipeServings').value) || 0;
  const s = scaledRecipeMacros(recipeBeingLogged, servings);
  document.getElementById('logRecipePreview').innerHTML = `
    <div class="rt-row"><span>You'll log</span><b>${s.calories} kcal · P ${s.protein}g · C ${s.carbs}g · F ${s.fat}g</b></div>`;
}

async function confirmLogRecipe() {
  if (!recipeBeingLogged) return;
  const servings = parseFloat(document.getElementById('logRecipeServings').value) || 0;
  if (servings <= 0) { alert('Enter how many servings you ate.'); return; }
  const s = scaledRecipeMacros(recipeBeingLogged, servings);
  const meal = document.getElementById('logRecipeMeal').value;
  const name = `${recipeBeingLogged.emoji} ${recipeBeingLogged.name}`;
  document.getElementById('logRecipeModalOverlay').classList.remove('open');
  try {
    await logFood({ name, ...s, source: 'recipe', meal });
  } catch (e) {
    console.error('log recipe failed', e);
    alert('Could not log that — check your connection and try again.');
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
// AUTH
// ============================================================
function showApp() {
  document.getElementById('authOverlay').style.display = 'none';
  document.getElementById('appWrap').style.display = 'block';
}
function showAuth() {
  document.getElementById('authOverlay').style.display = 'flex';
  document.getElementById('appWrap').style.display = 'none';
}

async function bootAfterAuth() {
  try {
    data = await loadData();
    showApp();
    render();
    renderProfileTab();
    checkMacroBonuses();
  } catch (e) {
    console.error('loadData failed', e);
    document.getElementById('authError').textContent = 'Signed in, but could not load your data. Pull to refresh.';
  }
}

function initAuthEvents() {
  const emailEl = document.getElementById('authEmail');
  const passEl = document.getElementById('authPassword');
  const errEl = document.getElementById('authError');

  document.getElementById('signInBtn').addEventListener('click', async () => {
    errEl.style.color = 'var(--error)';
    errEl.textContent = '';
    const { error } = await signInWithEmail(emailEl.value.trim(), passEl.value);
    if (error) { errEl.textContent = error.message; return; }
    await bootAfterAuth();
  });

  document.getElementById('signUpBtn').addEventListener('click', async () => {
    errEl.style.color = 'var(--error)';
    errEl.textContent = '';
    const { error } = await signUpWithEmail(emailEl.value.trim(), passEl.value);
    if (error) { errEl.textContent = error.message; return; }
    errEl.style.color = 'var(--primary)';
    errEl.textContent = 'Account created — check your email if confirmation is required, then sign in.';
  });

  document.getElementById('signOutBtn').addEventListener('click', async () => {
    await signOut();
    data = null;
    showAuth();
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
      alert('Not found — enter it manually below, then tick "Remember this barcode" so next scan auto-fills it.');
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
    alert('Could not look up that barcode — check your connection and try again.');
  }
}

// ============================================================
// COACH
// ============================================================
function appendCoachMessage(text, who) {
  const wrap = document.getElementById('coachMessages');
  const div = document.createElement('div');
  div.className = 'coach-msg ' + (who === 'user' ? 'coach-msg-user' : 'coach-msg-bot');
  div.textContent = text;
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  return div;
}

async function sendCoachMessage() {
  const input = document.getElementById('coachInput');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  appendCoachMessage(msg, 'user');

  const loadingEl = appendCoachMessage('Thinking...', 'bot');
  loadingEl.classList.add('coach-msg-loading');

  try {
    const reply = await askCoach(msg);
    loadingEl.textContent = reply;
    loadingEl.classList.remove('coach-msg-loading');
  } catch (e) {
    console.error('coach request failed', e);
    loadingEl.textContent = "Couldn't reach the coach — check your connection and that the Edge Function is deployed.";
    loadingEl.classList.remove('coach-msg-loading');
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
      alert('Could not add that quest — check your connection and try again.');
    }
  });

  document.getElementById('resetBtn').addEventListener('click', async () => {
    if (!confirm('Reset your XP and stats back to zero? Quests and history stay.')) return;
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
          <div class="food-search-item" data-idx="${i}">
            <span>${SOURCE_ICON[f.source] || '🍽️'} ${escapeHtml(f.name)} <span style="color:var(--outline); font-size:11px;">(${escapeHtml(f.servingLabel)})</span></span>
            <span class="fsi-macro">${f.calories} kcal</span>
          </div>`).join('') || `<div style="color:var(--outline); font-size:12px; padding:4px;">No matches — enter manually below.</div>`;
        foodResultsEl.querySelectorAll('.food-search-item').forEach((el, i) => {
          el.addEventListener('click', () => {
            lastScannedBarcode = null;
            applyFoodBase(results[i]);
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
    if (!name || calories <= 0) { alert('Enter at least a food name and calories.'); return; }

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
      alert('Could not log that food — check your connection and try again.');
    }
  });

  // ---- recipe book ----
  const recipeOverlayEl = document.getElementById('recipeModalOverlay');
  const logRecipeOverlayEl = document.getElementById('logRecipeModalOverlay');
  const recipeSearchInput = document.getElementById('recipeSearchInput');
  const recipeResultsEl = document.getElementById('recipeSearchResults');

  document.getElementById('addRecipeBtn').addEventListener('click', () => openRecipeBuilder(null));
  document.getElementById('cancelRecipeBtn').addEventListener('click', () => recipeOverlayEl.classList.remove('open'));
  recipeOverlayEl.addEventListener('click', (e) => { if (e.target === recipeOverlayEl) recipeOverlayEl.classList.remove('open'); });
  document.getElementById('saveRecipeBtn').addEventListener('click', saveRecipeFromDraft);
  document.getElementById('recipeServingsInput').addEventListener('input', renderRecipeTotals);

  let recipeSearchDebounce;
  recipeSearchInput.addEventListener('input', () => {
    clearTimeout(recipeSearchDebounce);
    const q = recipeSearchInput.value;
    recipeSearchDebounce = setTimeout(async () => {
      if (!q.trim()) { recipeResultsEl.innerHTML = ''; return; }
      try {
        const results = await combinedFoodSearch(q);
        recipeResultsEl.innerHTML = results.map((f, i) => `
          <div class="food-search-item" data-idx="${i}">
            <span>${SOURCE_ICON[f.source] || '🍽️'} ${escapeHtml(f.name)} <span style="color:var(--outline); font-size:11px;">(${escapeHtml(f.servingLabel)})</span></span>
            <span class="fsi-macro">${f.calories} kcal</span>
          </div>`).join('') || `<div style="color:var(--outline); font-size:12px; padding:4px;">No matches — add it manually below.</div>`;
        recipeResultsEl.querySelectorAll('.food-search-item').forEach((el, i) => {
          el.addEventListener('click', () => {
            const f = results[i];
            recipeDraft.ingredients.push({
              name: f.name,
              mode: f.mode === 'per100g' ? 'per100g' : 'perServing',
              servingLabel: f.servingLabel || 'serving',
              calories: f.calories, protein: f.protein, carbs: f.carbs, fat: f.fat,
              amount: f.mode === 'per100g' ? 100 : 1
            });
            recipeSearchInput.value = '';
            recipeResultsEl.innerHTML = '';
            renderIngredientList();
          });
        });
      } catch (e) {
        console.error('recipe ingredient search failed', e);
      }
    }, 300);
  });

  document.getElementById('manualIngToggleBtn').addEventListener('click', () => {
    const el = document.getElementById('manualIngFields');
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
  });
  document.getElementById('manualIngAddBtn').addEventListener('click', () => {
    const name = document.getElementById('manualIngName').value.trim();
    const calories = parseFloat(document.getElementById('manualIngCal').value) || 0;
    if (!name || calories <= 0) { alert('Enter at least a name and calories for the ingredient.'); return; }
    recipeDraft.ingredients.push({
      name,
      mode: 'perServing',
      servingLabel: 'as entered',
      calories,
      protein: parseFloat(document.getElementById('manualIngProtein').value) || 0,
      carbs: parseFloat(document.getElementById('manualIngCarbs').value) || 0,
      fat: parseFloat(document.getElementById('manualIngFat').value) || 0,
      amount: 1
    });
    ['manualIngName', 'manualIngCal', 'manualIngProtein', 'manualIngCarbs', 'manualIngFat']
      .forEach((id) => (document.getElementById(id).value = ''));
    document.getElementById('manualIngFields').style.display = 'none';
    renderIngredientList();
  });

  document.getElementById('cancelLogRecipeBtn').addEventListener('click', () => logRecipeOverlayEl.classList.remove('open'));
  logRecipeOverlayEl.addEventListener('click', (e) => { if (e.target === logRecipeOverlayEl) logRecipeOverlayEl.classList.remove('open'); });
  document.getElementById('logRecipeServings').addEventListener('input', renderLogRecipePreview);
  document.getElementById('confirmLogRecipeBtn').addEventListener('click', confirmLogRecipe);

  // ---- weight modal ----
  const weightOverlayEl = document.getElementById('weightModalOverlay');
  document.getElementById('logWeightBtn').addEventListener('click', () => {
    const pd = data.profileDetails || {};
    const latest = (data.weightLog && data.weightLog.length) ? data.weightLog[data.weightLog.length - 1].weight : (pd.weightKg || '');
    document.getElementById('weightInput').value = latest;
    weightOverlayEl.classList.add('open');
  });
  document.getElementById('cancelWeightBtn').addEventListener('click', () => weightOverlayEl.classList.remove('open'));
  weightOverlayEl.addEventListener('click', (e) => { if (e.target === weightOverlayEl) weightOverlayEl.classList.remove('open'); });

  document.getElementById('saveWeightBtn').addEventListener('click', async () => {
    const weightKg = parseFloat(document.getElementById('weightInput').value);
    if (!weightKg || weightKg <= 0) { alert('Enter a valid weight.'); return; }
    weightOverlayEl.classList.remove('open');
    try {
      await logWeight(weightKg);
      const tKey = todayKey();
      const existingIdx = data.weightLog.findIndex((w) => w.date === tKey);
      if (existingIdx !== -1) data.weightLog[existingIdx].weight = weightKg;
      else data.weightLog.push({ date: tKey, weight: weightKg });
      renderProgress();
    } catch (e) {
      console.error('logWeight failed', e);
      alert('Could not save your weight — check your connection and try again.');
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
      alert('Fill in height, weight, and age first.');
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
      msgEl.style.color = 'var(--primary)';
      msgEl.textContent = 'Saved!';
      setTimeout(() => { msgEl.textContent = ''; }, 2000);
    } catch (e) {
      console.error('saveProfileGoals failed', e);
      msgEl.style.color = 'var(--error)';
      msgEl.textContent = 'Could not save — check your connection.';
    }
  });

  // ---- coach chat ----
  document.getElementById('coachSendBtn').addEventListener('click', sendCoachMessage);
  document.getElementById('coachInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendCoachMessage();
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
  initAuthEvents();
  initAppEvents();
  initTabs();
  const session = await getSession();
  if (session) await bootAfterAuth();
  else showAuth();
  onAuthChange((session) => {
    if (session && !data) bootAfterAuth();
    if (!session) { data = null; showAuth(); }
  });
})();
