import { describe, it, expect, vi } from 'vitest';
import { renderPage, createPageRenderer, applyI18n, setInner, findClose, headTags } from '../server/render.js';
import { LANGS, urlFor } from '../server/routes.js';
import { sunsetForecast } from '../public/js/sunset.js';
import { translations } from '../public/js/i18n-data.js';

// 15:00 in Quy Nhon (UTC+7), before tonight's 17:12 sunset.
const NOW = new Date('2026-11-20T08:00:00Z');

const weather = {
  weather: {
    current: { temperature_2m: 27.4, relative_humidity_2m: 78, wind_speed_10m: 14.2, wind_direction_10m: 45, precipitation: 0.2 },
    hourly: {
      time: ['2026-11-20T16:00', '2026-11-20T17:00', '2026-11-20T18:00'],
      cloud_cover: [30, 30, 30], cloud_cover_low: [20, 20, 20], cloud_cover_mid: [20, 20, 20],
      cloud_cover_high: [20, 20, 20], visibility: [15000, 15000, 15000], precipitation_probability: [5, 5, 5],
    },
    daily: { sunrise: ['2026-11-20T05:52', '2026-11-21T05:53'], sunset: ['2026-11-20T17:12', '2026-11-21T17:13'] },
  },
  marine: { current: { wave_height: 1.24 } },
};

const stats = {
  total: 53, moving: 12, anchored: 41,
  vesselOfDay: { mmsi: 574000111, name: 'HAI PHONG STAR', length: 199, width: 32, flag_country: 'VN', vessel_type_label: 'Cargo', destination: 'QUY NHON' },
  recentActivity: [
    { mmsi: 412000001, name: '<script>alert(1)</script>', vessel_type_label: 'Tanker', flag_country: 'SG', speed: 0, nav_status_label: 'At Anchor', destination: 'X&Y', updated_at: '2026-11-20T07:55:00Z' },
  ],
};
const pulse = [{ mmsi: 574000222, name: 'TAN CANG 01', event: 'arrival', vessel_type_label: 'Cargo', flag_country: 'VN', timestamp: '2026-11-20T07:30:00Z' }];
const archive = { totalUnique: 1855 };
const stormClear = { active: false, updatedAt: '2026-11-20T07:50:00Z' };
const stormWarning = {
  active: true, updatedAt: '2026-11-20T07:50:00Z',
  storm: { name: 'KALMAEGI', category: 'Typhoon', windKmh: 150, alertlevel: 'Red' },
  threat: { level: 'warning', currentDistanceKm: 420, distanceKm: 60, etaHours: 30, currentBearing: 90 },
};
const trends = {
  totalUnique: 1855, newThisMonth: 120, totalArrivals: 900, countriesSeen: 14,
  byDay: [{ day: '2026-11-19', c: 12 }],
  flags: [{ flag_country: 'VN', c: 900 }],
  types: [{ vessel_type_label: 'Cargo', c: 300 }],
  frequent: [{ mmsi: 3, name: 'FREQUENT ONE', flag_country: 'VN', vessel_type_label: 'Cargo', visit_count: 40 }],
  largest: [{ mmsi: 4, name: 'BIG ONE', length: 300, width: 48, flag_country: 'PA', vessel_type_label: 'Tanker' }],
};
const homeData = { stats, pulse, archive, weather, storm: stormClear };

const text = (html, id) => {
  const m = new RegExp(`id="${id}"[^>]*>([^<]*)`).exec(html);
  return m ? m[1] : null;
};

describe('HTML helpers', () => {
  it('findClose skips nested tags of the same name', () => {
    const html = '<div id="a"><div>x</div><div><div>y</div></div></div><p>after</p>';
    const close = findClose(html, html.indexOf('>') + 1, 'div');
    expect(html.slice(close.closeEnd)).toBe('<p>after</p>');
  });

  it('setInner replaces nested content', () => {
    const html = '<div id="t"><div class="empty">x</div></div><span id="t2">y</span>';
    expect(setInner(html, 't', 'NEW')).toBe('<div id="t">NEW</div><span id="t2">y</span>');
    expect(setInner(html, 'missing', 'NEW')).toBe(html);
  });

  it('applyI18n escapes text, keeps -html raw and fills attributes', () => {
    const html = '<span data-i18n="storm_nav">Storm Tracker</span><p data-i18n-html="sp_no_match">old</p>'
      + '<input placeholder="x" data-i18n-placeholder="search_placeholder" data-i18n-aria="search_aria">'
      + '<button title="t" data-i18n-title="map_recenter"></button>';
    const out = applyI18n(html, 'vi');
    expect(out).toContain(`<span data-i18n="storm_nav">${translations.vi.storm_nav}</span>`);
    expect(out).toContain(translations.vi.sp_no_match); // contains a raw <br>
    expect(out).toContain(`placeholder="${translations.vi.search_placeholder}"`);
    expect(out).toContain(`aria-label="${translations.vi.search_aria}"`);
    expect(out).toContain(`title="${translations.vi.map_recenter}"`);
  });
});

describe('page head', () => {
  it('has a self canonical, all five hreflang links and x-default to English', () => {
    for (const page of ['home', 'storms', 'trends', 'spot']) {
      for (const lang of LANGS) {
        const head = headTags(page, lang);
        expect(head).toContain(`<link rel="canonical" href="${urlFor(page, lang)}">`);
        for (const l of LANGS) expect(head).toContain(`hreflang="${l}" href="${urlFor(page, l)}"`);
        expect(head).toContain(`hreflang="x-default" href="${urlFor(page, 'en')}"`);
        expect(head).toContain(`<meta property="og:url" content="${urlFor(page, lang)}">`);
        expect(head).toContain('og:image" content="https://quynhonlife.com/img/og-image.png"');
      }
    }
  });

  it('adds the saved-language redirect only to English pages', () => {
    expect(headTags('home', 'en')).toContain("localStorage.getItem('lang')");
    expect(headTags('home', 'vi')).not.toContain('localStorage');
  });
});

describe('renderPage: home', () => {
  const { html, complete } = renderPage('home', 'vi', homeData, { now: NOW });

  it('is in Vietnamese at the Vietnamese address', () => {
    expect(html).toContain('<html lang="vi"');
    expect(html).toContain(`<title>${translations.vi.meta_home_title}</title>`);
    expect(html).toContain('<link rel="canonical" href="https://quynhonlife.com/vi/">');
    expect(html).toContain(translations.vi.about_p1);
    expect(html).toContain('Gia Lai');
  });

  it('carries the live numbers with no placeholders left', () => {
    expect(complete).toBe(true);
    expect(html).not.toMatch(/>--</);
    expect(text(html, 'weather-temp')).toBe('27°C');
    expect(text(html, 'ps-total')).toBe('53');
    expect(text(html, 'ps-moving')).toBe('12');
    expect(text(html, 'ps-anchored')).toBe('41');
    expect(html).toContain('1.2m ' + translations.vi.waves);
    expect(text(html, 'sunset-time')).toBe(`${translations.vi.sunset_this_evening} 17:12`);
    expect(html).toContain('HAI PHONG STAR');
    expect(html).toContain('TAN CANG 01');
    expect(html).toContain('1855');
  });

  it('escapes names that came over the air', () => {
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('X&amp;Y');
  });

  it('points internal links at Vietnamese pages and the flags at every language', () => {
    expect(html).toContain('href="/vi/storms"');
    expect(html).toContain('href="/vi/trends"');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('<a href="/" hreflang="en"');
    expect(html).toContain('<a href="/ja/" hreflang="ja"');
    expect(html).not.toMatch(/<!--@/);
  });

  it('shows the storm banner only for a real threat', () => {
    expect(html).not.toMatch(/class="storm-banner[^"]*show/);
    const warn = renderPage('home', 'en', { ...homeData, storm: stormWarning }, { now: NOW }).html;
    expect(warn).toMatch(/class="storm-banner show"[^>]*aria-hidden="false"/);
    expect(warn).toContain('KALMAEGI');
  });

  it('keeps the -- placeholders when caches are empty (just after a restart)', () => {
    const empty = renderPage('home', 'en', {}, { now: NOW });
    expect(empty.complete).toBe(false);
    expect(text(empty.html, 'weather-temp')).toBe('--');
    expect(text(empty.html, 'ps-total')).toBe('--');
  });
});

describe('renderPage: other pages', () => {
  it('storms: visible H1, status and local weather in the page language', () => {
    const { html, complete } = renderPage('storms', 'ko', { storm: stormWarning, weather }, { now: NOW });
    expect(complete).toBe(true);
    expect(html).toContain(`<h1 class="section-label storm-h1" data-i18n="storm_title">${translations.ko.storm_title}</h1>`);
    expect(html).not.toContain('visually-hidden" data-i18n="storm_title"');
    expect(text(html, 'storm-status-title')).toBe(translations.ko.storm_warning_title.replace('{name}', 'KALMAEGI'));
    expect(html).not.toMatch(/id="storm-meta"[^>]*hidden/);
    expect(text(html, 'sm-distance')).toBe('420 km');
    expect(html).not.toMatch(/id="storm-local"[^>]*hidden/);
  });

  it('trends: numbers and lists in the page', () => {
    const { html } = renderPage('trends', 'ja', { trends }, { now: NOW });
    expect(html).toContain(`<h1 data-i18n="nav_trends">${translations.ja.nav_trends}</h1>`);
    expect(text(html, 's-unique')).toBe('1,855');
    expect(html).toContain('FREQUENT ONE');
    expect(html).toContain('BIG ONE');
    expect(html).not.toMatch(/>--</);
  });

  it('spot: strings come from the shared dictionary', () => {
    const { html } = renderPage('spot', 'zh', {}, { now: NOW });
    expect(text(html, 't-start')).toBe(translations.zh.sp_start);
    const json = /window\.SPOT_I18N = (\{.*?\});<\/script>/.exec(html);
    const data = JSON.parse(json[1]);
    expect(data.s.compass_warn).toBe(translations.zh.sp_compass_warn);
    expect(data.types.Cargo).toBe(translations.zh.type_cargo);
    expect(html).not.toMatch(/>--</);
  });
});

describe('createPageRenderer', () => {
  function makeSources(overrides = {}) {
    return {
      stats: vi.fn(() => stats), pulse: vi.fn(() => pulse), archive: vi.fn(() => archive),
      weather: vi.fn(() => weather), storm: vi.fn(() => stormClear), trends: vi.fn(() => trends),
      ...overrides,
    };
  }

  it('caches each language for the TTL, then renders again', () => {
    let t = NOW.getTime();
    const sources = makeSources();
    const r = createPageRenderer(sources, { ttlMs: 60000, now: () => new Date(t) });
    const vi1 = r.get('home', 'vi');
    r.get('home', 'vi');
    expect(sources.stats).toHaveBeenCalledTimes(1);
    const en = r.get('home', 'en');
    expect(sources.stats).toHaveBeenCalledTimes(2);
    expect(vi1).toContain('<html lang="vi"');
    expect(en).toContain('<html lang="en"');
    t += 61000;
    r.get('home', 'vi');
    expect(sources.stats).toHaveBeenCalledTimes(3);
  });

  it('retries soon when a cache was empty', () => {
    let t = NOW.getTime();
    let w = null;
    const sources = makeSources({ weather: vi.fn(() => w) });
    const r = createPageRenderer(sources, { ttlMs: 60000, incompleteTtlMs: 5000, now: () => new Date(t) });
    expect(text(r.get('home', 'en'), 'weather-temp')).toBe('--');
    w = weather;
    t += 6000;
    expect(text(r.get('home', 'en'), 'weather-temp')).toBe('27°C');
  });

  it('still serves the page when a data source throws', () => {
    const sources = makeSources({ stats: () => { throw new Error('db locked'); } });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const html = createPageRenderer(sources, { now: () => NOW }).get('home', 'en');
    expect(html).toContain('<html lang="en"');
    expect(text(html, 'ps-total')).toBe('--');
    expect(text(html, 'weather-temp')).toBe('27°C');
    err.mockRestore();
  });
});

describe('sunsetForecast', () => {
  it('rates tonight before sunset and tomorrow after it', () => {
    expect(sunsetForecast(weather.weather, NOW)).toMatchObject({ when: 'today', time: '17:12' });
    const evening = new Date('2026-11-20T11:00:00Z'); // 18:00 in Quy Nhon
    expect(sunsetForecast(weather.weather, evening)).toMatchObject({ when: 'tomorrow', time: '17:13' });
    expect(sunsetForecast(null)).toBeNull();
  });
});

describe('dictionary', () => {
  it('has every key in all five languages', () => {
    const keys = Object.keys(translations.en);
    for (const lang of LANGS) {
      expect(keys.filter((k) => !(k in translations[lang]))).toEqual([]);
    }
  });

  it('has no em or en dashes in the page titles, descriptions and new page strings', () => {
    for (const lang of LANGS) {
      for (const [k, v] of Object.entries(translations[lang])) {
        if (/^(meta_|og_|nav_|footer_|trends_|spot_float|map_recenter|search_aria)/.test(k)) {
          expect(`${lang}.${k}: ${v}`).not.toMatch(/[–—]/);
        }
      }
    }
  });
});
