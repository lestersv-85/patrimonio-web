import { DB } from '../store.js?v=25c4e9c';
import { $, $$, esc, fmtCcy, fmtDate, TYPES, DRAWERS } from '../util.js?v=25c4e9c';
import { defaultBucket, priceAt } from '../engine.js?v=25c4e9c';
import { openPosForm } from '../forms.js?v=25c4e9c';

export function renderPosiciones(v, C, { UI, render }) {
  const held = new Set(C.rows.map(r => r.positionId)); const f = UI.posFilter; const q = UI.search.toLowerCase();
  const list = DB.positions.filter(p => p.type !== 'cash' && (f === 'all' || (f === 'held' ? held.has(p.id) : p.type === f)) && (!q || [p.ticker, p.name, p.isin, p.sector, p.region, (p.tags || []).join(' ')].join(' ').toLowerCase().includes(q))).sort((a, b) => a.ticker.localeCompare(b.ticker));
  const types = [...new Set(DB.positions.map(p => p.type))].filter(t => t !== 'cash');
  const today = new Date().toISOString().slice(0, 10);
  v.innerHTML = `
    <div class="section-head"><h2>Posiciones <span class="pill">${list.length}</span></h2><button class="btn primary" id="newpos">+ Nueva posición</button></div>
    <div class="toolbar"><input type="search" class="grow" id="search" placeholder="Buscar ticker, nombre, ISIN, región…" value="${esc(UI.search)}"></div>
    <div class="chips"><button class="chip ${f === 'held' ? 'on' : ''}" data-f="held">En cartera</button><button class="chip ${f === 'all' ? 'on' : ''}" data-f="all">Todas (${DB.positions.length})</button>${types.map(t => `<button class="chip ${f === t ? 'on' : ''}" data-f="${t}">${TYPES[t] || t}</button>`).join('')}</div>
    <div class="note">Toca una fila para editar cubo, cajón, región, sector, alcance (inversión o vivienda) y precio. Los precios automáticos llegan cada día del trabajo programado; los manuales se anotan aquí y quedan en el histórico.</div>
    <div class="card"><div class="tablewrap"><table><thead><tr><th>Ticker</th><th>Nombre</th><th>Tipo</th><th>Cubo</th><th>Cajón</th><th>Región</th><th>Divisa</th><th class="num">Último precio</th><th>Fecha</th><th>Fuente</th><th>Sector</th></tr></thead><tbody>
      ${list.map(p => { const pr = priceAt(p.id, today); return `<tr class="row" data-pos="${p.id}"><td><span class="tk">${esc(p.ticker)}</span>${p.scope === 'vivienda' ? ' <span class="tag">vivienda</span>' : ''}${held.has(p.id) ? '' : ' <span class="tag">cerrada</span>'}</td><td>${esc(p.name)}</td><td>${TYPES[p.type] || esc(p.type)}</td><td><span class="tag b${defaultBucket(p)}">${defaultBucket(p)}</span></td><td class="muted">${p.drawer ? DRAWERS[p.drawer] : ''}${p.nucleo_sector ? ' · ' + esc(p.nucleo_sector) : ''}</td><td class="muted">${esc(p.region || '')}</td><td>${esc(p.currency)}</td><td class="num">${pr ? fmtCcy(pr.price, p.currency, pr.price < 1 ? 4 : 2) : '—'}</td><td class="muted">${pr ? fmtDate(pr.date) : '—'}${pr && pr.stale && p.price_mode !== 'manual' && held.has(p.id) ? ' <span class="tag stale">antiguo</span>' : ''}</td><td class="muted">${p.price_mode === 'manual' ? 'manual' : esc(p.yahoo_symbol || p.coingecko_id || 'sin símbolo')}</td><td class="muted">${esc(p.sector || '')}</td></tr>`; }).join('') || `<tr><td colspan="11" class="empty">Sin posiciones.</td></tr>`}
    </tbody></table></div></div>`;
  $('#newpos').onclick = () => openPosForm();
  $('#search').oninput = e => { UI.search = e.target.value; const pos = e.target.selectionStart; render(); const el = $('#search'); el.focus(); el.setSelectionRange(pos, pos); };
  $$('[data-f]', v).forEach(b => b.onclick = () => { UI.posFilter = b.dataset.f; render(); });
  $$('tr[data-pos]', v).forEach(tr => tr.onclick = () => openPosForm(DB.positions.find(p => p.id === tr.dataset.pos)));
}
