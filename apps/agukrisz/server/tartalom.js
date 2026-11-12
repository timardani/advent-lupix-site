// A naptártartalom szabályai (tiszta függvények, unit-tesztelhetők): napok, blokkok, profil, sorrend, napzár.
import crypto from 'node:crypto';
import { budapestParts, masodpercEjfelig } from './ido.js';

export const BLOKK_TIPUSOK = ['szoveg', 'kep', 'hazi', 'kupon', 'link'];
export const MAX_BLOKK = 14;
export const MAX_NAP = 366;
const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/;
const SZIN_RE = /^#[0-9a-f]{6}$/i;
export const ALAP_SZINEK = { hatter1: '#0a1629', hatter2: '#1e1322', kiemeles: '#bd8a7a', masodik: '#c9a84c', szoveg: '#f5ebe8' };

/** 'YYYY-MM-DD' + k nap → 'YYYY-MM-DD' (naptári számolás, időzóna nélkül). */
export function datumPlusz(iso, k) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + k)).toISOString().slice(0, 10);
}
/** A kampány n. napjának dátuma. */
export const napDatuma = (kezdet, n) => datumPlusz(kezdet, n - 1);
const ervenyesDatum = v => DATUM_RE.test(v || '') && datumPlusz(v, 0) === v;

/** GoHighLevel beágyazókód (vagy csak a cím) → az iframe címe; csak GHL-domainről. */
export function ghlUrl(kod) {
  const m = /https:\/\/[^\s"'<>]+\/widget\/(?:survey|form|booking|quiz)\/[A-Za-z0-9_-]{6,64}[^\s"'<>]*/.exec(String(kod || '').replace(/&amp;/g, '&'));
  if (!m) return null;
  try {
    const u = new URL(m[0]);
    if (!/(^|\.)(leadconnectorhq\.com|msgsndr\.com)$/.test(u.hostname) || u.href.length > 600) return null;
    return u.href;
  } catch { return null; }
}

/** Régebbi (24 napos, decemberi) tartalom kiegészítése az új mezőkkel. Csak hiányzó mezőt tölt ki. */
export function normalizal(doc) {
  const p = doc.profil;
  if (!ervenyesDatum(p.kezdet)) p.kezdet = `${Number(p.ev) || 2026}-12-01`;
  p.ev = Number(p.kezdet.slice(0, 4));
  p.szinek = { ...ALAP_SZINEK, ...(p.szinek || {}) };
  if (typeof p.fenyfuzer !== 'boolean') p.fenyfuzer = true;
  p.hero = { kep: 'hero.jpg', fokusz: 30, cimkek: [{ szoveg: '📅 December 1–24.' }, { szoveg: '💬 Minden nap új üzenet' }, { szoveg: '🎁 Ajándéknapok' }], ...(p.hero || {}) };
  p.szovegek = { heroGomb: 'Mai üzenet megnyitása', ...p.szovegek };
  p.alsoGomb = {
    aktiv: true, cim: 'Nem akarsz januárig várni?', szoveg: 'Beszéljük át a te helyzetedet egy egyéni konzultáción.',
    felirat: 'Konzultációt foglalok', url: 'https://agukrisz.hu/ferfi-egyeni-konzultacio', ...(p.alsoGomb || {}),
  };
  const f = doc.feliratkozas;
  if (!['sajat', 'ghl'].includes(f.mod)) f.mod = 'sajat';
  if (typeof f.ghlUrl !== 'string') f.ghlUrl = '';
  doc.days.forEach((d, i) => { d.day = i + 1; });
  return doc;
}

/** Új, még kitöltendő nap (a napok számának növelésekor). */
export const ujNap = n => ({ day: n, cim: `${n}. nap – írd át`, uj: true, blokkok: [{ id: ujId(), tipus: 'szoveg', szoveg: 'Ide jön a mai üzenet.' }] });
export const KEP_RE = /^[\w-]{1,80}\.(webp|jpg|png)$/;
const str = (v, min, max) => typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;
const t = v => String(v ?? '').trim();

export function httpsUrl(v) {
  try {
    const u = new URL(t(v));
    return u.protocol === 'https:' && u.hostname.includes('.') && t(v).length <= 600 ? u.href : null;
  } catch { return null; }
}
export const ujId = () => crypto.randomBytes(4).toString('hex');

/**
 * A kampány mai napja a napi nyitási órával: az n. nap üzenete a kezdőnap + (n−1) napon HH:00-kor nyílik,
 * és a következő nyitásig olvasható. 0 = még nem kezdődött, napok+1 = vége.
 */
export function aktualis(kezdet, napok = 24, nyitasOra = 0, now = new Date()) {
  const eltolt = new Date(now.getTime() - nyitasOra * 3600e3);
  const b = budapestParts(eltolt);
  const [y, m, d] = kezdet.split('-').map(Number);
  const diff = Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(y, m - 1, d)) / 864e5);
  const nap = diff < 0 ? 0 : Math.min(napok + 1, diff + 1);
  return { nap, hatraMs: nap >= 1 && nap <= napok ? masodpercEjfelig(eltolt) * 1000 : 0 };
}

/** Egy blokk ellenőrzése és megtisztítása. */
function blokk(b, n, kezdet, kepLetezik) {
  const hiba = m => ({ hiba: `${n}. nap: ${m}` });
  if (!b || !BLOKK_TIPUSOK.includes(b.tipus)) return hiba('ismeretlen üzenettípus.');
  const id = /^[a-z0-9]{4,16}$/.test(b.id || '') ? b.id : ujId();
  switch (b.tipus) {
    case 'szoveg':
      if (!str(b.szoveg, 1, 700)) return hiba('egy üzenet 1–700 karakter lehet.');
      return { b: { id, tipus: 'szoveg', szoveg: t(b.szoveg) } };
    case 'hazi':
      if (!str(b.szoveg, 1, 500)) return hiba('a házi feladat 1–500 karakter lehet.');
      return { b: { id, tipus: 'hazi', szoveg: t(b.szoveg) } };
    case 'kep':
      if (!KEP_RE.test(b.kep || '') || !kepLetezik(b.kep)) return hiba('a képüzenethez tölts fel egy képet.');
      if (!str(b.alt || '', 0, 160) || !str(b.felirat || '', 0, 300)) return hiba('a kép leírása legfeljebb 160, a felirata 300 karakter.');
      const meret = [b.w, b.h].every(x => Number.isInteger(x) && x > 0 && x <= 10000) ? { w: b.w, h: b.h } : {};
      return { b: { id, tipus: 'kep', kep: b.kep, alt: t(b.alt), felirat: t(b.felirat), ...meret } };
    case 'link': {
      const url = httpsUrl(b.url);
      if (!str(b.felirat, 2, 90)) return hiba('a link felirata 2–90 karakter legyen.');
      if (!url) return hiba('a link címe https:// kezdetű, teljes webcím legyen.');
      return { b: { id, tipus: 'link', felirat: t(b.felirat), url } };
    }
    case 'kupon': {
      const kod = t(b.kod).toUpperCase();
      if (!/^[A-Z0-9]{3,24}$/.test(kod)) return hiba('a kuponkód 3–24 karakter, csak betű és szám (ékezet és szóköz nélkül).');
      if (!str(b.ertek, 1, 40)) return hiba('a kupon értéke (pl. −2000 Ft) 1–40 karakter.');
      if (!str(b.mire, 2, 140)) return hiba('írd be, mire szól a kupon (2–140 karakter).');
      if (!str(b.feltetel || '', 0, 260)) return hiba('a feltétel legfeljebb 260 karakter.');
      const erv = t(b.ervenyesIg);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(erv)) return hiba('add meg, meddig váltható be a kupon.');
      const min = napDatuma(kezdet, n); const max = datumPlusz(min, 730);
      if (!ervenyesDatum(erv) || erv < min || erv > max) return hiba(`a beváltási határidő ${min} és ${max} közé essen (nem lehet korábbi a nap dátumánál).`);
      const url = b.url ? httpsUrl(b.url) : null;
      if (b.url && !url) return hiba('a kupon linkje https:// kezdetű webcím legyen.');
      return { b: { id, tipus: 'kupon', ertek: t(b.ertek), mire: t(b.mire), kod, feltetel: t(b.feltetel), ervenyesIg: erv, ...(url ? { url } : {}) } };
    }
  }
  return hiba('ismeretlen üzenettípus.');
}

/** Egy nap ellenőrzése. A kuponkód nem ismétlődhet más napon. */
export function ervenyesNap(b, n, days, kezdet, kepLetezik = () => true) {
  if (typeof kezdet === 'number') kezdet = `${kezdet}-12-01`;
  if (!b || !str(b.cim, 3, 90)) return { hiba: `${n}. nap: a nap címe 3–90 karakter legyen.` };
  const bl = Array.isArray(b.blokkok) ? b.blokkok : [];
  if (!bl.length) return { hiba: `${n}. nap: legalább egy üzenet kell.` };
  if (bl.length > MAX_BLOKK) return { hiba: `${n}. nap: legfeljebb ${MAX_BLOKK} üzenet lehet egy napon.` };
  const out = [];
  const ids = new Set();
  for (const x of bl) {
    const r = blokk(x, n, kezdet, kepLetezik);
    if (r.hiba) return r;
    if (ids.has(r.b.id)) r.b.id = ujId();
    ids.add(r.b.id);
    out.push(r.b);
  }
  const kodok = out.filter(x => x.tipus === 'kupon').map(x => x.kod);
  if (new Set(kodok).size !== kodok.length) return { hiba: `${n}. nap: ugyanaz a kuponkód kétszer szerepel.` };
  for (const d of days) {
    if (d.day === n) continue;
    const utk = d.blokkok.find(x => x.tipus === 'kupon' && kodok.includes(x.kod));
    if (utk) return { hiba: `${n}. nap: a(z) ${utk.kod} kód már a(z) ${d.day}. napon szerepel.` };
  }
  // Napkép (opcionális): a mai kártyán és a jobbra húzós kártyán; üresen a profilkép látszik.
  const kep = t(b.kep);
  if (kep && (!KEP_RE.test(kep) || !kepLetezik(kep))) return { hiba: `${n}. nap: a napkép nem található, töltsd fel újra.` };
  return { nap: { day: n, cim: t(b.cim), ...(kep ? { kep } : {}), blokkok: out } };
}

/** A napok új sorrendje: `sorrend` az eddigi napszámok új sorrendje (1..24 permutációja). */
export function atrendez(days, sorrend) {
  if (!Array.isArray(sorrend) || sorrend.length !== days.length) return { hiba: `A sorrendben mind a ${days.length} napnak szerepelnie kell.` };
  const s = [...sorrend].map(Number).sort((a, b) => a - b);
  if (!s.every((v, i) => v === i + 1)) return { hiba: 'Hibás sorrend.' };
  return { days: sorrend.map((old, i) => ({ ...days[Number(old) - 1], day: i + 1 })) };
}

/** Kuponok érvényessége a nap áthelyezése után: a határidő nem lehet korábbi az új napnál. */
export function kuponHatarido(days, kezdet) {
  if (typeof kezdet === 'number') kezdet = `${kezdet}-12-01`;
  for (const d of days) for (const b of d.blokkok) {
    if (b.tipus !== 'kupon') continue;
    const min = napDatuma(kezdet, d.day); const max = datumPlusz(min, 730);
    if (!(b.ervenyesIg >= min)) b.ervenyesIg = min;
    if (b.ervenyesIg > max) b.ervenyesIg = max;
  }
  return days;
}

const linkLista = (v, max) => (Array.isArray(v) ? v : []).slice(0, max).map(l => ({ felirat: t(l?.felirat), url: httpsUrl(l?.url) }));

/** Profil (márka, szövegek, megjelenés, linkek, időzítés) és feliratkozás ellenőrzése. */
export function ervenyesProfil(b, regi) {
  const p = b.profil || {};
  const hiba = m => ({ hiba: m });
  const kezdet = t(p.kezdet);
  if (!ervenyesDatum(kezdet) || kezdet < '2025-01-01' || kezdet > '2035-12-31') return hiba('Hibás kezdő dátum.');
  const napokSzama = p.napokSzama === undefined ? (regi?.days?.length || 24) : Number(p.napokSzama);
  if (!Number.isInteger(napokSzama) || napokSzama < 1 || napokSzama > MAX_NAP) return hiba(`A napok száma 1 és ${MAX_NAP} között lehet.`);
  for (const [k, max] of [['nev', 80], ['becenev', 30], ['titulus', 60], ['wordmark', 30]]) if (!str(p[k], 1, max)) return hiba(`A(z) „${k}” mező 1–${max} karakter.`);
  if (!httpsUrl(p.web)) return hiba('A weboldal címe https:// kezdetű legyen.');
  if (!KEP_RE.test(p.avatar || '')) return hiba('Hiányzik a profilkép.');
  const ora = Number(p.nyitasOra);
  if (!Number.isInteger(ora) || ora < 0 || ora > 12) return hiba('A napi nyitás 0 és 12 óra között lehet.');
  if (!['lassu', 'normal', 'gyors'].includes(p.tempo)) return hiba('Hibás gépelési tempó.');
  const sz = p.szovegek || {};
  const SZ = { kicker: 80, cim: 120, lead: 300, heroGomb: 40, gridCim: 60, gridAlcim: 120, match: 60, elotte: 300, vege: 300, kuponLabjegyzet: 120, lablec: 160 };
  const URESLEHET = ['kicker', 'lead', 'heroGomb', 'gridAlcim', 'kuponLabjegyzet', 'lablec'];
  const szovegek = {};
  for (const [k, max] of Object.entries(SZ)) {
    const min = URESLEHET.includes(k) ? 0 : 1;
    if (!str(sz[k] ?? '', min, max)) return hiba(`Szöveg („${k}”): ${min}–${max} karakter.`);
    szovegek[k] = t(sz[k]);
  }
  const szinek = {};
  for (const k of Object.keys(ALAP_SZINEK)) {
    const v = t(p.szinek?.[k] || ALAP_SZINEK[k]).toLowerCase();
    if (!SZIN_RE.test(v)) return hiba('Hibás szín (#rrggbb formában add meg).');
    szinek[k] = v;
  }
  const h = p.hero || {};
  const heroKep = t(h.kep);
  if (heroKep && !KEP_RE.test(heroKep)) return hiba('A háttérkép nem található, töltsd fel újra.');
  const fokusz = Math.round(Number(h.fokusz ?? 30));
  if (!(fokusz >= 0 && fokusz <= 100)) return hiba('Hibás képfókusz.');
  const cimkek = (Array.isArray(h.cimkek) ? h.cimkek : []).slice(0, 6).map(c => ({ szoveg: t(c?.szoveg) })).filter(c => c.szoveg);
  if (cimkek.some(c => c.szoveg.length > 50)) return hiba('Egy címke legfeljebb 50 karakter.');
  const ag = p.alsoGomb || {};
  const alsoGomb = { aktiv: !!ag.aktiv, cim: t(ag.cim), szoveg: t(ag.szoveg), felirat: t(ag.felirat), url: t(ag.url) ? httpsUrl(ag.url) : '' };
  if (alsoGomb.cim.length > 90 || alsoGomb.szoveg.length > 300 || alsoGomb.felirat.length > 40) return hiba('Alsó gomb: a cím max. 90, a szöveg 300, a felirat 40 karakter.');
  if (t(ag.url) && !alsoGomb.url) return hiba('Az alsó gomb linkje https:// kezdetű legyen.');
  if (alsoGomb.aktiv && (!alsoGomb.felirat || !alsoGomb.url)) return hiba('Az alsó gombhoz kell felirat és link (vagy kapcsold ki).');
  const kov = p.kovetes || {};
  if (!str(kov.felirat || '', 0, 40) || (t(kov.url) && !httpsUrl(kov.url))) return hiba('A követés gomb linkje https:// kezdetű legyen.');
  const lablecLinkek = linkLista(p.lablecLinkek, 6);
  const gyorsLinkek = linkLista(p.gyorsLinkek, 12);
  if ([...lablecLinkek, ...gyorsLinkek].some(l => !str(l.felirat, 1, 60) || !l.url)) return hiba('Minden linknél kell felirat és https:// kezdetű cím.');
  const f = b.feliratkozas || {};
  const FT = { cim: 90, szoveg: 300, gomb: 30, koszono: 160, reszvetelSzoveg: 200, hirlevelSzoveg: 200 };
  const mod = f.mod === 'ghl' ? 'ghl' : 'sajat';
  const feliratkozas = { aktiv: !!f.aktiv, mod, verzio: regi?.feliratkozas?.verzio || '1' };
  for (const [k, max] of Object.entries(FT)) {
    const min = mod === 'ghl' && k !== 'cim' ? 0 : 1;
    if (!str(f[k] ?? '', min, max)) return hiba(`Feliratkozás („${k}”): ${min}–${max} karakter.`);
    feliratkozas[k] = t(f[k]);
  }
  for (const k of ['reszvetelUrl', 'adatkezelesUrl']) {
    if (t(f[k]) && !httpsUrl(f[k])) return hiba('A jogi szövegek címe https:// kezdetű legyen.');
    feliratkozas[k] = t(f[k]) ? httpsUrl(f[k]) : '';
  }
  const ghlForras = f.ghlKod !== undefined ? t(f.ghlKod) : t(f.ghlUrl);
  feliratkozas.ghlUrl = ghlForras ? ghlUrl(ghlForras) : '';
  if (ghlForras && !feliratkozas.ghlUrl) return hiba('A GoHighLevel-kódot nem ismertük fel. Másold be a teljes beágyazókódot (<iframe src="https://api.leadconnectorhq.com/widget/…">).');
  if (feliratkozas.aktiv && mod === 'ghl' && !feliratkozas.ghlUrl) return hiba('A GoHighLevel-űrlaphoz másold be a beágyazókódot.');
  if (feliratkozas.aktiv && mod === 'sajat' && !feliratkozas.adatkezelesUrl) return hiba('A feliratkozás bekapcsolásához add meg az adatkezelési tájékoztató címét.');
  // Ha a jóváhagyott jogi szöveg változik, a hozzájárulás-napló új verziót kap.
  const rf = regi?.feliratkozas || {};
  if (['reszvetelSzoveg', 'hirlevelSzoveg', 'reszvetelUrl', 'adatkezelesUrl'].some(k => (rf[k] ?? '') !== feliratkozas[k])) {
    feliratkozas.verzio = String(Number(rf.verzio || 1) + 1);
  }
  return {
    profil: {
      kezdet, ev: Number(kezdet.slice(0, 4)), nev: t(p.nev), becenev: t(p.becenev), titulus: t(p.titulus), wordmark: t(p.wordmark), web: httpsUrl(p.web),
      avatar: p.avatar, nyitasOra: ora, tempo: p.tempo, szinek, fenyfuzer: p.fenyfuzer !== false,
      hero: { kep: heroKep, fokusz, cimkek }, alsoGomb,
      kovetes: { felirat: t(kov.felirat), url: t(kov.url) ? httpsUrl(kov.url) : '' },
      szovegek, lablecLinkek, gyorsLinkek,
    },
    feliratkozas,
    napokSzama,
  };
}

/** A naptár nyilvános nézete: csak a mai nap teljes; elmúlt nap csonk; jövő csak napszám + ajándékjel. */
export function nyilvanos(doc, nap, kepUrl) {
  const out = doc.days.map(d => {
    const ajandek = d.blokkok.some(b => b.tipus === 'kupon');
    if (nap > doc.days.length || d.day < nap) return { day: d.day, allapot: 'past' };
    if (d.day > nap) return { day: d.day, allapot: 'future', ajandek };
    return {
      day: d.day, allapot: 'today', ajandek, cim: d.cim, ...(d.kep ? { kep: kepUrl(d.kep) } : {}),
      blokkok: d.blokkok.map(b => (b.tipus === 'kep' ? { ...b, kep: kepUrl(b.kep) } : b)),
    };
  });
  return out;
}

/** Mely napokon szerepel egy kép (a napzárhoz). */
export const kepNapjai = (doc, f) => doc.days.filter(d => d.kep === f || d.blokkok.some(b => b.tipus === 'kep' && b.kep === f)).map(d => d.day);
