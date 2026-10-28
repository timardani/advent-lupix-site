// Vezérlő-regresszió: mobilos render és a három szerkeszthető mező PATCH útja.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(new URL('../../webshop-kalendarium-demok/fonalam/package.json', import.meta.url));
const { chromium } = require('playwright-core');

const root = new URL('../', import.meta.url);
let data = JSON.parse(readFileSync(new URL('vezerlo/adat.json', root), 'utf8'));
const audit = readFileSync(new URL('vezerlo/demo-audit.json', root), 'utf8');
const releases = readFileSync(new URL('kiadas.json', root), 'utf8');
const html = readFileSync(new URL('vezerlo/index.html', root), 'utf8');
const patches = [];

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.route('http://vez.test/**', async route => {
  const url = new URL(route.request().url());
  if (url.pathname === '/vezerlo/' || url.pathname === '/vezerlo/index.html') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
  if (url.pathname === '/vezerlo/demo-audit.json') return route.fulfill({ contentType: 'application/json', body: audit });
  if (url.pathname === '/vezerlo/kiadas.json') return route.fulfill({ contentType: 'application/json', body: releases });
  if (url.pathname === '/api/vezerlo/adat' && route.request().method() === 'GET') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
  if (url.pathname === '/api/vezerlo/adat' && route.request().method() === 'PATCH') {
    const patch = route.request().postDataJSON(); patches.push(patch);
    const shop = data.boltok.find(x => x.id === patch.id);
    const { id, ...changes } = patch;
    if (typeof changes.kikuldve === 'boolean') changes.kikuldve = changes.kikuldve ? '2026-10-28' : '';
    Object.assign(shop, changes);
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
  }
  return route.fulfill({ status: 404, body: 'not found' });
});

const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto('http://vez.test/vezerlo/', { waitUntil: 'networkidle' });
const card = name => page.locator('.shop', { has: page.locator('.name', { hasText: name }) });
if (!await card('TiSza Fonal').getByText('2. demó: nincs kész').isVisible()) throw new Error('TiSza Fonal hiányjelzés nem látszik');
if (!await card('Tropical Home').getByText('2. demó: kész').isVisible()) throw new Error('Tropical Home kész jelzés nem látszik');
if (!await card('Fonalam.hu').getByText('Kalendárium frissítve').isVisible()) throw new Error('frissítési idő nem látszik');
let response = page.waitForResponse(r => r.url().endsWith('/api/vezerlo/adat') && r.request().method() === 'PATCH' && r.request().postData()?.includes('kikuldve'));
await card('Fonalam.hu').locator('[data-field="kikuldve"]').check();
await response;
response = page.waitForResponse(r => r.url().endsWith('/api/vezerlo/adat') && r.request().method() === 'PATCH' && r.request().postData()?.includes('hatarido'));
await card('Fonalam.hu').locator('[data-field="hatarido"]').fill('2026-11-04');
await response;
response = page.waitForResponse(r => r.url().endsWith('/api/vezerlo/adat') && r.request().method() === 'PATCH' && r.request().postData()?.includes('nem_reagal'));
await card('Fonalam.hu').locator('[data-field="allapot"]').selectOption('nem_reagal');
await response;
if (!patches.some(x => x.id === 'fonalam' && x.kikuldve === true)) throw new Error('kiküldés PATCH hiányzik');
if (!patches.some(x => x.hatarido === '2026-11-04')) throw new Error('határidő PATCH hiányzik');
if (!patches.some(x => x.allapot === 'nem_reagal')) throw new Error('státusz PATCH hiányzik');
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
if (overflow) throw new Error('mobilos vízszintes túlcsordulás');
if (errors.length) throw new Error('oldalhiba: ' + errors.join('; '));
await page.screenshot({ path: '/tmp/advent-vezerlo-mobile.png', fullPage: true });
await browser.close();
console.log(`✓ vezérlő: ${patches.length} mentési kérés, auditjelzések, mobil overflow és JS-hibák rendben`);
