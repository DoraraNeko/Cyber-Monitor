// アイコン（assets/icon.svg, icon-*.png, icon.ico）を生成する。
// 使い方: npm run icon   （= electron tools/build-icon.js）
// SVG をサイズごとに Chromium の canvas で描き、PNG を詰めた ICO を作る。
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '..', 'assets');
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const C = 128; // 中心

const f = (n) => Math.round(n * 100) / 100;
const pt = (r, deg) => [f(C + r * Math.cos((deg * Math.PI) / 180)), f(C + r * Math.sin((deg * Math.PI) / 180))];
const hex = (r) => [-90, -30, 30, 90, 150, 210].map((a) => pt(r, a).join(',')).join(' ');
const arc = (r, a0, a1) => {
  const [x0, y0] = pt(r, a0), [x1, y1] = pt(r, a1);
  return `M${x0} ${y0} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
};
// シアン → マゼンタ
const mix = (t) => {
  const a = [0x00, 0xf0, 0xff], b = [0xff, 0x2b, 0xd6];
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
};

const DEFS = `
  <defs>
    <linearGradient id="edge" x1="0.15" y1="0" x2="0.85" y2="1">
      <stop offset="0" stop-color="#00f0ff"/><stop offset="0.55" stop-color="#5b8cff"/><stop offset="1" stop-color="#ff2bd6"/>
    </linearGradient>
    <radialGradient id="body" cx="0.5" cy="0.42" r="0.62">
      <stop offset="0" stop-color="#0d2a40"/><stop offset="0.7" stop-color="#060f1c"/><stop offset="1" stop-color="#03060c"/>
    </radialGradient>
    <radialGradient id="core" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ffffff"/><stop offset="0.3" stop-color="#9ffbff"/><stop offset="0.65" stop-color="#00f0ff" stop-opacity="0.55"/><stop offset="1" stop-color="#00f0ff" stop-opacity="0"/>
    </radialGradient>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="3.2" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>`;

// 大きいサイズ用: 六角形の筐体 + 分割ゲージ + 中央のコア + 下部のバー
function fullSvg() {
  const segs = [];
  const N = 15, A0 = 135, SPAN = 270, GAP = 4.2, LIT = 10;
  for (let i = 0; i < N; i++) {
    const a0 = A0 + (SPAN / N) * i + GAP / 2;
    const a1 = A0 + (SPAN / N) * (i + 1) - GAP / 2;
    const lit = i < LIT;
    segs.push(`<path d="${arc(70, a0, a1)}" stroke="${lit ? mix(i / (LIT - 1)) : '#16324a'}" stroke-width="13" fill="none"${lit ? ' filter="url(#glow)"' : ''}/>`);
  }
  const ticks = [];
  for (let i = 0; i <= 36; i++) {
    const a = A0 + (SPAN / 36) * i;
    const long = i % 6 === 0;
    const [x0, y0] = pt(long ? 50 : 53, a), [x1, y1] = pt(57, a);
    ticks.push(`<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="#00f0ff" stroke-opacity="${long ? 0.9 : 0.4}" stroke-width="${long ? 2.4 : 1.4}"/>`);
  }
  // 頂点の HUD マーカー
  const marks = [-90, -30, 30, 90, 150, 210].map((a) => {
    const [x, y] = pt(104, a);
    return `<circle cx="${x}" cy="${y}" r="2.6" fill="#00f0ff" opacity="0.75"/>`;
  }).join('');
  const bars = [[-13, 14, '#00f0ff'], [-3, 22, '#7aa7ff'], [7, 10, '#ff2bd6']]
    .map(([x, h, c]) => `<rect x="${C + x}" y="${200 - h}" width="6" height="${h}" rx="1" fill="${c}" filter="url(#glow)"/>`).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">${DEFS}
  <polygon points="${hex(118)}" fill="url(#body)" stroke="url(#edge)" stroke-width="8" stroke-linejoin="round" filter="url(#glow)"/>
  <polygon points="${hex(104)}" fill="none" stroke="#00f0ff" stroke-opacity="0.22" stroke-width="1.6" stroke-dasharray="10 6"/>
  ${marks}
  ${ticks.join('')}
  ${segs.join('')}
  <circle cx="${C}" cy="${C}" r="40" fill="none" stroke="#00f0ff" stroke-opacity="0.35" stroke-width="1.6"/>
  <circle cx="${C}" cy="${C}" r="40" fill="none" stroke="#ff2bd6" stroke-width="3" stroke-dasharray="22 229" stroke-dashoffset="-40" filter="url(#glow)"/>
  <circle cx="${C}" cy="${C}" r="34" fill="url(#core)" opacity="0.5"/>
  <polygon points="${hex(19)}" fill="#03060c" stroke="#9ffbff" stroke-width="3" filter="url(#glow)"/>
  <polygon points="${hex(9)}" fill="url(#core)" filter="url(#glow)"/>
  <circle cx="${C}" cy="${C}" r="4.5" fill="#ffffff"/>
  ${bars}
</svg>`;
}

// 小さいサイズ用（16〜32px）: 細部を省いて太く
function smallSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">${DEFS}
  <polygon points="${hex(116)}" fill="url(#body)" stroke="url(#edge)" stroke-width="20" stroke-linejoin="round"/>
  <path d="${arc(64, 135, 315)}" stroke="#00f0ff" stroke-width="26" fill="none"/>
  <path d="${arc(64, 315, 405)}" stroke="#ff2bd6" stroke-width="26" fill="none"/>
  <polygon points="${hex(26)}" fill="#ffffff"/>
</svg>`;
}

function icoFrom(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, e);
    head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt16LE(1, e + 4); // planes
    head.writeUInt16LE(32, e + 6); // bpp
    head.writeUInt32LE(data.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const full = fullSvg();
  const small = smallSvg();
  fs.writeFileSync(path.join(OUT, 'icon.svg'), full);

  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<body></body>');
  const render = (svg, size) => win.webContents.executeJavaScript(`new Promise((ok, ng) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = ${size};
      c.getContext('2d').drawImage(img, 0, 0, ${size}, ${size});
      ok(c.toDataURL('image/png').split(',')[1]);
    };
    img.onerror = () => ng(new Error('svg load failed'));
    img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svg).toString('base64'))};
  })`);

  const pngs = [];
  for (const size of SIZES) {
    const data = Buffer.from(await render(size <= 32 ? small : full, size), 'base64');
    fs.writeFileSync(path.join(OUT, `icon-${size}.png`), data);
    pngs.push({ size, data });
  }
  fs.writeFileSync(path.join(OUT, 'icon.ico'), icoFrom(pngs));
  console.log('icon written:', OUT);
  app.quit();
});
