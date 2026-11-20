/**
 * Page addresses for every language.
 *
 * English lives at the bare address (/, /storms, /trends, /spot). The other
 * four languages get a prefix: /vi/, /vi/storms, /ko/trends and so on.
 * Canonical tags, hreflang sets, the sitemap, the flag switcher and link
 * prefixing all read from this one table.
 *
 * Privacy, terms and status are English only and are not listed here.
 */
import { LANG_CODES, localizedPath } from '../public/js/i18n-data.js';

export const SITE = 'https://quynhonlife.com';
export const LANGS = LANG_CODES; // ['en', 'vi', 'ko', 'zh', 'ja']
export const DEFAULT_LANG = 'en';

// view = template file in server/views/
export const PAGES = {
  home: { path: '/', view: 'index.html' },
  storms: { path: '/storms', view: 'storm.html' },
  trends: { path: '/trends', view: 'trends.html' },
  spot: { path: '/spot', view: 'spot.html' },
};

export function pathFor(page, lang) {
  return localizedPath(lang, PAGES[page].path);
}

export function urlFor(page, lang) {
  return SITE + pathFor(page, lang);
}

// Exact address -> { page, lang }
const PAGE_BY_PATH = new Map();
for (const page of Object.keys(PAGES)) {
  for (const lang of LANGS) PAGE_BY_PATH.set(pathFor(page, lang), { page, lang });
}

// Old file names that used to be served straight from public/.
const LEGACY = {
  '/index.html': '/',
  '/storm.html': '/storms',
  '/trends.html': '/trends',
  '/spot.html': '/spot',
};

/**
 * Work out what an incoming path is.
 * Returns { page, lang } to render, { redirect } for a 301, or null when the
 * path is not a localized page (static files, API, privacy, ...).
 */
export function resolvePath(path) {
  const hit = PAGE_BY_PATH.get(path);
  if (hit) return hit;

  if (LEGACY[path]) return { redirect: LEGACY[path] };

  // /en/... is the same page as the bare address.
  if (path === '/en' || path.startsWith('/en/')) {
    const rest = path.slice(3) || '/';
    const target = rest === '/' ? '/' : rest.replace(/\/+$/, '');
    if (PAGE_BY_PATH.get(target)?.lang === 'en') return { redirect: target };
    return null;
  }

  // /vi -> /vi/
  if (PAGE_BY_PATH.get(path + '/')?.page === 'home') return { redirect: path + '/' };

  // /storms/ -> /storms, /vi/storms/ -> /vi/storms
  if (path.length > 1 && path.endsWith('/')) {
    const trimmed = path.replace(/\/+$/, '');
    const target = PAGE_BY_PATH.get(trimmed);
    if (target && target.page !== 'home') return { redirect: trimmed };
  }

  return null;
}

/**
 * Point same-site links in rendered HTML at the page language: href="/storms"
 * becomes href="/vi/storms". Only the four localized pages are rewritten;
 * /privacy, /terms, /status, files and /api/ keep their address.
 */
export function localizeLinks(html, lang) {
  if (!lang || lang === DEFAULT_LANG) return html;
  return html.replace(/href="(\/(?:storms|trends|spot)?)([?#][^"]*)?"/g, (m, p, rest = '') =>
    `href="${localizedPath(lang, p)}${rest}"`);
}
