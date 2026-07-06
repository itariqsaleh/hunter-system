import {
  STAT_DEFS, loadData, saveProfile, saveProfileGoals, calculateTargets,
  addQuestRemote, deleteQuestRemote, toggleCompletionRemote,
  searchArabicFoods, searchUSDAFoods, addFoodLogRemote, deleteFoodLogRemote, lookupBarcode,
  getOrCreateDailyBonus, markBonusAwarded, askCoach,
  overallLevel, statLevel, rankFromLevel, todayKey,
  getSession, signUpWithEmail, signInWithEmail, signOut, onAuthChange
} from './store.js';

let data = null; // filled by loadData() once signed in

function allCompletedOn(dateKey) {
  if (!data) return false;
  const done = data.completions[dateKey] || [];
  return data.quests.length > 0 && data.quests.every((q) => done.includes(q.id));
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

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- main render ----------
function render() {
  if (!data) return;
  document.getElementById('hunterName').textContent = data.name || 'Hunter';

  const ov = overallLevel(data.totalXP);
  const rank = rankFromLevel(ov.level);
  document.getElementById('rankLabel').textContent = `${rank.name} · LV ${ov.level}`;
  const badge = document.getElementById('rankBadge');
  badge.textContent = rank.label;
  badge.style.setProperty('--rank-color', rank.color);
  document.getElementById('xpText').textContent = `${ov.remaining} / ${ov.need}`;
  document.getElementById('xpBar').style.width = Math.min(100, (ov.remaining / ov.need) * 100) + '%';

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

  renderNutrition();
  renderProfileTab();
}

function renderNutrition() {
  const totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  data.foodLog.forEach((f) => {
    totals.calories += f.calories;
    totals.protein += f.protein;
    totals.carbs += f.carbs;
    totals.fat += f.fat;
  });

  const macros = [
    { key: 'calories', label: 'Calories', unit: '', color: 'linear-gradient(90deg,#8c6bff,#3ecfff)' },
    { key: 'protein', label: 'Protein', unit: 'g', color: 'linear-gradient(90deg,#54ffb0,#3ecfff)' },
    { key: 'carbs', label: 'Carbs', unit: 'g', color: 'linear-gradient(90deg,#ffce54,#ff9d54)' },
    { key: 'fat', label: 'Fat', unit: 'g', color: 'linear-gradient(90deg,#ff5c7a,#ff8fd6)' }
  ];
  const barsEl = document.getElementById('macroBars');
  barsEl.innerHTML = macros.map((m) => {
    const val = Math.round(totals[m.key]);
    const target = data.targets[m.key] || 1;
    const pct = Math.min(100, (val / target) * 100);
    return `
      <div class="macro-row">
        <div class="macro-label"><span>${m.label}</span><b>${val}${m.unit} / ${target}${m.unit}</b></div>
        <div class="macro-bar-track"><div class="macro-bar-fill" style="width:${pct}%; background:${m.color};"></div></div>
      </div>`;
  }).join('');

  const logEl = document.getElementById('foodLogList');
  logEl.innerHTML = '';
  const mealOrder = [
    { key: 'breakfast', label: '🌅 Breakfast' },
    { key: 'lunch', label: '☀️ Lunch' },
    { key: 'dinner', label: '🌙 Dinner' },
    { key: 'snack', label: '🍿 Snack' }
  ];
  mealOrder.forEach((m) => {
    const items = data.foodLog.filter((f) => (f.meal || 'snack') === m.key);
    if (items.length === 0) return;
    const header = document.createElement('div');
    header.style.cssText = 'font-size:11px; letter-spacing:1.5px; text-transform:uppercase; color:var(--muted); margin:10px 0 6px;';
    header.textContent = m.label;
    logEl.appendChild(header);
    items.forEach((f) => {
      const row = document.createElement('div');
      row.className = 'food-row';
      row.innerHTML = `
        <div style="flex:1; min-width:0;">
          <div class="food-name">${escapeHtml(f.name)}</div>
          <div class="food-macros">P ${f.protein}g · C ${f.carbs}g · F ${f.fat}g</div>
        </div>
        <div class="food-cal">${f.calories} kcal</div>
        <button class="quest-del" data-id="${f.id}" title="Remove entry">✕</button>
      `;
      logEl.appendChild(row);
    });
  });
  logEl.querySelectorAll('.quest-del').forEach((btn) => btn.addEventListener('click', () => deleteFood(btn.dataset.id)));
}

// ---------- quests ----------
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

// ---------- food ----------
async function deleteFood(id) {
  const prevLog = data.foodLog;
  data.foodLog = data.foodLog.filter((f) => f.id !== id);
  renderNutrition();
  try {
    await deleteFoodLogRemote(id);
  } catch (e) {
    console.error('deleteFood failed, reverting', e);
    data.foodLog = prevLog;
    renderNutrition();
    alert('Could not remove that entry — check your connection and try again.');
  }
}

async function logFood({ name, calories, protein, carbs, fat, source, meal }) {
  const entry = await addFoodLogRemote({ name, calories, protein, carbs, fat, source, meal });
  data.foodLog.push(entry);
  renderNutrition();
  checkMacroBonuses();
}

// ---------- macro XP bonuses ----------
async function checkMacroBonuses() {
  const totals = { calories: 0, protein: 0 };
  data.foodLog.forEach((f) => { totals.calories += f.calories; totals.protein += f.protein; });

  try {
    const bonus = await getOrCreateDailyBonus();

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

function renderProfileTab() {
  const pd = data.profileDetails || {};
  document.getElementById('profileHeight').value = pd.heightCm || '';
  document.getElementById('profileWeight').value = pd.weightKg || '';
  document.getElementById('profileAge').value = pd.age || '';
  document.getElementById('profileSex').value = pd.sex || 'male';
  document.getElementById('profileActivity').value = pd.activityLevel || 'moderate';
  document.getElementById('profileGoal').value = pd.goal || 'maintain';
  document.getElementById('targetCalories').value = data.targets.calories;
  document.getElementById('targetProtein').value = data.targets.protein;
  document.getElementById('targetCarbs').value = data.targets.carbs;
  document.getElementById('targetFat').value = data.targets.fat;
}

// ---------- level up overlay ----------
let luTimeout;
function showLevelUp(titleText, subtext) {
  const overlay = document.getElementById('levelupOverlay');
  document.getElementById('luLevelText').textContent = titleText;
  document.getElementById('luSub').textContent = subtext;
  overlay.classList.add('show');
  clearTimeout(luTimeout);
  luTimeout = setTimeout(() => overlay.classList.remove('show'), 2200);
}

// ---------- auth screen ----------
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
    errEl.style.color = 'var(--danger)';
    errEl.textContent = '';
    const { error } = await signInWithEmail(emailEl.value.trim(), passEl.value);
    if (error) { errEl.textContent = error.message; return; }
    await bootAfterAuth();
  });

  document.getElementById('signUpBtn').addEventListener('click', async () => {
    errEl.style.color = 'var(--danger)';
    errEl.textContent = '';
    const { error } = await signUpWithEmail(emailEl.value.trim(), passEl.value);
    if (error) { errEl.textContent = error.message; return; }
    errEl.style.color = 'var(--good)';
    errEl.textContent = 'Account created — check your email if confirmation is required, then sign in.';
  });

  document.getElementById('signOutBtn').addEventListener('click', async () => {
    await signOut();
    data = null;
    showAuth();
  });
}

// ---------- tab navigation ----------
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

// ---------- barcode scanner ----------
let html5QrCode = null;

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
      () => {} // ignore per-frame "not found" noise
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
    if (!product) {
      alert('That barcode was not found in Open Food Facts. Try adding the food manually.');
      openFoodModal();
      return;
    }
    openFoodModal();
    applyFoodBase(product, 'Quantity (x100g)');
  } catch (e) {
    console.error('barcode lookup failed', e);
    await closeScanner();
    alert('Could not look up that barcode — check your connection and try again.');
  }
}

// ---------- coach chat ----------
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

// ---------- modal helpers ----------
let foodBase = null; // {calories, protein, carbs, fat} at quantity=1, or null for pure manual entry

function defaultMealForNow() {
  const h = new Date().getHours();
  if (h < 11) return 'breakfast';
  if (h < 16) return 'lunch';
  if (h < 21) return 'dinner';
  return 'snack';
}

function applyFoodBase(food, servingsLabel) {
  foodBase = { calories: food.calories, protein: food.protein, carbs: food.carbs, fat: food.fat };
  document.getElementById('foodNameInput').value = food.name;
  document.getElementById('servingsField').style.display = 'block';
  document.getElementById('servingsLabel').textContent = servingsLabel || `Quantity (x ${food.servingLabel || '1 serving'})`;
  document.getElementById('foodServingsInput').value = 1;
  fillFieldsFromBase(1);
}

function fillFieldsFromBase(servings) {
  if (!foodBase) return;
  document.getElementById('foodCalInput').value = Math.round(foodBase.calories * servings);
  document.getElementById('foodProteinInput').value = Math.round(foodBase.protein * servings * 10) / 10;
  document.getElementById('foodCarbsInput').value = Math.round(foodBase.carbs * servings * 10) / 10;
  document.getElementById('foodFatInput').value = Math.round(foodBase.fat * servings * 10) / 10;
}

function openFoodModal() {
  document.getElementById('foodMealInput').value = defaultMealForNow();
  document.getElementById('foodModalOverlay').classList.add('open');
}

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
  const overlayEl = document.getElementById('modalOverlay');
  document.getElementById('addQuestBtn').addEventListener('click', () => {
    document.getElementById('questNameInput').value = '';
    document.getElementById('questXpInput').value = 10;
    overlayEl.classList.add('open');
    setTimeout(() => document.getElementById('questNameInput').focus(), 50);
  });
  document.getElementById('cancelQuestBtn').addEventListener('click', () => overlayEl.classList.remove('open'));
  overlayEl.addEventListener('click', (e) => { if (e.target === overlayEl) overlayEl.classList.remove('open'); });

  document.getElementById('saveQuestBtn').addEventListener('click', async () => {
    const name = document.getElementById('questNameInput').value.trim();
    const stat = document.getElementById('questStatInput').value;
    const xp = Math.max(1, parseInt(document.getElementById('questXpInput').value) || 10);
    if (!name) return;
    overlayEl.classList.remove('open');
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

  function clearFoodForm() {
    foodBase = null;
    foodSearchInput.value = '';
    document.getElementById('foodNameInput').value = '';
    document.getElementById('foodCalInput').value = '';
    document.getElementById('foodProteinInput').value = '';
    document.getElementById('foodCarbsInput').value = '';
    document.getElementById('foodFatInput').value = '';
    document.getElementById('servingsField').style.display = 'none';
    foodResultsEl.innerHTML = '';
  }

  document.getElementById('addFoodBtn').addEventListener('click', () => {
    clearFoodForm();
    openFoodModal();
    setTimeout(() => foodSearchInput.focus(), 50);
  });
  document.getElementById('cancelFoodBtn').addEventListener('click', () => foodOverlayEl.classList.remove('open'));
  foodOverlayEl.addEventListener('click', (e) => { if (e.target === foodOverlayEl) foodOverlayEl.classList.remove('open'); });

  servingsInput.addEventListener('input', () => {
    const val = parseFloat(servingsInput.value) || 0;
    fillFieldsFromBase(val);
  });

  let searchDebounce;
  foodSearchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    const q = foodSearchInput.value;
    searchDebounce = setTimeout(async () => {
      if (!q.trim()) { foodResultsEl.innerHTML = ''; return; }
      try {
        const [arabicResults, usdaResults] = await Promise.all([
          searchArabicFoods(q).catch((e) => { console.error('arabic search failed', e); return []; }),
          searchUSDAFoods(q).catch((e) => { console.error('usda search failed', e); return []; })
        ]);
        const results = [...arabicResults, ...usdaResults];
        foodResultsEl.innerHTML = results.map((f, i) => `
          <div class="food-search-item" data-idx="${i}">
            <span>${f.source === 'usda' ? '🌎' : '🇯🇴'} ${escapeHtml(f.name)} <span style="color:var(--muted); font-size:11px;">(${escapeHtml(f.servingLabel)})</span></span>
            <span class="fsi-macro">${f.calories} kcal</span>
          </div>`).join('') || `<div style="color:var(--muted); font-size:12px; padding:4px;">No matches — enter manually below.</div>`;
        foodResultsEl.querySelectorAll('.food-search-item').forEach((el, i) => {
          el.addEventListener('click', () => applyFoodBase(results[i]));
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
    foodOverlayEl.classList.remove('open');
    try {
      await logFood({ name, calories, protein, carbs, fat, source: foodBase ? 'database' : 'manual', meal });
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
    const targets = {
      calories: parseInt(document.getElementById('targetCalories').value) || 0,
      protein: parseInt(document.getElementById('targetProtein').value) || 0,
      carbs: parseInt(document.getElementById('targetCarbs').value) || 0,
      fat: parseInt(document.getElementById('targetFat').value) || 0
    };
    const msgEl = document.getElementById('goalsSavedMsg');
    try {
      await saveProfileGoals({ heightCm, weightKg, age, sex, activityLevel, goal, targets });
      data.targets = targets;
      data.profileDetails = { heightCm, weightKg, age, sex, activityLevel, goal };
      renderNutrition();
      msgEl.textContent = 'Saved!';
      setTimeout(() => { msgEl.textContent = ''; }, 2000);
    } catch (e) {
      console.error('saveProfileGoals failed', e);
      msgEl.style.color = 'var(--danger)';
      msgEl.textContent = 'Could not save — check your connection.';
    }
  });

  // ---- barcode scanner ----
  document.getElementById('scanBarcodeBtn').addEventListener('click', openScanner);
  document.getElementById('cancelScanBtn').addEventListener('click', closeScanner);

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
