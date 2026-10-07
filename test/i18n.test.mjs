import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../docs/js/i18n/', import.meta.url);
const load = async f => (await import(new URL(f, dir))).default;
const en = await load('en.js');
const langs = readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'en.js');
const vars = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');

test('there are several languages besides English', () => assert.ok(langs.length >= 5));

for (const f of langs) {
  test(`${f} has every key with the same placeholders`, async () => {
    const d = await load(f);
    const missing = Object.keys(en).filter(k => !(k in d));
    const extra = Object.keys(d).filter(k => !(k in en));
    assert.deepEqual(missing, [], `missing keys in ${f}`);
    assert.deepEqual(extra, [], `unknown keys in ${f}`);
    for (const k of Object.keys(en)) assert.equal(vars(d[k]), vars(en[k]), `placeholders differ for ${k} in ${f}`);
  });
}

test('every key used in the code exists in English', () => {
  const files = ['app.js', 'ui.js', ...readdirSync(new URL('../docs/js/views/', import.meta.url)).map(f => `views/${f}`)];
  const used = new Set();
  for (const f of files) {
    const src = readFileSync(new URL(`../docs/js/${f}`, import.meta.url), 'utf8');
    for (const m of src.matchAll(/\bt\(\s*['`]([A-Za-z0-9_.]+)['`]/g)) used.add(m[1]);
  }
  const html = readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');
  for (const m of html.matchAll(/data-i18n[a-z-]*="([^"]+)"/g)) used.add(m[1]);
  assert.deepEqual([...used].filter(k => !(k in en)), []);
});
