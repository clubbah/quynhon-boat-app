/* Shared code for the design-preview pages (next-storms.html, next-spot.html).
   The same sky engine, map colours and ship drawings as next.html.
   Imported with ?v=N: bump N on every change (service worker and Cloudflare
   cache this file by its full address). */
import { flagSrc, getCountryName } from '/js/vessel-icons.js?v=2';

export { getCountryName };
export const KEY = 'CKY69E5ib1MMQDfWMRvg';
export const QN = { lat: 13.77, lng: 109.22 };
export const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const $ = (s, r = document) => r.querySelector(s);
export const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ---------- Sky: light follows the real sun over Quy Nhon ---------- */
export const PAL = {
  day:    { skyTop: '#2b7fd0', skyHor: '#cfe9f6', fog: '#dff1f8', sea: '#1c86b3', seaDeep: '#0f5f8c', land: '#eef0e4', green: '#cde2bd', urban: '#e9e7dc', building: '#dcd9cc', road: '#ffffff', label: '#1c3a4a', halo: '#ffffff', hillShadow: '#55766a', hillLight: '#ffffff' },
  sunset: { skyTop: '#2a3f78', skyHor: '#f79b57', fog: '#f4b384', sea: '#24506f', seaDeep: '#16324d', land: '#2b2a40', green: '#272c3f', urban: '#333049', building: '#3d3852', road: '#4d4763', label: '#f3d9c4', halo: '#1c1b2c', hillShadow: '#14131f', hillLight: '#c9785a' },
  night:  { skyTop: '#030810', skyHor: '#10263a', fog: '#0c1c2b', sea: '#071620', seaDeep: '#040d14', land: '#132731', green: '#10232c', urban: '#172e39', building: '#1c3540', road: '#7a6232', label: '#bccdd3', halo: '#0b1a21', hillShadow: '#050c11', hillLight: '#2b4a58' },
};
export const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export const rgb2hex = (c) => '#' + c.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
function blend(w) {
  const out = {};
  for (const k of Object.keys(PAL.day)) {
    const d = hex2rgb(PAL.day[k]), s = hex2rgb(PAL.sunset[k]), n = hex2rgb(PAL.night[k]);
    out[k] = rgb2hex([0, 1, 2].map((i) => d[i] * w.d + s[i] * w.s + n[i] * w.n));
  }
  return out;
}
export function sunElevation(date) {
  const rad = Math.PI / 180;
  const y = date.getUTCFullYear();
  const day = (Date.UTC(y, date.getUTCMonth(), date.getUTCDate()) - Date.UTC(y, 0, 0)) / 864e5;
  const hr = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const g = (2 * Math.PI / 365) * (day - 1 + (hr - 12) / 24);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const tst = hr * 60 + eqt + 4 * QN.lng;
  const ha = (tst / 4 - 180) * rad;
  const cosZ = Math.sin(QN.lat * rad) * Math.sin(decl) + Math.cos(QN.lat * rad) * Math.cos(decl) * Math.cos(ha);
  return 90 - Math.acos(clamp(cosZ, -1, 1)) / rad;
}
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/* mode: 'live' follows the clock; 'day', 'sunset' and 'night' force a look */
export function skyNow(mode = 'live') {
  let w;
  if (mode === 'day') w = { d: 1, s: 0, n: 0 };
  else if (mode === 'sunset') w = { d: 0, s: 1, n: 0 };
  else if (mode === 'night') w = { d: 0, s: 0, n: 1 };
  else { const e = sunElevation(new Date()); const d = smooth(-1, 9, e), n = 1 - smooth(-11, -3, e); w = { d, n, s: clamp(1 - d - n, 0, 1) }; }
  const P = blend(w), dark = w.d < 0.5, deep = hex2rgb(P.seaDeep), root = document.documentElement;
  root.style.setProperty('--sky-top', P.skyTop);
  root.style.setProperty('--sky-hor', P.skyHor);
  root.style.setProperty('--sea', P.sea);
  root.style.setProperty('--sea-deep', P.seaDeep);
  root.style.setProperty('--scrim-a', `rgba(${deep.join(',')},.96)`);
  root.style.setProperty('--scrim-b', `rgba(${deep.join(',')},.62)`);
  root.dataset.ui = dark ? 'dark' : 'light';
  return { P, w, dark, key: [w.d, w.s, w.n].map((v) => v.toFixed(2)).join('|') };
}

/* Recolour the MapTiler streets style in place: quiet land, strong sea, few labels. */
export function paintBase(map, P, opts = {}) {
  const set = (id, prop, v) => { try { map.setPaintProperty(id, prop, v); } catch { /* property not on this layer */ } };
  const hide = (id) => { try { map.setLayoutProperty(id, 'visibility', 'none'); } catch { /* ignore */ } };
  const first = !map.__qnPainted;
  for (const l of map.getStyle().layers) {
    if (l.id.startsWith('qn-')) continue;
    const src = l['source-layer'] || '';
    if (l.type === 'background') set(l.id, 'background-color', P.land);
    else if (l.type === 'fill') {
      if (first) set(l.id, 'fill-pattern', undefined);
      if (src === 'water') { set(l.id, 'fill-color', P.sea); set(l.id, 'fill-opacity', 1); }
      else if (src === 'building') { set(l.id, 'fill-color', P.building); set(l.id, 'fill-outline-color', P.building); }
      else if (src === 'globallandcover' || src === 'landcover') set(l.id, 'fill-color', P.green);
      else if (src === 'transportation' || src === 'aeroway') set(l.id, 'fill-color', P.road);
      else set(l.id, 'fill-color', P.urban);
    } else if (l.type === 'line') {
      if (src === 'waterway') set(l.id, 'line-color', P.sea);
      else if (src === 'boundary' && opts.borders) { set(l.id, 'line-color', P.label); set(l.id, 'line-opacity', 0.35); }
      else if (src === 'transportation') {
        if (/outline|casing|hatching|ferry|railway|footway|path|tunnel/i.test(l.id)) { if (first) hide(l.id); }
        else set(l.id, 'line-color', P.road);
      } else if (first) hide(l.id);
    } else if (l.type === 'symbol') {
      if (src === 'place') { set(l.id, 'text-color', P.label); set(l.id, 'text-halo-color', P.halo); set(l.id, 'text-halo-width', 1.4); }
      else if (first) hide(l.id);
    } else if (l.type === 'fill-extrusion' && first) hide(l.id);
  }
  map.__qnPainted = true;
}

/* ---------- Page chrome: menu, top bar, reveals, toast ---------- */
let toastTimer = 0;
export function toast(msg) {
  const t = $('#toast'); if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}
export function initChrome(solidAfter) {
  const top = $('#top'), btn = $('#menuBtn'), nav = $('#nav');
  btn.addEventListener('click', () => { const open = top.classList.toggle('open'); btn.setAttribute('aria-expanded', open ? 'true' : 'false'); });
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) { top.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); } });
  const langs = $('.langs'); if (langs) langs.addEventListener('click', () => toast('This preview is in English only.'));
  const onScroll = () => top.classList.toggle('solid', scrollY > solidAfter());
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
  const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  document.querySelectorAll('.rv').forEach((n) => io.observe(n));
}

/* ---------- Small helpers ---------- */
export const getJSON = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); };
export const qnTime = (d, opts) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', ...opts }).format(d);
export const compass = (deg) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((deg % 360) + 360) % 360) / 45) % 8];
export const compassWord = (deg) => ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round((((deg % 360) + 360) % 360) / 45) % 8];
export function agoText(iso) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60);
  return h < 24 ? h + ' hr ago' : Math.round(h / 24) + ' days ago';
}
export const cleanName = (n) => String(n || '').replace(/\s+/g, ' ').trim();
export const bucket = (v) => (['Cargo', 'Tanker', 'Passenger', 'Fishing'].includes(v.vessel_type_label) ? v.vessel_type_label : 'Other');
export const validDeg = (x) => Number.isFinite(x) && x >= 0 && x < 360;
export const isShip = (v) => !v.is_gear && Number.isFinite(v.lat) && Number.isFinite(v.lng);
export function flagImg(code, w = 24, h = 18) {
  const src = flagSrc(code, '40x30');
  if (!src) return null;
  const i = el('img'); i.src = src; i.alt = ''; i.loading = 'lazy'; i.width = w; i.height = h;
  return i;
}
export function haversineKm(lat1, lng1, lat2, lng2) {
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
export function bearingDeg(lat1, lng1, lat2, lng2) {
  const r = Math.PI / 180, dLng = (lng2 - lng1) * r;
  const y = Math.sin(dLng) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos(dLng);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}
/* signed difference a - b, in the range -180 to 180 */
export const angleDelta = (a, b) => ((a - b + 540) % 360) - 180;

/* wave line for the "waves" tile */
export function wavePath(amp, phase) {
  let d = '';
  for (let x = 0; x <= 800; x += 10) d += (x ? 'L' : 'M') + x + ' ' + (52 + amp * Math.sin((x / 200) * 2 * Math.PI + phase)).toFixed(1);
  return d;
}

/* ---------- Ship drawings (the detailed top-down set from next.html) ---------- */
const ART = { R: 3, W: 30, H: 96, len: 84 };
const LIVERY = {
  Cargo: { hull: '#22313f', deck: '#f3e7cf', dims: [9.5, 20, 4] },
  Tanker: { hull: '#3a1a14', deck: '#e8583f', dims: [10.5, 22, 5] },
  Passenger: { hull: '#f7fbfc', deck: '#54e0a0', dims: [8.5, 30, 6] },
  Fishing: { hull: '#ffc233', deck: '#ffe08a', dims: [9, 26, 2.5] },
  Other: { hull: '#3f5560', deck: '#b9c8cf', dims: [10, 16, 5] },
};
const BOXES = ['#c8553d', '#2e7f86', '#e0a23b', '#4a6fa5', '#8f9aa3', '#c8553d', '#4a6fa5', '#e0a23b', '#2e7f86', '#c8553d', '#8f9aa3', '#2e7f86'];
const INK = '#1c2d3a';
function hullPath(c, hw, bow, sr, inset) {
  const top = inset * 1.9, bot = 84 - inset, w = hw - inset, b = Math.max(4, bow - inset), r = Math.max(0.6, sr - inset * 0.8);
  c.beginPath();
  c.moveTo(0, top);
  c.bezierCurveTo(w * 0.55, top + b * 0.35, w, top + b * 0.7, w, top + b);
  c.lineTo(w, bot - r); c.quadraticCurveTo(w, bot, w - r, bot);
  c.lineTo(-w + r, bot); c.quadraticCurveTo(-w, bot, -w, bot - r);
  c.lineTo(-w, top + b);
  c.bezierCurveTo(-w, top + b * 0.7, -w * 0.55, top + b * 0.35, 0, top);
  c.closePath();
}
function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
const box = (c, col, x, y, w, h) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
const disc = (c, col, x, y, r) => { c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); };
function bridge(c, hw, y, h, funnel, band) {
  box(c, '#ffffff', -(hw - 1.9), y, 2 * (hw - 1.9), 2.2);
  box(c, '#ffffff', -(hw - 2.4), y, 2 * (hw - 2.4), h);
  box(c, INK, -(hw - 3), y + 0.5, 2 * (hw - 3), 1.3);
  box(c, funnel, -2.3, y + h * 0.52, 4.6, 3.8);
  box(c, band, -2.3, y + h * 0.52 + 1.1, 4.6, 1.1);
}
const DETAIL = {
  Cargo(c, hw) {
    const cw = (2 * (hw - 2.9)) / 3;
    for (let b = 0; b < 4; b++) for (let i = 0; i < 3; i++) box(c, BOXES[b * 3 + i], -(hw - 2.9) + i * cw + 0.25, 24 + b * 11.6, cw - 0.5, 10);
    disc(c, INK, -2.2, 15, 0.9); disc(c, INK, 2.2, 15, 0.9);
    bridge(c, hw, 72, 10.5, '#22313f', '#e0a23b');
  },
  Tanker(c, hw) {
    for (let y = 26; y <= 68; y += 7) box(c, 'rgba(120,30,18,.55)', -(hw - 2), y, 2 * (hw - 2), 0.6);
    box(c, '#ffd3c8', -1.6, 21, 1.1, 50); box(c, '#ffd3c8', 0.5, 21, 1.1, 50);
    box(c, '#ffe9e2', -(hw - 3.2), 43, 2 * (hw - 3.2), 1.4); box(c, '#ffe9e2', -(hw - 3.2), 46.4, 2 * (hw - 3.2), 1.4);
    for (const y of [29, 36, 54, 61]) { disc(c, '#ffd3c8', -5.2, y, 1); disc(c, '#ffd3c8', 5.2, y, 1); }
    bridge(c, hw, 73, 10, '#3a1a14', '#ffffff');
  },
  Passenger(c, hw) {
    c.fillStyle = '#ffffff'; rr(c, -(hw - 2.2), 27, 2 * (hw - 2.2), 54, 4); c.fill();
    c.fillStyle = '#e6eff2'; rr(c, -(hw - 4), 33, 2 * (hw - 4), 42, 3); c.fill();
    box(c, '#1f9c8f', -(hw - 2.2), 30.5, 2 * (hw - 2.2), 0.9); box(c, '#1f9c8f', -(hw - 2.2), 77.5, 2 * (hw - 2.2), 0.9);
    box(c, INK, -(hw - 3.4), 27.9, 2 * (hw - 3.4), 1.3);
    for (const y of [38, 46, 54, 62, 70]) for (const s of [-1, 1]) { c.fillStyle = '#ff8a3d'; rr(c, s * (hw - 3.4) - 0.8, y, 1.6, 4.6, 0.8); c.fill(); }
    c.fillStyle = '#0f4d57'; c.beginPath(); c.ellipse(0, 57, 2.4, 3.4, 0, 0, 7); c.fill(); box(c, '#54e0a0', -2.4, 56.4, 4.8, 1.1);
    c.fillStyle = '#57c7ff'; rr(c, -2.2, 66, 4.4, 5.5, 1.2); c.fill();
  },
  Fishing(c, hw) {
    for (let y = 22; y <= 80; y += 4.5) box(c, 'rgba(140,84,20,.4)', -hw, y, 2 * hw, 0.5);
    c.fillStyle = '#9c6a32'; rr(c, -3.6, 30, 7.2, 11, 1); c.fill(); box(c, '#b9844a', -2.4, 31.4, 4.8, 8.2);
    c.fillStyle = '#fdfdfd'; rr(c, -(hw - 3), 50, 2 * (hw - 3), 18, 1.5); c.fill();
    box(c, '#2f7bd6', -(hw - 3), 50, 2 * (hw - 3), 3); box(c, INK, -(hw - 3.8), 53.6, 2 * (hw - 3.8), 1.2);
    box(c, '#5b4020', -3, 72, 6, 4);
  },
  Other(c, hw) {
    c.fillStyle = '#ff7a3d'; rr(c, -(hw - 3), 22, 2 * (hw - 3), 22, 2.5); c.fill();
    c.fillStyle = '#ffa06e'; rr(c, -(hw - 4.6), 26, 2 * (hw - 4.6), 14, 2); c.fill();
    box(c, INK, -(hw - 3.8), 22.8, 2 * (hw - 3.8), 1.4);
    box(c, '#22313f', -4.4, 46, 2.6, 4); box(c, '#22313f', 1.8, 46, 2.6, 4);
    disc(c, '#3f5560', 0, 61, 3); disc(c, '#22313f', 0, 61, 1.3);
  },
};
const artCache = {};
function shipCanvas(type) {
  if (artCache[type]) return artCache[type];
  const L = LIVERY[type], hw = L.dims[0], bow = L.dims[1], sr = L.dims[2];
  const cv = document.createElement('canvas'); cv.width = ART.W * ART.R; cv.height = ART.H * ART.R;
  const c = cv.getContext('2d');
  c.scale(ART.R, ART.R); c.translate(ART.W / 2, (ART.H - ART.len) / 2);
  c.save(); c.shadowColor = 'rgba(0,10,20,.6)'; c.shadowBlur = 3.6 * ART.R; hullPath(c, hw, bow, sr, 0); c.fillStyle = L.hull; c.fill(); c.restore();
  if (type === 'Fishing') {
    c.strokeStyle = '#6b4a22'; c.lineWidth = 0.9; c.lineCap = 'round';
    for (const s of [-1, 1]) { c.beginPath(); c.moveTo(0, 38); c.lineTo(s * 13.5, 32); c.moveTo(0, 62); c.lineTo(s * 13.5, 68); c.stroke(); }
  }
  hullPath(c, hw, bow, sr, 0); c.fillStyle = L.hull; c.fill();
  c.save();
  hullPath(c, hw, bow, sr, 1.7); c.fillStyle = L.deck; c.fill(); c.clip();
  DETAIL[type](c, hw);
  const g = c.createLinearGradient(-hw, 0, hw, 0);
  g.addColorStop(0, 'rgba(255,255,255,.18)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,.2)');
  c.fillStyle = g; c.fillRect(-20, -6, 40, 96);
  c.restore();
  hullPath(c, hw, bow, sr, 0); c.lineWidth = 0.8; c.strokeStyle = 'rgba(8,20,28,.85)'; c.stroke();
  return (artCache[type] = cv);
}
/* a small picture of a ship; bow to the right, or bow up when upright is true */
export function shipThumb(type, len, upright) {
  const src = shipCanvas(LIVERY[type] ? type : 'Other'), dpr = Math.min(devicePixelRatio || 1, 2), across = (len * ART.W) / ART.H;
  const cv = el('canvas'); cv.setAttribute('aria-hidden', 'true');
  const w = upright ? across : len, h = upright ? len : across;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w.toFixed(1) + 'px'; cv.style.height = h.toFixed(1) + 'px';
  const c = cv.getContext('2d'); c.scale(dpr, dpr);
  if (upright) c.drawImage(src, 0, 0, across, len);
  else { c.translate(len, 0); c.rotate(Math.PI / 2); c.drawImage(src, 0, 0, across, len); }
  return cv;
}
