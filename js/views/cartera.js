import { DB } from '../store.js?v=25c4e9c';
import { $, $$, esc, fmtEUR, fmtK, fmtN, fmtPct, fmtCcy, fmtDate, cls, sum, TYPE_SHORT } from '../util.js?v=25c4e9c';
import { acctName, viviendaValue } from '../engine.js?v=25c4e9c';
import { openOpForm, openHolding } from '../forms.js?v=25c4e9c';
import { exportPositionsCSV } from '../export.js?v=25c4e9c';

export function renderCartera(v, C, { UI, render }) {
  const acc = UI.account;
  let rows = C.rows.filter(r => (acc === 'all' || r.accountId === acc) && (Math.abs(r.mvEUR) >= 1 || Math.abs(r.costEUR) >= 1)).sort((a, b) => b.mvEUR - a.mvEUR);
  const mv = sum(rows, r => r.mvEUR), cost = sum(rows, r => r.costEUR); const cash = acc === 'all' ? C.cashTotal : (C.cashEUR[acc] || 0); const gain = mv - cost;
  const viv = viviendaValue();
  const COLS = [{ k: 'ticker', l: 'Posición' }, { k: 'acc', l: 'Cuenta' }, { k: 'mvEUR', l: 'Valor (€)', num: 1 }, { k: 'w', l: 'Peso', num: 1 }, { k: 'gain', l: 'GyP (€)', num: 1 }, { k: 'gainPct', l: 'GyP %', num: 1 }, { k: 'tot', l: 'Rent. total (€)', num: 1 }, { k: 'div', l: 'Divid.', num: 1 }, { k: 'bucket', l: 'Cubo' }, { k: 'qty', l: 'Cantidad', num: 1 }, { k: 'avg', l: 'Prc. medio', num: 1 }, { k: 'last', l: 'Último', num: 1 }, { k: 'costEUR', l: 'Invertido (€)', num: 1 }];
  const q = (UI.cartQ || '').toLowerCase(); if (q) rows = rows.filter(r => (r.p.ticker + ' ' + r.p.name + ' ' + acctName(r.accountId)).toLowerCase().includes(q));
  const sk = UI.cartSort || 'mvEUR', sd = UI.cartDir || -1;
  const val = r => sk === 'ticker' ? r.p.ticker : sk === 'acc' ? acctName(r.accountId) : sk === 'w' ? r.mvEUR : sk === 'tot' ? r.gain + r.realized + r.div : r[sk];
  rows = [...rows].sort((x, y) => { const a = val(x), b = val(y); return (typeof a === 'string' ? a.localeCompare(b) : (a || 0) - (b || 0)) * sd; });
  v.innerHTML = `
    <div class="section-head"><h2>Cartera de inversión</h2><div class="toolbar"><button class="btn primary" id="newop">+ Operación</button><button class="btn" id="csvpos">CSV</button></div></div>
    <div class="chips scroll" id="acctabs"><button class="chip ${acc === 'all' ? 'on' : ''}" data-acc="all">Global</button>${DB.accounts.map(a => `<button class="chip ${acc === a.id ? 'on' : ''}" data-acc="${a.id}">${esc(a.name)}</button>`).join('')}</div>
    <div class="kpis">
      <div class="kpi b"><div class="l">Valor posiciones</div><div class="v">${fmtK(mv)}</div><div class="s">Invertido ${fmtK(cost)}</div></div>
      <div class="kpi ${gain >= 0 ? 'g' : 'r'}"><div class="l">GyP no realizadas</div><div class="v ${cls(gain)}">${fmtK(gain)}</div><div class="s ${cls(gain)}">${fmtPct(cost ? gain / cost * 100 : 0)}</div></div>
      <div class="kpi ${cash < 0 ? 'r' : ''}"><div class="l">Efectivo</div><div class="v ${cash < 0 ? 'neg' : ''}">${fmtK(cash)}</div><div class="s">Aparte de las posiciones; entra en las rentabilidades solo con el tipo Efectivo</div></div>
      <div class="kpi ${C.income.realized >= 0 ? 'g' : 'r'}"><div class="l">GyP realizadas</div><div class="v ${cls(C.income.realized)}">${fmtK(C.income.realized)}</div><div class="s">FIFO ${fmtK(C.income.realizedFifo)} · desde 2015</div></div>
    </div>
    <div class="card"><div class="head"><div class="toolbar"><input type="search" id="cart-q" placeholder="Buscar posición…" value="${esc(UI.cartQ || '')}" style="width:220px"><span class="muted" style="font-size:.76rem">${rows.length} posiciones · pulsa una cabecera para ordenar</span></div></div><div class="tablewrap"><table class="cartera">
      <thead><tr>${COLS.filter(c => acc === 'all' || c.k !== 'acc').map(c => `<th class="${c.num ? 'num' : ''} sortable ${UI.cartSort === c.k ? 'on' : ''}" data-sort="${c.k}">${c.l}${UI.cartSort === c.k ? (UI.cartDir < 0 ? ' ▾' : ' ▴') : ''}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr class="row" data-hold="${r.accountId}|${r.positionId}"><td><span class="tk">${esc(r.p.ticker)}<small>${TYPE_SHORT[r.p.type] || ''}</small></span><span class="nm">${esc(r.p.name)}</span></td>${acc === 'all' ? `<td class="muted">${esc(acctName(r.accountId))}</td>` : ''}<td class="num">${fmtEUR(r.mvEUR, 0)}</td><td class="num muted">${mv ? fmtN(r.mvEUR / mv * 100, 1) + ' %' : ''}</td><td class="num ${cls(r.gain)}">${fmtEUR(r.gain, 0)}</td><td class="num ${cls(r.gain)}">${fmtPct(r.gainPct, 1)}</td><td class="num ${cls(r.gain + r.realized + r.div)}">${fmtEUR(r.gain + r.realized + r.div, 0)}</td><td class="num">${fmtEUR(r.div, 0)}</td><td><span class="tag b${r.bucket}">${r.bucket}</span></td><td class="num">${fmtN(r.qty, r.qty % 1 ? 4 : 0)}</td><td class="num">${fmtCcy(r.avg, r.p.currency, 2)}</td><td class="num">${fmtCcy(r.last, r.p.currency, r.last < 1 ? 4 : 2)}${r.stale && r.p.price_mode !== 'manual' ? ` <span class="tag stale" title="${r.priceDate ? fmtDate(r.priceDate) : ''}">antiguo</span>` : ''}</td><td class="num">${fmtEUR(r.costEUR, 0)}</td></tr>`).join('') || `<tr><td colspan="13" class="empty">Sin posiciones.</td></tr>`}</tbody>
      ${rows.length ? `<tfoot><tr class="total"><td>Total</td>${acc === 'all' ? '<td></td>' : ''}<td class="num">${fmtEUR(mv, 0)}</td><td></td><td class="num ${cls(gain)}">${fmtEUR(gain, 0)}</td><td class="num ${cls(gain)}">${fmtPct(cost ? gain / cost * 100 : 0, 1)}</td><td class="num">${fmtEUR(sum(rows, r => r.gain + r.realized + r.div), 0)}</td><td class="num">${fmtEUR(sum(rows, r => r.div), 0)}</td><td></td><td></td><td></td><td></td><td class="num">${fmtEUR(cost, 0)}</td></tr></tfoot>` : ''}
    </table></div></div>
    ${viv.length && acc === 'all' ? `<div class="card"><div class="head"><h3>Vivienda (patrimonio, fuera de la cartera de inversión)</h3></div><div class="tablewrap"><table><thead><tr><th>Posición</th><th class="num">Valor</th><th class="num">Valor (€)</th><th class="num">Coste (€)</th></tr></thead><tbody>${viv.map(r => `<tr class="row" data-hold="${r.accountId}|${r.positionId}"><td><span class="tk">${esc(r.p.ticker)}</span><span class="nm">${esc(r.p.name)}</span></td><td class="num">${fmtCcy(r.mvCcy, r.p.currency, 0)}</td><td class="num">${fmtEUR(r.mvEUR, 0)}</td><td class="num">${fmtEUR(r.costEUR, 0)}</td></tr>`).join('')}</tbody></table></div></div>` : ''}`;
  $$('th.sortable', v).forEach(th => th.onclick = () => { const k = th.dataset.sort; if (UI.cartSort === k) UI.cartDir = -(UI.cartDir || -1); else { UI.cartSort = k; UI.cartDir = k === 'ticker' || k === 'acc' ? 1 : -1; } render(); });
  const cq = $('#cart-q'); cq.oninput = () => { UI.cartQ = cq.value; clearTimeout(cq._t); cq._t = setTimeout(() => { render(); const el = $('#cart-q'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 250); };
  $('#acctabs').onclick = e => { const b = e.target.closest('[data-acc]'); if (b) { UI.account = b.dataset.acc; render(); } };
  $$('tr[data-hold]', v).forEach(tr => tr.onclick = () => openHolding(tr.dataset.hold, C));
  $('#newop').onclick = () => openOpForm(); $('#csvpos').onclick = () => exportPositionsCSV(C);
}
