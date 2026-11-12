// Admin felület (keretrendszer nélkül). Minden hívás X-Admin fejlécet küld (CSRF-védelem a SameSite süti mellett).
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const NAPNEV = ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat'];
const HONAP = ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];
const TIPUS = {
  szoveg: { nev: 'Szöveges üzenet', ikon: '💬' },
  kep: { nev: 'Kép', ikon: '🖼️' },
  hazi: { nev: 'Mai házi', ikon: '📝' },
  kupon: { nev: 'Kupon', ikon: '🎁' },
  link: { nev: 'Link gomb', ikon: '🔗' },
};
const MAX_BLOKK = 14;
// Az admin a <BASE>/admin/ alatt fut; az app gyökere egy szinttel feljebb van.
const BASE = new URL('..', location.href).pathname;
const ujId = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), b => b.toString(16).padStart(2, '0')).join('');

let S = null;            // szerverállapot (/api/admin/allapot)
let sel = 1;             // kiválasztott nap
let draft = null;        // a kiválasztott nap szerkesztett másolata
let dirty = false;       // napi változás mentetlen
let setDirty = false;    // beállítás-változás mentetlen
let setDraft = null;     // beállítások szerkesztett másolata
let tab = 'napok';

/* ---------- alapok ---------- */
async function api(path, { method = 'GET', body, raw, type } = {}) {
  const headers = { 'X-Admin': '1' };
  if (body) headers['Content-Type'] = 'application/json';
  if (raw) headers['Content-Type'] = type || 'application/octet-stream';
  const r = await fetch(BASE + path.replace(/^\//, ''), { method, credentials: 'same-origin', headers, body: raw || (body ? JSON.stringify(body) : undefined) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== '/api/admin/belepes') { showLogin(); throw new Error('Jelentkezz be újra.'); }
  if (!r.ok) throw Object.assign(new Error(j.hiba || `Hiba (HTTP ${r.status})`), { status: r.status });
  return j;
}
const N = () => S.tartalom.days.length;
const kezdet = () => S.tartalom.profil.kezdet;
const datumPlusz = (iso, k) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + k)); };
const iso = dt => dt.toISOString().slice(0, 10);
const napD = n => datumPlusz(kezdet(), n - 1);
const napIso = n => iso(napD(n));
const napNev = n => { const d = napD(n); return `${HONAP[d.getUTCMonth()]} ${d.getUTCDate()}.`; };
const napRovid = n => { const d = napD(n); return `${HONAP[d.getUTCMonth()].slice(0, 3)}. ${d.getUTCDate()}.`; };
const napDatum = n => `${napNev(n)} (${NAPNEV[napD(n).getUTCDay()]})`;
const teljesDatum = isoStr => huDatum(isoStr);
const huDatum = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[1]}. ${HONAP[m[2] - 1]} ${Number(m[3])}.` : ''; };
const kepSrc = f => (f ? `${BASE}api/kep/${encodeURIComponent(f)}` : '');

let toastT = null;
function toast(txt, { err = false, undo = null } = {}) {
  const t = $('#toast');
  t.className = `on${err ? ' err' : ''}`;
  t.innerHTML = `<span>${esc(txt)}</span>${undo ? '<button type="button" id="undo">Visszavonás</button>' : ''}`;
  if (undo) $('#undo').onclick = () => { t.className = ''; visszaallit(undo, true); };
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.className = ''; }, undo ? 9000 : err ? 7000 : 3000);
}

function showLogin() {
  $('#panel').hidden = true; $('#login').hidden = false; $('#who').innerHTML = '';
  $('#pw').focus();
}
$('#login').addEventListener('submit', async e => {
  e.preventDefault();
  $('#login-msg').textContent = '';
  try {
    await api('/api/admin/belepes', { method: 'POST', body: { jelszo: $('#pw').value } });
    $('#pw').value = '';
    const back = new URLSearchParams(location.search).get('vissza');
    if (back && back.startsWith('/') && !back.startsWith('//')) { location.href = back; return; }
    await start();
  } catch (er) { $('#login-msg').textContent = er.message; }
});

async function frissit() {
  S = await api('/api/admin/allapot');
  if (sel > N()) { sel = N(); dirty = false; }
  if (!dirty) draft = structuredClone(S.tartalom.days[sel - 1]);
}

async function start() {
  try { if (!(await api('/api/admin/munkamenet')).belepve) return showLogin(); await frissit(); } catch { return; }
  $('#login').hidden = true; $('#panel').hidden = false;
  $('#wm').textContent = S.tartalom.profil.wordmark;
  $('#who').innerHTML = `<span id="savestate" class="savestate ok" role="status" aria-live="polite">✓ Minden mentve</span><a href="${BASE}" target="_blank" rel="noopener">Naptár ↗</a><button id="logout" type="button">Kilépés</button>`;
  $('#logout').onclick = async () => { await mindentMent(); if (!elhagyhato()) return; await api('/api/admin/kilepes', { method: 'POST' }).catch(() => {}); showLogin(); };
  if (S.ma >= 1 && S.ma <= N() && !dirty) { sel = S.ma; draft = structuredClone(S.tartalom.days[sel - 1]); }
  renderStatus();
  renderTab();
}

function renderStatus() {
  const p = S.tartalom.profil;
  const ora = p.nyitasOra ? `${p.nyitasOra}:00-kor` : 'éjfélkor';
  const tartam = `${teljesDatum(kezdet())} – ${teljesDatum(napIso(N()))} · ${N()} nap`;
  $('#status').innerHTML = S.ma === 0
    ? `A naptár <b>${teljesDatum(kezdet())} ${ora}</b> indul (${tartam}). Addig a látogatók az „indulás előtt” szöveget és a zárt kártyákat látják.`
    : S.ma > N() ? `A kampány véget ért (${tartam}): minden kártya „elmúlt” állapotú. Új időszakot a Beállítások → Időzítés részben adhatsz meg.`
      : `Ma a <b>${S.ma}. nap</b> (${napNev(S.ma)}) látszik élesben · ${tartam}. Új nap minden ${p.nyitasOra ? `reggel ${ora}` : 'éjfélkor'} nyílik.`;
}

/* ---------- fülek ---------- */
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', async () => {
  if (!(await mindentMent()) && !confirm('Van olyan változás, amit nem sikerült menteni (lásd fent). Elveted?')) return;
  if (dirty) { dirty = false; draft = structuredClone(S.tartalom.days[sel - 1]); }
  setDirty = false; setDraft = null;
  tab = b.dataset.tab;
  renderTab();
}));
function renderTab() {
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  document.querySelectorAll('.tab').forEach(s => { s.hidden = s.id !== `tab-${tab}`; });
  ({ napok: renderNapok, megjelenes: renderMegjelenes, beallitasok: renderBeallitasok, stat: renderStat, mentesek: renderMentesek })[tab]();
}
const elhagyhato = () => !(dirty || setDirty) || confirm('Mentetlen változások vannak. Biztosan kilépsz?');
addEventListener('beforeunload', e => {
  if (dirty || setDirty) { mindentMent(); e.preventDefault(); e.returnValue = ''; }
});
addEventListener('pagehide', () => { mindentMent(); });

/* ---------- automatikus mentés ---------- */
// Minden módosítás ~1 mp szünet után magától mentődik; a mentések sorban mennek (verzióőr miatt).
const KESLELTETES = 1000;
let lanc = Promise.resolve();
const sorba = fn => (lanc = lanc.then(fn, fn));
let napTimer = null; let setTimer = null;
let napSzaml = 0; let setSzaml = 0;
let utolsoHiba = '';
function allapotJel(allapot, szoveg = '') {
  const el = $('#savestate'); if (!el) return;
  el.className = `savestate ${allapot}`;
  el.textContent = allapot === 'ok' ? '✓ Minden mentve' : allapot === 'ment' ? 'Mentés…' : allapot === 'var' ? '● Módosítva…' : `⚠ Nincs mentve: ${szoveg}`;
  el.title = allapot === 'hiba' ? szoveg : '';
}
function napUtemez() { clearTimeout(napTimer); allapotJel('var'); napTimer = setTimeout(() => mentNap({ auto: true }), KESLELTETES); }
function setUtemez() { clearTimeout(setTimer); allapotJel('var'); setTimer = setTimeout(() => mentBeallitas({ auto: true }), KESLELTETES); }
async function mindentMent() {
  const a = dirty ? await mentNap({ auto: true }) : true;
  const b = setDirty ? await mentBeallitas({ auto: true }) : true;
  return a && b;
}

/* ---------- húzható lista (egér + érintés) ---------- */
function sortable(list, onEnd) {
  list.addEventListener('pointerdown', e => {
    const h = e.target.closest('.handle');
    if (!h) return;
    const item = h.closest('[data-sort]');
    if (!item || item.parentElement !== list) return;
    e.preventDefault();
    const from = [...list.children].indexOf(item);
    item.classList.add('dragging'); document.body.classList.add('drag-on');
    // Ablakszintű figyelés: a sor DOM-beli áthelyezése elvenné a pointer capture-t.
    const pid = e.pointerId;
    let scroller = null;
    const move = ev => {
      if (ev.pointerId !== pid) return;
      const y = ev.clientY;
      for (const sib of list.children) {
        if (sib === item) continue;
        const r = sib.getBoundingClientRect();
        if (y < r.top || y > r.bottom) continue;
        const idxS = [...list.children].indexOf(sib); const idxI = [...list.children].indexOf(item);
        if (idxS > idxI && y > r.top + r.height * 0.35) list.insertBefore(item, sib.nextSibling);
        else if (idxS < idxI && y < r.bottom - r.height * 0.35) list.insertBefore(item, sib);
        break;
      }
      clearInterval(scroller); scroller = null;
      const box = list.closest('.daylist');
      const edge = (dir, el) => { scroller = setInterval(() => (el ? el.scrollBy(0, dir) : scrollBy(0, dir)), 16); };
      if (box && box.scrollHeight > box.clientHeight) {
        const r = box.getBoundingClientRect();
        if (y < r.top + 40) edge(-8, box); else if (y > r.bottom - 40) edge(8, box);
      } else if (y < 90) edge(-10); else if (y > innerHeight - 60) edge(10);
    };
    const up = ev => {
      if (ev.pointerId !== pid) return;
      clearInterval(scroller);
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      item.classList.remove('dragging'); document.body.classList.remove('drag-on');
      const to = [...list.children].indexOf(item);
      if (from !== to) onEnd(from, to);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  });
}

/* ---------- NAPOK ---------- */
function napInfo(d) {
  const t = d.blokkok.map(b => b.tipus);
  const db = n => t.filter(x => x === n).length;
  return [`${d.blokkok.length} üzenet`, db('kupon') ? '🎁 kupon' : '', db('kep') ? '🖼️' : '', d.kep ? '📷 napkép' : '', db('link') ? '🔗' : ''].filter(Boolean).join(' · ');
}
function dayRow(d) {
  const st = S.ma > N() || d.day < S.ma ? 'past' : d.day === S.ma ? 'today' : '';
  const nd = d.day === sel && draft ? draft : d;
  return `<li class="drow${d.day === sel ? ' sel' : ''}" data-sort data-day="${d.day}" tabindex="0" aria-label="${d.day}. nap, ${napNev(d.day)}">
    <button class="handle" type="button" aria-label="Húzd a nap áthelyezéséhez" title="Húzd: a nap tartalma másik napra kerül">⠿</button>
    <span class="dn">${pad(d.day)}<small>${napRovid(d.day)} ${NAPNEV[napD(d.day).getUTCDay()].slice(0, 2)}</small></span>
    <span class="dt"><b>${esc(nd.cim || '(cím nélkül)')}</b><span>${st === 'today' ? '<span class="pill today">MA</span> ' : st === 'past' ? '<span class="pill past">lement</span> ' : ''}${d.uj && nd === d ? '<span class="pill warn">kitöltendő</span> ' : ''}${napInfo(nd)}${d.day === sel && dirty ? ' · <b class="dirty">módosítva</b>' : ''}</span></span>
  </li>`;
}

function renderNapok() {
  const el = $('#tab-napok');
  el.innerHTML = `<div class="napok">
    <aside class="card daylist"><div class="lhead"><h2>${N()} nap</h2><small>⠿ húzd a sorrendhez</small></div><ol id="days">${S.tartalom.days.map(dayRow).join('')}</ol></aside>
    <div class="card editor" id="editor"></div>
  </div>`;
  const list = $('#days');
  list.addEventListener('click', e => {
    if (e.target.closest('.handle')) return;
    const r = e.target.closest('.drow'); if (r) valaszt(Number(r.dataset.day));
  });
  list.addEventListener('keydown', e => { const r = e.target.closest('.drow'); if (r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); valaszt(Number(r.dataset.day)); } });
  sortable(list, napAthelyez);
  renderEditor();
  $('#days .sel')?.scrollIntoView({ block: 'nearest' });
}
function frissitLista() {
  const list = $('#days'); if (!list) return;
  const top = list.parentElement.scrollTop;
  list.innerHTML = S.tartalom.days.map(dayRow).join('');
  list.parentElement.scrollTop = top;
}
async function valaszt(n) {
  if (n === sel) return;
  if (dirty && !(await mentNap({ auto: true })) && !confirm(`A ${sel}. nap változásait nem sikerült menteni:\n${utolsoHiba}\n\nElveted őket és továbblépsz?`)) return;
  sel = n; dirty = false; draft = structuredClone(S.tartalom.days[n - 1]);
  frissitLista(); renderEditor();
  if (innerWidth < 860) $('#editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function napAthelyez(from, to) {
  if (dirty && !(await mentNap({ auto: true }))) { toast('Előbb javítsd a mostani nap hibáját (lásd fent), utána rendezhetsz.', { err: true }); frissitLista(); return; }
  const ord = [...$('#days').children].map(li => Number(li.dataset.day));
  const moved = from + 1;
  if (!confirm(`A ${moved}. nap tartalma a ${to + 1}. napra kerül, a köztes napok eggyel ${to > from ? 'előrébb' : 'hátrébb'} csúsznak.\n\nA kuponok beváltási határideje szükség esetén az új naphoz igazodik. Mehet?`)) { frissitLista(); return; }
  try {
    const r = await api('/api/admin/sorrend', { method: 'PUT', body: { verzio: S.tartalom.verzio, sorrend: ord } });
    sel = to + 1;
    await frissit(); draft = structuredClone(S.tartalom.days[sel - 1]);
    renderNapok();
    toast(`Átrendezve: a régi ${moved}. nap most a ${to + 1}. nap (${napNev(to + 1)}).`, { undo: r.mentesId });
  } catch (er) { toast(er.message, { err: true }); await frissit(); renderNapok(); }
}

/* --- egy nap szerkesztése --- */
function mezo(i, k, label, { area = false, max = 0, ph = '', type = 'text', cls = '', hint = '' } = {}) {
  const b = draft.blokkok[i]; const v = b[k] ?? '';
  const id = `f-${i}-${k}`;
  const inp = area
    ? `<textarea id="${id}" data-i="${i}" data-k="${k}" maxlength="${max || 700}" placeholder="${esc(ph)}">${esc(v)}</textarea>`
    : `<input id="${id}" type="${type}" data-i="${i}" data-k="${k}" value="${esc(v)}" ${max ? `maxlength="${max}"` : ''} placeholder="${esc(ph)}" ${type === 'url' ? 'list="gyorslinkek" inputmode="url"' : ''}>`;
  return `<div class="${cls}"><label for="${id}">${label}</label>${inp}${max && area ? `<div class="counter" data-cnt="${id}">${String(v).length}/${max}</div>` : ''}${hint ? `<p class="hint">${hint}</p>` : ''}</div>`;
}
function blokkHtml(b, i) {
  const t = TIPUS[b.tipus];
  const n = draft.blokkok.length;
  let body = '';
  if (b.tipus === 'szoveg') body = mezo(i, 'szoveg', 'Üzenet szövege', { area: true, max: 700, ph: 'Amit Krisz a csetben ír…', hint: '*csillagok közé* írt rész dőlt kiemelés lesz; Enter = új sor.' });
  if (b.tipus === 'hazi') body = mezo(i, 'szoveg', 'A mai házi feladat', { area: true, max: 500, ph: 'Pl. Ma köszönj rá három idegenre…' });
  if (b.tipus === 'link') body = `<div class="f2">${mezo(i, 'felirat', 'Gomb felirata', { max: 90, ph: 'Pl. Foglalj konzultációt' })}${mezo(i, 'url', 'Hova vigyen? (webcím)', { type: 'url', ph: 'https://…', hint: 'Kattints bele, és válassz a mentett linkjeid közül, vagy írj be újat.' })}</div>`;
  if (b.tipus === 'kep') body = `<div class="kepbox">
      ${b.kep ? `<img class="thumb" src="${esc(kepSrc(b.kep))}" alt="">` : '<div class="thumb">Még nincs kép</div>'}
      <div class="f2"><div class="span2"><label class="filebtn">${b.kep ? 'Kép cseréje' : 'Kép feltöltése'}<input type="file" accept="image/jpeg,image/png,image/webp,image/heic" data-act="upload" data-i="${i}"></label><p class="hint">JPG, PNG vagy WEBP. A nagy képet feltöltés előtt automatikusan lekicsinyítjük.</p></div>
      ${mezo(i, 'felirat', 'Felirat a kép alatt (nem kötelező)', { cls: 'span2', max: 300 })}
      ${mezo(i, 'alt', 'Mi látható a képen? (látássérülteknek)', { cls: 'span2', max: 160 })}</div></div>`;
  if (b.tipus === 'kupon') body = `<div class="f3">
      ${mezo(i, 'ertek', 'Kedvezmény (nagy betűvel)', { max: 40, ph: '−2 000 Ft' })}
      ${mezo(i, 'mire', 'Mire szól?', { max: 140, ph: 'workshopjegyre', cls: 'span2' })}
      <div><label for="f-${i}-kod">Kuponkód</label><div class="codebox"><input id="f-${i}-kod" data-i="${i}" data-k="kod" value="${esc(b.kod)}" maxlength="24" autocapitalize="characters"><button type="button" class="icon" data-act="gen" data-i="${i}" title="Új kód generálása">🎲</button></div><p class="hint">Ugyanezt a kódot hozd létre a saját rendszeredben is (GHL / számlázó).</p></div>
      <div><label for="f-${i}-ervenyesIg">Beváltható eddig</label><input id="f-${i}-ervenyesIg" type="date" data-i="${i}" data-k="ervenyesIg" value="${esc(b.ervenyesIg)}" min="${napIso(sel)}" max="${iso(datumPlusz(napIso(sel), 730))}"><p class="hint">${esc(huDatum(b.ervenyesIg))}</p></div>
      ${mezo(i, 'url', 'Beváltás linkje (nem kötelező)', { type: 'url', ph: 'https://…' })}
      ${mezo(i, 'feltetel', 'Feltétel, apró betű (nem kötelező)', { cls: 'span2', max: 260, ph: 'Pl. Egy személy egyszer használhatja.' })}
    </div>`;
  const opts = Array.from({ length: N() }, (_, k) => k + 1).filter(k => k !== sel).map(k => `<option value="${k}">${k}. napra (${napRovid(k)})</option>`).join('');
  return `<li class="blk" data-sort data-t="${b.tipus}" data-i="${i}">
    <button class="handle" type="button" aria-label="Húzd a sorrend módosításához" title="Húzd a sorrendhez">⠿</button>
    <div><div class="bh"><b><span class="no">${i + 1}.</span>${t.ikon} ${t.nev}</b>
      <span class="tools">
        <button type="button" class="icon" data-act="up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Feljebb">↑</button>
        <button type="button" class="icon" data-act="down" data-i="${i}" ${i === n - 1 ? 'disabled' : ''} aria-label="Lejjebb">↓</button>
        <button type="button" class="icon" data-act="dup" data-i="${i}" ${n >= MAX_BLOKK ? 'disabled' : ''} title="Másolat">⧉</button>
        <select data-act="move" data-i="${i}" aria-label="Áthelyezés másik napra" ${n < 2 ? 'disabled' : ''}><option value="">Áthelyezés…</option>${opts}</select>
        <button type="button" class="icon danger" data-act="del" data-i="${i}" ${n < 2 ? 'disabled' : ''} aria-label="Törlés">🗑</button>
      </span></div>${body}</div>
  </li>`;
}
function renderEditor() {
  const el = $('#editor'); if (!el) return;
  const d = draft;
  const st = S.ma > N() || sel < S.ma ? 'past' : sel === S.ma ? 'today' : 'future';
  const gy = S.tartalom.profil.gyorsLinkek || [];
  el.innerHTML = `
    <div class="edhead"><h2>${sel}. nap <small style="font-weight:500;color:var(--mut)">${napDatum(sel)}</small></h2>
      <span class="acts"><span class="hint autohint">A változások maguktól mentődnek.</span>
        <button type="button" class="ghost" data-act="preview">👁 Előnézet</button>
        <button type="button" data-act="save" ${dirty ? '' : 'disabled'}>Mentés most</button></span></div>
    ${st === 'today' ? '<p class="note">Ez a <b>mai nap</b>: minden változás pár másodpercen belül élesben látszik.</p>' : st === 'past' ? '<p class="note info">Ez a nap már lement, a látogatók nem látják újra. A változás csak archív.</p>' : ''}
    ${draft.uj ? '<p class="note">Ez egy <b>új, még kitöltendő nap</b>. Írd át a címét és az üzenetét – amíg ezt nem teszed, a látogatók az „Ide jön a mai üzenet.” szöveget látnák.</p>' : ''}
    <div><label for="cim">A nap címe (a kártyán és a cset tetején)</label><input id="cim" data-k="cim" value="${esc(d.cim)}" maxlength="90"></div>
    <div class="napkep-row"><img src="${esc(kepSrc(d.kep || S.tartalom.profil.avatar))}" alt="A nap képe">
      <span><b>A nap képe</b> <span class="hint">${d.kep ? 'saját kép erre a napra' : 'most a profilkép látszik (alapértelmezés)'} – ez van a mai kártyán és a jobbra húzós kártyán.</span>
      <span class="napkep-acts"><label class="filebtn">${d.kep ? 'Kép cseréje' : 'Saját kép feltöltése'}<input type="file" accept="image/*" data-act="napkep"></label>${d.kep ? '<button type="button" class="ghost sm" data-act="napkep-del">Vissza a profilképre</button>' : ''}</span></span></div>
    <p class="hint" style="margin-top:12px">Az üzenetek ebben a sorrendben, egymás után „gépelve” jelennek meg. Fogd meg a ⠿ jelet és húzd, vagy használd a ↑ ↓ gombokat.</p>
    <ol class="blocks" id="blocks">${d.blokkok.map(blokkHtml).join('')}</ol>
    <div class="add"><span>+ Új üzenet:</span>${Object.entries(TIPUS).map(([k, t]) => `<button type="button" class="sm" data-act="add" data-t="${k}" ${d.blokkok.length >= MAX_BLOKK ? 'disabled' : ''}>${t.ikon} ${t.nev}</button>`).join('')}</div>
    <datalist id="gyorslinkek">${gy.map(l => `<option value="${esc(l.url)}">${esc(l.felirat)}</option>`).join('')}</datalist>`;
  sortable($('#blocks'), (from, to) => { const [b] = draft.blokkok.splice(from, 1); draft.blokkok.splice(to, 0, b); valtozott(true); });
}
function valtozott(ujra = false) {
  if (!dirty) { dirty = true; }
  napSzaml++;
  if (ujra) renderEditor();
  else { const sb = document.querySelector('#editor [data-act="save"]'); if (sb) sb.disabled = false; }
  frissitLista();
  napUtemez();
}

document.addEventListener('input', e => {
  const t = e.target;
  if (!t.closest('#editor')) return;
  if (t.dataset.k === 'cim' && !t.dataset.i) { draft.cim = t.value; valtozott(); return; }
  if (t.dataset.i === undefined || !t.dataset.k) return;
  const b = draft.blokkok[Number(t.dataset.i)];
  b[t.dataset.k] = t.dataset.k === 'kod' ? t.value.toUpperCase().replace(/[^A-Z0-9]/g, '') : t.value;
  if (t.dataset.k === 'kod' && t.value !== b.kod) { const p = t.selectionStart; t.value = b.kod; t.setSelectionRange(p, p); }
  const cnt = document.querySelector(`[data-cnt="${t.id}"]`); if (cnt) cnt.textContent = `${t.value.length}/${t.maxLength}`;
  // Gépelés közben nem rajzolunk újra és nem nyúlunk a kurzorhoz (mondat közbeni javítás is menjen).
  // Csak a dátummező rajzolja újra a szerkesztőt; akkor a fókuszt visszaadjuk.
  const ujra = t.dataset.k === 'ervenyesIg';
  valtozott(ujra);
  if (ujra) document.getElementById(t.id)?.focus({ preventScroll: true });
});

function kodGen() {
  const nev = (S.tartalom.profil.becenev || 'KOD').toUpperCase().normalize('NFD').replace(/[^A-Z]/g, '').slice(0, 6) || 'KOD';
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const r = Array.from(crypto.getRandomValues(new Uint8Array(3)), x => abc[x % abc.length]).join('');
  return `${nev}${pad(sel)}${r}`;
}
function ujBlokk(t) {
  const id = ujId();
  if (t === 'szoveg' || t === 'hazi') return { id, tipus: t, szoveg: '' };
  if (t === 'kep') return { id, tipus: 'kep', kep: '', alt: '', felirat: '' };
  if (t === 'link') return { id, tipus: 'link', felirat: '', url: '' };
  const alap = iso(datumPlusz(napIso(N()), 38));
  return { id, tipus: 'kupon', ertek: '', mire: '', kod: kodGen(), feltetel: '', ervenyesIg: alap < napIso(sel) ? napIso(sel) : alap, url: '' };
}

document.addEventListener('click', async e => {
  const b = e.target.closest('#editor [data-act]');
  if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
  const i = Number(b.dataset.i);
  const act = b.dataset.act;
  if (act === 'up' || act === 'down') {
    const j = act === 'up' ? i - 1 : i + 1;
    [draft.blokkok[i], draft.blokkok[j]] = [draft.blokkok[j], draft.blokkok[i]];
    valtozott(true);
    document.querySelector(`#blocks [data-act="${act}"][data-i="${j}"]`)?.focus();
  }
  if (act === 'del') {
    const bl = draft.blokkok[i];
    const ures = !(bl.szoveg || bl.felirat || bl.kep || bl.ertek || bl.mire);
    if (!ures && !confirm(`Törlöd ezt: ${TIPUS[bl.tipus].nev}? (A Mentések fülről visszahozható.)`)) return;
    draft.blokkok.splice(i, 1); valtozott(true);
  }
  if (act === 'dup') { draft.blokkok.splice(i + 1, 0, { ...structuredClone(draft.blokkok[i]), id: ujId(), ...(draft.blokkok[i].tipus === 'kupon' ? { kod: kodGen() } : {}) }); valtozott(true); }
  if (act === 'gen') { draft.blokkok[i].kod = kodGen(); valtozott(true); }
  if (act === 'add') {
    draft.blokkok.push(ujBlokk(b.dataset.t)); valtozott(true);
    const last = document.querySelector('#blocks > li:last-child');
    last?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (b.dataset.t === 'kep') last?.querySelector('input[type=file]')?.click();
    else last?.querySelector('textarea, input:not([type=file])')?.focus({ preventScroll: true });
  }
  if (act === 'napkep-del') { delete draft.kep; valtozott(true); return; }
  if (act === 'save') await mentNap();
  if (act === 'preview') {
    if (dirty && !(await mentNap({ auto: true }))) { toast(`Előbb javítsd: ${utolsoHiba}`, { err: true }); return; }
    elonezet(sel);
  }
});
document.addEventListener('change', async e => {
  const t = e.target;
  if (t.dataset.act === 'move') {
    const hova = Number(t.value); if (!hova) return;
    const i = Number(t.dataset.i); const bl = draft.blokkok[i];
    if (!confirm(`Áthelyezed ezt (${TIPUS[bl.tipus].nev}) a ${hova}. nap végére?`)) { t.value = ''; return; }
    if (dirty && !(await mentNap({ auto: true }))) { toast(utolsoHiba, { err: true }); t.value = ''; return; }
    try {
      const r = await api('/api/admin/athelyez', { method: 'POST', body: { verzio: S.tartalom.verzio, honnan: sel, hova, id: bl.id } });
      await frissit(); draft = structuredClone(S.tartalom.days[sel - 1]);
      renderNapok();
      toast(`Áthelyezve a ${hova}. napra.`, { undo: r.mentesId });
    } catch (er) { toast(er.message, { err: true }); t.value = ''; }
  }
  if (t.dataset.act === 'napkep' && t.closest('#editor') && t.files[0]) {
    try { toast('Kép feltöltése…'); draft.kep = (await feltolt(t.files[0])).kep; valtozott(true); toast('Napkép feltöltve.'); } catch (er) { toast(er.message, { err: true }); }
    return;
  }
  if (t.dataset.act === 'upload' && t.files[0]) {
    const i = Number(t.dataset.i);
    try {
      toast('Kép feltöltése…');
      const k = await feltolt(t.files[0]);
      Object.assign(draft.blokkok[i], { kep: k.kep, w: k.w, h: k.h }); valtozott(true);
      toast('Kép feltöltve.');
    } catch (er) { toast(er.message, { err: true }); }
  }
});

function mentNap({ auto = false } = {}) {
  clearTimeout(napTimer);
  return sorba(async () => {
    if (!dirty) return true;
    const n = sel; const szaml = napSzaml;
    allapotJel('ment');
    try {
      const r = await api(`/api/admin/nap/${n}`, { method: 'PUT', body: { verzio: S.tartalom.verzio, auto, cim: draft.cim, kep: draft.kep || '', blokkok: draft.blokkok } });
      S.tartalom.days[n - 1] = r.nap; S.tartalom.verzio = r.verzio;
      utolsoHiba = '';
      if (sel === n && napSzaml === szaml) {
        dirty = false;
        delete draft.uj;
        // a szerver által adott azonosítókat átvesszük, a gépelt szöveget nem írjuk felül (a kurzor maradjon)
        r.nap.blokkok.forEach((b, i) => { if (draft.blokkok[i]) draft.blokkok[i].id = b.id; });
        if (!auto) { draft = structuredClone(r.nap); renderEditor(); }
        const sb = document.querySelector('#editor [data-act="save"]'); if (sb) sb.disabled = true;
      }
      allapotJel(dirty || setDirty ? 'var' : 'ok');
      frissitLista();
      if (!auto) toast(`${n}. nap (${napNev(n)}) mentve.`, { undo: r.mentesId });
      return true;
    } catch (er) {
      utolsoHiba = er.message;
      allapotJel('hiba', er.message);
      if (!auto) toast(er.message, { err: true });
      return false;
    }
  });
}

/* ---------- képfeltöltés: kicsinyítés a böngészőben ---------- */
async function feltolt(file) {
  if (file.size > 25 * 1024 * 1024) throw new Error('A kép túl nagy (max. 25 MB).');
  let blob = file;
  let tipus = file.type;
  let meret = {};
  try {
    const bmp = await createImageBitmap(file);
    const max = 1600;
    const sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
    meret = { w: Math.round(bmp.width * sc), h: Math.round(bmp.height * sc) };
    if (sc < 1 || file.size > 900 * 1024 || !/^image\/(jpeg|png|webp)$/.test(file.type)) {
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.86));
      tipus = 'image/jpeg';
    }
  } catch { if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Ezt a képformátumot nem tudjuk feldolgozni. JPG-t vagy PNG-t tölts fel.'); }
  const r = await api('/api/admin/kep', { method: 'POST', raw: blob, type: tipus });
  return { kep: r.kep, ...meret };
}

/* ---------- előnézet ---------- */
function elonezet(n) {
  const url = `${BASE}?elonezet=${n}`;
  $('#pv-title').textContent = `Előnézet · ${n}. nap (${napNev(n)})`;
  $('#pv-open').href = url;
  $('#pv-frame').src = url;
  $('#preview').showModal();
}
$('#pv-close').onclick = () => { $('#preview').close(); $('#pv-frame').src = 'about:blank'; };

/* ---------- BEÁLLÍTÁSOK és MEGJELENÉS (közös vázlat, közös mentés) ---------- */
const SZOVEGEK_NAPTAR = [
  ['gridCim', 'A naptár címe', 60, false, ''],
  ['gridAlcim', 'A naptár alcíme (útmutató)', 120, false, 'Üresen hagyva nem jelenik meg.'],
  ['match', 'Felirat a „Match!” alatt', 60, false, ''],
  ['elotte', 'Szöveg az indulás előtt', 300, true, 'Amíg nem indul a naptár, ez áll a visszaszámláló helyén.'],
  ['vege', 'Szöveg az utolsó nap után', 300, true, ''],
  ['kuponLabjegyzet', 'Megjegyzés a kupon alján', 120, false, 'Üresen hagyva nem jelenik meg.'],
];
const SZIN_NEV = { hatter1: 'Háttér (fent)', hatter2: 'Háttér (lent)', kiemeles: 'Kiemelés, gombok', masodik: 'Második kiemelés (arany)', szoveg: 'Szöveg' };
const TEMAK = [
  ['Eredeti (éjkék)', { hatter1: '#0a1629', hatter2: '#1e1322', kiemeles: '#bd8a7a', masodik: '#c9a84c', szoveg: '#f5ebe8' }],
  ['Bordó', { hatter1: '#2a0d14', hatter2: '#14080c', kiemeles: '#d08770', masodik: '#e0b354', szoveg: '#f7ece6' }],
  ['Erdő', { hatter1: '#0e1f1a', hatter2: '#08130f', kiemeles: '#c9a27a', masodik: '#d6b25e', szoveg: '#f1ece2' }],
  ['Grafit', { hatter1: '#1b1c21', hatter2: '#0c0c0f', kiemeles: '#e0a96d', masodik: '#c9a84c', szoveg: '#f2f0ec' }],
  ['Világos', { hatter1: '#f6efe9', hatter2: '#ead9cf', kiemeles: '#9c4f42', masodik: '#8a6a1f', szoveg: '#2a1b22' }],
];
const GHL_RE = /https:\/\/[^\s"'<>]+\/widget\/(?:survey|form|booking|quiz)\/[A-Za-z0-9_-]{6,64}[^\s"'<>]*/;
const ghlFelismer = kod => { const m = GHL_RE.exec(String(kod || '').replace(/&amp;/g, '&')); if (!m) return ''; try { const u = new URL(m[0]); return /(^|\.)(leadconnectorhq\.com|msgsndr\.com)$/.test(u.hostname) ? u.href : ''; } catch { return ''; } };

function setDraftKell() {
  if (!setDraft) {
    setDraft = structuredClone({ profil: S.tartalom.profil, feliratkozas: S.tartalom.feliratkozas });
    setDraft.profil.napokSzama = N();
    setDraft.feliratkozas.ghlKod = setDraft.feliratkozas.ghlUrl || '';
  }
  return setDraft;
}
const getPath = path => path.split('.').reduce((o, k) => o?.[k], setDraft);
function inp(path, label, { max = 120, type = 'text', hint = '', area = false, ph = '', list = '' } = {}) {
  const v = getPath(path) ?? '';
  const id = `s-${path.replace(/\./g, '-')}`;
  return `<div><label for="${id}">${label}</label>${area ? `<textarea id="${id}" data-s="${path}" maxlength="${max}" placeholder="${esc(ph)}">${esc(v)}</textarea>` : `<input id="${id}" type="${type}" data-s="${path}" value="${esc(v)}" maxlength="${max}" placeholder="${esc(ph)}" ${list ? `list="${list}"` : ''}>`}${hint ? `<p class="hint">${hint}</p>` : ''}</div>`;
}
function linkSorok(kulcs, lista) {
  return `<ol class="lnk" data-lista="${kulcs}" style="list-style:none;margin:0;padding:0">${lista.map((l, i) => `<li class="linkrow" data-sort>
    <button class="handle" type="button" aria-label="Húzd">⠿</button>
    <input data-l="${kulcs}" data-li="${i}" data-lk="felirat" value="${esc(l.felirat)}" placeholder="Felirat" maxlength="60">
    <input class="u" data-l="${kulcs}" data-li="${i}" data-lk="url" value="${esc(l.url)}" placeholder="https://…" inputmode="url">
    <button type="button" class="icon danger" data-sact="ldel" data-l="${kulcs}" data-li="${i}" aria-label="Törlés">🗑</button></li>`).join('')}</ol>
    <button type="button" class="ghost sm" data-sact="ladd" data-l="${kulcs}">+ Link hozzáadása</button>`;
}
const savebar = () => `<div class="savebar"><span class="hint">A változások maguktól mentődnek, és pár másodpercen belül élesben látszanak.</span><button type="button" data-sact="save" ${setDirty ? '' : 'disabled'}>Mentés most</button></div>`;

/* --- Megjelenés: főoldal teteje, színek, naptár szövegei, alsó gomb, lábléc + élő előnézet --- */
function renderMegjelenes() {
  setDraftKell();
  const p = setDraft.profil; const h = p.hero;
  const gy = p.gyorsLinkek || [];
  const urlap = `
    <fieldset><legend>Főoldal teteje (hero)</legend>
      <div class="f2">
        <div class="span2">${inp('profil.szovegek.kicker', 'Kis felirat a főcím fölött', { max: 80, hint: 'Üresen hagyva nem jelenik meg.' })}</div>
        <div class="span2">${inp('profil.szovegek.cim', 'Főcím', { max: 120, area: true, hint: '*csillagok közé* írt rész kiemelt színű, dőlt; Enter = új sor.' })}</div>
        <div class="span2">${inp('profil.szovegek.lead', 'Bevezető szöveg', { max: 300, area: true })}</div>
        ${inp('profil.szovegek.heroGomb', 'Gomb felirata', { max: 40, hint: 'A gomb egy koppintással megnyitja a mai üzenetet. Üresen hagyva nincs gomb.' })}
      </div>
      <div><h3>Címkék a cím alatt</h3><p class="hint">Rövid kiemelések, pl. „📅 December 1–24.”, „🎁 4 ajándéknap”. Az elejére tehetsz emojit ikonnak.</p>
        <ol class="lnk" id="cimkek" style="list-style:none;margin:0;padding:0">${h.cimkek.map((c, i) => `<li class="linkrow chiprow" data-sort>
          <button class="handle" type="button" aria-label="Húzd">⠿</button>
          <input data-cimke="${i}" value="${esc(c.szoveg)}" maxlength="50" placeholder="📅 December 1–24.">
          <button type="button" class="icon danger" data-sact="cdel" data-ci="${i}" aria-label="Címke törlése">🗑</button></li>`).join('')}</ol>
        ${h.cimkek.length < 6 ? '<button type="button" class="ghost sm" data-sact="cadd">+ Címke hozzáadása</button>' : ''}</div>
      <div><h3>Háttérkép</h3>
        <div class="herokep">${h.kep ? `<img src="${esc(kepSrc(h.kep))}" alt="" style="object-position:center ${h.fokusz}%">` : '<div class="nincs">Nincs háttérkép – a sima háttérszín látszik.</div>'}
          <span class="napkep-acts"><label class="filebtn">${h.kep ? 'Kép cseréje' : 'Háttérkép feltöltése'}<input type="file" accept="image/*" data-sact="herokep"></label>${h.kep ? '<button type="button" class="ghost sm" data-sact="herokep-del">Kép eltávolítása</button>' : ''}</span></div>
        ${h.kep ? `<div><label for="s-fokusz">Melyik része látsszon? (fent ↔ lent)</label><input id="s-fokusz" type="range" min="0" max="100" step="5" data-s="profil.hero.fokusz" value="${h.fokusz}"></div>` : ''}
        <p class="hint">Fekvő, legalább 1600 px széles fotó a legjobb. Alul automatikusan elsötétül, hogy a szöveg olvasható maradjon.</p></div>
    </fieldset>
    <fieldset><legend>Színek</legend>
      <div class="temak">${TEMAK.map(([nev, t], i) => `<button type="button" class="tema" data-sact="tema" data-ti="${i}" title="${esc(nev)}"><span style="background:linear-gradient(135deg, ${t.hatter1} 0 50%, ${t.hatter2} 50%)"><i style="background:${t.kiemeles}"></i><i style="background:${t.masodik}"></i></span>${esc(nev)}</button>`).join('')}</div>
      <div class="szinek">${Object.entries(SZIN_NEV).map(([k, nev]) => `<label class="szin"><input type="color" data-s="profil.szinek.${k}" value="${esc(p.szinek[k])}"><span>${nev}</span></label>`).join('')}</div>
      <label class="chk"><input type="checkbox" data-s="profil.fenyfuzer" ${p.fenyfuzer ? 'checked' : ''}> Karácsonyi fényfüzér a fejléc alatt</label>
    </fieldset>
    <fieldset><legend>Gomb az oldal alján (átirányítás)</legend>
      <label class="chk"><input type="checkbox" data-s="profil.alsoGomb.aktiv" ${p.alsoGomb.aktiv ? 'checked' : ''}> Megjelenik a naptár alatt</label>
      <div class="f2">${inp('profil.alsoGomb.cim', 'Cím', { max: 90 })}${inp('profil.alsoGomb.felirat', 'Gomb felirata', { max: 40, ph: 'Konzultációt foglalok' })}
        <div class="span2">${inp('profil.alsoGomb.szoveg', 'Szöveg', { max: 300, area: true })}</div>
        <div class="span2">${inp('profil.alsoGomb.url', 'Hova vigyen? (webcím)', { max: 600, type: 'url', list: 'gyorslinkek-s', hint: 'Kattints bele, és válassz a mentett linkjeid közül, vagy írj be újat.' })}</div></div>
      <datalist id="gyorslinkek-s">${gy.map(l => `<option value="${esc(l.url)}">${esc(l.felirat)}</option>`).join('')}</datalist>
    </fieldset>
    <fieldset><legend>A naptár szövegei</legend><div class="f2">${SZOVEGEK_NAPTAR.map(([k, l, max, area, hint]) => `<div class="${area ? 'span2' : ''}">${inp(`profil.szovegek.${k}`, l, { max, area, hint })}</div>`).join('')}</div></fieldset>
    <fieldset><legend>Lábléc</legend>${inp('profil.szovegek.lablec', 'Lábléc szövege', { max: 160 })}<div><h3>Linkek a láblécben</h3>${linkSorok('lablecLinkek', p.lablecLinkek)}</div></fieldset>
    ${savebar()}`;
  // Újrarajzoláskor csak az űrlap cserélődik, az előnézet-iframe marad (nem tölt újra).
  const form = $('#megj-form');
  if (form) form.innerHTML = urlap;
  else {
    $('#tab-megjelenes').innerHTML = `<div class="megj"><div class="set" id="megj-form">${urlap}</div>
     <aside class="elo-oszlop"><div class="elo-fej"><b>Élő előnézet</b><span class="hint">gépelés közben frissül, mentés nélkül is</span></div>
       <div class="phone"><iframe id="elo-frame" title="Élő előnézet" src="${BASE}?elonezet=${S.ma >= 1 && S.ma <= N() ? S.ma : 1}"></iframe></div></aside>
     <button type="button" class="elo-mobil" data-sact="elo-mobil">👁 Előnézet</button></div>`;
  }
  sortable($('#cimkek'), (from, to) => { const l = setDraft.profil.hero.cimkek; const [x] = l.splice(from, 1); l.splice(to, 0, x); sDirty(true); });
  document.querySelectorAll('#tab-megjelenes ol.lnk[data-lista]').forEach(ol => sortable(ol, (from, to) => {
    const l = setDraft.profil[ol.dataset.lista]; const [x] = l.splice(from, 1); l.splice(to, 0, x); sDirty(true);
  }));
}

/* --- Élő előnézet: a vázlatot postMessage-dzsel küldjük a naptár-iframe-be (mentés nélkül is látszik) --- */
function eloAdat() {
  const p = structuredClone(setDraft.profil); const f = setDraft.feliratkozas;
  p.avatar = kepSrc(p.avatar);
  p.hero.kep = p.hero.kep ? kepSrc(p.hero.kep) : '';
  p.hero.cimkek = p.hero.cimkek.filter(c => c.szoveg.trim());
  const ghl = ghlFelismer(f.ghlKod);
  const fel = !f.aktiv ? { aktiv: false } : f.mod === 'ghl' ? { aktiv: !!ghl, mod: 'ghl', cim: f.cim, szoveg: f.szoveg, ghlUrl: ghl } : { ...f, mod: 'sajat' };
  return { tipus: 'wk-elonezet', profil: p, feliratkozas: fel };
}
let eloT = null;
function eloKuld() {
  clearTimeout(eloT);
  eloT = setTimeout(() => {
    if (!setDraft) return;
    for (const fr of [$('#elo-frame'), $('#pv-frame')]) { try { fr?.contentWindow?.postMessage(eloAdat(), location.origin); } catch { /* még tölt */ } }
  }, 120);
}
addEventListener('message', e => { if (e.origin === location.origin && e.data?.tipus === 'wk-kesz' && setDraft) eloKuld(); });

/* --- Beállítások: profil, időzítés, linkek, feliratkozás --- */
function renderBeallitasok() {
  setDraftKell();
  const p = setDraft.profil; const f = setDraft.feliratkozas;
  const vege = iso(datumPlusz(p.kezdet, Number(p.napokSzama) - 1));
  // gyorsgombok a mai dátumhoz: advent idén (dec. 24. után jövőre), egész év a következő január 1-jétől
  const ma0 = new Date();
  const adventEv = ma0.getMonth() === 11 && ma0.getDate() > 24 ? ma0.getFullYear() + 1 : ma0.getFullYear();
  const ghl = ghlFelismer(f.ghlKod);
  $('#tab-beallitasok').innerHTML = `<div class="set">
    <fieldset><legend>Időzítés</legend>
      <div class="f3">
        <div><label for="s-kezdet">Első nap dátuma</label><input id="s-kezdet" type="date" data-sc="kezdet" value="${esc(p.kezdet)}" min="2025-01-01" max="2035-12-31"></div>
        <div><label for="s-napok">Hány napos a naptár?</label><input id="s-napok" type="number" data-sc="napok" value="${esc(p.napokSzama)}" min="1" max="366" inputmode="numeric"></div>
        <div><label>Utolsó nap</label><p class="kalk"><b>${esc(huDatum(vege))}</b></p></div>
      </div>
      <div class="row"><span class="hint">Gyors beállítás:</span>
        <button type="button" class="ghost sm" data-sact="idoszak" data-k="${adventEv}-12-01" data-n="24">Advent ${adventEv} (dec. 1–24.)</button>
        <button type="button" class="ghost sm" data-sact="idoszak" data-k="" data-n="30">30 nap holnaptól</button>
        <button type="button" class="ghost sm" data-sact="idoszak" data-k="${ma0.getFullYear() + 1}-01-01" data-n="365">Egész év ${ma0.getFullYear() + 1} (365 nap)</button></div>
      <p class="hint">Ha növeled a napok számát, az új napok a lista végére kerülnek „kitöltendő” jelöléssel. Ha csökkented, a végéről elhagyott napok a Mentések fülről visszahozhatók.</p>
      <div class="f2">
        <div><label for="s-ora">Napi nyitás időpontja</label><select id="s-ora" data-s="profil.nyitasOra">${Array.from({ length: 13 }, (_, h) => `<option value="${h}" ${h === p.nyitasOra ? 'selected' : ''}>${h === 0 ? 'éjfél (0:00)' : `${h}:00`}</option>`).join('')}</select><p class="hint">Ekkor nyílik az aznapi üzenet, és a következő nyitásig olvasható.</p></div>
        <div><label for="s-tempo">Gépelés tempója a csetben</label><select id="s-tempo" data-s="profil.tempo">${[['lassu', 'Lassú'], ['normal', 'Normál'], ['gyors', 'Gyors']].map(([k, n]) => `<option value="${k}" ${k === p.tempo ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      </div>
    </fieldset>
    <fieldset><legend>Profil és márka</legend>
      <div class="avatar-row"><img src="${esc(kepSrc(p.avatar))}" alt="Profilkép"><label class="filebtn">Profilkép cseréje<input type="file" accept="image/*" data-sact="avatar"></label></div>
      <div class="f2">${inp('profil.nev', 'Teljes név', { max: 80 })}${inp('profil.becenev', 'Becenév (a csetben)', { max: 30 })}
      ${inp('profil.titulus', 'Titulus', { max: 60 })}${inp('profil.wordmark', 'Szöveges logó', { max: 30 })}
      ${inp('profil.web', 'Weboldal (a logó ide visz)', { max: 600, type: 'url' })}</div>
    </fieldset>
    <fieldset><legend>Linkek</legend>
      <div class="f2">${inp('profil.kovetes.felirat', 'Követés gomb felirata (jobb felső sarok)', { max: 40 })}${inp('profil.kovetes.url', 'Követés gomb linkje', { max: 600, type: 'url' })}</div>
      <div><h3>Mentett linkek</h3><p class="hint">A napok link gombjainál és az alsó gombnál ezek közül lehet gyorsan választani.</p>${linkSorok('gyorsLinkek', p.gyorsLinkek)}</div>
    </fieldset>
    <fieldset><legend>E-mail-feliratkozás</legend>
      <label class="chk"><input type="checkbox" data-s="feliratkozas.aktiv" ${f.aktiv ? 'checked' : ''}> Feliratkozó doboz megjelenítése a naptár alatt</label>
      <div class="modok">
        <label class="mod"><input type="radio" name="fmod" data-s="feliratkozas.mod" value="ghl" ${f.mod === 'ghl' ? 'checked' : ''}><span><b>GoHighLevel-űrlap</b><small>A saját GHL-űrlapodat illeszted be. A címek egyenesen a GHL-be kerülnek.</small></span></label>
        <label class="mod"><input type="radio" name="fmod" data-s="feliratkozas.mod" value="sajat" ${f.mod !== 'ghl' ? 'checked' : ''}><span><b>Beépített űrlap</b><small>E-mail-mező két jelölőnégyzettel; a címek innen CSV-ben letölthetők.</small></span></label>
      </div>
      <div class="f2">${inp('feliratkozas.cim', 'Doboz címe', { max: 90 })}<div></div>
        <div class="span2">${inp('feliratkozas.szoveg', 'Doboz szövege', { max: 300, area: true })}</div></div>
      ${f.mod === 'ghl' ? `<div><label for="s-feliratkozas-ghlKod">GoHighLevel beágyazókód</label>
        <textarea id="s-feliratkozas-ghlKod" data-s="feliratkozas.ghlKod" class="kod" maxlength="3000" placeholder='<iframe src="https://api.leadconnectorhq.com/widget/survey/…'>${esc(f.ghlKod)}</textarea>
        <p class="hint">${ghl ? `✅ Felismert űrlap: <code>${esc(ghl.replace(/^https:\/\//, '').slice(0, 70))}</code>` : f.ghlKod ? '⚠️ Ebben nem találtunk GHL-űrlapot. A GHL-ben: Sites → Forms/Surveys → Integrate → „Embed” kód, azt másold be egészben.' : 'A GHL-ben: Sites → Forms/Surveys → Integrate → másold ki az „Embed” kódot, és illeszd be ide egészben. Csere: töröld ki, és illeszd be az újat.'}</p></div>`
    : `<p class="hint">${S.ghl ? '✅ A hírlevélre feliratkozók automatikusan bekerülnek a GoHighLevel-be.' : 'ℹ️ A címeket itt gyűjtjük, a Statisztika fülről letölthetők CSV-ben.'} Bekapcsolás előtt add meg az adatkezelési tájékoztató linkjét.</p>
      <div class="f2">${inp('feliratkozas.gomb', 'Gomb felirata', { max: 30 })}${inp('feliratkozas.koszono', 'Köszönő üzenet', { max: 160 })}
      ${inp('feliratkozas.reszvetelSzoveg', 'Kötelező jelölőnégyzet szövege', { max: 200 })}${inp('feliratkozas.reszvetelUrl', 'Részvételi feltételek linkje', { max: 600, type: 'url' })}
      ${inp('feliratkozas.hirlevelSzoveg', 'Hírlevél-jelölőnégyzet szövege', { max: 200 })}${inp('feliratkozas.adatkezelesUrl', 'Adatkezelési tájékoztató linkje', { max: 600, type: 'url' })}</div>`}
    </fieldset>
    ${savebar()}
  </div>`;
  document.querySelectorAll('#tab-beallitasok ol.lnk').forEach(ol => sortable(ol, (from, to) => {
    const l = setDraft.profil[ol.dataset.lista]; const [x] = l.splice(from, 1); l.splice(to, 0, x); sDirty(true);
  }));
}
const setTab = () => (tab === 'megjelenes' ? renderMegjelenes : renderBeallitasok);
function sDirty(ujra = false) {
  setDirty = true; setSzaml++;
  if (ujra) {
    const ae = document.activeElement; const a = ae?.id; const y = scrollY;
    let s0 = null; let s1 = null; try { s0 = ae?.selectionStart; s1 = ae?.selectionEnd; } catch { /* nem szövegmező */ }
    setTab()();
    scrollTo(0, y);
    const n = a && document.getElementById(a);
    if (n) { n.focus({ preventScroll: true }); if (s0 != null) try { n.setSelectionRange(s0, s1); } catch { /* nem szövegmező */ } }
  } else { document.querySelectorAll('[data-sact="save"]').forEach(b => { b.disabled = false; }); }
  eloKuld();
  setUtemez();
}
const setPath = (o, path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((x, k) => x[k], o)[last] = v; };
document.addEventListener('input', e => {
  const t = e.target;
  if (!t.closest('#tab-beallitasok, #tab-megjelenes')) return;
  if (t.dataset.s) {
    let v = t.type === 'checkbox' ? t.checked : t.value;
    if (t.dataset.s === 'profil.nyitasOra' || t.dataset.s === 'profil.hero.fokusz') v = Number(v);
    setPath(setDraft, t.dataset.s, v);
    if (t.dataset.s === 'profil.hero.fokusz') { const im = $('.herokep img'); if (im) im.style.objectPosition = `center ${v}%`; }
    sDirty(t.type === 'checkbox' || t.type === 'radio' || t.tagName === 'SELECT' || t.dataset.s === 'feliratkozas.ghlKod');
  } else if (t.dataset.l) {
    setDraft.profil[t.dataset.l][Number(t.dataset.li)][t.dataset.lk] = t.value;
    sDirty();
  } else if (t.dataset.cimke !== undefined) {
    setDraft.profil.hero.cimkek[Number(t.dataset.cimke)].szoveg = t.value;
    sDirty();
  }
});
// Kezdőnap és napok száma: csak a mező elhagyásakor/Enterre alkalmazzuk (gépelés közben nem vágunk le napokat).
async function idoszakAlkalmaz(kezd, napok) {
  const regiN = N();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(kezd)) { toast('Adj meg egy érvényes dátumot.', { err: true }); return renderBeallitasok(); }
  if (!(Number.isInteger(napok) && napok >= 1 && napok <= 366)) { toast('A napok száma 1 és 366 között lehet.', { err: true }); return renderBeallitasok(); }
  if (napok < regiN) {
    const toroltKitoltott = S.tartalom.days.slice(napok).filter(d => !d.uj).length;
    if (toroltKitoltott && !confirm(`A naptár ${regiN} napról ${napok} napra rövidül: a ${napok + 1}–${regiN}. nap tartalma (${toroltKitoltott} kitöltött nap) lekerül.\n\nA Mentések fülről bármikor visszahozható. Mehet?`)) return renderBeallitasok();
  }
  setDraft.profil.kezdet = kezd; setDraft.profil.napokSzama = napok;
  setDirty = true; setSzaml++;
  if (await mentBeallitas({ auto: false, uzenet: `Időszak: ${huDatum(kezd)} – ${huDatum(iso(datumPlusz(kezd, napok - 1)))} (${napok} nap).` })) {
    if (sel > N()) { sel = N(); }
    draft = structuredClone(S.tartalom.days[sel - 1]);
  }
  renderBeallitasok();
}
document.addEventListener('change', async e => {
  const t = e.target;
  if (t.dataset.sc === 'kezdet' || t.dataset.sc === 'napok') {
    await idoszakAlkalmaz($('#s-kezdet').value, Number($('#s-napok').value));
    return;
  }
  if ((t.dataset.sact === 'avatar' || t.dataset.sact === 'herokep') && t.files[0]) {
    try {
      toast('Kép feltöltése…');
      const k = (await feltolt(t.files[0])).kep;
      if (t.dataset.sact === 'avatar') setDraft.profil.avatar = k; else setDraft.profil.hero.kep = k;
      sDirty(true); toast('Kép feltöltve.');
    } catch (er) { toast(er.message, { err: true }); }
  }
});
document.addEventListener('click', async e => {
  const b = e.target.closest('#tab-beallitasok [data-sact], #tab-megjelenes [data-sact]');
  if (!b || b.tagName === 'INPUT') return;
  const a = b.dataset.sact;
  if (a === 'ladd') { setDraft.profil[b.dataset.l].push({ felirat: '', url: 'https://' }); sDirty(true); }
  if (a === 'ldel') { setDraft.profil[b.dataset.l].splice(Number(b.dataset.li), 1); sDirty(true); }
  if (a === 'cadd') { setDraft.profil.hero.cimkek.push({ szoveg: '' }); sDirty(true); document.querySelector('#cimkek li:last-child input')?.focus(); }
  if (a === 'cdel') { setDraft.profil.hero.cimkek.splice(Number(b.dataset.ci), 1); sDirty(true); }
  if (a === 'herokep-del') { setDraft.profil.hero.kep = ''; sDirty(true); }
  if (a === 'tema') { setDraft.profil.szinek = { ...TEMAK[Number(b.dataset.ti)][1] }; sDirty(true); }
  if (a === 'elo-mobil') { if (await mindentMent()) elonezet(S.ma >= 1 && S.ma <= N() ? S.ma : 1); }
  if (a === 'idoszak') {
    let k = b.dataset.k;
    if (!k) { const ma = new Date(); k = iso(new Date(Date.UTC(ma.getFullYear(), ma.getMonth(), ma.getDate() + 1))); }
    await idoszakAlkalmaz(k, Number(b.dataset.n));
  }
  if (a === 'save') await mentBeallitas();
});
function mentBeallitas({ auto = false, uzenet = '' } = {}) {
  clearTimeout(setTimer);
  return sorba(async () => {
    if (!setDirty || !setDraft) return true;
    const szaml = setSzaml;
    allapotJel('ment');
    try {
      const r = await api('/api/admin/profil', { method: 'PUT', body: { verzio: S.tartalom.verzio, auto, ...setDraft } });
      const regiN = N();
      S.tartalom.profil = r.profil; S.tartalom.feliratkozas = r.feliratkozas; S.tartalom.verzio = r.verzio;
      if (r.napok !== regiN) { await frissit(); }
      utolsoHiba = '';
      if (setSzaml === szaml) { setDirty = false; document.querySelectorAll('[data-sact="save"]').forEach(x => { x.disabled = true; }); }
      $('#wm').textContent = S.tartalom.profil.wordmark;
      renderStatus();
      allapotJel(dirty || setDirty ? 'var' : 'ok');
      if (!auto) toast(uzenet || 'Beállítások mentve.', { undo: r.mentesId });
      return true;
    } catch (er) {
      utolsoHiba = er.message;
      allapotJel('hiba', er.message);
      if (!auto) toast(er.message, { err: true });
      return false;
    }
  });
}

/* ---------- STATISZTIKA ---------- */
async function renderStat() {
  try { await frissit(); } catch { return; }
  const st = S.stat || {};
  const sum = k => Object.values(st).reduce((s, x) => s + (x[k] || 0), 0);
  $('#tab-stat').innerHTML = `
    <div class="kpis">
      <div class="kpi"><b>${sum('megnyitas')}</b><span>megnyitott üzenet</span></div>
      <div class="kpi"><b>${sum('kupon')}</b><span>kimásolt kuponkód</span></div>
      <div class="kpi"><b>${sum('link')}</b><span>linkkattintás</span></div>
      <div class="kpi"><b>${S.feliratkozok}</b><span>feliratkozó (ebből hírlevél: ${S.hirlevel})</span></div>
    </div>
    <div class="row" style="margin-bottom:12px"><a class="btn" href="/api/admin/feliratkozok.csv" data-dl>⬇ Feliratkozók (CSV)</a><a class="btn" href="/api/admin/export" data-dl>⬇ Teljes tartalom mentése (JSON)</a><button type="button" class="ghost" id="st-refresh">Frissítés</button></div>
    ${S.webhookSor ? `<p class="note">${S.webhookSor} feliratkozó vár a GoHighLevel-be küldésre (automatikusan újrapróbáljuk).</p>` : ''}
    <table><thead><tr><th>Nap</th><th>Cím</th><th class="num">Megnyitás</th><th class="num">Kuponmásolás</th><th class="num">Link</th></tr></thead><tbody>
    ${S.tartalom.days.map(d => { const x = st[d.day] || {}; return `<tr class="${d.day === S.ma ? 'today' : ''}"><td>${pad(d.day)}.</td><td>${esc(d.cim)}</td><td class="num">${x.megnyitas || 0}</td><td class="num">${x.kupon || 0}</td><td class="num">${x.link || 0}</td></tr>`; }).join('')}
    </tbody></table>
    <p class="hint">A számlálók névtelenek (nincs süti, nincs személyes adat). Egy böngésző naponta egyszer számít megnyitásnak.</p>`;
  $('#st-refresh').onclick = renderStat;
}
// A letöltéshez is kell az X-Admin fejléc → fetch + blob.
document.addEventListener('click', async e => {
  const a = e.target.closest('a[data-dl]'); if (!a) return;
  e.preventDefault();
  try {
    const r = await fetch(BASE + a.getAttribute('href').replace(/^\//, ''), { headers: { 'X-Admin': '1' }, credentials: 'same-origin' });
    if (!r.ok) throw new Error('A letöltés nem sikerült.');
    const name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '')?.[1] || 'letoltes';
    const u = URL.createObjectURL(await r.blob());
    const x = Object.assign(document.createElement('a'), { href: u, download: name });
    document.body.appendChild(x); x.click(); x.remove(); setTimeout(() => URL.revokeObjectURL(u), 2000);
  } catch (er) { toast(er.message, { err: true }); }
});

/* ---------- MENTÉSEK ---------- */
const mentesIdo = id => { const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/.exec(id); return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`).toLocaleString('hu-HU', { timeZone: 'Europe/Budapest', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : id; };
async function renderMentesek() {
  let l;
  try { l = (await api('/api/admin/mentesek')).mentesek; } catch (er) { toast(er.message, { err: true }); return; }
  $('#tab-mentesek').innerHTML = `<div class="card"><h2>Korábbi állapotok</h2>
    <p class="hint">Minden mentés előtt automatikusan eltesszük az addigi állapotot (az utolsó 40-et). Ha valami elromlott, innen bármikor visszaállíthatod.</p></div>
    ${l.length ? `<table><thead><tr><th>Mikor</th><th>Ami utána változott</th><th></th></tr></thead><tbody>${l.map(m => `<tr><td>${esc(mentesIdo(m.id))}</td><td>${esc(m.ok)}</td><td class="num"><button type="button" class="ghost sm" data-restore="${esc(m.id)}">Visszaállítás erre</button></td></tr>`).join('')}</tbody></table>` : '<p>Még nincs mentés.</p>'}`;
  document.querySelectorAll('[data-restore]').forEach(b => { b.onclick = () => visszaallit(b.dataset.restore); });
}
async function visszaallit(id, gyors = false) {
  if (!gyors && !confirm('Visszaállítod a teljes naptárat erre az állapotra? (A mostani állapotot is elmentjük, így ez is visszavonható.)')) return;
  try {
    const r = await api('/api/admin/visszaallit', { method: 'POST', body: { id, verzio: S.tartalom.verzio } });
    dirty = false; setDirty = false; setDraft = null;
    await frissit(); if (sel > N()) sel = N(); draft = structuredClone(S.tartalom.days[sel - 1]);
    renderStatus(); renderTab();
    toast('Visszaállítva.', { undo: r.mentesId });
  } catch (er) { toast(er.message, { err: true }); }
}

start();
