'use strict';
// Süss Velem – adventi szaggatónaptár. Statikus, build nélkül.
const products = window.SUSS_PRODUCTS, offers = window.SUSS_OFFERS;
if (!Array.isArray(products) || products.length !== 24 || offers.length !== 24) throw new Error('Hiányos adat');

/* ---------- 8 szaggatóforma (100×100) ---------- */
function starPath(n, R, r, cx = 50, cy = 52) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + i * Math.PI / n, rad = i % 2 ? r : R;
    pts.push((cx + rad * Math.cos(a)).toFixed(1) + ' ' + (cy + rad * Math.sin(a)).toFixed(1));
  }
  return 'M' + pts.join(' L') + ' Z';
}
const SHAPES = {
  csillag: { name: 'csillagot', d: starPath(5, 46, 20) },
  mezi: { name: 'mézi emberkét', d: 'M50 8 A14 14 0 0 1 59 33 L77 39 Q85 42 81 49 Q78 54 71 52 L61 48 L65 70 L77 88 Q81 95 74 98 Q68 100 64 94 L50 76 L36 94 Q32 100 26 98 Q19 95 23 88 L35 70 L39 48 L29 52 Q22 54 19 49 Q15 42 23 39 L41 33 A14 14 0 0 1 50 8 Z' },
  fenyo: { name: 'fenyőfát', d: 'M50 6 L74 36 L64 36 L84 62 L72 62 L90 86 L56 86 L56 96 L44 96 L44 86 L10 86 L28 62 L16 62 L36 36 L26 36 Z' },
  sziv: { name: 'szívet', d: 'M50 90 C20 68 6 50 6 32 C6 18 17 8 30 8 C40 8 47 14 50 22 C53 14 60 8 70 8 C83 8 94 18 94 32 C94 50 80 68 50 90 Z' },
  hopehely: { name: 'hópelyhet', d: starPath(6, 47, 24, 50, 50) },
  harang: { name: 'harangot', d: 'M50 8 Q56 8 56 14 Q74 18 76 42 L78 64 Q80 72 88 76 L88 84 L12 84 L12 76 Q20 72 22 64 L24 42 Q26 18 44 14 Q44 8 50 8 Z M44 88 A6 6 0 1 0 56 88 A6 6 0 1 0 44 88 Z' },
  haziko: { name: 'mézeskalácsházat', d: 'M50 8 L92 44 L80 44 L80 92 L20 92 L20 44 L8 44 Z' },
  hold: { name: 'holdat', d: 'M62 8 A42 42 0 1 0 92 78 A40 40 0 0 1 62 8 Z' },
};
const FLUTED = starPath(16, 49, 44, 50, 50);
const ORDER = ['csillag', 'mezi', 'fenyo', 'sziv', 'hopehely', 'harang', 'haziko', 'hold'];
const shapeOf = day => SHAPES[ORDER[(day - 1) % 8]];
const svg = (d, cls) => `<svg viewBox="0 0 100 100" class="${cls}" aria-hidden="true"><path d="${d}"/></svg>`;

/* ---------- idő (Europe/Budapest) ---------- */
function budapestParts(now = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Budapest', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' })
    .formatToParts(now).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
}
const secondsToMidnight = (now = new Date()) => { const { hour, minute, second } = budapestParts(now); return 86400 - (hour * 3600 + minute * 60 + second); };
const hms = s => [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, '0')).join(':');

const params = new URLSearchParams(location.search);
const isPresenter = params.get('bemutato') === '1';
const forced = Number(params.get('nap'));
const hasForced = Number.isInteger(forced) && forced >= 1 && forced <= 24;

/** A valódi „ma” a vásárlói nézetben: 0 = advent előtt, 25 = után. */
function realToday(now = new Date()) {
  if (hasForced) return forced;
  const { year, month, day } = budapestParts(now);
  if (year < 2026 || (year === 2026 && month < 12)) return 0;
  if (year === 2026 && month === 12 && day <= 24) return day;
  return 25;
}
let selected = hasForced ? forced : 7;
const todayNow = () => (isPresenter ? selected : realToday());
/** Nap állapota: a kiválasztott/valódi „ma” előtt elmúlt, utána zárt. */
const dayState = day => { const t = todayNow(); return day < t ? 'past' : day === t ? 'today' : 'future'; };

/** A kód él-e még: a nap kódja csak a saját budapesti napján él. */
function offerState(day, now = new Date()) {
  if (isPresenter || hasForced) return { expired: false, left: secondsToMidnight(now) };
  return realToday(now) === day ? { expired: false, left: secondsToMidnight(now) } : { expired: true, left: 0 };
}

/* ---------- kinyitott napok ---------- */
const memOpened = new Set();
const isOpened = d => (isPresenter ? memOpened.has(d) : localStorage.getItem('sussvelem-nyitva-' + d) === '1');
const markOpened = d => { if (isPresenter) memOpened.add(d); else try { localStorage.setItem('sussvelem-nyitva-' + d, '1'); } catch {} };

/* ---------- naptár ---------- */
const board = document.getElementById('board');
const fmt = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' Ft';
function render() {
  board.replaceChildren();
  for (let i = 1; i <= 24; i++) {
    const st = dayState(i), sh = shapeOf(i), num = String(i).padStart(2, '0');
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'cookie s-' + st; b.dataset.day = i;
    b.disabled = st !== 'today';
    b.setAttribute('aria-label', `${i}. nap: ${st === 'today' ? 'mai süti kiszaggatása' : st === 'past' ? 'elmúlt nap, már kiszaggatva' : 'még nyers tészta, zárva'}`);
    b.innerHTML = svg(sh.d, 'ck') + (st === 'today' ? svg(sh.d, 'icing') : '') + `<span class="n">${num}</span>` +
      (st === 'today' ? '<span class="cpn" aria-hidden="true">%</span>' : '') +
      (st === 'past' ? '<span class="lock" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 10V7a5 5 0 0 1 10 0v3h1v11H6V10zm2 0h6V7a3 3 0 0 0-6 0z"/></svg></span>' : '');
    if (st === 'today') b.addEventListener('click', () => open(i));
    board.append(b);
  }
  const t = todayNow();
  document.getElementById('hint').textContent = t === 0 ? 'December 1-jén szaggathatod ki az első sütit.' : t === 25 ? 'Az idei advent véget ért – boldog karácsonyt!' : `Ma a ${t}. süti vár: koppints a kisült mézeskalácsra!`;
}

/* ---------- ajánlat ---------- */
const P = d => products[d - 1];
const round10 = n => Math.round(n / 10) * 10;
function priceLine(o) {
  const p = P(o.day).priceHuf;
  switch (o.type) {
    case 'kedvezmeny': return { now: round10(p * (1 - o.pct / 100)), was: p };
    case 'csomag': { const full = p + o.companions.reduce((s, c) => s + P(c).priceHuf, 0); return { now: o.bundleHuf, was: full }; }
    case '1plus1': return { now: p, was: p * 2 };
    default: return { now: p, was: null };
  }
}
function badgeText(o) {
  switch (o.type) {
    case 'kedvezmeny': return [`−${o.pct}%`, o.storewide ? 'mindenre' : 'csak ma'];
    case '1plus1': return ['1+1', 'egy áráért'];
    case 'ajandek': return ['+1', 'ajándék'];
    case 'szallitas': return ['0 Ft', 'szállítás'];
    case 'csomag': { const pl = priceLine(o); return [`−${Math.round((1 - pl.now / pl.was) * 100)}%`, 'csomagban']; }
  }
}
const tile = (d, tag, cls = '') => `<a class="tile ${cls}" href="${P(d).url}" target="_blank" rel="noopener noreferrer"><img src="${P(d).image}" alt="${offers[d - 1].short}" width="120" height="120">${tag ? `<b>${tag}</b>` : ''}</a>`;
function dealRow(o) {
  const pl = priceLine(o), d = o.day;
  let eq;
  if (o.type === 'kedvezmeny') eq = tile(d, `−${o.pct}%`);
  else if (o.type === '1plus1') eq = tile(d) + '<i>+</i>' + tile(d, 'INGYEN', 'free');
  else if (o.type === 'ajandek') eq = tile(d) + '<i>+</i>' + o.companions.map(c => tile(c, 'AJÁNDÉK', 'free')).join('');
  else if (o.type === 'csomag') eq = [d, ...o.companions].map(c => tile(c)).join('<i>+</i>');
  else eq = tile(d) + '<i>+</i><span class="tile truck"><svg viewBox="0 0 48 32" aria-hidden="true"><path d="M2 4h28v20H2zM30 11h9l7 7v6H30z"/><circle cx="10" cy="26" r="4"/><circle cx="38" cy="26" r="4"/></svg><b>0 Ft</b></span>';
  const price = o.type === 'szallitas' ? `<strong>0 Ft</strong><span class="note">szállítás</span>`
    : o.type === 'ajandek' ? `<strong>${fmt(pl.now)}</strong><span class="note">+ ${fmt(o.companions.reduce((s, c) => s + P(c).priceHuf, 0))} ajándék</span>`
    : `<strong>${fmt(pl.now)}</strong>${pl.was ? `<s>${fmt(pl.was)}</s>` : ''}`;
  return `<div class="eq">${eq}</div><div class="price">${o.storewide ? '<span class="note">minden kellékre</span>' : ''}${price}</div>`;
}
function couponHtml(o) {
  const st = offerState(o.day);
  return `<p class="c-kicker">Mai kupon · ${String(o.day).padStart(2, '0')}. nap</p>
    <h3 class="c-title">${o.title}</h3>
    <p class="c-detail">${o.detail}</p>
    <div class="c-row"><code class="c-code">${o.code}</code>${st.expired ? '<span class="c-exp">Lejárt</span>' : `<button type="button" class="copy" data-code="${o.code}">Másolás</button>`}</div>
    <p class="c-cond">${o.conditions}</p>
    <p class="c-timer" ${st.expired ? 'data-exp="1"' : ''}>${st.expired ? 'Ez a kód lejárt.' : `Csak ma éjfélig · <b class="t">${hms(st.left)}</b>`}</p>`;
}
async function copyCode(e) {
  const btn = e.currentTarget, code = btn.dataset.code; let ok = false;
  try { await navigator.clipboard.writeText(code); ok = true; } catch {
    const ta = document.createElement('textarea'); ta.value = code; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.append(ta); ta.select(); try { ok = document.execCommand('copy'); } catch { ok = false; } ta.remove();
  }
  btn.textContent = ok ? 'Kimásolva ✓' : 'Jelöld ki a kódot'; btn.classList.toggle('done', ok);
  clearTimeout(btn._t); btn._t = setTimeout(() => { btn.textContent = 'Másolás'; btn.classList.remove('done'); }, 2200);
}

/* ---------- felugró: szaggatás ---------- */
const dialog = document.getElementById('reveal'), dough = document.getElementById('cut-dough'), cutter = document.getElementById('cutter'), piece = document.getElementById('piece');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
let cur = 0, pos = { x: .5, y: .5 }, busy = false, lastExpired = false;
function placeCutter() { cutter.style.left = pos.x * 100 + '%'; cutter.style.top = pos.y * 100 + '%'; }
function open(day) {
  cur = day; busy = false;
  const o = offers[day - 1], sh = shapeOf(day);
  document.getElementById('m-day').textContent = `${String(day).padStart(2, '0')}. nap`;
  document.getElementById('cut-title').textContent = `Szaggass ki egy ${sh.name}!`;
  cutter.innerHTML = svg(sh.d, 'steel'); piece.innerHTML = svg(sh.d, 'ck') + svg(sh.d, 'icing') + `<span class="n">${String(day).padStart(2, '0')}</span>`;
  piece.className = 'piece'; cutter.classList.remove('press', 'gone', 'move');
  document.getElementById('cut-marks').innerHTML = '';
  pos = { x: .72, y: .3 }; placeCutter();
  const p = P(day), img = document.getElementById('p-img');
  img.src = p.image; img.alt = o.short;
  document.getElementById('reveal-title').textContent = o.short;
  const [big, small] = badgeText(o), b = document.getElementById('badge');
  b.innerHTML = svg(FLUTED, 'ck') + svg(FLUTED, 'icing') + `<span><strong>${big}</strong><small>${small}</small></span>`;
  b.classList.toggle('gold', day === 24); b.classList.toggle('long', big.length > 4);
  document.getElementById('deal').innerHTML = dealRow(o);
  renderCoupon();
  document.getElementById('p-link').href = p.url;
  const done = isOpened(day);
  document.getElementById('cut-stage').hidden = done;
  document.getElementById('prod-stage').hidden = !done;
  dialog.classList.toggle('revealed', done);
  dialog.showModal();
  (done ? document.getElementById('p-link') : cutter).focus({ preventScroll: true });
  dialog.querySelector('.sheet').scrollTop = 0;
}
function renderCoupon() {
  const o = offers[cur - 1], c = document.getElementById('coupon');
  c.innerHTML = couponHtml(o); lastExpired = offerState(cur).expired;
  c.classList.toggle('expired', lastExpired);
  c.querySelector('.copy')?.addEventListener('click', copyCode);
}
function cut() {
  if (busy) return; busy = true;
  const sh = shapeOf(cur);
  cutter.classList.add('press');
  const T = reduced ? 60 : 1;
  setTimeout(() => {
    // vágásnyom a tésztán + kiemelkedő süti ugyanott
    const r = dough.getBoundingClientRect(), size = cutter.offsetWidth;
    const marks = document.getElementById('cut-marks');
    marks.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
    const s = size / 100, x = pos.x * r.width - size / 2, y = pos.y * r.height - size / 2;
    marks.innerHTML = `<path class="hole" transform="translate(${x} ${y}) scale(${s})" d="${sh.d}"/>`;
    piece.style.left = cutter.style.left; piece.style.top = cutter.style.top; piece.style.width = size + 'px'; piece.style.height = size + 'px';
    cutter.classList.add('gone'); piece.classList.add('lift');
  }, 260 / T);
  setTimeout(() => piece.classList.add('baked'), 700 / T);
  setTimeout(() => {
    markOpened(cur); render();
    document.getElementById('cut-stage').hidden = true;
    document.getElementById('prod-stage').hidden = false;
    dialog.classList.add('revealed');
    dialog.querySelector('.sheet').scrollTop = 0;
    document.getElementById('p-link').focus({ preventScroll: true });
  }, 1450 / T);
}
// húzás / bökés / billentyű
let drag = null;
cutter.addEventListener('pointerdown', e => {
  if (busy) return; e.preventDefault(); e.stopPropagation();
  cutter.setPointerCapture(e.pointerId);
  drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false };
});
cutter.addEventListener('pointermove', e => {
  if (!drag || drag.id !== e.pointerId) return;
  if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 6) drag.moved = true;
  const r = dough.getBoundingClientRect(), half = cutter.offsetWidth / 2;
  pos = { x: Math.min(Math.max(e.clientX - r.left, half), r.width - half) / r.width, y: Math.min(Math.max(e.clientY - r.top, half), r.height - half) / r.height };
  placeCutter();
});
const endDrag = e => { if (!drag || drag.id !== e.pointerId) return; drag = null; cut(); };
cutter.addEventListener('pointerup', endDrag);
cutter.addEventListener('pointercancel', () => { drag = null; });
dough.addEventListener('pointerdown', e => {
  if (busy || e.target.closest('#cutter')) return;
  const r = dough.getBoundingClientRect(), half = cutter.offsetWidth / 2;
  pos = { x: Math.min(Math.max(e.clientX - r.left, half), r.width - half) / r.width, y: Math.min(Math.max(e.clientY - r.top, half), r.height - half) / r.height };
  cutter.classList.add('move'); placeCutter();
  setTimeout(cut, reduced ? 0 : 280);
});
cutter.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cut(); } });
document.getElementById('btn-cut').addEventListener('click', cut);
document.getElementById('close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });

setInterval(() => {
  if (!dialog.open || !cur) return;
  const st = offerState(cur);
  if (st.expired !== lastExpired) { renderCoupon(); return; }
  const t = document.querySelector('#coupon .t'); if (t) t.textContent = hms(st.left);
}, 1000);

/* ---------- bemutató ---------- */
if (isPresenter) {
  const sel = document.getElementById('day-select');
  document.getElementById('presenter').hidden = false;
  for (let i = 1; i <= 24; i++) sel.add(new Option(`${String(i).padStart(2, '0')}. december · ${offers[i - 1].short}`, String(i)));
  sel.value = String(selected);
  sel.addEventListener('change', () => { selected = Number(sel.value); memOpened.clear(); render(); });
}
render();
