/**
 * /sitemap.xml, generated from the route table so it always lists every
 * language address of every page, each with the full set of alternates.
 * Privacy and terms are English only. /status is deliberately left out (it is
 * noindex).
 */
import { PAGES, LANGS, SITE, urlFor } from './routes.js';

const xmlEsc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

const PAGE_META = {
  home: { changefreq: 'hourly', priority: '1.0' },
  storms: { changefreq: 'hourly', priority: '0.9' },
  trends: { changefreq: 'daily', priority: '0.7' },
  spot: { changefreq: 'monthly', priority: '0.6' },
};

export const ENGLISH_ONLY = [
  { path: '/privacy', changefreq: 'yearly', priority: '0.2' },
  { path: '/terms', changefreq: 'yearly', priority: '0.2' },
];

/**
 * lastmod: { home: 'YYYY-MM-DD', storms, trends, spot, '/privacy', '/terms' }
 */
export function buildSitemap(lastmod = {}) {
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    '        xmlns:xhtml="http://www.w3.org/1999/xhtml">',
  ];
  for (const page of Object.keys(PAGES)) {
    const alternates = LANGS.map((l) =>
      `    <xhtml:link rel="alternate" hreflang="${l}" href="${xmlEsc(urlFor(page, l))}" />`);
    alternates.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${xmlEsc(urlFor(page, 'en'))}" />`);
    for (const lang of LANGS) {
      out.push('  <url>', `    <loc>${xmlEsc(urlFor(page, lang))}</loc>`);
      if (lastmod[page]) out.push(`    <lastmod>${lastmod[page]}</lastmod>`);
      out.push(`    <changefreq>${PAGE_META[page].changefreq}</changefreq>`,
        `    <priority>${PAGE_META[page].priority}</priority>`, ...alternates, '  </url>');
    }
  }
  for (const p of ENGLISH_ONLY) {
    out.push('  <url>', `    <loc>${SITE}${p.path}</loc>`);
    if (lastmod[p.path]) out.push(`    <lastmod>${lastmod[p.path]}</lastmod>`);
    out.push(`    <changefreq>${p.changefreq}</changefreq>`, `    <priority>${p.priority}</priority>`, '  </url>');
  }
  out.push('</urlset>', '');
  return out.join('\n');
}
