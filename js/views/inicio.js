import { DB } from '../store.js?v=25c4e9c';
import { runChecks } from '../checks.js?v=25c4e9c';
import { $, $$, esc, fmtEUR, fmtK, fmtN, fmtPct, fmtYM, fmtDate, cls, sum, todayISO, monthKey, addMonths, BUCKETS, TYPES, PALETTE, C as COL, help, typeColor, HELP, kpiTip, parseISO, isoDate, monthEnd } from '../util.js?v=25c4e9c';
import { SEL, selIsAll, inSelPos, inSelCash, perf, monthlySeries, firstOpDate, viviendaValue, groupBy, benchReturn, divAmounts, opAmounts, posOf, priceAt, fxAt, benchWeights, benchComposite, spReturn, spBench, BENCH_LEGS } from '../engine.js?v=25c4e9c';
import { chart, donut, legendHTML, pctTick, grid, avgDataset, endLabels } from '../charts.js?v=25c4e9c';
import { phaseLineHTML } from '../clock.js?v=25c4e9c';
import { recommendationsHTML } from '../recommend.js?v=25c4e9c';
import { openOpForm, openDivForm, openHolding } from '../forms.js?v=25c4e9c';

export function selDescription() {
  if (selIsAll()) return 'Toda la cartera de inversión';
  const parts = [];
  if (SEL.buckets.length) parts.push(SEL.buckets.map(b => BUCKETS[b].short).join(' + '));
  if (SEL.types.length) parts.push(SEL.types.map(t => TYPES[t] || t).join(' + '));
  if (SEL.accounts.length) parts.push(SEL.accounts.map(a => DB.accounts.find(x => x.id === a)?.name || a).join(' + '));
  return parts.join(' · ');
}

export function renderInicio(v, C, ctx) {
  const { UI, render, go, filterBarHTML, bindFilterBar } = ctx;
  const rows = C.rows.filter(r => inSelPos(r.p, r.accountId)).sort((a, b) => b.mvEUR - a.mvEUR);
  let cash = 0; for (const a in C.cashEUR) if (inSelCash(a)) cash += C.cashEUR[a];
  const mv = sum(rows, r => r.mvEUR), cost = sum(rows, r => r.costEUR), gain = mv - cost; const total = mv + cash;
  // Cartera de inversión = posiciones (como en Filios y como la curva); el efectivo se muestra aparte y suma al patrimonio
  const invTotal = sum(C.rows, r => r.mvEUR); const viv = viviendaValue(); const vivV = sum(viv, r => r.mvEUR); const patrimonio = invTotal + C.cashTotal + vivV;
  const today = todayISO(); const y = today.slice(0, 4);
  const first = firstOpDate(); const firstYM = monthKey(first); const thisYM = monthKey(today);
  const ago = (yrs) => { const d = parseISO(today); d.setFullYear(d.getFullYear() - yrs); return isoDate(d); };
  const PER = { month: [monthEnd(addMonths(monthKey(today), -1)), 'este mes'], ytd: [`${+y - 1}-12-31`, 'en ' + y], '12m': [ago(1), 'en 12 meses'], '3a': [ago(3), 'en 3 años'], '5a': [ago(5), 'en 5 años'], '10a': [ago(10), 'en 10 años'], max: [first, 'desde ' + first.slice(0, 4)] };
  const [p0, perLabel] = PER[UI.period] || PER.ytd; const ytdStart = p0 < first ? first : p0;
  const pYTD = perf(ytdStart, today); const spYTD = spReturn(ytdStart, today);
  const divY = DB.dividends.filter(d => d.date > ytdStart && d.date <= today && inSelPos(posOf(d.position_id) || {}, d.account_id)).reduce((a, d) => { const A = divAmounts(d); a.gross += A.grossEUR; a.net += A.netEUR; return a; }, { gross: 0, net: 0 });
  const intY = sum(DB.operations.filter(o => ['interest', 'stakeReward'].includes(o.type) && o.date > ytdStart && o.date <= today && (o.position_id ? inSelPos(posOf(o.position_id) || {}, o.account_id) : inSelCash(o.account_id))), o => opAmounts(o).grossEUR);
  const cr = UI.period || 'max'; let fromYM = firstYM; const back = { month: 0, ytd: null, '12m': 11, '3a': 35, '5a': 59, '10a': 119 }[cr]; if (cr === 'ytd') fromYM = `${y}-01` > firstYM ? `${y}-01` : firstYM; else if (back != null) fromYM = addMonths(thisYM, -back) > firstYM ? addMonths(thisYM, -back) : firstYM;
  const series = monthlySeries(fromYM, thisYM);
  const byBucket = groupBy(rows, r => r.bucket, k => BUCKETS[k].name, k => BUCKETS[k].color, PALETTE); if (cash) byBucket.push({ k: 'cash', label: 'Efectivo', v: cash, color: COL.cash }); byBucket.sort((a, b) => b.v - a.v);
  const byType = groupBy(rows, r => r.p.type === 'custom' && r.p.custom_type ? r.p.custom_type : r.p.type, k => TYPES[k] || k, (k, i) => typeColor(k, i), PALETTE); if (cash) byType.push({ k: 'cash', label: 'Efectivo', v: cash, color: COL.cash });
  const stale = rows.filter(r => r.stale && r.p.price_mode !== 'manual').length;
  const incid = []; { const al = runChecks(); const n = l => al.filter(x => x.level === l).length; if (n('alta')) incid.push(`${n('alta')} error${n('alta') > 1 ? 'es' : ''}`); if (n('media')) incid.push(`${n('media')} advertencia${n('media') > 1 ? 's' : ''}`); const adj = DB.operations.filter(o => o.type === 'adjust'); if (adj.length) { const v = sum(adj, o => { const p = priceAt(o.position_id, o.date); return Math.abs((o.qty || 0) * (p ? p.price : o.price || 0) * fxAt(posOf(o.position_id)?.currency, o.date)); }); incid.push(`${adj.length} ajuste${adj.length > 1 ? 's' : ''} de conciliación por ${fmtK(v)}`); } if (stale) incid.push(`${stale} precios de hace más de 40 días`); }
  v.innerHTML = `
    <div class="section-head"><div><div class="eyebrow">Patrimonio total · incluye vivienda</div><h2 class="big">${fmtEUR(patrimonio, 0)}</h2><div class="muted" style="font-size:.86rem">Posiciones ${fmtEUR(invTotal, 0)} · efectivo ${fmtEUR(C.cashTotal, 0)} · vivienda ${fmtEUR(vivV, 0)}</div></div>
      <div class="toolbar"><button class="btn primary" id="newop">+ Operación</button><button class="btn" id="newdiv">+ Dividendo</button></div></div>
    <div class="card pad mob-only" id="recs-mobile"><h3 class="tip" tabindex="0" data-tip="${esc(HELP.fase)}">Fase y recomendaciones IA <span class="q">?</span></h3>${phaseLineHTML()}${recommendationsHTML(C)}</div>
    ${filterBarHTML()}
    <div class="eyebrow">¿Cuánto tengo? · ${esc(selDescription())} · ${fmtEUR(total, 0)}</div>
    <div class="kpis">
      <div class="kpi b${kpiTip('k_posiciones')}"><div class="l">Posiciones</div><div class="v">${fmtK(mv)}</div><div class="s">Invertido ${fmtK(cost)}</div></div>
      <div class="kpi ${gain >= 0 ? 'g' : 'r'}${kpiTip('k_gyp_no')}"><div class="l">GyP no realizadas</div><div class="v ${cls(gain)}">${fmtK(gain)}</div><div class="s ${cls(gain)}">${fmtPct(cost ? gain / cost * 100 : 0)}</div></div>
      <div class="kpi ${cash < 0 ? 'r' : ''}${kpiTip('k_efectivo')}"><div class="l">Efectivo</div><div class="v ${cash < 0 ? 'neg' : ''}">${fmtK(cash)}</div><div class="s">${cash < 0 ? 'Descuadre: revisa Cuentas' : 'Aparte de la cartera; cuenta solo con el tipo Efectivo'}</div></div>
      <div class="kpi y${kpiTip('k_twr')}"><div class="l">TWR ${perLabel} frente al S&P 500</div><div class="v ${cls(pYTD.dietz)}">${fmtPct(pYTD.dietz)}</div><div class="s">${spYTD != null ? 'S&P 500 ' + fmtPct(spYTD) + ' · ' : ''}MWR ${fmtPct(pYTD.mwrPeriod)}</div></div>
    </div>
    <div class="eyebrow" style="margin-top:.4rem">¿Cuánto cambió y por qué? · ${perLabel}</div>
    <div class="card pad concil"><div class="concil-row"><span>Valor inicial <b>${fmtK(pYTD.V0)}</b></span><span>+ aportado neto <b class="${cls(pYTD.inflow)}">${fmtK(pYTD.inflow)}</b></span><span>+ resultado <b class="${cls(pYTD.gain)}">${fmtK(pYTD.gain)}</b></span><span>= valor final <b>${fmtK(pYTD.V1)}</b></span><span class="muted">TWR ${fmtPct(pYTD.dietz)} · MWR ${fmtPct(pYTD.mwrPeriod)}${spYTD != null ? ' · S&P 500 ' + fmtPct(spYTD) : ''}</span></div></div>
    <div class="card pad rentas"><div class="eyebrow">Rentas ${perLabel}</div><div class="rentas-row"><div><b>${fmtK(divY.gross)}</b> dividendos y alquileres brutos <span class="muted">(neto ${fmtK(divY.net)})</span></div><div><b>${fmtK(intY)}</b> intereses y staking</div><div><b>${fmtK(sum(rows, r => r.div))}</b> dividendos históricos de las posiciones abiertas</div></div></div>
    ${incid.length ? `<div class="eyebrow" style="margin-top:.4rem">¿Qué requiere revisión?</div><div class="note warn incid"><b>Requiere revisión:</b> ${incid.join(' · ')} <button class="btn sm" id="open-bell">Ver alarmas</button></div>` : ''}
    <div class="card">
      <div class="head"><div>${help('Cartera frente al S&P 500', 'mwrsp')}<div class="sub">${UI.chartMode === 'monthly' ? 'MWR de cada mes' : 'Base 100 desde ' + fmtYM(fromYM)} · ${esc(selDescription())} · índices: ${esc(spBench().label)} e índice compuesto ${BENCH_LEGS.filter(l => benchWeights()[l.id] > 0).map(l => fmtN(benchWeights()[l.id], 1) + ' % ' + l.nm.toLowerCase()).join(' / ')} (pesos en Referencia)</div></div>
        <div class="toolbar"><div class="seg" id="cmode"><button class="${UI.chartMode === 'cum' ? 'on' : ''}" data-m="cum">TWR acumulado</button><button class="${UI.chartMode === 'cummwr' ? 'on' : ''}" data-m="cummwr">MWR acumulado</button><button class="${UI.chartMode === 'monthly' ? 'on' : ''}" data-m="monthly">MWR mensual</button></div>
        <span class="sub">${perLabel}</span></div></div>
      <div class="chartbox tall"><canvas id="ch-mwr"></canvas></div>
    </div>
    <div class="grid2">
      <div class="card"><div class="head">${help('Por cubo', 'cubo')}<span class="sub">Doctrina de los cubos</span></div><div class="donutwrap"><div class="chartbox"><canvas id="ch-b"></canvas></div>${legendHTML(byBucket)}</div></div>
      <div class="card"><div class="head">${help('Por tipo de activo', 'tipo')}</div><div class="donutwrap"><div class="chartbox"><canvas id="ch-t"></canvas></div>${legendHTML(byType)}</div></div>
    </div>
    <div class="card"><div class="head"><h3>Mayores posiciones</h3><span class="sub">${rows.length} posiciones en la selección</span></div>
      <div class="toplist">${rows.slice(0, 10).map(r => `<div class="it" data-hold="${r.accountId}|${r.positionId}"><div><span class="tk">${esc(r.p.ticker)}</span> <span class="nm">${esc(r.p.name)}</span></div><div class="num">${fmtK(r.mvEUR)} <span class="badge ${cls(r.gain)}">${fmtPct(r.gainPct, 1)}</span></div><div class="bar"><b style="width:${mv ? r.mvEUR / mv * 100 : 0}%"></b></div></div>`).join('')}</div>
      <div style="padding:.6rem 1.1rem"><button class="btn sm" id="tocartera">Ver la cartera completa</button></div></div>
    <style>@media (min-width:960px){.mob-only{display:none}}</style>`;
  bindFilterBar();
  const ob = $('#open-bell'); if (ob) ob.onclick = () => $('#bell')?.click();
  $('#newop').onclick = () => openOpForm(); $('#newdiv').onclick = () => openDivForm(); $('#tocartera').onclick = () => go('cartera');
  $('#cmode').onclick = e => { const b = e.target.closest('button'); if (b) { UI.chartMode = b.dataset.m; render(); } };
  $$('[data-hold]', v).forEach(el => el.onclick = () => openHolding(el.dataset.hold, C));
  const labels = series.map(s => fmtYM(s.ym));
  if (UI.chartMode === 'monthly') {
    chart('ch-mwr', { type: 'bar', data: { labels, datasets: [
      { type: 'bar', label: 'Cartera (MWR mensual)', data: series.map(s => s.own), backgroundColor: series.map(s => s.own >= 0 ? '#9FA8DA' : '#EF6C63'), borderRadius: 3, order: 2 },
      { type: 'line', label: spBench().label + ' (mensual)', data: series.map(s => s.sp), borderColor: COL.yellow, backgroundColor: COL.yellow, borderWidth: 1.5, pointRadius: series.length > 40 ? 0 : 3, tension: .3, order: 1 }, avgDataset(series.map(s => s.own), { stat: 'geo' }) ] },
      plugins: [endLabels], options: { layout: { padding: { right: 8 } }, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: { ticks: { callback: pctTick }, grid }, x: { grid: { display: false }, ticks: { maxTicksLimit: 14 } } }, plugins: { endLabels: { fmt: v => fmtPct(v, 2) }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmtPct(c.raw)}` } } } } });
  } else {
    const key = UI.chartMode === 'cummwr' ? 'own' : 'twr';
    const BW = benchWeights();
    // Compuesto con los pesos guardados en Referencia. Si a un mes le falta una pata no se cuenta
    // como 0 %: se deja el hueco, que es lo que de verdad sabemos.
    const comp = new Map(benchComposite(BW, series[0].ym, series[series.length - 1].ym).map(x => [x.ym, x.r]));
    let own = 100, sp = 100, cp = 100; const ownD = [], spD = [], cpD = []; let started = false;
    series.forEach(s => { if (s[key] != null) { own *= 1 + s[key] / 100; started = true; } if (s.sp != null) sp *= 1 + s.sp / 100; const c = comp.get(s.ym); if (c != null) cp *= 1 + c / 100; ownD.push(started ? +own.toFixed(2) : null); spD.push(+sp.toFixed(2)); cpD.push(c == null ? null : +cp.toFixed(2)); });
    chart('ch-mwr', { type: 'line', data: { labels, datasets: [
      { label: UI.chartMode === 'cummwr' ? 'Cartera (MWR)' : 'Cartera (TWR)', data: ownD, borderColor: '#9FA8DA', backgroundColor: 'rgba(159,168,218,.2)', borderWidth: 2.5, fill: true, tension: .3, pointRadius: 0 },
      { label: 'S&P 500', data: spD, borderColor: COL.yellow, backgroundColor: 'transparent', borderWidth: 2, tension: .3, pointRadius: 0 },
      { label: 'Índice compuesto', data: cpD, borderColor: COL.cyan, spanGaps: false, backgroundColor: 'transparent', borderWidth: 1.5, borderDash: [4, 3], tension: .3, pointRadius: 0 } ] },
      plugins: [endLabels], options: { layout: { padding: { right: 8 } }, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: { grid }, x: { grid: { display: false }, ticks: { maxTicksLimit: 14 } } }, plugins: { endLabels: { fmt: v => fmtN(v, 0) } } } });
  }
  donut('ch-b', byBucket); donut('ch-t', byType);
}
