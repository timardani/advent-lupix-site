// Füstteszt: minden kiadott demó betölt-e alkönyvtárból, 404 és JS-hiba nélkül.
// Használat: node scripts/smoke.mjs <alap-URL>   (pl. http://localhost:5390 vagy https://advent.lupix.hu)
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(new URL('../../webshop-kalendarium-demok/fonalam/package.json', import.meta.url));
const { chromium } = require('playwright-core');

const base = (process.argv[2] || 'http://localhost:5390').replace(/\/$/, '');
const conf = JSON.parse(readFileSync(new URL('../kiadas.json', import.meta.url), 'utf8'));
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
let bad = 0;
for (const { demo, slug } of conf.demok) {
  for (const q of ['?bemutato=1&nap=7', '?bemutato=1&nap=24', '']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errs = [];
    page.on('pageerror', e => errs.push('JS: ' + e.message));
    page.on('response', r => { if (r.status() >= 400 && r.url().startsWith(base)) errs.push(`${r.status()} ${r.url().slice(base.length)}`); });
    page.on('requestfailed', r => { if (r.url().startsWith(base)) errs.push('FAIL ' + r.url().slice(base.length)); });
    await page.goto(`${base}/${slug}/${q}`, { waitUntil: 'networkidle' });
    await page.mouse.wheel(0, 3000); await page.waitForTimeout(400);
    const imgs = await page.evaluate(() => [...document.images].filter(i => i.complete && i.currentSrc && !i.naturalWidth).map(i => i.currentSrc));
    imgs.forEach(s => errs.push('IMG ' + s));
    const ok = errs.length === 0;
    if (!ok) bad++;
    console.log(`${ok ? '✓' : '✗'} ${demo.padEnd(16)} ${q || '(vásárlói)'}${ok ? '' : '\n   ' + [...new Set(errs)].slice(0, 6).join('\n   ')}`);
    await page.close();
  }
}
await browser.close();
console.log(bad ? `HIBA: ${bad} oldal` : 'MIND RENDBEN');
process.exit(bad ? 1 : 0);
