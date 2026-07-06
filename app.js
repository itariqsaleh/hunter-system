import {
  STAT_DEFS, loadData, saveProfile, addQuestRemote, deleteQuestRemote, toggleCompletionRemote,
  searchArabicFoods, addFoodLogRemote, deleteFoodLogRemote,
  overallLevel, statLevel, rankFromLevel, todayKey,
  getSession, signUpWithEmail, signInWithEmail, signOut, onAuthChange
} from './store.js';

let data = null; 

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

  document.getElementById('streakVal').textContent = computeStreak();

  renderNutrition();
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
  data.foodLog.forEach((f) => {
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
  logEl.querySelectorAll('.quest-del').forEach((btn) => {
    btn.addEventListener('click', () => deleteFood(btn.dataset.id));
  });
}

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
let luTimeout;
function showLevelUp(titleText, subtext) {
  const overlay = document.getElementById('levelupOverlay');
  document.getElementById('luLevelText').textContent = titleText;
  document.getElementById('luSub').textContent = subtext;
  overlay.classList.add('show');
  clearTimeout(luTimeout);
  luTimeout = setTimeout(() => overlay.classList.remove('show'), 2200);
}

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
    errEl.textContent = '';
    const { error } = await signInWithEmail(emailEl.value.trim(), passEl.value);
    if (error) { errEl.textContent = error.message; return; }
    await bootAfterAuth();
  });

  document.getElementById('signUpBtn').addEventListener('click', async () => {
    errEl.textContent = '';
    const { error } = await signUpWithEmail(emailEl.value.trim(), passEl.value);
    if (error) { errEl.textContent = error.message; return; }
    errEl.style.color = 'var(--good)';
    errEl.textContent = 'Account created — logging you in...';
    setTimeout(async () => {
      await signInWithEmail(emailEl.value.trim(), passEl.value);
      await bootAfterAuth();
    }, 1500);
  });

  document.getElementById('signOutBtn').addEventListener('click', async () => {
    await signOut();
    data = null;
    showAuth();
  });
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

  document.getElementById('questList').addEventListener('click', (e) => {
    const checkEl = e.target.closest('.quest-check');
    const delEl = e.target.closest('.quest-del');
    if (checkEl) toggleQuest(checkEl.dataset.id);
    if (delEl) deleteQuest(delEl.dataset.id);
  });

  document.getElementById('levelupOverlay').addEventListener('click', () => {
    document.getElementById('levelupOverlay').classList.remove('show');
  });

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

  const foodOverlayEl = document.getElementById('foodModalOverlay');
  const foodSearchInput = document.getElementById('foodSearchInput');
  const foodResultsEl = document.getElementById('foodSearchResults');
  foodResultsEl.className = 'food-search-results';

  function clearFoodForm() {
    document.getElementById('foodSearchInput').value = '';
    document.getElementById('foodNameInput').value = '';
    document.getElementById('foodCalInput').value = '';
    document.getElementById('foodProteinInput').value = '';
    document.getElementById('foodCarbsInput').value = '';
    document.getElementById('foodFatInput').value = '';
    foodResultsEl.innerHTML = '';
  }

  document.getElementById('addFoodBtn').addEventListener('click', () => {
    clearFoodForm();
    foodOverlayEl.classList.add('open');
    setTimeout(() => foodSearchInput.focus(), 50);
  });
  document.getElementById('cancelFoodBtn').addEventListener('click', () => foodOverlayEl.classList.remove('open'));
  foodOverlayEl.addEventListener('click', (e) => { if (e.target === foodOverlayEl) foodOverlayEl.classList.remove('open'); });

  let searchDebounce;
  foodSearchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    const q = foodSearchInput.value;
    searchDebounce = setTimeout(async () => {
      if (!q.trim()) { foodResultsEl.innerHTML = ''; return; }
      try {
        const results = await searchArabicFoods(q);
        foodResultsEl.innerHTML = results.map((f) => `
          <div class="food-search-item" data-food='${JSON.stringify(f).replace(/'/g, "&#39;")}'>
            <span>${escapeHtml(f.name)} <span style="color:var(--muted); font-size:11px;">(${escapeHtml(f.serving_size)})</span></span>
            <span class="fsi-macro">${f.calories} kcal</span>
          </div>`).join('') || `<div style="color:var(--muted); font-size:12px; padding:4px;">No matches — enter manually below.</div>`;
        foodResultsEl.querySelectorAll('.food-search-item').forEach((el) => {
          el.addEventListener('click', () => {
            const f = JSON.parse(el.dataset.food.replace(/&#39;/g, "'"));
            document.getElementById('foodNameInput').value = f.name;
            document.getElementById('foodCalInput').value = f.calories;
            document.getElementById('foodProteinInput').value = f.protein;
            document.getElementById('foodCarbsInput').value = f.carbs;
            document.getElementById('foodFatInput').value = f.fat;
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
    if (!name || calories <= 0) { alert('Enter at least a food name and calories.'); return; }
    foodOverlayEl.classList.remove('open');
    try {
      const entry = await addFoodLogRemote({ name, calories, protein, carbs, fat, source: 'manual' });
      data.foodLog.push(entry);
      renderNutrition();
    } catch (e) {
      console.error('log food failed', e);
      alert('Could not log that food — check your connection and try again.');
    }
  });

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
  const session = await getSession();
  if (session) await bootAfterAuth();
  else showAuth();
  onAuthChange((session) => {
    if (session && !data) bootAfterAuth();
    if (!session) { data = null; showAuth(); }
  });
})();