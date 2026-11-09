// Időkezelés: minden naptári döntés Europe/Budapest szerint, szerveroldalon.
const TZ = 'Europe/Budapest';
const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric',
  hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
});

/** Budapesti falióra részei: { year, month, day, hour, minute, second }. */
export function budapestParts(date = new Date()) {
  return Object.fromEntries(fmt.formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
}

/** Budapesti helyi időpont → UTC Date (téli/nyári időre is helyes). */
export function budapestToUtc(y, m, d, h = 0, mi = 0, s = 0) {
  const target = Date.UTC(y, m - 1, d, h, mi, s);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = budapestParts(new Date(guess));
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess -= seen - target;
  }
  return new Date(guess);
}

/** 'YYYY-MM-DDTHH:mm' (budapesti) → UTC Date; hibás bemenetre null. */
export function parseBudapestLocal(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(String(str || ''));
  if (!m) return null;
  const [y, mo, d, h = 0, mi = 0, s = 0] = m.slice(1).map(v => (v === undefined ? 0 : Number(v)));
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  return budapestToUtc(y, mo, d, h, mi, s);
}

/**
 * A kampány mai napja: 1–24 decemberben; 0 = még nem kezdődött; 25 = vége.
 * @param {number} ev kampányév (pl. 2026)
 */
export function maiNap(ev, now = new Date()) {
  const p = budapestParts(now);
  if (p.year < ev || (p.year === ev && p.month < 12)) return 0;
  if (p.year === ev && p.month === 12 && p.day <= 24) return p.day;
  return 25;
}

/** Másodpercek a budapesti éjfélig. */
export function masodpercEjfelig(now = new Date()) {
  const { hour, minute, second } = budapestParts(now);
  return 86400 - (hour * 3600 + minute * 60 + second);
}

/** December N. napjának vége (23:59:59 Budapest) UTC-ben. */
export function napVege(ev, nap) {
  return budapestToUtc(ev, 12, nap, 23, 59, 59);
}

/** WooCommerce date_expires_gmt formátum: 'YYYY-MM-DDTHH:mm:ss' (UTC, zóna nélkül). */
export const wooGmt = date => date.toISOString().slice(0, 19);

const HONAP = ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];
const NAPNEV = ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat'];

/** Magyar dátumszöveg budapesti idő szerint: „december 18. (péntek) 23:59”. */
export function magyarDatum(date, { ora = true, napnev = true } = {}) {
  const p = budapestParts(date);
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  const pad = n => String(n).padStart(2, '0');
  return `${HONAP[p.month - 1]} ${p.day}.${napnev ? ` (${NAPNEV[dow]})` : ''}${ora ? ` ${pad(p.hour)}:${pad(p.minute)}` : ''}`;
}
