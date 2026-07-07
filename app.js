import {
  STAT_DEFS, loadData, saveProfile, saveProfileGoals, calculateTargets,
  addQuestRemote, deleteQuestRemote, toggleCompletionRemote,
  searchArabicFoods, searchUSDAFoods, searchUSDABranded, searchOpenFoodFactsProxy,
  addFoodLogRemote, deleteFoodLogRemote,
  lookupBarcode, saveCustomBarcode, logWeight,
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

// ---------- water tracker (localStorage, resets daily) ----------
function waterTodayKey() { return 'water_' + new Date().toISOString().slice(0, 10); }
function waterHistoryKey(d) { return 'wh_' + d; }

function getWaterToday() { return parseInt(localStorage.getItem(waterTodayKey()) || '0'); }
function setWaterToday(n) {
  const key = waterTodayKey();
  localStorage.setItem(key, Math.max(0, n));
  // also persist in weekly history
  localStorage.setItem(waterHistoryKey(new Date().toISOString().slice(0, 10)), Math.max(0, n));
}
function getWaterGoal() { return parseInt(localStorage.getItem('water_goal') || '8'); }
function setWaterGoal(n) { localStorage.setItem('water_goal', Math.max(1, n)); }

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

// ---------- profile picture (localStorage base64) ----------
function getProfilePic() { return localStorage.getItem('profile_pic') || null; }
function setProfilePic(dataUrl) { localStorage.setItem('profile_pic', dataUrl); }

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
    picEl.textContent = '';
  } else {
    picEl.style.backgroundImage = '';
    picEl.textContent = '👤';
  }

  // hero name + rank
  const ov = overallLevel(data.totalXP);
  const rank = rankFromLevel(ov.level);
  document.getElementById('profileHeroName').textContent = data.name || 'Hunter';
  document.getElementById('profileHeroRank').textContent = `${rank.name} · LV ${ov.level}`;
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
  const circumference = 2 * Math.PI * 64;
  const ringEl = document.getElementById('waterRing');
  if (ringEl) {
    ringEl.setAttribute('stroke-dasharray', circumference.toFixed(1));
    ringEl.setAttribute('stroke-dashoffset', (circumference * (1 - pct)).toFixed(1));
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

function renderWaterChart() {
  const chartEl = document.getElementById('waterChart');
  if (!chartEl) return;
  const goal = getWaterGoal();
  const dayLetters = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  chartEl.innerHTML = '';
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = 'wh_' + d.toISOString().slice(0, 10);
    const glasses = parseInt(localStorage.getItem(key) || '0');
    const pct = goal > 0 ? Math.min(100, (glasses / goal) * 100) : 0;
    const col = document.createElement('div');
    col.className = 'activity-col';
    col.innerHTML = `
      <div class="activity-track"><div class="activity-fill" style="height:${pct}%; background:var(--secondary);"></div></div>
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
    renderWater();
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
