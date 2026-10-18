// Canvas ウィジェット: リングゲージ / 時系列チャート / コアバー / 日別バー
(() => {
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const theme = () => ({
    accent: css('--accent'), accent2: css('--accent2'), warn: css('--warn'), crit: css('--crit'),
    text: css('--text'), dim: css('--dim'), font: css('--font'), mono: css('--mono'),
  });
  let T = null;
  const th = () => (T ||= theme());

  const ease = (cur, target, k = 0.12) => (cur == null || !Number.isFinite(cur) ? target : cur + (target - cur) * k);
  const levelColor = (pct, base) => (pct >= 90 ? th().crit : pct >= 75 ? th().warn : base || th().accent);

  function alpha(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  class Base {
    constructor(canvas) {
      this.c = canvas;
      this.ctx = canvas.getContext('2d');
      this.w = this.h = 0;
      new ResizeObserver(() => this.resize()).observe(canvas);
      this.resize();
    }
    resize() {
      const dpr = window.devicePixelRatio || 1;
      this.w = this.c.clientWidth;
      this.h = this.c.clientHeight;
      this.c.width = Math.max(1, Math.round(this.w * dpr));
      this.c.height = Math.max(1, Math.round(this.h * dpr));
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    clear() { this.ctx.clearRect(0, 0, this.w, this.h); }
    rem() { return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16; }
  }

  // ---- リングゲージ ----
  class Gauge extends Base {
    constructor(canvas, opts = {}) {
      super(canvas);
      this.opts = { label: '', unit: '%', max: 100, decimals: 0, ...opts };
      this.value = null; // 表示用（イージング）
      this.target = null;
      this.text = null; // 中央の文字列を上書きしたい場合
      this.sub = '';
      this.color = null;
    }
    set(v, { text = null, sub = '', color = null } = {}) {
      this.target = v;
      this.text = text;
      this.sub = sub;
      this.color = color;
    }
    draw(t) {
      const { ctx, w, h } = this;
      if (!w || !h) return;
      this.clear();
      const T = th();
      const cx = w / 2, cy = h / 2;
      const R = Math.min(w, h) / 2 - 4;
      const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
      const pct = this.target == null ? 0 : Math.max(0, Math.min(1, this.target / this.opts.max));
      this.value = ease(this.value, pct);
      const v = this.value;
      const col = this.color || levelColor(pct * 100);

      // 外周の目盛り
      for (let i = 0; i <= 40; i++) {
        const a = a0 + (a1 - a0) * (i / 40);
        const major = i % 10 === 0;
        const on = i / 40 <= v + 1e-6 && this.target != null;
        ctx.strokeStyle = on ? alpha(col, major ? 0.95 : 0.6) : alpha(T.accent, major ? 0.28 : 0.12);
        ctx.lineWidth = major ? 2 : 1;
        const r1 = R, r2 = R - (major ? 7 : 4);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        ctx.stroke();
      }

      // トラック
      const rr = R * 0.8;
      const lw = Math.max(4, R * 0.1);
      ctx.lineCap = 'butt';
      ctx.lineWidth = lw;
      ctx.strokeStyle = alpha(T.accent, 0.08);
      ctx.beginPath(); ctx.arc(cx, cy, rr, a0, a1); ctx.stroke();

      // セグメント化された値アーク
      if (this.target != null) {
        const segs = 48, gap = 0.012;
        const end = a0 + (a1 - a0) * v;
        ctx.save();
        // グロー（shadowBlur は重いので太い半透明線で代用）
        ctx.strokeStyle = alpha(col, 0.1);
        ctx.lineWidth = lw * 2.4;
        ctx.beginPath(); ctx.arc(cx, cy, rr, a0, end); ctx.stroke();
        ctx.lineWidth = lw;
        for (let i = 0; i < segs; i++) {
          const s = a0 + (a1 - a0) * (i / segs);
          if (s >= end) break;
          const e = Math.min(end, a0 + (a1 - a0) * ((i + 1) / segs) - gap);
          ctx.strokeStyle = alpha(col, 0.35 + 0.65 * (i / segs));
          ctx.beginPath(); ctx.arc(cx, cy, rr, s, e); ctx.stroke();
        }
        ctx.restore();
        // 先端マーカー
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(cx + Math.cos(end) * rr, cy + Math.sin(end) * rr, lw * 0.32, 0, Math.PI * 2);
        ctx.fill();
      }

      // 内側の回転リング
      const rot = (t / 6000) * Math.PI * 2;
      ctx.strokeStyle = alpha(T.accent, 0.18);
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 6]);
      ctx.beginPath(); ctx.arc(cx, cy, rr - lw * 1.3, rot, rot + Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = alpha(col, 0.5);
      ctx.beginPath(); ctx.arc(cx, cy, rr - lw * 1.3, -rot, -rot + 0.5); ctx.stroke();

      // 中央テキスト
      const big = R * 0.42;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = T.text;
      const txt = this.text ?? (this.target == null ? '--' : (this.target).toFixed(this.opts.decimals));
      ctx.font = `300 ${big}px ${T.font}`;
      const unit = this.text == null ? this.opts.unit : '';
      const tw = ctx.measureText(txt).width;
      ctx.font = `400 ${big * 0.36}px ${T.font}`;
      const uw = unit ? ctx.measureText(unit).width : 0;
      const x0 = cx - (tw + uw) / 2;
      ctx.textAlign = 'left';
      ctx.font = `300 ${big}px ${T.font}`;
      ctx.fillText(txt, x0, cy + big * 0.3);
      if (unit) {
        ctx.fillStyle = col;
        ctx.font = `400 ${big * 0.36}px ${T.font}`;
        ctx.fillText(unit, x0 + tw + 2, cy + big * 0.3);
      }
      ctx.textAlign = 'center';
      ctx.fillStyle = T.dim;
      ctx.font = `400 ${Math.max(9, R * 0.11)}px ${T.font}`;
      ctx.fillText(this.opts.label, cx, cy - big * 0.55);
      if (this.sub) {
        ctx.fillStyle = alpha(T.text, 0.75);
        ctx.font = `400 ${Math.max(9, R * 0.11)}px ${T.mono}`;
        ctx.fillText(this.sub, cx, cy + R * 0.62);
      }
    }
  }

  // ---- 時系列チャート ----
  // series: [{ color, fill, label }]、mirror: true で 2 系列目を下向きに描画
  class Chart extends Base {
    constructor(canvas, opts = {}) {
      super(canvas);
      this.opts = { capacity: 120, max: null, mirror: false, format: (v) => v.toFixed(0), series: [], interval: 1000, ...opts };
      this.data = this.opts.series.map(() => []);
      this.lastPush = performance.now();
      this.scale = 1;
    }
    push(...values) {
      values.forEach((v, i) => {
        const arr = this.data[i];
        arr.push(v == null || !Number.isFinite(v) ? null : v);
        if (arr.length > this.opts.capacity + 2) arr.shift();
      });
      this.lastPush = performance.now();
    }
    niceMax(m) {
      if (m <= 0) return 1;
      const p = Math.pow(10, Math.floor(Math.log10(m)));
      for (const k of [1, 2, 2.5, 5, 10]) if (k * p >= m) return k * p;
      return 10 * p;
    }
    draw(now) {
      const { ctx, w, h } = this;
      if (!w || !h) return;
      this.clear();
      const T = th();
      const { capacity, mirror } = this.opts;
      const step = w / (capacity - 1);
      const frac = Math.min(1, (now - this.lastPush) / this.opts.interval);

      let max = this.opts.max;
      if (max == null) {
        let m = 0;
        for (const arr of this.data) for (const v of arr) if (v > m) m = v;
        max = this.niceMax(m * 1.1);
      }
      this.scale = ease(this.scale, max, 0.08);
      const S = this.scale;

      const top = 12, bottom = h - 2;
      const mid = mirror ? (top + bottom) / 2 : bottom;
      const span = mirror ? (bottom - top) / 2 : bottom - top;

      // グリッド（時間方向に流れる縦線）
      ctx.lineWidth = 1;
      const vStep = step * 10;
      const scroll = ((this.data[0].length + frac) * step) % vStep;
      ctx.strokeStyle = alpha(T.accent, 0.06);
      for (let x = w - scroll; x > 0; x -= vStep) {
        ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, top); ctx.lineTo(Math.round(x) + 0.5, bottom); ctx.stroke();
      }
      for (let i = 0; i <= 4; i++) {
        const y = Math.round(top + ((bottom - top) * i) / 4) + 0.5;
        ctx.strokeStyle = alpha(T.accent, i === 0 || i === 4 || (mirror && i === 2) ? 0.16 : 0.06);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }

      this.data.forEach((arr, si) => {
        const s = this.opts.series[si];
        const dir = mirror && si === 1 ? 1 : -1;
        const pts = [];
        for (let i = 0; i < arr.length; i++) {
          if (arr[i] == null) continue;
          const x = w - (arr.length - 1 - i) * step + (1 - frac) * step;
          const y = mid + dir * Math.min(1, arr[i] / S) * span;
          pts.push([x, y]);
        }
        if (pts.length < 2) return;
        // 塗り
        const grad = ctx.createLinearGradient(0, mid + dir * span, 0, mid);
        grad.addColorStop(0, alpha(s.color, 0.32));
        grad.addColorStop(1, alpha(s.color, 0.0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(pts[0][0], mid);
        pts.forEach(([x, y]) => ctx.lineTo(x, y));
        ctx.lineTo(pts[pts.length - 1][0], mid);
        ctx.closePath();
        ctx.fill();
        // 線
        ctx.lineJoin = 'round';
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.strokeStyle = alpha(s.color, 0.18);
        ctx.lineWidth = 5;
        ctx.stroke();
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // 先端
        const [lx, ly] = pts[pts.length - 1];
        const pulse = 2 + 2 * Math.abs(Math.sin(now / 400));
        ctx.fillStyle = alpha(s.color, 0.25);
        ctx.beginPath(); ctx.arc(Math.min(lx, w - 3), ly, 2 + pulse, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(Math.min(lx, w - 3), ly, 1.8, 0, Math.PI * 2); ctx.fill();
      });

      // スケール表示
      ctx.font = `400 10px ${T.mono}`;
      ctx.fillStyle = T.dim;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`MAX ${this.opts.format(S)}`, 2, 0);
      ctx.textAlign = 'right';
      ctx.fillText(`-${capacity}s`, w - 2, 0);
    }
  }

  // ---- CPU コアごとのLEDバー ----
  class Cores extends Base {
    constructor(canvas) {
      super(canvas);
      this.values = [];
      this.shown = [];
    }
    set(values) { this.values = values || []; }
    draw() {
      const { ctx, w, h } = this;
      if (!w || !h || !this.values.length) return;
      this.clear();
      const T = th();
      const n = this.values.length;
      const gap = 3;
      const bw = (w - gap * (n - 1)) / n;
      const segs = 10;
      const sh = (h - 12) / segs;
      ctx.font = `400 9px ${T.mono}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      for (let i = 0; i < n; i++) {
        this.shown[i] = ease(this.shown[i], this.values[i] || 0, 0.15);
        const v = this.shown[i];
        const x = i * (bw + gap);
        const lit = Math.round((v / 100) * segs);
        for (let s = 0; s < segs; s++) {
          const y = h - 12 - (s + 1) * sh;
          const on = s < lit;
          const col = levelColor(((s + 1) / segs) * 100);
          ctx.fillStyle = on ? alpha(col, 0.85) : alpha(T.accent, 0.07);
          ctx.fillRect(x, y + 1, bw, sh - 1.5);
        }
        ctx.fillStyle = T.dim;
        ctx.fillText(String(i).padStart(2, '0'), x + bw / 2, h);
      }
    }
  }

  // ---- 日別バー（Claude） ----
  class DayBars extends Base {
    constructor(canvas, opts = {}) {
      super(canvas);
      this.opts = { format: (v) => String(v), ...opts };
      this.items = [];
      this.shown = [];
    }
    set(items) { this.items = items || []; }
    draw() {
      const { ctx, w, h } = this;
      if (!w || !h) return;
      this.clear();
      const T = th();
      const n = this.items.length;
      if (!n) return;
      const max = Math.max(1, ...this.items.map((d) => d.tokens));
      const top = 26, bottom = h - 14;
      const gap = 8;
      const bw = (w - gap * (n - 1)) / n;
      ctx.strokeStyle = alpha(T.accent, 0.16);
      ctx.beginPath(); ctx.moveTo(0, bottom + 0.5); ctx.lineTo(w, bottom + 0.5); ctx.stroke();
      ctx.font = `400 9px ${T.mono}`;
      ctx.textAlign = 'center';
      this.items.forEach((d, i) => {
        this.shown[i] = ease(this.shown[i], d.tokens / max, 0.1);
        const bh = (bottom - top) * this.shown[i];
        const x = i * (bw + gap);
        const today = i === n - 1;
        const col = today ? T.accent2 : T.accent;
        const g = ctx.createLinearGradient(0, bottom - bh, 0, bottom);
        g.addColorStop(0, alpha(col, today ? 0.95 : 0.7));
        g.addColorStop(1, alpha(col, 0.1));
        ctx.fillStyle = g;
        ctx.fillRect(x, bottom - bh, bw, bh);
        ctx.fillStyle = col;
        ctx.fillRect(x, bottom - bh, bw, 2);
        ctx.fillStyle = today ? T.text : T.dim;
        ctx.textBaseline = 'top';
        ctx.fillText(d.label, x + bw / 2, bottom + 3);
        if (d.tokens > 0) {
          ctx.textBaseline = 'bottom';
          ctx.fillText(this.opts.format(d.tokens), x + bw / 2, bottom - bh - 2);
        }
      });
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = T.dim;
      ctx.fillText('TOKENS / DAY · 7D', 0, 0);
    }
  }

  window.W = { Gauge, Chart, Cores, DayBars, levelColor, resetTheme: () => (T = null) };
})();
