// 背景: 遠近グリッドの床 + ネットワーク状に結ばれた粒子 + 走査線
(() => {
  const canvas = document.getElementById('bg');
  const ctx = canvas.getContext('2d');
  const opts = { accent: '#00f0ff', accent2: '#ff2bd6', ambient: true, fps: 30 };
  let W = 0, H = 0, dpr = 1;
  let particles = [];
  let last = 0;
  let t = 0;
  let raf = 0;

  const rgba = (hex, a) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex) || [0, '00f0ff'];
    const n = parseInt(m[1], 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
  };

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.round(Math.min(90, (W * H) / 26000));
    particles = Array.from({ length: count }, () => ({
      x: Math.random() * W,
      y: Math.random() * H * 0.62,
      vx: (Math.random() - 0.5) * 0.25,
      vy: (Math.random() - 0.5) * 0.18,
      r: Math.random() * 1.4 + 0.4,
      hue: Math.random() < 0.18 ? 1 : 0,
    }));
    draw();
  }

  function drawFloor() {
    const horizon = H * 0.6;
    const vx = W / 2;
    // 地平線の光
    const g = ctx.createLinearGradient(0, horizon - 60, 0, horizon + 40);
    g.addColorStop(0, rgba(opts.accent2, 0));
    g.addColorStop(0.6, rgba(opts.accent2, 0.10));
    g.addColorStop(1, rgba(opts.accent, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, horizon - 60, W, 100);

    ctx.lineWidth = 1;
    // 放射線（縦）
    const n = 28;
    for (let i = -n; i <= n; i++) {
      const xb = vx + i * (W / n) * 1.6;
      const a = 0.16 * (1 - Math.abs(i) / (n + 4));
      ctx.strokeStyle = rgba(opts.accent, a);
      ctx.beginPath(); ctx.moveTo(vx + i * 4, horizon); ctx.lineTo(xb, H); ctx.stroke();
    }
    // 横線（手前へ流れる）
    const rows = 18;
    const phase = (t * 0.00018) % 1;
    for (let i = 0; i < rows; i++) {
      const p = (i + phase) / rows;
      const y = horizon + Math.pow(p, 2.2) * (H - horizon);
      ctx.strokeStyle = rgba(opts.accent, 0.03 + p * 0.2);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    // 床のフェード
    const f = ctx.createLinearGradient(0, horizon, 0, H);
    f.addColorStop(0, 'rgba(3,6,12,0.85)');
    f.addColorStop(0.35, 'rgba(3,6,12,0.2)');
    f.addColorStop(1, 'rgba(3,6,12,0.55)');
    ctx.fillStyle = f;
    ctx.fillRect(0, horizon, W, H - horizon);
  }

  function drawSky() {
    // 細かいドットグリッド
    ctx.fillStyle = rgba(opts.accent, 0.07);
    const s = 34;
    for (let y = s / 2; y < H * 0.6; y += s) for (let x = s / 2; x < W; x += s) ctx.fillRect(x, y, 1, 1);

    // 粒子ネットワーク
    const maxD = 130, maxD2 = maxD * maxD;
    for (let i = 0; i < particles.length; i++) {
      const a = particles[i];
      for (let j = i + 1; j < particles.length; j++) {
        const b = particles[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < maxD2) {
          ctx.strokeStyle = rgba(opts.accent, 0.13 * (1 - d2 / maxD2));
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
    }
    for (const p of particles) {
      ctx.fillStyle = rgba(p.hue ? opts.accent2 : opts.accent, 0.7);
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }

    // ゆっくり降りる走査線
    const sy = ((t * 0.04) % (H + 200)) - 100;
    const sg = ctx.createLinearGradient(0, sy - 80, 0, sy);
    sg.addColorStop(0, rgba(opts.accent, 0));
    sg.addColorStop(1, rgba(opts.accent, 0.05));
    ctx.fillStyle = sg;
    ctx.fillRect(0, sy - 80, W, 80);
    ctx.fillStyle = rgba(opts.accent, 0.12);
    ctx.fillRect(0, sy, W, 1);
  }

  function step(dt) {
    for (const p of particles) {
      p.x += p.vx * dt * 0.06; p.y += p.vy * dt * 0.06;
      if (p.x < -10) p.x = W + 10; if (p.x > W + 10) p.x = -10;
      if (p.y < -10) p.y = H * 0.62; if (p.y > H * 0.62) p.y = -10;
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    drawSky();
    drawFloor();
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    const interval = 1000 / Math.max(1, opts.fps);
    if (now - last < interval) return;
    const dt = Math.min(100, now - last);
    last = now;
    t += dt;
    step(dt);
    draw();
  }

  window.CyberBG = {
    configure(o) {
      Object.assign(opts, o);
      cancelAnimationFrame(raf);
      draw();
      if (opts.ambient) { last = performance.now(); raf = requestAnimationFrame(loop); }
    },
  };

  window.addEventListener('resize', resize);
  resize();
  window.CyberBG.configure({});
})();
