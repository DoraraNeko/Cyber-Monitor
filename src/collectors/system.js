// CPU / メモリ / GPU / ディスク / ネットワーク(Wi-Fi) の収集
const si = require('systeminformation');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const readline = require('readline');

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

class SystemCollector {
  constructor(config) {
    this.config = config;
    this.children = [];
    this.timers = [];
    this.state = {
      gpu: null,
      disk: null,
      drives: [],
      wifi: null,
      ping: null,
      iface: null,
    };
    this.static = null;
  }

  async start() {
    this.static = await this.loadStatic();
    this.startSampler();
    this.startGpu();
    await this.refreshDrives();
    await this.refreshNetInfo();
    this.timers.push(setInterval(() => this.refreshDrives(), 30_000));
    this.timers.push(setInterval(() => this.refreshNetInfo(), 30_000));
    this.timers.push(setInterval(() => this.refreshWifi(), 5_000));
    this.timers.push(setInterval(() => this.refreshPing(), 5_000));
    this.refreshWifi();
    this.refreshPing();
  }

  stop() {
    this.stopped = true;
    this.timers.forEach(clearInterval);
    this.children.forEach((c) => { try { c.kill(); } catch {} });
  }

  async loadStatic() {
    const [cpu, osInfo] = await Promise.all([si.cpu(), si.osInfo()]);
    return {
      cpuBrand: `${cpu.manufacturer} ${cpu.brand}`.replace(/\s+/g, ' ').trim(),
      cores: cpu.physicalCores,
      threads: cpu.cores,
      baseSpeed: cpu.speed,
      hostname: os.hostname(),
      os: `${osInfo.distro.replace(/^Microsoft /i, '')} ${osInfo.build}`.trim(),
    };
  }

  // ディスクI/O（と nvidia-smi が無い場合の GPU 使用率）は WMI のパフォーマンスカウンタから
  startSampler() {
    const script = path.join(__dirname, '..', 'native', 'sampler.ps1');
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script];
    if (this.gpuSource() === 'wmi') args.push('-Gpu');
    const child = spawn('powershell.exe', args, { windowsHide: true });
    this.children.push(child);
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      try {
        const o = JSON.parse(line);
        this.state.disk = { read: o.diskRead ?? 0, write: o.diskWrite ?? 0, busy: o.diskBusy ?? 0, queue: o.diskQueue ?? 0 };
        this.state.net = { rx: o.netRx ?? 0, tx: o.netTx ?? 0 };
        if (o.cpuPerf != null) this.state.cpuPerf = o.cpuPerf;
        if (o.pageTotalMB != null) this.state.page = { used: o.pageUsedMB * 1048576, total: o.pageTotalMB * 1048576 };
        if (o.gpuUtil != null && this.gpuSource() === 'wmi') {
          this.state.gpu = { ...(this.state.gpu || { name: 'GPU' }), util: o.gpuUtil };
        }
      } catch {}
    });
    child.on('exit', () => {
      if (this.stopped) return;
      setTimeout(() => this.startSampler(), 5000);
    });
  }

  gpuSource() {
    const src = this.config.gpu?.source || 'auto';
    if (src !== 'auto') return src;
    return this.hasNvidia === false ? 'wmi' : 'nvidia-smi';
  }

  startGpu() {
    if (this.gpuSource() !== 'nvidia-smi') return;
    const fields = 'name,utilization.gpu,utilization.memory,memory.used,memory.total,temperature.gpu,power.draw,power.limit,clocks.gr,clocks.max.gr,fan.speed';
    const child = spawn('nvidia-smi', [`--query-gpu=${fields}`, '--format=csv,noheader,nounits', '-lms', '1000'], { windowsHide: true });
    this.children.push(child);
    child.on('error', () => {
      // nvidia-smi が無い → WMI に切り替えて sampler を再起動
      this.hasNvidia = false;
      this.children.filter((c) => c.spawnfile === 'powershell.exe').forEach((c) => c.kill());
    });
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      const p = line.split(',').map((s) => s.trim());
      if (p.length < 11) return;
      this.hasNvidia = true;
      this.state.gpu = {
        name: p[0],
        util: num(p[1]),
        memUtil: num(p[2]),
        vramUsed: num(p[3]),
        vramTotal: num(p[4]),
        temp: num(p[5]),
        power: num(p[6]),
        powerLimit: num(p[7]),
        clock: num(p[8]),
        clockMax: num(p[9]),
        fan: num(p[10]),
      };
    });
  }

  async refreshDrives() {
    try {
      const fs = await si.fsSize();
      this.state.drives = fs
        .filter((d) => d.size > 0)
        .map((d) => ({ mount: d.mount, size: d.size, used: d.used, use: d.use }))
        .sort((a, b) => a.mount.localeCompare(b.mount));
    } catch {}
  }

  async refreshNetInfo() {
    try {
      const ifaceName = await si.networkInterfaceDefault();
      const ifaces = await si.networkInterfaces();
      const iface = ifaces.find((i) => i.iface === ifaceName) || ifaces.find((i) => !i.internal && i.ip4);
      if (iface) this.state.iface = { name: iface.iface, ip: iface.ip4, type: iface.type, speed: iface.speed };
    } catch {}
  }

  refreshWifi() {
    // chcp 65001 で UTF-8 出力にしてから netsh（日本語表示の Windows でもパースできるように）
    execFile('cmd.exe', ['/d', '/c', 'chcp 65001 >nul & netsh wlan show interfaces'], { windowsHide: true, timeout: 4000 }, (err, out) => {
      if (err || !out) { this.state.wifi = null; return; }
      const get = (...keys) => {
        for (const k of keys) {
          const m = out.match(new RegExp(`^\\s*${k}\\s*:\\s*(.+?)\\s*$`, 'mi'));
          if (m) return m[1];
        }
        return null;
      };
      const state = get('State', '状態');
      if (!state) { this.state.wifi = null; return; }
      this.state.wifi = {
        connected: /connected|接続されました/i.test(state) && !/disconnected|切断/i.test(state),
        ssid: get('SSID'),
        signal: num(get('Signal', 'シグナル')),
        rssi: num(get('Rssi')),
        rxRate: num(get('Receive rate \\(Mbps\\)', '受信速度 \\(Mbps\\)')),
        txRate: num(get('Transmit rate \\(Mbps\\)', '送信速度 \\(Mbps\\)')),
        band: get('Band', 'バンド'),
        channel: get('Channel', 'チャネル'),
        radio: get('Radio type', '無線の種類'),
        adapter: get('Description', '説明'),
      };
    });
  }

  refreshPing() {
    execFile('ping', ['-n', '1', '-w', '1500', '1.1.1.1'], { windowsHide: true, timeout: 4000 }, (err, out) => {
      const m = out && out.match(/[=<]\s*(\d+)\s*ms/i);
      this.state.ping = m ? Number(m[1]) : null;
    });
  }

  // os.cpus() の累積時間の差分から CPU 使用率を計算（プロセス起動なし）
  cpuLoad() {
    const cpus = os.cpus();
    const prev = this.prevCpus;
    this.prevCpus = cpus;
    if (!prev) return { load: 0, cores: cpus.map(() => 0) };
    let idleAll = 0, totalAll = 0;
    const cores = cpus.map((c, i) => {
      const p = prev[i].times, t = c.times;
      const idle = t.idle - p.idle;
      const total = t.user - p.user + (t.nice - p.nice) + (t.sys - p.sys) + (t.irq - p.irq) + idle;
      idleAll += idle;
      totalAll += total;
      return total > 0 ? (1 - idle / total) * 100 : 0;
    });
    return { load: totalAll > 0 ? (1 - idleAll / totalAll) * 100 : 0, cores };
  }

  async sample() {
    const cpu = this.cpuLoad();
    const total = os.totalmem();
    const available = os.freemem();
    const perf = this.state.cpuPerf;
    return {
      t: Date.now(),
      uptime: os.uptime(),
      cpu: {
        ...cpu,
        speed: perf != null && this.static?.baseSpeed ? (this.static.baseSpeed * perf) / 100 : null,
      },
      mem: {
        total,
        used: total - available,
        available,
        swapTotal: this.state.page?.total ?? 0,
        swapUsed: this.state.page?.used ?? 0,
      },
      gpu: this.state.gpu,
      disk: this.state.disk,
      drives: this.state.drives,
      net: {
        iface: this.state.iface,
        rx: this.state.net?.rx ?? 0,
        tx: this.state.net?.tx ?? 0,
        wifi: this.state.wifi,
        ping: this.state.ping,
      },
    };
  }
}

module.exports = { SystemCollector };
