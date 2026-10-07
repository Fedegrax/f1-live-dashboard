// Minimal i18n: flat dictionaries per language in js/i18n/<code>.js, English as the fallback.
export const LANGS = [['en', 'English'], ['it', 'Italiano'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['pt', 'Português']];
const LS = 'f1d.lang';
let dict = {};
let base = {};
export let lang = 'en';

function pick() {
  try { const s = localStorage.getItem(LS); if (s && LANGS.some(l => l[0] === s)) return s; } catch { /* ignore */ }
  const prefs = (typeof navigator !== 'undefined' && navigator.languages) || ['en'];
  for (const p of prefs) { const c = String(p).slice(0, 2).toLowerCase(); if (LANGS.some(l => l[0] === c)) return c; }
  return 'en';
}

export async function initI18n() {
  lang = pick();
  base = (await import('./i18n/en.js')).default;
  dict = lang === 'en' ? base : (await import(`./i18n/${lang}.js`)).default;
  document.documentElement.lang = lang;
  applyStatic();
}

export function t(key, vars) {
  let s = dict[key] ?? base[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  return s;
}

export function setLang(code) {
  try { localStorage.setItem(LS, code); } catch { /* ignore */ }
  location.reload();
}

export function applyStatic(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  document.title = t('meta.title');
  const d = document.querySelector('meta[name="description"]');
  if (d) d.content = t('meta.description');
}
