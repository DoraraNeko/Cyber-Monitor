// 壁紙の上に座る猫（素材は Catbar: https://github.com/DoraraNeko/Catbar から）。
// 置ける場所（パネルの上辺・タスクバーの上）を探して main に数を知らせ、
// main が選んだ場所に座る。セリフ・伸びも main からの指示で行う。
// <script src="../cat/cat.js"
//   data-surfaces="<上辺に座れる要素>"  data-floors="<内側の底に立てる要素>"  data-obstacles="<重ならないようにする要素>">
(() => {
  'use strict';
  const host = window.catHost;
  const mode = new URLSearchParams(location.search).get('mode');
  if (!host || mode === 'edit' || mode === 'task') return; // 壁紙だけに出す

  const SURFACES = document.currentScript?.dataset.surfaces || '';
  const FLOORS = document.currentScript?.dataset.floors || '';
  const OBSTACLES = document.currentScript?.dataset.obstacles || '';
  const BASE = new URL('./assets/', document.currentScript?.src || location.href).href;
  const BREEDS = ['white', 'black', 'hachiware'];

  // 素材の寸法（Catbar の geometry.js と同じ）
  const S = { h: 40, lowerW: 20, upperW: 40, tileW: 4, join: 8, zzzW: 16, zzzH: 14 };
  const STRETCH_TILES = 12; // 伸びたときに増える胴体タイルの数
  const SAY_MS = 7000;
  const STEP = 24; // 置き場所の候補を探す間隔（px）

  let cfg = { enabled: false, breed: 'white', scale: 3, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
  let spots = [];
  let spot = -1; // 座っている場所（spots の番号）。-1 = このモニターにはいない
  let stretch = 0; // 0〜STRETCH_TILES
  let face = 'normal';
  let busy = false; // 伸び・驚きの最中
  let sleeping = false; // 引っ越すまで眠ったまま（Zzz）
  let bubbleTimer = 0;
  let blinkTimer = 0;

  /* ───────── DOM ───────── */

  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = new URL('./cat.css', document.currentScript?.src || location.href).href;
  document.head.appendChild(style);

  const mk = (cls, parent) => {
    const d = document.createElement('div');
    d.className = cls;
    parent?.appendChild(d);
    return d;
  };
  const root = mk('cm-cat');
  root.hidden = true;
  const el = {
    body: mk('cm-body', root),
    lower: mk('cm-lower', root),
    upper: mk('cm-upper', root),
    bubble: mk('cm-bubble', root),
  };
  el.zzz = mk('cm-zzz', el.upper);
  el.bubble.hidden = true;
  document.body.appendChild(root);

  function applyImages() {
    const b = BREEDS.includes(cfg.breed) ? cfg.breed : 'white';
    root.dataset.breed = b;
    const set = (key, file) => {
      const url = BASE + file;
      root.style.setProperty(`--cm-img-${key}`, `url("${url}")`);
      new Image().src = url; // 表情の切り替えでちらつかないよう先読み
    };
    set('lower', `${b}/cat-lower.png`);
    set('body', `${b}/cat-body-tile.png`);
    for (const f of ['normal', 'wide', 'closed']) set(f, `${b}/cat-upper-${f}.png`);
    set('zzz', 'cat-zzz.png');
  }

  const n = () => Math.max(1, Math.round(cfg.scale || 3));
  const catW = (tiles) => (S.lowerW - S.join + S.upperW + tiles * S.tileW) * n();

  function layout() {
    const k = n();
    const H = S.h * k;
    const upperX = (S.lowerW - S.join + stretch * S.tileW) * k;
    const bodyX = S.lowerW * k - k;
    const place = (node, x, w) => {
      node.style.left = `${x}px`;
      node.style.width = `${w}px`;
      node.style.height = `${H}px`;
    };
    root.style.height = `${H}px`;
    root.style.width = `${catW(STRETCH_TILES)}px`;
    place(el.lower, 0, S.lowerW * k);
    place(el.body, bodyX, upperX + S.join * k + k - bodyX);
    el.body.style.backgroundSize = `${S.tileW * k}px ${H}px`;
    place(el.upper, upperX, S.upperW * k);
    const z = el.zzz.style;
    z.left = `${-2 * k}px`;
    z.top = `${-6 * k}px`;
    z.width = `${S.zzzW * k}px`;
    z.height = `${S.zzzH * k}px`;
    placeBubble();
  }

  function setFace(f) {
    face = f;
    root.dataset.face = f;
  }

  /* ───────── 置き場所 ───────── */

  const rects = (sel) => (sel ? [...document.querySelectorAll(sel)] : [])
    .map((e) => e.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom }));

  // 伸びきった猫の大きさの空きがあるところ:
  //   要素の上辺（上に座る）・要素の内側の底（中に立つ）・タスクバーの上辺
  function computeSpots() {
    const k = n();
    const W = catW(STRETCH_TILES) + 8;
    const H = S.h * k;
    const ins = cfg.insets;
    const vw = window.innerWidth, vh = window.innerHeight;
    const solids = rects(SURFACES);
    const floors = rects(FLOORS);
    const obstacles = [...solids, ...floors, ...rects(OBSTACLES)];
    const surfaces = [
      ...solids.map((s) => ({ y: Math.round(s.t), x0: s.l + 16, x1: s.r - 16, self: s })),
      ...floors.map((f) => ({ y: Math.round(f.b - 10), x0: f.l + 20, x1: f.r - 20, self: f, inside: f })),
      { y: vh - ins.bottom, x0: ins.left + 32, x1: vw - ins.right - 32, self: null }, // タスクバーの上
    ];
    const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    const out = [];
    for (const s of surfaces) {
      const top = s.y - H - 4;
      if (top < ins.top + 8) continue;
      if (s.inside && top < s.inside.t + 8) continue;
      const xs = [];
      for (let x = Math.round(s.x0); x + W <= s.x1; x += STEP) {
        const box = { l: x - 4, t: top, r: x + W, b: s.y - 2 };
        if (!obstacles.some((o) => o !== s.self && hit(box, o))) xs.push(x);
      }
      if (!xs.length) continue;
      // 1 つの面につき左端・中央・右端の 3 か所まで
      const picks = [...new Set([xs[0], xs[Math.floor(xs.length / 2)], xs[xs.length - 1]])];
      for (const x of picks) out.push({ x, y: s.y });
    }
    return out;
  }

  let lastReported = -1;
  function refreshSpots() {
    if (!cfg.enabled) { spots = []; report(); return; }
    spots = computeSpots();
    report();
    if (spot >= 0) place();
  }
  function report() {
    if (spots.length === lastReported) return;
    lastReported = spots.length;
    host.send('cat:spots', spots.length);
  }

  function place() {
    const p = spots[spot];
    if (!cfg.enabled || !p) { root.hidden = true; hideBubble(); return; }
    root.hidden = false;
    root.style.left = `${p.x}px`;
    root.style.top = `${p.y - S.h * n()}px`;
    layout();
  }

  /* ───────── セリフ・伸び ───────── */

  function say(text) {
    if (root.hidden || !text || sleeping) return;
    const b = el.bubble;
    // 「＊」で始まるナレーション風のセリフは、＊ ごとに改行して専用の枠で出す
    const narr = text.trim().startsWith('＊');
    b.classList.toggle('cm-narr', narr);
    b.textContent = narr ? text.trim().replace(/\s*＊\s*/g, '\n＊ ').trim() : text;
    b.hidden = false;
    b.style.animation = 'none';
    void b.offsetWidth; // ポップのアニメーションをやり直す
    b.style.animation = '';
    placeBubble();
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(hideBubble, SAY_MS);
  }

  function hideBubble() {
    clearTimeout(bubbleTimer);
    el.bubble.hidden = true;
  }

  // 吹き出しは頭の右上。画面の右端からはみ出すときは左上に回す
  function placeBubble() {
    const b = el.bubble;
    if (b.hidden) return;
    const k = n();
    const upperX = (S.lowerW - S.join + stretch * S.tileW) * k;
    const rootLeft = parseFloat(root.style.left) || 0;
    const w = b.offsetWidth;
    const flip = rootLeft + upperX + (S.upperW - 10) * k + w > window.innerWidth - cfg.insets.right - 8;
    b.classList.toggle('cm-flip', flip);
    b.style.left = `${flip ? upperX + 14 * k - w : upperX + (S.upperW - 10) * k}px`;
    b.style.bottom = `${S.h * k - 6 * k}px`;
  }

  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

  function animateStretch(from, to, ms) {
    return new Promise((done) => {
      const t0 = performance.now();
      const step = (t) => {
        const p = Math.min(1, (t - t0) / ms);
        const next = Math.round(from + (to - from) * ease(p));
        if (next !== stretch) { stretch = next; layout(); }
        if (p < 1) requestAnimationFrame(step); else done();
      };
      requestAnimationFrame(step);
    });
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // ぐーっと伸びて（目を閉じる）、しばらくして戻る
  async function doStretch() {
    if (busy || sleeping || root.hidden) return;
    busy = true;
    setFace('closed');
    await animateStretch(0, STRETCH_TILES, 1600);
    await wait(1800);
    await animateStretch(STRETCH_TILES, 0, 1100);
    setFace('normal');
    busy = false;
  }

  // びっくり（丸い目で 2 回はねる）
  async function doSurprise() {
    if (busy || sleeping || root.hidden) return;
    busy = true;
    hideBubble();
    setFace('wide');
    root.classList.remove('cm-hop');
    void root.offsetWidth;
    root.classList.add('cm-hop');
    await wait(1800);
    root.classList.remove('cm-hop');
    setFace('normal');
    busy = false;
  }

  function setSleep(flag) {
    sleeping = !!flag;
    root.dataset.sleep = sleeping ? '1' : '';
    if (sleeping) hideBubble();
    if (!busy) setFace(sleeping ? 'closed' : 'normal');
  }

  // ときどきまばたき
  function scheduleBlink() {
    clearTimeout(blinkTimer);
    blinkTimer = setTimeout(() => {
      if (!busy && face === 'normal' && !root.hidden) {
        setFace('closed');
        setTimeout(() => { if (!busy) setFace('normal'); }, 160);
      }
      scheduleBlink();
    }, 4000 + Math.random() * 6000);
  }

  /* ───────── main からの指示 ───────── */

  host.on((msg) => {
    if (msg.type === 'config') {
      const scaleChanged = msg.scale !== cfg.scale;
      cfg = { ...cfg, ...msg };
      applyImages();
      if (scaleChanged) lastReported = -1;
      refreshSpots();
      place();
    } else if (msg.type === 'place') {
      spot = msg.spot;
      hideBubble();
      setSleep(msg.sleep);
      place();
    } else if (msg.type === 'sleep') {
      setSleep(msg.sleep);
    } else if (msg.type === 'say') {
      say(msg.text);
    } else if (msg.type === 'stretch') {
      doStretch();
    } else if (msg.type === 'surprise') {
      doSurprise();
    }
  });

  setFace('normal');
  applyImages();
  scheduleBlink();
  // パネルの配置が決まってから場所を探す（フォント読み込みや初期化で動くので少し待つ）
  let rt = 0;
  const later = (ms) => { clearTimeout(rt); rt = setTimeout(refreshSpots, ms); };
  window.addEventListener('resize', () => later(500));
  document.fonts?.ready.then(() => later(800));
  later(2500);
  setInterval(refreshSpots, 60_000); // パネルの大きさが変わったときのため
  host.send('cat:ready');
})();
