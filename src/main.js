// Cyber Monitor: Performance Monitor と Cyber Board をモニターごとに壁紙レイヤーへ表示する統合版
const { app, BrowserWindow, screen, Tray, Menu, nativeImage, shell, ipcMain, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');
const readline = require('readline');
const { SystemCollector } = require('./collectors/system');
const { ClaudeCollector } = require('./collectors/claude');
const catLines = require('./cat-lines');

// 壁紙レイヤーに入れると Chromium が「隠れている」と判定して描画を止めるので無効化
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const DATA_DIR = path.join(ROOT, 'data');
const TASKS_PATH = path.join(DATA_DIR, 'tasks.json');
const WINDOW_MODE = process.argv.includes('--window'); // デバッグ用: 壁紙を普通のウィンドウで表示
const OPEN_EDITOR = process.argv.includes('--edit');
const CAPTURE = process.argv.find((a) => a.startsWith('--capture='))?.slice(10); // デバッグ用: 各壁紙を <prefix>-<モニター番号>-<種類>.png に保存
const CAPTURE_EDITOR = process.argv.find((a) => a.startsWith('--capture-editor='))?.slice(17);
const CAPTURE_TASK = process.argv.find((a) => a.startsWith('--capture-task='))?.slice(15);
const SIMULATE_CLICK = process.argv.find((a) => a.startsWith('--simulate-click='))?.slice(17); // デバッグ用: "x,y"（物理ピクセル）
const CAT_DEMO = process.argv.includes('--cat-demo'); // デバッグ用: 猫が数秒ごとにしゃべる・伸びる
const CAT_LINE = process.argv.find((a) => a.startsWith('--cat-line='))?.slice(11); // デバッグ用: セリフを固定
// デバッグ用: キャプチャするまでの時間（ミリ秒）。"9000,13000" のように複数指定すると <prefix>-<モニター番号>-<種類>-<時間>.png に保存
const CAPTURE_DELAYS = (process.argv.find((a) => a.startsWith('--capture-delay='))?.slice(16) || '8000').split(',').map(Number).filter((n) => n > 0);
const ANONYMIZE = process.argv.includes('--anonymize'); // スクリーンショット用: PC 名・Wi-Fi 名・IP アドレスを仮の値にする
const CAT_ON = process.argv.find((a) => a.startsWith('--cat-on='))?.slice(9); // デバッグ用: 猫を perf / board の上だけに出す

// モニターに割り当てる表示
const ROLES = [
  { key: 'perf', name: 'Performance Monitor' },
  { key: 'board', name: 'Cyber Board' },
  { key: 'none', name: '表示しない' },
];
const roleName = (key) => ROLES.find((r) => r.key === key)?.name || key;

const DEFAULT_BOARD = {
  layout: 'center',
  boardWidth: 0.84,
  boardHeight: 0.88,
  hideCompletedAfterDays: 3,
  editorShortcut: 'Control+Alt+B',
  ambient: true,
  fps: 30,
  accent: '#00f0ff',
  accent2: '#ff2bd6',
  title: 'CYBER//BOARD',
  clickModifier: 'Alt',
};

const DEFAULT_PERF = {
  layout: 'right',
  fps: 20,
  accent: '#38f6ff',
  accent2: '#ff3df0',
  backgroundImage: '',
  backgroundDim: 0.55,
  historySeconds: 120,
  gpu: { source: 'auto' },
  claude: { enabled: true, projectsDir: '', tokenLimit5h: 0, refreshSeconds: 30 },
};

// 壁紙の上の猫
const CAT_BREEDS = [
  { key: 'white', name: '白猫' },
  { key: 'black', name: '黒猫' },
  { key: 'hachiware', name: 'ハチワレ' },
];
const DEFAULT_CAT = {
  enabled: true,
  breed: 'white',
  scale: 3,          // ドット絵の表示倍率
  actionMinutes: 3,  // しゃべる・伸びるの間隔（分）
  moveMinutes: 60,   // 座る場所を変える間隔（分）
  sleepChance: 0.2,  // 引っ越し先で次の引っ越しまで眠ったままになる確率（深夜 0〜5 時は 0.6）
};

if (!app.requestSingleInstanceLock()) app.exit(0);

let lastWritten = ''; // 自分で書いた内容（ファイル監視での二重反映を防ぐ）
let lastConfigWritten = '';
let config = loadConfig();
let tasks = loadTasks();
let wallpapers = []; // { win, display, role }
let editor = null;
let taskWin = null;
let tray = null;
let clickHook = null;
let perf = null; // 収集中の Performance Monitor データ（Performance Monitor を表示しているモニターがあるときだけ動かす）
let quitting = false;

/* ───────── config ───────── */

function parseConfig(raw) {
  const board = { ...DEFAULT_BOARD, ...(raw.board || {}) };
  const p = raw.perf || {};
  return {
    screens: raw.screens && typeof raw.screens === 'object' ? raw.screens : {},
    board,
    perf: { ...DEFAULT_PERF, ...p, gpu: { ...DEFAULT_PERF.gpu, ...(p.gpu || {}) }, claude: { ...DEFAULT_PERF.claude, ...(p.claude || {}) } },
    cat: { ...DEFAULT_CAT, ...(raw.cat || {}) },
  };
}

function readRawConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function loadConfig() {
  try {
    return parseConfig(readRawConfig());
  } catch (e) {
    console.error('config.json の読み込みに失敗:', e.message);
    return parseConfig({});
  }
}

// トレイで選んだ設定を config.json に書き戻す（ほかの項目はそのまま）
function updateConfig(mutate) {
  let raw = {};
  try { raw = readRawConfig(); } catch { /* 壊れていたら作り直す */ }
  mutate(raw);
  const text = JSON.stringify(raw, null, 2) + '\n';
  fs.writeFileSync(CONFIG_PATH, text, 'utf8');
  lastConfigWritten = text;
  config = parseConfig(raw);
}

/* ───────── モニターの割り当て ───────── */

// サブモニターの順番: 左から右、上から下
function orderedDisplays() {
  const primary = screen.getPrimaryDisplay();
  const others = screen.getAllDisplays().filter((d) => d.id !== primary.id)
    .sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
  return [primary, ...others];
}

// 既定: メイン = Performance Monitor、1 台目のサブ = Cyber Board、それ以降 = 表示しない
function defaultRole(display) {
  const i = orderedDisplays().findIndex((d) => d.id === display.id);
  return i === 0 ? 'perf' : i === 1 ? 'board' : 'none';
}

function roleOf(display) {
  const r = config.screens[String(display.id)];
  return ROLES.some((x) => x.key === r) ? r : defaultRole(display);
}

function setRole(display, role) {
  updateConfig((raw) => {
    raw.screens = { ...(raw.screens || {}) };
    // 既定と同じなら書かない（モニター構成が変わったときに既定へ追従できるように）
    if (role === defaultRole(display)) delete raw.screens[String(display.id)];
    else raw.screens[String(display.id)] = role;
  });
  rebuildWallpapers();
  refreshTray();
}

function swapRoles(a, b) {
  const ra = roleOf(a), rb = roleOf(b);
  updateConfig((raw) => {
    raw.screens = { ...(raw.screens || {}) };
    for (const [d, r] of [[a, rb], [b, ra]]) {
      if (r === defaultRole(d)) delete raw.screens[String(d.id)];
      else raw.screens[String(d.id)] = r;
    }
  });
  rebuildWallpapers();
  refreshTray();
}

function resetRoles() {
  updateConfig((raw) => { raw.screens = {}; });
  rebuildWallpapers();
  refreshTray();
}

/* ───────── 壁紙ウィンドウ ───────── */

const boardWallpapers = () => wallpapers.filter((w) => w.role === 'board' && !w.win.isDestroyed());
const perfWallpapers = () => wallpapers.filter((w) => w.role === 'perf' && !w.win.isDestroyed());

function insetsOf(display) {
  const b = display.bounds;
  const w = display.workArea;
  return { top: w.y - b.y, left: w.x - b.x, right: b.x + b.width - (w.x + w.width), bottom: b.y + b.height - (w.y + w.height) };
}

function embed(win, display) {
  const r = screen.dipToScreenRect(null, display.bounds);
  const hwnd = win.getNativeWindowHandle().readBigInt64LE(0).toString();
  const script = path.join(__dirname, 'native', 'embed.ps1');
  execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Hwnd', hwnd, '-X', r.x, '-Y', r.y, '-W', r.width, '-H', r.height].map(String),
    { windowsHide: true, timeout: 20000 },
    (err, out, errOut) => {
      if (err) console.error('[embed] 失敗:', err.message, errOut);
      else console.log('[embed]', out.trim());
    },
  );
}

function capture(win, file, delay) {
  setTimeout(async () => {
    if (win.isDestroyed()) return;
    const img = await win.webContents.capturePage();
    fs.writeFileSync(file, img.toPNG());
    console.log('[capture] saved', file);
  }, delay);
}

function createWallpaper(display, role, index) {
  const { x, y, width, height } = display.bounds;
  const isBoard = role === 'board';
  const win = new BrowserWindow({
    x, y, width, height,
    frame: false,
    show: false,
    resizable: false,
    skipTaskbar: !WINDOW_MODE,
    focusable: WINDOW_MODE,
    backgroundColor: isBoard ? '#03060c' : '#04060b',
    title: `Cyber Monitor — ${roleName(role)}`,
    webPreferences: {
      preload: path.join(__dirname, isBoard ? 'preload-board.js' : 'preload-perf.js'),
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  win.setMenu(null);
  if (isBoard) {
    win.loadFile(path.join(ROOT, 'renderer', 'board', 'index.html'), { query: { mode: 'wallpaper' } });
  } else {
    win.loadFile(path.join(ROOT, 'renderer', 'perf', 'index.html'));
    win.webContents.on('did-finish-load', () => sendPerfInit(win, display));
  }
  if (CAPTURE) {
    for (const d of CAPTURE_DELAYS) capture(win, `${CAPTURE}-${index + 1}-${role}${CAPTURE_DELAYS.length > 1 ? `-${d}` : ''}.png`, d);
  }
  win.once('ready-to-show', () => {
    if (WINDOW_MODE) { win.show(); return; }
    win.showInactive();
    embed(win, display);
  });
  const wcId = win.webContents.id;
  win.on('closed', () => {
    wallpapers = wallpapers.filter((w) => w.win !== win);
    catSpots.delete(wcId);
    if (catHost?.id === wcId) catHost = null; // 新しい壁紙が場所を知らせてきたら座り直す
  });
  wallpapers.push({ win, display, role });
}

function createWallpapers() {
  orderedDisplays().forEach((display, i) => {
    const role = roleOf(display);
    if (role !== 'none') createWallpaper(display, role, i);
  });
  if (perfWallpapers().length) ensurePerf();
  else stopPerf();
  syncClickHook();
}

function rebuildWallpapers() {
  const old = wallpapers;
  wallpapers = [];
  old.forEach((w) => w.win.destroy());
  createWallpapers();
}

/* ───────── Performance Monitor ───────── */

function perfRendererConfig(display) {
  const c = config.perf;
  let bg = '';
  if (c.backgroundImage) {
    const p = path.isAbsolute(c.backgroundImage) ? c.backgroundImage : path.join(ROOT, c.backgroundImage);
    if (fs.existsSync(p)) bg = 'file:///' + p.replace(/\\/g, '/');
  }
  return {
    ...c,
    backgroundImage: bg,
    claude: { ...c.claude, enabled: c.claude?.enabled !== false },
    insets: insetsOf(display),
    primary: display.id === screen.getPrimaryDisplay().id,
  };
}

function broadcastPerf(channel, data) {
  for (const { win } of perfWallpapers()) win.webContents.send(channel, data);
}

function ensurePerf() {
  if (perf) return perf;
  const p = { system: new SystemCollector(config.perf), timers: [], lastClaude: null, stopped: false };
  perf = p;
  p.ready = (async () => {
    try {
      await p.system.start();
    } catch (e) {
      console.error('[perf] 収集の開始に失敗:', e);
    }
    if (p.stopped) { p.system.stop(); return; } // 起動中に止められた
    let busy = false;
    p.timers.push(setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        p.lastMetrics = await p.system.sample();
        broadcastPerf('metrics', ANONYMIZE ? anonymizeMetrics(p.lastMetrics) : p.lastMetrics);
      } catch (e) { console.error(e); }
      busy = false;
    }, 1000));

    if (config.perf.claude?.enabled !== false) {
      const claude = new ClaudeCollector(config.perf.claude || {});
      const tick = () => {
        try {
          p.lastClaude = claude.collect();
          broadcastPerf('claude', p.lastClaude);
        } catch (e) { console.error('[claude]', e); }
      };
      tick();
      p.timers.push(setInterval(tick, (config.perf.claude?.refreshSeconds || 30) * 1000));
    }
  })();
  return p;
}

function stopPerf() {
  const p = perf;
  perf = null;
  if (!p) return;
  p.stopped = true;
  p.timers.forEach(clearInterval);
  p.system.stop();
}

async function sendPerfInit(win, display) {
  const p = ensurePerf();
  await p.ready;
  if (win.isDestroyed() || perf !== p) return;
  const st = ANONYMIZE ? { ...p.system.static, hostname: 'CYBER-PC' } : p.system.static;
  win.webContents.send('init', { config: perfRendererConfig(display), static: st });
  if (p.lastClaude) win.webContents.send('claude', p.lastClaude);
}

// --anonymize: 画面に出る個人を特定しうる値を仮の値にする
function anonymizeMetrics(m) {
  const net = m.net || {};
  return {
    ...m,
    net: {
      ...net,
      iface: net.iface && { ...net.iface, name: 'Ethernet', ip: '192.168.0.10' },
      wifi: net.wifi && { ...net.wifi, ssid: 'NEON-NET', adapter: 'Wi-Fi' },
    },
  };
}

function restartPerf() {
  config = loadConfig();
  stopPerf();
  rebuildWallpapers();
}

/* ───────── Cyber Board ───────── */

function sampleTasks() {
  const now = new Date();
  const day = (n) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const t = (no, title, notes, status, priority, due, tags, subtasks = []) => ({
    id: `sample-${no}`, no, title, notes, status, priority, due, tags,
    subtasks: subtasks.map(([text, done]) => ({ text, done })),
    createdAt: now.toISOString(), completedAt: status === 'done' ? now.toISOString() : null,
  });
  return [
    t(1, 'Cyber Board の使い方を確認', 'トレイのアイコンか Ctrl+Alt+B で編集画面が開きます。このタスクを完了にしてみましょう。', 'active', 'high', day(0), ['guide'],
      [['編集画面を開く', true], ['タスクを追加する', false], ['ドラッグで列を移動する', false]]),
    t(2, '月次レポートの作成', '今月の進捗をまとめて共有する。', 'active', 'critical', day(2), ['work', 'report'],
      [['データ収集', true], ['グラフ作成', true], ['所感を書く', false], ['レビュー依頼', false]]),
    t(3, 'デスクトップのファイル整理', '散らかったファイルをフォルダに分類する。', 'queue', 'low', '', ['home']),
    t(4, '新機能の設計', '大きなタスクはサブタスクに分けると進めやすい。', 'queue', 'normal', day(7), ['dev'],
      [['要件の洗い出し', false], ['画面設計', false]]),
    t(5, '請求書の支払い', '', 'queue', 'high', day(4), ['finance']),
    t(6, '朝のストレッチ', '', 'done', 'low', '', ['health']),
  ];
}

function loadTasks() {
  try {
    const list = JSON.parse(fs.readFileSync(TASKS_PATH, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.error('tasks.json の読み込みに失敗:', e.message);
      return [];
    }
    const list = sampleTasks();
    saveTasks(list);
    return list;
  }
}

function saveTasks(list) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const text = JSON.stringify(list, null, 2);
  const tmp = TASKS_PATH + '.tmp';
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, TASKS_PATH);
  lastWritten = text;
}

function broadcastBoard(channel, data) {
  for (const { win } of boardWallpapers()) win.webContents.send(channel, data);
  if (editor && !editor.isDestroyed()) editor.webContents.send(channel, data);
}

ipcMain.handle('state:get', (e) => {
  const wp = boardWallpapers().find((w) => w.win.webContents.id === e.sender.id);
  return { tasks, config: config.board, insets: wp ? insetsOf(wp.display) : { top: 0, left: 0, right: 0, bottom: 0 } };
});

ipcMain.on('task:resize', (e, h) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || win.isDestroyed()) return;
  const b = win.getBounds();
  const wa = screen.getDisplayMatching(b).workArea;
  const height = Math.min(Math.max(200, Math.round(h)), wa.height);
  const y = Math.max(wa.y, Math.min(b.y, wa.y + wa.height - height));
  win.setBounds({ x: b.x, y, width: b.width, height });
});

ipcMain.handle('tasks:save', (_e, list) => {
  if (!Array.isArray(list)) return false;
  tasks = list;
  saveTasks(tasks);
  broadcastBoard('tasks', tasks);
  return true;
});

function openEditor() {
  if (editor && !editor.isDestroyed()) {
    if (editor.isMinimized()) editor.restore();
    editor.show();
    editor.focus();
    bringToFront(editor);
    return;
  }
  const area = screen.getPrimaryDisplay().workAreaSize;
  editor = new BrowserWindow({
    width: Math.min(1560, area.width - 80),
    height: Math.min(960, area.height - 60),
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#03060c',
    title: 'Cyber Board — タスク編集',
    icon: appIcon(),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload-board.js'), contextIsolation: true },
  });
  editor.setMenu(null);
  editor.loadFile(path.join(ROOT, 'renderer', 'board', 'index.html'), { query: { mode: 'edit' } });
  editor.once('ready-to-show', () => { editor.show(); bringToFront(editor); });
  editor.on('closed', () => { editor = null; });
  if (CAPTURE_EDITOR) capture(editor, CAPTURE_EDITOR, 5000);
}

// 壁紙上のタスク 1 件だけを編集する小さなウィンドウ。クリック位置の近くに開く
function openTaskWindow(id, pt) {
  if (taskWin && !taskWin.isDestroyed()) taskWin.destroy();
  const wa = screen.getDisplayNearestPoint(pt).workArea;
  const width = 700, height = 640;
  const x = Math.round(Math.max(wa.x, Math.min(pt.x + 16, wa.x + wa.width - width)));
  const y = Math.round(Math.max(wa.y, Math.min(pt.y - 60, wa.y + wa.height - height)));
  const win = new BrowserWindow({
    x, y, width, height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    show: false,
    title: 'Cyber Board — タスク',
    icon: appIcon(),
    webPreferences: { preload: path.join(__dirname, 'preload-board.js'), contextIsolation: true },
  });
  win.setMenu(null);
  win.loadFile(path.join(ROOT, 'renderer', 'board', 'index.html'), { query: { mode: 'task', id } });
  win.once('ready-to-show', () => {
    win.show();
    win.focus();
    bringToFront(win);
    if (CAPTURE_TASK) capture(win, CAPTURE_TASK, 1500);
  });
  win.on('closed', () => { if (taskWin === win) taskWin = null; });
  taskWin = win;
}

function bringToFront(win) {
  if (!clickHook || win.isDestroyed()) return;
  const hwnd = win.getNativeWindowHandle().readBigInt64LE(0).toString();
  clickHook.stdin.write(`fg ${hwnd}\n`);
}

// 修飾キー + クリックされた座標の下にあるものを壁紙に問い合わせる
async function handleDesktopClick(px, py) {
  const pt = screen.screenToDipPoint({ x: px, y: py });
  const wp = boardWallpapers().find(({ display: { bounds: b } }) => pt.x >= b.x && pt.x < b.x + b.width && pt.y >= b.y && pt.y < b.y + b.height);
  if (!wp) return;
  const b = wp.display.bounds;
  let hit = null;
  try {
    hit = await wp.win.webContents.executeJavaScript(`window.__hitTest?.(${pt.x - b.x}, ${pt.y - b.y}) ?? null`);
  } catch (e) {
    console.error('[click] hit test 失敗:', e.message);
  }
  if (!hit) return;
  if (hit.type === 'task') openTaskWindow(hit.id, pt);
  else openEditor();
}

// clickModifier で使えるキー名 → 仮想キーコード。修飾キーのほか英数字・F キーなども組み合わせられる
const VK = {
  ctrl: 0x11, control: 0x11, alt: 0x12, shift: 0x10, win: 0x5b, super: 0x5b,
  space: 0x20, tab: 0x09, capslock: 0x14, esc: 0x1b, escape: 0x1b,
  lctrl: 0xa2, rctrl: 0xa3, lalt: 0xa4, ralt: 0xa5, lshift: 0xa0, rshift: 0xa1,
};
for (let c = 0; c < 26; c++) VK[String.fromCharCode(97 + c)] = 0x41 + c; // a-z
for (let d = 0; d < 10; d++) VK[String(d)] = 0x30 + d; // 0-9
for (let f = 1; f <= 24; f++) VK[`f${f}`] = 0x6f + f; // F1-F24

// クリックを拾うのは Cyber Board を表示しているモニターだけ（Performance Monitor 側の修飾キー + クリックは素通し）
function sendClickRects() {
  if (!clickHook) return;
  const rects = boardWallpapers().map(({ display }) => {
    const r = screen.dipToScreenRect(null, display.bounds);
    return [r.x, r.y, r.width, r.height].join(',');
  });
  clickHook.stdin.write(`rects ${rects.join(';')}\n`);
}

function clickKeys() {
  const spec = String(config.board.clickModifier || '').trim();
  if (!spec || WINDOW_MODE) return null;
  const keys = spec.split('+').map((k) => VK[k.trim().toLowerCase()]);
  if (!keys.length || keys.some((k) => !k)) {
    console.warn('clickModifier が不正:', spec);
    return null;
  }
  return keys;
}

// Cyber Board を表示しているモニターがあるときだけフックを動かす
function syncClickHook() {
  const keys = clickKeys();
  if (!keys || !boardWallpapers().length) { stopClickHook(); return; }
  if (!clickHook) startClickHook(keys);
  sendClickRects();
}

function startClickHook(keys) {
  const script = path.join(__dirname, 'native', 'clickhook.ps1');
  const p = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Keys', keys.map((k) => k.toString(16)).join(',')],
    { windowsHide: true },
  );
  clickHook = p;
  readline.createInterface({ input: p.stdout }).on('line', (line) => {
    const m = /^click (-?\d+) (-?\d+)$/.exec(line.trim());
    if (m) handleDesktopClick(Number(m[1]), Number(m[2]));
    else console.log('[clickhook]', line.trim());
  });
  p.stderr.on('data', (d) => console.error('[clickhook]', String(d).trim()));
  p.on('exit', () => {
    if (clickHook !== p) return;
    clickHook = null;
    if (!quitting) setTimeout(() => { if (!clickHook && !quitting) syncClickHook(); }, 5000);
  });
}

function stopClickHook() {
  const p = clickHook;
  clickHook = null;
  if (!p) return;
  p.stdin.end();
  p.kill();
}

function registerShortcut() {
  globalShortcut.unregisterAll();
  const sc = config.board.editorShortcut;
  if (!sc) return;
  try {
    if (!globalShortcut.register(sc, openEditor)) console.warn('ショートカット登録失敗:', sc);
  } catch (e) {
    console.warn('ショートカットが不正:', sc, e.message);
  }
}

function setClickModifier(value) {
  updateConfig((raw) => { raw.board = { ...(raw.board || {}), clickModifier: value }; });
  stopClickHook();
  syncClickHook();
  broadcastBoard('config', config.board);
  refreshTray();
}

/* ───────── 壁紙の上の猫 ───────── */

const catSpots = new Map(); // 壁紙の webContents.id → 座れる場所の数
let catHost = null; // { id, spot } 猫がいる壁紙と場所
let catTimers = [];
let demoTurn = 0;
const pickCatLine = catLines.createPicker();

const wallpaperById = (id) => wallpapers.find((w) => !w.win.isDestroyed() && w.win.webContents.id === id);

function catConfigMsg(display) {
  const c = config.cat;
  return { type: 'config', enabled: c.enabled !== false, breed: c.breed, scale: Number(c.scale) || 3, insets: insetsOf(display) };
}

function sendCatConfig() {
  for (const { win, display } of wallpapers) if (!win.isDestroyed()) win.webContents.send('cat', catConfigMsg(display));
}

// すべての壁紙の置き場所からランダムに 1 か所選ぶ（なるべく今と違う場所）
function moveCat() {
  const list = wallpapers.filter((w) => !w.win.isDestroyed())
    .map((w) => ({ id: w.win.webContents.id, n: catSpots.get(w.win.webContents.id) || 0 }))
    .filter((x) => x.n > 0 && (!CAT_ON || wallpaperById(x.id)?.role === CAT_ON));
  const total = list.reduce((a, x) => a + x.n, 0);
  let next = null;
  if (config.cat.enabled !== false && total > 0) {
    for (let tries = 0; tries < 6; tries++) {
      let r = Math.floor(Math.random() * total);
      const x = list.find((y) => (r -= y.n) < 0);
      next = { id: x.id, spot: r + x.n, sleep: false };
      if (total === 1 || !catHost || next.id !== catHost.id || next.spot !== catHost.spot) break;
    }
  }
  if (next) {
    const h = new Date().getHours();
    const chance = h < 5 ? 0.6 : Math.min(1, Math.max(0, Number(config.cat.sleepChance ?? 0.2)));
    next.sleep = Math.random() < chance;
  }
  catHost = next;
  if (CAT_DEMO) console.log('[cat] place', next ? `${wallpaperById(next.id)?.role}#${next.spot}${next.sleep ? ' (sleep)' : ''}` : 'none');
  for (const { win } of wallpapers) {
    if (win.isDestroyed()) continue;
    const id = win.webContents.id;
    const here = next && next.id === id;
    win.webContents.send('cat', { type: 'place', spot: here ? next.spot : -1, sleep: here && next.sleep });
  }
}

ipcMain.on('cat:ready', (e) => {
  const wp = wallpaperById(e.sender.id);
  if (wp) e.sender.send('cat', catConfigMsg(wp.display));
});

ipcMain.on('cat:spots', (e, count) => {
  const n = Math.max(0, Number(count) || 0);
  catSpots.set(e.sender.id, n);
  if (CAT_DEMO) console.log('[cat] spots', wallpaperById(e.sender.id)?.role, n);
  // まだどこにもいない／いまの場所が無くなった／表示をやめた
  if (!catHost || (catHost.id === e.sender.id && catHost.spot >= n) || config.cat.enabled === false) moveCat();
});

// 猫のセリフに入れる、いまの状況
function catContext() {
  const now = new Date();
  const pad = (v) => String(v).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const open = tasks.filter((t) => t.status !== 'done');
  const m = perf?.lastMetrics;
  return {
    hour: now.getHours(),
    dow: now.getDay(),
    time: `${now.getHours()}:${pad(now.getMinutes())}`,
    cpu: m?.cpu?.load,
    mem: m?.mem?.total ? (m.mem.used / m.mem.total) * 100 : null,
    gpu: m?.gpu?.util,
    open: open.length,
    active: open.filter((t) => t.status === 'active').length,
    overdue: open.filter((t) => t.due && t.due < today).length,
    today: open.filter((t) => t.due === today).length,
  };
}

// 眠らせる／起こす（次の引っ越しまで）
function setCatSleep(flag) {
  const wp = catHost && wallpaperById(catHost.id);
  if (!wp) return;
  catHost.sleep = flag;
  wp.win.webContents.send('cat', { type: 'sleep', sleep: flag });
  refreshTray();
}

// しゃべる・伸びる・びっくりする。眠っている間は何もしない（トレイから指示したときは起こす）
function catAct(kind, fromTray = false) {
  const wp = catHost && wallpaperById(catHost.id);
  if (!wp || config.cat.enabled === false) return;
  if (catHost.sleep) {
    if (!fromTray) return;
    setCatSleep(false);
  }
  const r = Math.random();
  const action = kind || (r < 0.5 ? 'say' : r < 0.8 ? 'stretch' : 'surprise');
  if (action === 'say') {
    const text = CAT_LINE || pickCatLine(wp.role, catContext());
    if (text) wp.win.webContents.send('cat', { type: 'say', text });
  } else {
    wp.win.webContents.send('cat', { type: action });
  }
}

function startCatTimers() {
  catTimers.forEach(clearInterval);
  const min = (v, d) => Math.max(0.1, Number(v) || d) * 60_000;
  catTimers = [
    setInterval(() => catAct(CAT_DEMO ? ['stretch', 'say', 'surprise'][demoTurn++ % 3] : undefined), CAT_DEMO ? 6000 : min(config.cat.actionMinutes, 3)),
    setInterval(moveCat, CAT_DEMO ? 30_000 : min(config.cat.moveMinutes, 60)),
  ];
}

function setCat(key, value) {
  updateConfig((raw) => { raw.cat = { ...(raw.cat || {}), [key]: value }; });
  sendCatConfig();
  refreshTray();
}

function catMenu() {
  const c = config.cat;
  const on = c.enabled !== false;
  const breed = CAT_BREEDS.some((b) => b.key === c.breed) ? c.breed : 'white';
  const asleep = !!catHost?.sleep;
  return [
    { label: '表示する', type: 'checkbox', checked: on, click: (item) => setCat('enabled', item.checked) },
    { type: 'separator' },
    {
      label: `種類（現在: ${CAT_BREEDS.find((b) => b.key === breed).name}）`,
      submenu: CAT_BREEDS.map((b) => ({
        label: b.key === 'white' ? `${b.name}（既定）` : b.name, type: 'radio', checked: breed === b.key, click: () => setCat('breed', b.key),
      })),
    },
    {
      label: `大きさ（現在: ${Number(c.scale) || 3} 倍）`,
      submenu: [2, 3, 4, 5].map((v) => ({ label: `${v} 倍`, type: 'radio', checked: (Number(c.scale) || 3) === v, click: () => setCat('scale', v) })),
    },
    { type: 'separator' },
    { label: '今すぐ場所を変える', enabled: on, click: moveCat },
    { label: '今すぐしゃべる', enabled: on, click: () => catAct('say', true) },
    { label: '今すぐ伸びる', enabled: on, click: () => catAct('stretch', true) },
    { label: '今すぐびっくりさせる', enabled: on, click: () => catAct('surprise', true) },
    asleep
      ? { label: '起こす', enabled: on, click: () => setCatSleep(false) }
      : { label: '寝かせる（次の引っ越しまで）', enabled: on && !!catHost, click: () => setCatSleep(true) },
  ];
}

/* ───────── tray ───────── */

// assets/icon.ico（tools/build-icon.js で生成）。Windows が DPI に合ったサイズを選ぶ
const ICON_PATH = path.join(ROOT, 'assets', 'icon.ico');
const appIcon = () => nativeImage.createFromPath(ICON_PATH);

const CLICK_PRESETS = ['Ctrl+Alt', 'Ctrl+Shift', 'Alt+Shift', 'Ctrl+Alt+Shift', 'Ctrl', 'Alt', 'Shift'];

// 表記ゆれ（"alt+ctrl" など）を同じ組み合わせとして比べる
const normalizeKeys = (spec) => String(spec || '').split('+')
  .map((k) => k.trim().toLowerCase().replace(/^control$/, 'ctrl')).filter(Boolean).sort().join('+');

function clickKeyMenu() {
  const mod = config.board.clickModifier;
  const cur = normalizeKeys(mod);
  const items = CLICK_PRESETS.map((p) => ({
    label: `${p} + クリック`, type: 'radio', checked: cur === normalizeKeys(p), click: () => setClickModifier(p),
  }));
  if (cur && !CLICK_PRESETS.some((p) => normalizeKeys(p) === cur)) {
    items.push({ label: `${mod} + クリック（設定ファイルで指定）`, type: 'radio', checked: true, click: () => {} });
  }
  return [
    ...items,
    { label: '使わない', type: 'radio', checked: !cur, click: () => setClickModifier('') },
    { type: 'separator' },
    { label: 'ほかのキーを設定ファイルで指定…', click: () => shell.openPath(CONFIG_PATH) },
  ];
}

function displayLabel(d, i) {
  const { width, height } = screen.dipToScreenRect(null, d.bounds);
  const main = d.id === screen.getPrimaryDisplay().id;
  return `モニター ${i + 1}（${width}×${height}${main ? '・メイン' : ''}）`;
}

function screenMenu() {
  const displays = orderedDisplays();
  const items = displays.map((d, i) => {
    const role = roleOf(d);
    return {
      label: `${displayLabel(d, i)}: ${roleName(role)}`,
      submenu: ROLES.map((r) => ({
        label: r.key === defaultRole(d) ? `${r.name}（既定）` : r.name,
        type: 'radio',
        checked: role === r.key,
        click: () => setRole(d, r.key),
      })),
    };
  });
  if (displays.length === 2) {
    items.push({ type: 'separator' }, { label: '2 つのモニターの表示を入れ替える', click: () => swapRoles(displays[0], displays[1]) });
  }
  items.push({ label: '既定の表示に戻す', enabled: Object.keys(config.screens).length > 0, click: resetRoles });
  return items;
}

function devToolsMenu() {
  const items = orderedDisplays().flatMap((d, i) => {
    const wp = wallpapers.find((w) => w.display.id === d.id && !w.win.isDestroyed());
    return wp ? [{ label: `${displayLabel(d, i)}: ${roleName(wp.role)}`, click: () => wp.win.webContents.openDevTools({ mode: 'detach' }) }] : [];
  });
  return items.length ? items : [{ label: '表示中の壁紙なし', enabled: false }];
}

function trayMenu() {
  const login = app.getLoginItemSettings({ path: process.execPath, args: [ROOT] }).openAtLogin;
  const sc = config.board.editorShortcut;
  return Menu.buildFromTemplate([
    { label: 'Cyber Monitor', enabled: false },
    { type: 'separator' },
    ...screenMenu(),
    { type: 'separator' },
    { label: `タスクを編集する${sc ? `（${sc.replace('Control', 'Ctrl')}）` : ''}`, click: openEditor },
    {
      label: 'Cyber Board',
      submenu: [
        { label: `クリックで編集するキー（現在: ${config.board.clickModifier || 'なし'}）`, submenu: clickKeyMenu() },
        { label: 'データフォルダを開く', click: () => shell.openPath(DATA_DIR) },
      ],
    },
    { label: '猫', submenu: catMenu() },
    {
      label: 'Performance Monitor',
      submenu: [
        { label: '再読み込み（設定を反映）', click: restartPerf },
      ],
    },
    { type: 'separator' },
    { label: '壁紙レイヤーに再配置', click: rebuildWallpapers },
    { label: '設定ファイルを開く', click: () => shell.openPath(CONFIG_PATH) },
    { label: '開発者ツール', submenu: devToolsMenu() },
    {
      label: 'ログイン時に起動',
      type: 'checkbox',
      checked: login,
      click: (item) => { app.setLoginItemSettings({ openAtLogin: item.checked, path: process.execPath, args: [ROOT] }); refreshTray(); },
    },
    { type: 'separator' },
    { label: '終了', click: () => app.quit() },
  ]);
}

function refreshTray() {
  if (tray) tray.setContextMenu(trayMenu());
}

// デバッグ用（--print-tray）: メニューの項目を出力
function printMenu(items, depth = 0) {
  for (const it of items) {
    if (it.type === 'separator') { console.log(`${'  '.repeat(depth)}----`); continue; }
    const mark = it.type === 'radio' || it.type === 'checkbox' ? (it.checked ? '[x] ' : '[ ] ') : '';
    console.log(`${'  '.repeat(depth)}${mark}${it.label}${it.enabled === false ? ' (無効)' : ''}`);
    if (it.submenu) printMenu(it.submenu.items, depth + 1);
  }
}

function buildTray() {
  tray = new Tray(appIcon());
  tray.setToolTip('Cyber Monitor');
  refreshTray();
  if (process.argv.includes('--print-tray')) setTimeout(() => printMenu(trayMenu().items), 6000);
  tray.on('right-click', refreshTray);
  tray.on('click', openEditor);
}

/* ───────── boot ───────── */

app.on('second-instance', openEditor); // 二重起動されたら編集画面を開く

app.whenReady().then(() => {
  startCatTimers();
  console.log('[displays]', orderedDisplays().map((d, i) => `${i + 1}:${d.id}@${d.bounds.x},${d.bounds.y}=${roleOf(d)}`).join(' '));
  createWallpapers();
  buildTray();
  registerShortcut();
  if (OPEN_EDITOR || CAPTURE_EDITOR) openEditor();
  if (SIMULATE_CLICK) {
    const [sx, sy] = SIMULATE_CLICK.split(',').map(Number);
    setTimeout(() => handleDesktopClick(sx, sy), 5000);
  }

  let t = null;
  const onDisplayChange = () => { clearTimeout(t); t = setTimeout(() => { rebuildWallpapers(); refreshTray(); }, 1500); };
  screen.on('display-added', onDisplayChange);
  screen.on('display-removed', onDisplayChange);
  screen.on('display-metrics-changed', onDisplayChange);

  // config.json を手で編集したら全体に反映
  if (!fs.existsSync(CONFIG_PATH)) updateConfig(() => {});
  let ct = null;
  fs.watch(CONFIG_PATH, () => {
    clearTimeout(ct);
    ct = setTimeout(() => {
      try { if (fs.readFileSync(CONFIG_PATH, 'utf8') === lastConfigWritten) return; } catch { /* 下で既定値に戻す */ }
      config = loadConfig();
      registerShortcut();
      stopClickHook();
      stopPerf();
      rebuildWallpapers();
      broadcastBoard('config', config.board);
      startCatTimers();
      refreshTray();
    }, 800);
  });

  // tasks.json を手で編集した場合も反映
  let tt = null;
  fs.watch(DATA_DIR, (_ev, name) => {
    if (name !== 'tasks.json') return;
    clearTimeout(tt);
    tt = setTimeout(() => {
      let text;
      try { text = fs.readFileSync(TASKS_PATH, 'utf8'); } catch { return; }
      if (text === lastWritten) return;
      try {
        tasks = JSON.parse(text);
        lastWritten = text;
        broadcastBoard('tasks', tasks);
      } catch (e) {
        console.error('tasks.json が不正:', e.message);
      }
    }, 500);
  });
});

app.on('window-all-closed', (e) => e.preventDefault?.());
app.on('will-quit', () => {
  quitting = true;
  catTimers.forEach(clearInterval);
  stopClickHook();
  stopPerf();
  globalShortcut.unregisterAll();
});
