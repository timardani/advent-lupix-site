// A naptártartalom szabályai (tiszta függvények, unit-tesztelhetők): napok, blokkok, profil, sorrend, napzár.
import crypto from 'node:crypto';
import { maiNap, masodpercEjfelig } from './ido.js';

export const BLOKK_TIPUSOK = ['szoveg', 'kep', 'hazi', 'kupon', 'link'];
export const MAX_BLOKK = 14;
export const KEP_RE = /^[\w-]{1,80}\.(webp|jpg|png)$/;
const str = (v, min, max) => typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;
const t = v => String(v ?? '').trim();
const pad2 = x => String(x).padStart(2, '0');

export function httpsUrl(v) {
  try {
    const u = new URL(t(v));
    return u.protocol === 'https:' && u.hostname.includes('.') && t(v).length <= 600 ? u.href : null;
  } catch { return null; }
}
export const ujId = () => crypto.randomBytes(4).toString('hex');

/**
 * A kampány mai napja a napi nyitási órával: a nap N. üzenete december N. HH:00-kor nyílik,
 * és a következő nyitásig olvasható. 0 = még nem kezdődött, 25 = vége.
 */
export function aktualis(ev, nyitasOra = 0, now = new Date()) {
  const eltolt = new Date(now.getTime() - nyitasOra * 3600e3);
  const nap = maiNap(ev, eltolt);
  return { nap, hatraMs: nap >= 1 && nap <= 24 ? masodpercEjfelig(eltolt) * 1000 : 0 };
}

/** Egy blokk ellenőrzése és megtisztítása. */
function blokk(b, n, ev, kepLetezik) {
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
      return { b: { id, tipus: 'kep', kep: b.kep, alt: t(b.alt), felirat: t(b.felirat) } };
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
      if (erv < `${ev}-12-${pad2(n)}` || erv > `${ev + 1}-12-31`) return hiba(`a beváltási határidő december ${n}. és ${ev + 1}. december 31. közé essen.`);
      const url = b.url ? httpsUrl(b.url) : null;
      if (b.url && !url) return hiba('a kupon linkje https:// kezdetű webcím legyen.');
      return { b: { id, tipus: 'kupon', ertek: t(b.ertek), mire: t(b.mire), kod, feltetel: t(b.feltetel), ervenyesIg: erv, ...(url ? { url } : {}) } };
    }
  }
  return hiba('ismeretlen üzenettípus.');
}

/** Egy nap ellenőrzése. A kuponkód nem ismétlődhet más napon. */
export function ervenyesNap(b, n, days, ev, kepLetezik = () => true) {
  if (!b || !str(b.cim, 3, 90)) return { hiba: `${n}. nap: a nap címe 3–90 karakter legyen.` };
  const bl = Array.isArray(b.blokkok) ? b.blokkok : [];
  if (!bl.length) return { hiba: `${n}. nap: legalább egy üzenet kell.` };
  if (bl.length > MAX_BLOKK) return { hiba: `${n}. nap: legfeljebb ${MAX_BLOKK} üzenet lehet egy napon.` };
  const out = [];
  const ids = new Set();
  for (const x of bl) {
    const r = blokk(x, n, ev, kepLetezik);
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
  if (!Array.isArray(sorrend) || sorrend.length !== 24) return { hiba: 'A sorrendben mind a 24 napnak szerepelnie kell.' };
  const s = [...sorrend].map(Number).sort((a, b) => a - b);
  if (!s.every((v, i) => v === i + 1)) return { hiba: 'Hibás sorrend.' };
  return { days: sorrend.map((old, i) => ({ ...days[Number(old) - 1], day: i + 1 })) };
}

/** Kuponok érvényessége a nap áthelyezése után: a határidő nem lehet korábbi az új napnál. */
export function kuponHatarido(days, ev) {
  for (const d of days) for (const b of d.blokkok) {
    if (b.tipus === 'kupon' && b.ervenyesIg < `${ev}-12-${pad2(d.day)}`) b.ervenyesIg = `${ev}-12-${pad2(d.day)}`;
  }
  return days;
}

const linkLista = (v, max) => (Array.isArray(v) ? v : []).slice(0, max).map(l => ({ felirat: t(l?.felirat), url: httpsUrl(l?.url) }));

/** Profil (márka, szövegek, linkek, időzítés) és feliratkozás ellenőrzése. */
export function ervenyesProfil(b, regi) {
  const p = b.profil || {};
  const hiba = m => ({ hiba: m });
  const ev = Number(p.ev);
  if (!Number.isInteger(ev) || ev < 2025 || ev > 2035) return hiba('Hibás kampányév.');
  for (const [k, max] of [['nev', 80], ['becenev', 30], ['titulus', 60], ['wordmark', 30]]) if (!str(p[k], 1, max)) return hiba(`A(z) „${k}” mező 1–${max} karakter.`);
  if (!httpsUrl(p.web)) return hiba('A weboldal címe https:// kezdetű legyen.');
  if (!KEP_RE.test(p.avatar || '')) return hiba('Hiányzik a profilkép.');
  const ora = Number(p.nyitasOra);
  if (!Number.isInteger(ora) || ora < 0 || ora > 12) return hiba('A napi nyitás 0 és 12 óra között lehet.');
  if (!['lassu', 'normal', 'gyors'].includes(p.tempo)) return hiba('Hibás gépelési tempó.');
  const sz = p.szovegek || {};
  const SZ = { kicker: 80, cim: 120, lead: 300, gridCim: 60, gridAlcim: 120, match: 60, elotte: 300, vege: 300, kuponLabjegyzet: 120, lablec: 160 };
  const szovegek = {};
  for (const [k, max] of Object.entries(SZ)) {
    if (!str(sz[k] ?? '', k === 'kuponLabjegyzet' ? 0 : 1, max)) return hiba(`Szöveg („${k}”): ${k === 'kuponLabjegyzet' ? 0 : 1}–${max} karakter.`);
    szovegek[k] = t(sz[k]);
  }
  const kov = p.kovetes || {};
  if (!str(kov.felirat || '', 0, 40) || (t(kov.url) && !httpsUrl(kov.url))) return hiba('A követés gomb linkje https:// kezdetű legyen.');
  const lablecLinkek = linkLista(p.lablecLinkek, 6);
  const gyorsLinkek = linkLista(p.gyorsLinkek, 12);
  if ([...lablecLinkek, ...gyorsLinkek].some(l => !str(l.felirat, 1, 60) || !l.url)) return hiba('Minden linknél kell felirat és https:// kezdetű cím.');
  const f = b.feliratkozas || {};
  const FT = { cim: 90, szoveg: 300, gomb: 30, koszono: 160, reszvetelSzoveg: 200, hirlevelSzoveg: 200 };
  const feliratkozas = { aktiv: !!f.aktiv, verzio: regi?.feliratkozas?.verzio || '1' };
  for (const [k, max] of Object.entries(FT)) {
    if (!str(f[k] ?? '', 1, max)) return hiba(`Feliratkozás („${k}”): 1–${max} karakter.`);
    feliratkozas[k] = t(f[k]);
  }
  for (const k of ['reszvetelUrl', 'adatkezelesUrl']) {
    if (t(f[k]) && !httpsUrl(f[k])) return hiba('A jogi szövegek címe https:// kezdetű legyen.');
    feliratkozas[k] = t(f[k]) ? httpsUrl(f[k]) : '';
  }
  if (feliratkozas.aktiv && !feliratkozas.adatkezelesUrl) return hiba('A feliratkozás bekapcsolásához add meg az adatkezelési tájékoztató címét.');
  // Ha a jóváhagyott jogi szöveg változik, a hozzájárulás-napló új verziót kap.
  const rf = regi?.feliratkozas || {};
  if (['reszvetelSzoveg', 'hirlevelSzoveg', 'reszvetelUrl', 'adatkezelesUrl'].some(k => (rf[k] ?? '') !== feliratkozas[k])) {
    feliratkozas.verzio = String(Number(rf.verzio || 1) + 1);
  }
  return {
    profil: {
      ev, nev: t(p.nev), becenev: t(p.becenev), titulus: t(p.titulus), wordmark: t(p.wordmark), web: httpsUrl(p.web),
      avatar: p.avatar, nyitasOra: ora, tempo: p.tempo,
      kovetes: { felirat: t(kov.felirat), url: t(kov.url) ? httpsUrl(kov.url) : '' },
      szovegek, lablecLinkek, gyorsLinkek,
    },
    feliratkozas,
  };
}

/** A naptár nyilvános nézete: csak a mai nap teljes; elmúlt nap csonk; jövő csak napszám + ajándékjel. */
export function nyilvanos(doc, nap, kepUrl) {
  const out = doc.days.map(d => {
    const ajandek = d.blokkok.some(b => b.tipus === 'kupon');
    if (nap > 24 || d.day < nap) return { day: d.day, allapot: 'past' };
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
