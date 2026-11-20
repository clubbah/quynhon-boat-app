// Browser side of the translations. The dictionary itself lives in
// i18n-data.js so the server can render the same strings.
//
// The page language comes from the address (/vi/, /ko/storms, ...), which the
// server writes into <html lang>. localStorage only remembers the visitor's
// last choice, so an unprefixed address can send them back to it once (see the
// inline script in server/render.js).
import {
  LANGUAGES, LANG_CODES, LOCALES, translate, typeFor, statusFor, localizedPath,
} from './i18n-data.js?v=34';

const pageLang = (document.documentElement.lang || 'en').slice(0, 2).toLowerCase();
const currentLang = LANG_CODES.includes(pageLang) ? pageLang : 'en';

export function t(key) { return translate(currentLang, key); }
export function getLang() { return currentLang; }
export function getLanguages() { return LANGUAGES; }
export function getLocale() { return LOCALES[currentLang] || 'en-US'; }

// Remember a language choice (English included, so a visitor who switches
// back to English is not redirected to their old language again).
export function rememberLang(lang) {
  if (!LANG_CODES.includes(lang)) return;
  try { localStorage.setItem('lang', lang); } catch { /* storage blocked */ }
}

// Same-site page address in the current language: localPath('/storms').
export function localPath(path) { return localizedPath(currentLang, path); }

// The flag switcher is rendered by the server as plain links. Save the choice
// before the browser follows the link.
export function bindLangSwitcher() {
  const switcher = document.getElementById('lang-switcher');
  if (!switcher) return;
  switcher.addEventListener('click', (e) => {
    const link = e.target.closest('a[data-lang]');
    if (link) rememberLang(link.dataset.lang);
  });
}

export function tType(typeLabel) { return typeFor(currentLang, typeLabel); }
export function tStatus(statusLabel, speed) { return statusFor(currentLang, statusLabel, speed); }
