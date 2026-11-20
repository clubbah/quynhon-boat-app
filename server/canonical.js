/**
 * Canonical address redirect: http:// and www. -> https://quynhonlife.com
 *
 * Search Console was listing http:// and www. copies of the home page as
 * separate pages. This sends them to the one canonical address with a 301.
 *
 * Constraints, all learned the hard way or verified against production:
 *
 * - The phone receiver POSTs to http://quynhonlife.com/api/ais-feed/... over
 *   plain http because its TLS fails. Only GET/HEAD are ever redirected and
 *   /api/ is excluded entirely, so the feed is never touched.
 * - X-Forwarded-Proto is always "http" here (Traefik sets it for its own hop,
 *   even when the visitor used https), so it must never be used: a fallback
 *   to it would redirect https visitors to themselves forever. The visitor's
 *   real scheme is in Cloudflare's CF-Visitor header. When that header is
 *   missing or unreadable, do nothing.
 * - Cloudflare's default cache key uses the origin scheme, so http and https
 *   visitors share one cache entry, and Cloudflare caches 301s on static file
 *   types. Only page addresses are redirected (not files with an extension
 *   other than .html), and the response is marked no-store, so a redirect can
 *   never be cached and served back to https visitors.
 */

const CANONICAL_HOST = 'quynhonlife.com';

function visitorScheme(cfVisitor) {
  if (!cfVisitor) return null;
  try {
    const s = JSON.parse(cfVisitor).scheme;
    return s === 'http' || s === 'https' ? s : null;
  } catch {
    return null;
  }
}

function isPagePath(p) {
  const last = p.split('/').pop() || '';
  return !last.includes('.') || last.endsWith('.html');
}

/**
 * Returns the canonical URL to redirect to, or null to serve the request as is.
 * @param {{ method: string, path: string, originalUrl: string, headers: object }} req
 */
export function canonicalRedirectTarget(req) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return null;
  if (req.path.startsWith('/api/')) return null;
  if (!isPagePath(req.path)) return null;

  const host = String(req.headers.host || '').toLowerCase().split(':')[0];
  const isWww = host === `www.${CANONICAL_HOST}`;
  const isHttp = visitorScheme(req.headers['cf-visitor']) === 'http';

  // Only act on our own hosts, and only when a header explicitly says the
  // visitor used http or www. Local development has neither, so is untouched.
  if (host !== CANONICAL_HOST && !isWww) return null;
  if (!isWww && !isHttp) return null;

  return `https://${CANONICAL_HOST}${req.originalUrl}`;
}

export function canonicalRedirect(req, res, next) {
  const target = canonicalRedirectTarget(req);
  if (!target) return next();
  res.set('Cache-Control', 'no-store');
  res.redirect(301, target);
}
