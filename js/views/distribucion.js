import { DB } from '../store.js?v=25c4e9c';
import { $, $$, esc, fmtEUR, fmtK, fmtN, cls, sum, BUCKETS, TYPES, DRAWERS, PALETTE, C as COL, help, typeColor, accountColor, ccyColor } from '../util.js?v=25c4e9c';
import { inSelPos, inSelCash, acctName, groupBy, viviendaValue } from '../engine.js?v=25c4e9c';
import { donut, legendHTML } from '../charts.js?v=25c4e9c';
import { openModal } from '../forms.js?v=25c4e9c';
import { selDescription } from './inicio.js?v=25c4e9c';
import { targets } from '../recommend.js?v=25c4e9c';

export function renderDistribucion(v, C, { UI, render, filterBarHTML, bindFilterBar }) {
  const rows = C.rows.filter(r => inSelPos(r.p, r.accountId)); let cash = 0; for (const a in C.cashEUR) if (inSelCash(a)) cash += C.cashEUR[a];
  const base = UI.distBase; const val = r => base === 'mv' ? r.mvEUR : r.costEUR;
  const mk = (keyFn, labelFn, colorFn) => groupBy(rows.map(r => ({ ...r, mvEUR: val(r) })), keyFn, labelFn, colorFn, PALETTE);
  const byBucket = mk(r => r.bucket, k => BUCKETS[k].name, k => BUCKETS[k].color); if (cash) byBucket.push({ k: 'cash', label: 'Efectivo', v: cash, color: COL.cash, cost: cash, gain: 0, n: DB.accounts.length });
  const byType = mk(r => r.p.type === 'custom' && r.p.custom_type ? r.p.custom_type : r.p.type, k => TYPES[k] || k, (k, i) => typeColor(k, i)); if (cash) byType.push({ k: 'cash', label: 'Efectivo', v: cash, color: COL.cash, cost: cash, gain: 0, n: 0 });
  const byRegion = mk(r => r.p.region || 'Sin región', k => k);
  const bySector = mk(r => r.p.sector || 'Sin sector', k => k);
  const byAcc = mk(r => r.accountId, k => acctName(k), (k, i) => accountColor(acctName(k), i)); DB.accounts.forEach(a => { if (inSelCash(a.id) && C.cashEUR[a.id]) { const g = byAcc.find(x => x.k === a.id); if (g) g.v += C.cashEUR[a.id]; else byAcc.push({ k: a.id, label: a.name, v: C.cashEUR[a.id], color: accountColor(a.name, byAcc.length), cost: 0, gain: 0, n: 0 }); } });
  const byCcy = mk(r => r.p.currency, k => k, (k, i) => ccyColor(k, i)); if (cash) { const g = byCcy.find(x => x.k === 'EUR'); if (g) g.v += cash; else byCcy.push({ k: 'EUR', label: 'EUR', v: cash, color: ccyColor('EUR', 0), cost: 0, gain: 0, n: 0 }); }
  const b1 = rows.filter(r => r.bucket === 1); const byDrawer = groupBy(b1.map(r => ({ ...r, mvEUR: val(r) })), r => r.p.drawer || '', k => DRAWERS[k] || k || 'Sin cajón', null, PALETTE);
  const nuc = b1.filter(r => r.p.drawer === 'nucleo'); const byNucSector = groupBy(nuc.map(r => ({ ...r, mvEUR: val(r) })), r => r.p.nucleo_sector || 'Sin sector', k => k, null, PALETTE);
  const total = sum(byBucket, i => i.v); const T = targets();
  const cubo4 = byBucket.find(x => x.k === 4)?.v || 0; const reb = total - cubo4;
  const viv = viviendaValue(); const vivV = sum(viv, r => r.mvEUR); const invTotal = sum(C.rows, r => r.mvEUR); // posiciones, sin efectivo (misma definición que en Inicio)
  const HK = { 'd-b': 'cubo', 'd-dr': 'cajones', 'd-ns': 'nucleo', 'd-t': 'tipo', 'd-r': 'region', 'd-s': 'sector', 'd-a': 'cuenta', 'd-c': 'divisa' };
  const card = (id, title, items, sub = '') => `<div class="card"><div class="head">${help(title, HK[id])}<div class="toolbar">${sub ? `<span class="sub">${sub}</span>` : ''}<button class="btn sm" data-table="${id}">Ver tabla</button></div></div><div class="donutwrap"><div class="chartbox"><canvas id="${id}"></canvas></div>${legendHTML(items, 9)}</div></div>`;
  const tables = { 'd-b': ['Por cubo', byBucket], 'd-dr': ['Cajones del cubo 1', byDrawer], 'd-ns': ['Sectores del núcleo', byNucSector], 'd-t': ['Por tipo de activo', byType], 'd-r': ['Por región', byRegion], 'd-s': ['Por sector', bySector], 'd-a': ['Por cuenta', byAcc], 'd-c': ['Por divisa', byCcy] };
  v.innerHTML = `
    <div class="section-head"><div><div class="eyebrow">Distribución · ${esc(selDescription())}</div><h2>${fmtEUR(total, 0)}</h2></div>
      <div class="seg" id="dbase"><button class="${base === 'mv' ? 'on' : ''}" data-b="mv">Valor de mercado</button><button class="${base === 'cost' ? 'on' : ''}" data-b="cost">Invertido</button></div></div>
    ${filterBarHTML()}
    <div class="card"><div class="head"><h3>Patrimonio</h3><span class="sub">Vivienda + cartera de inversión</span></div>
      <div class="cubos"><div class="kpi" style="--kc:#F472B6"><div class="l">Vivienda (Casa 98)</div><div class="v">${fmtK(vivV)}</div><div class="s">${fmtN(vivV / ((invTotal + vivV) || 1) * 100, 1)} % del patrimonio · no rebalancea, no cuenta como inversión</div></div>
      <div class="kpi b"><div class="l">Cartera de inversión</div><div class="v">${fmtK(invTotal)}</div><div class="s">${fmtN(invTotal / ((invTotal + vivV) || 1) * 100, 1)} % · posiciones y efectivo</div></div>
      <div class="kpi p"><div class="l">Rebalanceable (cubos 1 a 3)</div><div class="v">${fmtK(reb)}</div><div class="s">${fmtN(reb / (total || 1) * 100, 1)} % de la selección · cubo 4 ${fmtK(cubo4)}</div></div></div></div>
    <div class="card"><div class="head"><h3>Los cuatro cubos</h3><span class="sub">Peso sobre lo rebalanceable frente al objetivo de la doctrina</span></div>
      <div class="cubos">${[1, 2, 3, 4].map(b => { const vv = byBucket.filter(x => x.k === b || (b === 3 && x.k === 'cash')).reduce((s, x) => s + x.v, 0); const w = b === 4 ? vv / (total || 1) * 100 : vv / (reb || 1) * 100; const t = T.cubos_rebalanceable[b]; const band = T.banda_pp; const mx = 100; return `<div class="kpi" style="--kc:${BUCKETS[b].color}"><div class="l" style="color:${BUCKETS[b].color}">${BUCKETS[b].short}</div><div class="v">${fmtN(w, 1)} %</div>${b !== 4 ? `<div class="tgt" title="Peso actual (barra), objetivo (marca) y banda tolerada ±${band} pp (zona clara)"><div class="tgt-band" style="left:${Math.max(0, t - band) / mx * 100}%;width:${2 * band / mx * 100}%"></div><div class="tgt-bar" style="width:${Math.min(100, w) / mx * 100}%;background:${BUCKETS[b].color}"></div><div class="tgt-mark" style="left:${t / mx * 100}%"></div></div>` : ''}<div class="s">${fmtK(vv)} · ${b === 4 ? 'del total' : `objetivo ${fmtN(t, 1)} % · ${w - t >= 0 ? '+' : ''}${fmtN(w - t, 1)} pp${Math.abs(w - t) > band ? ' · fuera de banda' : ' · en banda'}`} · ${BUCKETS[b].job}</div></div>`; }).join('')}</div></div>
    <div class="grid2">
      ${card('d-b', 'Por cubo', byBucket)}${card('d-dr', 'Cajones del cubo 1', byDrawer, 'Por regla de venta')}${card('d-ns', 'Sectores del núcleo', byNucSector, 'Objetivo 8 sectores')}${card('d-t', 'Por tipo de activo', byType)}${card('d-r', 'Por región', byRegion)}${card('d-s', 'Por sector', bySector)}${card('d-a', 'Por cuenta', byAcc)}${card('d-c', 'Por divisa', byCcy)}
    </div>`;
  bindFilterBar();
  $('#dbase').onclick = e => { const b = e.target.closest('button'); if (b) { UI.distBase = b.dataset.b; render(); } };
  $$('[data-table]', v).forEach(b => b.onclick = () => { const [title, items] = tables[b.dataset.table]; const tot = sum(items, i => i.v) || 1;
    openModal(`<div class="mhead"><h2>${title}</h2><button class="btn ghost" data-close>✕</button></div><div class="tablewrap"><table><thead><tr><th>Grupo</th><th class="num">Valor</th><th class="num">Peso</th><th class="num">Invertido</th><th class="num">GyP</th><th class="num">Pos.</th></tr></thead><tbody>${items.map(i => `<tr><td><i class="tag" style="background:${i.color};width:8px;height:8px;padding:0;border-radius:50%;display:inline-block"></i> ${esc(i.label)}</td><td class="num">${fmtEUR(i.v, 0)}</td><td class="num">${fmtN(i.v / tot * 100, 1)} %</td><td class="num">${i.cost != null ? fmtEUR(i.cost, 0) : ''}</td><td class="num ${cls(i.gain)}">${i.gain != null ? fmtEUR(i.gain, 0) : ''}</td><td class="num">${i.n ?? ''}</td></tr>`).join('')}</tbody></table></div>`); });
  for (const id in tables) donut(id, tables[id][1]);
}
