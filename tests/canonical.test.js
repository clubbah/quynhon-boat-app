import { describe, it, expect } from 'vitest';
import { canonicalRedirectTarget } from '../server/canonical.js';

// Header shapes as observed in production on 2026-11-20: Traefik always sets
// X-Forwarded-Proto to "http"; CF-Visitor carries the visitor's real scheme.
function req({ method = 'GET', path = '/', url, host = 'quynhonlife.com', scheme = 'https', cfVisitor } = {}) {
  return {
    method,
    path,
    originalUrl: url ?? path,
    headers: {
      host,
      'x-forwarded-proto': 'http',
      ...(cfVisitor !== undefined ? { 'cf-visitor': cfVisitor } : { 'cf-visitor': JSON.stringify({ scheme }) }),
    },
  };
}

describe('canonicalRedirectTarget', () => {
  it('leaves the canonical https address alone (no loop from X-Forwarded-Proto)', () => {
    expect(canonicalRedirectTarget(req())).toBeNull();
    expect(canonicalRedirectTarget(req({ path: '/storms' }))).toBeNull();
  });

  it('sends http pages to https', () => {
    expect(canonicalRedirectTarget(req({ scheme: 'http' }))).toBe('https://quynhonlife.com/');
    expect(canonicalRedirectTarget(req({ scheme: 'http', path: '/trends', url: '/trends?x=1' })))
      .toBe('https://quynhonlife.com/trends?x=1');
  });

  it('sends www (http or https) to the bare domain', () => {
    expect(canonicalRedirectTarget(req({ host: 'www.quynhonlife.com' }))).toBe('https://quynhonlife.com/');
    expect(canonicalRedirectTarget(req({ host: 'www.quynhonlife.com', scheme: 'http', path: '/spot' })))
      .toBe('https://quynhonlife.com/spot');
  });

  it('never touches the receiver feed or any API call', () => {
    expect(canonicalRedirectTarget(req({ method: 'POST', scheme: 'http', path: '/api/ais-feed/abc' }))).toBeNull();
    expect(canonicalRedirectTarget(req({ scheme: 'http', path: '/api/status' }))).toBeNull();
    expect(canonicalRedirectTarget(req({ host: 'www.quynhonlife.com', path: '/api/vessels' }))).toBeNull();
  });

  it('does not redirect static files (Cloudflare could cache the 301)', () => {
    for (const path of ['/css/style.css', '/js/app.js', '/img/icon-192.png', '/sw.js', '/manifest.json', '/robots.txt']) {
      expect(canonicalRedirectTarget(req({ scheme: 'http', path }))).toBeNull();
    }
  });

  it('does redirect .html pages', () => {
    expect(canonicalRedirectTarget(req({ scheme: 'http', path: '/privacy.html' }))).toBe('https://quynhonlife.com/privacy.html');
  });

  it('does nothing when CF-Visitor is missing or unreadable', () => {
    expect(canonicalRedirectTarget(req({ cfVisitor: null }))).toBeNull();
    expect(canonicalRedirectTarget(req({ cfVisitor: 'garbage' }))).toBeNull();
  });

  it('ignores other hosts, including local development', () => {
    expect(canonicalRedirectTarget(req({ host: 'localhost:3001', scheme: 'http' }))).toBeNull();
    expect(canonicalRedirectTarget(req({ host: '5.78.191.155', scheme: 'http' }))).toBeNull();
  });

  it('only redirects GET and HEAD', () => {
    expect(canonicalRedirectTarget(req({ method: 'HEAD', scheme: 'http' }))).toBe('https://quynhonlife.com/');
    expect(canonicalRedirectTarget(req({ method: 'POST', scheme: 'http', path: '/' }))).toBeNull();
  });
});
