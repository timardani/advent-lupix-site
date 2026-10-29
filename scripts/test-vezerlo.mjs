// Vezérlő-regresszió: teljes adatlista, kompakt mobilnézet, dátumszerkesztés és csak olvasható Kanban.
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
const deadline = sent => {
  if (!sent) return '';
  const d = new Date(`${sent}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 3);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

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
    if ('kikuldve' in changes) {
      shop.kikuldve = changes.kikuldve;
      shop.hatarido = deadline(changes.kikuldve);
      if (changes.kikuldve && ['elokeszites','review','kuldheto','tartalek'].includes(shop.allapot)) shop.allapot = 'kikuldve';
      delete changes.kikuldve;
    }
    Object.assign(shop, changes);
    data.frissitve = '2026-10-29';
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
  }
  return route.fulfill({ status: 404, body: 'not found' });
});

const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto('http://vez.test/vezerlo/', { waitUntil: 'networkidle' });
if (!await page.getByText('17 kategória').isVisible()) throw new Error('kategóriaszám hiányzik');
if (!await page.getByText('18 ügyfél/jelölt').isVisible()) throw new Error('ügyfélszám hiányzik');
if (await page.locator('.cat').count() !== 17) throw new Error('nem látszik mind a 17 kategória');
for (const name of ['BioKiskert','Demeter Chocolate','Csakajósör','Chilimánia']) {
  if (!await page.locator('.shop', { hasText: name }).isVisible()) throw new Error(`új ügyfél hiányzik: ${name}`);
}
if (!await page.locator('.shop', { hasText: 'Chilimánia' }).getByText('nincs e-mail').isVisible()) throw new Error('hiányos kontakt jelzése nem látszik');
await page.locator('#kereses').fill('gyongyver.szekely@biokiskert.hu');
if (await page.locator('.shop').count() !== 1 || !await page.locator('.shop', { hasText: 'BioKiskert' }).isVisible()) throw new Error('e-mail keresés hibás');
await page.locator('#kereses').fill('');
const card = page.locator('.shop', { has: page.locator('.name', { hasText: 'Fonalam.hu' }) });
await card.locator('summary').click();
let response = page.waitForResponse(r => r.url().endsWith('/api/vezerlo/adat') && r.request().method() === 'PATCH' && r.request().postData()?.includes('2026-10-29'));
await card.locator('[data-field="kikuldve"]').fill('2026-10-29');
await response;
if (!patches.some(x => x.id === 'fonalam' && x.kikuldve === '2026-10-29')) throw new Error('kiküldési dátum PATCH hiányzik');
const updated = page.locator('.shop', { has: page.locator('.name', { hasText: 'Fonalam.hu' }) });
if (!await updated.getByText('4 nap van hátra').isVisible()) throw new Error('az újraszámolt határidő nem látszik');
let overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
if (overflow) throw new Error('mobilos vízszintes túlcsordulás');
await page.screenshot({ path: new URL('../screenshots/vezerlo-mobile.png', import.meta.url).pathname, fullPage: true });

await page.setViewportSize({ width: 1440, height: 900 });
await page.getByRole('button', { name: 'Kanban' }).click();
if (await page.locator('.kanban-col').count() !== 5) throw new Error('nem öt Kanban-oszlop jelent meg');
for (const name of ['Kész demo','Elküldve','Második keresés','Érdekli','OFF']) if (!await page.locator('.kanban-head', { hasText: name }).isVisible()) throw new Error(`Kanban-oszlop hiányzik: ${name}`);
if (await page.locator('.kanban-card [data-field]').count()) throw new Error('a Kanbanban szerkeszthető mező maradt');
if (await page.locator('.kanban-card[draggable="true"]').count()) throw new Error('a Kanban továbbra is húzható');
const kanbanTexts = await page.locator('.kanban-card').allTextContents();
if (kanbanTexts.some(x => x.includes('Határidő') || x.includes('Teendő') || x.includes('demó'))) throw new Error('a Kanban-kártyán a néven kívül más adat látszik');
await page.locator('#kategoria-szuro').selectOption({ label: 'Fonal / kötés-horgolás' });
if (await page.locator('.kanban-card').count() !== 2) throw new Error('Kanban kategóriaszűrő hibás');
if (errors.length) throw new Error('oldalhiba: ' + errors.join('; '));
await page.screenshot({ path: new URL('../screenshots/vezerlo-kanban.png', import.meta.url).pathname, fullPage: true });
await browser.close();
console.log(`✓ vezérlő: 17 kategória, 18 ügyfél, dátumszerkesztés, mobil és csak olvasható Kanban rendben (${patches.length} mentés)`);
