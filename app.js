import {
  STAT_DEFS, loadData, saveData, resetData,
  overallLevel, statLevel, rankFromLevel, todayKey
} from './store.js';

let data = loadData();

function allCompletedOn(dateKey) {
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
}

function toggleQuest(id) {
  const q = data.quests.find((q) => q.id === id);
  if (!q) return;
  const tKey = todayKey();
  if (!data.completions[tKey]) data.completions[tKey] = [];
  const list = data.completions[tKey];
  const idx = list.indexOf(id);

  const beforeOverall = overallLevel(data.totalXP).level;
  const beforeStat = statLevel((data.stats[q.stat] && data.stats[q.stat].xp) || 0).level;

  if (idx === -1) {
    list.push(id);
    data.totalXP += q.xp;
    if (!data.stats[q.stat]) data.stats[q.stat] = { xp: 0 };
    data.stats[q.stat].xp += q.xp;
  } else {
    list.splice(idx, 1);
    data.totalXP = Math.max(0, data.totalXP - q.xp);
    data.stats[q.stat].xp = Math.max(0, data.stats[q.stat].xp - q.xp);
  }

  const afterOverall = overallLevel(data.totalXP).level;
  const afterStat = statLevel(data.stats[q.stat].xp).level;

  render();
  saveData(data);

  if (afterOverall > beforeOverall) {
    showLevelUp(`LV ${afterOverall}`, `Overall level increased to ${afterOverall}.`);
  } else if (afterStat > beforeStat) {
    showLevelUp('LEVEL UP', `${STAT_DEFS[q.stat].label} increased to LV ${afterStat}.`);
  }
}

function deleteQuest(id) {
  data.quests = data.quests.filter((q) => q.id !== id);
  render();
  saveData(data);
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

function initEvents() {
  document.getElementById('hunterName').addEventListener('blur', (e) => {
    data.name = e.target.textContent.trim() || 'Hunter';
    saveData(data);
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
  document.getElementById('saveQuestBtn').addEventListener('click', () => {
    const name = document.getElementById('questNameInput').value.trim();
    const stat = document.getElementById('questStatInput').value;
    const xp = Math.max(1, parseInt(document.getElementById('questXpInput').value) || 10);
    if (!name) return;
    data.quests.push({ id: 'q' + Date.now(), name, stat, xp });
    overlayEl.classList.remove('open');
    render();
    saveData(data);
  });

  document.getElementById('resetBtn').addEventListener('click', () => {
    if (confirm('Reset all progress? This clears your levels, stats and quests back to defaults.')) {
      data = resetData();
      render();
    }
  });

  // PWA install prompt
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

initEvents();
render();
