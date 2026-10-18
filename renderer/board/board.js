const PARAMS = new URLSearchParams(location.search);
const MODE = ['edit', 'task'].includes(PARAMS.get('mode')) ? PARAMS.get('mode') : 'wallpaper';
const EDIT = MODE === 'edit';
const TASK = MODE === 'task'; // 壁紙から修飾キー + クリックで開く、タスク 1 件だけの編集ウィンドウ
document.body.classList.add(`mode-${MODE}`);

const STATUSES = [
  { key: 'queue', code: '01', name: 'QUEUE', jp: '待機', color: '#7aa7ff' },
  { key: 'active', code: '02', name: 'ACTIVE', jp: '進行中', color: 'var(--accent)' },
  { key: 'done', code: '03', name: 'COMPLETE', jp: '完了', color: 'var(--ok)' },
];
const PRIORITIES = [
  { key: 'critical', name: 'CRITICAL', jp: '緊急', color: 'var(--danger)' },
  { key: 'high', name: 'HIGH', jp: '高', color: 'var(--warn)' },
  { key: 'normal', name: 'NORMAL', jp: '中', color: 'var(--accent)' },
  { key: 'low', name: 'LOW', jp: '低', color: '#7d8fa8' },
];
const WEEK = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n, w = 2) => String(n).padStart(w, '0');

let tasks = [];
let config = {};
let insets = { top: 0, left: 0, right: 0, bottom: 0 };
let showDone = true;
let query = '';
let editing = null; // 編集中のタスクのコピー
let lastSync = new Date();

const taskCode = (t) => `CB-${pad(t.no ?? 0, 3)}`;
const statusOf = (key) => STATUSES.find((s) => s.key === key) || STATUSES[0];
const prioOf = (key) => PRIORITIES.find((p) => p.key === key) || PRIORITIES[2];
const prioRank = (t) => PRIORITIES.indexOf(prioOf(t.priority));

// 期日までの余裕度。カードの枠の色に使う
const URGENCY = [
  { key: 'over', label: 'OVERDUE', jp: '期限切れ' },
  { key: 'crit', label: '≤2D', jp: '2日以内' },
  { key: 'warn', label: '≤7D', jp: '1週間以内' },
  { key: 'safe', label: '8D+', jp: '8日以上の余裕' },
  { key: 'none', label: 'NO DUE', jp: '期限なし' },
];

function urgencyOf(t) {
  if (t.status === 'done') return 'done';
  const n = daysLeft(t.due);
  if (n === null) return 'none';
  if (n < 0) return 'over';
  if (n <= 2) return 'crit';
  if (n <= 7) return 'warn';
  return 'safe';
}

function today() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysLeft(due) {
  if (!due) return null;
  const [y, m, d] = due.split('-').map(Number);
  return Math.round((new Date(y, m - 1, d) - today()) / 86400000);
}

function dueInfo(t) {
  const n = daysLeft(t.due);
  if (n === null) return null;
  const [, m, d] = t.due.split('-').map(Number);
  const date = `${pad(m)}.${pad(d)}`;
  if (t.status === 'done') return { short: date, text: date, cls: '', n };
  if (n < 0) return { short: `-${-n}D`, text: `OVERDUE ${-n}D · ${date}`, cls: 'overdue', n };
  if (n === 0) return { short: 'TODAY', text: `TODAY · ${date}`, cls: 'soon', n };
  return { short: `T-${n}D`, text: `T-${n}D · ${date}`, cls: n <= 2 ? 'soon' : '', n };
}

function visibleTasks() {
  let list = tasks.slice();
  if (EDIT) {
    if (!showDone) list = list.filter((t) => t.status !== 'done');
    if (query) {
      const q = query.toLowerCase();
      list = list.filter((t) => [t.title, t.notes, taskCode(t), ...(t.tags || [])].join(' ').toLowerCase().includes(q));
    }
  } else {
    const days = Number(config.hideCompletedAfterDays ?? 3);
    if (days >= 0) {
      const limit = Date.now() - days * 86400000;
      list = list.filter((t) => t.status !== 'done' || !t.completedAt || new Date(t.completedAt).getTime() > limit);
    }
  }
  return list;
}

/* ───────── render ───────── */

function cardHTML(t) {
  const p = prioOf(t.priority);
  const due = dueInfo(t);
  const subs = t.subtasks || [];
  const doneSubs = subs.filter((s) => s.done).length;
  const segs = subs.length ? subs.slice(0, 12).map((_, i) => `<i class="${i < Math.round(doneSubs / subs.length * Math.min(12, subs.length)) ? 'on' : ''}"></i>`).join('') : '';
  const idx = STATUSES.findIndex((s) => s.key === t.status);
  return `
    <article class="card p-${p.key} s-${t.status} u-${urgencyOf(t)}" data-id="${esc(t.id)}" ${EDIT ? 'draggable="true"' : ''}>
      <div class="card-shell"><div class="card-body">
        <div class="card-head">
          <span class="card-id">${taskCode(t)}</span>
          <span class="prio-tag">${p.name}</span>
          ${due ? `<span class="due ${due.cls}">${due.text}</span>` : ''}
        </div>
        <h3 class="card-title">${esc(t.title)}</h3>
        ${t.notes ? `<p class="card-notes">${esc(t.notes)}</p>` : ''}
        ${subs.length ? `<div class="sub"><div class="seg">${segs}</div><span>${doneSubs}/${subs.length}</span></div>` : ''}
        ${t.tags?.length ? `<div class="tags">${t.tags.map((g) => `<span>#${esc(g)}</span>`).join('')}</div>` : ''}
        ${EDIT ? `<div class="card-actions">
          ${idx > 0 ? '<button data-act="back" title="前の列へ">◀</button>' : ''}
          ${idx < STATUSES.length - 1 ? '<button data-act="next" title="次の列へ">▶</button>' : ''}
          ${t.status !== 'done' ? '<button data-act="done" class="done-btn" title="完了">✔</button>' : ''}
        </div>` : ''}
      </div></div>
    </article>`;
}

function renderColumns() {
  const list = visibleTasks();
  const cols = $('columns');
  cols.innerHTML = STATUSES.map((s) => {
    // 優先度の高い順。同じ優先度の中では手動の並び順を保つ（sort は安定）
    const items = list
      .filter((t) => (t.status || 'queue') === s.key)
      .sort((a, b) => prioRank(a) - prioRank(b));
    return `
      <section class="column frame" style="--sc:${s.color}" data-status="${s.key}">
        <header class="col-head">
          <span class="code">${s.code}</span>
          <h2>${s.name}</h2>
          <span class="jp">${s.jp}</span>
          <span class="num">${pad(items.length)}</span>
        </header>
        <div class="list" data-status="${s.key}">
          ${items.length ? items.map(cardHTML).join('') : `<div class="empty-col">NO TASKS</div>`}
        </div>
        <div class="more" hidden></div>
      </section>`;
  }).join('');
  if (!EDIT) requestAnimationFrame(fitColumns);
}

// 壁紙ではスクロールできないので、収まらないカードを隠して「+N MORE」を出す
function fitColumns() {
  for (const col of document.querySelectorAll('.column')) {
    const list = col.querySelector('.list');
    const more = col.querySelector('.more');
    const cards = [...list.querySelectorAll('.card')];
    cards.forEach((c) => { c.hidden = false; });
    more.hidden = true;
    if (list.scrollHeight <= list.clientHeight + 1) continue;
    more.hidden = false;
    let hidden = 0;
    for (let i = cards.length - 1; i >= 0 && list.scrollHeight > list.clientHeight + 1; i--) {
      cards[i].hidden = true;
      hidden++;
      more.textContent = `+${hidden} MORE`;
    }
  }
}

function renderSide() {
  const total = tasks.length;
  const by = Object.fromEntries(STATUSES.map((s) => [s.key, tasks.filter((t) => (t.status || 'queue') === s.key).length]));
  const pct = total ? Math.round((by.done / total) * 100) : 0;
  const C = 2 * Math.PI * 47;
  $('ring-fill').style.strokeDasharray = `${(C * pct) / 100} ${C}`;
  $('ring-pct').textContent = pct;
  $('counts').innerHTML = STATUSES.map((s) => `<div class="count" style="--sc:${s.color}"><b>${pad(by[s.key])}</b><span>${s.name}</span></div>`).join('');

  const open = tasks.filter((t) => t.status !== 'done');
  const pc = PRIORITIES.map((p) => open.filter((t) => (t.priority || 'normal') === p.key).length);
  const max = Math.max(1, ...pc);
  $('prio-bars').innerHTML = PRIORITIES.map((p, i) => `
    <div class="prio-row" style="--pc:${p.color}">
      <label>${p.name}</label>
      <div class="bar"><i style="width:${(pc[i] / max) * 100}%"></i></div>
      <b>${pc[i]}</b>
    </div>`).join('');

  const up = open.filter((t) => t.due).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 8);
  $('upcoming').innerHTML = up.length
    ? up.map((t) => {
      const d = dueInfo(t);
      return `<li class="${d.cls} u-${urgencyOf(t)}"><span class="t">${d.short}</span><span class="n">${esc(t.title)}</span></li>`;
    }).join('')
    : '<li class="empty">// NO DEADLINES</li>';
}

function renderTicker() {
  const open = tasks.filter((t) => t.status !== 'done');
  const msgs = [];
  const overdue = open.filter((t) => (daysLeft(t.due) ?? 1) < 0);
  const todayDue = open.filter((t) => daysLeft(t.due) === 0);
  overdue.forEach((t) => msgs.push(`<span class="d">!! ALERT</span> ${taskCode(t)} 「${esc(t.title)}」 期限超過 ${-daysLeft(t.due)}日`));
  todayDue.forEach((t) => msgs.push(`<span class="w">▲ DUE TODAY</span> ${taskCode(t)} 「${esc(t.title)}」`));
  tasks.filter((t) => t.status === 'active').forEach((t) => {
    const subs = t.subtasks || [];
    const prog = subs.length ? ` ${Math.round((subs.filter((s) => s.done).length / subs.length) * 100)}%` : '';
    msgs.push(`<b>► RUNNING</b> ${taskCode(t)} ${esc(t.title)}${prog}`);
  });
  const done = tasks.filter((t) => t.status === 'done').length;
  msgs.push(`<span class="k">■ STATUS</span> TOTAL ${tasks.length} / OPEN ${open.length} / DONE ${done}`);
  const how = [config.editorShortcut && config.editorShortcut.replace('Control', 'CTRL').toUpperCase(), config.clickModifier && `${config.clickModifier.toUpperCase()}+CLICK`].filter(Boolean);
  msgs.push(`<b>SYS</b> ALL MODULES NOMINAL · ${how.length ? how.join(' / ') : 'TRAY ICON'} で編集`);
  const html = msgs.map((m) => `<span>${m}</span>`).join('');
  const track = $('ticker');
  track.innerHTML = html + html;
  track.style.setProperty('--dur', `${Math.max(30, msgs.length * 12)}s`);
}

function renderLegend() {
  $('legend').innerHTML = '<span class="legend-cap">DUE</span>'
    + URGENCY.map((u) => `<span class="u-${u.key}" title="${u.jp}"><i></i>${u.label}</span>`).join('');
}

function render() {
  if (TASK) return;
  renderColumns();
  renderSide();
  renderTicker();
}

/* ───────── clock ───────── */

function tick() {
  const d = new Date();
  $('time').innerHTML = `${pad(d.getHours())}:${pad(d.getMinutes())}<span>:${pad(d.getSeconds())}</span>`;
  $('date').textContent = `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${WEEK[d.getDay()]}`;
  $('chip-sync').textContent = `SYNC ${pad(lastSync.getHours())}:${pad(lastSync.getMinutes())}`;
}
let lastDay = new Date().getDate();
setInterval(() => {
  tick();
  // 日付が変わったら期限表示を更新
  if (new Date().getDate() !== lastDay) { lastDay = new Date().getDate(); render(); }
}, 1000);

/* ───────── config ───────── */

function applyConfig() {
  const root = document.documentElement.style;
  if (config.accent) root.setProperty('--accent', config.accent);
  if (config.accent2) root.setProperty('--accent2', config.accent2);
  root.setProperty('--ins-top', `${insets.top}px`);
  root.setProperty('--ins-left', `${insets.left}px`);
  root.setProperty('--ins-right', `${insets.right}px`);
  root.setProperty('--ins-bottom', `${insets.bottom}px`);
  const hud = $('hud').style;
  hud.setProperty('--w', Math.min(1, Math.max(0.3, Number(config.boardWidth) || 0.84)));
  hud.setProperty('--h', Math.min(1, Math.max(0.3, Number(config.boardHeight) || 0.88)));
  document.body.classList.remove('layout-left', 'layout-right', 'layout-center');
  document.body.classList.add(`layout-${config.layout || 'center'}`);
  document.body.classList.toggle('no-ambient', config.ambient === false);
  $('title').innerHTML = esc(config.title || 'CYBER//BOARD').replace('//', '<em>//</em>');
  window.CyberBG?.configure({ accent: config.accent, accent2: config.accent2, ambient: config.ambient !== false && !TASK, fps: Number(config.fps) || 30 });
}

/* ───────── editing ───────── */

async function commit() {
  lastSync = new Date();
  await window.cyberBoard.save(tasks);
}

function setStatus(t, status) {
  if (t.status === status) return;
  t.status = status;
  t.completedAt = status === 'done' ? new Date().toISOString() : null;
}

function renderPickers() {
  $('status-picker').innerHTML = STATUSES.map((s) => `<button type="button" data-v="${s.key}" style="--pc:${s.color}" class="${editing.status === s.key ? 'on' : ''}">${s.name}<small>${s.jp}</small></button>`).join('');
  $('prio-picker').innerHTML = PRIORITIES.map((p) => `<button type="button" data-v="${p.key}" style="--pc:${p.color}" class="${editing.priority === p.key ? 'on' : ''}">${p.name}<small>${p.jp}</small></button>`).join('');
}

function renderSubtaskEdit() {
  $('subtask-edit').innerHTML = editing.subtasks.map((s, i) => `
    <li class="${s.done ? 'done' : ''}" data-i="${i}">
      <input type="checkbox" ${s.done ? 'checked' : ''}>
      <input type="text" value="${esc(s.text)}" maxlength="80">
      <button type="button" class="x" title="削除">✕</button>
    </li>`).join('');
}

function openDialog(task) {
  const isNew = !task;
  const nextNo = Math.max(0, ...tasks.map((t) => t.no || 0)) + 1;
  editing = task
    ? { ...task, tags: [...(task.tags || [])], subtasks: (task.subtasks || []).map((s) => ({ ...s })) }
    : { id: `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, no: nextNo, title: '', notes: '', status: 'queue', priority: 'normal', due: '', tags: [], subtasks: [], createdAt: new Date().toISOString(), completedAt: null };
  const f = $('form');
  f.title.value = editing.title;
  f.notes.value = editing.notes || '';
  f.due.value = editing.due || '';
  f.tags.value = editing.tags.join(' ');
  $('subtask-input').value = '';
  $('dialog-id').textContent = taskCode(editing);
  $('dialog-title').textContent = isNew ? 'NEW TASK' : 'EDIT TASK';
  $('btn-delete').hidden = isNew;
  editing._new = isNew;
  renderPickers();
  renderSubtaskEdit();
  $('dialog').showModal();
  f.title.focus();
}

function addSubtask() {
  const input = $('subtask-input');
  const text = input.value.trim();
  if (!text) return;
  editing.subtasks.push({ text, done: false });
  input.value = '';
  renderSubtaskEdit();
}

function saveDialog() {
  const f = $('form');
  const title = f.title.value.trim();
  if (!title) return;
  const prevStatus = tasks.find((t) => t.id === editing.id)?.status;
  const t = {
    ...editing,
    title,
    notes: f.notes.value.trim(),
    due: f.due.value,
    tags: f.tags.value.split(/[\s,、]+/).map((s) => s.replace(/^#/, '')).filter(Boolean),
    subtasks: editing.subtasks.filter((s) => s.text.trim()),
  };
  delete t._new;
  if (t.status !== prevStatus) t.completedAt = t.status === 'done' ? new Date().toISOString() : null;
  const i = tasks.findIndex((x) => x.id === t.id);
  if (i >= 0) tasks[i] = t; else tasks.push(t);
  render();
  commit();
  $('dialog').close();
}

function initEditor() {
  $('btn-new').addEventListener('click', () => openDialog(null));
  $('search').addEventListener('input', (e) => { query = e.target.value.trim(); renderColumns(); });
  $('chk-done').addEventListener('change', (e) => { showDone = e.target.checked; renderColumns(); });
  $('btn-clear').addEventListener('click', () => {
    const n = tasks.filter((t) => t.status === 'done').length;
    if (!n || !confirm(`完了済みのタスク ${n} 件を削除します。よろしいですか？`)) return;
    tasks = tasks.filter((t) => t.status !== 'done');
    render();
    commit();
  });

  document.addEventListener('keydown', (e) => {
    if ($('dialog').open) return;
    if (e.target.matches('input, textarea')) return;
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openDialog(null); }
    if (e.key === '/') { e.preventDefault(); $('search').focus(); }
  });

  // カードのクリック・クイック操作
  $('columns').addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const t = tasks.find((x) => x.id === card.dataset.id);
    if (!t) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act) {
      const idx = STATUSES.findIndex((s) => s.key === t.status);
      if (act === 'next') setStatus(t, STATUSES[Math.min(STATUSES.length - 1, idx + 1)].key);
      if (act === 'back') setStatus(t, STATUSES[Math.max(0, idx - 1)].key);
      if (act === 'done') setStatus(t, 'done');
      render();
      commit();
      return;
    }
    openDialog(t);
  });

  // ドラッグ & ドロップ
  let dragId = null;
  const line = document.createElement('div');
  line.className = 'drop-line';
  const clearDrop = () => {
    line.remove();
    document.querySelectorAll('.drop-target').forEach((el) => el.classList.remove('drop-target'));
  };
  const beforeCard = (list, y) => [...list.querySelectorAll('.card:not(.dragging)')].find((c) => {
    const r = c.getBoundingClientRect();
    return y < r.top + r.height / 2;
  }) || null;

  $('columns').addEventListener('dragstart', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    dragId = card.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
    requestAnimationFrame(() => card.classList.add('dragging'));
  });
  $('columns').addEventListener('dragend', () => {
    dragId = null;
    clearDrop();
    document.querySelectorAll('.dragging').forEach((el) => el.classList.remove('dragging'));
  });
  $('columns').addEventListener('dragover', (e) => {
    const col = e.target.closest('.column');
    if (!dragId || !col) return;
    e.preventDefault();
    const list = col.querySelector('.list');
    document.querySelectorAll('.drop-target').forEach((el) => el !== list && el.classList.remove('drop-target'));
    list.classList.add('drop-target');
    list.querySelector('.empty-col')?.remove();
    const before = beforeCard(list, e.clientY);
    if (before) list.insertBefore(line, before); else list.appendChild(line);
  });
  $('columns').addEventListener('drop', (e) => {
    const col = e.target.closest('.column');
    if (!dragId || !col) return;
    e.preventDefault();
    const list = col.querySelector('.list');
    const before = beforeCard(list, e.clientY);
    const t = tasks.find((x) => x.id === dragId);
    clearDrop();
    if (!t) return;
    setStatus(t, col.dataset.status);
    tasks = tasks.filter((x) => x !== t);
    if (before) {
      tasks.splice(tasks.findIndex((x) => x.id === before.dataset.id), 0, t);
    } else {
      // 列の末尾 = その列の最後のタスクの直後
      let last = -1;
      tasks.forEach((x, i) => { if (x.status === t.status) last = i; });
      tasks.splice(last + 1, 0, t);
    }
    render();
    commit();
  });

}

function initDialog() {
  $('form').addEventListener('submit', (e) => { e.preventDefault(); saveDialog(); });
  $('btn-cancel').addEventListener('click', () => $('dialog').close());
  $('btn-delete').addEventListener('click', () => {
    if (!confirm(`「${editing.title}」を削除します。よろしいですか？`)) return;
    tasks = tasks.filter((t) => t.id !== editing.id);
    render();
    commit();
    $('dialog').close();
  });
  $('status-picker').addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.v;
    if (v) { editing.status = v; renderPickers(); }
  });
  $('prio-picker').addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.v;
    if (v) { editing.priority = v; renderPickers(); }
  });
  $('subtask-add').addEventListener('click', addSubtask);
  $('subtask-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addSubtask(); }
  });
  $('subtask-edit').addEventListener('input', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    const s = editing.subtasks[Number(li.dataset.i)];
    if (e.target.type === 'checkbox') { s.done = e.target.checked; li.classList.toggle('done', s.done); }
    else s.text = e.target.value;
  });
  $('subtask-edit').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.preventDefault(); // サブタスク編集中の Enter で保存しない
  });
  $('subtask-edit').addEventListener('click', (e) => {
    if (!e.target.closest('.x')) return;
    editing.subtasks.splice(Number(e.target.closest('li').dataset.i), 1);
    renderSubtaskEdit();
  });
  if (TASK) $('dialog').addEventListener('close', () => window.close());
}

// 壁紙の座標 (x, y) にあるものを返す。main プロセスが修飾キー + クリック時に呼ぶ
window.__hitTest = (x, y) => {
  const el = document.elementFromPoint(x, y);
  if (!el?.closest('.hud')) return null;
  const card = el.closest('.card');
  return card ? { type: 'task', id: card.dataset.id } : { type: 'board' };
};

/* ───────── boot ───────── */

(async () => {
  const state = await window.cyberBoard.getState();
  tasks = state.tasks;
  config = state.config;
  insets = state.insets;
  applyConfig();
  renderLegend();
  tick();
  render();
  if (EDIT || TASK) initDialog();
  if (EDIT) initEditor();

  window.cyberBoard.on('tasks', (list) => { tasks = list; lastSync = new Date(); tick(); render(); });

  if (TASK) {
    const t = tasks.find((x) => x.id === PARAMS.get('id'));
    if (!t) { window.close(); return; }
    openDialog(t);
    // 内容の高さにウィンドウを合わせる（サブタスクの追加などで伸び縮みする）
    new ResizeObserver(() => window.cyberBoard.resizeTask(Math.ceil($('form').getBoundingClientRect().height) + 2)).observe($('form'));
    return;
  }
  window.cyberBoard.on('config', (c) => { config = c; applyConfig(); render(); });
  let rt = null;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => (EDIT ? null : fitColumns()), 200); });
  document.fonts?.ready.then(() => { if (!EDIT) fitColumns(); });
})();
