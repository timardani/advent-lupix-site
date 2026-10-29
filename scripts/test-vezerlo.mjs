// Vezérlő-regresszió: mobilos render és a három szerkeszthető mező PATCH útja.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(new URL('../../webshop-kalendarium-demok/fonalam/package.json', import.meta.url));
const { chromium } = require('playwright-core');

const root = new URL('../', import.meta.url);
const seedData = JSON.parse(readFileSync(new URL('vezerlo/adat.json', root), 'utf8'));
let data = structuredClone(seedData);
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
    const oldStatus = shop.allapot;
    const { id, ...changes } = patch;
    if (typeof changes.kikuldve === 'boolean') changes.kikuldve = changes.kikuldve ? '2026-10-28' : '';
    Object.assign(shop, changes);
    if (shop.allapot !== oldStatus) {
      shop.allapot_datum = '2026-10-29';
      (shop.elozmenyek ||= []).push({ datum: '2026-10-29T12:00:00+01:00', innen: oldStatus, ide: shop.allapot });
    }
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
let overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
if (overflow) throw new Error('mobilos vízszintes túlcsordulás');
await page.setViewportSize({ width: 1440, height: 900 });
await page.getByRole('button', { name: 'Kanban' }).click();
if (await page.locator('.kanban-col').count() !== 5) throw new Error('nem öt Kanban-oszlop jelent meg');
for (const name of ['Kész demo','Elküldve','Második keresés','Érdekli','OFF']) if (!await page.locator('.kanban-head', { hasText: name }).isVisible()) throw new Error(`Kanban-oszlop hiányzik: ${name}`);
const kanbanCard = page.locator('.kanban-card', { has: page.locator('.name', { hasText: 'Fonalam.hu' }) });
response = page.waitForResponse(r => r.url().endsWith('/api/vezerlo/adat') && r.request().method() === 'PATCH' && r.request().postData()?.includes('Második telefon'));
await kanbanCard.locator('[data-field="teendo"]').fill('Második telefon pénteken');
await kanbanCard.locator('[data-field="teendo"]').press('Tab');
await response;
if (!patches.some(x => x.id === 'fonalam' && x.teendo === 'Második telefon pénteken')) throw new Error('következő teendő PATCH hiányzik');
response = page.waitForResponse(r => r.url().endsWith('/api/vezerlo/adat') && r.request().method() === 'PATCH' && r.request().postData()?.includes('2026-11-06'));
await page.locator('.kanban-card', { has: page.locator('.name', { hasText: 'Fonalam.hu' }) }).locator('[data-field="hatarido"]').fill('2026-11-06');
await response;
response = page.waitForResponse(r => r.url().endsWith('/api/vezerlo/adat') && r.request().method() === 'PATCH' && r.request().postData()?.includes('2020-01-01'));
await page.locator('.kanban-card', { has: page.locator('.name', { hasText: 'Fonalam.hu' }) }).locator('[data-field="hatarido"]').fill('2020-01-01');
await response;
if (!await page.locator('.kanban-card.overdue', { hasText: 'Fonalam.hu' }).isVisible()) throw new Error('lejárt kártya piros kiemelése hiányzik');
response = page.waitForResponse(r => r.url().endsWith('/api/vezerlo/adat') && r.request().method() === 'PATCH' && r.request().postData()?.includes('valaszolt'));
await page.locator('.kanban-card', { has: page.locator('.name', { hasText: 'Fonalam.hu' }) }).dragTo(page.locator('[data-drop-status="valaszolt"]'));
await response;
if (!patches.some(x => x.id === 'fonalam' && x.allapot === 'valaszolt')) throw new Error('Kanban húzás PATCH hiányzik');
const movedCard = page.locator('.kanban-card', { has: page.locator('.name', { hasText: 'Fonalam.hu' }) });
if (!await movedCard.getByText('Oszlopban: 0 napja').isVisible()) throw new Error('oszlopban töltött napok hiányoznak');
if (!await movedCard.getByText('Előzmények (').isVisible()) throw new Error('státuszelőzmény hiányzik');
await page.locator('#kategoria-szuro').selectOption({ label: 'Fonal / kötés-horgolás' });
if (await page.locator('.kanban-card').count() !== 2) throw new Error('kategóriaszűrő hibás elemszámot ad');
if (await page.locator('.kanban-card .category').evaluateAll(xs => xs.some(x => x.textContent !== 'Fonal / kötés-horgolás'))) throw new Error('kategóriaszűrő idegen kategóriát mutat');
data = structuredClone(seedData);
await page.reload({ waitUntil: 'networkidle' });
if (!await page.locator('#recovery').isVisible()) throw new Error('helyi biztonsági mentés eltérésjelzése hiányzik');
response = page.waitForResponse(r => r.url().endsWith('/api/vezerlo/adat') && r.request().method() === 'PATCH' && r.request().postData()?.includes('Második telefon pénteken'));
await page.getByRole('button', { name: 'Helyi mentés visszaállítása' }).click();
await response;
if (!patches.some(x => x.id === 'fonalam' && x.kikuldve === '2026-10-28' && x.allapot === 'valaszolt')) throw new Error('helyi mentés pontos kiküldési dátuma nem állt vissza');
if (await page.locator('#recovery').isVisible()) throw new Error('visszaállítás után megmaradt a figyelmeztetés');
if (errors.length) throw new Error('oldalhiba: ' + errors.join('; '));
await page.screenshot({ path: new URL('../screenshots/vezerlo-kanban.png', import.meta.url).pathname, fullPage: true });
await browser.close();
console.log(`✓ vezérlő: ${patches.length} mentési kérés, auditjelzések, mobil overflow és JS-hibák rendben`);
