// Claude Code のローカルログ (~/.claude/projects/**/*.jsonl) からトークン使用量を集計する。
// 5時間ブロックの区切り方は ccusage と同じ考え方（最初のメッセージの正時から5時間、5時間以上の空白で新ブロック）。
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOUR = 3600_000;
const BLOCK = 5 * HOUR;
const KEEP = 8 * 24 * HOUR;

class ClaudeCollector {
  constructor(config) {
    this.dir = config.projectsDir || path.join(os.homedir(), '.claude', 'projects');
    this.tokenLimit = config.tokenLimit5h || 0;
    this.offsets = new Map(); // file -> bytes consumed
    this.seen = new Set();
    this.entries = []; // { t, model, input, output, cacheW, cacheR }
  }

  available() {
    return fs.existsSync(this.dir);
  }

  listFiles(dir, out = []) {
    let items;
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const it of items) {
      const p = path.join(dir, it.name);
      if (it.isDirectory()) this.listFiles(p, out);
      else if (it.name.endsWith('.jsonl')) out.push(p);
    }
    return out;
  }

  readNew(file) {
    let stat;
    try { stat = fs.statSync(file); } catch { return; }
    let offset = this.offsets.get(file) || 0;
    if (stat.size < offset) offset = 0; // 切り詰められた
    if (stat.size === offset) return;
    // 初回は古いファイルを丸ごと読む必要はない（更新が KEEP より前なら読み飛ばす）
    if (offset === 0 && Date.now() - stat.mtimeMs > KEEP) { this.offsets.set(file, stat.size); return; }

    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(stat.size - offset);
      fs.readSync(fd, buf, 0, buf.length, offset);
      const lastNl = buf.lastIndexOf(0x0a);
      if (lastNl < 0) return; // 行が書き終わるまで待つ
      this.offsets.set(file, offset + lastNl + 1);
      const text = buf.subarray(0, lastNl).toString('utf8');
      for (const line of text.split('\n')) {
        if (!line.includes('"usage"')) continue;
        let o;
        try { o = JSON.parse(line); } catch { continue; }
        const u = o.message?.usage;
        if (!u || !o.timestamp) continue;
        const key = `${o.message.id}:${o.requestId}`;
        if (this.seen.has(key)) continue;
        this.seen.add(key);
        const t = Date.parse(o.timestamp);
        if (!Number.isFinite(t) || Date.now() - t > KEEP) continue;
        this.entries.push({
          t,
          model: o.message.model || 'unknown',
          input: u.input_tokens || 0,
          output: u.output_tokens || 0,
          cacheW: u.cache_creation_input_tokens || 0,
          cacheR: u.cache_read_input_tokens || 0,
        });
      }
    } finally {
      fs.closeSync(fd);
    }
  }

  collect() {
    if (!this.available()) return { available: false };
    for (const f of this.listFiles(this.dir)) this.readNew(f);

    const now = Date.now();
    this.entries = this.entries.filter((e) => now - e.t <= KEEP).sort((a, b) => a.t - b.t);
    const total = (e) => e.input + e.output + e.cacheW + e.cacheR;

    // 5時間ブロック
    const blocks = [];
    let cur = null;
    for (const e of this.entries) {
      if (!cur || e.t >= cur.start + BLOCK || e.t - cur.last >= BLOCK) {
        const start = new Date(e.t);
        start.setMinutes(0, 0, 0);
        cur = { start: start.getTime(), last: e.t, tokens: 0, input: 0, output: 0, cache: 0, messages: 0 };
        blocks.push(cur);
      }
      cur.last = e.t;
      cur.tokens += total(e);
      cur.input += e.input;
      cur.output += e.output;
      cur.cache += e.cacheW + e.cacheR;
      cur.messages++;
    }
    const lastBlock = blocks[blocks.length - 1];
    const active = lastBlock && now < lastBlock.start + BLOCK ? lastBlock : null;
    const maxBlock = blocks.reduce((m, b) => Math.max(m, b.tokens), 0);

    // 日別（ローカル日付、直近7日）
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      days.push({ start: d.getTime(), end: d.getTime() + 24 * HOUR, label: `${d.getMonth() + 1}/${d.getDate()}`, tokens: 0, output: 0 });
    }
    const models = {};
    for (const e of this.entries) {
      const day = days.find((d) => e.t >= d.start && e.t < d.end);
      if (!day) continue;
      day.tokens += total(e);
      day.output += e.output;
      if (day === days[6]) models[e.model] = (models[e.model] || 0) + total(e);
    }

    let block = null;
    if (active) {
      const elapsedMin = Math.max(1, (now - active.start) / 60_000);
      block = {
        start: active.start,
        end: active.start + BLOCK,
        tokens: active.tokens,
        input: active.input,
        output: active.output,
        cache: active.cache,
        messages: active.messages,
        burnPerMin: active.tokens / elapsedMin,
        projected: (active.tokens / elapsedMin) * (BLOCK / 60_000),
      };
    }

    return {
      available: true,
      block,
      limit: this.tokenLimit || maxBlock,
      limitIsConfigured: !!this.tokenLimit,
      today: days[6],
      days: days.map(({ label, tokens, output }) => ({ label, tokens, output })),
      models: Object.entries(models).sort((a, b) => b[1] - a[1]).slice(0, 3),
    };
  }
}

module.exports = { ClaudeCollector };
