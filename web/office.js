/* Agent Office: every running coding agent takes a desk in a pixel office.
   Vanilla JS, one canvas at an integer scale, a DOM layer for text. Every sprite,
   prop, sign and letter is drawn in code. The cast, signs and quips come from the
   theme (web/themes/<name>.js, served as /theme.js); settings from /config.js. */
'use strict';
(() => {

// ============================================================ config
const THEME = window.AO_THEME;
if (!THEME || !THEME.cast || !THEME.slots) { document.body.textContent = 'Agent Office: no theme loaded. Is server.py running?'; return; }
const CFG = Object.assign({ scout: {}, departments: [] }, window.AO_CONFIG || {});
const SCOUT_CFG = Object.assign({ enabled: true, name: 'scout', every_minutes: 30, max_open: 2, start_hint: 'scout/start.sh', hours_label: 'working hours' }, CFG.scout || {});
const SLOT = THEME.slots;
const SCOUT_CH = SLOT.scout, RECEP_CH = SLOT.recep, RECEP_ID = 'npc:recep';
const BRAND = Object.assign({ title: 'Agent Office', place: '', store: 'agent-office', sign: ['AGENT OFFICE', ''] }, THEME.brand || {});
{ const h = document.getElementById('brandTitle'); if (h) h.textContent = BRAND.title; document.title = BRAND.title; }
const Q = new URLSearchParams(location.search);
const FIXTURE = Q.get('fixture');                       // null | '1' | 'big'
const SCENE = /^[a-z0-9-]{1,30}$/.test(Q.get('scene') || '') ? Q.get('scene') : null;   // ?scene=<name>: a scripted scene for filming
const BIG_N = clampInt(Q.get('n'), 18, 6, 80);
const POLL_MS = 1500, ROTATE_MS = 4000;
const QUIP_FIRST_MS = 5000, QUIP_EVERY_MS = 60000, QUIP_SHOW_MS = 5000;
const SPEED = 16 / 150;                                 // px per ms: 1 tile per 150 ms

// world geometry, logical px (16 px tiles)
const CEIL_H = 10, WALL_H = 58, TOP_H = 76;
const RCP_W = 136, MO_W = 100, KIT_W = 100, ACC_W = 116;
const MIN_W = 440;
const DESK = 34, PITCH = 42, ROW_H = 46;
const SEAT_DY = 18, STAND_DY = 22;
const SPINE = 7;                                        // the walkway down the left side
const FS = { 2: [9, 10, 10], 3: [11, 12, 12], 4: [12, 14, 14] };   // plate, bubble, sign
const STATUSES = ['working', 'thinking', 'idle', 'blocked', 'done', 'error'];
const STATUS_LABEL = { working: 'Working', thinking: 'Thinking', idle: 'Idle', blocked: 'Needs a person', done: 'Done', error: 'Error' };
const LANYARDS = ['#2f7fd8', '#3fae5a', '#f2b632', '#9b59d0', '#f07c2a', '#1fb5b0'];
const LANYARD_NAMES = ['blue', 'green', 'yellow', 'purple', 'orange', 'teal'];

// ============================================================ dom
const $ = (s) => document.querySelector(s);
const canvas = $('#office'), overlay = $('#overlay'), stage = $('#stage'), stageWrap = $('#stageWrap');
const ctx = canvas.getContext('2d');
const buf = document.createElement('canvas'), bctx = buf.getContext('2d');
const stat = document.createElement('canvas'), sctx = stat.getContext('2d');

window.addEventListener('error', (e) => showErr(e.message + (e.lineno ? ' (line ' + e.lineno + ')' : '')));
window.addEventListener('unhandledrejection', (e) => showErr(String(e.reason && e.reason.message || e.reason)));
function showErr(msg) { const b = $('#errbar'); b.hidden = false; b.textContent = BRAND.title + ' error: ' + msg; }

// ============================================================ utils
function clampInt(v, d, lo, hi) { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; }
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (arr, r) => arr[Math.floor(r() * arr.length) % arr.length];
function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgbHex(r, g, b) { return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1); }
function mix(a, b, t) { const A = hexToRgb(a), B = hexToRgb(b); return rgbHex(...A.map((v, i) => Math.round(v + (B[i] - v) * t))); }
const dark = (c, t) => mix(c, '#000000', t);
const light = (c, t) => mix(c, '#ffffff', t);
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function trunc(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function hash2(x, y) { let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; }
const sum = (arr) => arr.reduce((s, v) => s + v, 0);
const store = {
  get(k) { try { return window.localStorage ? window.localStorage.getItem(k) : null; } catch (e) { return null; } },
  set(k, v) { try { if (window.localStorage) window.localStorage.setItem(k, v); } catch (e) { /* private mode or blocked: memory only */ } },
};

// ============================================================ the cast
// The theme names every character: name, title, look (hand-tuned to read at 16x24), quips, pools.
const CAST = THEME.cast;
for (const k of Object.keys(CAST)) CAST[k].first = CAST[k].first || CAST[k].name.split(' ')[0];
const QUIPS = THEME.quips || {};
const SCOUT_QUIPS = THEME.scoutQuips && THEME.scoutQuips.length ? THEME.scoutQuips : ['Just looking around.'];
const PITCH_LABEL = { open: 'Open', running: 'Running', done: 'Done', stuck: 'Stuck', dismissed: 'Dismissed' };
// Pools. Order inside a pool is the order characters are handed out.
const POOLS = THEME.pools;
const POOL_OF_TYPE = THEME.poolOfType || {};
const ANNEX_EXTRAS = SLOT.annexExtras || [];
const WAREHOUSE_CREW = SLOT.crew || [];
const SC_FIRST = CAST[SCOUT_CH] ? CAST[SCOUT_CH].name.split(' ')[0] : 'The scout';
const SC_OUT = `${SC_FIRST} is out. Run ${SCOUT_CFG.start_hint}`;
const NUM_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

function poolFor(a) {
  if (a.agent_type === 'codex') return 'codex';
  if (a.kind !== 'subagent') return 'top';
  return POOL_OF_TYPE[a.agent_type] || 'annex';
}
const isTemp = (ch) => typeof ch === 'string' && ch.startsWith('temp:');
const tempN = (ch) => parseInt(ch.slice(5), 10) || 0;
function charName(ch) { return isTemp(ch) ? 'Temp #' + tempN(ch) : (CAST[ch] ? CAST[ch].name : 'Someone'); }
function charFirst(ch) { return isTemp(ch) ? 'Temp #' + tempN(ch) : (CAST[ch] ? CAST[ch].first : 'Someone'); }
function charTitle(ch) { return isTemp(ch) ? 'Temp' : (CAST[ch] ? CAST[ch].title : ''); }

// ============================================================ looks
const SKINS = ['#f7d7c0', '#efc19f', '#e2a97f', '#c98b5e', '#a86d43', '#8a5433', '#6b3f26', '#f2c48f', '#d79a6b'];
const HAIRS = ['#2a1d16', '#4b2e1d', '#6e4426', '#9b5a2c', '#c88a3e', '#e3c069', '#1b1b1f', '#8f8f96', '#b5432c', '#e9e1d2', '#5a3a5e', '#3a2a40'];
const SHIRTS = ['#5b7fb8', '#c2504a', '#5e9e6e', '#d9a441', '#8a6bb8', '#e07b9b', '#4aa3a3', '#e9e4d8', '#6b6b78', '#3d5a80', '#b8734a', '#7aa34a', '#d86f3c'];
const MUGS = ['#f4f1e8', '#d94f3d', '#3d6fb5', '#f2c14e', '#5aa36a', '#2e2e36', '#e48fb0'];
const TEMP_STYLES = ['short', 'side', 'spiky', 'long', 'bun', 'curly', 'buzz', 'bob'];
const TEMP_TOPS = [null, null, 'polo', 'sweater', 'top', 'cardigan'];
const ARM_LAYER = new Set(['suit', 'blazer', 'cardigan', 'sweater', 'jacket']);

function finishLook(s, seed) {
  const r = rng(hash32(seed));
  const L = Object.assign({ style: 'short', hair: '#3a2a1e', shirt: '#e9e4d8', glasses: false, glassC: '#26262c' }, s);
  L.skinD = dark(L.skin, 0.16); L.skinL = light(L.skin, 0.3); L.mouth = dark(L.skin, 0.42); L.blush = mix(L.skin, '#ff6f6f', 0.3);
  L.hairD = dark(L.hair, 0.3); L.hairL = light(L.hair, 0.22);
  L.shirtD = dark(L.shirt, 0.18); L.shirtL = light(L.shirt, 0.4);
  if (L.topC) L.topD = dark(L.topC, 0.28);
  L.armC = L.top && ARM_LAYER.has(L.top) ? L.topC : L.shirt;
  L.armD = dark(L.armC, 0.24);
  L.collarC = L.collarC || (L.tie || L.top === 'suit' ? '#f8f6f0' : L.shirtL);
  L.tieD = L.tie ? dark(L.tie, 0.3) : null;
  L.pants = L.pants || (L.top === 'suit' ? L.topC : pick(['#3b4252', '#4a4038', '#2e3440', '#5a5248', '#39404f'], r));
  L.shoe = '#2a2522';
  L.mug = L.mug || pick(MUGS, r); L.mugL = light(L.mug, 0.3);
  L.chair = pick(['#3d4250', '#43394a', '#3a4a48', '#4a3f36'], r);
  L.phase = Math.floor(r() * 9000);
  L.blushOn = !!L.blushOn;
  return L;
}
// v1's random look generator, used for Temps.
function tempLook(id) {
  const r = rng(hash32('temp|' + id));
  const style = pick(TEMP_STYLES, r);
  const hair = style === 'buzz' && r() < 0.5 ? pick(['#8f8f96', '#cfc8bd', '#5a4a3a'], r) : pick(HAIRS, r);
  const top = pick(TEMP_TOPS, r);
  return finishLook({ skin: pick(SKINS, r), style, hair, shirt: pick(SHIRTS, r), top, topC: top ? pick(['#2f3a52', '#6a4a5a', '#3d4a3f', '#8a6a4a', '#5a6a8a'], r) : null, glasses: r() < 0.3 ? 'round' : false, glassC: pick(['#26262c', '#6b3d22', '#3a4f7a'], r), short: top === 'polo', blushOn: r() < 0.4 }, 'tl|' + id);
}
const lookCache = new Map();
function lookOfChar(ch, id) {
  const key = ch + '|' + (isTemp(ch) ? id : '');
  let L = lookCache.get(key);
  if (!L) { L = isTemp(ch) || !CAST[ch] ? tempLook(id) : finishLook(CAST[ch].look, ch); lookCache.set(key, L); }
  return L;
}
const RECEP_LOOK = finishLook(CAST[RECEP_CH].look, RECEP_CH);

// ============================================================ sprite drawing
let G = null;
function R(x, y, w, h, c) { G.fillStyle = c; G.fillRect(x, y, w, h); }

// Draw a 16x24 person with its top-left at (ox, oy). o.part: 'body' (behind the desk), 'front' (hands on the desk) or 'all'.
function drawPerson(ox, oy, L, o) {
  ox = Math.round(ox); oy = Math.round(oy);
  const p = (x, y, w, h, c) => { G.fillStyle = c; G.fillRect(ox + x, oy + y, w, h); };
  const hy = L.tall || 0;
  const h = hy ? (x, y, w, hh, c) => p(x, y - hy, w, hh, c) : p;     // head layer, raised for tall people
  const pose = o.pose || 'down', fr = o.frame | 0, t = o.t || 0, back = !!o.back;
  if (o.part !== 'front') {
    if (o.legs) legs(p, L, pose === 'walk' ? fr : -1);
    torso(p, L, back, o);
    if (pose === 'lean' && !back) armsLean(p, L);
    p(7, 11 - hy, 2, 1 + hy, L.skinD);
    if (back) headBack(h, L);
    else {
      headFront(h, L);
      face(h, L, o, t);
      facial(h, L);
      hairFront(h, L);
      if (L.glasses) glasses(h, L);
      if (o.glow) { h(4, 4, 1, 6, 'rgba(150,225,255,0.22)'); if (Math.floor((t + L.phase) / 700) % 3) h(5, 6, 1, 3, 'rgba(150,225,255,0.12)'); }
    }
    armsBody(p, L, pose, fr, back);
  }
  if (o.part !== 'body' && !back) armsFront(p, L, pose, fr);
  if (o.clip && pose === 'walk' && o.part !== 'body') {      // the scout carries the pitches on the move
    p(12, 13, 4, 6, '#8a5a2b'); p(13, 14, 2, 4, '#f6f3ea'); p(13, 12, 2, 1, '#b9bec9'); p(13, 15, 2, 1, '#9aa3ae');
  }
}

function legs(p, L, wf) {
  p(4, 20, 8, 1, L.pants);
  if (wf === 0) { p(4, 21, 3, 2, L.pants); p(4, 23, 3, 1, L.shoe); p(9, 21, 3, 1, L.pants); p(9, 22, 3, 1, L.shoe); }
  else if (wf === 1) { p(4, 21, 3, 1, L.pants); p(4, 22, 3, 1, L.shoe); p(9, 21, 3, 2, L.pants); p(9, 23, 3, 1, L.shoe); }
  else { p(4, 21, 3, 2, L.pants); p(9, 21, 3, 2, L.pants); p(4, 23, 3, 1, L.shoe); p(9, 23, 3, 1, L.shoe); }
}

function torso(p, L, back, o) {
  const big = L.build === 'big';
  const x0 = big ? 2 : 3, w = big ? 12 : 10, xr = x0 + w - 1;
  const s = L.shirt, sd = L.shirtD, c = L.topC, cd = L.topD;
  p(x0, 12, w, 8, s); p(xr, 13, 1, 7, sd); p(x0, 19, w, 1, sd);
  if (big) { p(x0 + 2, 17, w - 4, 2, L.shirtL); p(x0 + 1, 19, w - 2, 1, sd); }
  if (back) {
    if (L.top && ARM_LAYER.has(L.top)) { p(x0, 12, w, 8, c); p(xr, 13, 1, 7, cd); p(x0 + 4, 13, 2, 6, cd); }
    else if (L.top === 'vest') { p(x0 + 1, 12, w - 2, 8, c); }
    if (L.top === 'suit' || L.tie) p(6, 12, 4, 1, L.collarC);
    if (o.lanyard) { p(5, 12, 1, 1, o.lanyard); p(10, 12, 1, 1, o.lanyard); p(6, 12, 4, 1, o.lanyard); }
    return;
  }
  const neckV = () => { p(7, 12, 2, 1, L.skinD); };
  switch (L.top) {
    case 'suit':
      p(x0, 12, 3, 8, c); p(xr - 2, 12, 3, 8, c); p(x0 + 3, 16, w - 6, 4, c);
      p(x0 + 3, 12, 1, 3, cd); p(xr - 3, 12, 1, 3, cd); p(xr, 13, 1, 7, cd); p(x0 + 5, 17, 1, 1, cd);
      p(6, 12, 1, 1, L.collarC); p(9, 12, 1, 1, L.collarC);
      break;
    case 'blazer':
      p(x0, 12, 3, 8, c); p(xr - 2, 12, 3, 8, c); p(x0 + 3, 12, 1, 4, cd); p(xr - 3, 12, 1, 4, cd); p(xr, 13, 1, 7, cd);
      p(6, 12, 4, 1, L.skin); p(7, 13, 2, 1, L.skinD);
      break;
    case 'cardigan':
      p(x0, 12, 3, 8, c); p(xr - 2, 12, 3, 8, c); p(x0 + 2, 14, 1, 1, cd); p(x0 + 2, 17, 1, 1, cd); p(xr, 13, 1, 7, cd);
      if (L.peter) { p(5, 12, 2, 1, '#ffffff'); p(9, 12, 2, 1, '#ffffff'); p(7, 12, 2, 1, L.skinD); }
      else { p(6, 12, 4, 1, L.skin); p(7, 13, 2, 1, L.skinD); }
      break;
    case 'sweater':
      p(x0, 12, w, 8, c); p(xr, 13, 1, 7, cd); p(x0, 19, w, 1, cd);
      p(6, 12, 1, 1, L.collarC); p(9, 12, 1, 1, L.collarC); p(7, 12, 2, 1, L.collarC); p(7, 13, 2, 1, L.skinD);
      break;
    case 'vest':
      p(x0 + 1, 12, w - 2, 8, c); p(xr - 1, 13, 1, 7, cd); p(7, 12, 2, 3, s); p(6, 12, 1, 1, L.collarC); p(9, 12, 1, 1, L.collarC);
      p(5, 15, 1, 1, cd); p(10, 15, 1, 1, cd); p(6, 17, 1, 1, cd); p(9, 17, 1, 1, cd);
      break;
    case 'jacket':
      p(x0, 12, w, 8, c); p(xr, 13, 1, 7, cd); p(8, 13, 1, 7, cd); p(5, 12, 2, 1, cd); p(9, 12, 2, 1, cd); p(7, 12, 2, 1, s);
      p(4, 16, 2, 1, cd); p(10, 16, 2, 1, cd);
      break;
    case 'polo':
      p(5, 12, 2, 1, L.shirtL); p(9, 12, 2, 1, L.shirtL); p(7, 12, 2, 2, sd); p(8, 13, 1, 1, L.shirtL);
      break;
    case 'work':
      p(6, 12, 1, 1, sd); p(9, 12, 1, 1, sd); neckV(); p(4, 14, 3, 2, sd); p(9, 14, 3, 2, sd); p(10, 14, 2, 1, '#f4f4ee');
      break;
    case 'floral':
      p(6, 12, 4, 1, L.skin); p(7, 13, 2, 1, L.skinD);
      for (const [fx, fy] of [[4, 13], [10, 14], [6, 16], [11, 17], [4, 18], [8, 19], [9, 12]]) p(fx, fy, 1, 1, L.flowerA);
      for (const [fx, fy] of [[5, 15], [9, 16], [7, 18], [12, 13]]) p(fx, fy, 1, 1, L.flowerB);
      break;
    case 'top':
      p(6, 12, 4, 1, L.skin); p(7, 13, 2, 1, L.skin);
      break;
    default:
      if (!L.tie) { neckV(); p(6, 12, 1, 1, L.collarC); p(9, 12, 1, 1, L.collarC); p(8, 15, 1, 1, sd); p(8, 18, 1, 1, sd); }
  }
  if (L.tie) {
    if (L.looseTie) { p(6, 12, 1, 1, L.collarC); p(9, 12, 1, 1, L.collarC); p(7, 12, 2, 1, L.skinD); p(7, 13, 2, 1, L.tieD); p(7, 14, 2, 4, L.tie); p(8, 18, 1, 1, L.tieD); }
    else { p(6, 12, 1, 1, L.collarC); p(9, 12, 1, 1, L.collarC); p(7, 12, 2, 1, L.tieD); p(7, 13, 2, L.top === 'suit' ? 3 : 4, L.tie); if (L.top !== 'suit') p(7, 17, 2, 1, L.tieD); }
  }
  if (L.pens) { p(9, 14, 2, 2, L.shirtD); p(9, 13, 1, 1, '#2f6fb5'); p(10, 13, 1, 1, '#c0392b'); }
  if (o.lanyard) {
    const y = o.lanyard;
    p(5, 12, 1, 3, y); p(10, 12, 1, 3, y); p(6, 15, 1, 1, y); p(9, 15, 1, 1, y);
    p(6, 16, 4, 3, y); p(7, 17, 2, 1, '#ffffff'); p(6, 18, 4, 1, dark(y, 0.25));
  }
  if (o.mic) p(9, 13, 1, 1, '#121216');
}

function headFront(h, L) {
  h(5, 2, 6, 1, L.skin); h(4, 3, 8, 7, L.skin); h(5, 10, 6, 1, L.skin);
  h(11, 9, 1, 1, L.skinD); h(10, 10, 1, 1, L.skinD);
  h(3, 6, 1, 2, L.skin); h(12, 6, 1, 2, L.skin); h(3, 7, 1, 1, L.skinD); h(12, 7, 1, 1, L.skinD);
  if (L.build === 'big') { h(3, 8, 1, 2, L.skin); h(12, 8, 1, 2, L.skin); h(4, 10, 8, 1, L.skin); h(5, 11, 6, 1, L.skinD); }
  if (L.older) { h(5, 4, 2, 1, L.skinD); h(9, 4, 2, 1, L.skinD); h(5, 8, 1, 1, L.skinD); h(10, 8, 1, 1, L.skinD); }
}

function face(h, L, o, t) {
  const E = '#2a1f1b', M = L.mouth;
  const expr = o.expr || 'normal';
  const blink = ((t + L.phase) % 4300) < 140;
  if (expr === 'wide') {
    h(6, 5, 1, 2, E); h(9, 5, 1, 2, E);
  } else if (expr === 'closed' || expr === 'happy' || blink) {
    h(5, 6, 2, 1, M); h(9, 6, 2, 1, M);
  } else {
    let ex = 0, ey = 6;
    if (expr === 'up') { ey = 5; ex = 1; }
    if (expr === 'look') ex = (Math.floor((t + L.phase) / 2600) % 3) - 1;
    h(6 + ex, ey, 1, 1, E); h(9 + ex, ey, 1, 1, E);
  }
  if (L.blushOn || expr === 'happy') { h(5, 8, 1, 1, L.blush); h(10, 8, 1, 1, L.blush); }
  const m = o.mouth || ({ happy: 'smile', closed: 'smile', smile: 'smile', wide: 'open', up: 'hmm', open: 'o' })[expr] || 'flat';
  if (m === 'smile') { h(6, 8, 1, 1, M); h(9, 8, 1, 1, M); h(7, 9, 2, 1, M); }
  else if (m === 'open') { h(7, 8, 2, 2, '#6b2e2e'); }
  else if (m === 'o') { h(7, 9, 2, 1, '#6b2e2e'); }
  else if (m === 'hmm') { h(8, 9, 2, 1, M); }
  else h(7, 9, 2, 1, M);
  if (expr === 'wide') h(12, 3, 1, 2, '#8fd3ff');
}

function facial(h, L) {
  const c = L.facialC || L.hairD;
  switch (L.facial) {
    case 'mustache': h(5, 8, 6, 1, c); h(6, 7, 4, 1, mix(c, L.skin, 0.45)); break;
    case 'beard': h(4, 7, 1, 3, c); h(11, 7, 1, 3, c); h(5, 9, 2, 2, c); h(9, 9, 2, 2, c); h(6, 10, 4, 1, c); h(6, 8, 4, 1, c); break;
    case 'goatee': h(6, 8, 4, 1, c); h(6, 9, 1, 1, c); h(9, 9, 1, 1, c); h(6, 10, 4, 1, c); break;
    case 'stubble': for (const [x, y] of [[4, 8], [11, 8], [5, 9], [10, 9], [6, 10], [9, 10], [5, 10], [10, 10]]) h(x, y, 1, 1, mix(L.skin, '#3a2a20', 0.45)); break;
  }
}

function hairFront(h, L) {
  const c = L.hair, d = L.hairD, l = L.hairL;
  switch (L.style) {
    case 'short': h(5, 1, 6, 1, c); h(4, 2, 8, 2, c); h(4, 4, 3, 1, c); h(4, 5, 1, 1, c); h(11, 4, 1, 2, c); h(6, 1, 2, 1, l); break;
    case 'side': h(5, 1, 6, 1, c); h(4, 2, 8, 2, c); h(4, 4, 6, 1, c); h(4, 5, 1, 2, c); h(11, 4, 1, 1, c); h(9, 2, 1, 1, d); h(5, 1, 2, 1, l); break;
    case 'sidepart':   // thick, dark, parted on one side and combed over
      h(5, 1, 7, 1, c); h(4, 2, 8, 2, c); h(3, 3, 1, 3, c); h(12, 3, 1, 2, c); h(4, 4, 1, 2, c); h(11, 4, 1, 1, c);
      h(7, 4, 4, 1, c); h(5, 1, 1, 2, d); h(7, 1, 3, 1, l); h(8, 2, 2, 1, l); break;
    case 'middle':     // center part, flat curtains down to the ears
      h(5, 1, 6, 1, c); h(4, 2, 8, 2, c); h(7, 1, 2, 1, L.skinD); h(7, 2, 1, 1, d);
      h(4, 4, 3, 1, c); h(9, 4, 3, 1, c); h(4, 5, 1, 2, c); h(11, 5, 1, 2, c); h(3, 4, 1, 2, c); h(12, 4, 1, 2, c);
      h(5, 2, 1, 1, l); h(10, 2, 1, 1, l); break;
    case 'tousled':    // messy volume, fringe falling forward
      h(4, 1, 8, 3, c); h(5, 0, 2, 1, c); h(8, 0, 3, 1, c); h(3, 2, 1, 2, c); h(12, 2, 1, 2, c); h(6, -1, 1, 1, c); h(10, -1, 1, 1, c);
      h(5, 4, 3, 1, c); h(9, 4, 1, 1, c); h(4, 4, 1, 2, c); h(11, 4, 1, 2, c);
      h(6, 1, 1, 1, l); h(9, 1, 1, 1, l); h(8, 2, 1, 1, d); h(5, 3, 1, 1, d); break;
    case 'wavy':       // shoulder-length, side bangs
      h(5, 1, 6, 1, c); h(4, 2, 8, 2, c); h(4, 4, 5, 1, c); h(4, 5, 2, 1, c); h(11, 4, 1, 1, c);
      h(3, 3, 1, 10, c); h(12, 3, 1, 10, c); h(2, 6, 1, 6, c); h(13, 6, 1, 6, c); h(3, 12, 2, 1, d); h(11, 12, 2, 1, d);
      h(6, 1, 3, 1, l); h(2, 8, 1, 1, d); h(13, 9, 1, 1, d); break;
    case 'neat':       // short, tidy, side-swept
      h(5, 1, 6, 1, c); h(4, 2, 8, 2, c); h(4, 4, 2, 1, c); h(4, 5, 1, 1, c); h(11, 4, 1, 2, c); h(6, 1, 3, 1, l); h(9, 2, 1, 1, d); break;
    case 'bald':
      h(6, 2, 3, 1, L.skinL); h(5, 3, 1, 1, L.skinL);
      if (L.sideHair) { h(3, 5, 1, 2, c); h(12, 5, 1, 2, c); h(4, 4, 1, 3, c); h(11, 4, 1, 3, c); }
      break;
    case 'balding':    // sides and a thin top
      h(4, 3, 1, 4, c); h(11, 3, 1, 4, c); h(5, 2, 1, 1, c); h(10, 2, 1, 1, c); h(7, 2, 2, 1, mix(c, L.skin, 0.5)); h(3, 5, 1, 2, c); h(12, 5, 1, 2, c); break;
    case 'curlybob':
      h(4, 0, 8, 4, c); h(3, 1, 1, 3, c); h(12, 1, 1, 3, c); h(5, -1, 2, 1, c); h(9, -1, 2, 1, c);
      h(3, 4, 1, 6, c); h(12, 4, 1, 6, c); h(2, 3, 1, 5, c); h(13, 3, 1, 5, c); h(4, 4, 2, 1, c); h(10, 4, 2, 1, c);
      h(5, 1, 1, 1, d); h(8, 2, 1, 1, d); h(10, 1, 1, 1, d); h(2, 5, 1, 1, d); h(13, 6, 1, 1, d); h(6, 0, 1, 1, l); h(3, 9, 1, 1, d); h(12, 9, 1, 1, d); break;
    case 'curly':
      h(3, 0, 10, 4, c); h(4, -1, 2, 1, c); h(7, -1, 2, 1, c); h(10, -1, 2, 1, c); h(2, 1, 1, 4, c); h(13, 1, 1, 4, c);
      h(3, 4, 1, 4, c); h(12, 4, 1, 4, c); h(4, 4, 1, 1, c); h(11, 4, 1, 1, c);
      h(5, 1, 1, 1, d); h(8, 2, 1, 1, d); h(10, 1, 1, 1, d); h(4, 3, 1, 1, d); h(11, 3, 1, 1, d); h(6, 0, 1, 1, l); break;
    case 'curlylong':
      h(3, 0, 10, 4, c); h(4, -1, 2, 1, c); h(7, -1, 3, 1, c); h(11, -1, 1, 1, c); h(4, 4, 2, 1, c); h(10, 4, 2, 1, c);
      h(2, 2, 2, 11, c); h(12, 2, 2, 11, c); h(1, 5, 1, 6, c); h(14, 5, 1, 6, c); h(3, 4, 1, 1, c); h(12, 4, 1, 1, c);
      h(5, 1, 1, 1, d); h(9, 2, 1, 1, d); h(2, 6, 1, 1, d); h(13, 8, 1, 1, d); h(1, 9, 1, 1, d); h(14, 7, 1, 1, d); h(2, 12, 1, 1, d); h(13, 12, 1, 1, d); h(7, 0, 1, 1, l); break;
    case 'bun':        // scraped back, tight bun on top
      h(5, 1, 6, 1, c); h(4, 2, 8, 2, c); h(4, 4, 1, 2, c); h(11, 4, 1, 2, c); h(6, -2, 4, 3, c); h(7, -2, 2, 1, l); h(6, 0, 4, 1, d); h(8, 2, 1, 1, d); h(5, 2, 1, 1, l); break;
    case 'swept':      // grey, swept back, wispy sides, high forehead
      h(5, 1, 6, 1, c); h(4, 2, 8, 1, c); h(3, 3, 2, 4, c); h(11, 3, 2, 4, c); h(12, 2, 2, 1, c); h(2, 3, 1, 3, c); h(13, 4, 1, 3, c);
      h(6, 1, 4, 1, l); h(4, 3, 1, 1, l); break;
    case 'messy':
      h(5, 1, 6, 1, c); h(4, 2, 8, 2, c); h(4, 4, 3, 1, c); h(9, 4, 2, 1, c); h(3, 3, 1, 7, c); h(12, 3, 1, 6, c); h(2, 4, 1, 3, c); h(13, 5, 1, 4, c);
      h(2, 2, 1, 1, c); h(13, 2, 1, 2, c); h(6, 0, 1, 1, c); h(10, 0, 1, 1, c); h(2, 8, 1, 2, c); h(4, 10, 1, 1, c); h(7, 1, 2, 1, l); h(5, 3, 1, 1, d); break;
    case 'long':
      h(5, 1, 6, 1, c); h(4, 2, 8, 2, c); h(5, 4, 6, 1, c); h(3, 3, 2, 11, c); h(11, 3, 2, 11, c); h(3, 13, 1, 1, d); h(12, 13, 1, 1, d); h(6, 1, 2, 1, l); break;
    case 'slick':      // short with a swept front
      h(5, 1, 6, 1, c); h(4, 2, 8, 2, c); h(6, 0, 5, 1, c); h(4, 4, 3, 1, c); h(4, 5, 1, 1, c); h(11, 4, 1, 2, c); h(7, 0, 2, 1, l); h(9, 1, 2, 1, l); break;
    case 'shaggy':
      h(4, 1, 8, 3, c); h(5, 0, 6, 1, c); h(3, 2, 1, 7, c); h(12, 2, 1, 7, c); h(4, 4, 3, 1, c); h(8, 4, 3, 1, c); h(4, 5, 1, 3, c); h(11, 5, 1, 3, c);
      h(3, 9, 1, 1, d); h(12, 9, 1, 1, c); h(6, 1, 2, 1, l); h(9, 2, 1, 1, d); break;
    case 'ponytail':   // straight bangs, tail out to the side
      h(5, 1, 6, 1, c); h(4, 2, 8, 2, c); h(4, 4, 8, 1, c); h(4, 5, 1, 2, c); h(11, 5, 1, 2, c); h(12, 1, 2, 2, c); h(13, 3, 2, 6, c); h(14, 9, 1, 1, d); h(12, 2, 1, 1, '#2f6fb5'); h(6, 1, 2, 1, l); break;
    case 'spiky': h(4, 1, 8, 3, c); h(5, 0, 1, 1, c); h(7, -1, 1, 2, c); h(9, 0, 1, 1, c); h(11, 0, 1, 1, c); h(3, 1, 1, 1, c); h(4, 4, 1, 2, c); h(11, 4, 1, 2, c); h(6, 4, 1, 1, c); h(9, 4, 1, 1, c); h(7, 1, 1, 1, l); break;
    case 'buzz': h(4, 4, 1, 3, c); h(11, 4, 1, 3, c); h(4, 3, 1, 1, c); h(11, 3, 1, 1, c); h(5, 2, 6, 1, c); h(4, 3, 8, 1, mix(c, L.skin, 0.35)); h(6, 2, 2, 1, mix(c, '#ffffff', 0.15)); break;
    case 'bob': default:
      h(5, 1, 6, 1, c); h(4, 2, 8, 2, c); h(4, 4, 8, 1, c); h(3, 3, 2, 7, c); h(11, 3, 2, 7, c); h(5, 4, 1, 1, d); h(6, 1, 2, 1, l); break;
  }
}

function headBack(h, L) {
  const c = L.hair, d = L.hairD;
  const skinHead = L.style === 'bald' || L.style === 'balding' || L.style === 'buzz';
  if (skinHead) {
    h(5, 2, 6, 1, L.skin); h(4, 3, 8, 7, L.skin); h(5, 10, 6, 1, L.skin); h(6, 3, 2, 1, L.skinL);
    if (L.style === 'buzz') { h(4, 3, 8, 5, c); h(5, 2, 6, 1, c); }
    else if (L.style === 'balding' || L.sideHair) h(4, 6, 8, 2, c);
  } else {
    h(5, 1, 6, 1, c); h(4, 2, 8, 7, c); h(5, 9, 6, 1, L.skinD); h(5, 10, 6, 1, L.skin); h(6, 4, 1, 3, d); h(9, 3, 1, 3, d);
  }
  h(3, 6, 1, 2, L.skin); h(12, 6, 1, 2, L.skin);
  switch (L.style) {
    case 'long': case 'wavy': h(3, 3, 10, 11, c); h(5, 6, 1, 6, d); h(10, 5, 1, 6, d); break;
    case 'curlylong': h(2, 1, 12, 12, c); h(4, -1, 8, 2, c); h(5, 5, 1, 1, d); h(10, 8, 1, 1, d); break;
    case 'bob': case 'messy': case 'curlybob': h(3, 3, 10, 7, c); h(6, 5, 1, 3, d); break;
    case 'bun': h(6, -2, 4, 3, c); h(7, -1, 2, 1, d); break;
    case 'curly': h(3, 0, 10, 9, c); h(2, 1, 1, 6, c); h(13, 1, 1, 6, c); h(4, -1, 8, 1, c); break;
    case 'ponytail': h(7, 3, 2, 10, c); h(7, 4, 2, 1, '#2f6fb5'); break;
    case 'shaggy': h(3, 2, 10, 9, c); break;
    case 'tousled': case 'spiky': h(5, 0, 2, 1, c); h(8, -1, 2, 2, c); h(11, 0, 1, 1, c); break;
    case 'middle': h(7, 1, 2, 1, L.skinD); break;
  }
}

function glasses(h, L) {
  const F = L.glassC, g = 'rgba(225,242,255,0.9)';
  if (L.glasses === 'rect') {
    h(5, 5, 2, 1, F); h(9, 5, 2, 1, F); h(4, 6, 1, 1, F); h(7, 6, 2, 1, F); h(11, 6, 1, 1, F); h(5, 7, 2, 1, F); h(9, 7, 2, 1, F);
    h(5, 6, 1, 1, g); h(10, 6, 1, 1, g);
  } else {
    h(5, 5, 2, 1, F); h(9, 5, 2, 1, F); h(7, 6, 2, 1, F); h(4, 6, 1, 1, F); h(11, 6, 1, 1, F);
    h(5, 6, 1, 1, g); h(10, 6, 1, 1, g);
  }
}

function armsLean(p, L) {
  const a = L.armC;
  p(1, 7, 2, 2, a); p(2, 9, 2, 4, a); p(2, 5, 2, 2, a);
  p(13, 7, 2, 2, a); p(12, 9, 2, 4, a); p(12, 5, 2, 2, a);
  if (L.short) { p(1, 7, 2, 2, L.skin); p(2, 5, 2, 2, L.skin); p(13, 7, 2, 2, L.skin); p(12, 5, 2, 2, L.skin); }
}

function armsBody(p, L, pose, fr, back) {
  const big = L.build === 'big' ? 1 : 0;
  const a = L.armC, d = L.armD, s = L.skin;
  // left and right arm, pushed out for a big build; short sleeves show skin outside the shoulder rows
  const paint = (dx) => (x, y, w, h, c) => {
    if (!L.short || (c !== a && c !== d)) return p(x + dx, y, w, h, c);
    const cs = c === d ? L.skinD : s;
    for (let yy = y; yy < y + h; yy++) p(x + dx, yy, w, 1, yy >= 10 && yy <= 14 ? c : cs);
  };
  const l = paint(-big), r = paint(big);
  switch (pose) {
    case 'type': l(2, 13, 2, 4, a); r(12, 13, 2, 4, a); l(3, 17, 2, 1, a); r(11, 17, 2, 1, a); break;
    case 'chin':
      l(2, 13, 2, 4, a); l(3, 17, 2, 1, a);
      r(12, 13, 2, 3, a); r(11, 11, 2, 5, d); r(11, 15, 2, 1, a); p(9, 9, 3, 2, s); p(9, 10, 1, 1, L.skinD); break;
    case 'sip':
      l(2, 13, 2, 4, a); l(3, 17, 2, 1, a);
      r(12, 13, 2, 3, a); r(11, 10, 2, 4, d); p(8, 8, 3, 3, L.mug); p(8, 8, 3, 1, L.mugL); p(11, 9, 1, 2, s); break;
    case 'raise': {
      const w = fr ? 1 : 0;
      l(2, 13, 2, 6, a); l(2, 19, 2, 1, s);
      r(12, 3, 2, 10, a); r(13, 3, 1, 9, d); p(12 + w + big, 0, 2, 3, s); p(11 + w + big, 1, 1, 1, s); break;
    }
    case 'phone':      // the receptionist with the handset at the ear
      l(2, 13, 2, 4, a); l(3, 17, 2, 1, a);
      r(12, 13, 2, 3, a); r(11, 9, 2, 5, d); p(11, 8, 2, 2, s);
      p(12, 3, 2, 7, '#2b2d33'); p(12, 3, 2, 1, '#45484f'); p(13, 10, 1, 3, '#2b2d33'); break;
    case 'mug':
      l(2, 13, 2, 3, a); r(12, 13, 2, 3, a); l(3, 16, 2, 1, a); r(11, 16, 2, 1, a);
      p(6, 14, 4, 4, L.mug); p(6, 14, 4, 1, L.mugL); p(7, 14, 2, 1, '#4a2e1c'); p(5, 15, 1, 2, s); p(10, 15, 1, 2, s); break;
    case 'panic': l(2, 6, 2, 7, a); r(12, 6, 2, 7, a); p(3 - big, 3, 2, 3, s); p(11 + big, 3, 2, 3, s); break;
    case 'walk':
      if (fr) { l(2, 13, 2, 5, a); l(2, 18, 2, 1, s); r(12, 13, 2, 4, a); r(12, 17, 2, 1, s); }
      else { l(2, 13, 2, 4, a); l(2, 17, 2, 1, s); r(12, 13, 2, 5, a); r(12, 18, 2, 1, s); }
      break;
    case 'talk':
      l(2, 13, 2, 6, a); l(2, 19, 2, 1, s); r(12, 13, 2, 3, a); r(11, 15, 2, 2, a); p(9, fr ? 13 : 14, 2, 2, s); break;
    case 'clip': l(2, 13, 2, 3, a); r(12, 13, 2, 3, a); l(3, 15, 2, 1, a); r(11, 15, 2, 1, a); break;
    case 'lean': break;
    default: l(2, 13, 2, 6, a); r(12, 13, 2, 6, a); l(2, 19, 2, 1, s); r(12, 19, 2, 1, s);
  }
}

function armsFront(p, L, pose, fr) {
  const s = L.skin;
  if (pose === 'type') { p(4, fr ? 18 : 17, 2, 1, s); p(10, fr ? 17 : 18, 2, 1, s); }
  else if (pose === 'chin' || pose === 'sip' || pose === 'phone') p(4, 18, 2, 1, s);
  else if (pose === 'clip') {      // a clipboard held up at the chest, pitches on it
    p(4, 10, 8, 9, '#8a5a2b'); p(5, 11, 6, 7, '#f6f3ea'); p(6, 9, 4, 2, '#b9bec9'); p(6, 9, 4, 1, '#dfe3ea');
    p(6, 13, 4, 1, '#9aa3ae'); p(6, 15, 3, 1, '#9aa3ae'); p(6, 17, 4, 1, '#c0392b');
    p(3, 15, 2, 2, s); p(11, 15, 2, 2, s);
  }
}

// Pose, expression and monitor mode for a status.
function poseFor(status, t, L) {
  switch (status) {
    case 'working': return { pose: 'type', frame: Math.floor((t + L.phase) / 170) % 2, glow: true, screen: 'work', expr: 'normal' };
    case 'thinking': return { pose: 'chin', expr: 'up', screen: 'think' };
    case 'blocked': return { pose: 'raise', standing: true, frame: Math.floor(t / 280) % 2, expr: 'open', screen: 'block' };
    case 'error': return { pose: 'panic', expr: 'wide', screen: 'error' };
    case 'done': return { pose: 'mug', expr: 'happy', screen: 'off' };
    case 'idle': default: {
      const c = (t + L.phase * 3) % 9000;
      return c < 1500 ? { pose: 'sip', expr: 'closed', screen: 'idle', sipping: true } : { pose: 'lean', expr: 'look', mouth: 'smile', screen: 'idle', dy: 1 };
    }
  }
}

// ============================================================ effects (pixel glyphs)
function fxBang(x, y, t) {
  if (Math.floor(t / 350) % 2) return;
  R(x - 3, y, 7, 10, '#c62828'); R(x - 2, y - 1, 5, 1, '#c62828'); R(x - 2, y + 10, 5, 1, '#c62828'); R(x - 1, y + 11, 2, 1, '#c62828');
  R(x, y + 2, 1, 4, '#ffffff'); R(x, y + 7, 1, 1, '#ffffff');
}
const GLYPH_Q = ['###', '..#', '.##', '.#.', '...', '.#.'];
function fxHuh(x, y, t) {
  const jit = Math.floor(t / 120) % 4 === 0 ? 1 : 0;
  x += jit;
  R(x - 1, y - 1, 11, 9, '#3a1d00'); R(x, y, 9, 7, '#ff9f1c');
  GLYPH_Q.forEach((row, j) => { for (let i = 0; i < 3; i++) if (row[i] === '#') R(x + 1 + i, y + j, 1, 1, '#2a1400'); });
  R(x + 6, y, 1, 4, '#2a1400'); R(x + 6, y + 5, 1, 1, '#2a1400');
}
function fxCloud(x, y, t, flip) {
  const O = '#5b6475', F = '#ffffff';
  const tx = flip ? x + 19 : x - 4;
  R(tx, y + 10, 2, 2, F); R(tx - 1, y + 10, 1, 2, O); R(tx + 2, y + 10, 1, 2, O); R(tx, y + 9, 2, 1, O); R(tx, y + 12, 2, 1, O);
  R(flip ? x + 17 : x - 1, y + 7, 1, 1, O);
  R(x + 2, y, 13, 1, O); R(x + 1, y + 1, 1, 1, O); R(x + 15, y + 1, 1, 1, O);
  R(x, y + 2, 1, 4, O); R(x + 16, y + 2, 1, 4, O); R(x + 1, y + 6, 1, 1, O); R(x + 15, y + 6, 1, 1, O); R(x + 2, y + 7, 13, 1, O);
  R(x + 2, y + 1, 13, 6, F); R(x + 1, y + 2, 15, 4, F);
  const n = 1 + Math.floor(t / 380) % 3;
  for (let i = 0; i < n; i++) R(x + 4 + i * 4, y + 3, 2, 2, '#3a4150');
}
function fxSmoke(x, y, t) {
  for (let i = 0; i < 3; i++) {
    const ph = ((t / 1100) + i / 3) % 1;
    const s = 2 + Math.round(ph * 3);
    const px = Math.round(x + Math.sin((t / 300) + i * 2) * 2 + ph * 3);
    const py = Math.round(y - ph * 12);
    G.globalAlpha = 0.75 * (1 - ph);
    R(px - (s >> 1), py - (s >> 1), s, s, ph < 0.3 ? '#4a4a50' : '#8d8f96');
    R(px - (s >> 1) - 1, py - (s >> 1) + 1, s + 2, s - 2 > 0 ? s - 2 : 1, ph < 0.3 ? '#4a4a50' : '#8d8f96');
  }
  G.globalAlpha = 1;
}
function fxSteam(x, y, t, rise) {
  rise = rise || 3;
  for (let i = 0; i < 3; i++) {
    const ph = ((t / 900) + i / 3) % 1;
    G.globalAlpha = 0.75 * (1 - ph);
    R(Math.round(x + Math.sin(t / 250 + i * 2.1) * 0.8), Math.round(y - ph * rise), 1, 1, '#ffffff');
  }
  G.globalAlpha = 1;
}

// ============================================================ pixel lettering (our own bitmap font)
const BIG_FONT = {
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  N: ['#...#', '##..#', '#.#.#', '#.#.#', '#..##', '#...#', '#...#'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  ' ': ['...', '...', '...', '...', '...', '...', '...'],
};
const SMALL_FONT = {
  P: ['##.', '#.#', '##.', '#..', '#..'], A: ['.#.', '#.#', '###', '#.#', '#.#'], E: ['###', '#..', '##.', '#..', '###'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'], C: ['.##', '#..', '#..', '#..', '.##'], O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'], N: ['#..#', '##.#', '#.##', '#..#', '#..#'], Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  I: ['###', '.#.', '.#.', '.#.', '###'], ',': ['..', '..', '..', '.#', '#.'], '.': ['.', '.', '.', '.', '#'], ' ': ['..', '..', '..', '..', '..'],
  W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'], S: ['.##', '#..', '.#.', '..#', '##.'], T: ['###', '.#.', '.#.', '.#.', '.#.'],
  B: ['##.', '#.#', '##.', '#.#', '##.'], D: ['##.', '#.#', '#.#', '#.#', '##.'], L: ['#..', '#..', '#..', '#..', '###'],
  "'": ['#', '#', '.', '.', '.'], H: ['#.#', '#.#', '###', '#.#', '#.#'], U: ['#.#', '#.#', '#.#', '#.#', '###'], G: ['.##', '#..', '#.#', '#.#', '.##'],
};
function textWidth(font, s) { let w = 0; for (const ch of s) w += (font[ch] || font[' '])[0].length + 1; return Math.max(0, w - 1); }
function drawText(font, s, x, y, c) {
  for (const ch of s) {
    const g = font[ch] || font[' '];
    g.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === '#') R(x + i, y + j, 1, 1, c); });
    x += g[0].length + 1;
  }
}

// ============================================================ furniture
function drawDesk(x, top, w, kind) {
  const mgr = kind === 'mgr';
  const topC = mgr ? '#a8703d' : '#c99a62', hi = mgr ? '#c08650' : '#ddb17b', front = mgr ? '#865528' : '#a87645', edge = mgr ? '#68401f' : '#8a5c33';
  R(x, top, w, 5, topC); R(x, top, w, 1, hi);
  R(x, top + 5, w, 8, front); R(x, top + 5, w, 1, edge); R(x, top + 12, w, 1, edge);
  R(x, top + 5, 1, 8, edge); R(x + w - 1, top + 5, 1, 8, edge);
  if (mgr) { R(x + 3, top + 7, w - 6, 1, dark(front, 0.12)); R(x + 3, top + 10, w - 6, 1, dark(front, 0.12)); }
  else if (w > 28) { R(x + w - 11, top + 7, 8, 4, light(front, 0.08)); R(x + w - 8, top + 9, 2, 1, '#e3c9a0'); }
  G.fillStyle = 'rgba(60,40,20,0.28)'; G.fillRect(x + 1, top + 13, w - 2, 1);
}
// The far half of a facing pair: we look down at its top, its drawers face the person sitting at it.
function drawDeskUp(x, top, w) {
  R(x, top, w, 8, '#c99a62'); R(x, top, w, 1, '#b88a55'); R(x, top + 7, w, 1, '#ddb17b');
  R(x, top + 8, w, 3, '#8a5c33'); R(x + 3, top + 8, 9, 3, '#a87645'); R(x + w - 12, top + 8, 9, 3, '#a87645');
  G.fillStyle = 'rgba(60,40,20,0.25)'; G.fillRect(x + 1, top + 11, w - 2, 1);
}
function drawBench(x, top, w) {
  R(x, top, w, 4, '#b7905c'); R(x, top, w, 1, '#d3ad78');
  R(x + 1, top + 4, 2, 9, '#6e5638'); R(x + w - 3, top + 4, 2, 9, '#6e5638'); R(x + 1, top + 9, w - 2, 1, '#6e5638');
  R(x + 4, top + 5, w - 8, 3, '#8a6c46');
  G.fillStyle = 'rgba(40,30,20,0.25)'; G.fillRect(x + 1, top + 13, w - 2, 1);
}
function drawChair(sx, top, kind, L) {
  if (kind === 'mgr') { R(sx + 1, top + 3, 14, 15, '#4b2d29'); R(sx + 2, top + 2, 12, 1, '#4b2d29'); R(sx + 2, top + 3, 12, 1, '#6b4039'); R(sx + 1, top + 3, 1, 15, '#3a221f'); }
  else if (kind === 'break') { R(sx + 2, top + 6, 12, 2, '#8a5c33'); R(sx + 2, top + 8, 1, 10, '#8a5c33'); R(sx + 13, top + 8, 1, 10, '#8a5c33'); R(sx + 3, top + 8, 10, 6, '#d07a4a'); R(sx + 3, top + 8, 10, 1, '#e3946a'); R(sx + 3, top + 14, 10, 1, '#a85a32'); }
  else if (kind === 'conf') { R(sx + 2, top + 4, 12, 14, '#2f3340'); R(sx + 3, top + 3, 10, 1, '#2f3340'); R(sx + 3, top + 4, 10, 1, '#4a5062'); }
  else if (kind === 'stool') { R(sx + 4, top + 12, 8, 2, '#5a5f68'); R(sx + 7, top + 14, 2, 4, '#3a3f48'); }
  else { const c = L ? L.chair : '#3d4250'; R(sx + 2, top + 5, 12, 13, c); R(sx + 3, top + 4, 10, 1, c); R(sx + 3, top + 5, 10, 1, light(c, 0.18)); }
}
// a chair seen from behind: the back covers the sitter's lower half
function drawChairBack(sx, top, c) {
  R(sx + 2, top, 12, 9, c); R(sx + 3, top - 1, 10, 1, c); R(sx + 3, top, 10, 1, light(c, 0.2)); R(sx + 2, top + 8, 12, 1, dark(c, 0.3));
  R(sx + 7, top + 9, 2, 3, '#2a2d34'); R(sx + 4, top + 12, 8, 1, '#2a2d34');
}
const CODE_C = ['#8be9a8', '#f2c14e', '#ff8fa3', '#9ecbff', '#d6d6e0'];
function drawMonitor(x, y, w, h, mode, t, seed) {
  if (mode === 'work' || mode === 'error') {
    const c = mode === 'work' ? '120,220,255' : '255,110,70';
    G.fillStyle = `rgba(${c},0.16)`; G.fillRect(x - 2, y - 1, w + 4, h - 1); G.fillRect(x - 1, y - 2, w + 2, h + 1);
    G.fillStyle = `rgba(${c},0.22)`; G.fillRect(x - 1, y + h + 2, w + 2, 2);
  }
  R(x, y, w, h, '#2b2f3a'); R(x, y + h - 1, w, 1, '#1d2028');
  const sx = x + 1, sy = y + 1, sw = w - 2, sh = h - 3;
  if (mode === 'work' || mode === 'think') {
    R(sx, sy, sw, sh, '#173651');
    const scroll = mode === 'work' ? Math.floor(t / 160) : 0;
    for (let i = 0; i < sh; i++) {
      const k = i + scroll + seed;
      if (k % 2) continue;
      const hh = hash2(k, seed);
      const len = 2 + (hh % Math.max(1, sw - 3));
      R(sx + 1 + ((hh >> 5) & 1), sy + i, Math.min(len, sw - 2), 1, CODE_C[(hh >> 8) % CODE_C.length]);
    }
    if (mode === 'think' && Math.floor(t / 500) % 2) R(sx + sw - 3, sy + sh - 2, 1, 2, '#ffffff');
  } else if (mode === 'idle') {
    R(sx, sy, sw, sh, '#0d131d');
    const period = 2 * (sw - 1), ph = Math.floor((t + seed * 97) / 220);
    const bx = Math.abs((ph % period) - (sw - 1)), by = Math.abs((Math.floor(ph * 0.7) % (2 * (sh - 1) || 1)) - (sh - 1));
    R(sx + bx, sy + by, 1, 1, ['#5af', '#fa5', '#5fa', '#f5a'][Math.floor(ph / 9) % 4]);
  } else if (mode === 'block') {
    R(sx, sy, sw, sh, '#173651');
    R(sx + 1, sy + 1, sw - 2, sh - 2, Math.floor(t / 350) % 2 ? '#f0b429' : '#d07a10');
    R(sx + 2, sy + 2, Math.max(1, sw - 5), 1, '#fff7dd');
  } else if (mode === 'error') {
    R(sx, sy, sw, sh, Math.floor(t / 90) % 5 === 0 ? '#3a0c0c' : '#7a1717');
    R(sx + (sw >> 1) - 1, sy + 1, 1, 1, '#ffd1c9'); R(sx + (sw >> 1) + 1, sy + 1, 1, 1, '#ffd1c9'); R(sx + (sw >> 1), sy + 2, 1, 1, '#ffd1c9');
    R(sx + (sw >> 1) - 1, sy + 3, 1, 1, '#ffd1c9'); R(sx + (sw >> 1) + 1, sy + 3, 1, 1, '#ffd1c9');
  } else {
    R(sx, sy, sw, sh, '#1a1f28'); R(sx, sy, 2, 1, '#323a48');
  }
  R(x + (w >> 1) - 1, y + h, 2, 2, '#3a3f4b'); R(x + (w >> 1) - 3, y + h + 2, 6, 1, '#3a3f4b');
}
function drawLaptop(cx, top, mode, t) {
  R(cx - 4, top - 6, 9, 6, '#b9bec9'); R(cx - 4, top - 6, 9, 1, '#d7dbe3'); R(cx - 4, top - 1, 9, 1, '#8f95a1');
  if (mode === 'work' || mode === 'think' || mode === 'block') { G.fillStyle = mode === 'block' ? 'rgba(255,190,60,0.8)' : 'rgba(140,215,255,0.75)'; G.fillRect(cx - 4, top - 7, 9, 1); }
  if (mode === 'error') { G.fillStyle = Math.floor(t / 150) % 2 ? 'rgba(255,90,60,0.9)' : 'rgba(255,90,60,0.4)'; G.fillRect(cx - 4, top - 7, 9, 1); }
  R(cx - 5, top, 11, 1, '#9aa0ab');
}
function drawKeyboard(x, top, mouse) { R(x, top + 1, 10, 2, '#d8dbe2'); R(x, top + 3, 10, 1, '#a9aeb9'); R(x + 1, top + 1, 1, 1, '#b9bec9'); R(x + 5, top + 2, 1, 1, '#b9bec9'); if (mouse) R(x + 12, top + 2, 2, 1, '#d8dbe2'); }
function drawMug(x, top, c) { R(x, top - 2, 3, 3, c); R(x, top - 2, 3, 1, light(c, 0.3)); R(x + 3, top - 1, 1, 1, c); }
function drawDeskPlant(x, top) { R(x, top - 3, 4, 3, '#b8653a'); R(x, top - 3, 4, 1, '#cf7a4c'); R(x - 1, top - 6, 2, 3, '#4f9a4f'); R(x + 1, top - 8, 2, 5, '#3f8a45'); R(x + 3, top - 6, 2, 3, '#62b25c'); }
function drawPapers(x, top) { R(x, top + 1, 6, 3, '#f3efe4'); R(x + 1, top, 6, 3, '#fbf8f0'); R(x + 2, top + 1, 4, 1, '#c9c2b0'); }
function drawFloorPlant(x, y) {
  R(x + 2, y + 10, 8, 7, '#b8653a'); R(x + 2, y + 10, 8, 1, '#d0804f'); R(x + 3, y + 16, 6, 1, '#8a4627');
  R(x + 4, y, 3, 10, '#3f8a45'); R(x, y + 3, 4, 3, '#4f9a4f'); R(x + 7, y + 2, 4, 3, '#62b25c'); R(x + 1, y + 6, 4, 3, '#62b25c'); R(x + 7, y + 6, 4, 3, '#3f8a45'); R(x + 5, y - 2, 2, 3, '#62b25c');
}
function drawBox(x, y, w, h) { R(x, y, w, h, '#d9c49a'); R(x, y, w, 1, '#ecdcb6'); R(x + w - 1, y, 1, h, '#b9a275'); R(x + (w >> 1), y, 1, 2, '#b9a275'); R(x + 1, y + h - 3, 3, 2, '#2f4b7a'); }

// ---------- desk props (each prop sits on a desk top line)
function propCrossword(x, top) {
  R(x, top - 1, 10, 4, '#f1ede2'); R(x, top - 1, 10, 1, '#ffffff');
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) if ((i + j) % 2) R(x + 1 + i * 2, top + j, 1, 1, '#2a2a2a');
  R(x + 6, top, 3, 1, '#9a9a9a'); R(x + 10, top - 3, 1, 4, '#2f6fb5');
}
function propCat(x, top) {
  R(x + 1, top - 5, 4, 5, '#f4f2ee'); R(x + 1, top - 6, 1, 1, '#f4f2ee'); R(x + 4, top - 6, 1, 1, '#f4f2ee'); R(x + 5, top - 3, 1, 3, '#f4f2ee');
  R(x + 2, top - 4, 1, 1, '#3a3a3a'); R(x + 4, top - 4, 1, 1, '#3a3a3a'); R(x + 3, top - 3, 1, 1, '#e89aa0'); R(x, top, 7, 1, '#9a8a7a');
}
function propCandyJar(x, top) {
  R(x, top - 7, 6, 7, 'rgba(205,232,245,0.55)'); R(x, top - 7, 1, 7, 'rgba(255,255,255,0.7)'); R(x + 1, top - 8, 4, 1, '#c0392b');
  const cs = ['#e74c3c', '#f1c40f', '#3498db', '#2ecc71', '#e67e22', '#9b59b6'];
  for (let j = 0; j < 4; j++) for (let i = 0; i < 2; i++) R(x + 1 + i * 2 + (j & 1), top - 1 - j, 1, 1, cs[(i + j * 2) % cs.length]);
}
function propPrintMug(x, top) {
  R(x, top - 5, 5, 5, '#fbfbf7'); R(x, top - 5, 5, 1, '#ffffff'); R(x + 5, top - 4, 1, 3, '#e3e3dc');
  R(x + 1, top - 4, 3, 1, '#1e1e22'); R(x + 1, top - 2, 3, 1, '#1e1e22'); R(x, top, 6, 1, 'rgba(0,0,0,0.15)');
}
function propFlowers(x, top) {
  R(x + 1, top - 3, 3, 3, '#5b7fb8'); R(x + 2, top - 6, 1, 3, '#4f9a4f'); R(x + 1, top - 5, 1, 1, '#4f9a4f'); R(x + 3, top - 5, 1, 1, '#4f9a4f');
  R(x + 1, top - 8, 2, 2, '#e85d8a'); R(x + 3, top - 7, 2, 2, '#f6d55c'); R(x, top - 6, 1, 1, '#e85d8a');
}
function propCandyDish(x, top) {
  R(x, top - 2, 8, 2, 'rgba(210,232,245,0.85)'); R(x + 1, top, 6, 1, '#b9c9d6');
  R(x + 1, top - 3, 1, 1, '#e74c3c'); R(x + 3, top - 3, 1, 1, '#f1c40f'); R(x + 5, top - 3, 1, 1, '#3498db'); R(x + 2, top - 4, 1, 1, '#2ecc71'); R(x + 4, top - 4, 1, 1, '#e67e22');
}
// prop name (theme.props) -> painter at (x, desk top line)
const PROPS = {
  bossMug: propPrintMug, mug: (x, top, L) => drawMug(x, top, L ? L.mug : '#2e2e36'), plant: drawDeskPlant, papers: (x, top) => drawPapers(x, top + 1),
  crossword: propCrossword, cat: propCat, candyJar: propCandyJar, flowers: propFlowers, candyDish: propCandyDish,
};
function propPhone(x, top, light, off) {
  R(x, top - 3, 10, 4, '#2c2f36'); R(x + 1, top - 2, 6, 1, '#4a4e58'); R(x + 1, top - 1, 1, 1, '#8a8f99'); R(x + 3, top - 1, 1, 1, '#8a8f99'); R(x + 5, top - 1, 1, 1, '#8a8f99');
  if (!off) { R(x - 1, top - 5, 9, 2, '#3a3e47'); R(x - 1, top - 5, 2, 1, '#555a65'); }
  R(x + 8, top - 2, 1, 1, light);
}

// ============================================================ state
let STATE = null;
let AG = new Map();             // id -> agent
let KIDS = new Map();           // id -> [child agents]
let TOPS = [];
let serverMs = Date.now(), wallAtFetch = Date.now();
const changedAt = new Map(), lastStatus = new Map();
let firstLoad = true, online = true;
// The scout: its hc status and its pitches. It proposes, the owner assigns from the roster.
const RE_PITCH = /^p-[a-z0-9-]{1,40}$/;
let SCOUT = { terminal: null, status: 'offline', activity: {}, pitches: [] };
function normScout(sc) {
  const o = sc && typeof sc === 'object' ? sc : {};
  const pitches = Array.isArray(o.pitches) ? o.pitches.filter((p) => p && typeof p.id === 'string' && RE_PITCH.test(p.id) && PITCH_LABEL[p.status]) : [];
  return { terminal: typeof o.terminal === 'string' ? o.terminal : null, status: typeof o.status === 'string' ? o.status : 'offline', activity: o.activity || {}, pitches };
}
const scoutIn = () => !!(scoutId && AG.has(scoutId));
// the scout can be off for good: config turns it off, or there is no Herdr (hc) to run it in
const scoutOff = () => (FIXTURE || SCENE ? false : !SCOUT_CFG.enabled || !!(STATE && STATE.scout && STATE.scout.enabled === false));   // fixtures always demo the scout
function scoutOffWhy() {
  if (STATE && STATE.scout && typeof STATE.scout.reason === 'string' && STATE.scout.reason) return STATE.scout.reason;
  if (!SCOUT_CFG.enabled) return 'The scout is off in config.json.';
  return `${SC_FIRST} (hc terminal ${SCOUT_CFG.name}) is not running. Start it with ${SCOUT_CFG.start_hint}`;
}
const openPitches = () => SCOUT.pitches.filter((p) => p.status === 'open');
function scouting() { const a = scoutId && AG.get(scoutId); return !!a && (a.status === 'working' || a.status === 'thinking'); }

function normalize(a) {
  const st = STATUSES.includes(a.status) ? a.status : 'idle';
  return Object.assign({}, a, {
    status: st,
    name: a.name || a.id,
    role: a.role || 'Temp',
    department: a.department || 'office',
    activity: Object.assign({ tool: null, target: null, text: null }, a.activity || {}),
  });
}

function ingest(state) {
  STATE = state;
  SCOUT = normScout(state.scout);
  for (const p of SCOUT.pitches) if (p.status !== 'open') { pitchSent.delete(p.id); if (!pitchBusy.has(p.id)) pitchErr.delete(p.id); }
  serverMs = Date.parse(state.generated_at) || Date.now();
  wallAtFetch = Date.now();
  AG = new Map();
  for (const a of (state.agents || [])) if (a && a.id) AG.set(a.id, normalize(a));
  KIDS = new Map(); TOPS = [];
  for (const a of AG.values()) {
    a._top = !hasLiveAncestor(a);
    if (a._top) TOPS.push(a);
    else { if (!KIDS.has(a.parent_id)) KIDS.set(a.parent_id, []); KIDS.get(a.parent_id).push(a); }
  }
  const newlyBlocked = [];
  for (const a of AG.values()) {
    const prev = lastStatus.get(a.id);
    if (!firstLoad && prev !== 'blocked' && a.status === 'blocked') newlyBlocked.push(a.id);
    if (prev === undefined) changedAt.set(a.id, firstLoad ? (Date.parse(a.last_active_at) || serverMs) - 60000 : serverMs);
    else if (prev !== a.status) changedAt.set(a.id, serverMs);
    lastStatus.set(a.id, a.status);
  }
  for (const id of [...lastStatus.keys()]) if (!AG.has(id)) { lastStatus.delete(id); changedAt.delete(id); }
  assignCast();
  for (const id of newlyBlocked) notifyBlocked(AG.get(id));
  for (const key of [...lookCache.keys()]) { const id = key.slice(key.indexOf('|') + 1); if (id && !AG.has(id)) lookCache.delete(key); }
  relayout(false);
  firstLoad = false;
  overlayDirty = true;
  updateChrome();
}
function hasLiveAncestor(a) {
  if (!a.parent_id || !AG.has(a.parent_id) || a.parent_id === a.id) return false;
  const seen = new Set([a.id]);
  let p = AG.get(a.parent_id);
  while (p) {
    if (seen.has(p.id)) return false;          // cycle: treat as top-level
    seen.add(p.id);
    if (!p.parent_id || !AG.has(p.parent_id)) return true;
    p = AG.get(p.parent_id);
  }
  return true;
}
const serverNow = () => serverMs + (Date.now() - wallAtFetch);
const startMs = (a) => { const t = Date.parse(a.started_at); return Number.isFinite(t) ? t : Infinity; };
const byAge = (a, b) => startMs(a) - startMs(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
function kidSort(a, b) {
  const ka = a.kind === 'terminal_child' ? 0 : 1, kb = b.kind === 'terminal_child' ? 0 : 1;
  if (ka !== kb) return ka - kb;
  return (Date.parse(a.started_at) || 0) - (Date.parse(b.started_at) || 0) || (a.id < b.id ? -1 : 1);
}
function kidsOf(id) { return (KIDS.get(id) || []).slice().sort(kidSort); }
function blockedCount() { let n = 0; for (const a of AG.values()) if (a.status === 'blocked') n++; return n; }
function rootOf(a) { const seen = new Set(); while (a && !a._top && AG.has(a.parent_id) && !seen.has(a.id)) { seen.add(a.id); a = AG.get(a.parent_id); } return a; }

// ============================================================ casting: agent -> character, stable, persisted
const STORE_KEY = BRAND.store + '-cast:' + (SCENE ? 'scene-' + SCENE : FIXTURE ? 'fixture-' + FIXTURE : 'live');
let CASTMAP = new Map();        // agent id -> character key (a theme cast key, or 'temp:3')
let OCC = new Map();            // character key -> agent id
let LANES = new Map();          // top-level agent id -> lanyard index
(function loadCast() {
  if (SCENE) return;          // scenes cast fresh every load, so each take is the same
  try {
    const raw = store.get(STORE_KEY);
    if (!raw) return;
    const j = JSON.parse(raw);
    // v2: the scout's character is only ever the scout. An older save may hand it to the oldest session: drop that once.
    const v2 = j && j.v === 2;
    if (j && typeof j.cast === 'object') for (const [k, v] of Object.entries(j.cast)) if (typeof v === 'string' && (v2 || v !== SCOUT_CH)) CASTMAP.set(k, v);
    if (j && typeof j.lan === 'object') for (const [k, v] of Object.entries(j.lan)) if (Number.isInteger(v)) LANES.set(k, v);
  } catch (e) { CASTMAP = new Map(); LANES = new Map(); }
})();
function saveCast() {
  try { store.set(STORE_KEY, JSON.stringify({ v: 2, cast: Object.fromEntries(CASTMAP), lan: Object.fromEntries(LANES) })); } catch (e) { /* memory only */ }
}
let scoutId = null;
function assignCast() {
  for (const id of [...CASTMAP.keys()]) if (!AG.has(id)) CASTMAP.delete(id);          // release on leave
  for (const id of [...LANES.keys()]) if (!AG.has(id) || !AG.get(id)._top) LANES.delete(id);
  // The scout's character: only ever the scout terminal. Nobody else is cast as it, and nobody is promoted.
  const scouts = [...AG.values()].filter((a) => a.kind === 'scout').sort(byAge);
  scoutId = scouts.length ? scouts[0].id : null;
  const taken = new Set();
  for (const a of [...AG.values()].sort(byAge)) {
    const ch = CASTMAP.get(a.id);
    if (!ch) continue;
    const ok = a.id === scoutId ? ch === SCOUT_CH
      : ch !== SCOUT_CH && !taken.has(ch) && (isTemp(ch) ? tempN(ch) > 0 : (POOLS[poolFor(a)] || []).includes(ch));
    if (ok) taken.add(ch); else CASTMAP.delete(a.id);      // a stale entry (or an old non-scout scout character) gives it up
  }
  for (const a of [...AG.values()].sort(byAge)) {
    if (CASTMAP.has(a.id)) continue;
    let ch = null;
    if (a.id === scoutId) ch = SCOUT_CH;
    else ch = (POOLS[poolFor(a)] || []).find((c) => !taken.has(c)) || null;
    if (!ch) { let n = 1; while (taken.has('temp:' + n)) n++; ch = 'temp:' + n; }
    CASTMAP.set(a.id, ch); taken.add(ch);
  }
  OCC = new Map();
  for (const [id, ch] of CASTMAP) OCC.set(ch, id);
  // lanyards: one color per top-level family, kept for the family's lifetime
  const used = new Map();
  for (const v of LANES.values()) used.set(v, (used.get(v) || 0) + 1);
  for (const t of [...AG.values()].filter((a) => a._top).sort(byAge)) {
    if (LANES.has(t.id)) continue;
    let best = 0;
    for (let i = 0; i < LANYARDS.length; i++) if ((used.get(i) || 0) < (used.get(best) || 0)) best = i;
    LANES.set(t.id, best); used.set(best, (used.get(best) || 0) + 1);
  }
  saveCast();
}
const charOf = (id) => (id === RECEP_ID ? RECEP_CH : CASTMAP.get(id) || null);
function lookFor(a) { return lookOfChar(charOf(a.id) || 'temp:0', a.id); }
function lanyardOf(id) { const a = AG.get(id); if (!a) return null; const r = rootOf(a); const i = r ? LANES.get(r.id) : null; return i == null ? null : LANYARDS[i % LANYARDS.length]; }
function lanyardName(id) { const a = AG.get(id); const r = a && rootOf(a); const i = r ? LANES.get(r.id) : null; return i == null ? '' : LANYARD_NAMES[i % LANYARDS.length]; }
function nameOf(id) { return id === RECEP_ID ? CAST[RECEP_CH].name : charName(charOf(id)); }
function firstOf(id) { return charFirst(charOf(id)); }

// ============================================================ layout: the floor plan
let LAY = null, SCALE = 2, staticKey = '';
const DECOR = { clock: { x: 200, y: 27 }, phone: { x: 100, y: 92 } };

function buildLayout(W) {
  const lay = { W, seats: new Map(), charSeat: new Map(), fitsW: W >= MIN_W };
  const kx0 = W - KIT_W, T0 = WALL_H, T1 = WALL_H + TOP_H;
  const laneA = T1 + 8, D1 = T1 + 34, D2 = D1 + 46, M1 = D2 + 21, laneB = M1 + 9;
  Object.assign(lay, { kx0, T0, T1, laneA, D1, D2, M1, laneB });
  const ac0 = kx0 - ACC_W;
  lay.rooms = {
    reception: { x0: 0, x1: RCP_W }, boss: { x0: RCP_W, x1: RCP_W + MO_W }, conf: { x0: RCP_W + MO_W, x1: kx0 },
    kitchen: { x0: kx0, x1: W }, accounting: { x0: ac0, x1: kx0 }, bullpen: { x0: 14, x1: ac0 },
  };
  const seat = (key, char, kind, x, w, deskTop, laneY, extra) => {
    const s = Object.assign({ key, char, kind, x, w, deskTop, sx: x + ((w - 16) >> 1), laneY, gx: x - 4, named: true }, extra || {});
    s.top = kind === 'up' ? deskTop + 3 : deskTop - SEAT_DY;
    s.feet = kind === 'up' ? deskTop + 26 : deskTop - 1;
    lay.seats.set(key, s);
    if (char) lay.charSeat.set(char, key);
    return s;
  };
  // the receptionist (an NPC, not a seat)
  lay.recep = { x: 50, w: 74, deskTop: T0 + 34, sx: 79 };
  DECOR.phone = { x: 100, y: lay.recep.deskTop };
  // the scout's office
  seat(SCOUT_CH, SCOUT_CH, 'mgr', RCP_W + 26, 52, T0 + 38, laneA, { gx: RCP_W + MO_W - 15, sx: RCP_W + 44 });
  lay.bossDoor = RCP_W + MO_W - 15;
  // the bullpen, row 1: a facing pair, a side-by-side duo, then two singles with a second row behind
  const bx0 = 16, bw = ac0 - bx0 - 4;
  const widths = [44, 2 * DESK, DESK, DESK];
  const gap = clamp(Math.floor((bw - sum(widths)) / (widths.length + 1)), 6, 36);
  let x = bx0 + Math.max(gap, Math.floor((bw - sum(widths) - gap * (widths.length - 1)) / 2));
  seat(SLOT.pairFront, SLOT.pairFront, 'desk', x, 44, D1, laneA);
  seat(SLOT.pairBack, SLOT.pairBack, 'up', x, 44, D1 + 13, laneA);
  lay.pairX = x;
  x += 44 + gap;
  seat(SLOT.duo[0], SLOT.duo[0], 'desk', x, DESK, D1, laneA);
  seat(SLOT.duo[1], SLOT.duo[1], 'desk', x + DESK, DESK, D1, laneA, { gx: x + 2 * DESK + 3 });
  lay.spX = x;
  x += 2 * DESK + gap;
  seat(SLOT.row1[0], SLOT.row1[0], 'desk', x, DESK, D1, laneA);
  seat(SLOT.row2[0], SLOT.row2[0], 'desk', x, DESK, D2, laneB);
  x += DESK + gap;
  seat(SLOT.row1[1], SLOT.row1[1], 'desk', x, DESK, D1, laneA);
  seat(SLOT.row2[1], SLOT.row2[1], 'desk', x, DESK, D2, laneB);
  // the back room: a three-desk cluster
  const ax = ac0 + Math.floor((ACC_W - (2 * DESK + 4)) / 2);
  seat(SLOT.acc[0], SLOT.acc[0], 'desk', ax, DESK, D1, laneA);
  seat(SLOT.acc[1], SLOT.acc[1], 'desk', ax + DESK + 4, DESK, D1, laneA, { gx: ax + 2 * DESK + 8 });
  seat(SLOT.acc[2], SLOT.acc[2], 'desk', ac0 + ((ACC_W - DESK) >> 1), DESK, D2, laneB);
  lay.acc = { x0: ac0, x1: kx0, ax };
  // conference room: Plan agents (SLOT.conf), then Temps; the rest wrap into extra desks in the annex
  const cf = lay.rooms.conf;
  const tx0 = cf.x0 + 22, tx1 = cf.x1 - 10;
  const nChairs = clamp(Math.floor((tx1 - tx0 - 2) / 22), 2, 8);
  const span = nChairs * 22 - 6;
  const cx0 = tx0 + Math.floor((tx1 - tx0 - span) / 2);
  lay.conf = { tx0: cx0 - 8, tx1: cx0 + span + 8, top: T0 + 42, door: cf.x0 + 11, chairs: [], room: cf };
  for (let i = 0; i < nChairs; i++) lay.conf.chairs.push({ sx: cx0 + i * 22 });
  const confRank = (c) => (isTemp(c) ? 100 + tempN(c) : SLOT.conf.indexOf(c));
  const confChars = [...OCC.keys()].filter((c) => SLOT.conf.includes(c) || isTemp(c)).sort((a, b) => confRank(a) - confRank(b));
  const confHere = confChars.slice(0, nChairs), overflow = confChars.slice(nChairs);
  confHere.forEach((ch, i) => {
    const c = lay.conf.chairs[i];
    c.char = ch;
    seat('conf:' + i, ch, 'conf', c.sx - 2, 20, lay.conf.top, laneA, { sx: c.sx, gx: lay.conf.door, named: false });
  });
  // kitchen tables (done kids sit here with coffee)
  lay.kitchen = { x0: kx0, tables: [] };
  for (let ty = T0 + 46; ty + 18 <= M1 - 4; ty += 46) lay.kitchen.tables.push(ty);
  // lower band: a short hall on the left, the annex, the copier corner
  const L0 = M1, an0 = 16, an1 = Math.max(an0 + 4 * PITCH + 12, W - 132);
  const perRow = Math.max(3, Math.floor((an1 - an0 - 10) / PITCH));
  const head = SLOT.annexHead;
  const extras = ANNEX_EXTRAS.filter((c) => OCC.has(c)).concat(POOLS.annex.filter((c) => !head.includes(c) && !ANNEX_EXTRAS.includes(c) && OCC.has(c))).concat(overflow);
  const annexChars = head.concat(extras);
  const nRows = Math.ceil(annexChars.length / perRow);
  const rowW = Math.min(annexChars.length, perRow) * PITCH - (PITCH - DESK);
  const ax0 = an0 + Math.max(8, Math.floor((an1 - an0 - Math.max(rowW, 3 * PITCH)) / 2));
  annexChars.forEach((ch, i) => {
    const r = Math.floor(i / perRow), c = i % perRow;
    seat(i < head.length ? ch : 'annex:' + ch, ch, 'desk', ax0 + c * PITCH, DESK, L0 + 44 + r * ROW_H, laneB, { named: i < head.length });
  });
  const L1 = L0 + 44 + (nRows - 1) * ROW_H + 24;
  lay.annex = { x0: an0, x1: an1, y0: L0, y1: L1, rows: nRows };
  // warehouse, downstairs
  const WH0 = L1 + 14;
  lay.laneC = WH0 + 26;
  const benchTop = WH0 + 50;
  WAREHOUSE_CREW.forEach((ch, i) => seat(ch, ch, 'bench', 24 + i * 44, 36, benchTop, lay.laneC));
  const cage = { x0: W - 96, x1: W - 6, y0: WH0 + 20, y1: WH0 + 74 };
  lay.cage = cage;
  seat(SLOT.foreman, SLOT.foreman, 'cage', cage.x0 + 30, 44, benchTop, lay.laneC, { gx: cage.x0 + 9 });
  Object.assign(lay, { L0, L1, WH0 });
  lay.contentH = WH0 + 84;
  return lay;
}

function kitchenSpot(i) {
  const k = LAY.kitchen, x0 = k.x0, nSeats = k.tables.length * 3;
  if (i < nSeats) {
    const t = Math.floor(i / 3), j = i % 3;
    const ty = k.tables[t], cx = x0 + 22 + 22 * j;
    return { slot: i, cx, sx: cx - 8, top: ty - SEAT_DY, ty, feetY: ty - 1, table: t };
  }
  const j = i - nSeats;
  return { slot: i, cx: x0 + 88 - (Math.floor(j / 6) % 2) * 8, sx: x0 + 80 - (Math.floor(j / 6) % 2) * 8, feetY: LAY.T0 + 46 + (j % 6) * 18, standing: true };
}

function fitArea() {
  const narrow = window.matchMedia('(max-width: 1099px)').matches;
  const availW = Math.max(320, stageWrap.clientWidth);
  const headerH = $('#top').offsetHeight;
  const availH = Math.max(320, window.innerHeight - headerH - (narrow ? 24 : 32));
  return { availW, availH };
}

function relayout(snap) {
  const { availW, availH } = fitArea();
  let chosen = null;
  for (const s of [4, 3, 2]) {
    const lay = buildLayout(Math.floor(availW / s));
    if (!lay.fitsW) continue;
    if (lay.contentH * s <= availH) { chosen = { s, lay }; break; }
  }
  if (!chosen) chosen = { s: 2, lay: buildLayout(Math.max(MIN_W, Math.floor(availW / 2))) };
  const { s, lay } = chosen;
  lay.H = Math.max(lay.contentH, Math.floor(availH / s));
  LAY = lay; SCALE = s;
  if (buf.width !== lay.W || buf.height !== lay.H) { buf.width = lay.W; buf.height = lay.H; stat.width = lay.W; stat.height = lay.H; }
  if (canvas.width !== lay.W * s || canvas.height !== lay.H * s) {
    canvas.width = lay.W * s; canvas.height = lay.H * s;
    canvas.style.width = lay.W * s + 'px'; canvas.style.height = lay.H * s + 'px';
    stage.style.width = lay.W * s + 'px'; stage.style.height = lay.H * s + 'px';
  }
  const f = FS[s];
  stage.style.setProperty('--fs-plate', f[0] + 'px');
  stage.style.setProperty('--fs-bubble', f[1] + 'px');
  stage.style.setProperty('--fs-sign', f[2] + 'px');
  measureFonts();
  const key = layoutKey();
  if (key !== staticKey) { staticKey = key; drawStatic(); }
  syncActors(snap);
  overlayDirty = true;
}
function layoutKey() { return [LAY.W, LAY.H, SCALE, skyBand(), LAY.annex.rows, LAY.kitchen.tables.length, LAY.conf.chairs.length].join('|'); }

// ============================================================ actors and walking
const actors = new Map();
const breakSlots = [];
function takeSlot(id) { let i = breakSlots.indexOf(null); if (i < 0) { i = breakSlots.length; breakSlots.push(null); } breakSlots[i] = id; return i; }
function freeSlot(act) { if (act.slot != null) { if (breakSlots[act.slot] === act.id) breakSlots[act.slot] = null; act.slot = null; } }

function locSeat(seat) {
  const fx = seat.sx + 8;
  return { kind: 'seat', seatKey: seat.key, key: 's:' + seat.key + ':' + seat.sx + ',' + seat.feet, x: fx, y: seat.feet, legs: [[fx, seat.feet], [seat.gx, seat.feet], [seat.gx, seat.laneY]] };
}
function locBreak(slot) {
  const b = kitchenSpot(slot), kx = LAY.kitchen.x0 + 6;
  return { kind: 'break', key: 'b:' + slot + ':' + b.cx + ',' + b.feetY, slot, x: b.cx, y: b.feetY, spot: b, legs: [[b.cx, b.feetY], [kx, b.feetY], [kx, LAY.laneA]] };
}
function locDoor() { const y = LAY.T0 + 3; return { kind: 'door', key: 'door', x: 22, y, legs: [[22, y], [22, LAY.laneA]] }; }

function destLoc(a, act) {
  if (!a._top && a.status === 'done') {
    if (act.slot == null) act.slot = takeSlot(a.id);
    return locBreak(act.slot);
  }
  freeSlot(act);
  const ch = charOf(a.id), key = ch && LAY.charSeat.get(ch);
  const seat = key && LAY.seats.get(key);
  return seat ? locSeat(seat) : locDoor();
}

function route(from, to) {
  const a = from.legs, b = to.legs.slice().reverse();
  const pa = a[a.length - 1], pb = b[0];
  const mid = [];
  if (pa[1] !== pb[1]) mid.push([SPINE, pa[1]], [SPINE, pb[1]]);
  const pts = [];
  for (const q of [...a, ...mid, ...b]) { const l = pts[pts.length - 1]; if (!l || l[0] !== q[0] || l[1] !== q[1]) pts.push(q); }
  return pts.slice(1);
}
function startWalk(act, dest) {
  act.path = route(act.loc, dest);
  act.dest = dest; act.mode = 'walk'; act.x = act.loc.x; act.y = act.loc.y; act.walked = 0;
  overlayDirty = true;
}
function startLeave(act) { freeSlot(act); startWalk(act, locDoor()); act.mode = 'leave'; }

function syncActors(snap) {
  const now = performance.now();
  for (const a of AG.values()) {
    let act = actors.get(a.id);
    if (!act) {
      act = { id: a.id, mode: 'seat', loc: null, path: [], x: 0, y: 0, slot: null, born: now, gone: false };
      actors.set(a.id, act);
      act.look = lookFor(a);
      if (firstLoad) { act.loc = destLoc(a, act); act.mode = act.loc.kind === 'break' ? 'break' : 'seat'; act.fadeIn = 0; continue; }
      act.loc = locDoor(); act.fadeIn = now;
      startWalk(act, destLoc(a, act));
      continue;
    }
    act.gone = false; act.look = lookFor(a);
    if (act.mode === 'gone') { act.mode = 'seat'; act.loc = destLoc(a, act); act.fadeIn = now; continue; }
    if (act.mode === 'walk' || act.mode === 'leave') { act.mode = 'walk'; continue; }   // re-evaluated on arrival
    const dest = destLoc(a, act);
    if (dest.key !== act.loc.key) { if (snap) { act.loc = dest; act.mode = dest.kind === 'break' ? 'break' : 'seat'; } else startWalk(act, dest); }
    else act.loc = dest;
  }
  for (const [id, act] of actors) {
    if (AG.has(id) || act.gone) continue;
    act.gone = true;
    if (!act.loc || snap) { actors.delete(id); continue; }
    if (act.mode !== 'walk') startLeave(act);
  }
}

function arrive(act, now) {
  const a = AG.get(act.id);
  act.loc = act.dest;
  if (act.dest.kind === 'door' && !a) { act.mode = 'gone'; act.fadeOut = now; freeSlot(act); overlayDirty = true; return; }
  if (!a) { startLeave(act); return; }
  const want = destLoc(a, act);
  if (want.key !== act.loc.key) { startWalk(act, want); return; }
  act.mode = act.loc.kind === 'break' ? 'break' : 'seat';
  if (act.patrol) { act.patrol = false; act.nextPatrol = now + 6000; }
  overlayDirty = true;
}

// the scout scouting: while its loop works it walks out of its office, along the bullpen, and back
function patrolPath(seat) {
  const home = locSeat(seat), A = LAY.laneA, gx = seat.gx;
  const xR = LAY.acc.x0 - 8, xM = Math.round((gx + xR) / 2);
  return { home, path: [[gx, seat.feet], [gx, A], [xM, A, 2200], [xR, A, 2200], [Math.round((gx + xM) / 2), A, 1600], [gx, A], [gx, seat.feet], [home.x, home.y]] };
}
function tickScout(now) {
  const a = scoutId && AG.get(scoutId), act = a && actors.get(a.id);
  if (!act || act.mode !== 'seat' || !act.loc || act.loc.seatKey !== SCOUT_CH || !scouting() || now < (act.nextPatrol || 0)) return;
  const seat = LAY.seats.get(SCOUT_CH);
  if (!seat) return;
  const { home, path } = patrolPath(seat);
  act.loc = home; act.dest = home; act.path = path; act.mode = 'walk'; act.patrol = true;
  act.x = home.x; act.y = home.y; act.walked = 0;
  overlayDirty = true;
}

function stepActors(now, dt) {
  for (const [id, act] of actors) {
    if (act.mode === 'gone') { if (now - act.fadeOut > 450) actors.delete(id); continue; }
    if (act.mode !== 'walk' && act.mode !== 'leave') continue;
    if (act.pauseUntil) {                     // the scout stops at a desk to look over a shoulder
      if (now < act.pauseUntil && act.mode === 'walk' && AG.has(id)) continue;
      act.pauseUntil = 0; act.pauseQuip = null; overlayDirty = true;
    }
    let step = SPEED * dt;
    while (step > 0 && act.path.length) {
      const [tx, ty, pause] = act.path[0];
      const dx = tx - act.x, dy = ty - act.y, d = Math.hypot(dx, dy);
      if (Math.abs(dy) > Math.abs(dx)) act.up = dy < 0;
      else if (d > 0) act.up = false;
      if (d <= step) {
        act.x = tx; act.y = ty; step -= d; act.walked += d; act.path.shift();
        if (pause && act.path.length) { act.pauseUntil = now + pause; act.pauseQuip = SCOUT_QUIPS[Math.floor(Math.random() * SCOUT_QUIPS.length)]; act.up = false; overlayDirty = true; step = 0; }
      }
      else { act.x += dx / d * step; act.y += dy / d * step; act.walked += step; step = 0; }
    }
    if (!act.path.length) arrive(act, now);
  }
}

// ============================================================ static layer
function skyBand() { if (SKY[Q.get('sky')]) return Q.get('sky'); const h = new Date().getHours(); return h < 5 || h >= 21 ? 'night' : h < 7 ? 'dawn' : h < 17 ? 'day' : h < 19 ? 'gold' : 'dusk'; }
const SKY = { night: ['#141c38', '#283462', true], dawn: ['#e9a07f', '#f6d3a8', false], day: ['#8cc2ea', '#d2e9f6', false], gold: ['#eea667', '#f6d39e', false], dusk: ['#57478a', '#c47a7a', false] };
const CARPET = '#9da59f', CARPET_D = '#8f978f', CARPET_L = '#adb4ad';

function speckle(x0, y0, w, h, base, d, l) {
  R(x0, y0, w, h, base);
  for (let y = y0; y < y0 + h; y += 2) for (let x = x0; x < x0 + w; x += 2) {
    const k = hash2(x, y) & 31;
    if (k === 0) R(x, y, 1, 1, d); else if (k === 1) R(x + 1, y, 1, 1, l);
  }
}
function vWall(x, y0, y1, glass) {
  if (y1 <= y0) return;
  if (glass) { R(x - 1, y0, 3, y1 - y0, '#5b6980'); R(x, y0 + 2, 1, y1 - y0 - 4, '#b9d3e2'); }
  else { R(x - 2, y0, 4, y1 - y0, '#cfc6b4'); R(x - 2, y0, 1, y1 - y0, '#b5ab97'); R(x + 1, y0, 1, y1 - y0, '#e3dccd'); }
}
function hWall(x0, x1, y) { R(x0, y - 2, x1 - x0, 4, '#cfc6b4'); R(x0, y - 2, x1 - x0, 1, '#e3dccd'); R(x0, y + 1, x1 - x0, 1, '#b5ab97'); }

function drawStatic() {
  G = sctx;
  const { W, H, T0, T1, M1, kx0, L0, L1, WH0 } = LAY;
  G.clearRect(0, 0, W, H);
  // floors
  speckle(0, T0, W, L1 - T0, CARPET, CARPET_D, CARPET_L);
  speckle(0, T0, RCP_W, T1 - T0, '#a9aea6', '#9aa098', '#b7bcb4');                                  // reception
  for (let y = T0; y < M1; y += 8) for (let x = kx0; x < W; x += 8) R(x, y, 8, 8, ((x - kx0 + y - T0) / 8) % 2 ? '#e4dbc4' : '#d3c8ad');  // kitchen linoleum
  const an = LAY.annex;
  speckle(an.x0, L0, an.x1 - an.x0, L1 - L0, '#8e9eab', '#82929f', '#9babb7');                     // annex
  speckle(LAY.acc.x0 - 2, T1 + 14, LAY.acc.x1 - LAY.acc.x0 + 2, M1 - T1 - 14, '#a6a493', '#999786', '#b3b1a0');   // accounting rug
  G.fillStyle = 'rgba(235,245,255,0.06)';
  for (let x = 12; x < W - 24; x += 48) G.fillRect(x - 6, T0, 38, L1 - T0);
  wallStatic(W);
  receptionStatic();
  bossStatic();
  confStatic();
  kitchenStatic(W);
  bullpenStatic();
  annexStatic(W);
  warehouseStatic(W, H);
}

function wallStatic(W) {
  const { T0, kx0 } = LAY;
  R(0, 0, W, CEIL_H, '#e8e6df');
  for (let x = 0; x < W; x += 16) R(x, 0, 1, CEIL_H, '#d9d6cc');
  R(0, CEIL_H - 1, W, 1, '#c9c3b5');
  for (let x = 12; x < W - 24; x += 48) { R(x, 2, 26, 5, '#c6d3df'); R(x + 1, 3, 24, 3, '#f7fbff'); R(x + 12, 3, 1, 3, '#dbe6ef'); }
  const segs = [[0, RCP_W, '#e6decd'], [RCP_W, RCP_W + MO_W, '#e9e3d4'], [RCP_W + MO_W, kx0, '#e7e2d4'], [kx0, W, '#dfe5d3']];
  for (const [a, b, c] of segs) R(a, CEIL_H, b - a, T0 - CEIL_H, c);
  G.fillStyle = 'rgba(0,0,0,0.06)'; G.fillRect(0, CEIL_H, W, 3);
  R(0, T0 - 4, W, 4, '#8b7a63'); R(0, T0 - 4, W, 1, '#a08e74');
  for (const x of [RCP_W, RCP_W + MO_W, kx0]) { R(x - 2, CEIL_H, 4, T0 - CEIL_H, '#d6ccb8'); R(x - 2, CEIL_H, 1, T0 - CEIL_H, '#c4b9a3'); }
}

function drawWindow(x, y, w, h, blinds) {
  const [c1, c2, night] = SKY[skyBand()];
  R(x - 1, y - 1, w + 2, h + 2, '#d8cfbd'); R(x, y, w, h, '#f7f4ec');
  R(x + 2, y + 2, w - 4, h - 4, c2); R(x + 2, y + 2, w - 4, Math.floor((h - 4) / 2), c1);
  if (night) for (let i = 0; i < 5; i++) { const hh = hash2(x + i, y); R(x + 3 + hh % (w - 6), y + 3 + (hh >> 6) % 6, 1, 1, '#f4f1d0'); }
  let bx = x + 2;
  while (bx < x + w - 2) {
    const hh = hash2(bx, y + 7);
    const bw = 3 + hh % 5, bh = 4 + (hh >> 5) % 8;
    const ww = Math.min(bw, x + w - 2 - bx);
    R(bx, y + h - 2 - bh, ww, bh, night ? '#1d2742' : '#9fb3c4');
    if (night && ww > 2) for (let k = 0; k < 2; k++) if ((hh >> (9 + k)) & 1) R(bx + 1 + k, y + h - bh, 1, 1, '#f6d77a');
    bx += bw + 1;
  }
  R(x + (w >> 1) - 1, y + 2, 2, h - 4, '#f7f4ec');
  const n = blinds || 3;
  for (let i = 0; i < n; i++) R(x + 2, y + 2 + i * 2, w - 4, 1, 'rgba(244,238,224,0.95)');
  R(x - 2, y + h, w + 4, 2, '#ddd5c4');
}

function receptionStatic() {
  const { T0 } = LAY;
  // elevator: the way in and out
  const ex = 6, ew = 32, ey = 22;
  R(ex - 3, ey - 3, ew + 6, T0 - ey + 3, '#8d929b'); R(ex - 2, ey - 2, ew + 4, 1, '#a9aeb7');
  R(ex, ey, ew, T0 - ey, '#bcc2ca');
  R(ex + 15, ey, 2, T0 - ey, '#7c828c');
  for (let i = 0; i < 3; i++) { R(ex + 3 + i * 4, ey + 2, 1, T0 - ey - 4, '#cdd2d9'); R(ex + 19 + i * 4, ey + 2, 1, T0 - ey - 4, '#cdd2d9'); }
  R(ex + 8, ey - 9, 16, 5, '#23262d'); R(ex + 10, ey - 8, 1, 3, '#f2a43a'); R(ex + 9, ey - 7, 3, 1, '#f2a43a'); R(ex + 18, ey - 8, 3, 1, '#f2a43a'); R(ex + 18, ey - 6, 3, 1, '#f2a43a'); R(ex + 20, ey - 7, 1, 1, '#f2a43a');
  R(ex + ew + 1, ey + 16, 3, 7, '#9aa0aa'); R(ex + ew + 2, ey + 17, 1, 1, '#f2e6b0'); R(ex + ew + 2, ey + 20, 1, 1, '#f2e6b0');
  R(ex - 2, T0, ew + 4, 5, '#4f4338'); R(ex, T0 + 1, ew, 3, '#655648');
  // the sign: pixel lettering in our own bitmap font
  const sx0 = 44, sx1 = RCP_W - 4, cx = (sx0 + sx1) >> 1;
  const [sign1, sign2] = [String(BRAND.sign[0] || '').toUpperCase(), String(BRAND.sign[1] || '').toUpperCase()];
  const w1 = textWidth(BIG_FONT, sign1), w2 = textWidth(SMALL_FONT, sign2);
  R(sx0, 16, sx1 - sx0, 27, '#f4f1ea'); R(sx0, 16, sx1 - sx0, 1, '#ffffff'); R(sx0, 42, sx1 - sx0, 1, '#bdb3a0'); R(sx1 - 1, 16, 1, 27, '#cfc6b4');
  drawText(BIG_FONT, sign1, cx - (w1 >> 1), sign2 ? 20 : 26, '#1f2228');
  if (sign2) { R(cx - (w2 >> 1), 29, w2, 1, '#1f2228'); drawText(SMALL_FONT, sign2, cx - (w2 >> 1), 32, '#1f2228'); }
  // waiting chairs and a plant
  const wy = T0 + 52;
  for (const ax of [4, 20]) { R(ax, wy, 14, 7, '#4d6d9c'); R(ax, wy, 14, 1, '#6f8fbd'); R(ax - 1, wy + 7, 16, 6, '#5577a8'); R(ax - 1, wy + 7, 16, 1, '#7d9cc8'); R(ax - 1, wy + 13, 2, 3, '#3a3e48'); R(ax + 13, wy + 13, 2, 3, '#3a3e48'); }
  drawFloorPlant(36, T0 + 50);
  // wall between reception and the scout's office
  vWall(RCP_W, T0, LAY.T1, false);
}

function bossStatic() {
  const { T0, T1 } = LAY, x0 = RCP_W, x1 = RCP_W + MO_W;
  drawWindow(x0 + 52, 16, 40, 26, 6);
  // shelf with an award and some binders
  const sy = 34;
  R(x0 + 8, sy, 34, 2, '#7a5232'); R(x0 + 8, sy + 2, 34, 1, '#5e3d24');
  const bc = ['#c0392b', '#2f6fb5', '#e0b84e', '#4f9a4f', '#e9e4d8'];
  for (let i = 0; i < 5; i++) R(x0 + 10 + i * 3, sy - 7 + (i % 2), 2, 7 - (i % 2), bc[i]);
  const dx = x0 + 30;      // the award: the theme can draw its own, else a gold cup on a black base
  if (THEME.draw && THEME.draw.award) THEME.draw.award(R, dx, sy);
  else { R(dx - 1, sy - 2, 7, 2, '#1e1e22'); R(dx + 2, sy - 5, 1, 3, '#e3b341'); R(dx, sy - 10, 5, 5, '#e3b341'); R(dx, sy - 10, 5, 1, '#f2c85a'); R(dx - 1, sy - 9, 1, 2, '#e3b341'); R(dx + 5, sy - 9, 1, 2, '#e3b341'); R(dx + 1, sy - 6, 3, 1, '#b8862a'); }
  R(x0 + 8, 20, 12, 9, '#6b4a2e'); R(x0 + 9, 21, 10, 7, '#dfe8ef'); R(x0 + 10, 23, 3, 3, '#e6b58c'); R(x0 + 14, 22, 3, 4, '#e6b58c');  // a framed photo
  // filing cabinet and a plant
  R(x0 + 6, T0 + 2, 14, 22, '#9aa3ae'); R(x0 + 6, T0 + 2, 14, 1, '#c3cad3'); R(x0 + 19, T0 + 2, 1, 22, '#7d8692');
  for (let d = 0; d < 3; d++) { R(x0 + 7, T0 + 4 + d * 7, 12, 1, '#7d8692'); R(x0 + 11, T0 + 6 + d * 7, 4, 1, '#e3e7ec'); }
  drawFloorPlant(x1 - 18, T0 + 2);
  // guest chairs in front of the desk, seen from behind
  for (const gx of [x0 + 34, x0 + 54]) drawChairBack(gx, T0 + 56, '#6a4a3e');
  vWall(x1, T0, T1, true);
}

function confStatic() {
  const { T0 } = LAY, r = LAY.rooms.conf, w = r.x1 - r.x0;
  // whiteboard, windows
  R(r.x0 + 12, 17, 40, 24, '#aab0b8'); R(r.x0 + 13, 18, 38, 22, '#f8f8f5');
  R(r.x0 + 16, 22, 14, 1, '#3d6fb5'); R(r.x0 + 16, 25, 20, 1, '#3d6fb5'); R(r.x0 + 16, 28, 10, 1, '#c0392b');
  R(r.x0 + 36, 30, 2, 6, '#4f9a4f'); R(r.x0 + 40, 27, 2, 9, '#4f9a4f'); R(r.x0 + 44, 33, 2, 3, '#c0392b'); R(r.x0 + 15, 40, 34, 1, '#8a9099');
  for (let x = r.x0 + 74; x + 40 <= r.x1 - 6; x += 52) drawWindow(x, 16, 40, 26);
  const C = LAY.conf, tvx = C.tx1 + 10;
  if (r.x1 - tvx > 26) {          // a TV on a cart at the spare end of the table
    R(tvx, T0 + 22, 22, 14, '#1e2026'); R(tvx + 1, T0 + 23, 20, 11, '#2d3a4d'); R(tvx + 3, T0 + 25, 8, 1, '#5d7a9a');
    R(tvx + 2, T0 + 37, 18, 2, '#6a6f78'); R(tvx + 10, T0 + 39, 2, 14, '#5a5f68'); R(tvx + 2, T0 + 52, 18, 2, '#6a6f78'); R(tvx + 3, T0 + 54, 2, 2, '#2a2a2e'); R(tvx + 17, T0 + 54, 2, 2, '#2a2a2e');
  }
}

function kitchenStatic(W) {
  const { T0, M1, kx0, laneA } = LAY, x0 = kx0;
  // cabinets and a counter: coffee maker, microwave
  R(x0 + 4, 14, 44, 12, '#b88d5e'); R(x0 + 4, 14, 44, 1, '#d2a676'); R(x0 + 26, 14, 1, 12, '#8a6440'); R(x0 + 23, 19, 1, 2, '#e3c9a0'); R(x0 + 29, 19, 1, 2, '#e3c9a0'); R(x0 + 4, 26, 44, 1, '#8a6440');
  R(x0 + 4, T0 - 14, 44, 4, '#d9d4c8'); R(x0 + 4, T0 - 14, 44, 1, '#f1ede4');
  R(x0 + 4, T0 - 10, 44, 13, '#8fa3a8'); R(x0 + 4, T0 + 2, 44, 1, '#6c7f84'); R(x0 + 25, T0 - 9, 1, 11, '#7a8d92');
  R(x0 + 7, T0 - 30, 11, 16, '#2c2c30'); R(x0 + 7, T0 - 30, 11, 2, '#3c3c42'); R(x0 + 9, T0 - 21, 7, 6, 'rgba(180,215,230,0.55)'); R(x0 + 10, T0 - 18, 5, 3, '#5a3a22');
  R(x0 + 22, T0 - 24, 22, 10, '#d0d4d9'); R(x0 + 23, T0 - 23, 14, 8, '#2e3238'); R(x0 + 39, T0 - 23, 4, 8, '#9aa0a8'); R(x0 + 40, T0 - 21, 1, 1, '#4cc06a');
  // two vending machines
  const vm = (vx, body, hi) => {
    R(vx, 18, 20, T0 - 10, body); R(vx, 18, 20, 2, hi); R(vx + 2, 22, 11, 26, '#1f2a33');
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) R(vx + 3 + c * 3, 24 + r * 6, 2, 3, ['#f2c14e', '#e07b9b', '#5aa36a', '#5b7fb8', '#e9e4d8'][(r + c * 2 + vx) % 5]);
    R(vx + 14, 24, 4, 8, '#2c2c30'); R(vx + 15, 26, 2, 1, '#4cc06a'); R(vx + 2, 52, 11, 4, '#1a1a1e'); R(vx, T0 + 6, 20, 2, 'rgba(0,0,0,0.18)');
  };
  vm(x0 + 54, '#a8302f', '#c8504a');
  vm(x0 + 76, '#2f5fa8', '#5080c8');
  // fridge
  const fx = W - 24, fy = M1 - 56;
  R(fx, fy, 22, 52, '#b9c0c8'); R(fx + 1, fy + 1, 20, 50, '#eef0f2'); R(fx + 1, fy + 1, 20, 1, '#ffffff');
  R(fx + 1, fy + 18, 20, 1, '#b9c0c8'); R(fx + 17, fy + 4, 1, 9, '#9aa3ad'); R(fx + 17, fy + 22, 1, 12, '#9aa3ad');
  R(fx + 4, fy + 6, 2, 2, '#e07b9b'); R(fx + 8, fy + 8, 2, 2, '#f2c14e'); R(fx + 4, fy + 24, 7, 8, '#ffffff'); R(fx + 5, fy + 26, 2, 2, '#5b7fb8');
  // walls: left with a doorway onto the bullpen, bottom
  vWall(x0, T0, laneA - 14, false); vWall(x0, laneA + 6, M1, false);
  hWall(x0, W, M1);
}

function bullpenStatic() {
  const { T1, D1, acc } = LAY;
  // accounting: cubicle partition behind the cluster
  const px0 = acc.ax - 4, px1 = acc.ax + 2 * DESK + 8, py = D1 - 30;
  R(px0, py, px1 - px0, 2, '#5f6d84'); R(px0, py + 2, px1 - px0, 6, '#93a3b8');
  for (let x = px0 + 2; x < px1 - 1; x += 3) R(x, py + 3 + ((x >> 1) & 1) * 2, 1, 1, '#8495ab');
  R(px0, py + 8, px1 - px0, 1, '#73839a');
  // a copier-side water cooler and plants along the left wall of the bullpen
  drawFloorPlant(LAY.rooms.bullpen.x1 - 14, T1 + 10);
}

function annexStatic(W) {
  const { L0, L1, laneB } = LAY, an = LAY.annex;
  hWall(an.x0, an.x1 + 2, L0 + 1);
  vWall(an.x0 - 2, L0, laneB - 12, false); vWall(an.x0 - 2, laneB + 6, L1, false);
  vWall(an.x1, L0, L1, false);
  hWall(0, W, L1);
  // copier corner: the copier, a supply shelf, the water cooler
  const cx = an.x1 + 10;
  if (W - cx > 60) {
    R(cx, L0 + 14, 30, 22, '#d6d8dc'); R(cx, L0 + 14, 30, 2, '#eef0f2'); R(cx + 2, L0 + 10, 26, 5, '#c3c6cc'); R(cx + 4, L0 + 11, 22, 1, '#5aa6d6');
    R(cx + 3, L0 + 20, 24, 3, '#9aa0a8'); R(cx + 3, L0 + 26, 24, 3, '#9aa0a8'); R(cx + 24, L0 + 16, 3, 2, '#4cc06a'); R(cx, L0 + 36, 30, 2, 'rgba(0,0,0,0.18)');
    const shx = cx + 38;
    R(shx, L0 + 6, 26, 32, '#7a5232'); R(shx + 1, L0 + 7, 24, 30, '#5e3d24');
    for (let s = 0; s < 3; s++) { for (let b = 0; b < 3; b++) drawBox(shx + 2 + b * 8, L0 + 9 + s * 10, 7, 7); R(shx + 1, L0 + 16 + s * 10, 24, 1, '#7a5232'); }
    if (W - cx > 100) {
      const wx = cx + 72;
      R(wx + 2, L0 + 6, 8, 10, '#8fc9ef'); R(wx + 3, L0 + 7, 2, 7, '#c4e6fa'); R(wx, L0 + 16, 12, 22, '#e9ecef'); R(wx + 3, L0 + 21, 2, 2, '#4a90d0'); R(wx + 7, L0 + 21, 2, 2, '#d0574a');
    }
  }
}

function warehouseStatic(W, H) {
  const { L1, WH0 } = LAY, cg = LAY.cage;
  // the slab between floors, and the stairs down on the left
  R(0, L1 + 2, W, WH0 - L1 - 2, '#5a5652'); R(0, L1 + 2, W, 1, '#77726c'); R(0, WH0 - 1, W, 1, '#3e3b38');
  for (let i = 0; i < 5; i++) { R(0, L1 + 2 + i * 3 + (WH0 - L1 - 16), 16, 2, '#8a847c'); R(0, L1 + 4 + i * 3 + (WH0 - L1 - 16), 16, 1, '#4a4642'); }
  // concrete floor
  speckle(0, WH0, W, H - WH0, '#8f8b84', '#827e77', '#9c9891');
  // back wall: cinder block, racks with paper boxes, a roll-up dock door
  R(0, WH0, W, 22, '#a9a397');
  for (let y = WH0; y < WH0 + 22; y += 4) for (let x = ((y - WH0) / 4) % 2 ? 0 : 6; x < W; x += 12) R(x, y, 1, 4, '#958f83');
  for (let y = WH0 + 3; y < WH0 + 22; y += 4) R(0, y, W, 1, '#958f83');
  const dock = Math.min(W - 150, 214);
  R(dock, WH0 + 1, 44, 21, '#7b8088'); for (let y = WH0 + 3; y < WH0 + 22; y += 2) R(dock + 1, y, 42, 1, '#9aa0a8'); R(dock, WH0 + 1, 44, 1, '#e3b341');
  for (let rx = 20; rx + 52 < cg.x0 - 4; rx += 58) {
    if (rx + 52 > dock - 4 && rx < dock + 48) { rx = dock + 50 - 58; continue; }
    R(rx, WH0 - 2, 2, 26, '#e07a1f'); R(rx + 50, WH0 - 2, 2, 26, '#e07a1f');
    for (const by of [WH0 + 6, WH0 + 15, WH0 + 23]) R(rx, by, 52, 2, '#2f5fa8');
    for (const by of [WH0 - 1, WH0 + 8, WH0 + 17]) for (let b = 0; b < 6; b++) if ((hash2(rx + b, by) & 3) !== 0) drawBox(rx + 3 + b * 8, by - 0, 7, 6);
  }
  // safety walkway
  R(0, LAY.laneC - 8, W, 1, '#e3b341'); R(0, LAY.laneC + 4, W, 1, '#e3b341');
  // the forklift
  const fx = cg.x0 - 58, fy = WH0 + 40;
  if (fx > 4 * 44 + 30) {
    R(fx, fy + 12, 26, 10, '#e8b630'); R(fx, fy + 12, 26, 1, '#f6d36a'); R(fx + 4, fy + 2, 2, 10, '#2c2c30'); R(fx + 16, fy + 2, 2, 10, '#2c2c30'); R(fx + 4, fy + 2, 14, 1, '#2c2c30');
    R(fx + 8, fy + 8, 6, 4, '#3a3a40'); R(fx + 26, fy + 4, 2, 18, '#4a4a50'); R(fx + 28, fy + 20, 8, 2, '#6a6a72');
    R(fx + 2, fy + 21, 6, 4, '#1e1e22'); R(fx + 18, fy + 21, 6, 4, '#1e1e22');
    drawBox(fx + 29, fy + 13, 8, 7);
  }
  for (let i = 0; i < 3; i++) drawBox(cg.x0 - 20, WH0 + 52 - i * 7, 10, 7);
  // the lead's cage office: chain-link on the back and sides
  const mesh = (x, y, w, h) => { R(x, y, w, h, 'rgba(70,74,82,0.18)'); for (let yy = y; yy < y + h; yy += 3) for (let xx = x + ((yy - y) / 3) % 2; xx < x + w; xx += 2) R(xx, yy, 1, 1, 'rgba(60,64,72,0.55)'); };
  mesh(cg.x0, cg.y0, cg.x1 - cg.x0, 24);
  R(cg.x0, cg.y0 - 2, cg.x1 - cg.x0, 2, '#5a5f68'); R(cg.x0, cg.y0, 2, cg.y1 - cg.y0, '#5a5f68'); R(cg.x1 - 2, cg.y0, 2, cg.y1 - cg.y0, '#5a5f68');
  mesh(cg.x0 + 2, cg.y0 + 24, 6, cg.y1 - cg.y0 - 24); mesh(cg.x1 - 8, cg.y0 + 24, 6, cg.y1 - cg.y0 - 24);
  R(cg.x0 + 60, cg.y0 + 4, 16, 10, '#f4f1ea'); R(cg.x0 + 62, cg.y0 + 6, 12, 1, '#9a9a9a'); R(cg.x0 + 62, cg.y0 + 9, 8, 1, '#9a9a9a');   // clipboard schedule
}

// ============================================================ dynamic frame
let hits = [], rects = new Map(), fx = [];

function occupantAt(seat) {
  const id = seat.char ? OCC.get(seat.char) : null;
  const a = id && AG.get(id);
  if (!a) return null;
  const act = actors.get(a.id);
  const present = !!(act && act.mode === 'seat' && act.loc && act.loc.seatKey === seat.key);
  return { a, act, present };
}

function personOpts(a, extra) { return Object.assign({ lanyard: lanyardOf(a.id) }, extra); }

function drawSeat(seat, now) {
  if (seat.kind === 'up') return drawSeatUp(seat, now);
  const occ = occupantAt(seat);
  const a = occ && occ.a, present = occ && occ.present;
  const L = present ? occ.act.look : null;
  let pz = present ? poseFor(a.status, now, L) : null;
  if (pz && a.id === scoutId && a.status === 'idle' && openPitches().length) pz = { pose: 'clip', expr: 'happy', mouth: 'smile', screen: 'idle' };
  const seatTop = seat.deskTop - SEAT_DY;
  const top = pz ? seat.deskTop - (pz.standing ? STAND_DY : SEAT_DY) + (pz.dy || 0) : seatTop;
  const alpha = present && occ.act.fadeIn ? Math.min(1, (now - occ.act.fadeIn) / 400) : 1;
  const kind = seat.kind;
  drawChair(seat.sx, seatTop + (pz && pz.dy ? 1 : 0), kind === 'mgr' ? 'mgr' : kind === 'bench' ? 'stool' : 'desk', L || (CAST[seat.char] ? lookOfChar(seat.char, '') : null));
  if (pz) {
    G.globalAlpha = alpha;
    drawPerson(seat.sx, top, L, personOpts(a, Object.assign({}, pz, { part: 'body', t: now })));
    G.globalAlpha = 1;
    hits.push({ id: a.id, x: seat.sx + 1, y: top - (pz.standing ? 1 : 0), w: 14, h: seat.deskTop - top });
    rects.set(a.id, { x: seat.sx, y: top, w: 16, h: 24, top, seat });
  }
  const screen = pz ? pz.screen : 'off';
  const seed = hash32(seat.key) & 255;
  if (kind === 'bench') {
    drawBench(seat.x + 1, seat.deskTop, seat.w - 2);
    drawLaptop(seat.sx + 8, seat.deskTop + 1, screen, now);
    drawBox(seat.x + seat.w - 10, seat.deskTop - 5, 8, 5);
  } else {
    drawDesk(seat.x + 1, seat.deskTop, seat.w - 2, kind === 'mgr' ? 'mgr' : 'desk');
    const mw = kind === 'mgr' ? 15 : 12, mh = kind === 'mgr' ? 10 : 9;
    drawMonitor(seat.x + 3, seat.deskTop - mh, mw, mh, screen, now, seed);
    drawKeyboard(seat.sx + 3, seat.deskTop, kind !== 'desk');
    const ch = seat.char;
    const sip = pz && (pz.sipping || pz.pose === 'mug');
    const props = THEME.props && THEME.props[ch];
    if (props) { for (const [name, dx, flag] of props) if (PROPS[name] && !(sip && flag === 'nosip')) PROPS[name](seat.x + dx, seat.deskTop, L); }
    else if (!sip && present) drawMug(seat.x + seat.w - 7, seat.deskTop, L.mug);
  }
  if (pz) {
    G.globalAlpha = alpha;
    drawPerson(seat.sx, top, L, personOpts(a, Object.assign({}, pz, { part: 'front', t: now })));
    G.globalAlpha = 1;
    queueFx(a.status, seat.sx, top, now, seat);
  }
}

// the far side of the facing pair: back to us, screen toward us
function drawSeatUp(seat, now) {
  const occ = occupantAt(seat);
  const a = occ && occ.a, present = occ && occ.present;
  const L = present ? occ.act.look : null;
  const pz = present ? poseFor(a.status, now, L) : null;
  const top = seat.deskTop;
  drawDeskUp(seat.x + 1, top, seat.w - 2);
  drawMonitor(seat.x + seat.w - 15, top - 6, 12, 9, pz ? pz.screen : 'off', now, hash32(seat.key) & 255);
  if (THEME.draw && THEME.draw.pairBack) THEME.draw.pairBack(R, seat.x, top, now, OCC.has(SLOT.pairFront) && OCC.has(SLOT.pairBack));
  else { drawDeskPlant(seat.x + 4, top + 6); drawPapers(seat.x + 10, top + 4); }
  const ptop = seat.top - (pz && pz.standing ? 5 : 0);
  const chairC = lookOfChar(SLOT.pairBack, '').chair;
  if (pz) {
    const alpha = occ.act.fadeIn ? Math.min(1, (now - occ.act.fadeIn) / 400) : 1;
    G.globalAlpha = alpha;
    drawPerson(seat.sx, ptop, L, personOpts(a, { pose: pz.pose === 'raise' ? 'raise' : pz.pose === 'type' ? 'type' : 'down', frame: pz.frame, back: true, part: 'all', t: now }));
    G.globalAlpha = 1;
    hits.push({ id: a.id, x: seat.sx + 1, y: ptop, w: 14, h: 22 });
    rects.set(a.id, { x: seat.sx, y: ptop, w: 16, h: 24, top: ptop, seat });
    queueFx(a.status, seat.sx, ptop, now, null);
  }
  drawChairBack(seat.sx, seat.top + (pz && pz.standing ? 20 : 17), chairC);
}

function queueFx(status, sx, top, now, seat) {
  if (status === 'thinking') fx.push(() => fxCloud(sx + 12, top - 12, now));
  else if (status === 'blocked') fx.push(() => fxBang(sx + 7, top - 13, now));
  else if (status === 'error') {
    const mx = seat ? seat.x + 9 : sx + 8;
    const my = seat ? seat.deskTop - 10 : top + 4;
    fx.push(() => { fxSmoke(mx, my, now); fxHuh(sx + 9, top - 10, now); });
  }
}

function drawRecep(now) {
  const P = LAY.recep, nb = blockedCount();
  const top = P.deskTop - SEAT_DY;
  drawChair(P.sx, top, 'desk', RECEP_LOOK);
  const pz = nb ? { pose: 'phone', expr: 'normal', mouth: Math.floor(now / 200) % 2 ? 'open' : 'flat' }
    : ((now + 2500) % 14000 < 1600 ? { pose: 'sip', expr: 'closed', sipping: true } : { pose: 'type', frame: Math.floor(now / 190) % 2, glow: true });
  drawPerson(P.sx, top, RECEP_LOOK, Object.assign({ part: 'body', t: now }, pz));
  hits.push({ id: RECEP_ID, x: P.sx + 1, y: top, w: 14, h: 18 });
  rects.set(RECEP_ID, { x: P.sx, y: top, w: 16, h: 24, top });
  // the reception counter: a raised front panel
  const x = P.x, w = P.w, dt = P.deskTop;
  R(x, dt, w, 5, '#ece6da'); R(x, dt, w, 1, '#fbf8f1');
  R(x, dt + 5, w, 15, '#9c6b3d'); for (let i = 3; i < w; i += 5) R(x + i, dt + 6, 1, 13, '#8a5c33');
  R(x, dt + 9, w, 2, '#c9a24a'); R(x, dt + 19, w, 1, '#6e4524');
  G.fillStyle = 'rgba(40,30,20,0.25)'; G.fillRect(x, dt + 20, w, 1);
  drawMonitor(x + 8, dt - 9, 12, 9, nb ? 'off' : 'work', now, 77);
  drawKeyboard(P.sx + 3, dt, false);
  const lit = nb ? (Math.floor(now / 350) % 2 ? '#ff3b30' : '#5a1d1d') : '#3fbf5f';
  propPhone(x + 50, dt, lit, !!nb);
  DECOR.phone = { x: x + 58, y: dt };
  propCandyDish(x + 62, dt);
  drawPerson(P.sx, top, RECEP_LOOK, Object.assign({ part: 'front', t: now }, pz));
  if (pz.sipping) fx.push(() => fxSteam(P.sx + 9, top + 7, now, 4));
}

function drawConference(now) {
  const C = LAY.conf;
  const tw = C.tx1 - C.tx0;
  const placed = [];
  for (let i = 0; i < C.chairs.length; i++) {
    const ch = C.chairs[i];
    const seat = LAY.seats.get('conf:' + i);
    drawChair(ch.sx, C.top - SEAT_DY, 'conf');
    const occ = seat ? occupantAt(seat) : null;
    if (occ && occ.present) {
      const L = occ.act.look, pz = poseFor(occ.a.status, now, L);
      const top = C.top - (pz.standing ? STAND_DY : SEAT_DY) + (pz.dy || 0);
      drawPerson(ch.sx, top, L, personOpts(occ.a, Object.assign({}, pz, { part: 'body', t: now })));
      hits.push({ id: occ.a.id, x: ch.sx + 1, y: top, w: 14, h: C.top - top });
      rects.set(occ.a.id, { x: ch.sx, y: top, w: 16, h: 24, top, seat });
      placed.push({ ch, occ, pz, top, seat });
    }
  }
  // the long table
  R(C.tx0, C.top, tw, 9, '#6b4a2e'); R(C.tx0, C.top, tw, 1, '#8a6440'); R(C.tx0 + 1, C.top + 1, tw - 2, 1, '#7d5838');
  R(C.tx0, C.top + 9, tw, 3, '#4f3520'); R(C.tx0 + 3, C.top + 12, 2, 6, '#3e2a18'); R(C.tx0 + tw - 5, C.top + 12, 2, 6, '#3e2a18');
  G.fillStyle = 'rgba(0,0,0,0.15)'; G.fillRect(C.tx0 + 2, C.top + 18, tw - 4, 1);
  for (let x = C.tx0 + 14; x < C.tx1 - 10; x += 40) { R(x, C.top + 4, 6, 3, '#f3efe4'); R(x + 1, C.top + 3, 6, 3, '#fbf8f0'); }
  if (tw > 60) { R(C.tx0 + (tw >> 1) - 4, C.top + 3, 8, 4, '#2c2f36'); R(C.tx0 + (tw >> 1) - 3, C.top + 4, 6, 1, '#4a4e58'); }   // the speakerphone
  for (const { ch, occ, pz, top, seat } of placed) {
    drawLaptop(ch.sx + 8, C.top + 2, pz.screen, now);
    drawPerson(ch.sx, top, occ.act.look, personOpts(occ.a, Object.assign({}, pz, { part: 'front', t: now })));
    queueFx(occ.a.status, ch.sx, top, now, null);
  }
  // chairs on the near side, seen from behind
  for (let i = 0; i < C.chairs.length; i++) if (i % 2 === 0) drawChairBack(C.chairs[i].sx, C.top + 16, '#2f3340');
}

function drawGlassFronts(now) {
  const { T1 } = LAY;
  const glass = (x0, x1, doorX, blinds) => {
    const y = T1 - 8;
    for (const [a, b] of [[x0, doorX - 8], [doorX + 8, x1]]) {
      if (b <= a) continue;
      G.fillStyle = 'rgba(185,215,232,0.4)'; G.fillRect(a, y + 1, b - a, 6);
      if (blinds) for (let yy = y + 1; yy < y + 7; yy += 2) { G.fillStyle = 'rgba(236,230,214,0.85)'; G.fillRect(a + 1, yy, b - a - 2, 1); }
      R(a, y, b - a, 1, '#5b6980'); R(a, y + 7, b - a, 1, '#5b6980');
      for (let i = 0; i < 3; i++) R(a + 6 + i, y + 5 - i, 1, 1, 'rgba(255,255,255,0.8)');
    }
    R(doorX - 9, y - 10, 2, 18, '#5b6980'); R(doorX + 7, y - 10, 2, 18, '#5b6980'); R(doorX - 9, y - 10, 18, 1, '#5b6980');
  };
  glass(RCP_W + 2, RCP_W + MO_W - 1, LAY.bossDoor, true);
  glass(RCP_W + MO_W + 2, LAY.kx0 - 2, LAY.conf.door, false);
}

function drawKitchen(now) {
  const bySlot = new Map();
  for (const act of actors.values()) if (act.mode === 'break' && act.loc && act.loc.kind === 'break') bySlot.set(act.loc.slot, act);
  const x0 = LAY.kitchen.x0;
  LAY.kitchen.tables.forEach((ty, k) => {
    for (let j = 0; j < 3; j++) {
      const b = kitchenSpot(k * 3 + j);
      drawChair(b.sx, b.top, 'break');
      const act = bySlot.get(k * 3 + j);
      if (act) {
        drawPerson(b.sx, b.top, act.look, { pose: 'mug', expr: 'happy', part: 'body', t: now, lanyard: lanyardOf(act.id) });
        hits.push({ id: act.id, x: b.sx + 1, y: b.top, w: 14, h: 18 });
        rects.set(act.id, { x: b.sx, y: b.top, w: 16, h: 24, top: b.top });
        fx.push(() => fxSteam(b.sx + 8, b.top + 13, now, 3));
      }
    }
    R(x0 + 8, ty, 66, 6, '#e8e2d6'); R(x0 + 8, ty, 66, 1, '#f7f3ea'); R(x0 + 8, ty + 6, 66, 4, '#b9b1a2'); R(x0 + 8, ty + 9, 66, 1, '#9a9284');
    R(x0 + 12, ty + 10, 2, 7, '#7d766a'); R(x0 + 68, ty + 10, 2, 7, '#7d766a');
    G.fillStyle = 'rgba(0,0,0,0.12)'; G.fillRect(x0 + 10, ty + 17, 62, 1);
    R(x0 + 44, ty + 1, 4, 3, '#e9ecef'); R(x0 + 45, ty - 1, 2, 2, '#ffffff');
  });
  for (const [slot, act] of bySlot) {
    const b = kitchenSpot(slot);
    if (!b.standing) continue;
    const top = b.feetY - 24;
    drawPerson(b.sx, top, act.look, { pose: 'mug', expr: 'happy', legs: true, part: 'all', t: now, lanyard: lanyardOf(act.id) });
    hits.push({ id: act.id, x: b.sx + 1, y: top, w: 14, h: 24 });
    rects.set(act.id, { x: b.sx, y: top, w: 16, h: 24, top });
    fx.push(() => fxSteam(b.sx + 8, top + 13, now, 3));
  }
}

function drawWalkers(now) {
  const list = [...actors.values()].filter((a) => a.mode === 'walk' || a.mode === 'leave' || a.mode === 'gone').sort((a, b) => a.y - b.y);
  for (const act of list) {
    const top = Math.round(act.y) - 24, sx = Math.round(act.x) - 8;
    let alpha = 1;
    if (act.fadeIn && now - act.fadeIn < 350) alpha = (now - act.fadeIn) / 350;
    if (act.mode === 'gone') alpha = Math.max(0, 1 - (now - act.fadeOut) / 450);
    G.globalAlpha = alpha;
    G.fillStyle = 'rgba(0,0,0,0.18)'; G.fillRect(sx + 3, top + 23, 10, 2);
    const paused = !!(act.pauseUntil && now < act.pauseUntil);
    drawPerson(sx, top, act.look, { pose: 'walk', legs: true, back: !!act.up && !paused, frame: paused ? 0 : Math.floor((act.walked || 0) / 8) % 2, part: 'all', t: now, lanyard: lanyardOf(act.id), clip: act.id === scoutId && openPitches().length > 0 });
    G.globalAlpha = 1;
    hits.push({ id: act.id, x: sx + 1, y: top, w: 14, h: 24 });
    rects.set(act.id, { x: sx, y: top, w: 16, h: 24, top, walking: true, paused });
  }
}

function drawClock(cx, cy) {
  const d = new Date();
  for (let dy = -8; dy <= 8; dy++) { const hw = Math.floor(Math.sqrt(72.5 - dy * dy)); R(cx - hw, cy + dy, hw * 2 + 1, 1, '#3a3a44'); }
  for (let dy = -7; dy <= 7; dy++) { const hw = Math.floor(Math.sqrt(56.5 - dy * dy)); R(cx - hw, cy + dy, hw * 2 + 1, 1, '#faf8f2'); }
  R(cx, cy - 7, 1, 2, '#555'); R(cx, cy + 6, 1, 2, '#555'); R(cx - 7, cy, 2, 1, '#555'); R(cx + 6, cy, 2, 1, '#555');
  const hand = (ang, len, c) => {
    const x1 = Math.round(cx + Math.sin(ang) * len), y1 = Math.round(cy - Math.cos(ang) * len);
    let x = cx, y = cy; const dx = Math.abs(x1 - x), dy = -Math.abs(y1 - y), sx = x < x1 ? 1 : -1, sy = y < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) { R(x, y, 1, 1, c); if (x === x1 && y === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x += sx; } if (e2 <= dx) { err += dx; y += sy; } }
  };
  const h = d.getHours() % 12, m = d.getMinutes(), s = d.getSeconds();
  hand((h + m / 60) / 12 * Math.PI * 2, 4, '#26262c');
  hand((m + s / 60) / 60 * Math.PI * 2, 6, '#26262c');
  hand(s / 60 * Math.PI * 2, 6, '#d0342c');
  R(cx, cy, 1, 1, '#d0342c');
}

// dotted "family" line, marching, in the lanyard color with a dark edge so it reads on any floor
function dottedLine(x0, y0, x1, y1, c, now) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, i = 0, x = x0, y = y0;
  const ph = Math.floor(now / 110);
  for (let guard = 0; guard < 4000; guard++) {
    if (((i - ph) % 4 + 4) % 4 < 2) { R(x, y + 1, 1, 1, 'rgba(20,22,28,0.55)'); R(x, y, 1, 1, c); }
    if (x === x1 && y === y1) break;
    const e2 = 2 * err; if (e2 >= dy) { err += dy; x += sx; } if (e2 <= dx) { err += dx; y += sy; }
    i++;
  }
}
function drawFamilyLines(now) {
  const fid = (hoverId && AG.has(hoverId)) ? hoverId : (manualId && AG.has(manualId)) ? manualId : (camId && AG.has(camId) ? camId : null);
  if (!fid) return;
  const a = AG.get(fid);
  const pairs = [];
  if (a.parent_id && AG.has(a.parent_id)) pairs.push([a.parent_id, fid]);
  for (const k of kidsOf(fid)) pairs.push([fid, k.id]);
  for (const [p, c] of pairs) {
    const r1 = rects.get(p), r2 = rects.get(c);
    if (!r1 || !r2) continue;
    const col = lanyardOf(c) || '#ffffff';
    dottedLine(r1.x + 8, r1.top + 16, r2.x + 8, r2.top + 16, col, now);
    for (const r of [r1, r2]) { R(r.x + 6, r.top + 15, 4, 3, 'rgba(20,22,28,0.6)'); R(r.x + 7, r.top + 15, 2, 2, col); }
  }
}

function drawDynamic(now) {
  G = bctx;
  G.drawImage(stat, 0, 0);
  hits = []; rects = new Map(); fx = [];
  const flick = hash32('f' + Math.floor(Date.now() / 60000)) % Math.max(1, Math.floor((LAY.W - 36) / 48));
  if (Math.floor(now / 90) % 23 < 2) { G.fillStyle = 'rgba(80,90,100,0.45)'; G.fillRect(12 + flick * 48 + 1, 3, 24, 3); }
  drawClock(LAY.rooms.conf.x0 + 61, 28);
  R(LAY.kitchen.x0 + 17, LAY.T0 - 28, 1, 1, Math.floor(now / 1500) % 2 ? '#ff4d3d' : '#c0392b');   // coffee maker light
  drawRecep(now);
  const seats = [...LAY.seats.values()].filter((s) => s.kind !== 'conf').sort((p, q) => p.deskTop - q.deskTop || p.x - q.x);
  const topBand = seats.filter((s) => s.deskTop < LAY.T1);
  for (const s of topBand) drawSeat(s, now);
  drawConference(now);
  drawGlassFronts(now);
  drawKitchen(now);
  for (const s of seats) if (s.deskTop >= LAY.T1) drawSeat(s, now);
  drawWalkers(now);
  drawFamilyLines(now);
  for (const f of fx) f();
  // camera brackets around whoever is on camera
  const r = camId && rects.get(camId);
  if (r) {
    const pad = 2 + (Math.floor(now / 400) % 2), x0 = r.x - pad + 1, y0 = r.top - pad - 1, x1 = r.x + 15 + pad, y1 = r.top + 22 + pad;
    const c = '#ffffff', k = '#1d1f24';
    for (const [x, y, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
      R(x - (sx < 0 ? 3 : 0), y, 4, 1, k); R(x, y - (sy < 0 ? 3 : 0), 1, 4, k);
      R(x - (sx < 0 ? 2 : -1), y + sy, 3, 1, c); R(x + sx, y - (sy < 0 ? 2 : -1), 1, 3, c);
    }
    R(x1 - 1, y0 - 3, 2, 2, Math.floor(now / 500) % 2 ? '#ff2a2a' : '#7a1010');
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(buf, 0, 0, LAY.W * SCALE, LAY.H * SCALE);
}

// ============================================================ quips
const LBL = Object.assign({ acc: 'Back room', annex: 'Annex', crew: 'Workshop', conf: 'Conference room', kitchen: 'Kitchen', foreman: 'Lead office' }, THEME.labels || {});
let quip = null, nextQuip = performance.now() + QUIP_FIRST_MS;
function tickQuips(now) {
  if (quip) {
    const a = quip.id === RECEP_ID ? null : AG.get(quip.id);
    const stale = quip.id === RECEP_ID ? blockedCount() > 0 : !a || (a.status !== 'idle' && a.status !== 'done');
    if (now > quip.until || stale) { quip = null; overlayDirty = true; }
  }
  if (now < nextQuip) return;
  nextQuip = now + QUIP_EVERY_MS;
  const cands = [];
  for (const a of AG.values()) {
    if (a.status !== 'idle' && a.status !== 'done') continue;
    const lines = QUIPS[charOf(a.id)];
    const act = actors.get(a.id);
    if (!lines || !act || (act.mode !== 'seat' && act.mode !== 'break')) continue;
    cands.push({ id: a.id, lines });
  }
  if (!cands.length && !blockedCount() && QUIPS[RECEP_CH]) cands.push({ id: RECEP_ID, lines: QUIPS[RECEP_CH] });
  if (!cands.length) { nextQuip = now + 15000; return; }
  const c = cands[Math.floor(Math.random() * cands.length)];
  quip = { id: c.id, text: c.lines[Math.floor(Math.random() * c.lines.length)], until: now + QUIP_SHOW_MS };
  overlayDirty = true;
}

// ============================================================ DOM text layer
let overlayDirty = true, lastOverlay = 0, hoverId = null;
let CW = { plate: 5.4, bubble: 6, sign: 6 };
function measureFonts() {
  const m = document.createElement('canvas').getContext('2d');
  const mono = getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'monospace';
  const f = FS[SCALE];
  m.font = `700 ${f[0]}px ${mono}`; CW.plate = m.measureText('M').width;
  m.font = `${f[1]}px ${mono}`; CW.bubble = m.measureText('M').width;
  m.font = `700 ${f[2]}px ${mono}`; CW.sign = m.measureText('M').width;
}

function bubbleText(a) {
  const ac = a.activity || {};
  if (ac.tool && ac.target) return [ac.tool, ac.target];
  if (ac.tool) return [ac.tool, ''];
  if (ac.target) return ['', ac.target];
  if (ac.text) return ['', ac.text];
  return a.status === 'blocked' ? ['', 'Needs a person'] : null;
}
function realLine(a) {
  const where = a.desk && a.desk !== a.department ? `${a.department} / ${a.desk}` : a.department;
  return `${a.name} · ${where} · ${a.id}`;
}
function recepLines() {
  const bl = [...AG.values()].filter((a) => a.status === 'blocked').sort((p, q) => (changedAt.get(p.id) || 0) - (changedAt.get(q.id) || 0) || (p.id < q.id ? -1 : 1));
  const lines = bl.slice(0, 3).map((a, i) => `${firstOf(a.id)}, line ${NUM_WORDS[i + 1]}.`);
  if (bl.length > 3) lines.push(`${bl.length - 3} more holding.`);
  return lines;
}

function renderOverlay() {
  const s = SCALE, f = FS[s], out = [];
  const placed = [];
  const W = LAY.W * s;
  const ov = (r) => placed.some((q) => r.x < q.x + q.w + 2 && r.x + r.w + 2 > q.x && r.y < q.y + q.h + 2 && r.y + r.h + 2 > q.y);
  const lineH = Math.round(f[1] * 1.2);
  // hanging signs and room labels
  const sign = (text, cx, top) => {
    const w = text.length * (CW.sign + 0.1 * f[2]) + 20, h = f[2] + 11;
    placed.push({ x: cx * s - w / 2, y: top * s, w, h });
    out.push(`<div class="sign" style="left:${Math.round(cx * s)}px;top:${Math.round(top * s)}px">${esc(text)}</div>`);
  };
  const label = (cls, text, x, y, title) => {
    placed.push({ x: x * s, y: y * s, w: (text.length * CW.plate + 12), h: f[0] + 8 });
    out.push(`<div class="room-label ${cls}" style="left:${Math.round(x * s)}px;top:${Math.round(y * s)}px"${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</div>`);
  };
  sign(LBL.acc, (LAY.acc.x0 + LAY.acc.x1) / 2, LAY.T1 + 4);
  sign(LBL.annex, (LAY.annex.x0 + Math.min(LAY.annex.x1, LAY.annex.x0 + 3 * PITCH + 20)) / 2, LAY.L0 + 6);
  sign(LBL.crew, 110, LAY.WH0 + 4);
  label('door-plate', `${charName(SCOUT_CH)} · ${charTitle(SCOUT_CH)}`, RCP_W + 6, LAY.T1 - 19);
  label('conf', LBL.conf, LAY.rooms.conf.x0 + 16, LAY.T1 - 19);
  label('break', LBL.kitchen, LAY.kitchen.x0 + 5, 11);
  label('foreman', LBL.foreman, LAY.cage.x0 + 4, LAY.cage.y0 + 2);
  if (!online) label('offline-door', 'Out of office', 2, 30);
  if (!scoutIn()) label('scout-out', scoutOff() ? `${SC_FIRST} is off` : `${SC_FIRST} is out`, RCP_W + 48, LAY.T0 + 13, scoutOffWhy());
  if (!AG.size) {
    const cx = Math.round((LAY.rooms.bullpen.x0 + LAY.rooms.bullpen.x1) / 2 * s), cy = Math.round((LAY.T1 + 40) * s);
    out.push(`<div class="empty-note" style="left:${cx}px;top:${cy}px">${online ? 'Nobody is in yet.<br>Start an agent and it walks in.' : 'Cannot reach the office.<br>Is server.py running?'}</div>`);
  }
  const nb = blockedCount();
  const bx = (LAY.recep.x + LAY.recep.w - 18) * s, by = (LAY.recep.deskTop + 22) * s;
  placed.push({ x: bx, y: by, w: 10 * CW.plate + 14, h: f[0] + 10 });
  out.push(`<div class="phone-badge${nb ? ' hot' : ''}" style="left:${bx}px;top:${by}px" title="Agents waiting on a person">${nb} on hold</div>`);
  // nameplates: the character's name, full when it fits
  for (const seat of LAY.seats.values()) {
    const occ = occupantAt(seat);
    if (!seat.named && !occ) continue;
    const away = !occ || !occ.present;
    let pw, px, py;
    if (seat.kind === 'up') { pw = seat.w - 4; px = seat.x + 2; py = seat.top + 31; }
    else if (seat.kind === 'conf') { pw = 21; px = seat.sx - 2; py = seat.deskTop + 9; }
    else if (seat.kind === 'mgr') { pw = 40; px = seat.x + 6; py = seat.deskTop + 6; }
    else { pw = seat.w - 4; px = seat.x + 2; py = seat.deskTop + 6; }
    const full = charName(seat.char), first = charFirst(seat.char);
    const cwp = seat.kind === 'conf' ? CW.plate * 0.84 : CW.plate;
    const txt = full.length * cwp + 6 <= pw * s ? full : first;
    const cls = seat.kind === 'mgr' ? 'mgr' : seat.kind === 'conf' ? 'conf' : 'kid';
    const ly = occ ? lanyardOf(occ.a.id) : null;
    if (seat.kind === 'mgr' || seat.kind === 'up') placed.push({ x: px * s, y: py * s, w: pw * s, h: 7 * s });
    out.push(`<div class="plate ${cls}${away ? ' away' : ''}${occ ? '' : ' empty'}" style="left:${px * s}px;top:${py * s}px;width:${pw * s}px;max-width:${pw * s}px${ly ? `;border-bottom-color:${ly}` : ''}" title="${esc(occ ? full + ' · ' + occ.a.name : full + ' · empty desk')}">${esc(txt)}</div>`);
  }
  // the receptionist on the phone names who is on hold
  const pr = rects.get(RECEP_ID);
  if (nb && pr) {
    const lines = recepLines();
    const w = Math.min(260, Math.max(...lines.map((l) => l.length)) * CW.bubble + 16), h = lines.length * lineH + 10;
    const ax = (pr.x + 8) * s;
    const left = Math.round(clamp(ax - w / 2, 2, Math.max(2, (RCP_W + 40) * s - w))), top = Math.max(2, Math.round((pr.top - 1) * s - 6 - h));
    placed.push({ x: left, y: top, w, h });
    out.push(`<div class="bubble phone" style="left:${left}px;top:${top}px;--tail:${Math.max(6, Math.min(w - 14, Math.round(ax - left - 4)))}px">${lines.map((l) => `<div>${esc(l)}</div>`).join('')}</div>`);
  }
  // speech bubbles, highest priority first; kids give way when crowded
  const cands = [];
  for (const [id, r] of rects) {
    const isRecep = id === RECEP_ID;
    const a = isRecep ? null : AG.get(id);
    const isM = !!a && id === scoutId;
    const walkQuip = isM && r.walking && r.paused && actors.get(id) ? actors.get(id).pauseQuip : null;
    if ((!a && !isRecep) || (r.walking && !walkQuip)) continue;
    const forced = id === hoverId || id === manualId;
    const qu = quip && quip.id === id;
    const nOpen = isM ? openPitches().length : 0;
    const pb = walkQuip || (isM && !qu && nOpen && a.status !== 'working' && a.status !== 'blocked' ? `${nOpen} idea${nOpen === 1 ? '' : 's'} for you` : null);
    if (!forced && !qu && !pb && (!a || (a.status !== 'working' && a.status !== 'blocked'))) continue;
    const st = r.seat;
    const tier = forced ? 0 : a && a.status === 'blocked' ? 1 : qu || pb ? 2 : id === scoutId ? 3 : st && st.named ? 4 : 5;
    cands.push({ id, a, r, tier, forced, qu, pb, cam: id === camId });
  }
  cands.sort((p, q) => p.tier - q.tier || (q.cam - p.cam));
  const faces = [];
  for (const [id, r] of rects) faces.push({ id, x: r.x * s + 2 * s, y: (r.top + 1) * s, w: 12 * s, h: 13 * s });
  const onFace = (r, own) => faces.some((q) => q.id !== own && r.x < q.x + q.w && r.x + r.w > q.x && r.y < q.y + q.h && r.y + r.h > q.y);
  for (const c of cands) {
    const { a, r } = c;
    if (c.forced) {
      const nm = nameOf(c.id), ti = c.id === RECEP_ID ? CAST[RECEP_CH].title : charTitle(charOf(c.id));
      const real = a ? realLine(a) : (THEME.recepNote || 'Not an agent. Answers the phone when an agent needs you.');
      const bt = a && bubbleText(a);
      const doing = a ? `${STATUS_LABEL[a.status]}${bt && (a.status === 'working' || a.status === 'blocked') ? ' · ' + trunc((bt[0] ? bt[0] + ': ' : '') + bt[1], 34) : ''}` : '';
      const longest = Math.max(nm.length, ti.length, Math.min(40, real.length), doing.length);
      const w = Math.min(270, longest * CW.bubble + 18);
      const fw = c.id === scoutId && c.id === manualId ? findWork() : null;   // the pinned scout gets a Find work button
      const h = ((doing ? 3 : 2) + Math.ceil(real.length * CW.bubble / Math.max(1, w - 18))) * lineH + 12 + (fw ? lineH + 14 : 0);
      const ax = (r.x + 8) * s, ay = (r.top - (a && a.status === 'blocked' ? 13 : 1)) * s;
      const left = Math.max(2, Math.min(W - w - 2, ax - 12));
      let top = ay - 6 - h; let tail = '';
      if (top < 2) { top = (r.top + 24) * s + 8; tail = ' tail-u'; }
      placed.push({ x: left, y: top, w, h });
      out.push(`<div class="bubble card forced${tail}" style="left:${left}px;top:${top}px;--tail:${Math.max(4, Math.min(w - 14, ax - left - 4))}px"><div class="c-name">${esc(nm)}</div><div class="c-title">${esc(ti)}</div><div class="c-real${a ? '' : ' npc'}">${esc(real)}</div>${doing ? `<div class="c-meta">${esc(doing)}</div>` : ''}${fw ? findWorkHtml(fw, 'c-btn') : ''}</div>`);
      continue;
    }
    let tool = '', target = '', txt, cls = '';
    if (c.qu) { txt = quip.text; target = txt; cls = ' quip'; }
    else if (c.pb) { txt = c.pb; target = txt; cls = ' pitch'; }
    else {
      const bt = bubbleText(a); if (!bt) continue;
      [tool, target] = bt;
      const full = (tool ? tool + ': ' : '') + target;
      txt = trunc(full, 28);
      if (tool && txt.length <= tool.length + 1) target = ''; else if (tool) target = txt.slice(tool.length + 2); else target = txt;
    }
    const w = Math.ceil(txt.length * CW.bubble + 14), h = lineH + 10;
    const blocked = a && a.status === 'blocked';
    const ax = (r.x + 8) * s, ay = (r.top - (blocked ? 13 : 1)) * s;
    const above = Math.round(ay - 6 - h), mid = Math.round((r.top + 5) * s - h / 2);
    const above2 = above - h - 4, small = c.tier >= 5;
    let opts = [[ax - 12, above, 'b'], [ax - w + 12, above, 'b'], [ax + 9 * s, mid, 'l'], [ax - 9 * s - w, mid, 'r'], [ax - w / 2, above, 'b']];
    if (blocked) opts.splice(2, 2, [ax - 9 * s - w, mid, 'r'], [ax + 11 * s, mid, 'l']);
    if (small) opts = [[ax - 12, above, 'b'], [ax - w + 12, above, 'b'], [ax - w / 2, above, 'b'], [ax + 9 * s, mid, 'l'], [ax - 12, above2, 'b'], [ax - w + 12, above2, 'b']];
    if (r.seat && r.seat.kind === 'up') opts = [[ax + 9 * s, mid, 'l'], [ax - 9 * s - w, mid, 'r'], [ax + 9 * s, mid + h + 4, 'l']].concat(opts);
    let best = null, fallback = null;
    for (const [lx, ly, tail] of opts) {
      const rect = { x: Math.round(Math.max(2, Math.min(W - w - 2, lx))), y: Math.max(2, ly), w, h, tail };
      if (!ov(rect)) { if (!onFace(rect, c.id)) { best = rect; break; } if (!fallback) fallback = rect; }
    }
    if (!best) best = fallback;
    if (!best && c.tier <= 3) { const [lx, ly, tail] = opts[0]; best = { x: Math.round(Math.max(2, Math.min(W - w - 2, lx))), y: Math.max(2, ly), w, h, tail }; }
    if (!best) continue;
    placed.push(best);
    const tailX = Math.max(4, Math.min(w - 14, ax - best.x - 4));
    const tcls = best.tail === 'l' ? ' tail-l' : best.tail === 'r' ? ' tail-r' : '';
    const body = c.qu || c.pb ? esc(txt) : tool ? `<b>${esc(tool)}</b>${target ? ': ' + esc(target) : ''}` : esc(target);
    out.push(`<div class="bubble${blocked ? ' blocked' : ''}${cls}${tcls}" style="left:${best.x}px;top:${best.y}px;--tail:${tailX}px">${body}</div>`);
  }
  overlay.innerHTML = out.join('');
}

// ============================================================ talking head panel
// clicked agent: its card stays open and its family lines show until you click it again or empty floor
let camId = null, manualId = null;
function pickCamera() {
  if (manualId && !AG.has(manualId)) manualId = null;
  if (camId !== manualId) { camId = manualId; overlayDirty = true; }
}
function select(id) { if (!AG.has(id)) return; manualId = manualId === id ? null : id; overlayDirty = true; renderRoster(); }

// ============================================================ roster sidebar: everyone and what they are on
const ROSTER_KEY = BRAND.store + '-roster';
const rosterEl = $('#roster'), rosterBtn = $('#rosterBtn'), rList = $('#rList'), rSummary = $('#rSummary');
const openDone = new Set();     // top-level ids whose finished kids are expanded
let rosterHtml = '';
function ago(iso) {
  const t = Date.parse(iso); if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((serverNow() - t) / 1000));
  if (s < 10) return 'now';
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
// how long an agent has sat blocked, from the status change seen in ingest()
function blockedFor(a) {
  const t = changedAt.get(a.id); if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((serverNow() - t) / 1000));
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  return Math.floor(s / 3600) + 'h ' + (Math.floor(s / 60) % 60) + 'm';
}
// what the agent is trying to do: todo progress, else the session title or first prompt (sessions only)
function goalLine(a, taskNamed) {   // subagents already carry their task as the name: todo progress only
  const g = a.goal;
  if (!g || !g.source || !g.text) return '';
  if (g.source === 'todo') {
    const total = Number(g.total) || 0, done = Math.min(Number(g.done) || 0, total);
    if (!total) return '';
    const step = done >= total ? `All ${total} done` : `Step ${done + 1} of ${total}`;
    return `<div class="r-goal todo"><div class="r-gtext"><b>${esc(step)}</b> · ${esc(trunc(g.text, 90))}</div>`
      + `<div class="r-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}"><span style="width:${Math.round(100 * done / total)}%"></span></div></div>`;
  }
  if (taskNamed) return '';
  return `<div class="r-goal soft" title="${esc(g.source === 'title' ? 'Session title' : 'First prompt')}">${esc(trunc(g.text, 90))}</div>`;
}
function rosterRow(a, d) {
  const kid = d > 0;
  const ch = charOf(a.id);
  const where = a.desk && a.desk !== a.department ? `${a.department} / ${a.desk}` : a.department;
  const work = kid ? a.name : where;
  const type = kid ? (a.kind === 'terminal_child' ? 'pane' : a.agent_type || '') : '';
  const bt = bubbleText(a);
  const act = bt && a.status !== 'idle' && a.status !== 'done'
    ? (bt[0] ? `<b>${esc(bt[0])}</b>${bt[1] ? ': ' + esc(trunc(bt[1], 90)) : ''}` : esc(trunc(bt[1], 90)))
    : '';
  const meta = [kid ? where : a.name, a.model, a.tool_count ? a.tool_count + ' tools' : '', ago(a.last_active_at)].filter(Boolean).join(' · ');
  const cls = ['r-row', kid ? 'kid' : '', a.status === 'blocked' ? 'blocked' : '', a.id === manualId ? 'sel' : ''].filter(Boolean).join(' ');
  const stLabel = STATUS_LABEL[a.status] + (a.status === 'blocked' ? ' · ' + blockedFor(a) : '');
  return `<div class="${cls}" data-id="${esc(a.id)}"${kid ? ` style="--d:${Math.min(d, 4)}"` : ''} title="${esc(realLine(a))}">`
    + `<div class="r-line1"><span class="r-name">${esc(charName(ch))}</span>${type ? `<span class="r-type">${esc(type)}</span>` : ''}`
    + `<span class="r-st"><span class="dot ${a.status}"></span> ${esc(stLabel)}</span></div>`
    + `<div class="r-work">${esc(work)}</div>`
    + goalLine(a, a.kind === 'subagent')
    + (act ? `<div class="r-act">${act}</div>` : '')
    + `<div class="r-meta">${esc(meta)}</div></div>`;
}
function rosterFamily(top) {
  const live = [], done = [];
  const walk = (a, d) => { for (const k of kidsOf(a.id)) { (k.status === 'done' && !openDone.has(top.id) ? done : live).push([k, d]); walk(k, d + 1); } };
  walk(top, 1);
  const lan = lanyardOf(top.id);
  let h = `<div class="r-fam"${lan ? ` style="--lan:${lan}"` : ''}>` + rosterRow(top, 0);
  for (const [k, d] of live) h += rosterRow(k, d);
  const nDone = done.length + (openDone.has(top.id) ? live.filter(([k]) => k.status === 'done').length : 0);
  if (nDone) h += `<button class="r-done" type="button" data-done="${esc(top.id)}">${openDone.has(top.id) ? '▾ hide' : '▸'} ${nDone} done</button>`;
  return h + '</div>';
}
// The scout's pitches: it proposes, the owner assigns or dismisses here. Every pitch string goes through esc().
const pitchErr = new Map(), pitchBusy = new Set(), pitchSent = new Map();
const PITCH_ORDER = { open: 0, running: 1, stuck: 2, done: 3 };
function builderOf(p) {
  if (p.terminal && AG.has(p.terminal)) return AG.get(p.terminal);
  for (const a of AG.values()) if (a.kind !== 'subagent' && (a.name === 'mgr-' + p.id || (p.terminal && a.name === p.terminal))) return a;
  return null;
}
function pitchCard(p) {
  const st = p.status;
  const meta = [p.project, p.kind, p.estimate].filter(Boolean).map((x) => esc(trunc(x, 60))).join(' · ');
  let h = `<div class="p-card ${esc(st)}" data-pitch="${esc(p.id)}">`
    + `<div class="p-line1"><span class="p-title">${esc(p.title)}</span><span class="p-st ${esc(st)}">${esc(PITCH_LABEL[st] || st)}</span></div>`
    + `<div class="p-meta">${meta}</div>`
    + (p.why ? `<div class="p-why">${esc(p.why)}</div>` : '');
  if (st === 'open') {
    const busy = pitchBusy.has(p.id), dis = busy || !scoutIn() ? ' disabled' : '';
    h += `<div class="p-acts"><button type="button" class="p-btn assign" data-act="assign" data-pid="${esc(p.id)}"${dis}>${busy ? 'Sending...' : 'Assign'}</button>`
      + `<button type="button" class="p-btn dismiss" data-act="dismiss" data-pid="${esc(p.id)}"${dis}>Dismiss</button>`
      + (pitchSent.has(p.id) ? `<span class="p-sent">${esc(pitchSent.get(p.id))}</span>` : '') + '</div>';
  } else if (st === 'running') {
    const b = builderOf(p);
    h += b ? `<div class="p-run">Builder: <button type="button" class="p-builder" data-id="${esc(b.id)}" title="${esc(realLine(b))}">${esc(charName(charOf(b.id)))}</button> · ${esc(b.name)}</div>`
      : `<div class="p-run">Builder ${esc(p.terminal || 'starting')} is not in the office yet.</div>`;
    if (p.branch) h += `<div class="p-meta">Branch ${esc(p.branch)}</div>`;
  } else {
    if (p.result) h += `<div class="p-result">${esc(p.result)}</div>`;
    if (p.branch) h += `<div class="p-meta">Branch ${esc(p.branch)} · ${/^Merged /.test(p.note || '') ? 'merged' : 'not merged'}</div>`;
  }
  if (p.note) h += `<div class="p-note">${esc(p.note)}</div>`;
  if (pitchErr.has(p.id)) h += `<div class="p-err" role="alert">${esc(pitchErr.get(p.id))}</div>`;
  return h + '</div>';
}
function pitchSection() {
  const all = SCOUT.pitches.filter((p) => p.status !== 'dismissed')
    .sort((a, b) => PITCH_ORDER[a.status] - PITCH_ORDER[b.status] || (String(a.updated_at) < String(b.updated_at) ? 1 : -1));
  const live = all.filter((p) => p.status === 'open' || p.status === 'running');
  const list = live.concat(all.filter((p) => p.status === 'stuck'));   // stuck still needs a person; done folds away below
  const done = all.filter((p) => p.status === 'done');
  const nOpen = live.filter((p) => p.status === 'open').length;
  if (scoutOff()) return `<section class="p-sec" aria-label="Pitches"><div class="p-head">${esc(SC_FIRST)}'s pitches</div><div class="p-out">${esc(scoutOffWhy())}</div></section>`;
  let h = `<section class="p-sec" aria-label="${esc(SC_FIRST)}'s pitches"><div class="p-head">${esc(SC_FIRST)}'s pitches${nOpen ? ` <span class="p-count">${nOpen} open</span>` : ''}${findWorkHtml(findWork(), 'p-btn p-find')}</div>`;
  if (scoutErr) h += `<div class="p-err" role="alert">${esc(scoutErr)}</div>`;
  else if (scoutSent) h += `<div class="p-sent p-find-sent">${esc(scoutSent)}</div>`;
  const every = `${SCOUT_CFG.every_minutes} minutes`;
  if (!scoutIn()) h += `<div class="p-out">${esc(SC_FIRST)} is out. Run <code>${esc(SCOUT_CFG.start_hint)}</code></div>`;
  else if (scouting()) h += `<div class="p-empty p-scouting">${esc(SC_FIRST)} is scouting for ${nOpen ? 'another idea' : 'ideas'}...</div>`;
  else if (!list.length) h += `<div class="p-empty">${done.length ? `Nothing open. Press Find work, or ${esc(SC_FIRST)} scouts again within ${esc(every)}.` : `No pitches yet. ${esc(SC_FIRST)} scouts every ${esc(every)} in ${esc(SCOUT_CFG.hours_label)}.`}</div>`;
  h += list.map(pitchCard).join('');
  if (done.length) {
    h += `<button type="button" class="r-done p-done-toggle" data-pdone="1" aria-expanded="${pitchDoneOpen}">${pitchDoneOpen ? '▾ hide' : '▸'} ${done.length} done</button>`;
    if (pitchDoneOpen) h += `<div class="p-done-list">${done.slice(0, 10).map(pitchCard).join('')}</div>`;
  }
  return h + '</section>';
}
// Find work: ask the scout for a pass now, between its timed loops
let scoutBusy = false, scoutErr = '', scoutSent = '';
let pitchDoneOpen = false;      // finished pitches stay folded unless opened
function findWork() {
  const nOpen = SCOUT.pitches.filter((p) => p.status === 'open').length, cap = SCOUT_CFG.max_open;
  if (scoutOff()) return { dis: true, label: 'Find work', title: scoutOffWhy() };
  if (!scoutIn()) return { dis: true, label: 'Find work', title: SC_OUT };
  if (scoutBusy) return { dis: true, label: 'Sending...', title: 'Asking ' + SC_FIRST };
  if (scouting()) return { dis: true, label: 'Scouting...', title: SC_FIRST + ' is already looking' };
  if (nOpen >= cap) return { dis: true, label: 'Find work', title: `${cap} pitch${cap === 1 ? ' is' : 'es are'} open. Assign or dismiss one first.` };
  return { dis: false, label: 'Find work', title: `Ask ${SC_FIRST} to scout now instead of waiting for the next ${SCOUT_CFG.every_minutes} minute pass` };
}
function findWorkHtml(fw, cls) {
  return `<button type="button" class="${cls}" data-act="scout" title="${esc(fw.title)}"${fw.dis ? ' disabled' : ''}>${esc(fw.label)}</button>`;
}
async function scoutAct() {
  if (findWork().dis) return;
  scoutErr = ''; scoutSent = '';
  if (SCENE) { scoutSent = `Sent. ${SC_FIRST} is looking for work.`; rosterHtml = ''; renderRoster(); sceneEvent('find'); setTimeout(() => { scoutSent = ''; rosterHtml = ''; renderRoster(); }, 30000); return; }   // scenes never POST
  if (FIXTURE) { scoutSent = `Fixture: ${SC_FIRST} would scout now.`; rosterHtml = ''; renderRoster(); overlayDirty = true; return; }   // never POST from fixtures
  scoutBusy = true; rosterHtml = ''; renderRoster(); overlayDirty = true;
  try {
    const r = await fetch('/api/pitch', {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(8000),
      headers: { 'Content-Type': 'application/json', 'X-Agent-Office': '1' },
      body: JSON.stringify({ action: 'scout' }),
    });
    let j = null;
    try { j = await r.json(); } catch (e) { /* not JSON */ }
    if (!r.ok) scoutErr = trunc(j && typeof j.error === 'string' ? j.error : 'HTTP ' + r.status, 200);
    else scoutSent = `Sent. ${SC_FIRST} is looking for work.`;
  } catch (e) {
    scoutErr = 'Could not reach the server.';
  } finally {
    scoutBusy = false; rosterHtml = ''; renderRoster(); overlayDirty = true;
    setTimeout(() => { scoutSent = ''; scoutErr = ''; rosterHtml = ''; renderRoster(); }, 30000);
  }
}
async function pitchAct(pid, act) {
  if (!RE_PITCH.test(pid) || pitchBusy.has(pid) || (act !== 'assign' && act !== 'dismiss')) return;
  pitchErr.delete(pid); pitchSent.delete(pid);
  if (SCENE) { scenePitchAct(pid, act); rosterHtml = ''; renderRoster(); overlayDirty = true; return; }   // scenes never POST
  if (FIXTURE) { fixturePitchAct(pid, act); rosterHtml = ''; renderRoster(); overlayDirty = true; return; }   // never POST from fixtures
  pitchBusy.add(pid); rosterHtml = ''; renderRoster();
  try {
    const r = await fetch('/api/pitch', {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(8000),
      headers: { 'Content-Type': 'application/json', 'X-Agent-Office': '1' },
      body: JSON.stringify({ id: pid, action: act }),
    });
    let j = null;
    try { j = await r.json(); } catch (e) { /* not JSON */ }
    if (!r.ok) pitchErr.set(pid, trunc(j && typeof j.error === 'string' ? j.error : 'HTTP ' + r.status, 200));
    else pitchSent.set(pid, act === 'assign' ? `Sent. ${SC_FIRST} starts a builder.` : `Sent to ${SC_FIRST}.`);
  } catch (e) {
    pitchErr.set(pid, 'Could not reach the server.');
  } finally {
    pitchBusy.delete(pid); rosterHtml = ''; renderRoster();
  }
}

function renderRoster() {
  if (!rosterEl || rosterEl.hidden) return;
  const counts = {};
  for (const a of AG.values()) counts[a.status] = (counts[a.status] || 0) + 1;
  const order = ['blocked', 'working', 'thinking', 'error', 'idle', 'done'];
  const summary = order.filter((s) => counts[s]).map((s) => `<span><span class="dot ${s}"></span>${counts[s]} ${esc(s === 'blocked' ? 'need you' : s)}</span>`).join('') || '<span>nobody in</span>';
  const tops = TOPS.slice().sort(byAge);
  const list = pitchSection() + (tops.length ? tops.map(rosterFamily).join('') : `<div class="r-empty">${STATE ? 'Nobody is in the office.' : 'Opening the office...'}</div>`);
  const html = summary + '\u0000' + list;
  if (html === rosterHtml) return;
  rosterHtml = html;
  const keep = rList.scrollTop;
  rSummary.innerHTML = summary; rList.innerHTML = list;
  rList.scrollTop = keep;
}
function setRosterOpen(open, save) {
  rosterEl.hidden = !open;
  rosterBtn.setAttribute('aria-pressed', open ? 'true' : 'false');
  if (save) store.set(ROSTER_KEY, open ? '1' : '0');
  rosterHtml = '';
  if (open) renderRoster();
  if (STATE) relayout(true);
}
rosterBtn.addEventListener('click', () => setRosterOpen(rosterEl.hidden, true));
overlay.addEventListener('pointerdown', (e) => { const b = e.target.closest('[data-act="scout"]'); if (b && !b.disabled) { e.preventDefault(); scoutAct(); } });
rList.addEventListener('click', (e) => {
  const pa = e.target.closest('[data-act]');
  if (pa) { if (!pa.disabled) { const act = pa.getAttribute('data-act'); if (act === 'scout') scoutAct(); else pitchAct(pa.getAttribute('data-pid') || '', act); } return; }
  if (e.target.closest('[data-pdone]')) { pitchDoneOpen = !pitchDoneOpen; rosterHtml = ''; renderRoster(); return; }
  const d = e.target.closest('[data-done]');
  if (d) { const id = d.getAttribute('data-done'); if (openDone.has(id)) openDone.delete(id); else openDone.add(id); renderRoster(); return; }
  const r = e.target.closest('[data-id]');
  if (r) select(r.getAttribute('data-id'));
});
rList.addEventListener('mouseover', (e) => { const r = e.target.closest('[data-id]'); const id = r ? r.getAttribute('data-id') : null; if (id !== hoverId) { hoverId = id; overlayDirty = true; } });
rList.addEventListener('mouseleave', () => { if (hoverId) { hoverId = null; overlayDirty = true; } });
setRosterOpen(store.get(ROSTER_KEY) !== '0', false);

// ============================================================ browser alerts: one notification when an agent turns blocked
const ALERT_KEY = BRAND.store + '-alerts';
const alertBtn = $('#alertBtn');
const HAS_NOTIF = typeof window.Notification === 'function';
const ALERTS_ALLOWED = !(FIXTURE || SCENE) || Q.get('alerts') === '1';   // fixture statuses rotate; stay quiet unless asked
let alertsOn = HAS_NOTIF && store.get(ALERT_KEY) === '1' && Notification.permission === 'granted';
function paintAlertBtn() {
  if (!alertBtn) return;
  if (!HAS_NOTIF || SCENE) { alertBtn.hidden = true; return; }
  alertBtn.hidden = false;
  const denied = Notification.permission === 'denied';
  if (denied) alertsOn = false;
  const st = denied ? 'denied' : alertsOn ? 'on' : 'off';
  alertBtn.textContent = 'Alerts ' + st;
  alertBtn.setAttribute('aria-pressed', alertsOn ? 'true' : 'false');
  alertBtn.dataset.state = st;
  alertBtn.title = denied
    ? 'The browser blocks notifications for this page. Allow them in the site settings (lock icon in the address bar), then reload.'
    : alertsOn ? 'A desktop notification fires when an agent needs a person. Click to turn off.'
    : 'Click to get a desktop notification when an agent needs a person.';
}
function setAlerts(on) {
  alertsOn = on;
  store.set(ALERT_KEY, on ? '1' : '0');
  paintAlertBtn();
}
if (alertBtn) alertBtn.addEventListener('click', () => {
  if (!HAS_NOTIF || Notification.permission === 'denied') { paintAlertBtn(); return; }
  if (alertsOn) { setAlerts(false); return; }
  if (Notification.permission === 'granted') { setAlerts(true); return; }
  const done = (p) => setAlerts(p === 'granted');
  try {
    const pr = Notification.requestPermission(done);    // callback form for old Safari, promise elsewhere
    if (pr && typeof pr.then === 'function') pr.then(done, () => paintAlertBtn());
  } catch (e) { paintAlertBtn(); }
});
paintAlertBtn();
function notifyBlocked(a) {
  if (!a || !alertsOn || !ALERTS_ALLOWED || !HAS_NOTIF || Notification.permission !== 'granted') return;
  const where = a.desk && a.desk !== a.department ? `${a.department} / ${a.desk}` : a.department;
  const ac = a.activity || {};
  const doing = ac.text || (ac.tool ? ac.tool + (ac.target ? ': ' + ac.target : '') : '');
  const body = [`${a.name} · ${where}`, doing].filter(Boolean).join('\n');
  try {
    const n = new Notification(`${charName(charOf(a.id))} needs a person`, { body, tag: a.id, renotify: true });
    n.onclick = () => { try { window.focus(); } catch (e) { /* ignore */ } if (manualId !== a.id) select(a.id); n.close(); };
  } catch (e) { /* some browsers only allow notifications from a service worker */ }
}

// ============================================================ chrome
function updateChrome() {
  const nb = blockedCount();
  document.title = nb ? `(${nb}) ${BRAND.title}` : BRAND.title;
  const n = AG.size, src = (STATE && STATE.sources) || {};
  const parts = [BRAND.place, `${n} agent${n === 1 ? '' : 's'}`].filter(Boolean);
  if (src.sessions != null) parts.push(`${src.sessions} session${src.sessions === 1 ? '' : 's'}`);
  parts.push(`Herdr ${src.herdr ? 'on' : 'off'}`);
  $('#subtitle').textContent = parts.join(' · ');
  const bp = $('#blockedPill');
  bp.hidden = !nb; bp.textContent = `${nb} need${nb === 1 ? 's' : ''} you`;
  const mp = $('#modePill');
  mp.hidden = !FIXTURE; mp.textContent = FIXTURE === 'big' ? `Fixture · big` : 'Fixture';
  $('#offline').hidden = online;
  renderRoster();
}

// ============================================================ input
function toWorld(e) { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / SCALE, y: (e.clientY - r.top) / SCALE }; }
function hitAt(p) {
  for (let i = hits.length - 1; i >= 0; i--) { const h = hits[i]; if (p.x >= h.x && p.x < h.x + h.w && p.y >= h.y && p.y < h.y + h.h) return h.id; }
  return null;
}
canvas.addEventListener('mousemove', (e) => { const id = hitAt(toWorld(e)); canvas.style.cursor = id && id !== RECEP_ID ? 'pointer' : 'default'; if (id !== hoverId) { hoverId = id; overlayDirty = true; } });
canvas.addEventListener('mouseleave', () => { if (hoverId) { hoverId = null; overlayDirty = true; } });
canvas.addEventListener('click', (e) => {
  const id = hitAt(toWorld(e));
  if (id && AG.has(id)) {
    select(id);
    const row = manualId && rList.querySelector(`[data-id="${CSS.escape(manualId)}"]`);
    if (row) row.scrollIntoView({ block: 'nearest' });
  } else if (!id && manualId) { manualId = null; overlayDirty = true; renderRoster(); }
});
let resizeT = 0;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (STATE) relayout(true); }, 80); });

// ============================================================ data: live and fixtures
async function poll() {
  try {
    const r = await fetch('/api/state', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const s = await r.json();
    if (!online) overlayDirty = true;
    online = true; ingest(s);
  } catch (e) {
    const was = online;
    online = false;
    if (!STATE) ingest({ generated_at: new Date().toISOString(), sources: { herdr: false, sessions: 0 }, agents: [] });
    if (was) overlayDirty = true;
    updateChrome();
  } finally { setTimeout(poll, POLL_MS); }
}

async function loadFixture() {
  const urls = ['/fixtures/sample-state.json', new URL('../fixtures/sample-state.json', location.href).href, new URL('fixtures/sample-state.json', location.href).href];
  for (const u of urls) {
    try { const r = await fetch(u, { cache: 'no-store' }); if (r.ok) return await r.json(); } catch (e) { /* try the next path */ }
  }
  throw new Error('fixture not found at /fixtures/sample-state.json');
}

const CANNED = [['Read', 'server.py'], ['Grep', 'retry_after'], ['Bash', 'npm test -- --watch=false'], ['Edit', 'office.js'], ['WebSearch', 'pixel art office palettes'], ['Glob', '**/*.json'], ['Bash', 'git status --short'], ['Write', 'notes.md'], ['Agent', 'Review the canvas renderer'], ['chat.search', '#standup'], ['Read', 'README.md'], ['WebFetch', 'developer.mozilla.org']];
const ROLE = Object.assign({ explorer: 'Research', reviewer: 'Review', 'general-purpose': 'General', builder: 'Builder', debugger: 'Debugging', Plan: 'Planning' }, (CFG.roles && CFG.roles.subagent) || {});
const SPAWN = [['Lint the bubble layout', 'reviewer'], ['Find stale worktrees', 'explorer'], ['Draft the release note', 'general-purpose'], ['Patch the sprite cache', 'builder'], ['Trace the 403 again', 'debugger'], ['Plan the rollout', 'Plan']].map(([n, t]) => [n, ROLE[t] || 'Temp', t]);
const CYC_TOP = ['working', 'thinking', 'idle', 'blocked', 'working', 'error'];
const CYC_KID = ['working', 'thinking', 'done', 'working', 'blocked', 'thinking', 'error', 'working', 'idle'];
let FIX_BASE = null, fixTick = 0;
let FIX_PITCHES = [];            // fixture mode: Assign and Dismiss change this copy only, never the server

function fixturePitchAct(pid, act) {
  const p = FIX_PITCHES.find((q) => q.id === pid);
  const nowIso = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  if (!p) { pitchErr.set(pid, 'No pitch ' + pid + '.'); return; }
  if (!scoutIn()) { pitchErr.set(pid, SC_OUT); return; }
  if (p.status !== 'open') { pitchErr.set(pid, `Pitch is ${p.status}, not open.`); return; }
  if (act === 'dismiss') Object.assign(p, { status: 'dismissed', updated_at: nowIso });
  else if (FIX_PITCHES.some((q) => q.status === 'running')) { pitchErr.set(pid, 'A builder is already running. One at a time.'); return; }
  else Object.assign(p, { status: 'running', terminal: null, branch: 'mgr-' + pid, note: 'Fixture: no builder launched.', updated_at: nowIso });
  SCOUT = normScout(Object.assign({}, SCOUT, { pitches: FIX_PITCHES.map((q) => Object.assign({}, q)) }));
}

function synth(a, st, seed) {
  const ac = Object.assign({ tool: null, target: null, text: null }, a.activity || {});
  if (st === 'working') { if (!ac.tool) { const c = CANNED[seed % CANNED.length]; ac.tool = c[0]; ac.target = c[1]; } }
  else if (st === 'blocked') { if (!ac.tool) { ac.tool = 'Bash'; ac.target = 'rm -rf build/'; } if (a.parent_id == null || a.kind !== 'subagent') ac.text = 'Waiting for permission'; }
  else if (st === 'error') { ac.tool = null; ac.target = null; if (a.kind !== 'subagent') ac.text = 'Command failed with exit code 1'; }
  else { ac.tool = null; ac.target = null; }
  return ac;
}

function makeBig(base, n) {
  const out = base.agents.map((a) => Object.assign({}, a));
  const tops = base.agents.filter((a) => !a.parent_id && a.kind !== 'scout');
  const DEPTS = Array.isArray(CFG.departments) && CFG.departments.length ? CFG.departments.map(String) : ['web', 'api', 'docs', 'infra', 'research', 'support', 'data'];
  const STS = ['working', 'thinking', 'idle', 'blocked', 'working', 'error', 'done', 'working', 'thinking'];
  const subtree = (id) => { const res = [], q = [base.agents.find((a) => a.id === id)]; while (q.length) { const x = q.shift(); res.push(x); for (const c of base.agents) if (c.parent_id === x.id) q.push(c); } return res; };
  let k = 0;
  const target = Math.max(base.agents.length, n);
  while (out.length < target && k < 200) {
    k++;
    const t = tops[k % tops.length];
    const dept = DEPTS[(k + 3) % DEPTS.length];
    const map = new Map();
    for (const a of subtree(t.id)) {
      if (out.length >= target) break;
      const h = hash32(a.id + '#' + k);
      const nid = a.id.startsWith('a:') ? 'a:' + h.toString(16).padStart(8, '0') + k.toString(16).padStart(9, '0') : a.id.startsWith('s:') ? 's:' + h.toString(16).padStart(8, '0') : 't' + (k * 16 + map.size).toString(36) + 'x';
      const pid = a.parent_id ? map.get(a.parent_id) : null;
      if (a.parent_id && !pid) continue;
      map.set(a.id, nid);
      let st = STS[h % STS.length];
      if (!pid && st === 'done') st = 'idle';
      const c = Object.assign({}, a, { id: nid, parent_id: pid, department: dept, status: st, name: pid ? a.name : 'agent-' + (h & 0xff).toString(16).padStart(2, '0'), desk: pid ? a.desk : dept + '-' + k });
      c.activity = synth(c, st, h);
      out.push(c);
    }
    if (k === 1) {        // one family with a big brood, so departments fill up
      const host = out.find((a) => a.id === map.get(t.id));
      for (let i = 0; i < 4 && host && out.length < target; i++) {
        const sp = SPAWN[(i + 1) % SPAWN.length], h = hash32(host.id + 'x' + i), st = ['working', 'thinking', 'working', 'blocked'][i];
        const c = { id: 'a:' + h.toString(16).padStart(8, '0') + 'b1g' + i, parent_id: host.id, kind: 'subagent', name: sp[0], role: sp[1], agent_type: sp[2], model: 'sonnet', department: host.department, desk: host.desk, status: st, activity: null, depth: 1, tool_count: 3 + i * 4, started_at: base.generated_at, last_active_at: base.generated_at };
        c.activity = synth(c, st, h);
        out.push(c);
      }
    }
  }
  out.sort((a, b) => (a.id < b.id ? -1 : 1));
  return Object.assign({}, base, { sources: { herdr: true, sessions: out.filter((a) => !a.parent_id).length }, agents: out });
}

function fixtureState(tick) {
  const base = FIX_BASE;
  const t0 = Date.parse(base.generated_at);
  const gen = new Date(t0 + tick * ROTATE_MS);
  const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');
  const agents = base.agents.map((a, i) => {
    const cyc = a.parent_id ? CYC_KID : CYC_TOP;
    let start = cyc.indexOf(a.status); if (start < 0) start = 0;
    const phase = i % 3, step = Math.floor((tick + phase) / 3);
    const st = cyc[(start + step) % cyc.length];
    const out = Object.assign({}, a, { status: st });
    if (step > 0) {
      out.activity = st === a.status ? a.activity : synth(a, st, hash32(a.id) + step);
      out.last_active_at = iso(t0 + Math.max(0, 3 * step - phase) * ROTATE_MS);
      out.tool_count = (a.tool_count || 0) + step * 3;
    }
    return out;
  });
  const tops = base.agents.filter((a) => !a.parent_id);
  for (let k = 1; k <= tick; k += 2) {
    const age = tick - k;
    if (age > 4 || !tops.length) continue;
    const parent = tops[(k >> 1) % tops.length];
    const sp = SPAWN[(k >> 1) % SPAWN.length];
    const st = age === 0 ? 'working' : age === 1 ? 'thinking' : age === 2 ? 'working' : 'done';
    const c = { id: 'a:fx' + String(k).padStart(15, '0'), parent_id: parent.id, kind: 'subagent', name: sp[0], role: sp[1], agent_type: sp[2], model: 'haiku', department: parent.department, desk: parent.desk, status: st, activity: null, depth: 1, tool_count: age * 4, started_at: iso(t0 + k * ROTATE_MS), last_active_at: iso(gen.getTime()) };
    c.activity = synth(c, st, k * 7 + age);
    agents.push(c);
  }
  agents.sort((a, b) => (a.id < b.id ? -1 : 1));
  const sa = agents.find((a) => a.kind === 'scout');
  const scout = Object.assign({}, base.scout || {}, sa ? { terminal: sa.id, status: sa.status, activity: sa.activity } : { terminal: null, status: 'offline' },
    { pitches: FIX_PITCHES.map((q) => Object.assign({}, q)) });
  return { generated_at: iso(gen.getTime()), sources: base.sources, agents, scout };
}

async function startFixture() {
  try {
    let base = await loadFixture();
    if (Q.get('scout') === 'off') base = Object.assign({}, base, { agents: base.agents.filter((a) => a.kind !== 'scout') });   // the scout is out
    FIX_PITCHES = ((base.scout && base.scout.pitches) || []).map((q) => Object.assign({}, q));
    FIX_BASE = FIXTURE === 'big' ? makeBig(base, BIG_N) : base;
    const only = Q.get('pick');
    if (only) {
      const keep = new Set([only]);
      for (let grew = true; grew;) { grew = false; for (const a of FIX_BASE.agents) if (a.parent_id && keep.has(a.parent_id) && !keep.has(a.id)) { keep.add(a.id); grew = true; } }
      FIX_BASE = Object.assign({}, FIX_BASE, { agents: FIX_BASE.agents.filter((a) => keep.has(a.id)).map((a) => (a.id === only ? Object.assign({}, a, { parent_id: null }) : a)) });
    }
    online = true;
    ingest(fixtureState(0));
    setInterval(() => { fixTick++; ingest(fixtureState(fixTick)); }, ROTATE_MS);
  } catch (e) {
    online = false;
    ingest({ generated_at: new Date().toISOString(), sources: { herdr: false, sessions: 0 }, agents: [] });
    showErr(e.message);
  }
}

// ============================================================ scenes: ?scene=<name> plays fixtures/scenes/<name>.json, for filming
// The office is drawn by the same code as live; only the data is scripted, so every take is the same and no agent runs.
// A scene is a list of beats. A beat fires `after` seconds after the one before it, or waits for Space or the
// right arrow (on:"next"). `reactions` are beat lists that start the moment you click: "assign:<pitch id>" for
// Assign on that pitch, "find" for Find work. They run alongside the main beats, so a click is answered at once.
// A beat can add agents, set fields on agents (by id), remove agents, replace `pitches` or merge into one (`pitch`).
// Keys: Space / → next, R restart, H show or hide the director's note. Scenes never POST anything.
const SC = { main: null, reactions: {}, fired: new Set(), agents: new Map(), pitches: [], hud: Q.get('hud') === '1' };
const scIso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');
function scenePitch(p, i) {    // the first pitch in the list is the newest, so it shows on top
  const t = scIso(Date.now() - (i || 0) * 1000);
  return Object.assign({ status: 'open', sources: [], created_at: t, updated_at: t, terminal: null, branch: null, result: null, note: null }, p);
}
function sceneState() {
  const agents = [...SC.agents.values()].map((a) => Object.assign({}, a, { activity: Object.assign({}, a.activity || {}) }));
  const sa = agents.find((a) => a.kind === 'scout');
  const scout = Object.assign(sa ? { terminal: sa.id, status: sa.status, activity: sa.activity } : { terminal: null, status: 'offline' }, { pitches: SC.pitches.map((p) => Object.assign({}, p)) });
  return { generated_at: scIso(Date.now()), sources: { herdr: true, sessions: agents.filter((a) => !a.parent_id).length }, agents, scout };
}
function sceneApply(b) {
  const now = Date.now();
  for (const id of b.remove || []) SC.agents.delete(id);
  for (const a of b.add || []) {
    const age = Number(a.age) || 0;
    const c = Object.assign({ depth: a.parent_id ? 1 : 0, model: 'opus', tool_count: 0, activity: {}, goal: null }, a, { started_at: scIso(now - age * 1000), last_active_at: scIso(now) });
    delete c.age;
    SC.agents.set(a.id, c);
  }
  for (const [id, ch] of Object.entries(b.set || {})) {
    const a = SC.agents.get(id);
    if (a) Object.assign(a, ch, { last_active_at: scIso(now), tool_count: (a.tool_count || 0) + 1 });
  }
  if (Array.isArray(b.pitches)) SC.pitches = b.pitches.map(scenePitch);
  for (const [id, ch] of Object.entries(b.pitch || {})) {
    const p = SC.pitches.find((q) => q.id === id);
    if (p) Object.assign(p, ch, { updated_at: scIso(now) });
  }
  ingest(sceneState());
}
// a track plays one list of beats; the main track and each reaction get their own
function sceneTrack(beats, loop) { const t = { beats: beats.map((b) => Object.assign({}, b)), i: 0, timer: null, waiting: null, loop: !!loop }; sceneStep(t); return t; }
function sceneStep(t) {
  clearTimeout(t.timer);
  while (t.i < t.beats.length) {
    const b = t.beats[t.i];
    if (b.on && !b._go) { t.waiting = b; sceneHud(); return; }
    if (b.after > 0 && !b._armed) { b._armed = true; t.waiting = null; sceneHud(); t.timer = setTimeout(() => sceneStep(t), b.after * 1000); return; }
    t.waiting = null; t.i++;
    sceneApply(b);
    if (t.loop && t.i >= t.beats.length && t.beats.length) { t.i = 0; for (const x of t.beats) x._armed = false; }   // the ambient track goes round again
  }
  t.waiting = null; if (t === SC.main) sceneHud();
}
function sceneEvent(on, pitch) {
  const key = on === 'assign' ? 'assign:' + pitch : on;
  if (SC.reactions[key] && !SC.fired.has(key)) { SC.fired.add(key); sceneTrack(SC.reactions[key]); return; }
  const t = SC.main, w = t && t.waiting;
  if (w && w.on === on && (!w.which || w.which === pitch)) { w._go = true; sceneStep(t); }   // a stray key press never skips ahead
}
function scenePitchAct(pid, act) {
  const p = SC.pitches.find((q) => q.id === pid);
  if (!p || p.status !== 'open') return;
  if (act === 'dismiss') { p.status = 'dismissed'; p.updated_at = scIso(Date.now()); ingest(sceneState()); return; }
  pitchSent.set(pid, `Sent. ${SC_FIRST} starts a builder.`);
  sceneEvent('assign', pid);
}
function sceneHud() {
  let el = document.getElementById('sceneHud');
  if (!el) {
    el = document.createElement('div'); el.id = 'sceneHud';
    el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99;font:12px/1.4 ui-monospace,monospace;background:rgba(20,20,28,.85);color:#fff;padding:6px 9px;border-radius:6px;pointer-events:none';
    document.body.appendChild(el);
  }
  el.hidden = !SC.hud;
  const t = SC.main;
  if (!t) return;
  const w = t.waiting, n = t.beats.length, b = t.beats[Math.min(t.i, n - 1)];
  const open = SC.pitches.filter((p) => p.status === 'open' && SC.reactions['assign:' + p.id] && !SC.fired.has('assign:' + p.id));
  const now = w ? 'press Space' : t.i >= n ? 'main beats done (R restarts)' : 'playing';
  el.textContent = `scene ${SCENE} · beat ${Math.min(t.i + 1, n)}/${n} · ${now}${b && b.note ? ' · ' + b.note : ''}${open.length ? ' · Assign ready: ' + open.map((p) => p.title).join(', ') : ''}`;
}
async function startScene() {
  try {
    const r = await fetch('/fixtures/scenes/' + SCENE + '.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('no scene called ' + SCENE + ' in fixtures/scenes/');
    const j = await r.json();
    SC.reactions = j.reactions && typeof j.reactions === 'object' ? j.reactions : {};
    online = true;
    SC.main = sceneTrack(Array.isArray(j.beats) ? j.beats : []);
    sceneHud();
    if (Array.isArray(j.ambient) && j.ambient.length && j.ambient.every((b) => b.after > 0)) sceneTrack(j.ambient, true);   // background life
    if (!STATE) ingest(sceneState());
    setInterval(() => ingest(sceneState()), POLL_MS);    // the same heartbeat as live polling
  } catch (e) {
    online = false;
    ingest({ generated_at: new Date().toISOString(), sources: { herdr: false, sessions: 0 }, agents: [] });
    showErr(e.message);
  }
}
document.addEventListener('keydown', (e) => {
  if (!SCENE || e.metaKey || e.ctrlKey || e.altKey || (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) return;
  if (e.key === ' ' || e.key === 'ArrowRight') { e.preventDefault(); sceneEvent('next'); }
  else if (e.key === 'r' || e.key === 'R') location.reload();
  else if (e.key === 'h' || e.key === 'H') { SC.hud = !SC.hud; sceneHud(); }
});

// ============================================================ main loop
let lastFrame = performance.now();
function frame(fallback) {
  const now = performance.now();
  const dt = Math.min(fallback ? 250 : 100, now - lastFrame); lastFrame = now;
  if (LAY) {
    if (skyBand() !== staticKey.split('|')[3]) { staticKey = layoutKey(); drawStatic(); }
    stepActors(now, dt);
    tickScout(now);
    pickCamera();
    tickQuips(now);
    drawDynamic(now);
    if (overlayDirty && now - lastOverlay > 100) { overlayDirty = false; lastOverlay = now; renderOverlay(); }
  }
  if (fallback !== true) requestAnimationFrame(frame);
}
// keep walking and the camera moving when rAF is throttled (background tab, headless capture)
setInterval(() => { if (performance.now() - lastFrame > 150) frame(true); }, 100);

// ?debug=1: read-only probes for headless checks
if (Q.get('debug') === '1') {
  window.__dm = {
    scout() { const act = scoutId && actors.get(scoutId); const a = scoutId && AG.get(scoutId); return { id: scoutId, status: a ? a.status : null, mode: act ? act.mode : null, patrol: !!(act && act.patrol), x: act ? Math.round(act.x || (act.loc && act.loc.x) || 0) : null, y: act ? Math.round(act.y || (act.loc && act.loc.y) || 0) : null, seat: act && act.loc ? act.loc.seatKey || null : null, clip: !!a && openPitches().length > 0 }; },
    cast: () => Object.fromEntries(CASTMAP),
    pinned: () => manualId,
    pitches: () => SCOUT.pitches.map((p) => ({ id: p.id, status: p.status })),
    stored: () => store.get(STORE_KEY),
  };
}
updateChrome();
if (SCENE) startScene(); else if (FIXTURE) startFixture(); else poll();
requestAnimationFrame(frame);
})();
