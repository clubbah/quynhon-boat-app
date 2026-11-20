// HTML builders for the Port in Numbers page (/trends). Pure functions, no
// DOM: the server uses them to put the numbers in the page HTML and the page
// script uses them to refresh, so both always produce the same markup.
//
// `tr` is { lang, t(key), tType(label) }.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Strip the trailing battery indicator that VN fishing transponders append
// ("NHAT LINH45%" -> "NHAT LINH"), for archive rows seen before the fix.
const cleanName = (s) => String(s || '').replace(/[\s-]*\d{1,3}%\s*$/, '').trim() || String(s || '');

// Pre-fix archive rows can hold garbled names; fall back to the MMSI.
const displayName = (r) => {
  const n = cleanName(r.name);
  return (!n || /[<>\[\]{}|^;"!~*=]/.test(n)) ? r.mmsi : n;
};

// Only real 2-letter codes make a flag image; old rows stored names.
const cc = (s) => { const c = String(s || '').trim().toLowerCase(); return /^[a-z]{2}$/.test(c) ? c : ''; };
const flag = (country, cls) => cc(country)
  ? `<img class="${cls}" src="https://flagcdn.com/20x15/${cc(country)}.png" alt="" loading="lazy" />` : '';

export function countryName(code, tr) {
  const c = String(code || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return c || tr.t('trends_unknown');
  try { return new Intl.DisplayNames([tr.lang, 'en'], { type: 'region' }).of(c) || c; } catch { return c; }
}

const TYPE_COLORS = { cargo: '#2563eb', tanker: '#dc2626', passenger: '#16a34a', fishing: '#ca8a04', other: '#8ca5ad' };
const typeClass = (label) => {
  const l = (label || '').toLowerCase();
  if (l.includes('cargo') || l.includes('container')) return 'cargo';
  if (l.includes('tanker')) return 'tanker';
  if (l.includes('passenger')) return 'passenger';
  if (l.includes('fishing')) return 'fishing';
  return 'other';
};

const fmt = (n, tr) => Number(n || 0).toLocaleString(tr.lang);

export function statsValues(d, tr) {
  return {
    's-unique': fmt(d.totalUnique, tr),
    's-month': fmt(d.newThisMonth, tr),
    's-arrivals': fmt(d.totalArrivals, tr),
    's-countries': fmt(d.countriesSeen, tr),
  };
}

const emptyHtml = (tr) => `<div class="empty empty--inner">${esc(tr.t('trends_empty'))}</div>`;

function barsHtml(rows, keyHtml, colorFromType, tr) {
  if (!rows || rows.length === 0) return emptyHtml(tr);
  const max = Math.max(...rows.map((r) => r.c), 1);
  return rows.map((r) => {
    const cls = colorFromType ? typeClass(r.vessel_type_label) : '';
    return `<div class="bar-row">
          <span class="bar-key">${keyHtml(r)}</span>
          <span class="bar-track"><span class="bar-fill ${cls}" style="width:${Math.round((r.c / max) * 100)}%"></span></span>
          <span class="bar-count">${esc(r.c)}</span>
        </div>`;
  }).join('');
}

export function flagsHtml(rows, tr) {
  return barsHtml(rows, (r) => `${flag(r.flag_country, '')}<span>${esc(countryName(r.flag_country, tr))}</span>`, false, tr);
}

export function typesHtml(rows, tr) {
  return barsHtml(rows, (r) => `<span class="dot" style="background:${TYPE_COLORS[typeClass(r.vessel_type_label)]}"></span><span>${esc(tr.tType(r.vessel_type_label || 'Other'))}</span>`, true, tr);
}

// 14-day arrivals chart. Days are UTC dates, matching the byDay rows.
export function chartHtml(byDay, tr, now = Date.now()) {
  const counts = Object.fromEntries((byDay || []).map((d) => [d.day, d.c]));
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const day = new Date(now - i * 86400000).toISOString().slice(0, 10);
    days.push({ day, c: counts[day] || 0 });
  }
  const max = Math.max(...days.map((d) => d.c), 1);
  return days.map((d) => {
    const title = tr.t('trends_day_arrivals').replace('{day}', d.day).replace('{n}', d.c);
    return `<div class="chart-col" title="${esc(title)}">
          <span class="chart-num">${d.c || ''}</span>
          <span class="chart-bar ${d.c === 0 ? 'dim' : ''}" style="height:${Math.max(2, Math.round((d.c / max) * 100))}%"></span>
          <span class="chart-day">${parseInt(d.day.slice(8), 10)}</span>
        </div>`;
  }).join('');
}

function listHtml(rows, metric, tr) {
  if (!rows || rows.length === 0) return emptyHtml(tr);
  return rows.map((r, i) => `
        <div class="list-row">
          <span class="list-rank">${i + 1}</span>
          ${flag(r.flag_country, 'list-flag')}
          <span class="list-main">
            <span class="list-name">${esc(displayName(r))}</span>
            <span class="list-sub">${esc(r.vessel_type_label ? tr.tType(r.vessel_type_label) : tr.t('th_vessel'))}</span>
          </span>
          <span class="list-metric">${metric(r)}</span>
        </div>`).join('');
}

export function frequentHtml(rows, tr) {
  return listHtml(rows, (r) => `${esc(r.visit_count || 0)}<small>${esc(tr.t('trends_visits'))}</small>`, tr);
}

export function largestHtml(rows, tr) {
  return listHtml(rows, (r) => (r.length ? `${esc(r.length)}<small>m${r.width ? ' x ' + esc(r.width) : ''}</small>` : ''), tr);
}

// Everything the page shows, keyed by element id: { id: innerHTML }.
export function trendsSections(d, tr, now = Date.now()) {
  const out = {};
  for (const [id, v] of Object.entries(statsValues(d, tr))) out[id] = esc(v);
  out.chart = chartHtml(d.byDay, tr, now);
  out.flags = flagsHtml(d.flags, tr);
  out.types = typesHtml(d.types, tr);
  out.frequent = frequentHtml(d.frequent, tr);
  out.largest = largestHtml(d.largest, tr);
  return out;
}
