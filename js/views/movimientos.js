import { DB } from '../store.js?v=25c4e9c';
import { $, $$, esc, fmtEUR, fmtN, fmtCcy, fmtDate, parseISO, OP_LABEL } from '../util.js?v=25c4e9c';
import { acctName, posOf, opAmounts, divAmounts, sortOps } from '../engine.js?v=25c4e9c';
import { openOpForm, openDivForm } from '../forms.js?v=25c4e9c';
import { exportOpsCSV, exportDivsCSV } from '../export.js?v=25c4e9c';

function inRange(date, r) {
  if (r === 'all') return true; const d = parseISO(date), n = new Date(); const y = n.getFullYear();
  if (r === '12m') { const s = new Date(n); s.setFullYear(y - 1); return d >= s; }
  if (r === 'ytd') return d >= new Date(y, 0, 1); if (r === 'month') return d >= new Date(y, n.getMonth(), 1);
  if (r === 'lastyear') return d >= new Date(y - 1, 0, 1) && d < new Date(y, 0, 1); return true;
}
export function renderMovimientos(v, C, { UI, render }) {
  const q = UI.search.toLowerCase();
  const match = o => { const p = posOf(o.position_id); return !q || [p?.ticker, p?.name, acctName(o.account_id), OP_LABEL[o.type] || o.type, o.description, (o.tags || []).join(' ')].join(' ').toLowerCase().includes(q); };
  const ops = DB.operations.filter(o => inRange(o.date, UI.range) && match(o) && (UI.account === 'all' || o.account_id === UI.account)).sort(sortOps).reverse();
  const divs = DB.dividends.filter(d => inRange(d.date, UI.range) && match(d) && (UI.account === 'all' || d.account_id === UI.account)).sort((a, b) => b.date.localeCompare(a.date) || (b.seq || 0) - (a.seq || 0));
  const tab = UI.opTab;
  v.innerHTML = `
    <div class="section-head"><div class="chips"><button class="chip ${tab === 'ops' ? 'on' : ''}" data-tab="ops">Operaciones <span class="pill">${ops.length}</span></button><button class="chip ${tab === 'divs' ? 'on' : ''}" data-tab="divs">Dividendos y cupones <span class="pill">${divs.length}</span></button></div>
      <div class="toolbar"><button class="btn primary" id="newop">+ Nueva</button><button class="btn" id="csv">CSV</button></div></div>
    <div class="toolbar"><input type="search" class="grow" id="search" placeholder="Buscar ticker, cuenta, tipo, nota…" value="${esc(UI.search)}">
      <select id="acc"><option value="all">Todas las cuentas</option>${DB.accounts.map(a => `<option value="${a.id}" ${UI.account === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
      <select id="range">${[['12m', 'Últimos 12 meses'], ['ytd', 'Año actual'], ['lastyear', 'Año pasado'], ['month', 'Este mes'], ['all', 'Siempre']].map(([k, l]) => `<option value="${k}" ${UI.range === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="card"><div class="tablewrap">
    ${tab === 'ops' ? `<table><thead><tr><th>Fecha</th><th>Cuenta</th><th>Tipo</th><th>Posición</th><th class="num">Cantidad</th><th class="num">Precio</th><th class="num">Comisión</th><th class="num">Cambio BCE</th><th class="num">Total (€)</th><th>Origen</th><th>Notas</th></tr></thead><tbody>
      ${ops.slice(0, 500).map(o => { const p = posOf(o.position_id); const A = opAmounts(o); const isCash = !o.position_id;
        return `<tr class="row" data-op="${o.id}"><td>${fmtDate(o.date)}</td><td class="muted">${esc(acctName(o.account_id))}${o.type === 'transfer' ? ' → ' + esc(acctName(o.to_account_id)) : ''}${o.switch_to ? ' → ' + esc(o.switch_to) : ''}</td><td><span class="tag type ${o.type === 'buy' ? 'buy' : o.type === 'sell' ? 'sell' : ''}">${OP_LABEL[o.type] || o.type}</span></td><td>${p ? `<span class="tk">${esc(p.ticker)}</span>` : `<span class="muted">Efectivo ${esc(o.currency || 'EUR')}</span>`}</td><td class="num">${isCash ? fmtCcy(A.gross, A.ccy) : fmtN(o.qty, 6)}</td><td class="num">${isCash ? '' : fmtCcy(o.price, A.ccy, 3)}</td><td class="num">${fmtEUR(A.commEUR + A.taxEUR)}</td><td class="num muted">${A.ccy !== 'EUR' ? fmtN(A.fx, 4) : ''}</td><td class="num ${['sell', 'optionSell', 'deposit', 'interest'].includes(o.type) ? 'pos' : ''}">${fmtEUR(isCash ? A.grossEUR : A.totalEUR)}</td><td class="muted">${o.source === 'filios' ? 'Filios' : 'Manual'}</td><td class="muted" style="max-width:220px;overflow:hidden;text-overflow:ellipsis">${esc(o.description || '')}</td></tr>`; }).join('') || `<tr><td colspan="11" class="empty">No hay operaciones en este rango.</td></tr>`}
      ${ops.length > 500 ? `<tr><td colspan="11" class="muted">Se muestran 500 de ${ops.length}. Acota con el buscador o el rango.</td></tr>` : ''}
    </tbody></table>`
    : `<table><thead><tr><th>Fecha</th><th>Cuenta</th><th>Posición</th><th class="num">Títulos</th><th class="num">Bruto/título</th><th class="num">Cambio</th><th class="num">Bruto (€)</th><th class="num">Ret. origen</th><th class="num">Ret. destino</th><th class="num">Neto (€)</th><th>Origen</th></tr></thead><tbody>
      ${divs.map(d => { const A = divAmounts(d); const p = posOf(d.position_id); return `<tr class="row" data-div="${d.id}"><td>${fmtDate(d.date)}</td><td class="muted">${esc(acctName(d.account_id))}</td><td><span class="tk">${esc(p?.ticker || '—')}</span></td><td class="num">${fmtN(d.shares, 6)}</td><td class="num">${fmtCcy(d.gross_per_share, A.ccy, 4)}</td><td class="num muted">${A.ccy !== 'EUR' ? fmtN(A.fx, 4) : ''}</td><td class="num">${fmtEUR(A.grossEUR)}</td><td class="num">${fmtEUR(A.wOrigEUR)}</td><td class="num">${fmtEUR(A.wDestEUR)}</td><td class="num pos">${fmtEUR(A.netEUR)}</td><td class="muted">${d.source === 'filios' ? 'Filios' : 'Manual'}</td></tr>`; }).join('') || `<tr><td colspan="11" class="empty">No hay dividendos en este rango.</td></tr>`}
    </tbody></table>`}
    </div></div>`;
  $('[data-tab="ops"]', v).onclick = () => { UI.opTab = 'ops'; render(); }; $('[data-tab="divs"]', v).onclick = () => { UI.opTab = 'divs'; render(); };
  $('#newop').onclick = () => tab === 'ops' ? openOpForm() : openDivForm(); $('#csv').onclick = () => tab === 'ops' ? exportOpsCSV(ops) : exportDivsCSV(divs);
  $('#search').oninput = e => { UI.search = e.target.value; const pos = e.target.selectionStart; render(); const el = $('#search'); el.focus(); el.setSelectionRange(pos, pos); };
  $('#acc').onchange = e => { UI.account = e.target.value; render(); }; $('#range').onchange = e => { UI.range = e.target.value; render(); };
  $$('tr[data-op]', v).forEach(tr => tr.onclick = () => openOpForm(DB.operations.find(o => o.id === tr.dataset.op)));
  $$('tr[data-div]', v).forEach(tr => tr.onclick = () => openDivForm(DB.dividends.find(d => d.id === tr.dataset.div)));
}
