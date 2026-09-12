// Formularios: operación, dividendo, posición, cuenta, ficha de posición, importación manual de CSV de Filios
import { DB, upsert, remove, savePrice } from './store.js?v=25c4e9c';
import { $, $$, esc, uid, todayISO, nowHM, fmtEUR, fmtN, fmtPct, fmtCcy, fmtDate, cls, num, toast, TYPES, BUCKETS, DRAWERS, OP_LABEL, sum } from './util.js?v=25c4e9c';
import { posOf, acctOf, acctName, fxAt, priceAt, opAmounts, divAmounts, defaultBucket, sortOps, compute, invalidate, replay } from './engine.js?v=25c4e9c';

let rerender = () => {};
export function setRerender(fn) { rerender = fn; }
const refresh = () => { invalidate(); rerender(); };

export function openModal(html) { $('#modal').innerHTML = html; $('#modalbg').classList.add('open'); $$('[data-close]', $('#modal')).forEach(b => b.onclick = closeModal); $('#modal').scrollTop = 0; }
export function closeModal() { $('#modalbg').classList.remove('open'); $('#modal').innerHTML = ''; }
$('#modalbg').addEventListener('click', e => { if (e.target.id === 'modalbg') closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
const opt = (list, val, label = x => x, value = x => x) => list.map(x => `<option value="${esc(value(x))}" ${String(value(x)) === String(val) ? 'selected' : ''}>${esc(label(x))}</option>`).join('');
const posOptions = val => `<option value="">— elige —</option>` + opt([...DB.positions].filter(p => p.type !== 'cash').sort((a, b) => a.ticker.localeCompare(b.ticker)), val, p => `${p.ticker} · ${p.name} (${p.currency})`, p => p.id) + `<option value="__new__">＋ Crear una posición nueva…</option>`;
// Búsqueda por ticker o nombre que filtra el desplegable de posiciones
const posSearchHTML = id => `<input type="search" id="${id}" placeholder="Buscar ticker o nombre…" autocomplete="off" style="margin-bottom:.3rem">`;
function bindPosSearch(m, searchId, selectId) {
  const inp = $('#' + searchId, m), sel = $('#' + selectId, m); if (!inp || !sel) return;
  const all = [...sel.options].map(o => ({ v: o.value, t: o.textContent }));
  inp.oninput = () => { const q = inp.value.trim().toLowerCase(); const cur = sel.value; sel.innerHTML = all.filter(o => !q || o.v === '' || o.v === '__new__' || o.t.toLowerCase().includes(q)).map(o => `<option value="${o.v}">${esc(o.t)}</option>`).join(''); const first = [...sel.options].find(o => o.value && o.value !== '__new__'); sel.value = [...sel.options].some(o => o.value === cur) ? cur : ''; if (q && first && !sel.value) sel.size = Math.min(8, sel.options.length); else sel.size = 0; };
}
const accOptions = val => `<option value="">— elige —</option>` + opt(DB.accounts, val, a => a.name, a => a.id);
const CCYS = ['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'HKD'];
const MANUAL_OP_TYPES = ['buy', 'sell', 'switch', 'split', 'deposit', 'withdrawal', 'interest', 'commission', 'stakeReward', 'transfer', 'adjust'];
const ASSET_TYPES = ['buy', 'sell', 'stakeReward', 'adjust', 'switch', 'split'];

// ---------- Ficha de posición ----------
export function openHolding(key, C) {
  const r = C.rows.find(x => x.accountId + '|' + x.positionId === key); if (!r) return;
  const ops = DB.operations.filter(o => o.position_id === r.positionId && o.account_id === r.accountId).sort(sortOps).reverse();
  const divs = DB.dividends.filter(d => d.position_id === r.positionId && d.account_id === r.accountId).sort((a, b) => b.date.localeCompare(a.date));
  const hist = Object.entries(DB.prices[r.positionId] || {}).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6);
  openModal(`
    <div class="mhead"><div><h2>${esc(r.p.ticker)} <span class="muted" style="font-weight:500;font-size:.95rem">${esc(r.p.name)}</span></h2><div class="muted" style="font-size:.78rem">${esc(TYPES[r.p.type] || '')} · ${esc(r.p.currency)} · ${esc(acctName(r.accountId))} · <span class="tag b${r.bucket}">${BUCKETS[r.bucket].short}</span>${r.p.drawer ? ' · ' + DRAWERS[r.p.drawer] : ''}${r.p.nucleo_sector ? ' · ' + esc(r.p.nucleo_sector) : ''}${r.p.region ? ' · ' + esc(r.p.region) : ''}</div></div><button class="btn ghost" data-close>✕</button></div>
    <dl class="kv">
      <dt>Cantidad</dt><dd class="num">${fmtN(r.qty, 6)}</dd>
      <dt>Último precio</dt><dd class="num">${fmtCcy(r.last, r.p.currency, r.last < 1 ? 4 : 2)} <span class="muted">(${r.priceDate ? fmtDate(r.priceDate) : 'coste'})</span></dd>
      <dt>Valor de mercado</dt><dd class="num">${fmtCcy(r.mvCcy, r.p.currency)} · ${fmtEUR(r.mvEUR)}</dd>
      <dt>Precio medio</dt><dd class="num">${fmtCcy(r.avg, r.p.currency, 3)} · ${fmtEUR(r.avgEUR, 3)} con comisiones</dd>
      ${r.p.currency !== 'EUR' ? (() => { const priceFx = r.qty * (r.last - r.avg) * r.fx; const fxFx = r.gain - priceFx; return `<dt>Origen de la ganancia</dt><dd class="num"><span class="${priceFx >= 0 ? 'pos' : 'neg'}">${fmtEUR(priceFx, 0)}</span> por precio en ${esc(r.p.currency)} · <span class="${fxFx >= 0 ? 'pos' : 'neg'}">${fmtEUR(fxFx, 0)}</span> por el cambio (medio ${fmtN(r.avgEUR / (r.avg || 1), 4)} → hoy ${fmtN(r.fx, 4)})</dd>`; })() : ''}
      <dt>Rentabilidad total</dt><dd class="num">${(() => { const tot = r.gain + r.realized + r.div; const base = r.costEUR + r.sold; return `<span class="${tot >= 0 ? 'pos' : 'neg'}">${fmtEUR(tot, 0)}</span> = no realizada ${fmtEUR(r.gain, 0)} + realizada ${fmtEUR(r.realized, 0)} + dividendos ${fmtEUR(r.div, 0)}${base > 0 ? ' · ' + fmtPct(tot / base * 100, 1) + ' sobre lo invertido' : ''}`; })()}</dd>
      <dt>Total invertido</dt><dd class="num">${fmtEUR(r.costEUR)}</dd>
      <dt>GyP no realizadas</dt><dd class="num ${cls(r.gain)}">${fmtEUR(r.gain)} · ${fmtPct(r.gainPct)}</dd>
      <dt>GyP realizadas (medio / FIFO)</dt><dd class="num ${cls(r.realized)}">${fmtEUR(r.realized)} / ${fmtEUR(r.realizedFifo)}</dd>
      <dt>Dividendos brutos</dt><dd class="num">${fmtEUR(r.div)}</dd>
    </dl>
    <div class="actions"><button class="btn" id="h-edit">Editar posición</button><button class="btn" id="h-price">Precio manual</button><button class="btn" id="h-div">+ Dividendo</button><button class="btn primary" id="h-op">+ Operación</button></div>
    <h3>Operaciones (${ops.length})</h3>
    <div class="tablewrap"><table><thead><tr><th>Fecha</th><th>Tipo</th><th class="num">Cantidad</th><th class="num">Precio</th><th class="num">Cambio</th><th class="num">Total (€)</th></tr></thead><tbody>
      ${ops.slice(0, 60).map(o => { const A = opAmounts(o); return `<tr class="row" data-op="${o.id}"><td>${fmtDate(o.date)}</td><td><span class="tag type ${o.type === 'buy' ? 'buy' : o.type === 'sell' ? 'sell' : ''}">${OP_LABEL[o.type] || o.type}</span></td><td class="num">${fmtN(o.qty, 6)}</td><td class="num">${fmtCcy(o.price, A.ccy, 3)}</td><td class="num muted">${A.ccy !== 'EUR' ? fmtN(A.fx, 4) : ''}</td><td class="num">${fmtEUR(A.totalEUR)}</td></tr>`; }).join('') || '<tr><td colspan="6" class="empty">Sin operaciones</td></tr>'}
    </tbody></table></div>
    ${divs.length ? `<h3>Dividendos (${divs.length})</h3><div class="tablewrap"><table><thead><tr><th>Fecha</th><th class="num">Bruto (€)</th><th class="num">Neto (€)</th></tr></thead><tbody>${divs.slice(0, 40).map(d => { const A = divAmounts(d); return `<tr class="row" data-div="${d.id}"><td>${fmtDate(d.date)}</td><td class="num">${fmtEUR(A.grossEUR)}</td><td class="num">${fmtEUR(A.netEUR)}</td></tr>`; }).join('')}</tbody></table></div>` : ''}
    ${(() => { const H = replay(todayISO()).H[key]; const lots = H ? H.lots.filter(l => l.qty > 1e-9) : []; return lots.length ? `<h3>Lotes FIFO abiertos (${lots.length})</h3><div class="tablewrap"><table><thead><tr><th class="num">Cantidad</th><th class="num">Coste (€)</th><th class="num">Coste unitario (€)</th></tr></thead><tbody>${lots.map(l => `<tr><td class="num">${fmtN(l.qty, 4)}</td><td class="num">${fmtEUR(l.costEUR, 0)}</td><td class="num">${fmtEUR(l.costEUR / l.qty, 2)}</td></tr>`).join('')}</tbody></table></div><div class="muted" style="font-size:.74rem">Los lotes se consumen por orden de compra dentro de esta cuenta (FIFO fiscal).</div>` : ''; })()}
    ${hist.length ? `<h3>Últimos precios</h3><div class="tablewrap"><table><tbody>${hist.map(([d, p]) => `<tr><td>${fmtDate(d)}</td><td class="num">${fmtCcy(p, r.p.currency, p < 1 ? 4 : 2)}</td></tr>`).join('')}</tbody></table></div>` : ''}`);
  $('#h-edit').onclick = () => openPosForm(r.p); $('#h-price').onclick = () => openPriceForm(r.p.id);
  $('#h-op').onclick = () => openOpForm(null, { position_id: r.positionId, account_id: r.accountId }); $('#h-div').onclick = () => openDivForm(null, { position_id: r.positionId, account_id: r.accountId });
  $$('tr[data-op]', $('#modal')).forEach(tr => tr.onclick = () => openOpForm(DB.operations.find(o => o.id === tr.dataset.op)));
  $$('tr[data-div]', $('#modal')).forEach(tr => tr.onclick = () => openDivForm(DB.dividends.find(d => d.id === tr.dataset.div)));
}

// ---------- Operación ----------
export function openOpForm(op, preset = {}) {
  const isNew = !op; const fromFilios = op && op.source === 'filios';
  op = op ? { ...op } : { id: uid(), type: 'buy', date: todayISO(), time: nowHM(), account_id: preset.account_id || '', position_id: preset.position_id || '', qty: '', price: '', currency: '', commission: 0, commission_ccy: 'EUR', tax: 0, tax_ccy: 'EUR', auto_fx: true, to_account_id: '', description: '', tags: [], source: 'manual' };
  const draw = () => {
    const t = op.type; const p = posOf(op.position_id); const isAsset = ASSET_TYPES.includes(t) && t !== 'adjust' ? true : t === 'adjust';
    const ccy = isAsset ? (p?.currency || 'EUR') : (op.currency || 'EUR'); op.currency = ccy;
    const fx = fxAt(ccy, op.date); const preview = isAsset ? opAmounts({ ...op, currency: ccy, fx, total: num(op.qty) * num(op.price) }) : null;
    openModal(`
      <div class="mhead"><h2>${isNew ? 'Nueva operación' : 'Editar operación'}</h2><button class="btn ghost" data-close>✕</button></div>
      ${fromFilios ? '<div class="note warn">Esta operación viene de Filios. Si la editas aquí, la próxima importación no la sobrescribe (se conserva tu versión).</div>' : ''}
      <div class="form">
        <div class="field full"><label>Tipo</label><select id="f-type">${opt(fromFilios && !MANUAL_OP_TYPES.includes(t) ? [t, ...MANUAL_OP_TYPES] : MANUAL_OP_TYPES, t, k => OP_LABEL[k] || k)}</select></div>
        ${isAsset ? `<div class="field full"><label>Posición</label>${posSearchHTML('f-possearch')}<select id="f-pos">${posOptions(op.position_id)}</select><span class="hint">Escribe para filtrar. Si el ticker no existe, elige «Crear una posición nueva» y se abre su ficha sin perder esta operación.</span></div>` : ''}
        <div class="field"><label>${t === 'transfer' ? 'Cuenta de origen' : 'Cuenta'}</label><select id="f-acc">${accOptions(op.account_id)}</select></div>
        ${t === 'transfer' ? `<div class="field"><label>Cuenta de destino</label><select id="f-to">${accOptions(op.to_account_id)}</select></div>` : ''}
        <div class="field"><label>Fecha</label><input type="date" id="f-date" value="${esc(op.date)}"></div>
        <div class="field"><label>Hora</label><input type="time" id="f-time" value="${esc(op.time || '')}"></div>
        ${t === 'switch' ? `<div class="field full"><label>Fondo de destino</label><select id="f-switchto">${posOptions(op.switch_to)}</select><span class="hint">Traspaso entre fondos sin peaje fiscal: el coste viaja al destino.</span></div><div class="field"><label>Participaciones que salen</label><input type="number" step="any" id="f-qty" value="${esc(op.qty)}" inputmode="decimal"></div><div class="field"><label>Valor liquidativo de salida (€)</label><input type="number" step="any" id="f-price" value="${esc(op.price)}" inputmode="decimal"></div><div class="field"><label>Participaciones que entran</label><input type="number" step="any" id="f-switchqty" value="${esc(op.switch_qty ?? '')}" inputmode="decimal"></div><div class="preview full"><dl class="kv"><dt>Importe traspasado</dt><dd class="num"><b>${fmtEUR(num(op.qty) * num(op.price))}</b></dd></dl></div>` : t === 'split' ? `<div class="field"><label>Factor del split</label><input type="number" step="any" id="f-qty" value="${esc(op.qty || '')}" inputmode="decimal" placeholder="10 para un 10:1, 0.1 para un contrasplit 1:10"></div><div class="field"><label>&nbsp;</label><div class="ro">Multiplica la cantidad y divide el precio medio; el coste no cambia.</div></div>` : isAsset ? `
          <div class="field"><label>${p?.type === 'fund' || p?.type === 'plan' ? 'Participaciones' : 'Títulos / cantidad'}${t === 'adjust' ? ' (positivo suma, negativo resta)' : ''}</label><input type="number" step="any" id="f-qty" value="${esc(op.qty)}" inputmode="decimal"></div>
          <div class="field"><label>Precio por unidad (${esc(ccy)})</label><input type="number" step="any" id="f-price" value="${esc(op.price)}" inputmode="decimal"></div>
          <div class="field"><label>Comisión</label><input type="number" step="any" id="f-comm" value="${esc(op.commission ?? 0)}" inputmode="decimal"></div>
          <div class="field"><label>Divisa de la comisión</label><select id="f-commccy">${opt(CCYS, op.commission_ccy || 'EUR')}</select></div>
          <div class="field"><label>Impuestos (€)</label><input type="number" step="any" id="f-tax" value="${esc(op.tax ?? 0)}" inputmode="decimal"><span class="hint">Tobin, stamp duty</span></div>
          ${ccy !== 'EUR' ? `<div class="field"><label>Cambio BCE del ${fmtDate(op.date)}</label><div class="ro">${fmtN(fx, 5)} € por 1 ${esc(ccy)}</div><span class="hint">Se toma del Banco Central Europeo (Frankfurter); no se edita.</span></div>
          <div class="field"><label class="switch"><input type="checkbox" id="f-autofx" ${op.auto_fx ? 'checked' : ''}> El bróker convirtió a euros (AutoFx)</label><span class="hint">Si no, se mueve caja en ${esc(ccy)}.</span></div>` : ''}
          <div class="preview full"><dl class="kv"><dt>Total en ${esc(ccy)}</dt><dd class="num">${fmtCcy(preview.gross, ccy)}</dd><dt>Total en €</dt><dd class="num">${fmtEUR(preview.grossEUR)}</dd><dt>${t === 'sell' ? 'Neto recibido (€)' : 'Total con comisiones e impuestos (€)'}</dt><dd class="num"><b>${fmtEUR(preview.totalEUR)}</b></dd></dl></div>`
        : `<div class="field"><label>Importe</label><input type="number" step="any" id="f-amt" value="${esc(op.total ?? '')}" inputmode="decimal"></div>
           <div class="field"><label>Divisa</label><select id="f-ccy">${opt(CCYS, ccy)}</select>${ccy !== 'EUR' ? `<span class="hint">Cambio BCE del día: ${fmtN(fx, 5)} · ${fmtEUR(num(op.total) * fx)}</span>` : ''}</div>`}
        <div class="field"><label>Etiquetas</label><input type="text" id="f-tags" value="${esc((op.tags || []).join(', '))}"></div>
        <div class="field"><label>Notas</label><input type="text" id="f-notes" value="${esc(op.description || '')}"></div>
      </div>
      ${isAsset && p && t === 'buy' && p.price_mode === 'manual' ? `<label class="switch"><input type="checkbox" id="f-updprice" checked> Guardar el precio como último precio de ${esc(p.ticker)}</label>` : ''}
      <div class="actions">${isNew ? '' : '<button class="btn danger left" id="f-del">Borrar</button>'}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="f-save">Guardar operación</button></div>`);
    const m = $('#modal');
    const read = () => {
      op.type = $('#f-type', m).value; op.account_id = $('#f-acc', m).value; op.date = $('#f-date', m).value; op.time = $('#f-time', m).value;
      op.tags = $('#f-tags', m).value.split(',').map(s => s.trim()).filter(Boolean); op.description = $('#f-notes', m).value;
      if ($('#f-pos', m)) op.position_id = $('#f-pos', m).value; if ($('#f-to', m)) op.to_account_id = $('#f-to', m).value;
      if ($('#f-switchto', m)) { op.switch_to = $('#f-switchto', m).value; op.switch_qty = num($('#f-switchqty', m).value); op.switch_account = op.account_id; }
      if (op.type === 'split') { op.qty = num($('#f-qty', m).value); op.price = 0; op.total = 0; }
      if ($('#f-qty', m)) { op.qty = num($('#f-qty', m).value); op.price = num($('#f-price', m).value); op.commission = num($('#f-comm', m).value); op.commission_ccy = $('#f-commccy', m).value; op.tax = num($('#f-tax', m).value); op.tax_ccy = 'EUR'; op.total = op.qty * op.price; }
      if ($('#f-autofx', m)) op.auto_fx = $('#f-autofx', m).checked;
      if ($('#f-amt', m)) { op.total = num($('#f-amt', m).value); op.qty = op.total; op.price = 1; op.currency = $('#f-ccy', m).value; }
    };
    ['#f-type', '#f-pos', '#f-date', '#f-ccy'].forEach(s => { const el = $(s, m); if (el) el.onchange = () => { if (s === '#f-pos' && el.value === '__new__') { read(); op.position_id = ''; const pending = { ...op }; openPosForm(null, { onSaved: id => openOpForm({ ...pending, position_id: id }) }); return; } read(); draw(); }; });
    bindPosSearch(m, 'f-possearch', 'f-pos');
    $$('#f-qty,#f-price,#f-comm,#f-tax,#f-amt', m).forEach(el => el.onchange = () => { const id = el.id; read(); draw(); const a = $('#' + id, m); if (a) a.focus(); });
    $('#f-save', m).onclick = async () => {
      read(); const t = op.type; const isAsset = ASSET_TYPES.includes(t);
      if (!op.account_id) return toast('Elige una cuenta'); if (!op.date) return toast('Falta la fecha');
      if (isAsset && !op.position_id) return toast('Elige una posición'); if (isAsset && t !== 'adjust' && !(op.qty > 0)) return toast('La cantidad debe ser mayor que cero');
      if (t === 'switch' && (!op.switch_to || !(op.switch_qty > 0))) return toast('Indica el fondo de destino y las participaciones que entran');
      if (t === 'transfer' && (!op.to_account_id || op.to_account_id === op.account_id)) return toast('Elige una cuenta de destino distinta');
      if (!isAsset && !(op.total > 0)) return toast('Indica el importe');
      const ccy = isAsset ? (posOf(op.position_id)?.currency || 'EUR') : op.currency;
      const clean = { ...op, currency: ccy, fx: fxAt(ccy, op.date), fx_filios: op.fx_filios ?? null, source: op.source === 'filios' ? 'filios-editado' : 'manual' };
      if (!isAsset) clean.position_id = null; if (t !== 'transfer') delete clean.to_account_id;
      const A = opAmounts(clean); clean.total_eur = Math.round(A.grossEUR * 100) / 100; clean.total_comm_eur = Math.round(A.totalEUR * 100) / 100;
      delete clean.extra; Object.keys(clean).forEach(k => clean[k] === undefined && delete clean[k]);
      const upd = $('#f-updprice', m)?.checked; closeModal(); await upsert('operations', clean);
      if (t === 'switch') { const amt = num(op.qty) * num(op.price); await upsert('operations', { ...clean, id: (clean.id || uid()) + '-in', position_id: op.switch_to, type: 'switchBuy', qty: op.switch_qty, price: op.switch_qty ? amt / op.switch_qty : 0, total: amt, total_eur: amt, total_comm_eur: amt, switch_to: null, switch_qty: null, description: (clean.description || '') + ' (entrada del traspaso)' }); }
      if (upd && op.price > 0) await savePrice(op.position_id, op.date, op.price, 'manual');
      toast(isNew ? 'Operación registrada' : 'Operación actualizada'); refresh();
    };
    if ($('#f-del', m)) $('#f-del', m).onclick = async () => { if (confirm('¿Borrar esta operación?')) { closeModal(); await remove('operations', op.id); toast('Operación borrada'); refresh(); } };
  };
  draw();
}

// ---------- Dividendo ----------
export function openDivForm(d, preset = {}) {
  const isNew = !d;
  const guessShares = (pid, aid) => { const r = compute().rows.find(x => x.positionId === pid && x.accountId === aid); return r ? r.qty : ''; };
  d = d ? { ...d } : { id: uid(), date: todayISO(), time: '', account_id: preset.account_id || '', position_id: preset.position_id || '', shares: preset.position_id ? guessShares(preset.position_id, preset.account_id) : '', currency: '', gross_per_share: '', gross: '', commission: 0, commission_ccy: 'EUR', withhold_origin: 0, withhold_dest_eur: 0, auto_fx: true, description: '', source: 'manual' };
  const draw = () => {
    const p = posOf(d.position_id); const ccy = d.currency || p?.currency || 'EUR'; const fx = fxAt(ccy, d.date);
    const gross = num(d.gross_per_share) * num(d.shares); const wOrig = num(d.withhold_origin); const net = gross - wOrig - num(d.commission); const netEUR = net * fx - num(d.withhold_dest_eur);
    openModal(`
      <div class="mhead"><h2>${isNew ? 'Nuevo dividendo o cupón' : 'Editar dividendo'}</h2><button class="btn ghost" data-close>✕</button></div>
      <div class="form">
        <div class="field full"><label>Posición</label>${posSearchHTML('d-possearch')}<select id="d-pos">${posOptions(d.position_id)}</select></div>
        <div class="field"><label>Cuenta</label><select id="d-acc">${accOptions(d.account_id)}</select></div>
        <div class="field"><label>Fecha de pago</label><input type="date" id="d-date" value="${esc(d.date)}"></div>
        <div class="field"><label>Número de títulos</label><input type="number" step="any" id="d-shares" value="${esc(d.shares)}" inputmode="decimal"></div>
        <div class="field"><label>Divisa del pago</label><select id="d-ccy">${opt(CCYS, ccy)}</select></div>
        <div class="field"><label>Bruto por título (${esc(ccy)})</label><input type="number" step="any" id="d-gps" value="${esc(d.gross_per_share)}" inputmode="decimal"></div>
        <div class="field"><label>Retención en origen (${esc(ccy)})</label><input type="number" step="any" id="d-wo" value="${esc(d.withhold_origin ?? 0)}" inputmode="decimal"><span class="hint">Importe retenido en el país del activo.</span></div>
        <div class="field"><label>Retención en destino (€)</label><input type="number" step="any" id="d-wd" value="${esc(d.withhold_dest_eur ?? 0)}" inputmode="decimal"><span class="hint">19 % en España si el bróker retiene.</span></div>
        <div class="field"><label>Comisión (${esc(ccy)})</label><input type="number" step="any" id="d-comm" value="${esc(d.commission ?? 0)}" inputmode="decimal"></div>
        ${ccy !== 'EUR' ? `<div class="field"><label>Cambio BCE del ${fmtDate(d.date)}</label><div class="ro">${fmtN(fx, 5)} € por 1 ${esc(ccy)}</div></div><div class="field"><label class="switch"><input type="checkbox" id="d-autofx" ${d.auto_fx !== false ? 'checked' : ''}> Cobrado en euros (AutoFx)</label></div>` : ''}
        <div class="field full"><label>Notas</label><input type="text" id="d-notes" value="${esc(d.description || '')}"></div>
        <div class="preview full"><dl class="kv"><dt>Bruto</dt><dd class="num">${fmtCcy(gross, ccy)} · ${fmtEUR(gross * fx)}</dd><dt>Neto cobrado (€)</dt><dd class="num"><b>${fmtEUR(netEUR)}</b></dd></dl></div>
      </div>
      <div class="actions">${isNew ? '' : '<button class="btn danger left" id="d-del">Borrar</button>'}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="d-save">Guardar dividendo</button></div>`);
    const m = $('#modal');
    const read = () => { d.position_id = $('#d-pos', m).value; d.account_id = $('#d-acc', m).value; d.date = $('#d-date', m).value; d.shares = num($('#d-shares', m).value); d.currency = $('#d-ccy', m).value; d.gross_per_share = num($('#d-gps', m).value); d.withhold_origin = num($('#d-wo', m).value); d.withhold_dest_eur = num($('#d-wd', m).value); d.commission = num($('#d-comm', m).value); d.commission_ccy = d.currency; d.description = $('#d-notes', m).value; if ($('#d-autofx', m)) d.auto_fx = $('#d-autofx', m).checked; };
    $('#d-pos', m).onchange = () => { if ($('#d-pos', m).value === '__new__') { read(); d.position_id = ''; const pending = { ...d }; openPosForm(null, { onSaved: id => openDivForm({ ...pending, position_id: id }) }); return; } read(); const p = posOf(d.position_id); if (p) { d.currency = p.currency; if (!d.shares && d.account_id) d.shares = guessShares(d.position_id, d.account_id); } draw(); };
    bindPosSearch(m, 'd-possearch', 'd-pos');
    $('#d-acc', m).onchange = () => { read(); if (!d.shares && d.position_id) d.shares = guessShares(d.position_id, d.account_id); draw(); };
    ['#d-ccy', '#d-date'].forEach(s => $(s, m).onchange = () => { read(); draw(); });
    $$('#d-shares,#d-gps,#d-wo,#d-wd,#d-comm', m).forEach(el => el.onchange = () => { const id = el.id; read(); draw(); const a = $('#' + id, m); if (a) a.focus(); });
    $('#d-save', m).onclick = async () => {
      read(); if (!d.position_id) return toast('Elige una posición'); if (!d.account_id) return toast('Elige una cuenta'); if (!d.date) return toast('Falta la fecha'); if (!(d.gross_per_share * d.shares > 0)) return toast('Indica el importe bruto');
      const clean = { ...d, gross: d.gross_per_share * d.shares, fx: fxAt(d.currency, d.date), net: d.gross_per_share * d.shares - d.withhold_origin - d.commission, source: d.source === 'filios' ? 'filios-editado' : 'manual' };
      clean.gross_eur = Math.round(clean.gross * clean.fx * 100) / 100; clean.net_eur = Math.round((clean.net * clean.fx - d.withhold_dest_eur) * 100) / 100; delete clean.extra;
      closeModal(); await upsert('dividends', clean); toast(isNew ? 'Dividendo registrado' : 'Dividendo actualizado'); refresh();
    };
    if ($('#d-del', m)) $('#d-del', m).onclick = async () => { if (confirm('¿Borrar este dividendo?')) { closeModal(); await remove('dividends', d.id); toast('Dividendo borrado'); refresh(); } };
  };
  draw();
}

// ---------- Posición ----------
export function openPosForm(p, { onSaved } = {}) {
  const isNew = !p;
  p = p ? { ...p } : { id: '', ticker: '', name: '', type: 'stock', currency: 'USD', isin: '', country: '', exchange: '', sector: '', region: '', bucket: 1, drawer: '', nucleo_sector: '', scope: 'inversion', price_mode: 'auto', yahoo_symbol: '', coingecko_id: '', tags: [], notes: '' };
  const regions = [...new Set(DB.positions.map(x => x.region).filter(Boolean))].sort(); const sectors = [...new Set(DB.positions.map(x => x.sector).filter(Boolean))].sort();
  const nsec = [...new Set([...Object.keys((DB.settings?.targets || {}).nucleo_sectores || {}), ...DB.positions.map(x => x.nucleo_sector).filter(Boolean), 'Software', 'Cloud', 'Lujo', 'Datos y derechos', 'Pagos', 'Inmobiliario de renta', 'Salud', 'Servicios esenciales'])];
  const pr = p.id ? priceAt(p.id, todayISO()) : null;
  openModal(`
    <div class="mhead"><h2>${isNew ? 'Nueva posición' : 'Editar posición'}</h2><button class="btn ghost" data-close>✕</button></div>
    <div class="form">
      <div class="field"><label>Tipo</label><select id="p-type">${opt(Object.keys(TYPES).filter(k => k !== 'cash'), p.type, k => TYPES[k])}</select></div>
      <div class="field"><label>Divisa de cotización</label><select id="p-ccy">${opt(CCYS, p.currency)}</select></div>
      <div class="field"><label>Ticker</label><input type="text" id="p-ticker" value="${esc(p.ticker)}"></div>
      <div class="field"><label>Nombre</label><input type="text" id="p-name" value="${esc(p.name)}"></div>
      <div class="field"><label>Alcance</label><select id="p-scope">${opt(['inversion', 'vivienda'], p.scope || 'inversion', k => k === 'vivienda' ? 'Vivienda (patrimonio, no inversión)' : 'Cartera de inversión')}</select></div>
      <div class="field"><label>Cubo</label><select id="p-bucket">${opt([1, 2, 3, 4], defaultBucket(p), k => BUCKETS[k].short)}</select><span class="hint">4 = no rebalancea (ilíquido, bloqueado o congelado por decisión).</span></div>
      <div class="field"><label>Cajón (cubo 1)</label><select id="p-drawer">${opt(Object.keys(DRAWERS), p.drawer || '', k => DRAWERS[k])}</select></div>
      <div class="field"><label>Sector del núcleo</label><input type="text" id="p-nsec" value="${esc(p.nucleo_sector || '')}" list="nsec"><datalist id="nsec">${nsec.map(s => `<option value="${esc(s)}">`).join('')}</datalist></div>
      <div class="field"><label>Región</label><input type="text" id="p-region" value="${esc(p.region || '')}" list="regions"><datalist id="regions">${regions.map(s => `<option value="${esc(s)}">`).join('')}</datalist></div>
      <div class="field"><label>Sector</label><input type="text" id="p-sector" value="${esc(p.sector || '')}" list="sectors"><datalist id="sectors">${sectors.map(s => `<option value="${esc(s)}">`).join('')}</datalist></div>
      <div class="field"><label>ISIN</label><input type="text" id="p-isin" value="${esc(p.isin || '')}"></div>
      <div class="field"><label>Precio</label><select id="p-pmode">${opt(['auto', 'manual'], p.price_mode || 'auto', k => k === 'auto' ? 'Automático (Yahoo / CoinGecko)' : 'Manual')}</select></div>
      <div class="field"><label>Símbolo Yahoo</label><input type="text" id="p-ysym" value="${esc(p.yahoo_symbol || '')}" placeholder="RMS.PA, 0P0001R5X9.F…"></div>
      <div class="field"><label>Id CoinGecko</label><input type="text" id="p-cg" value="${esc(p.coingecko_id || '')}" placeholder="bitcoin"></div>
      <div class="field"><label>Etiquetas</label><input type="text" id="p-tags" value="${esc((p.tags || []).join(', '))}"></div>
      <div class="field full"><label>Notas (stop, tesis, falsación…)</label><textarea id="p-notes">${esc(p.notes || '')}</textarea></div>
      ${!isNew ? `<div class="field"><label>Precio manual (${esc(p.currency)})</label><input type="number" step="any" id="p-price" value="${pr ? esc(pr.price) : ''}" inputmode="decimal"></div><div class="field"><label>Fecha del precio</label><input type="date" id="p-pdate" value="${todayISO()}"><span class="hint">Solo se guarda si cambias el precio.</span></div>` : ''}
    </div>
    <div class="actions">${isNew ? '' : '<button class="btn danger left" id="p-del">Borrar</button>'}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="p-save">Guardar posición</button></div>`);
  const m = $('#modal');
  $('#p-save', m).onclick = async () => {
    const ticker = $('#p-ticker', m).value.trim(); if (!ticker) return toast('Falta el ticker');
    const id = p.id || ticker.toUpperCase().replace(/[^A-Za-z0-9_.\-]+/g, '-'); if (isNew && DB.positions.some(x => x.id === id)) return toast('Ya existe una posición con ese ticker');
    const doc = { ...p, id, ticker, name: $('#p-name', m).value.trim(), type: $('#p-type', m).value, currency: $('#p-ccy', m).value, scope: $('#p-scope', m).value, bucket: +$('#p-bucket', m).value, drawer: $('#p-drawer', m).value, nucleo_sector: $('#p-nsec', m).value.trim(), region: $('#p-region', m).value.trim(), sector: $('#p-sector', m).value.trim(), isin: $('#p-isin', m).value.trim(), price_mode: $('#p-pmode', m).value, yahoo_symbol: $('#p-ysym', m).value.trim(), coingecko_id: $('#p-cg', m).value.trim(), tags: $('#p-tags', m).value.split(',').map(s => s.trim()).filter(Boolean), notes: $('#p-notes', m).value };
    closeModal(); await upsert('positions', doc);
    if (!isNew) { const price = num($('#p-price', m)?.value), pdate = $('#p-pdate', m)?.value || todayISO(); if (price > 0 && (!pr || price !== pr.price)) await savePrice(id, pdate, price, 'manual'); }
    toast(isNew ? 'Posición creada' : 'Posición actualizada'); refresh();
    if (onSaved) onSaved(id);
  };
  if ($('#p-del', m)) $('#p-del', m).onclick = async () => { if (DB.operations.some(o => o.position_id === p.id) || DB.dividends.some(d => d.position_id === p.id)) return toast('Tiene operaciones o dividendos; bórralos antes'); if (confirm('¿Borrar esta posición?')) { closeModal(); await remove('positions', p.id); toast('Posición borrada'); refresh(); } };
}
export function openPriceForm(pid) {
  const p = posOf(pid); if (!p) return; const pr = priceAt(pid, todayISO());
  openModal(`<div class="mhead"><h2>Precio de ${esc(p.ticker)}</h2><button class="btn ghost" data-close>✕</button></div>
    <div class="form"><div class="field"><label>Precio (${esc(p.currency)})</label><input type="number" step="any" id="pr-price" value="${pr ? esc(pr.price) : ''}" inputmode="decimal"></div><div class="field"><label>Fecha</label><input type="date" id="pr-date" value="${todayISO()}"></div></div>
    ${p.price_mode !== 'manual' ? '<div class="note warn">Esta posición tiene precio automático; el manual queda en el histórico pero el trabajo diario seguirá añadiendo cierres.</div>' : ''}
    <div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="pr-save">Guardar precio</button></div>`);
  setTimeout(() => $('#pr-price')?.focus(), 50);
  $('#pr-save').onclick = async () => { const price = num($('#pr-price').value), date = $('#pr-date').value || todayISO(); if (!(price > 0)) return toast('Indica el precio'); closeModal(); await savePrice(pid, date, price, 'manual'); toast('Precio guardado'); refresh(); };
}

// ---------- Cuenta ----------
export function openAccForm(a) {
  const isNew = !a; a = a ? { ...a } : { id: '', name: '', broker: '', country: 'ES', multi_currency: false, withholds_dest: true, notes: '' };
  openModal(`
    <div class="mhead"><h2>${isNew ? 'Nueva cuenta' : 'Editar cuenta'}</h2><button class="btn ghost" data-close>✕</button></div>
    <div class="form">
      <div class="field"><label>Nombre</label><input type="text" id="a-name" value="${esc(a.name)}"></div>
      <div class="field"><label>Bróker o wallet</label><input type="text" id="a-broker" value="${esc(a.broker || '')}"></div>
      <div class="field"><label>País del bróker</label><input type="text" id="a-country" value="${esc(a.country || '')}" maxlength="2" placeholder="ES, DE, FR…"></div>
      <div class="field" style="justify-content:end;gap:.5rem"><label class="switch"><input type="checkbox" id="a-multi" ${a.multi_currency ? 'checked' : ''}> Multidivisa (caja en USD, etc.)</label><label class="switch"><input type="checkbox" id="a-wd" ${a.withholds_dest ? 'checked' : ''}> Retiene en destino (19 %)</label></div>
      <div class="field full"><label>Notas</label><input type="text" id="a-notes" value="${esc(a.notes || '')}"></div>
    </div>
    <div class="actions">${isNew ? '' : '<button class="btn danger left" id="a-del">Borrar</button>'}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="a-save">Guardar cuenta</button></div>`);
  const m = $('#modal');
  $('#a-save', m).onclick = async () => { const name = $('#a-name', m).value.trim(); if (!name) return toast('Falta el nombre'); const id = a.id || name.toLowerCase().replace(/[^a-z0-9]+/g, '-'); closeModal(); await upsert('accounts', { ...a, id, name, broker: $('#a-broker', m).value.trim(), country: $('#a-country', m).value.trim().toUpperCase(), multi_currency: $('#a-multi', m).checked, withholds_dest: $('#a-wd', m).checked, notes: $('#a-notes', m).value }); toast(isNew ? 'Cuenta creada' : 'Cuenta actualizada'); refresh(); };
  if ($('#a-del', m)) $('#a-del', m).onclick = async () => { if (DB.operations.some(o => o.account_id === a.id || o.to_account_id === a.id) || DB.dividends.some(d => d.account_id === a.id)) return toast('Tiene movimientos; bórralos antes'); if (confirm('¿Borrar esta cuenta?')) { closeModal(); await remove('accounts', a.id); toast('Cuenta borrada'); refresh(); } };
}

// ---------- Importación manual de CSV de Filios (mismo mapeo que jobs/import_filios.py, en el navegador) ----------
function parseCSV(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(field); field = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; } else field += c; }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift().map(h => h.replace(/^﻿/, '')); return rows.filter(r => r.length > 1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}
async function sha(s) { const b = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 20); }
const ACC_BY_BROKER = { 'Santander Broker': 'santander', 'Trade Republic': 'tr', 'Nexo': 'nexo', 'Bienes Raices': 'br', 'Reental': 'reental' };
const TYPE_MAP = { stock: 'stock', etf: 'etf', fund: 'fund', plan: 'plan', crypto: 'crypto', cash: 'cash', custom: 'custom', putOption: 'option', callOption: 'option' };
const pidOf = t => t.trim().replace(/[^A-Za-z0-9_.\-]+/g, '-').toUpperCase();
export async function importFiliosCSV(text, filename, { preview = true } = {}) {
  let rows = parseCSV(text); if (!rows.length) return toast('CSV vacío');
  // Trade Republic se reconstruye desde su propia exportación (jobs/import_tr.py): sus filas de Filios se ignoran para no duplicar
  const trRows = rows.filter(r => r.broker === 'Trade Republic').length; rows = rows.filter(r => r.broker !== 'Trade Republic');
  if (!rows.length) return toast(`Las ${trRows} filas son de Trade Republic: esa cuenta se importa desde su exportación de transacciones`);
  const isDiv = 'originRetention' in rows[0]; let added = 0, skipped = 0;
  const seen = {}; const existing = new Set((isDiv ? DB.dividends : DB.operations).map(x => x.id));
  if (preview) {
    // Simulación sin escribir: qué haría la importación
    const s2 = {}; let nuevas = 0, repetidas = 0; const dates = []; const newAcc = new Set(), newPos = new Set();
    for (const r of rows) {
      const acc = ACC_BY_BROKER[r.broker] || (r.broker ? r.broker.toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'santander');
      if (r.broker && !DB.accounts.some(a => a.id === acc)) newAcc.add(r.broker);
      const pid = r.positionType === 'cash' ? null : pidOf(r.ticker); if (pid && !DB.positions.some(p => p.id === pid)) newPos.add(r.ticker);
      const key = isDiv ? [r.date, r.time, r.ticker, acc, r.positionNumber, r.quantity, r.total || ''].join('|') : [r.date, r.time, r.ticker, acc, r.type, r.positionNumber, r.price, r.total || ''].join('|');
      s2[key] = (s2[key] || 0) + 1; const id = await sha((isDiv ? 'div|' : '') + key + '|' + s2[key]);
      if (existing.has(id)) repetidas++; else nuevas++; dates.push(r.date);
    }
    dates.sort();
    return new Promise(resolve => {
      openModal(`<div class="mhead"><h2>Previsualizar importación</h2><button class="btn ghost" data-close>✕</button></div>
        <dl class="kv"><dt>Archivo</dt><dd>${esc(filename)} · ${isDiv ? 'dividendos' : 'operaciones'}</dd><dt>Filas</dt><dd class="num">${rows.length}${trRows ? ` <span class="muted">(+${trRows} de Trade Republic, ignoradas: esa cuenta se importa desde su propia exportación)</span>` : ''}</dd><dt>Fechas</dt><dd>${dates[0] ? fmtDate(dates[0]) + ' a ' + fmtDate(dates[dates.length - 1]) : '—'}</dd><dt>Nuevas</dt><dd class="num pos">${nuevas}</dd><dt>Ya existentes (se omiten)</dt><dd class="num muted">${repetidas}</dd>${newAcc.size ? `<dt>Cuentas nuevas</dt><dd>${esc([...newAcc].join(', '))}</dd>` : ''}${newPos.size ? `<dt>Posiciones nuevas</dt><dd>${esc([...newPos].slice(0, 20).join(', '))}${newPos.size > 20 ? ` +${newPos.size - 20}` : ''}</dd>` : ''}</dl>
        <div class="note">Una exportación parcial (por ejemplo, solo este mes) es válida: las filas repetidas se detectan por su contenido y no se duplican. Nada se escribe hasta que confirmes.</div>
        <div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="imp-go">Importar ${nuevas} nuevas</button></div>`);
      $('#imp-go').onclick = async () => { closeModal(); resolve(await importFiliosCSV(text, filename, { preview: false })); };
      $$('[data-close]', $('#modal')).forEach(b => b.addEventListener('click', () => resolve(null)));
    });
  }
  for (let seq = 0; seq < rows.length; seq++) {
    const r = rows[seq]; const acc = ACC_BY_BROKER[r.broker] || (r.broker ? r.broker.toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'santander');
    if (r.broker && !DB.accounts.some(a => a.id === acc)) await upsert('accounts', { id: acc, name: r.broker, broker: r.broker, country: '', multi_currency: true, withholds_dest: false });
    const isCash = r.positionType === 'cash'; const pid = isCash ? null : pidOf(r.ticker);
    if (pid && !DB.positions.some(p => p.id === pid)) await upsert('positions', { id: pid, ticker: r.ticker, name: r.ticker, type: TYPE_MAP[r.positionType] || r.positionType, currency: r.positionCurrency || 'EUR', isin: /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(r.ticker) ? r.ticker : '', country: r.positionCountry || '', exchange: r.positionExchange || '', sector: '', region: '', bucket: null, drawer: '', scope: 'inversion', price_mode: ['custom', 'plan', 'putOption', 'callOption'].includes(r.positionType) ? 'manual' : 'auto', tags: [] });
    let key, id;
    if (isDiv) { key = [r.date, r.time, r.ticker, acc, r.positionNumber, r.quantity, r.total || ''].join('|'); seen[key] = (seen[key] || 0) + 1; id = await sha('div|' + key + '|' + seen[key]); }
    else { key = [r.date, r.time, r.ticker, acc, r.type, r.positionNumber, r.price, r.total || ''].join('|'); seen[key] = (seen[key] || 0) + 1; id = await sha(key + '|' + seen[key]); }
    if (existing.has(id)) { skipped++; continue; }
    const n = v => (v === '' || v == null) ? null : parseFloat(v);
    if (isDiv) await upsert('dividends', { id, seq, date: r.date, time: r.time, account_id: acc, position_id: pid, shares: n(r.positionNumber), currency: r.currency || r.positionCurrency || 'EUR', gross_per_share: n(r.quantity), gross: n(r.total), gross_eur: n(r.totalBaseCurrency), fx: fxAt(r.currency || 'EUR', r.date), fx_filios: n(r.exchangeRate), commission: n(r.comission) || 0, commission_ccy: r.comissionCurrency || '', withhold_origin: n(r.originRetention) || 0, withhold_dest_eur: n(r.destinationRetentionBaseCurrency) || 0, net: n(r.totalNeto), net_eur: n(r.totalNetoBaseCurrency), retention_returned_eur: n(r.retentionReturnedBaseCurrency) || 0, net_with_return_eur: n(r.netoWithReturnBaseCurrency), auto_fx: r.autoFx === 'Yes', description: r.description || '', source: 'filios' });
    else await upsert('operations', { id, seq, date: r.date, time: r.time, account_id: acc, position_id: pid, type: r.type, qty: n(r.positionNumber), price: n(r.price), currency: isCash ? 'EUR' : (r.positionCurrency || 'EUR'), commission: n(r.comission) || 0, commission_ccy: r.comissionCurrency || '', tax: n(r.taxes) || 0, tax_ccy: r.taxesCurrency || '', fx: fxAt(isCash ? 'EUR' : (r.positionCurrency || 'EUR'), r.date), fx_filios: n(r.exchangeRate), auto_fx: r.autoFx === 'Yes', total: n(r.total), total_eur: n(r.totalBaseCurrency), total_comm_eur: n(r.totalWithComissionBaseCurrency), switch_to: r.switchBuyPosition ? pidOf(r.switchBuyPosition) : '', switch_qty: n(r.switchBuyPositionNumber), spinoff_to: r.spinOffBuyPosition ? pidOf(r.spinOffBuyPosition) : '', spinoff_qty: n(r.spinOffBuyPositionNumber), spinoff_alloc: n(r.spinOffBuyPositionAllocation), holding_before: n(r.positionQuantity), description: r.description || '', tags: [], source: 'filios' });
    added++;
  }
  toast(`${filename}: ${added} nuevas, ${skipped} ya existían`); refresh();
}
