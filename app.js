'use strict';
/* Speak Up — личный тренажёр английского.
   Уроки в стиле метода с паузой для ответа, интервалами внутри урока и сборкой фразы с конца.
   Все фразы — из нашей базы (data/*.json). */

// ---------- утилиты ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return today(d); };
const spoken = en => en.replace(/\s*\(.*\)\s*$/, '').trim();       // "Whaddya want? (What do you want?)" -> озвучиваем только первую часть
const ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';

const store = {
  get(k, def) { try { const v = localStorage.getItem('su_' + k); return v ? JSON.parse(v) : def; } catch { return def; } },
  set(k, v) { try { localStorage.setItem('su_' + k, JSON.stringify(v)); } catch { /* хранилище недоступно */ } },
};
const S = Object.assign({ mic: true, text: true, rate: 0.95, ruVoice: true, voiceRu: '', voiceA: '', voiceB: '' }, store.get('settings', {}));
const saveSettings = () => store.set('settings', S);
if (!S.micFix) { S.mic = true; S.micFix = 1; saveSettings(); }

// ---------- данные ----------
let DATA = null;           // {core, topics, lessons}
const ITEMS = new Map();   // key(en) -> {en, ru, kind, topic?, verb?}

// шаблоны: конструкция × слова -> готовые пары фраз
function expandPatterns(sets) {
  const fill = (tpl, f) => tpl.replace(/\{(\w+)\}/g, (_, k) => {
    if (k === 'ax') return (/^[aeiou]|^ATM/i.test(f.x) ? 'an ' : 'a ') + f.x;
    if (k === 'Nom') return f.nom[0].toUpperCase() + f.nom.slice(1);
    return f[k] ?? '';
  });
  return sets.map(p => ({ ...p, groups: p.fillers.map(f => ({ label: f.x || f.base, items: p.templates.map(t => ({ en: fill(t.en, f), ru: fill(t.ru, f) })) })) }));
}
async function loadData() {
  const get = f => fetch('data/' + f).then(r => r.json());
  const [core, travel, social, lessons, patterns] = await Promise.all([get('core.json'), get('travel.json'), get('social.json'), get('lessons.json'), get('patterns.json').catch(() => [])]);
  const topics = [...travel, ...social];
  DATA = { core, topics, lessons, patterns: expandPatterns(patterns), topic: id => topics.find(t => t.id === id), verb: v => core.verbs.find(x => x.verb === v) };
  for (const t of topics) for (const [en, ru] of t.say) if (!ITEMS.has(en)) ITEMS.set(en, { en, ru, kind: 'say', topic: t.id });
  for (const t of topics) for (const d of t.dialogs) for (const [who, en, ru] of d.lines) if (who === 'me' && !ITEMS.has(en)) ITEMS.set(en, { en, ru, kind: 'line', topic: t.id });
  for (const p of DATA.patterns) for (const g of p.groups) for (const it of g.items) if (!ITEMS.has(it.en)) ITEMS.set(it.en, { ...it, kind: 'pattern', set: p.id });
  for (const v of core.verbs) v.cells.forEach(([en, ru], i) => { if (!ITEMS.has(en)) ITEMS.set(en, { en, ru, kind: 'core', verb: v.verb, cell: i }); });
}

// ---------- озвучка ----------
const TTS = { en: [], ru: null, A: null, B: null };
function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  const all = speechSynthesis.getVoices();
  const us = all.filter(v => /^en[-_]US/i.test(v.lang));
  const en = us.length ? us : all.filter(v => /^en/i.test(v.lang));
  const rank = v => (/google/i.test(v.name) ? 0 : 2) + (/natural|neural|online/i.test(v.name) ? -1 : 0) + (v.localService ? 0 : 0);
  en.sort((a, b) => rank(a) - rank(b));
  const ru = all.filter(v => /^ru/i.test(v.lang)).sort((a, b) => rank(a) - rank(b));
  const byName = (list, name) => name && list.find(v => v.name === name);
  TTS.en = en; TTS.ruList = ru; TTS.all = all;
  TTS.A = byName(all, S.voiceA) || en[0] || null;
  TTS.B = byName(all, S.voiceB) || en.find(v => v !== TTS.A) || TTS.A;
  TTS.ru = byName(ru, S.voiceRu) || ru[0] || null;
}
if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.onvoiceschanged = () => { loadVoices(); if (TAB === 'settings') viewSettings(); }; }

// короткий сигнал вместо русской подсказки голосом
let AC = null;
function beep() {
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const o = AC.createOscillator(), g = AC.createGain();
    o.frequency.value = 880; g.gain.setValueAtTime(0.0001, AC.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, AC.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + 0.18);
    o.connect(g).connect(AC.destination); o.start(); o.stop(AC.currentTime + 0.2);
  } catch { /* звук недоступен */ }
}

function mkCtx() { const c = { dead: false, reason: null, check() { if (c.dead) throw c.reason; } }; return c; }
function killCtx(c, reason = 'stop') { if (!c || c.dead) return; c.dead = true; c.reason = reason; try { speechSynthesis.cancel(); } catch { } stopRec(); }

function sleep(ms, ctx) {
  return new Promise(res => { const end = Date.now() + ms; const t = setInterval(() => { if (Date.now() >= end || (ctx && ctx.dead)) { clearInterval(t); res(); } }, 80); })
    .then(() => ctx && ctx.check());
}

// lang: 'en' | 'ru'; voice: 'A' | 'B'
function speak(text, o = {}, ctx) {
  const lang = o.lang || 'en';
  if (lang === 'ru' && (!S.ruVoice || !TTS.ru)) {   // подсказка только текстом на экране
    if (o.cue) beep();
    return sleep(Math.max(o.cue ? 1200 : 1500, text.length * (o.cue ? 40 : 55)), ctx);
  }
  if (!('speechSynthesis' in window)) return sleep(1500, ctx);
  return new Promise(res => {
    const u = new SpeechSynthesisUtterance(text);
    if (lang === 'ru') { u.voice = TTS.ru; u.lang = 'ru-RU'; u.rate = 1.05; }
    else {
      const v = o.voice === 'B' ? TTS.B : TTS.A;
      if (v) u.voice = v; u.lang = 'en-US'; u.rate = (o.rate || S.rate);
      if (o.voice === 'B' && TTS.B === TTS.A) u.pitch = 0.8;
    }
    let done = false; const fin = () => { if (!done) { done = true; clearTimeout(t); res(); } };
    u.onend = fin; u.onerror = fin;
    const t = setTimeout(fin, 3000 + text.length * 120 / (u.rate || 1));
    speechSynthesis.speak(u);
  }).then(() => ctx && ctx.check());
}
// примерная длительность английской фразы (сек) и пауза на ответ (мс)
const words = en => spoken(en).split(/\s+/).filter(Boolean).length;
const pauseFor = en => Math.round((words(en) * 0.42 / S.rate) * 1.5 * 1000 + 2200);

// ---------- распознавание речи ----------
const RecAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
let REC = null;
function stopRec() { if (REC) { try { REC.abort(); } catch { } REC = null; } }
function listen(maxMs, ctx) {
  return new Promise(res => {
    if (!RecAPI) return res(null);
    const r = new RecAPI(); REC = r;
    r.lang = 'en-US'; r.interimResults = false; r.maxAlternatives = 5; r.continuous = false;
    let done = false; const fin = v => { if (done) return; done = true; clearTimeout(t); try { r.abort(); } catch { } if (REC === r) REC = null; res(v); };
    r.onresult = e => fin([...e.results[0]].map(a => a.transcript));
    r.onerror = e => fin({ 'not-allowed': 'denied', 'service-not-allowed': 'denied', network: 'network', 'audio-capture': 'busy' }[e.error] || []);
    r.onend = () => fin([]);
    const t = setTimeout(() => fin([]), maxMs);
    try { r.start(); } catch { fin([]); }
  }).then(v => { ctx && ctx.check(); return v; });
}

const CONTR = {
  "i'm": 'i am', "you're": 'you are', "we're": 'we are', "they're": 'they are', "he's": 'he is', "she's": 'she is', "it's": 'it is',
  "that's": 'that is', "what's": 'what is', "where's": 'where is', "there's": 'there is', "here's": 'here is', "how's": 'how is', "who's": 'who is',
  "let's": 'let us', "i'll": 'i will', "you'll": 'you will', "we'll": 'we will', "they'll": 'they will', "he'll": 'he will', "she'll": 'she will',
  "it'll": 'it will', "that'll": 'that will', "i'd": 'i would', "you'd": 'you would', "we'd": 'we would', "i've": 'i have', "you've": 'you have',
  "we've": 'we have', "don't": 'do not', "doesn't": 'does not', "didn't": 'did not', "isn't": 'is not', "aren't": 'are not', "wasn't": 'was not',
  "weren't": 'were not', "can't": 'can not', cannot: 'can not', "couldn't": 'could not', "won't": 'will not', "wouldn't": 'would not',
  "shouldn't": 'should not', "haven't": 'have not', "hasn't": 'has not', gonna: 'going to', wanna: 'want to', gotta: 'got to', gimme: 'give me',
  lemme: 'let me', kinda: 'kind of', dunno: 'do not know', ok: 'okay', "y'all": 'you all', "'cause": 'because', cause: 'because', ya: 'you',
  mr: 'mister', ms: 'miss', "nah": 'no', yep: 'yes', yeah: 'yes',
};
const ONES = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
const TENS = ' ten twenty thirty forty fifty sixty seventy eighty ninety'.split(' ');
function num2w(n) {
  n = +n; if (n < 20) return ONES[n];
  if (n < 100) return TENS[n / 10 | 0] + (n % 10 ? ' ' + ONES[n % 10] : '');
  if (n < 1000) return ONES[n / 100 | 0] + ' hundred' + (n % 100 ? ' ' + num2w(n % 100) : '');
  return String(n).split('').map(d => ONES[d]).join(' ');
}
function tokens(s) {
  const raw = s.toLowerCase().replace(/[’‘`]/g, "'").replace(/[-–—/:]/g, ' ').replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter(Boolean);
  const out = [];
  raw.forEach((w, wi) => {
    w = w.replace(/^'+|'+$/g, '');
    if (!w) return;
    let exp = CONTR[w] || (/^\d+$/.test(w) ? num2w(w) : w);
    exp.split(' ').forEach(t => out.push({ t, wi }));
  });
  return out;
}
// сравнение: доля слов эталона, найденных в услышанном по порядку (LCS)
function compare(expected, heardAlts) {
  const exWords = spoken(expected).split(/\s+/).filter(Boolean);
  const ex = tokens(spoken(expected));
  let best = { score: 0, heard: '', marks: exWords.map(() => false) };
  for (const alt of heardAlts || []) {
    const hd = tokens(alt).map(x => x.t);
    const n = ex.length, m = hd.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
      dp[i][j] = ex[i].t === hd[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const hit = new Array(n).fill(false);
    for (let i = 0, j = 0; i < n && j < m;) {
      if (ex[i].t === hd[j]) { hit[i] = true; i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
    }
    const score = n ? dp[0][0] / n : 0;
    if (score > best.score || !best.heard) {
      const marks = exWords.map((_, wi) => { const ts = ex.map((x, k) => [x, k]).filter(([x]) => x.wi === wi); return ts.length ? ts.every(([, k]) => hit[k]) : true; });
      best = { score, heard: alt, marks };
    }
  }
  return best;
}
const PASS = 0.8;
const MICERR = {
  denied: 'Нет доступа к микрофону. Разреши его для Chrome: Настройки телефона → Приложения → Chrome → Разрешения → Микрофон.',
  network: 'Нет интернета — проверка речи сейчас не работает. Урок продолжается.',
  busy: 'Микрофон занят другим приложением.',
};

// ---------- интервальное повторение (по дням) ----------
const SRS_DAYS = [1, 3, 7, 16, 35, 90];
const srs = () => store.get('srs', {});
function srsUpdate(results) { // results: Map key -> {ok: true|false|null}
  const s = srs(); const t = today();
  for (const [key, r] of results) {
    const e = s[key] || { box: -1, ok: 0, bad: 0 };
    if (r.ok === false) { e.box = 0; e.bad++; e.due = addDays(1); }
    else { e.box = Math.min(e.box + 1, SRS_DAYS.length - 1); e.ok++; e.due = addDays(SRS_DAYS[e.box]); }
    e.last = t; s[key] = e;
  }
  store.set('srs', s);
}
const isDue = e => e && e.due && e.due <= today();
// Каждый проверенный ответ сразу сохраняется.
// Верно с первого раза -> ✓ «известна».
// Ошибка -> ✓ снимается, фраза уходит на доп. повторение (weak).
// Снова ✓ только после верных ответов в 2 разных дня без новых ошибок (контроль).
const FIX_DAYS = 2;
function recordAnswer(key, ok) {
  const s = srs(); const e = s[key] || { box: -1, ok: 0, bad: 0 };
  let status;
  if (!ok) {
    e.known = false; e.weak = true; e.fixDays = []; e.errAt = today(); e.errors = (e.errors || 0) + 1;
    status = 'weak';
  } else if (e.weak) {
    e.fixDays = e.fixDays || [];
    if (!e.fixDays.includes(today())) e.fixDays.push(today());
    if (e.fixDays.length >= FIX_DAYS) { e.weak = false; e.known = true; e.knownAt = today(); status = 'fixed'; }
    else status = 'control';
  } else if (!e.known) { e.known = true; e.knownAt = today(); status = 'new'; }
  else status = 'ok';
  s[key] = e; store.set('srs', s);
  return { status, days: (e.fixDays || []).length };
}
function answerBadge(r) {
  if (!r) return '';
  return {
    weak: ' <span class="verdict no">на доп. повторение</span>',
    control: ` <span class="verdict warn">контроль ${r.days}/${FIX_DAYS} — проверим в другой день</span>`,
    fixed: ' <span class="verdict ok">✓ контроль пройден — выучил</span>',
    new: ' <span class="verdict ok">✓ запомнил</span>',
    ok: '',
  }[r.status];
}

// ---------- прогресс ----------
const prog = () => store.get('progress', { lesson: 0, days: [], history: [] });
function streak() {
  const days = new Set(prog().days); let n = 0; const d = new Date();
  if (!days.has(today(d))) d.setDate(d.getDate() - 1);
  while (days.has(today(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function markDay() { const p = prog(); if (!p.days.includes(today())) p.days.push(today()); store.set('progress', p); }
function updateStreak() { const n = streak(); $('#streak').textContent = n ? `${n} ${plural(n, 'день', 'дня', 'дней')} подряд` : ''; }
function plural(n, a, b, c) { n = Math.abs(n) % 100; const n1 = n % 10; if (n > 10 && n < 20) return c; if (n1 > 1 && n1 < 5) return b; if (n1 === 1) return a; return c; }

// ---------- построение урока ----------
function lessonTitle(L) {
  if (L.title) return L.title;
  if (L.type === 'review') return 'Повторение недели';
  return DATA.topic(L.topic).title;
}
function lessonDialogs(L) {
  if (L.type === 'topic') { const t = DATA.topic(L.topic); const d = t.dialogs[L.dialog ?? 0] || t.dialogs[0]; return d ? [d] : []; }
  if (L.type === 'trip') return L.topics.map(id => DATA.topic(id).dialogs[0]).filter(Boolean);
  return L.topics.slice(0, 2).map(id => { const ds = DATA.topic(id).dialogs; return ds[ds.length - 1]; }).filter(Boolean);
}
const promptWord = en => /\?\s*(\(.*\))?$/.test(en.trim()) ? 'Спроси' : 'Скажи';
function chunksFromEnd(en) {
  const w = spoken(en).split(/\s+/).filter(Boolean);
  if (w.length < 4) return [];
  const step = w.length > 9 ? 3 : 2, out = [];
  for (let k = step; k < w.length; k += step) out.push(w.slice(-k).join(' '));
  return out;
}

function buildLesson(idx) {
  const L = DATA.lessons[idx]; const s = srs(); const steps = []; const used = new Set();
  const P = (item, mode) => { used.add(item.en); return { t: 'prompt', item, mode }; };
  const title = lessonTitle(L);
  steps.push({ t: 'phase', name: 'Начало' }, { t: 'narr', ru: `Урок ${idx + 1}. ${title}.` });

  // какие фразы новые
  const topicIds = L.type === 'topic' ? [L.topic] : L.topics;
  const pool = topicIds.flatMap(id => DATA.topic(id).say.map(([en]) => ITEMS.get(en))).filter(Boolean);
  let fresh = pool.filter(it => !s[it.en]);
  let newItems = [];
  if (L.type === 'topic') {
    newItems = fresh.slice(0, 10);
    if (newItems.length < 5) newItems = [...newItems, ...pool.filter(it => s[it.en]).sort((a, b) => s[a.en].box - s[b.en].box).slice(0, 6 - newItems.length)];
  } else if (L.type === 'review') newItems = fresh.slice(0, 6);
  const newSet = new Set(newItems.map(i => i.en));

  // 1. разогрев — то, что пора повторить
  const weak = [...ITEMS.values()].filter(it => s[it.en] && s[it.en].weak && !newSet.has(it.en))
    .sort((a, b) => (s[b.en].errors || 0) - (s[a.en].errors || 0)).slice(0, 8);
  const due = [...weak, ...[...ITEMS.values()].filter(it => isDue(s[it.en]) && !newSet.has(it.en) && !weak.includes(it))
    .sort((a, b) => s[a.en].due.localeCompare(s[b.en].due)).slice(0, Math.max(4, 10 - weak.length))];
  if (weak.length) {
    steps.push({ t: 'phase', name: 'Доп. повтор' }, { t: 'narr', ru: 'Сначала фразы, в которых были ошибки.' });
    weak.forEach(it => steps.push(P(it, 'weak')));
  }
  const dueRest = due.filter(it => !weak.includes(it));
  if (dueRest.length) {
    steps.push({ t: 'phase', name: 'Разогрев' }, { t: 'narr', ru: 'Вспомним то, что уже учили.' });
    dueRest.forEach(it => steps.push(P(it, 'review')));
  }

  // 2. сценка
  const dialogs = lessonDialogs(L);
  if (dialogs.length) {
    steps.push({ t: 'phase', name: 'Сценка' }, { t: 'narr', ru: 'Послушай разговор. Если понятно не всё — это нормально.' });
    dialogs.forEach(d => d.lines.forEach(([who, en, ru]) => steps.push({ t: 'line', who, en, ru })));
  }

  // 3+4. новые фразы с интервалами внутри урока; ядро и старые фразы — заполнители между повторами
  const verb = DATA.verb(L.verb);
  const coreItems = verb ? verb.cells.map(([en]) => ITEMS.get(en)) : [];
  let recall = [];
  const boxOf = it => s[it.en] ? s[it.en].box : -1;
  if (L.type !== 'topic') recall = shuffle(pool.filter(it => !newSet.has(it.en) && !due.includes(it))).sort((a, b) => boxOf(a) - boxOf(b)).slice(0, L.type === 'trip' ? 16 : 10);
  const patItems = shuffle((DATA.patterns || []).filter(p => topicIds.some(id => p.topics.includes(id))).flatMap(p => p.groups.flatMap(g => g.items))).slice(0, 4).map(it => ITEMS.get(it.en));
  const older = shuffle([...ITEMS.values()].filter(it => it.kind === 'say' && s[it.en] && !newSet.has(it.en) && !due.includes(it) && !recall.includes(it))).slice(0, 4);
  const fillers = [];
  const ci = shuffle(coreItems), rc = shuffle(recall), ol = [...older, ...patItems];
  while (ci.length || rc.length || ol.length) { if (rc.length) fillers.push(rc.shift()); if (ci.length) fillers.push(ci.shift()); if (rc.length) fillers.push(rc.shift()); if (ol.length) fillers.push(ol.shift()); }

  if (newItems.length || fillers.length) {
    steps.push({ t: 'phase', name: newItems.length ? 'Новые фразы' : 'Вспоминаем' });
    if (verb) steps.push({ t: 'narr', ru: `Между новыми фразами — глагол ${verb.verb}: настоящее, прошедшее и будущее.` });
    const gaps = [1, 3, 10, 30];
    const pending = []; let ni = 0, fi = 0, k = 0;
    while (ni < newItems.length || pending.length) {
      pending.sort((a, b) => a.due - b.due);
      if (pending.length && pending[0].due <= k) {
        const p = pending.shift(); steps.push(P(p.item, 'recall')); k++;
        if (p.stage + 1 < gaps.length) pending.push({ item: p.item, due: k + gaps[p.stage + 1], stage: p.stage + 1 });
        continue;
      }
      if (ni < newItems.length) {
        const it = newItems[ni++];
        used.add(it.en); steps.push({ t: 'intro', item: it }); k++;
        pending.push({ item: it, due: k + gaps[0], stage: 0 });
        continue;
      }
      if (fi < fillers.length) { steps.push(P(fillers[fi++], 'filler')); k++; }
      else if (pending.length) k = pending[0].due;
    }
    while (fi < fillers.length) steps.push(P(fillers[fi++], 'filler'));
  }

  // 5. сборка — всё вперемешку
  const mix = shuffle([...newItems, ...shuffle(coreItems).slice(0, 3)]);
  if (mix.length) {
    steps.push({ t: 'phase', name: 'Сборка' }, { t: 'narr', ru: 'Теперь всё вперемешку. Отвечай быстро.' });
    mix.forEach(it => steps.push(P(it, 'final')));
  }

  // 6. твоя роль
  if (dialogs.length) {
    steps.push({ t: 'phase', name: 'Твоя роль' }, { t: 'narr', ru: 'Теперь разговор с тобой. Твои реплики — в паузах.' });
    dialogs.forEach(d => d.lines.forEach(([who, en, ru]) => steps.push(who === 'me' ? { t: 'role', en, ru } : { t: 'line', who, en, ru })));
  }
  steps.push({ t: 'phase', name: 'Конец' }, { t: 'narr', ru: 'Урок окончен. Отличная работа!' });
  return { idx, L, title, steps, used };
}
function estimateMin(lesson) {
  let sec = 0;
  for (const st of lesson.steps) {
    const w = st.item ? words(st.item.en) : st.en ? words(st.en) : 0;
    if (st.t === 'narr') sec += st.ru.length / 13;
    else if (st.t === 'prompt' || st.t === 'role') sec += 2.5 + pauseFor(st.item ? st.item.en : st.en) / 1000 + w * 0.42;
    else if (st.t === 'intro') { const ch = chunksFromEnd(st.item.en); sec += 6 + w * 0.42 * 3.3 + pauseFor(st.item.en) / 1000 + ch.reduce((a, c) => a + words(c) * 0.42 + pauseFor(c) / 1000, 0); }
    else if (st.t === 'rep') sec += w * 0.42 + pauseFor(st.en) / 1000;
    else if (st.t === 'line') sec += w * 0.42 + 0.5;
  }
  return Math.max(1, Math.round(sec / 60));
}

// ---------- проигрывание урока ----------
let RUN = null; // {ctx, paused, lesson, i, results, checked, okCount}
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* необязательно */ }
}
document.addEventListener('visibilitychange', () => { if (RUN && document.visibilityState === 'visible') keepAwake(true); });

function stopAll() {
  if (RUN) { saveRun(RUN); RUN.stopped = true; killCtx(RUN.ctx, 'stop'); RUN = null; keepAwake(false); }
  if (AUX) { killCtx(AUX, 'stop'); AUX = null; }
}
let AUX = null; // контекст для разделов вне урока

function playerHTML(lesson) {
  return `<div class="card player" id="player">
    <div class="phase"><span id="pPhase">Начало</span><span id="pCount"></span></div>
    <div class="bar"><i id="pBar"></i></div>
    <div class="state" id="pState"><span class="dot"></span><span id="pStateTx">Готовлюсь…</span></div>
    <div class="prompt-ru" id="pRu"></div>
    <div class="answer-en" id="pEn"></div>
    <div class="heard" id="pHeard"></div>
    <div class="row">
      <button class="btn" id="pPause">Пауза</button>
      <button class="btn" id="pSkip">Дальше</button>
      <span class="spacer"></span>
      <button class="btn ghost" id="pStop">Выйти</button>
    </div>
  </div>
  <div class="note">${S.mic && RecAPI ? 'Отвечай вслух — приложение слушает и проверяет. Если распознавание ошиблось, не страшно: главное — сказать.' : 'Режим без проверки: отвечай вслух в паузах, потом сверяйся с диктором.'} Экран не гаснет во время урока.</div>
  <h3>${h(lesson.title)} · ${lesson.L.type === 'topic' ? 'тема' : lesson.L.type === 'trip' ? 'поездка' : 'повторение'}</h3>`;
}
function setState(kind, tx) { const el = $('#pState'); if (!el) return; el.className = 'state ' + kind; $('#pStateTx').textContent = tx; }
function showEn(en, marks, force) {
  const el = $('#pEn'); if (!el) return;
  if (!S.text && !force) { el.textContent = ''; return; }
  const w = en.split(/\s+/);
  el.innerHTML = marks ? w.map((x, i) => `<span class="w ${marks[i] ? 'ok' : 'no'}">${h(x)}</span>`).join('') : h(en);
}

const isCheck = st => st.t === 'prompt' || st.t === 'role' || st.t === 'intro';
// незаконченный урок хранится в телефоне: шаги, позиция и результаты — можно продолжить с того же места
function saveRun(run) {
  if (!run || run.finished) return;
  const { lesson } = run;
  store.set('run', { idx: lesson.idx, title: lesson.title, steps: lesson.steps, i: run.i, results: [...run.results], checked: run.checked, ok: run.ok, date: today() });
}
const savedRun = () => { const r = store.get('run', null); return r && r.steps && r.i < r.steps.length ? r : null; };
const clearRun = () => store.set('run', null);
window.addEventListener('pagehide', () => saveRun(RUN));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveRun(RUN); });

async function startLesson(idx, resume) {
  stopAll();
  const saved = resume ? savedRun() : null;
  const lesson = saved ? { idx: saved.idx, L: DATA.lessons[saved.idx], title: saved.title, steps: saved.steps } : buildLesson(idx);
  $('#view').innerHTML = playerHTML(lesson);
  const run = RUN = { ctx: null, paused: false, lesson, i: saved ? saved.i : 0, results: new Map(saved ? saved.results : []),
    checked: saved ? saved.checked : 0, ok: saved ? saved.ok : 0, stopped: false };
  saveRun(run);
  keepAwake(true);
  $('#pPause').onclick = () => {
    run.paused = !run.paused; $('#pPause').textContent = run.paused ? 'Продолжить' : 'Пауза';
    if (run.paused) { run.repeat = true; killCtx(run.ctx, 'skip'); setState('', 'Пауза'); saveRun(run); }
  };
  $('#pSkip').onclick = () => { run.repeat = false; killCtx(run.ctx, 'skip'); };
  $('#pStop').onclick = () => { saveRun(run); stopAll(); render('lesson'); };

  const steps = lesson.steps;
  let total = steps.filter(isCheck).length; let done = steps.slice(0, run.i).filter(isCheck).length;
  if (run.i > 0) { // восстановить название части урока
    const ph = steps.slice(0, run.i).reverse().find(s => s.t === 'phase'); if (ph) $('#pPhase').textContent = ph.name;
    $('#pBar').style.width = (100 * run.i / steps.length) + '%'; $('#pCount').textContent = `${done} / ${total}`;
    $('#pRu').textContent = 'Продолжаем с того же места.';
  }
  while (run.i < steps.length && !run.stopped) {
    while (run.paused && !run.stopped) await new Promise(r => setTimeout(r, 150));
    if (run.stopped) return;
    const st = steps[run.i]; const ctx = run.ctx = mkCtx(); run.repeat = false;
    try {
      await runStep(st, ctx, run);
      if (isCheck(st)) done++;
      run.i++;
    } catch (e) {
      if (e === 'stop' || run.stopped) return;
      if (e === 'skip' && !run.repeat) { if (isCheck(st)) done++; run.i++; }
      else if (e !== 'skip') { console.error(e); run.i++; }
    }
    if (!run.stopped) saveRun(run);
    total = steps.filter(isCheck).length;
    const bar = $('#pBar'); if (bar) bar.style.width = (100 * run.i / steps.length) + '%';
    const cnt = $('#pCount'); if (cnt) cnt.textContent = `${done} / ${total}`;
  }
  if (run.stopped) return;
  run.finished = true; clearRun();
  finishLesson(run);
}

// ждём речь, проверяем; если сказано верно — сразу записываем фразу как известную
// после ошибки — ещё два повтора этой фразы позже в этом же уроке (через ~3 и ~8 шагов)
function addFixSteps(run, item) {
  if (!run.lesson) return;
  run.fixes = run.fixes || {};
  if ((run.fixes[item.en] || 0) >= 2) return;
  run.fixes[item.en] = (run.fixes[item.en] || 0) + 1;
  const steps = run.lesson.steps; let pos = run.i + 1, checks = 0;
  const insertAfter = n => { while (pos < steps.length && checks < n) { if (isCheck(steps[pos])) checks++; pos++; } steps.splice(pos, 0, { t: 'prompt', item, mode: 'fix' }); pos++; };
  insertAfter(3); checks = 0; insertAfter(5);
}
async function checkAnswer(en, item, mode, run, ctx, isNew) {
  const heard = $('#pHeard');
  let res = null;
  if (S.mic && RecAPI) {
    setState('mic', 'Говори!');
    const alts = await listen(pauseFor(en) + 2500, ctx);
    if (typeof alts === 'string') heard.innerHTML = `<span class="verdict no">${MICERR[alts]}</span>`;
    else if (alts) res = compare(en, alts);
  } else { setState('you', 'Скажи вслух'); await sleep(pauseFor(en), ctx); }
  if (res) {
    const ok = res.score >= PASS;
    const rec = item ? recordAnswer(en, ok) : null;
    heard.innerHTML = (res.heard
      ? `Ты сказал: «${h(res.heard)}» <span class="verdict ${ok ? 'ok' : 'no'}">${Math.round(res.score * 100)}%</span>`
      : '<span class="verdict no">Не расслышал</span>') + answerBadge(rec);
    if (!ok && item) addFixSteps(run, item);
    showEn(en, res.marks, isNew);
    run.checked++; if (ok) run.ok++;
    if (item) {
      const prev = run.results.get(en);
      const val = (mode === 'final' || mode === 'review' || mode === 'weak') ? ok : (prev && prev.ok === false ? false : ok);
      run.results.set(en, { ok: val });
    }
    setState('speak', ok ? 'Верно' : 'Послушай правильно');
    await speak(spoken(en), {}, ctx);
    if (!ok) { setState('you', 'Повтори'); await sleep(pauseFor(en), ctx); }
  } else {
    showEn(en, null, isNew); setState('speak', 'Правильно так');
    if (item && !run.results.has(en)) run.results.set(en, { ok: null });
    await speak(spoken(en), {}, ctx);
  }
  await sleep(350, ctx);
  return res ? res.score >= PASS : null;
}

async function runStep(st, ctx, run) {
  const ru = $('#pRu'), heard = $('#pHeard');
  switch (st.t) {
    case 'phase': $('#pPhase').textContent = st.name; return;
    case 'narr':
      ru.textContent = st.ru; showEn(''); heard.textContent = ''; setState('speak', 'Слушай');
      await speak(st.ru, { lang: 'ru' }, ctx); return;
    case 'intro': {
      // «Как сказать: …» → подсказка (английский + русский на экране) → по частям для длинных → ты говоришь → проверка
      const it = st.item, en = it.en;
      ru.textContent = it.ru; showEn(''); heard.textContent = ''; setState('speak', 'Новая фраза');
      await speak('Как сказать: ' + spoken(it.ru), { lang: 'ru', cue: true }, ctx);
      setState('speak', 'Подсказка'); showEn(en, null, true);
      await speak(spoken(en), {}, ctx); await sleep(400, ctx);
      await speak(spoken(en), { rate: S.rate * 0.75 }, ctx);
      const ch = chunksFromEnd(en);
      for (const c of ch) {
        setState('speak', 'По частям'); showEn(c, null, true);
        await speak(c, { rate: S.rate * 0.9 }, ctx);
        setState('you', 'Повтори'); await sleep(pauseFor(c), ctx);
      }
      showEn(en, null, true);
      await speak('Теперь скажи сам.', { lang: 'ru', cue: true }, ctx);
      await checkAnswer(en, it, 'first', run, ctx, true);
      return;
    }
    case 'rep':
      showEn(st.en); heard.textContent = ''; setState('speak', 'Слушай');
      await speak(st.en, { rate: S.rate * 0.9 }, ctx);
      setState('you', 'Повтори'); await sleep(pauseFor(st.en), ctx); return;
    case 'line':
      ru.textContent = st.ru; showEn(st.en); heard.textContent = ''; setState('speak', st.who === 'me' ? 'Ты' : 'Собеседник');
      await speak(spoken(st.en), { voice: st.who === 'me' ? 'A' : 'B' }, ctx); await sleep(250, ctx); return;
    case 'prompt': case 'role': {
      const en = st.item ? st.item.en : st.en, ruTx = st.item ? st.item.ru : st.ru;
      const label = st.t === 'role' ? 'Твоя реплика' : st.item.kind === 'core' ? `Ядро · ${st.item.verb}` : st.item.kind === 'pattern' ? 'Шаблон' : { review: 'Повторение', first: 'Новая фраза', recall: 'Вспомни', filler: 'Вспомни', final: 'Сборка', fix: 'Доп. повтор', weak: 'Доп. повтор' }[st.mode];
      ru.textContent = ruTx; showEn(''); heard.textContent = ''; setState('speak', label);
      await speak(`${promptWord(en)}: ${spoken(ruTx)}`, { lang: 'ru', cue: true }, ctx);
      await checkAnswer(en, st.item, st.mode, run, ctx, false);
      return;
    }
  }
}

function finishLesson(run) {
  keepAwake(false);
  const { lesson } = run; RUN = null;
  srsUpdate(run.results);
  const score = run.checked ? run.ok / run.checked : 1;
  const pass = score >= PASS;
  const p = prog();
  p.history.push({ date: today(), lesson: lesson.idx, score: Math.round(score * 100), checked: run.checked });
  if (pass && lesson.idx === p.lesson) p.lesson = Math.min(p.lesson + 1, DATA.lessons.length);
  if (!p.days.includes(today())) p.days.push(today());
  store.set('progress', p); updateStreak();
  $('#view').innerHTML = `<div class="card hero">
      <div class="eyebrow">Урок ${lesson.idx + 1} окончен</div>
      <h1>${run.checked ? Math.round(score * 100) + '% верно' : 'Готово'}</h1>
      <div class="muted">${!run.checked ? 'Урок шёл без проверки микрофоном, поэтому засчитан. Фразы попадут в повторение.' :
      pass ? 'Отлично! Следующий урок открыт. Фразы разложены по повторению.' : 'Меньше 80% — завтра повтори этот урок. Так фразы закрепятся надёжнее.'}</div>
      <div class="muted small">Фраз в уроке: ${run.results.size}. Проверено ответов: ${run.checked}.</div>
      <button class="btn primary big" id="doneBtn">К урокам</button>
    </div>
    <div class="note">Есть ещё 10 минут? Открой «Слух» и «Диалоги» — там быстрая речь носителей и разговор с проверкой.</div>`;
  $('#doneBtn').onclick = () => render('lesson');
}

// ---------- экран «Урок» ----------
function lessonStatus(i, p) { return i < p.lesson ? 'done' : i === p.lesson ? 'now' : ''; }
function viewLesson() {
  const p = prog(), N = DATA.lessons.length, idx = Math.min(p.lesson, N - 1);
  const L = DATA.lessons[idx], lesson = buildLesson(idx), s = srs(), sr = savedRun();
  const learned = Object.values(s).filter(e => e.known).length;
  const dueN = Object.values(s).filter(isDue).length;
  const weakN = Object.values(s).filter(e => e.weak).length;
  const goal = L.type === 'topic' ? DATA.topic(L.topic).goal : L.type === 'trip' ? 'Сквозная поездка: все фразы этих тем вперемешку и разговоры за тебя.' : 'Повторяем фразы недели, добираем пропущенные и играем диалоги.';
  const last = p.history[p.history.length - 1];
  const repeat = last && last.lesson === idx && last.score < 80 && last.checked;
  $('#view').innerHTML = `
    <div class="card hero">
      <div class="eyebrow">${p.lesson >= N ? 'Курс пройден · повтор' : `Неделя ${L.week} · урок ${idx + 1} из ${N}`}</div>
      <h1>${h(lessonTitle(L))}</h1>
      <div class="muted">${h(goal)}</div>
      ${repeat ? `<div class="muted small">Прошлый раз ${last.score}% — повторяем этот урок.</div>` : ''}
      <div class="bar"><i style="width:${100 * Math.min(p.lesson, N) / N}%"></i></div>
      ${sr ? `<button class="btn primary big" id="resumeBtn">${ICON_PLAY.replace('<svg', '<svg width="20" height="20" fill="currentColor"')} Продолжить урок ${sr.idx + 1} · ${Math.round(100 * sr.i / sr.steps.length)}%</button>
        <button class="btn ghost" id="startBtn">${sr.idx === idx ? 'Начать этот урок заново' : `Начать урок ${idx + 1} · ~${estimateMin(lesson)} мин`}</button>`
      : `<button class="btn primary big" id="startBtn">${ICON_PLAY.replace('<svg', '<svg width="20" height="20" fill="currentColor"')} Начать урок · ~${estimateMin(lesson)} мин</button>`}
      <label class="toggle"><input type="checkbox" id="optMic" ${S.mic && RecAPI ? 'checked' : ''} ${RecAPI ? '' : 'disabled'}> Проверять ответы микрофоном</label>
      <label class="toggle"><input type="checkbox" id="optText" ${S.text ? 'checked' : ''}> Показывать английский текст</label>
      ${RecAPI ? '' : '<div class="muted small">В этом браузере нет распознавания речи. На Android открой в Chrome.</div>'}
    </div>
    <div class="stats">
      <div class="stat"><b>${streak()}</b><span>дней подряд</span></div>
      <div class="stat"><b>${learned}</b><span>фраз известно</span></div>
      <div class="stat"><b>${weakN}</b><span>на доп. повторе</span></div>
    </div>
    <div class="card">
      <h3>Все уроки</h3>
      <div class="list">${DATA.lessons.map((x, i) => `<div class="topic-row" data-l="${i}">
        <div><b>${i + 1}. ${h(lessonTitle(x))}</b><div class="muted small">Неделя ${x.week} · глагол ${h(x.verb)}</div></div>
        <span class="pill ${lessonStatus(i, p)}">${{ done: 'пройден', now: 'сейчас', '': x.type === 'review' ? 'повтор' : x.type === 'trip' ? 'поездка' : 'тема' }[lessonStatus(i, p)]}</span></div>`).join('')}</div>
    </div>`;
  $('#startBtn').onclick = () => startLesson(idx);
  if (sr) $('#resumeBtn').onclick = () => startLesson(sr.idx, true);
  $('#optMic').onchange = e => { S.mic = e.target.checked; saveSettings(); };
  $('#optText').onchange = e => { S.text = e.target.checked; saveSettings(); };
  $$('[data-l]').forEach(el => el.onclick = () => startLesson(+el.dataset.l));
}

// ---------- экран «Настройки» ----------
let resetAsk = false;
function voiceOptions(list, cur) {
  if (!list.length) return '<option value="">Голосов не найдено</option>';
  return list.map(v => `<option value="${h(v.name)}" ${cur && v.name === cur.name ? 'selected' : ''}>${h(v.name)}${v.localService ? '' : ' · онлайн'}</option>`).join('');
}
function viewSettings() {
  const enList = TTS.en || [], ruList = TTS.ruList || [];
  $('#view').innerHTML = `<div><h1>Настройки</h1><div class="muted">Сохраняются на этом телефоне.</div></div>
    <div class="card">
      <h3>Голоса</h3>
      <div class="field"><label for="vRu">Русские подсказки</label>
        <div class="row"><select id="vRu">${voiceOptions(ruList, TTS.ru)}</select><button class="btn sm" data-test="ru">Слушать</button></div></div>
      <label class="toggle"><input type="checkbox" id="sRuVoice" ${S.ruVoice ? 'checked' : ''}> Русские подсказки голосом</label>
      <div class="muted small">Если выключить: подсказка показывается на экране, звучит короткий сигнал, а по-английски по-прежнему говорит диктор.</div>
      <div class="field"><label for="vA">Английский диктор (ты)</label>
        <div class="row"><select id="vA">${voiceOptions(enList, TTS.A)}</select><button class="btn sm" data-test="A">Слушать</button></div></div>
      <div class="field"><label for="vB">Английский собеседник</label>
        <div class="row"><select id="vB">${voiceOptions(enList, TTS.B)}</select><button class="btn sm" data-test="B">Слушать</button></div></div>
      <div class="note">Голосов мало или звучат плохо? В Android: Настройки → Синтез речи → «Синтезатор речи Google» → ⚙ → Установка голосовых данных. Скачай «Русский» и «Английский (США)», потом перезапусти приложение. Голоса с пометкой «онлайн» обычно звучат лучше, но нужен интернет.</div>
    </div>
    <div class="card">
      <h3>Урок</h3>
      <div class="row"><span class="muted small">Скорость диктора</span>${[0.8, 0.95, 1.1].map(r => `<button class="chip ${S.rate === r ? 'on' : ''}" data-rate="${r}">${r === 0.8 ? 'медленно' : r === 0.95 ? 'обычно' : 'быстро'}</button>`).join('')}</div>
      <label class="toggle"><input type="checkbox" id="sMic" ${S.mic && RecAPI ? 'checked' : ''} ${RecAPI ? '' : 'disabled'}> Проверять ответы микрофоном</label>
      <label class="toggle"><input type="checkbox" id="sText" ${S.text ? 'checked' : ''}> Показывать английский текст</label>
    </div>
    <div class="card">
      <h3>Прогресс</h3>
      ${resetAsk ? `<div>Удалить весь прогресс и повторения? Это нельзя отменить.</div>
        <div class="row"><button class="btn danger" id="resetYes">Да, удалить</button><button class="btn" id="resetNo">Отмена</button></div>`
      : '<button class="btn danger" id="reset">Сбросить прогресс</button>'}
    </div>`;
  const pick = (sel, key) => { $(sel).onchange = e => { S[key] = e.target.value; saveSettings(); loadVoices(); }; };
  pick('#vRu', 'voiceRu'); pick('#vA', 'voiceA'); pick('#vB', 'voiceB');
  $$('[data-test]').forEach(b => b.onclick = () => {
    stopAll(); AUX = mkCtx(); const w = b.dataset.test;
    (w === 'ru' ? speak('Скажи: где здесь туалет?', { lang: 'ru', cue: true }, AUX) : speak(w === 'A' ? 'Hi! Can I get a coffee, please?' : 'Sure. What size?', { voice: w }, AUX)).catch(() => { });
  });
  $('#sRuVoice').onchange = e => { S.ruVoice = e.target.checked; saveSettings(); };
  $('#sMic').onchange = e => { S.mic = e.target.checked; saveSettings(); };
  $('#sText').onchange = e => { S.text = e.target.checked; saveSettings(); };
  $$('[data-rate]').forEach(el => el.onclick = () => { S.rate = +el.dataset.rate; saveSettings(); viewSettings(); });
  if (resetAsk) {
    $('#resetYes').onclick = () => { store.set('srs', {}); store.set('progress', { lesson: 0, days: [], history: [] }); resetAsk = false; updateStreak(); viewSettings(); };
    $('#resetNo').onclick = () => { resetAsk = false; viewSettings(); };
  } else $('#reset').onclick = () => { resetAsk = true; viewSettings(); };
}

// ---------- экран «Слух» ----------
const LS = { topic: null, i: 0, speed: 1.0, shown: false };
function hearItems(id) {
  if (id === 'all') return DATA.topics.flatMap(t => t.hear.map(([en, ru]) => ({ en, ru, t: t.title })));
  const t = DATA.topic(id); return t.hear.map(([en, ru]) => ({ en, ru, t: t.title }));
}
function viewListen() {
  if (!LS.topic) LS.topic = 'survival';
  const items = hearItems(LS.topic); if (LS.i >= items.length) LS.i = 0;
  const it = items[LS.i];
  $('#view').innerHTML = `
    <div><h1>Слух</h1><div class="muted">Так говорят тебе. Слушай без текста, скажи вслух, что это значит, потом проверь.</div></div>
    <div class="chips">${[['all', 'Всё вперемешку'], ...DATA.topics.map(t => [t.id, t.title])].map(([id, tt]) => `<button class="chip ${LS.topic === id ? 'on' : ''}" data-t="${id}">${h(tt)}</button>`).join('')}</div>
    <div class="card">
      <div class="phase"><span>${h(it.t)}</span><span>${LS.i + 1} / ${items.length}</span></div>
      <button class="btn primary big" id="hPlay">${ICON_PLAY.replace('<svg', '<svg width="20" height="20" fill="currentColor"')} Слушать</button>
      <div class="stack" style="min-height:70px">${LS.shown ? `<div class="answer-en">${h(it.en)}</div><div class="prompt-ru" style="min-height:0">${h(it.ru)}</div>` : '<div class="muted">Текст скрыт. Сначала попробуй понять на слух.</div>'}</div>
      <div class="row">
        <button class="btn" id="hShow">${LS.shown ? 'Скрыть' : 'Показать'}</button>
        <span class="spacer"></span>
        <button class="btn" id="hPrev">Назад</button>
        <button class="btn" id="hNext">Дальше</button>
      </div>
      <div class="row"><span class="muted small">Скорость</span>${[0.8, 1.0, 1.2, 1.4].map(r => `<button class="chip ${LS.speed === r ? 'on' : ''}" data-sp="${r}">${r.toFixed(1)}</button>`).join('')}</div>
      <button class="btn ghost" id="hAuto">Автоматически по кругу</button>
    </div>`;
  const play = () => { stopAll(); AUX = mkCtx(); speak(spoken(it.en), { rate: LS.speed, voice: Math.random() < .5 ? 'A' : 'B' }, AUX).catch(() => { }); };
  $('#hPlay').onclick = play;
  $('#hShow').onclick = () => { LS.shown = !LS.shown; viewListen(); };
  $('#hNext').onclick = () => { stopAll(); LS.i = (LS.i + 1) % items.length; LS.shown = false; viewListen(); };
  $('#hPrev').onclick = () => { stopAll(); LS.i = (LS.i - 1 + items.length) % items.length; LS.shown = false; viewListen(); };
  $$('[data-t]').forEach(el => el.onclick = () => { stopAll(); LS.topic = el.dataset.t; LS.i = 0; LS.shown = false; if (LS.topic === 'all') LS.i = Math.random() * hearItems('all').length | 0; viewListen(); });
  $$('[data-sp]').forEach(el => el.onclick = () => { LS.speed = +el.dataset.sp; viewListen(); });
  $('#hAuto').onclick = () => autoListen(items);
}
async function autoListen(items) {
  stopAll(); const ctx = AUX = mkCtx();
  try {
    while (true) {
      const it = items[LS.i]; LS.shown = false; viewListen(); $('#hAuto').textContent = 'Остановить'; $('#hAuto').onclick = () => { stopAll(); viewListen(); };
      AUX = ctx;
      await speak(spoken(it.en), { rate: LS.speed, voice: 'B' }, ctx); await sleep(3500, ctx);
      LS.shown = true; viewListen(); $('#hAuto').textContent = 'Остановить'; $('#hAuto').onclick = () => { stopAll(); viewListen(); }; AUX = ctx;
      await speak(it.ru, { lang: 'ru' }, ctx); await speak(spoken(it.en), { rate: LS.speed, voice: 'B' }, ctx); await sleep(1500, ctx);
      LS.i = (LS.i + 1) % items.length;
    }
  } catch { /* остановлено */ }
}

// ---------- экран «Диалоги» ----------
const DS = { open: null, hide: false, speed: 1.0, result: null };
function viewDialogs() {
  if (!DS.open) {
    const group = (cat, name) => `<div class="card"><h3>${name}</h3><div class="list">${DATA.topics.filter(t => t.cat === cat).flatMap(t => t.dialogs.map((d, di) =>
      `<div class="topic-row" data-d="${t.id}:${di}"><div><b>${h(d.title)}</b><div class="muted small">${h(t.title)} · ${d.lines.length} реплик, твоих ${d.lines.filter(l => l[0] === 'me').length}</div></div><span class="pill">${ICON_PLAY.replace('<svg', '<svg width="12" height="12" fill="currentColor"')}</span></div>`)).join('')}</div></div>`;
    $('#view').innerHTML = `<div><h1>Диалоги</h1><div class="muted">Разговоры из поездок. Сначала послушай, потом сыграй свою роль — приложение проверит произношение.</div></div>
      ${group('travel', 'Путешествия')}${group('social', 'Общение')}`;
    $$('[data-d]').forEach(el => el.onclick = () => { const [t, di] = el.dataset.d.split(':'); DS.open = { t, di: +di }; DS.result = null; viewDialogs(); });
    return;
  }
  const t = DATA.topic(DS.open.t), d = t.dialogs[DS.open.di];
  $('#view').innerHTML = `<button class="back" id="dBack">← Все диалоги</button>
    <div><div class="eyebrow" style="color:var(--muted)">${h(t.title)}</div><h1>${h(d.title)}</h1></div>
    <div class="card">
      <div class="row"><button class="btn primary" id="dListen">Слушать</button><button class="btn primary" id="dRole">Моя роль</button><span class="spacer"></span><button class="btn ghost sm" id="dStop">Стоп</button></div>
      <div class="row"><span class="muted small">Скорость</span>${[0.8, 1.0, 1.2].map(r => `<button class="chip ${DS.speed === r ? 'on' : ''}" data-sp="${r}">${r.toFixed(1)}</button>`).join('')}</div>
      <label class="toggle"><input type="checkbox" id="dHide" ${DS.hide ? 'checked' : ''}> Скрыть текст (тренировка слуха)</label>
      ${!RecAPI ? '<div class="muted small">Проверка речи доступна в Chrome на Android.</div>' : ''}
      <div id="dRes">${DS.result ? `<span class="verdict ${DS.result.ok / DS.result.n >= PASS ? 'ok' : 'no'}">Засчитано ${DS.result.ok} из ${DS.result.n}</span>` : ''}</div>
    </div>
    <div class="card ${DS.hide ? 'hidetext' : ''}" id="dLines"><div class="list">${d.lines.map(([who, en, ru], i) => `<div class="ph ${who === 'me' ? 'me' : ''}" data-i="${i}">
      <button class="play" aria-label="Озвучить">${ICON_PLAY}</button>
      <div class="tx"><div class="who">${who === 'me' ? 'Ты' : 'Собеседник'}</div><div class="en">${h(en)}</div><div class="ru">${h(ru)}</div><div class="heard small" data-hd="${i}"></div></div></div>`).join('')}</div></div>`;
  $('#dBack').onclick = () => { stopAll(); DS.open = null; viewDialogs(); };
  $('#dStop').onclick = () => stopAll();
  $('#dHide').onchange = e => { DS.hide = e.target.checked; $('#dLines').classList.toggle('hidetext', DS.hide); };
  $$('[data-sp]').forEach(el => el.onclick = () => { DS.speed = +el.dataset.sp; viewDialogs(); });
  $$('#dLines .ph').forEach(el => el.onclick = e => {
    const i = +el.dataset.i, [who, en] = d.lines[i];
    if (DS.hide && !e.target.closest('.play')) { el.classList.toggle('revealed'); return; }
    stopAll(); AUX = mkCtx(); speak(spoken(en), { rate: DS.speed, voice: who === 'me' ? 'A' : 'B' }, AUX).catch(() => { });
  });
  $('#dListen').onclick = () => runDialog(d, false);
  $('#dRole').onclick = () => runDialog(d, true);
}
async function runDialog(d, role) {
  stopAll(); const ctx = AUX = mkCtx(); keepAwake(true);
  const rows = $$('#dLines .ph'); let ok = 0, n = 0;
  rows.forEach(r => { r.classList.remove('active', 'revealed'); }); $$('[data-hd]').forEach(x => x.innerHTML = '');
  try {
    for (let i = 0; i < d.lines.length; i++) {
      const [who, en] = d.lines[i]; const row = rows[i];
      rows.forEach(r => r.classList.remove('active')); row.classList.add('active'); row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (role && who === 'me') {
        n++; const hd = $(`[data-hd="${i}"]`);
        row.querySelector('.en').style.visibility = 'hidden';
        if (DS.hide) row.querySelector('.ru').style.filter = 'none';
        let res = null;
        if (S.mic && RecAPI) { hd.innerHTML = '<span class="verdict no">● говори</span>'; const alts = await listen(pauseFor(en) + 3000, ctx); if (typeof alts === 'string') hd.innerHTML = `<span class="verdict no">${MICERR[alts]}</span>`; else if (alts) res = compare(en, alts); }
        else { hd.textContent = 'Скажи вслух…'; await sleep(pauseFor(en), ctx); }
        row.querySelector('.en').style.visibility = ''; row.classList.add('revealed');
        if (res) {
          const good = res.score >= PASS; if (good) ok++; const rec = recordAnswer(en, good);
          row.querySelector('.en').innerHTML = spoken(en).split(/\s+/).map((w, k) => `<span class="w" style="color:var(${res.marks[k] ? '--ok' : '--bad'})">${h(w)}</span>`).join(' ');
          hd.innerHTML = (res.heard ? `«${h(res.heard)}» <span class="verdict ${good ? 'ok' : 'no'}">${Math.round(res.score * 100)}%</span>` : '<span class="verdict no">не расслышал</span>') + answerBadge(rec);
        } else if (!hd.querySelector('.verdict') || hd.textContent.includes('говори')) hd.textContent = '';
        await speak(spoken(en), { rate: DS.speed, voice: 'A' }, ctx);
      } else {
        await speak(spoken(en), { rate: DS.speed, voice: who === 'me' ? 'A' : 'B' }, ctx);
      }
      await sleep(300, ctx);
    }
    rows.forEach(r => r.classList.remove('active'));
    if (role && S.mic && RecAPI && n) { DS.result = { ok, n }; $('#dRes').innerHTML = `<span class="verdict ${ok / n >= PASS ? 'ok' : 'no'}">Засчитано ${ok} из ${n}</span>`; markDay(); updateStreak(); }
  } catch { /* остановлено */ }
  keepAwake(false);
}

// ---------- экран «Ядро» ----------
// ---------- экран «Ядро»: глаголы + шаблоны ----------
const CS = { mode: 'verb', v: 0, set: 0, g: 0, marks: {} };
function viewCore() {
  const sets = DATA.patterns || [];
  const chips = `<div class="chips">${DATA.core.verbs.map((x, i) => `<button class="chip ${CS.mode === 'verb' && i === CS.v ? 'on' : ''}" data-v="${i}">${h(x.verb)}</button>`).join('')}</div>
    <div class="chips">${sets.map((x, i) => `<button class="chip ${CS.mode === 'set' && i === CS.set ? 'on' : ''}" data-s="${i}">Шаблон: ${h(x.title)}</button>`).join('')}</div>`;
  const tile = (it, key) => { const m = CS.marks[key]; return `<div class="tile ${m === true ? 'ok' : m === false ? 'no' : ''}" data-k="${h(key)}" data-en="${h(it.en)}"><b>${h(it.ru)}</b><span>${h(it.en)}</span></div>`; };
  let body;
  if (CS.mode === 'verb') {
    const v = DATA.core.verbs[CS.v], rows = ['Настоящее', 'Прошедшее', 'Будущее'];
    body = `<div><h2>${h(v.verb)} — ${h(v.ru)}</h2><div class="muted small">${h(v.forms)}</div></div>
      <div class="gridhead"><span>+ да</span><span>? вопрос</span><span>− нет</span></div>
      ${rows.map((r, ri) => `<div class="muted small" style="font-weight:700">${r}</div><div class="tile-grid">${v.cells.slice(ri * 3, ri * 3 + 3).map(([en, ru]) => tile({ en, ru }, en)).join('')}</div>`).join('')}
      <button class="btn primary big" id="cTrain">Тренировка на скорость</button>`;
  } else {
    const set = sets[CS.set], g = set.groups[CS.g];
    body = `<div><h2>${h(set.title)}</h2><div class="muted small">${h(set.about)}</div></div>
      <div class="chips">${set.groups.map((x, i) => `<button class="chip ${i === CS.g ? 'on' : ''}" data-g="${i}">${h(x.label)}</button>`).join('')}</div>
      <div class="stack">${g.items.map(it => tile(it, it.en)).join('')}</div>
      <div class="row"><button class="btn primary" id="cTrain">Тренировка: ${h(g.label)}</button><button class="btn" id="cMix">Вперемешку · 10</button></div>`;
  }
  $('#view').innerHTML = `<div><h1>Ядро</h1><div class="muted">Глаголы в трёх временах и шаблоны: одна конструкция — разные слова. Цель — сказать за 3 секунды.</div></div>
    ${chips}<div class="card">${body}
      <div class="prompt-ru" id="cRu" style="min-height:0"></div><div class="answer-en" id="cEn"></div><div class="heard" id="cHd"></div></div>`;
  $$('[data-v]').forEach(el => el.onclick = () => { stopAll(); CS.mode = 'verb'; CS.v = +el.dataset.v; viewCore(); });
  $$('[data-s]').forEach(el => el.onclick = () => { stopAll(); CS.mode = 'set'; CS.set = +el.dataset.s; CS.g = 0; viewCore(); });
  $$('[data-g]').forEach(el => el.onclick = () => { stopAll(); CS.g = +el.dataset.g; viewCore(); });
  $$('[data-k]').forEach(el => el.onclick = () => { stopAll(); AUX = mkCtx(); speak(el.dataset.en, {}, AUX).catch(() => { }); });
  const list = CS.mode === 'verb' ? DATA.core.verbs[CS.v].cells.map(([en, ru]) => ({ en, ru })) : sets[CS.set].groups[CS.g].items;
  $('#cTrain').onclick = () => speedDrill(list, $('#cTrain'));
  if ($('#cMix')) $('#cMix').onclick = () => speedDrill(shuffle(sets[CS.set].groups.flatMap(x => x.items)).slice(0, 10), $('#cMix'));
}
async function speedDrill(list, btn) {
  stopAll(); const ctx = AUX = mkCtx(); keepAwake(true);
  const label = btn.textContent; btn.textContent = 'Остановить'; btn.onclick = () => { stopAll(); viewCore(); };
  const order = shuffle(list); let ok = 0, checked = 0; const res = new Map();
  try {
    for (const { en, ru } of order) {
      $('#cRu').textContent = ru; $('#cEn').textContent = ''; $('#cHd').textContent = '';
      await speak(ru, { lang: 'ru', cue: true }, ctx);
      let good = null;
      if (S.mic && RecAPI) {
        $('#cHd').innerHTML = '<span class="verdict no">● говори</span>';
        const alts = await listen(3000 + words(en) * 400, ctx);
        if (typeof alts === 'string') $('#cHd').innerHTML = `<span class="verdict no">${MICERR[alts]}</span>`;
        else if (alts) { const r = compare(en, alts); good = r.score >= PASS; const rec = recordAnswer(en, good); $('#cHd').innerHTML = (r.heard ? `«${h(r.heard)}» <span class="verdict ${good ? 'ok' : 'no'}">${Math.round(r.score * 100)}%</span>` : '<span class="verdict no">не успел</span>') + answerBadge(rec); }
      } else await sleep(3000, ctx);
      $('#cEn').textContent = en;
      if (good !== null) {
        checked++; if (good) ok++; CS.marks[en] = good; res.set(en, { ok: good });
        const t = $$('[data-k]').find(x => x.dataset.k === en); if (t) { t.classList.remove('ok', 'no'); t.classList.add(good ? 'ok' : 'no'); }
      }
      await speak(en, {}, ctx); await sleep(500, ctx);
    }
    $('#cRu').textContent = checked ? `Готово: ${ok} из ${order.length} за 3 секунды` : 'Готово! Пройди ещё раз быстрее.';
    $('#cEn').textContent = ''; $('#cHd').textContent = '';
    srsUpdate(res); markDay(); updateStreak();
  } catch { /* остановлено */ }
  keepAwake(false);
  btn.textContent = label; btn.onclick = () => speedDrill(list, btn);
}

// ---------- экран «Темы» ----------
const TS = { open: null };
function phraseList(arr, cls = '') {
  const s = srs();
  return `<div class="list">${arr.map(([en, ru]) => `<div class="ph ${cls}" data-say="${h(en)}"><button class="play" aria-label="Озвучить">${ICON_PLAY}</button><div class="tx"><div class="en">${h(en)}</div><div class="ru">${h(ru)}</div></div>${s[en] && s[en].known ? '<span class="pill done" title="Фраза выучена">✓</span>' : s[en] && s[en].weak ? `<span class="pill warn" title="Была ошибка — на доп. повторении">повтор ${(s[en].fixDays || []).length}/${FIX_DAYS}</span>` : ''}</div>`).join('')}</div>`;
}
function viewTopics() {
  const s = srs();
  if (!TS.open) {
    const group = (cat, name) => `<div class="card"><h3>${name}</h3><div class="list">${DATA.topics.filter(t => t.cat === cat).map(t => {
      const known = t.say.filter(([en]) => s[en] && s[en].known).length, seen = t.say.filter(([en]) => s[en]).length;
      return `<div class="topic-row" data-tp="${t.id}"><div><b>${h(t.title)}</b><div class="muted small">${t.say.length} фраз · ${t.hear.length} на слух · ${t.dialogs.length} диал.</div></div>
        <span class="pill ${known === t.say.length ? 'done' : seen ? 'now' : ''}">${known}/${t.say.length}</span></div>`;
    }).join('')}</div></div>`;
    $('#view').innerHTML = `<div><h1>Темы</h1><div class="muted">Все фразы базы по ситуациям. Нажми на фразу — услышишь её.</div></div>${group('travel', 'Путешествия')}${group('social', 'Общение')}`;
    $$('[data-tp]').forEach(el => el.onclick = () => { TS.open = el.dataset.tp; viewTopics(); window.scrollTo(0, 0); });
    return;
  }
  const t = DATA.topic(TS.open);
  $('#view').innerHTML = `<button class="back" id="tBack">← Все темы</button>
    <div><h1>${h(t.title)}</h1><div class="muted">${h(t.goal)}</div></div>
    <div class="card"><h3>Говоришь ты</h3>${phraseList(t.say, 'me')}</div>
    <div class="card"><h3>Говорят тебе</h3>${phraseList(t.hear)}</div>
    <div class="card"><h3>Ключевые слова</h3>${phraseList(t.words)}</div>
    <div class="card"><h3>Диалоги</h3><div class="list">${t.dialogs.map((d, di) => `<div class="topic-row" data-d="${di}"><b>${h(d.title)}</b><span class="pill">открыть</span></div>`).join('')}</div></div>`;
  $('#tBack').onclick = () => { stopAll(); TS.open = null; viewTopics(); };
  $$('[data-say]').forEach(el => el.onclick = () => { stopAll(); AUX = mkCtx(); speak(spoken(el.dataset.say), {}, AUX).catch(() => { }); });
  $$('[data-d]').forEach(el => el.onclick = () => { DS.open = { t: t.id, di: +el.dataset.d }; DS.result = null; render('dialogs'); });
}

// ---------- навигация ----------
const VIEWS = { lesson: viewLesson, listen: viewListen, dialogs: viewDialogs, core: viewCore, topics: viewTopics, settings: viewSettings };
let TAB = 'lesson';
function render(tab) {
  stopAll(); TAB = tab; resetAsk = false;
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $('#gear').classList.toggle('on', tab === 'settings');
  VIEWS[tab](); window.scrollTo(0, 0);
}
$$('#tabs button').forEach(b => b.onclick = () => render(b.dataset.tab));
$('#gear').onclick = () => render(TAB === 'settings' ? 'lesson' : 'settings');

(async function init() {
  try { await loadData(); }
  catch (e) { $('#view').innerHTML = `<div class="card"><h2>Не удалось загрузить фразы</h2><div class="muted">Проверь интернет и открой приложение ещё раз.</div></div>`; console.error(e); return; }
  updateStreak(); render('lesson');
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => { });
})();
