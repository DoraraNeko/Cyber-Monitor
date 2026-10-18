(() => {
  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;

  // ---------- フォーマッタ ----------
  const GB = 1024 ** 3;
  const fmtBytes = (b, dec = 1) => {
    if (b == null || !Number.isFinite(b)) return '—';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return `${b.toFixed(i === 0 ? 0 : dec)} ${u[i]}`;
  };
  const fmtRate = (b) => (b == null ? '—' : `${fmtBytes(b)}/s`);
  const fmtBits = (B) => {
    if (B == null) return '—';
    let b = B * 8;
    const u = ['bps', 'Kbps', 'Mbps', 'Gbps'];
    let i = 0;
    while (b >= 1000 && i < u.length - 1) { b /= 1000; i++; }
    return `${b.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
  };
  const fmtTok = (n) => {
    if (n == null) return '—';
    if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K`;
    return String(Math.round(n));
  };
  const fmtDur = (sec) => {
    sec = Math.max(0, Math.floor(sec));
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const p = (x) => String(x).padStart(2, '0');
    return (d ? `${d}d ` : '') + `${p(h)}:${p(m)}:${p(s)}`;
  };
  const pct = (v) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(0)}%`);
  const set = (id, text) => { const el = $(id); if (el && el.textContent !== text) el.textContent = text; };
  const level = (p) => (p >= 90 ? 'crit' : p >= 75 ? 'warn' : '');
  const panelLevel = (id, p) => {
    const el = $(id);
    el.classList.toggle('warn', level(p) === 'warn');
    el.classList.toggle('crit', level(p) === 'crit');
  };
  const bar = (id, p) => {
    const el = $(id);
    el.style.width = `${Math.max(0, Math.min(100, p || 0))}%`;
    el.className = level(p);
  };

  // ---------- 状態 ----------
  let cfg = {};
  let widgets = null;
  let lastMetricsAt = 0;
  let claude = null;

  function applyConfig(c) {
    cfg = c || {};
    if (cfg.accent) root.style.setProperty('--accent', cfg.accent);
    if (cfg.accent2) root.style.setProperty('--accent2', cfg.accent2);
    const ins = cfg.insets || {};
    for (const k of ['top', 'right', 'bottom', 'left']) root.style.setProperty(`--pad-${k}`, `${ins[k] || 0}px`);
    document.body.className = `layout-${cfg.layout || 'right'}`;
    if (cfg.claude && cfg.claude.enabled === false) document.body.classList.add('no-claude');
    if (cfg.backgroundImage) {
      document.body.classList.add('has-image');
      $('bg').style.backgroundImage = `url("${cfg.backgroundImage}")`;
      root.style.setProperty('--dim-amount', cfg.backgroundDim ?? 0.55);
    }
    W.resetTheme();
    fitRem();
    buildWidgets();
  }

  // 1920x1080 を基準に全体をスケール
  function fitRem() {
    const s = Math.min(innerWidth / 1920, innerHeight / 1080);
    root.style.fontSize = `${Math.max(10, 16 * s)}px`;
  }
  addEventListener('resize', fitRem);

  function buildWidgets() {
    const cap = cfg.historySeconds || 120;
    const css = getComputedStyle(root);
    const A = css.getPropertyValue('--accent').trim();
    const B = css.getPropertyValue('--accent2').trim();
    widgets = {
      gCpu: new W.Gauge($('g-cpu'), { label: 'LOAD' }),
      gGpu: new W.Gauge($('g-gpu'), { label: 'UTIL' }),
      gMem: new W.Gauge($('g-mem'), { label: 'USED' }),
      gDisk: new W.Gauge($('g-disk'), { label: 'ACTIVE' }),
      gWifi: new W.Gauge($('g-wifi'), { label: 'SIGNAL' }),
      gClaude: new W.Gauge($('g-claude'), { label: '5H BLOCK' }),
      cCpu: new W.Chart($('c-cpu'), { capacity: cap, max: 100, series: [{ color: A }], format: (v) => `${v.toFixed(0)}%` }),
      cGpu: new W.Chart($('c-gpu'), { capacity: cap, max: 100, series: [{ color: A }, { color: B }], format: (v) => `${v.toFixed(0)}%` }),
      cMem: new W.Chart($('c-mem'), { capacity: cap, max: 100, series: [{ color: A }], format: (v) => `${v.toFixed(0)}%` }),
      cDisk: new W.Chart($('c-disk'), { capacity: cap, mirror: true, series: [{ color: A }, { color: B }], format: fmtRate }),
      cNet: new W.Chart($('c-net'), { capacity: cap, mirror: true, series: [{ color: A }, { color: B }], format: fmtBits }),
      cores: new W.Cores($('c-cores')),
      days: new W.DayBars($('c-claude'), { format: fmtTok }),
    };
    if (claude) onClaude(claude);
  }

  // ---------- データ反映 ----------
  function onInit({ config, static: st }) {
    applyConfig(config);
    if (st) {
      set('host', st.hostname);
      set('os', st.os);
      set('cpu-name', st.cpuBrand);
      set('cpu-cores', `${st.cores}C / ${st.threads}T`);
    }
  }

  function onMetrics(m) {
    if (!widgets) return;
    lastMetricsAt = Date.now();
    const w = widgets;

    // CPU
    w.gCpu.set(m.cpu.load);
    w.cCpu.push(m.cpu.load);
    w.cores.set(m.cpu.cores);
    set('cpu-freq', m.cpu.speed ? `${m.cpu.speed.toFixed(2)} GHz` : '—');
    const peak = Math.max(...m.cpu.cores);
    set('cpu-peak', `${pct(peak)} #${String(m.cpu.cores.indexOf(peak)).padStart(2, '0')}`);
    panelLevel('p-cpu', m.cpu.load);

    // MEMORY
    const memP = (m.mem.used / m.mem.total) * 100;
    w.gMem.set(memP, { sub: `${(m.mem.used / GB).toFixed(1)} / ${(m.mem.total / GB).toFixed(0)} GB` });
    w.cMem.push(memP);
    set('mem-total', `${(m.mem.total / GB).toFixed(0)} GB PHYSICAL`);
    set('mem-used', fmtBytes(m.mem.used));
    set('mem-avail', fmtBytes(m.mem.available));
    set('mem-swap', m.mem.swapTotal ? fmtBytes(m.mem.swapUsed) : '—');
    const commitTotal = m.mem.total + (m.mem.swapTotal || 0);
    const commitP = ((m.mem.used + (m.mem.swapUsed || 0)) / commitTotal) * 100;
    bar('mem-bar', commitP);
    set('mem-pct', `${fmtBytes(m.mem.used + (m.mem.swapUsed || 0))} / ${fmtBytes(commitTotal, 0)}`);
    panelLevel('p-mem', memP);

    // GPU
    const g = m.gpu;
    $('p-gpu').classList.toggle('nodata', !g);
    if (g) {
      const vramP = g.vramTotal ? (g.vramUsed / g.vramTotal) * 100 : null;
      w.gGpu.set(g.util, { sub: g.power != null ? `${g.power.toFixed(0)} W` : g.temp != null ? `${g.temp}°C` : '' });
      w.cGpu.push(g.util, vramP);
      set('gpu-name', g.name || 'GPU');
      set('gpu-temp', g.temp != null ? `${g.temp.toFixed(0)} °C` : '—');
      set('gpu-clock', g.clock != null ? `${g.clock} MHz` : '—');
      set('gpu-fan', g.fan != null ? `${g.fan.toFixed(0)} %` : '—');
      if (vramP != null) {
        bar('gpu-vram-bar', vramP);
        set('gpu-vram', `${(g.vramUsed / 1024).toFixed(1)} / ${(g.vramTotal / 1024).toFixed(0)} GB`);
      }
      panelLevel('p-gpu', Math.max(g.util || 0, g.temp >= 83 ? 90 : 0));
    } else {
      w.gGpu.set(null);
      w.cGpu.push(null, null);
    }

    // DISK
    const d = m.disk;
    if (d) {
      w.gDisk.set(d.busy, { sub: fmtRate(d.read + d.write) });
      w.cDisk.push(d.read, d.write);
      set('disk-read', fmtRate(d.read));
      set('disk-write', fmtRate(d.write));
      set('disk-queue', d.queue.toFixed(0));
      panelLevel('p-disk', d.busy);
    }
    renderDrives(m.drives || []);

    // NETWORK
    const n = m.net;
    const wf = n.wifi;
    w.cNet.push(n.rx, n.tx);
    set('net-rx', fmtBits(n.rx));
    set('net-tx', fmtBits(n.tx));
    set('net-ping', n.ping != null ? `${n.ping} ms` : 'TIMEOUT');
    set('net-ip', n.iface?.ip || '—');
    if (wf && wf.connected) {
      w.gWifi.set(wf.signal, { sub: wf.rssi != null ? `${wf.rssi} dBm` : '', color: getComputedStyle(root).getPropertyValue(wf.signal < 40 ? '--crit' : wf.signal < 60 ? '--warn' : '--accent').trim() });
      set('net-ssid', `WI-FI // ${wf.ssid || 'HIDDEN'}`);
      set('net-link', wf.rxRate ? `${wf.rxRate.toFixed(0)}/${(wf.txRate || 0).toFixed(0)} Mbps` : '—');
      set('net-band', [wf.band, wf.channel && `CH${wf.channel}`].filter(Boolean).join(' ') || '—');
      set('net-std', wf.radio || '—');
    } else {
      w.gWifi.set(null, { text: n.iface ? 'LAN' : 'OFF' });
      set('net-ssid', n.iface ? `ETHERNET // ${n.iface.name}` : 'DISCONNECTED');
      set('net-link', n.iface?.speed ? `${n.iface.speed} Mbps` : '—');
      set('net-band', '—');
      set('net-std', '—');
    }

    // サマリー
    set('uptime', fmtDur(m.uptime));
    set('sum-load', pct(m.cpu.load));
    set('sum-mem', pct(memP));
    set('sum-gpu', g ? pct(g.util) : '—');
    set('sum-ping', n.ping != null ? `${n.ping}ms` : '—');
  }

  let drivesKey = '';
  function renderDrives(drives) {
    const key = drives.map((d) => `${d.mount}${d.use.toFixed(0)}`).join('|');
    if (key === drivesKey) return;
    drivesKey = key;
    const box = $('drives');
    box.innerHTML = '';
    for (const dr of drives.slice(0, 3)) {
      const row = document.createElement('div');
      row.className = 'meter';
      row.innerHTML = `<span class="ml"></span><div class="track"><i></i></div><span class="mv"></span>`;
      row.querySelector('.ml').textContent = dr.mount;
      row.querySelector('.mv').textContent = `${fmtBytes(dr.used, 0)} / ${fmtBytes(dr.size, 0)}`;
      const i = row.querySelector('i');
      i.className = level(dr.use);
      box.appendChild(row);
      requestAnimationFrame(() => (i.style.width = `${dr.use}%`));
    }
  }

  function onClaude(c) {
    claude = c;
    if (!widgets) return;
    const panel = $('p-claude');
    if (!c || !c.available) {
      panel.classList.add('nodata');
      widgets.gClaude.set(null, { text: 'N/A' });
      return;
    }
    panel.classList.remove('nodata');
    const b = c.block;
    if (b) {
      const p = c.limit ? (b.tokens / c.limit) * 100 : 0;
      widgets.gClaude.set(Math.min(100, p), {
        text: fmtTok(b.tokens),
        sub: c.limitIsConfigured ? `${p.toFixed(0)}% OF LIMIT` : `${p.toFixed(0)}% OF PEAK`,
      });
      set('cl-burn', `${fmtTok(b.burnPerMin)}/min`);
      set('cl-in', fmtTok(b.input));
      set('cl-out', fmtTok(b.output));
      set('cl-cache', fmtTok(b.cache));
      panelLevel('p-claude', p);
    } else {
      widgets.gClaude.set(0, { text: 'IDLE', sub: 'NO ACTIVE BLOCK' });
      set('cl-burn', '—');
      set('cl-in', '—');
      set('cl-out', '—');
      set('cl-cache', '—');
      panelLevel('p-claude', 0);
    }
    set('cl-today', fmtTok(c.today?.tokens || 0));
    set('cl-model', c.models?.[0]?.[0]?.replace(/^claude-/, '') || '—');
    widgets.days.set(c.days);
    updateReset();
  }

  function updateReset() {
    const b = claude && claude.block;
    set('cl-reset', b ? fmtDur((b.end - Date.now()) / 1000) : '—');
  }

  // ---------- 時計 ----------
  const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  function tickClock() {
    const d = new Date();
    const p = (x) => String(x).padStart(2, '0');
    set('hhmm', `${p(d.getHours())}:${p(d.getMinutes())}`);
    set('ss', p(d.getSeconds()));
    set('date', `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`);
    set('dow', DOW[d.getDay()]);
    updateReset();
    const stale = lastMetricsAt && Date.now() - lastMetricsAt > 5000;
    set('status', stale ? 'NO SIGNAL' : 'ONLINE');
  }
  setInterval(tickClock, 1000);
  tickClock();

  // ---------- 描画ループ ----------
  let lastFrame = 0;
  function frame(t) {
    requestAnimationFrame(frame);
    const interval = 1000 / (cfg.fps || 20);
    if (t - lastFrame < interval - 1) return;
    lastFrame = t;
    if (!widgets) return;
    for (const w of Object.values(widgets)) w.draw(t);
  }
  requestAnimationFrame(frame);

  // ---------- 接続 ----------
  if (window.hud) {
    hud.on('init', onInit);
    hud.on('metrics', onMetrics);
    hud.on('claude', onClaude);
  } else {
    // ブラウザで直接開いたときのデモデータ
    onInit({ config: { layout: 'right', insets: { bottom: 48 } }, static: { hostname: 'DEMO-PC', os: 'Windows 11', cpuBrand: 'AMD Ryzen 7 5700X', cores: 8, threads: 16 } });
    let k = 0;
    const r = (a, b) => a + Math.random() * (b - a);
    setInterval(() => {
      k++;
      const load = 20 + 15 * Math.sin(k / 9) + r(0, 15);
      onMetrics({
        t: Date.now(), uptime: 3600 * 30 + k,
        cpu: { load, cores: Array.from({ length: 16 }, () => Math.min(100, load + r(-20, 40))), speed: 3.8 },
        mem: { total: 32 * GB, used: (14 + Math.sin(k / 20)) * GB, available: 17 * GB, swapTotal: 4 * GB, swapUsed: 0.5 * GB },
        gpu: { name: 'NVIDIA GeForce RTX 4060', util: 40 + 30 * Math.sin(k / 7), vramUsed: 3200, vramTotal: 8188, temp: 58, power: 72, clock: 2460, fan: 45 },
        disk: { read: r(0, 4e7), write: r(0, 1.2e7), busy: r(2, 30), queue: 0 },
        drives: [{ mount: 'C:', size: 1e12, used: 6.1e11, use: 61 }, { mount: 'D:', size: 2e12, used: 1.6e12, use: 80 }],
        net: { iface: { name: 'Wi-Fi', ip: '192.168.0.12' }, rx: r(1e4, 3e6), tx: r(1e4, 4e5), ping: 12, wifi: { connected: true, ssid: 'DEMO-AP', signal: 84, rssi: -51, rxRate: 866.7, txRate: 866.7, band: '5 GHz', channel: '36', radio: '802.11ac' } },
      });
    }, 1000);
    onClaude({
      available: true, limit: 9e7, limitIsConfigured: false,
      block: { start: Date.now() - 7200e3, end: Date.now() + 10800e3, tokens: 4.2e7, input: 1.2e5, output: 3.1e5, cache: 4.17e7, messages: 300, burnPerMin: 3.5e5 },
      today: { tokens: 6.5e7 },
      days: ['10/12', '10/13', '10/14', '10/15', '10/16', '10/17', '10/18'].map((label, i) => ({ label, tokens: [2e7, 0, 4.5e7, 3e7, 8e7, 1.5e7, 6.5e7][i] })),
      models: [['claude-opus-5-5', 1]],
    });
  }
})();
