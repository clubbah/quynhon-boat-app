import { describe, it, expect } from 'vitest';
import { resolvePath, pathFor, urlFor, localizeLinks, PAGES, LANGS } from '../server/routes.js';
import { buildSitemap } from '../server/sitemap.js';

describe('pathFor / urlFor', () => {
  it('keeps English unprefixed and prefixes the other languages', () => {
    expect(pathFor('home', 'en')).toBe('/');
    expect(pathFor('home', 'vi')).toBe('/vi/');
    expect(pathFor('storms', 'en')).toBe('/storms');
    expect(pathFor('storms', 'ja')).toBe('/ja/storms');
    expect(urlFor('trends', 'ko')).toBe('https://quynhonlife.com/ko/trends');
  });
});

describe('resolvePath', () => {
  it('maps every page in every language', () => {
    for (const page of Object.keys(PAGES)) {
      for (const lang of LANGS) {
        expect(resolvePath(pathFor(page, lang))).toEqual({ page, lang });
      }
    }
  });

  it('redirects the alternate spellings of a page address', () => {
    expect(resolvePath('/vi')).toEqual({ redirect: '/vi/' });
    expect(resolvePath('/storms/')).toEqual({ redirect: '/storms' });
    expect(resolvePath('/zh/trends/')).toEqual({ redirect: '/zh/trends' });
    expect(resolvePath('/en')).toEqual({ redirect: '/' });
    expect(resolvePath('/en/')).toEqual({ redirect: '/' });
    expect(resolvePath('/en/storms')).toEqual({ redirect: '/storms' });
  });

  it('redirects the old template file names instead of serving them', () => {
    expect(resolvePath('/index.html')).toEqual({ redirect: '/' });
    expect(resolvePath('/storm.html')).toEqual({ redirect: '/storms' });
    expect(resolvePath('/trends.html')).toEqual({ redirect: '/trends' });
    expect(resolvePath('/spot.html')).toEqual({ redirect: '/spot' });
  });

  it('leaves everything else alone', () => {
    for (const p of ['/privacy', '/terms', '/status', '/vi/privacy', '/api/status', '/api/ais-feed/x',
      '/js/app.js', '/sitemap.xml', '/fr/', '/VI/', '/en/privacy']) {
      expect(resolvePath(p)).toBeNull();
    }
  });
});

describe('localizeLinks', () => {
  const html = '<a href="/">Home</a><a href="/storms">S</a><a href="/storms?storm=watch">D</a>'
    + '<a href="/trends">T</a><a href="/spot">W</a><a href="/privacy">P</a><a href="/status">X</a>'
    + '<a href="/api/status">A</a><link href="/css/style.css?v=32"><a href="https://quynhonlife.com/storms">abs</a>';

  it('prefixes only the localized pages', () => {
    const out = localizeLinks(html, 'vi');
    expect(out).toContain('href="/vi/"');
    expect(out).toContain('href="/vi/storms"');
    expect(out).toContain('href="/vi/storms?storm=watch"');
    expect(out).toContain('href="/vi/trends"');
    expect(out).toContain('href="/vi/spot"');
    expect(out).toContain('href="/privacy"');
    expect(out).toContain('href="/status"');
    expect(out).toContain('href="/api/status"');
    expect(out).toContain('href="/css/style.css?v=32"');
    expect(out).toContain('href="https://quynhonlife.com/storms"');
  });

  it('does nothing for English', () => {
    expect(localizeLinks(html, 'en')).toBe(html);
  });
});

describe('sitemap', () => {
  const xml = buildSitemap({ home: '2026-11-20', storms: '2026-11-20', trends: '2026-11-20', spot: '2026-11-01', '/privacy': '2026-03-30' });

  it('lists every language address of every page plus privacy and terms', () => {
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toHaveLength(Object.keys(PAGES).length * LANGS.length + 2);
    for (const page of Object.keys(PAGES)) for (const lang of LANGS) expect(locs).toContain(urlFor(page, lang));
    expect(locs).toContain('https://quynhonlife.com/privacy');
    expect(locs).toContain('https://quynhonlife.com/terms');
    expect(xml).not.toContain('/status');
  });

  it('gives each language address the full alternate set with x-default', () => {
    const block = xml.split('<url>').find((b) => b.includes('<loc>https://quynhonlife.com/ko/storms</loc>'));
    for (const lang of LANGS) expect(block).toContain(`hreflang="${lang}" href="${urlFor('storms', lang)}"`);
    expect(block).toContain('hreflang="x-default" href="https://quynhonlife.com/storms"');
    expect(block).toContain('<lastmod>2026-11-20</lastmod>');
  });
});
