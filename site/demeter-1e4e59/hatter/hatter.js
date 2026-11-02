/* Adventi naptár – háttérfelület. Keretrendszer nélkül; a bolti beállítás az index.html <meta> soraiban van. */
(() => {
  const meta = n => document.querySelector(`meta[name="${n}"]`)?.content || '';
  const API = meta('kal-api');
  const EV = Number(meta('kal-ev')) || 2026;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const num = n => new Intl.NumberFormat('hu-HU').format(n).replace(/ /g, ' ');
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '–');
  const HET = ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat'];
  const hetnap = d => HET[new Date(Date.UTC(EV, 11, d)).getUTCDay()];
  const TIPUS = { kedvezmeny: '% kedvezmény', '1plus1': '1+1', ajandek: 'Ajándék', szallitas: 'Ingyen szállítás', csomag: 'Csomag' };
  // beépített kép: relatív a naptárhoz (../products/NN.webp); feltöltött: /api/…
  const ROVID = d => ({ kedvezmeny: d.badge || '%', '1plus1': '1+1', ajandek: 'Ajándék', szallitas: '0 Ft szállítás', csomag: 'Csomag' }[d.type] || d.type);
  const src = u => (/^(https?:|\/)/.test(u || '') ? u : `../${u}`);

  let napok = [];
  let zarolt = new Set();
  let modositott = new Set();

  $('#bolt').textContent = meta('kal-bolt') || 'Webshop';
  document.title = `${meta('kal-bolt')} – adventi naptár háttérrendszer`;

  function toast(msg, bad = false) {
    const t = $('#toast');
    t.textContent = msg; t.classList.toggle('bad', bad); t.classList.add('on');
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('on'), bad ? 4200 : 2600);
  }

  async function api(path, opt = {}) {
    const r = await fetch(API + path, { cache: 'no-store', ...opt });
    const j = r.status === 204 ? {} : await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.hiba || `Hiba (${r.status})`), { data: j, status: r.status });
    return j;
  }

  /* ---------------- Napi tartalom ---------------- */
  function renderGrid() {
    $('#grid').innerHTML = napok.map(d => {
      const lock = zarolt.has(d.day);
      return `<button class="day${lock ? ' locked' : ''}${modositott.has(d.day) ? ' edited' : ''}" data-day="${d.day}" aria-label="December ${d.day}. szerkesztése: ${esc(d.product.name)}">
        <span class="ph"><img src="${esc(src(d.product.image))}" alt="" loading="lazy"><span class="date">Dec ${d.day}. · ${hetnap(d.day)}</span>${lock ? '<span class="lock" title="Lement nap, nem módosítható">🔒</span>' : ''}</span>
        <span class="bd"><span class="nm">${esc(d.product.name)}</span>
        <span class="meta"><span class="code">${esc(d.code)}</span><span class="pill" title="${esc(TIPUS[d.type] || d.type)}">${esc(ROVID(d))}</span></span></span>
      </button>`;
    }).join('');
  }
  $('#grid').addEventListener('click', e => { const b = e.target.closest('.day'); if (b) openEditor(Number(b.dataset.day)); });

  const field = (id, label, value, { type = 'text', area = false, hint = '', cls = '', max = '', extra = '' } = {}) => `
    <div class="f"><label for="${id}">${label}</label>
    ${area ? `<textarea id="${id}" name="${id}" rows="3" ${max ? `maxlength="${max}"` : ''}>${esc(value)}</textarea>`
           : `<input id="${id}" name="${id}" type="${type}" value="${esc(value)}" class="${cls}" ${max ? `maxlength="${max}"` : ''} ${extra}>`}
    ${hint ? `<span class="hint">${hint}</span>` : ''}<span class="err" id="${id}-err" hidden></span></div>`;

  let aktiv = null; let ujKep = null;
  function openEditor(day) {
    const d = napok[day - 1]; aktiv = day; ujKep = null;
    const lock = zarolt.has(day);
    const p = d.product;
    $('#ed-form').innerHTML = `
      <div class="ed-head"><h2 id="ed-title">December ${day}. · ${hetnap(day)}</h2><span class="pill">${esc(TIPUS[d.type] || d.type)}</span><button class="x" type="button" data-close aria-label="Bezárás">×</button></div>
      ${lock ? '<p class="locked-note">Ez a nap már lement, ezért csak megtekinthető.</p>' : ''}
      <div class="ed-body">
        <div class="ed-pic">
          <img id="ed-img" src="${esc(src(p.image))}" alt="${esc(p.name)}">
          <div>
            <div class="btns">${lock ? '' : '<label class="btn small" for="ed-file">Kép cseréje…</label>'}
              <input id="ed-file" type="file" accept="image/jpeg,image/png,image/webp" hidden></div>
            <small>JPEG, PNG vagy WebP. Feltöltéskor automatikusan kicsinyítjük.</small>
          </div>
          <div class="preview-coupon"><small>Így látszik a kupon:</small><b id="pv-title">${esc(d.title)}</b><span class="code" id="pv-code">${esc(d.code)}</span></div>
        </div>
        <div>
          <fieldset ${lock ? 'disabled' : ''}><legend>Termék</legend>
            ${field('name', 'Termék neve', p.name, { max: 120 })}
            ${field('description', 'Rövid leírás', p.description || '', { area: true, max: 600 })}
            <div class="row2">
              ${field('priceHuf', 'Ár (Ft)', p.priceHuf, { type: 'number', extra: 'min="1" step="1" inputmode="numeric"' })}
              ${field('url', 'Termékoldal a webshopban', p.url, { type: 'url', max: 400 })}
            </div>
          </fieldset>
          <fieldset ${lock ? 'disabled' : ''}><legend>Napi akció és kupon</legend>
            <div class="row2">
              ${field('code', 'Kuponkód', d.code, { cls: 'mono', max: 24, hint: 'Ugyanezzel a kóddal hozd létre a webshopban is.' })}
              ${d.type === 'kedvezmeny' ? field('pct', 'Kedvezmény (%)', d.pct, { type: 'number', extra: 'min="1" max="90" step="1" inputmode="numeric"' })
                : d.type === 'csomag' ? field('badge', 'Felirat a csokipénzen', d.badge || '', { max: 8, hint: 'pl. −20%' })
                : `<div class="f"><label>Akció típusa</label><div class="static">${esc(TIPUS[d.type])}</div></div>`}
            </div>
            ${field('title', 'Akció címe', d.title, { max: 90 })}
            ${field('detail', 'Akció leírása', d.detail, { area: true, max: 400 })}
            ${field('conditions', 'Feltétel (egy sor)', d.conditions, { max: 240 })}
          </fieldset>
        </div>
      </div>
      <div class="ed-foot">
        <a class="link" href="../?bemutato=1&nap=${day}" target="_blank" rel="noopener">Megnézem a naptárban ↗</a>
        <button class="btn" type="button" data-close>${lock ? 'Bezárás' : 'Mégse'}</button>
        ${lock ? '' : '<button class="btn primary" type="submit" id="ed-save">Mentés</button>'}
      </div>`;
    const f = $('#ed-form');
    f.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => $('#editor').close()));
    f.querySelector('#title')?.addEventListener('input', e => { $('#pv-title').textContent = e.target.value; });
    f.querySelector('#code')?.addEventListener('input', e => { $('#pv-code').textContent = e.target.value.toUpperCase(); });
    f.querySelector('#ed-file')?.addEventListener('change', uploadImage);
    $('#editor').showModal();
    f.querySelector('#name')?.focus();
  }

  // Kicsinyítés böngészőben (max 1000 px), WebP vagy JPEG; így kicsi a feltöltés.
  async function shrink(file) {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const webp = await new Promise(r => c.toBlob(r, 'image/webp', 0.85));
    if (webp && webp.type === 'image/webp') return webp;
    return new Promise(r => c.toBlob(r, 'image/jpeg', 0.86));
  }

  async function uploadImage(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      toast('Kép feltöltése…');
      const blob = await shrink(file).catch(() => file);
      const j = await api(`/kep?nap=${aktiv}`, { method: 'POST', body: blob });
      ujKep = j.url; $('#ed-img').src = j.url;
      toast('Kép feltöltve – a Mentéssel kerül ki a naptárba.');
    } catch (err) { toast(err.message, true); }
  }

  $('#ed-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target; const v = id => f.querySelector(`#${id}`)?.value;
    const d = napok[aktiv - 1];
    const body = {
      title: v('title'), detail: v('detail'), conditions: v('conditions'), code: (v('code') || '').toUpperCase(),
      product: { name: v('name'), description: v('description'), url: v('url'), priceHuf: Number(v('priceHuf')) },
    };
    if (d.type === 'kedvezmeny') body.pct = Number(v('pct'));
    if (d.type === 'csomag') body.badge = v('badge');
    if (ujKep) body.product.image = ujKep;
    f.querySelectorAll('.err').forEach(x => { x.hidden = true; });
    f.querySelectorAll('[aria-invalid]').forEach(x => x.removeAttribute('aria-invalid'));
    const btn = $('#ed-save'); btn.disabled = true; btn.textContent = 'Mentés…';
    try {
      const j = await api(`/napok/${aktiv}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      napok[aktiv - 1] = j.nap; modositott.add(aktiv);
      $('#editor').close(); renderGrid(); if (statAdat) renderStat();
      toast(`December ${aktiv}. mentve – a naptárban már az új tartalom látszik.`);
    } catch (err) {
      const mezok = err.data?.mezok || {};
      for (const [k, msg] of Object.entries(mezok)) {
        const id = k.replace('product.', '');
        const el = f.querySelector(`#${id}-err`); const inp = f.querySelector(`#${id}`);
        if (el) { el.textContent = msg; el.hidden = false; }
        inp?.setAttribute('aria-invalid', 'true');
      }
      f.querySelector('[aria-invalid="true"]')?.focus();
      toast(Object.keys(mezok).length ? 'Nézd át a pirossal jelölt mezőket.' : err.message, true);
    } finally { btn.disabled = false; btn.textContent = 'Mentés'; }
  });

  /* ---------------- Statisztika ---------------- */
  let statAdat = null; let rendezes = { k: 'day', dir: 1 };
  const COLORS = { ablak: 'var(--c1)', masolas: 'var(--c2)', atkattintas: 'var(--c3)' };

  function sorok(s) {
    return napok.map(d => {
      const n = s.napok[String(d.day)] || {};
      return { day: d.day, name: d.product.name, image: d.product.image, code: d.code, type: d.type,
        latogatas: s.latogatas[`${EV}-12-${pad(d.day)}`] || 0, ablak: n.ablak || 0, masolas: n.masolas || 0, atkattintas: n.atkattintas || 0 };
    });
  }

  function renderStat() {
    const box = $('#stat');
    const pelda = statAdat.pelda;
    const s = pelda || statAdat.valos;
    const rows = sorok(s);
    const ossz = k => rows.reduce((a, r) => a + r[k], 0);
    const L = Object.values(s.latogatas).reduce((a, b) => a + b, 0);
    const A = ossz('ablak'), M = ossz('masolas'), K = ossz('atkattintas');
    const banner = pelda ? `<div class="banner"><span class="tag">Példaadat</span>
        <p>Így fog kinézni a statisztika egy lefutott kampány után. A számok kitaláltak; a valós adatok december 1-jétől gyűlnek.</p>
        <button class="btn small danger" id="pelda-torles" type="button">Példaadatok törlése</button></div>` : '';
    if (!pelda && !L && !A) {
      box.innerHTML = `<div class="card empty"><p><b>Még nincs mért adat.</b><br>A számlálás december 1-jén, az első látogatóval indul.</p></div>${gdpr()}`;
      return;
    }
    const max = Math.max(1, ...rows.map(r => r.ablak));
    const sorted = [...rows].sort((a, b) => (a[rendezes.k] > b[rendezes.k] ? 1 : a[rendezes.k] < b[rendezes.k] ? -1 : 0) * rendezes.dir);
    const top = [...rows].sort((a, b) => b.masolas - a.masolas).slice(0, 3);
    const th = (k, t) => `<th data-k="${k}" ${rendezes.k === k ? `aria-sort="${rendezes.dir > 0 ? 'ascending' : 'descending'}"` : ''}>${t}</th>`;
    box.innerHTML = `${banner}
      <div class="kpis">
        <div class="kpi"><span>Látogatás</span><b>${num(L)}</b><small>naptár-megnyitás összesen</small></div>
        <div class="kpi"><span><i style="background:${COLORS.ablak}"></i>Ablaknyitás</span><b>${num(A)}</b><small>a látogatások ${pct(A, L)}-a</small></div>
        <div class="kpi"><span><i style="background:${COLORS.masolas}"></i>Kódmásolás</span><b>${num(M)}</b><small>a nyitások ${pct(M, A)}-a</small></div>
        <div class="kpi"><span><i style="background:${COLORS.atkattintas}"></i>Átkattintás a webshopba</span><b>${num(K)}</b><small>a nyitások ${pct(K, A)}-a</small></div>
      </div>
      <div class="card"><h2>Napi bontás <span class="legend"><span><i style="background:${COLORS.ablak}"></i>Ablaknyitás</span><span><i style="background:${COLORS.masolas}"></i>Kódmásolás</span><span><i style="background:${COLORS.atkattintas}"></i>Átkattintás</span></span></h2>
        <div class="chart" role="img" aria-label="Napi ablaknyitás, kódmásolás és átkattintás oszlopdiagram">
          ${rows.map(r => `<div class="col" data-tip="Dec ${r.day}. ${esc(r.name.slice(0, 28))}&#10;Ablaknyitás: ${r.ablak}&#10;Kódmásolás: ${r.masolas}&#10;Átkattintás: ${r.atkattintas}">
            ${['ablak', 'masolas', 'atkattintas'].map(k => `<i style="height:${(r[k] / max) * 100}%;background:${COLORS[k]}"></i>`).join('')}</div>`).join('')}
        </div>
        <div class="axis">${rows.map(r => `<span>${r.day}</span>`).join('')}</div>
      </div>
      <div class="card"><h2>Legtöbbet másolt kuponok</h2><div class="top3">
        ${top.map((r, i) => `<div><img src="${esc(src(r.image))}" alt=""><span><b>${i + 1}. Dec ${r.day}. – ${esc(r.name)}</b><small><span class="code">${esc(r.code)}</span> · ${num(r.masolas)} másolás</small></span></div>`).join('')}
      </div></div>
      <div class="card"><h2>Napok részletesen <button class="btn small" id="csv" type="button" style="margin-left:auto">Letöltés (CSV)</button></h2>
        <div class="tbl-wrap"><table>
          <thead><tr>${th('day', 'Nap')}${th('name', 'Termék')}${th('code', 'Kód')}${th('latogatas', 'Látogatás')}${th('ablak', 'Ablaknyitás')}${th('masolas', 'Kódmásolás')}${th('atkattintas', 'Átkattintás')}<th>Másolási arány</th></tr></thead>
          <tbody>${sorted.map(r => `<tr><td>Dec ${r.day}.</td><td>${esc(r.name)}</td><td class="code">${esc(r.code)}</td><td>${num(r.latogatas)}</td><td>${num(r.ablak)}</td><td>${num(r.masolas)}</td><td>${num(r.atkattintas)}</td><td>${pct(r.masolas, r.ablak)}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td>Összesen</td><td></td><td></td><td>${num(L)}</td><td>${num(A)}</td><td>${num(M)}</td><td>${num(K)}</td><td>${pct(M, A)}</td></tr></tfoot>
        </table></div>
      </div>
      <div class="card"><h2>A valódi eladás</h2><p class="gdpr" style="margin:0">A kuponkód napra egyedi, ezért a beváltásokat és a bevételt a webshop kuponstatisztikája (WooCommerce → Marketing → Kuponok) napra pontosan mutatja. Az átkattintások UTM-jelöléssel (<span class="code">utm_source=adventi-naptar</span>) a Google Analyticsben is láthatók.</p></div>
      ${gdpr()}`;
    box.querySelectorAll('th[data-k]').forEach(t => t.addEventListener('click', () => {
      rendezes = { k: t.dataset.k, dir: rendezes.k === t.dataset.k ? -rendezes.dir : (t.dataset.k === 'day' || t.dataset.k === 'name' || t.dataset.k === 'code' ? 1 : -1) };
      renderStat();
    }));
    $('#csv').addEventListener('click', () => csv(rows));
    $('#pelda-torles')?.addEventListener('click', async () => {
      if (!confirm('Biztosan törlöd a példaadatokat? Ezután csak a valós mérések látszanak.')) return;
      try { await api('/pelda-torles', { method: 'POST' }); await loadStat(); toast('Példaadatok törölve.'); } catch (err) { toast(err.message, true); }
    });
  }

  const gdpr = () => `<div class="card gdpr"><h2>Mit mérünk – és mit nem?</h2>
    <ul>
      <li>Csak napi összesített számokat: hány látogatás, ablaknyitás, kódmásolás és átkattintás volt.</li>
      <li>Nincs süti, nincs eszközazonosító, nem tároljuk az IP-címet és a böngésző adatait, nincs külső követőkód.</li>
      <li>Egy látogatót sem lehet beazonosítani vagy követni; a számlálók nem kapcsolhatók személyhez.</li>
      <li>A bemutatói nézet és a tesztelés nem kerül a számok közé.</li>
    </ul></div>`;

  function csv(rows) {
    const head = ['nap', 'datum', 'termek', 'kuponkod', 'latogatas', 'ablaknyitas', 'kodmasolas', 'atkattintas'];
    const q = s => `"${String(s).replace(/"/g, '""')}"`;
    const lines = [head.join(';'), ...rows.map(r => [r.day, `${EV}-12-${pad(r.day)}`, q(r.name), r.code, r.latogatas, r.ablak, r.masolas, r.atkattintas].join(';'))];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = `adventi-naptar-statisztika${statAdat.pelda ? '-PELDA' : ''}.csv`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function loadStat() { statAdat = await api('/statisztika'); renderStat(); }

  /* ---------------- fülek ---------------- */
  function route() {
    window.scrollTo(0, 0);
    const v = location.hash === '#statisztika' ? 'statisztika' : 'napok';
    for (const id of ['napok', 'statisztika']) {
      $(`#${id}`).hidden = id !== v;
      $(`#tab-${id}`).setAttribute('aria-selected', String(id === v));
    }
    if (v === 'statisztika' && !statAdat) loadStat().catch(err => { $('#stat').innerHTML = `<div class="card empty">${esc(err.message)}</div>`; });
  }
  window.addEventListener('hashchange', route);

  api('/napok').then(j => {
    napok = j.napok; zarolt = new Set(j.zarolt || []);
    renderGrid(); route();
  }).catch(err => {
    $('#grid').innerHTML = `<div class="card empty">A háttérrendszer most nem érhető el (${esc(err.message)}). Próbáld újra pár perc múlva.</div>`;
    route();
  });
})();
