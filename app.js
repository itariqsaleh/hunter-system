import {
  STAT_DEFS, loadData, saveProfile, addQuestRemote, deleteQuestRemote, toggleCompletionRemote,
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
    document.getElementById('authError').textContent = 'Signed in, but could not load your data.';
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
    errEl.textContent = 'Account created! Logging you in...';
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
      alert('Could not add that quest.');
    }
  });

  document.getElementById('resetBtn').addEventListener('click', async () => {
    if (!confirm('Reset your XP and stats back to zero? Quests stay.')) return;
    data.totalXP = 0;
    Object.keys(data.stats).forEach((k) => (data.stats[k].xp = 0));
    render();
    try {
      await saveProfile({ name: data.name, totalXP: 0, stats: data.stats });
    } catch (e) {
      console.error('reset failed', e);
    }
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
