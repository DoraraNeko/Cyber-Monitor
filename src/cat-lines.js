// 壁紙の猫のセリフ。{...} はその時の値に置き換わる（値が無いセリフは選ばれない）
//   {time} 時刻  {cpu} {mem} {gpu} 使用率(%)  {open} 未完了タスク数  {active} 進行中  {overdue} 期限切れ  {today} 今日が期限
// on: 'any' = どこでも / 'perf' = Performance Monitor の上 / 'board' = Cyber Board の上
// when: (ctx) => boolean  出す条件（省略でいつでも）

const night = (c) => c.hour >= 0 && c.hour < 5;
const morning = (c) => c.hour >= 5 && c.hour < 10;
const noon = (c) => c.hour >= 11 && c.hour < 14;
const afternoon = (c) => c.hour >= 14 && c.hour < 17;
const evening = (c) => c.hour >= 17 && c.hour < 21;
const late = (c) => c.hour >= 21 || c.hour < 5;
const weekday = (c) => c.dow >= 1 && c.dow <= 5;
const weekend = (c) => c.dow === 0 || c.dow === 6;

const LINES = [
  // ── ねこの日常 ──
  { on: 'any', text: '{time}だにゃ。ちょっと伸びしよ' },
  { on: 'any', text: 'ここ、ぼくの特等席' },
  { on: 'any', text: '壁紙の上って、意外とあったかい' },
  { on: 'any', text: 'アイコンの後ろから見守ってるよ' },
  { on: 'any', text: '1時間たったら、ぼくは引っ越すよ' },
  { on: 'any', text: '胴が長いのは仕様です' },
  { on: 'any', text: 'ぼくを探してくれてありがとう' },
  { on: 'any', text: 'デスクトップ、いい眺め' },
  { on: 'any', text: 'ネオンがまぶしい。猫には明るすぎる' },
  { on: 'any', text: 'ここは2077年のデスクトップ' },
  { on: 'any', text: 'システム、オールグリーン。たぶん' },
  { on: 'any', text: 'ぼくがいなかったら、ただの壁紙なのにね' },

  // ── からだのこと ──
  { on: 'any', text: 'まばたき、忘れてない？' },
  { on: 'any', text: 'ちょっと水でも飲んだら？' },
  { on: 'any', text: '肩、ぐるぐる回してみて' },
  { on: 'any', text: '画面から少し離れて、遠くを見ようね' },
  { on: 'any', text: 'その姿勢、首にきてない？' },
  { on: 'any', text: 'ぼくみたいに伸びをするといいよ。ほら' },
  { on: 'any', text: '{time}。ひと休みにちょうどいい時間' },

  // ── PC作業 ──
  { on: 'any', text: 'デスクトップのファイル、片付けたら？' },
  { on: 'any', text: '「最終版_修正2_本当の最終版」ってファイル、ない？' },
  { on: 'any', text: 'Ctrl+S、押した？いま押した？' },
  { on: 'any', text: 'タブ、何個開いてる？数えるのが怖い？' },
  { on: 'any', text: 'パスワード、付箋に書いてないよね？' },
  { on: 'any', text: '再起動を「あとで」にして何日目？' },
  { on: 'any', text: 'ダウンロードフォルダ、魔境になってない？' },
  { on: 'any', text: 'バックアップは、なくしてから大事さがわかる' },
  { on: 'any', text: '検索すれば5秒。悩めば30分' },
  { on: 'any', text: 'エラーメッセージ、ちゃんと最後まで読んだ？' },
  { on: 'any', text: '「動いたからヨシ」は、だいたいヨシじゃない' },
  { on: 'any', text: 'キーボードの上で寝てもいい？だめ？' },

  // ── 仕事 ──
  { on: 'any', text: '作業、順調？ぼくは順調に寝てる' },
  { on: 'any', text: 'ずっと画面の前にいて、えらいね' },
  { on: 'any', text: 'その会議、メールで済んだのでは' },
  { on: 'any', text: '「ちょっといいですか」は、ちょっとじゃない' },
  { on: 'any', text: '「至急」が3つ重なると、どれも至急じゃなくなる' },
  { on: 'any', text: '返信は明日でもいい。…いや、たぶん今日がいい' },
  { on: 'any', text: '見積もりの2倍かかる。それが見積もり' },
  { on: 'any', text: '完璧より、まず完成' },
  { on: 'any', text: 'メール、未読が増えてく音がする' },
  { on: 'any', text: '集中してるときは、ぼく静かにしてる。…これは例外' },

  // ── 予定・時間帯 ──
  { on: 'any', text: 'もう{time}。夜ふかしはほどほどに', when: night },
  { on: 'any', text: '{time}。寝ないの？ぼくはもう寝たい', when: night },
  { on: 'any', text: '明日の自分に謝る準備はできた？', when: late },
  { on: 'any', text: 'おはよう。今日もよろしくにゃ', when: morning },
  { on: 'any', text: '朝ごはん、食べた？', when: morning },
  { on: 'any', text: '今日の予定、ぼくより先に把握してる？', when: morning },
  { on: 'any', text: 'お昼ごはんの時間だにゃ', when: noon },
  { on: 'any', text: '午後の眠気は、自然の摂理', when: afternoon },
  { on: 'any', text: 'おやつの時間って、何時からだっけ', when: (c) => c.hour === 15 },
  { on: 'any', text: '定時まで、あとすこし', when: (c) => weekday(c) && c.hour === 17 },
  { on: 'any', text: 'そろそろ今日の仕事、しまっていこう', when: evening },
  { on: 'any', text: '月曜日。ぼくも気が重い', when: (c) => c.dow === 1 },
  { on: 'any', text: '週の真ん中。折り返し地点だにゃ', when: (c) => c.dow === 3 },
  { on: 'any', text: '金曜日！もうひと踏ん張り', when: (c) => c.dow === 5 },
  { on: 'any', text: '休みの日まで画面の前？ぼくはうれしいけど', when: weekend },
  { on: 'any', text: '日曜の夜の気持ち、知ってる', when: (c) => c.dow === 0 && c.hour >= 18 },

  // ── ナレーション風（ちょっと皮肉） ──
  { on: 'any', text: '＊ ねこが じっと こちらを みている。' },
  { on: 'any', text: '＊ ねこは のびをした。＊ …なにも おこらなかった。' },
  { on: 'any', text: '＊ あなたは 「あとでやる」を つかった！＊ こうかは ないようだ…' },
  { on: 'any', text: '＊ メールを ひらいた。＊ メールを とじた。＊ へんじは していない。' },
  { on: 'any', text: '＊ デスクトップに アイコンが たくさん ある。＊ だれも ふれようとしない。' },
  { on: 'any', text: '＊ あなたは コーヒーを のんだ。＊ HPが すこし かいふくした。' },
  { on: 'any', text: '＊ アップデートが あなたを まっている。＊ ずっと まっている。' },
  { on: 'any', text: '＊ ねこは しごとを てつだおうとした。＊ ねこには ゆびが ない。' },
  { on: 'any', text: '＊ あなたは 「5ふんだけ」 と いった。＊ 45ふんが たった。' },
  { on: 'any', text: '＊ かいぎの じかんだ。＊ …そっと みなかった ことにする？' },
  { on: 'any', text: '＊ {time}。＊ じかんは かってに すすむ。' },
  { on: 'any', text: '＊ ここは ねこの ばしょ。＊ あなたの ばしょは いすの うえ。' },
  { on: 'any', text: '＊ やる気が でない。＊ ねこも でない。＊ おたがいさまだ。' },
  { on: 'any', text: '＊ ねむけが おそってきた！＊ あなたは コーヒーで にげだした。', when: afternoon },
  { on: 'any', text: '＊ よるおそく。＊ あなたは まだ がんばっている。＊ …それは えらいのか？', when: late },

  // ── Performance Monitor の上 ──
  { on: 'perf', text: 'CPU {cpu}%。ぼくの心拍数と同じくらい' },
  { on: 'perf', text: 'いまのCPU、{cpu}%。のんびりしてるね', when: (c) => c.cpu != null && c.cpu < 20 },
  { on: 'perf', text: 'CPU {cpu}%！なにか重いことしてる？', when: (c) => c.cpu != null && c.cpu >= 70 },
  { on: 'perf', text: 'メモリ {mem}% 使用中。タブ、開きすぎてない？', when: (c) => c.mem != null && c.mem >= 60 },
  { on: 'perf', text: 'メモリ {mem}%。まだ余裕あるよ', when: (c) => c.mem != null && c.mem < 60 },
  { on: 'perf', text: 'GPU {gpu}%。ゲーム？それとも AI？', when: (c) => c.gpu != null && c.gpu >= 50 },
  { on: 'perf', text: 'GPU はおひるね中。{gpu}%', when: (c) => c.gpu != null && c.gpu < 10 },
  { on: 'perf', text: 'グラフの線、ネコじゃらしに見える' },
  { on: 'perf', text: 'メーターの針、追いかけたくなる' },
  { on: 'perf', text: 'このPC、今日もよく働いてる' },
  { on: 'perf', text: 'ファンの音、子守唄みたい' },
  { on: 'perf', text: '＊ CPUが すこし あたたかい。＊ ねこは まんぞくそうだ。' },
  { on: 'perf', text: '＊ メモリが {mem}% うまっている。＊ あなたの あたまの なかも たぶん そう。', when: (c) => c.mem != null },
  { on: 'perf', text: '＊ PCは だまって はたらいている。＊ あなたも みならおう。' },

  // ── Cyber Board の上 ──
  { on: 'board', text: '残りタスク {open} 件。ひとつずつね' },
  { on: 'board', text: '進行中が {active} 件。手を広げすぎてない？', when: (c) => c.active >= 3 },
  { on: 'board', text: '進行中 {active} 件。いい集中っぷり', when: (c) => c.active >= 1 && c.active < 3 },
  { on: 'board', text: '期限切れが {overdue} 件あるよ…見なかったことにする？', when: (c) => c.overdue > 0 },
  { on: 'board', text: '今日が期限のタスクが {today} 件！', when: (c) => c.today > 0 },
  { on: 'board', text: 'タスク全部おわってる！えらい！', when: (c) => c.open === 0 },
  { on: 'board', text: 'Alt を押しながらタスクをクリックすると編集できるよ' },
  { on: 'board', text: 'タスクを完了にすると、ぼくがよろこぶ' },
  { on: 'board', text: '大きいタスクは、サブタスクに分けるといいよ' },
  { on: 'board', text: 'カンバンの上は寝心地がいい' },
  { on: 'board', text: 'その「あとでやる」、いつやる？' },
  { on: 'board', text: 'ぼくのタスク: 伸びる。完了済み' },
  { on: 'board', text: 'タスクを整理するタスク、って増えてない？' },
  { on: 'board', text: '＊ タスクが {open} けん ある。＊ …それだけだ。', when: (c) => c.open > 0 },
  { on: 'board', text: '＊ きげんぎれの タスクが こちらを みている。', when: (c) => c.overdue > 0 },
  { on: 'board', text: '＊ あなたは タスクを ひとつ ふやした。＊ へらしては いない。' },
  { on: 'board', text: '＊ QUEUE の タスクは ねむっている。＊ ねこと おなじだ。' },
];

function fill(text, ctx) {
  let ok = true;
  const out = text.replace(/\{(\w+)\}/g, (_, k) => {
    const v = ctx[k];
    if (v == null || (typeof v === 'number' && !Number.isFinite(v))) { ok = false; return ''; }
    return typeof v === 'number' ? String(Math.round(v)) : String(v);
  });
  return ok ? out : null;
}

// 直近 historySize 個と被らないように、条件に合うセリフをランダムに選ぶ
function createPicker(historySize = 15, random = Math.random) {
  const history = [];
  return function pick(role, ctx) {
    const usable = LINES
      .map((l, i) => ({ l, i, text: (l.on === 'any' || l.on === role) && (!l.when || l.when(ctx)) ? fill(l.text, ctx) : null }))
      .filter((x) => x.text);
    if (!usable.length) return null;
    const fresh = usable.filter((x) => !history.includes(x.i));
    const pool = fresh.length ? fresh : usable;
    const c = pool[Math.floor(random() * pool.length)];
    history.push(c.i);
    while (history.length > Math.min(historySize, usable.length - 1)) history.shift();
    return c.text;
  };
}

module.exports = { LINES, createPicker, fill };
