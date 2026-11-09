// Webkalendárium (coach) szerver: statikus frontend + API. Csak Node beépített modulok.
// Napzár: a nyilvános API csak a mai (Europe/Budapest, napi nyitási órával) nap teljes tartalmát adja ki.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { budapestToUtc, masodpercEjfelig } from './ido.js';
import { createStore } from './tarolo.js';
import { aktualis, ervenyesNap, ervenyesProfil, atrendez, kuponHatarido, nyilvanos, kepNapjai, KEP_RE } from './tartalom.js';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};
const SEC = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
};
const EMAIL_RE = /^[^\s@"<>,;]+@[^\s@"<>,;]+\.[^\s@"<>,;]{2,}$/;
const COOKIE = 'wk_admin';
const SESSION_MS = 30 * 24 * 3600 * 1000;
const KEP_MAX = 5 * 1024 * 1024;
const ESEMENYEK = ['megnyitas', 'kupon', 'link'];

export function limiter(max, windowMs) {
  const m = new Map();
  return (key, t = Date.now()) => {
    const a = (m.get(key) || []).filter(x => t - x < windowMs);
    if (a.length >= max) { m.set(key, a); return false; }
    a.push(t);
    m.set(key, a);
    if (m.size > 20000) m.clear();
    return true;
  };
}

/** Képformátum a fájl első bájtjai alapján (a Content-Type nem elég). */
export function kepTipus(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

export function createApp({ dataDir, configDir, distDir, env = process.env, now = () => new Date(), fetchImpl = fetch, log = console }) {
  const store = createStore(dataDir, configDir);
  // Útvonal-előtag, ha az app egy almappában fut (pl. /agukrisz-e9faeb egy közös domain alatt).
  const BASE = String(env.BASE_PATH || '').replace(/\/+$/, '');
  if (BASE && !/^(\/[a-z0-9-]+)+$/.test(BASE)) throw new Error('Hibás BASE_PATH');
  // Bemutató mód (csak demóhoz): kampányon kívül is látszik egy nap, és ?nap=N-nel bármelyik nap megnézhető.
  const bemutato = env.BEMUTATO === '1';
  const bemutatoNap = Math.min(24, Math.max(1, Number(env.BEMUTATO_NAP) || 7));
  // Munkamenet-kulcs: env, különben /data-ban tartósan tárolt, hogy redeploy után se kelljen újra belépni.
  let secret = env.SESSION_SECRET;
  if (!secret) {
    const sf = path.join(dataDir, '.session-secret');
    try { secret = fs.readFileSync(sf, 'utf8').trim(); } catch { /* még nincs */ }
    if (!secret || secret.length < 32) { secret = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(sf, secret, { mode: 0o600 }); }
  }
  const secureCookie = env.COOKIE_SECURE !== '0';
  const webhook = /^https:\/\//.test(env.GHL_WEBHOOK_URL || '') ? env.GHL_WEBHOOK_URL : null;
  const lim = {
    login: limiter(8, 15 * 60e3),
    subIp: limiter(5, 10 * 60e3),
    subEmail: limiter(3, 24 * 3600e3),
    subAll: limiter(300, 10 * 60e3),
    esemeny: limiter(60, 10 * 60e3),
    kep: limiter(120, 60 * 60e3),
  };

  const doc = () => store.read('tartalom.json');
  const most = () => {
    const d = doc();
    const a = aktualis(d.profil.ev, d.profil.nyitasOra, now());
    if (bemutato && (a.nap === 0 || a.nap > 24)) return { d, nap: bemutatoNap, hatraMs: masodpercEjfelig(now()) * 1000 };
    return { d, ...a };
  };
  const kepPath = f => {
    if (!KEP_RE.test(f || '')) return null;
    for (const dir of [path.join(dataDir, 'kepek'), path.join(configDir, 'kepek')]) {
      const fp = path.join(dir, f);
      if (fs.existsSync(fp)) return fp;
    }
    return null;
  };
  const kepUrl = f => `${BASE}/api/kep/${encodeURIComponent(f)}`;

  /* ---------- segédek ---------- */
  function send(res, status, obj, extra = {}) {
    const body = Buffer.from(JSON.stringify(obj));
    res.writeHead(status, { ...SEC, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Content-Length': body.length, ...extra });
    res.end(body);
  }
  function readRaw(req, limit) {
    return new Promise((resolve, reject) => {
      let n = 0; const chunks = [];
      req.on('data', c => {
        n += c.length;
        if (n > limit) { reject(Object.assign(new Error('too large'), { code: 413 })); req.removeAllListeners('data'); req.resume(); return; }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }
  async function readBody(req, limit) {
    const buf = await readRaw(req, limit);
    try { return buf.length ? JSON.parse(buf.toString('utf8')) : {}; } catch { throw Object.assign(new Error('bad json'), { code: 400 }); }
  }
  const ipOf = req => (env.TRUST_PROXY !== '0' && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?';
  const sign = v => crypto.createHmac('sha256', secret).update(v).digest('hex');
  function isAdmin(req) {
    const m = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
    if (!m) return false;
    const [exp, sig] = decodeURIComponent(m[1]).split('.');
    if (!exp || !sig || Number(exp) < Date.now()) return false;
    const a = Buffer.from(sign(exp)); const b = Buffer.from(sig);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  const cookie = (val, maxAge) => `${COOKIE}=${val}; Path=${BASE || '/'}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureCookie ? '; Secure' : ''}`;
  const hashEq = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());
  // Jelszó: ADMIN_PASSWORD (env) vagy ADMIN_PASSWORD_SCRYPT = "<só hex>:<scrypt hex>" (így a jelszó maga sehol sincs tárolva).
  const scryptCfg = /^([0-9a-f]{16,}):([0-9a-f]{64})$/.exec(env.ADMIN_PASSWORD_SCRYPT || '');
  const vanJelszo = !!(env.ADMIN_PASSWORD || scryptCfg);
  const jelszoOk = pw => {
    if (env.ADMIN_PASSWORD) return hashEq(pw, env.ADMIN_PASSWORD);
    const h = crypto.scryptSync(String(pw), Buffer.from(scryptCfg[1], 'hex'), 32);
    return crypto.timingSafeEqual(h, Buffer.from(scryptCfg[2], 'hex'));
  };

  /* ---------- nyilvános nézet ---------- */
  function profilPublikus(d) {
    const p = d.profil; const f = d.feliratkozas;
    return {
      profil: { ...p, avatar: kepUrl(p.avatar), gyorsLinkek: undefined },
      feliratkozas: f.aktiv ? { aktiv: true, cim: f.cim, szoveg: f.szoveg, gomb: f.gomb, koszono: f.koszono, reszvetelSzoveg: f.reszvetelSzoveg, reszvetelUrl: f.reszvetelUrl, hirlevelSzoveg: f.hirlevelSzoveg, adatkezelesUrl: f.adatkezelesUrl } : { aktiv: false },
    };
  }
  function naptar(d, nap, hatraMs, elonezet = false) {
    return { ev: d.profil.ev, ma: nap, hatraMs, elonezet, bemutato, ...profilPublikus(d), napok: nyilvanos(d, nap, kepUrl) };
  }

  /* ---------- feliratkozás (GoHighLevel bejövő webhook, opcionális) ---------- */
  async function webhookKuld(email) {
    const r = await fetchImpl(webhook, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, forras: 'adventi-kalendarium', hirlevel: true, tags: ['adventi-kalendarium'] }),
      signal: AbortSignal.timeout(8000),
    });
    return { ok: r.ok, status: r.status, ujraprobalhato: r.status >= 500 || r.status === 429 };
  }
  async function sorUjraprobal() {
    if (!webhook) return;
    const q = store.read('webhook-sor.json', []);
    if (!q.length) return;
    const left = [];
    for (const item of q) {
      if (item.kov > Date.now()) { left.push(item); continue; }
      let r;
      try { r = await webhookKuld(item.email); } catch { r = { ok: false, ujraprobalhato: true, status: 'halozat' }; }
      if (!r.ok && r.ujraprobalhato && item.proba < 6) left.push({ ...item, proba: item.proba + 1, kov: Date.now() + 2 ** item.proba * 60e3 });
      store.append('webhook-naplo.jsonl', { ido: now().toISOString(), email: item.email, ok: r.ok, status: r.status, ujraproba: true });
    }
    store.write('webhook-sor.json', left);
  }
  async function feliratkozas(req, res) {
    const d = doc(); const f = d.feliratkozas;
    if (!f.aktiv) return send(res, 403, { hiba: 'A feliratkozás most nem elérhető.' });
    const ip = ipOf(req);
    if (!lim.subAll('all') || !lim.subIp(ip)) return send(res, 429, { hiba: 'Túl sok próbálkozás, kérlek, próbáld újra később.' });
    const b = await readBody(req, 4096);
    if (b.web) return send(res, 200, { ok: true }); // csapda-mező: robot
    const email = String(b.email || '').trim().toLowerCase();
    if (email.length > 254 || !EMAIL_RE.test(email)) return send(res, 400, { hiba: 'Adj meg egy érvényes e-mail-címet.', mezo: 'email' });
    if (b.reszvetel !== true) return send(res, 400, { hiba: 'A feliratkozáshoz el kell fogadnod a feltételeket.', mezo: 'reszvetel' });
    if (typeof b.hirlevel !== 'boolean') return send(res, 400, { hiba: 'Hiányzó hírlevél-mező.' });
    if (!lim.subEmail(email)) return send(res, 429, { hiba: 'Erre a címre ma már többször feliratkoztál.' });
    const rec = {
      ido: now().toISOString(), email, nap: most().nap,
      reszvetel: { elfogadva: true, szoveg: f.reszvetelSzoveg, url: f.reszvetelUrl, verzio: f.verzio },
      hirlevel: { elfogadva: b.hirlevel, szoveg: b.hirlevel ? f.hirlevelSzoveg : null },
      ghl: null,
    };
    // A CRM-be (GHL) csak hírlevél-hozzájárulással kerül a cím.
    if (b.hirlevel && webhook) {
      try {
        const r = await webhookKuld(email);
        rec.ghl = { ok: r.ok, status: r.status };
        if (!r.ok && r.ujraprobalhato) store.write('webhook-sor.json', [...store.read('webhook-sor.json', []), { email, proba: 1, kov: Date.now() + 60e3 }]);
      } catch {
        rec.ghl = { ok: false, status: 'halozat' };
        store.write('webhook-sor.json', [...store.read('webhook-sor.json', []), { email, proba: 1, kov: Date.now() + 60e3 }]);
      }
    } else if (b.hirlevel) rec.ghl = { ok: false, status: 'nincs-beallitva' };
    store.append('hozzajarulasok.jsonl', rec);
    return send(res, 200, { ok: true });
  }
  const csvCell = v => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  function csv() {
    const rows = [['ido', 'email', 'nap', 'feltetelek', 'feltetel_verzio', 'hirlevel', 'hirlevel_szoveg', 'ghl_ok', 'ghl_status']];
    for (const r of store.lines('hozzajarulasok.jsonl')) {
      rows.push([r.ido, r.email, r.nap, r.reszvetel?.elfogadva, r.reszvetel?.verzio, r.hirlevel?.elfogadva, r.hirlevel?.szoveg, r.ghl?.ok ?? '', r.ghl?.status ?? '']);
    }
    return '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
  }

  /* ---------- statisztika (névtelen számlálók, személyes adat nélkül) ---------- */
  function esemeny(nap, tipus) {
    const s = store.read('stat.json', {});
    s[nap] = s[nap] || {};
    s[nap][tipus] = (s[nap][tipus] || 0) + 1;
    store.write('stat.json', s);
  }

  /* ---------- írás: verzióőr + mentés + napló ---------- */
  function ment(req, res, b, ok, valtoztat) {
    const d = doc();
    if (b.verzio !== undefined && b.verzio !== d.verzio) return send(res, 409, { hiba: 'Közben máshol is módosították a naptárat. Frissítsd az oldalt (a módosításaidat másold ki előtte).', verzio: d.verzio });
    const uj = valtoztat(structuredClone(d));
    if (uj.hiba) return send(res, 400, { hiba: uj.hiba });
    const mentesId = store.mentes(d, ok);
    uj.doc.verzio = d.verzio + 1;
    store.write('tartalom.json', uj.doc);
    store.append('valtozasok.jsonl', { ido: now().toISOString(), ok, verzio: uj.doc.verzio });
    return send(res, 200, { ok: true, verzio: uj.doc.verzio, mentesId, ...(uj.valasz || {}) });
  }

  /* ---------- API ---------- */
  async function api(req, res, url) {
    const p = url.pathname;
    const m = req.method;
    let r;
    if (p === '/api/egeszseg') return send(res, 200, { ok: true });
    if (p === '/api/naptar' && m === 'GET') {
      const { d, nap, hatraMs } = most();
      const kert = Number(url.searchParams.get('nap'));
      if (bemutato && Number.isInteger(kert) && kert >= 1 && kert <= 24) return send(res, 200, naptar(d, kert, masodpercEjfelig(now()) * 1000));
      return send(res, 200, naptar(d, nap, hatraMs));
    }
    if ((r = p.match(/^\/api\/kep\/([\w.%-]+)$/)) && m === 'GET') {
      let f; try { f = decodeURIComponent(r[1]); } catch { return send(res, 404, { hiba: 'nincs' }); }
      const fp = kepPath(f);
      if (!fp) return send(res, 404, { hiba: 'nincs' });
      const { d, nap } = most();
      const napjai = kepNapjai(d, f);
      const publikus = f === d.profil.avatar || bemutato || napjai.some(n => n <= nap);
      if (!publikus && !isAdmin(req)) return send(res, 404, { hiba: 'nincs' });
      const buf = fs.readFileSync(fp);
      res.writeHead(200, { ...SEC, 'Content-Type': MIME[path.extname(f)], 'Content-Length': buf.length, 'Cache-Control': publikus ? 'public, max-age=3600' : 'private, no-store' });
      return res.end(buf);
    }
    if (p === '/api/esemeny' && m === 'POST') {
      const b = await readBody(req, 512);
      const { nap } = most();
      if (!ESEMENYEK.includes(b.tipus) || b.nap !== nap || nap < 1 || nap > 24) return send(res, 200, { ok: false });
      if (lim.esemeny(ipOf(req))) esemeny(nap, b.tipus);
      return send(res, 200, { ok: true });
    }
    if (p === '/api/feliratkozas' && m === 'POST') return feliratkozas(req, res);

    if (!p.startsWith('/api/admin/')) return send(res, 404, { hiba: 'nincs' });
    // CSRF: SameSite=Strict süti + kötelező egyedi fejléc minden admin-hívásnál
    if (req.headers['x-admin'] !== '1') return send(res, 403, { hiba: 'Hiányzó fejléc.' });
    if (p === '/api/admin/belepes' && m === 'POST') {
      if (!vanJelszo) return send(res, 503, { hiba: 'Az admin jelszó nincs beállítva (ADMIN_PASSWORD).' });
      if (!lim.login(ipOf(req))) return send(res, 429, { hiba: 'Túl sok próbálkozás. Várj 15 percet.' });
      const b = await readBody(req, 2048);
      if (!jelszoOk(b.jelszo || '')) {
        await new Promise(ok => setTimeout(ok, 400));
        return send(res, 401, { hiba: 'Hibás jelszó.' });
      }
      const exp = String(Date.now() + SESSION_MS);
      return send(res, 200, { ok: true }, { 'Set-Cookie': cookie(`${exp}.${sign(exp)}`, SESSION_MS / 1000) });
    }
    if (p === '/api/admin/kilepes' && m === 'POST') return send(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
    if (p === '/api/admin/munkamenet' && m === 'GET') return send(res, 200, { belepve: isAdmin(req) });
    if (!isAdmin(req)) return send(res, 401, { hiba: 'Jelentkezz be.' });

    if (p === '/api/admin/allapot' && m === 'GET') {
      const { d, nap } = most();
      const fel = store.lines('hozzajarulasok.jsonl');
      return send(res, 200, {
        tartalom: d, ma: nap, stat: store.read('stat.json', {}), ghl: !!webhook,
        feliratkozok: fel.length, hirlevel: fel.filter(x => x.hirlevel?.elfogadva).length, webhookSor: store.read('webhook-sor.json', []).length,
      });
    }
    if ((r = p.match(/^\/api\/admin\/elonezet\/(\d{1,2})$/)) && m === 'GET') {
      const n = Number(r[1]);
      if (n < 1 || n > 24) return send(res, 404, { hiba: 'nincs' });
      const d = doc();
      return send(res, 200, naptar(d, n, 12 * 3600e3, true));
    }
    if ((r = p.match(/^\/api\/admin\/nap\/(\d{1,2})$/)) && m === 'PUT') {
      const n = Number(r[1]);
      if (n < 1 || n > 24) return send(res, 404, { hiba: 'nincs' });
      const b = await readBody(req, 128 * 1024);
      return ment(req, res, b, `${n}. nap szerkesztése`, d => {
        const v = ervenyesNap(b, n, d.days, d.profil.ev, f => !!kepPath(f));
        if (v.hiba) return v;
        d.days[n - 1] = v.nap;
        return { doc: d, valasz: { nap: v.nap } };
      });
    }
    if (p === '/api/admin/sorrend' && m === 'PUT') {
      const b = await readBody(req, 4096);
      return ment(req, res, b, 'napok sorrendje', d => {
        const v = atrendez(d.days, b.sorrend);
        if (v.hiba) return v;
        d.days = kuponHatarido(v.days, d.profil.ev);
        return { doc: d };
      });
    }
    if (p === '/api/admin/athelyez' && m === 'POST') {
      const b = await readBody(req, 2048);
      const honnan = Number(b.honnan); const hova = Number(b.hova);
      if (![honnan, hova].every(n => Number.isInteger(n) && n >= 1 && n <= 24) || honnan === hova) return send(res, 400, { hiba: 'Hibás nap.' });
      return ment(req, res, b, `üzenet áthelyezése: ${honnan}. → ${hova}. nap`, d => {
        const src = d.days[honnan - 1];
        const i = src.blokkok.findIndex(x => x.id === b.id);
        if (i < 0) return { hiba: 'Ez az üzenet már nincs meg (frissítsd az oldalt).' };
        if (src.blokkok.length < 2) return { hiba: 'Egy napon legalább egy üzenetnek maradnia kell.' };
        const [bl] = src.blokkok.splice(i, 1);
        const cel = d.days[hova - 1];
        cel.blokkok.push(bl);
        kuponHatarido([cel], d.profil.ev);
        const v = ervenyesNap(cel, hova, d.days, d.profil.ev, f => !!kepPath(f));
        if (v.hiba) return v;
        d.days[hova - 1] = v.nap;
        return { doc: d };
      });
    }
    if (p === '/api/admin/profil' && m === 'PUT') {
      const b = await readBody(req, 64 * 1024);
      return ment(req, res, b, 'beállítások', d => {
        const v = ervenyesProfil(b, d);
        if (v.hiba) return v;
        if (!kepPath(v.profil.avatar)) return { hiba: 'A profilkép nem található, töltsd fel újra.' };
        d.profil = v.profil; d.feliratkozas = v.feliratkozas;
        return { doc: d };
      });
    }
    if (p === '/api/admin/kep' && m === 'POST') {
      if (!lim.kep('admin')) return send(res, 429, { hiba: 'Túl sok feltöltés, várj egy kicsit.' });
      const buf = await readRaw(req, KEP_MAX);
      const tip = kepTipus(buf);
      if (!tip) return send(res, 415, { hiba: 'Csak JPG, PNG vagy WEBP kép tölthető fel.' });
      const nev = `${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 20)}.${tip}`;
      const fp = path.join(dataDir, 'kepek', nev);
      if (!fs.existsSync(fp)) fs.writeFileSync(fp, buf);
      return send(res, 200, { ok: true, kep: nev, url: kepUrl(nev) });
    }
    if (p === '/api/admin/mentesek' && m === 'GET') return send(res, 200, { mentesek: store.mentesLista() });
    if (p === '/api/admin/visszaallit' && m === 'POST') {
      const b = await readBody(req, 1024);
      const regi = store.mentesBetolt(String(b.id || ''));
      if (!regi) return send(res, 404, { hiba: 'Nincs ilyen mentés.' });
      return ment(req, res, b, `visszaállítás: ${b.id}`, () => ({ doc: regi }));
    }
    if (p === '/api/admin/export' && m === 'GET') {
      const body = Buffer.from(JSON.stringify(doc(), null, 1));
      res.writeHead(200, { ...SEC, 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="kalendarium-tartalom.json"', 'Cache-Control': 'no-store', 'Content-Length': body.length });
      return res.end(body);
    }
    if (p === '/api/admin/feliratkozok.csv' && m === 'GET') {
      const body = Buffer.from(csv());
      res.writeHead(200, { ...SEC, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="feliratkozok.csv"', 'Cache-Control': 'no-store', 'Content-Length': body.length });
      return res.end(body);
    }
    return send(res, 404, { hiba: 'nincs' });
  }

  /* ---------- statikus ---------- */
  function serveStatic(req, res, p) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, SEC); return res.end(); }
    if (p === '/admin') { res.writeHead(301, { ...SEC, Location: `${BASE}/admin/` }); return res.end(); }
    let rel;
    try { rel = decodeURIComponent(p); } catch { res.writeHead(400, SEC); return res.end(); }
    if (rel.endsWith('/')) rel += 'index.html';
    const fp = path.normalize(path.join(distDir, rel));
    if (!fp.startsWith(path.normalize(distDir + path.sep)) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
      res.writeHead(404, { ...SEC, 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Nincs ilyen oldal.');
    }
    const buf = fs.readFileSync(fp);
    const headers = {
      ...SEC, 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Content-Length': buf.length,
      'Cache-Control': rel.startsWith('/assets/') || rel.startsWith('/fonts/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    };
    if (rel.startsWith('/admin/')) headers['X-Robots-Tag'] = 'noindex, nofollow';
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : buf);
  }

  async function handler(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (BASE) {
        if (url.pathname === BASE) { res.writeHead(301, { ...SEC, Location: `${BASE}/${url.search}` }); return res.end(); }
        if (!url.pathname.startsWith(`${BASE}/`)) { res.writeHead(404, { ...SEC, 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Nincs ilyen oldal.'); }
        url.pathname = url.pathname.slice(BASE.length);
      }
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      return serveStatic(req, res, url.pathname);
    } catch (e) {
      if (e.code === 413) return send(res, 413, { hiba: 'Túl nagy kérés (a kép legfeljebb 5 MB lehet).' }, { Connection: 'close' });
      if (e.code === 400) return send(res, 400, { hiba: 'Hibás kérés.' });
      log.error?.('hiba:', e.message);
      if (!res.headersSent) send(res, 500, { hiba: 'Szerverhiba.' });
      else res.end();
    }
  }

  async function tick() { await sorUjraprobal(); }
  // a teszteknek: budapesti időpont
  return { handler, tick, store, bp: budapestToUtc };
}
