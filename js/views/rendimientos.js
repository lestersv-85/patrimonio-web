import { DB } from '../store.js?v=25c4e9c';
import { $, $$, esc, fmtEUR, fmtK, fmtN, fmtPct, fmtYM, fmtDate, cls, sum, todayISO, monthKey, addMonths, monthEnd, isoDate, parseISO, help, C as COL, kpiTip, addDays } from '../util.js?v=25c4e9c';
import { SEL, selIsAll, inSelPos, inSelCash, perf, monthlySeries, firstOpDate, replay, opAmounts, divAmounts, posOf, benchReturn, spReturn, spBench, viviendaValue, priceAt, fxAt } from '../engine.js?v=25c4e9c';
import { chart, bars, line, grid, pctTick, avgDataset, endLabels } from '../charts.js?v=25c4e9c';
import { openHolding } from '../forms.js?v=25c4e9c';
import { selDescription } from './inicio.js?v=25c4e9c';
import { exportPerfCSV } from '../export.js?v=25c4e9c';

function adjValOf(a, b) {
  return sum(DB.operations.filter(o => o.type === 'adjust' && o.date > a && o.date <= b && inSelPos(posOf(o.position_id) || {}, o.account_id)), o => { const p = priceAt(o.position_id, o.date); const pos = posOf(o.position_id); return (o.qty || 0) * (p ? p.price : (o.price || 0)) * fxAt(pos?.currency, o.date); });
}
export function renderRendimientos(v, C, { UI, render, filterBarHTML, bindFilterBar }) {
  const today = todayISO(); const y = today.slice(0, 4); const first = firstOpDate();
  const ago = (yrs) => { const d = parseISO(today); d.setFullYear(d.getFullYear() - yrs); return isoDate(d); };
  const ranges = { month: [monthEnd(addMonths(monthKey(today), -1)), 'Este mes'], ytd: [`${+y - 1}-12-31`, 'Año ' + y], '12m': [ago(1), '12 meses'], '3a': [ago(3), '3 años'], '5a': [ago(5), '5 años'], '10a': [ago(10), '10 años'], max: [first, 'Desde ' + first.slice(0, 4)] };
  UI.perfRange = UI.period || UI.perfRange; const [a0, rangeLabel] = ranges[UI.perfRange] || ranges.ytd; const a = a0 < first ? first : a0;
  const P = perf(a, today); const sp = spReturn(a, today);
  const rows = C.rows.filter(r => inSelPos(r.p, r.accountId)); let cash = 0; for (const k in C.cashEUR) if (inSelCash(k)) cash += C.cashEUR[k];
  const selPos = (pid, acc) => { const p = posOf(pid); return p && inSelPos(p, acc); };
  const opsIn = DB.operations.filter(o => o.date > a && o.date <= today); const divsIn = DB.dividends.filter(d => d.date > a && d.date <= today);
  const buys = sum(opsIn.filter(o => ['buy', 'optionBuy'].includes(o.type) && selPos(o.position_id, o.account_id)), o => opAmounts(o).totalEUR);
  const sells = sum(opsIn.filter(o => ['sell', 'optionSell'].includes(o.type) && selPos(o.position_id, o.account_id)), o => opAmounts(o).totalEUR);
  const Rall = replay(today), Rstart = replay(a);
  const realizedOf = R => sum(Object.values(R.H).filter(h => selPos(h.positionId, h.accountId)), h => h.realized);
  const realized = realizedOf(Rall) - realizedOf(Rstart);
  const dIn = divsIn.filter(d => selPos(d.position_id, d.account_id)); const divG = sum(dIn, d => divAmounts(d).grossEUR), divN = sum(dIn, d => divAmounts(d).netEUR);
  const inter = sum(opsIn.filter(o => o.type === 'interest' && (o.position_id ? selPos(o.position_id, o.account_id) : inSelCash(o.account_id))), o => opAmounts(o).grossEUR);
  const rew = sum(opsIn.filter(o => o.type === 'stakeReward' && selPos(o.position_id, o.account_id)), o => opAmounts(o).grossEUR);
  const fees = sum(opsIn.filter(o => o.type === 'commission' && (o.position_id ? selPos(o.position_id, o.account_id) : inSelCash(o.account_id))), o => opAmounts(o).grossEUR) + sum(opsIn.filter(o => ['buy', 'sell', 'optionBuy', 'optionSell'].includes(o.type) && selPos(o.position_id, o.account_id)), o => { const A = opAmounts(o); return A.commEUR + A.taxEUR; }) + sum(dIn, d => divAmounts(d).commEUR);
  const cost = sum(rows, r => r.costEUR), mv = sum(rows, r => r.mvEUR); const unreal = mv - cost;
  const yearDivs = sum(DB.dividends.filter(d => d.date.startsWith(y) && selPos(d.position_id, d.account_id)), d => divAmounts(d).grossEUR);
  // series
  const thisYM = monthKey(today); const firstYM = monthKey(first); const fromYM = UI.perfRange === 'ytd' ? (`${y}-01` > firstYM ? `${y}-01` : firstYM) : UI.perfRange === 'month' ? thisYM : UI.perfRange === 'max' ? firstYM : (addMonths(thisYM, UI.perfRange === '10a' ? -119 : UI.perfRange === '5a' ? -59 : UI.perfRange === '3a' ? -35 : -11) > firstYM ? addMonths(thisYM, UI.perfRange === '10a' ? -119 : UI.perfRange === '5a' ? -59 : UI.perfRange === '3a' ? -35 : -11) : firstYM);
  const series = monthlySeries(fromYM, thisYM); const months = series.map(s => s.ym);
  const perMonth = (arr, dateOf, val) => months.map(m => sum(arr.filter(x => monthKey(dateOf(x)) === m), val));
  const buysM = perMonth(DB.operations.filter(o => ['buy', 'optionBuy'].includes(o.type) && selPos(o.position_id, o.account_id)), o => o.date, o => opAmounts(o).totalEUR);
  const sellsM = perMonth(DB.operations.filter(o => ['sell', 'optionSell'].includes(o.type) && selPos(o.position_id, o.account_id)), o => o.date, o => opAmounts(o).totalEUR);
  const divsM = perMonth(DB.dividends.filter(d => selPos(d.position_id, d.account_id)), d => d.date, d => divAmounts(d).grossEUR);
  // MWR por año (calculado) y de Filios
  const years = []; for (let yy = +first.slice(0, 4); yy <= +y; yy++) years.push(String(yy));
  const filiosMWR = {}; (DB.filiosHistory || []).filter(h => h.scope === 'all' && /^\d{4}$/.test(h.period) && h.mwr != null).forEach(h => filiosMWR[h.period] = h.mwr);
  const yearRows = years.map(yy => { const s = `${yy - 1}-12-31` < first ? first : `${yy - 1}-12-31`; const e = yy === y ? today : `${yy}-12-31`; const p = perf(s, e); const pf = selIsAll() ? perf(s, e, { vivienda: true }) : null; return { yy, mwr: p.mwrPeriod, mwrAnual: yy === y ? p.mwr : null, twr: p.dietz, sp: spReturn(s, e), mwrViv: pf ? pf.mwrPeriod : null, filios: filiosMWR[yy] ?? null, V1: p.V1, inflow: p.inflow, gain: p.gain }; });
  // Validación contra Filios (mensual, solo con Todo)
  const fh = (DB.filiosHistory || []).filter(h => h.scope === 'all' && /^\d{4}-\d{2}$/.test(h.period)).sort((a, b) => a.period.localeCompare(b.period));
  // Filios valora posiciones de inversión + Casa 98 (precio manual) y sin caja: se compara con la misma magnitud; el TWR de Filios está diluido por la vivienda (valor constante), así que el nuestro se diluye igual
  const valRows = selIsAll() ? fh.map(h => { const s = series.find(x => x.ym === h.period) || monthlySeries(h.period, h.period)[0]; const endD = monthEnd(h.period) < today ? monthEnd(h.period) : today; const viv = sum(viviendaValue(endD), r => r.mvEUR); const ours = s?.value != null ? s.value + viv : null; const twrOurs = s?.twr != null && s.V0 ? s.twr * s.V0 / (s.V0 + viv) : null; return { ...h, ours, twrOurs, viv }; }) : [];
  const adjValPre = adjValOf(a, today);
  // Desglose del rendimiento del periodo (idea de getquin): precio, dividendos, intereses, realizado, costes
  const priceGain = P.gain - adjValPre - divN - realized;
  const baseCap = Math.max(1, P.V0 + Math.max(0, P.inflow));
  // Dividendos: últimos 12 meses (TTM), previsión de los próximos 12 según lo cobrado por cada posición abierta
  const ttmStart = addDays(today, -365);
  const ttm = DB.dividends.filter(d => d.date > ttmStart && d.date <= today && selPos(d.position_id, d.account_id));
  const ttmG = sum(ttm, d => divAmounts(d).grossEUR);
  const held = {}; rows.forEach(r => { held[r.positionId] = (held[r.positionId] || 0) + r.qty; });
  const fc = {}; for (const d of ttm) { if (!held[d.position_id]) continue; const A = divAmounts(d); const ps = A.grossEUR / (d.shares || 1); const f = fc[d.position_id] = fc[d.position_id] || { p: posOf(d.position_id), perShare: 0, n: 0, last: d.date, months: new Set() }; f.perShare += ps; f.n++; if (d.date > f.last) f.last = d.date; f.months.add(+d.date.slice(5, 7)); }
  const forecast = Object.values(fc).map(f => ({ ...f, est: f.perShare * (held[f.p.id] || 0) })).sort((x, y) => y.est - x.est);
  const fcTotal = sum(forecast, f => f.est);
  const yocBase = sum(rows.filter(r => fc[r.positionId]), r => r.costEUR);
  // calendario: meses de los próximos 12 en que se espera cobro (repite el patrón de los últimos 12)
  const cal = Array.from({ length: 12 }, (_, i) => { const ym = addMonths(monthKey(today), i + 1); const m = +ym.slice(5, 7); return { ym, v: sum(forecast.filter(f => f.months.has(m)), f => f.est / f.n) }; });
  // dividendos por año natural (con crecimiento interanual)
  const byYear = {}; DB.dividends.filter(d => selPos(d.position_id, d.account_id)).forEach(d => { const yy = d.date.slice(0, 4); byYear[yy] = (byYear[yy] || 0) + divAmounts(d).grossEUR; });
  const divYears = Object.keys(byYear).sort().map((yy, i, arr) => ({ yy, v: byYear[yy], yoy: i && byYear[arr[i - 1]] ? (byYear[yy] / byYear[arr[i - 1]] - 1) * 100 : null }));
  // Ajustes de conciliación dentro del periodo: hacen provisionales las cifras y se muestran aparte
  const adjIn = DB.operations.filter(o => o.type === 'adjust' && o.date > a && o.date <= today && inSelPos(posOf(o.position_id) || {}, o.account_id));
  const adjVal = sum(adjIn, o => { const p = priceAt(o.position_id, o.date); const pos = posOf(o.position_id); return (o.qty || 0) * (p ? p.price : (o.price || 0)) * fxAt(pos?.currency, o.date); });
  // Residuos (polvo de cripto, restos de fracciones) no son posiciones abiertas: fuera de la tabla
  const posRows = rows.filter(r => Math.abs(r.mvEUR) >= 1 || Math.abs(r.costEUR) >= 1).sort((a, b) => b.gainPct - a.gainPct);
  v.innerHTML = `
    <div class="section-head"><div><div class="eyebrow">Rendimientos · ${esc(selDescription())}</div><h2>${rangeLabel}${adjIn.length ? ` <span class="badge warn" title="${esc(adjIn.map(o => fmtDate(o.date) + ' ' + (posOf(o.position_id)?.ticker || '') + ' ' + fmtN(o.qty, 3)).join(' · '))}">provisional: ${adjIn.length} ajuste${adjIn.length > 1 ? 's' : ''} por ${fmtK(adjVal)}</span>` : ''}</h2></div>
      <div class="toolbar"><div class="seg" id="prange">${Object.entries(ranges).map(([k, [, l]]) => `<button class="${UI.perfRange === k ? 'on' : ''}" data-r="${k}">${l}</button>`).join('')}</div><button class="btn sm" id="csvperf">CSV mensual</button></div></div>
    ${filterBarHTML()}
    <div class="card pad concil"><div class="eyebrow">Conciliación del periodo</div><div class="concil-row"><span>Valor inicial <b>${fmtK(P.V0)}</b></span><span>+ aportado neto <b class="${cls(P.inflow)}">${fmtK(P.inflow)}</b></span><span>+ resultado de inversión <b class="${cls(P.gain - adjVal)}">${fmtK(P.gain - adjVal)}</b></span>${adjIn.length ? `<span>+ ajustes de conciliación <b>${fmtK(adjVal)}</b></span>` : ''}<span>= valor final <b>${fmtK(P.V1)}</b></span></div><div class="muted" style="font-size:.76rem;margin-top:.25rem">Posiciones de la selección, sin efectivo salvo que elijas el tipo Efectivo. El aportado neto son compras menos ventas y dividendos cobrados; el resultado incluye precio, cambio y rentas retenidas en las posiciones.</div></div>
    <div class="grid2">
      <div class="card"><div class="head">${help('Desglose del rendimiento', 'Qué es: de dónde sale el resultado del periodo. Ganancia de precio (variación de valor de lo que sigue en cartera, cambio incluido), dividendos y cupones netos cobrados, ganancia realizada en ventas (precio medio), menos comisiones e impuestos. Qué te dice: si la cartera vive del precio, de las rentas o de la rotación. Los porcentajes son sobre el capital del periodo (valor inicial más aportaciones).')}</div><div class="tablewrap"><table class="breakdown"><tbody>
        <tr><td>Capital del periodo</td><td class="num"></td><td class="num">${fmtEUR(baseCap, 0)}</td></tr>
        <tr><td>Ganancia de precio (no realizada)</td><td class="num ${cls(priceGain)}">${fmtPct(priceGain / baseCap * 100, 2)}</td><td class="num ${cls(priceGain)}">${fmtEUR(priceGain, 0)}</td></tr>
        <tr><td>Dividendos y cupones (netos)</td><td class="num pos">${fmtPct(divN / baseCap * 100, 2)}</td><td class="num pos">${fmtEUR(divN, 0)}</td></tr>
        <tr><td>Intereses y staking</td><td class="num pos">${fmtPct(inter / baseCap * 100, 2)}</td><td class="num pos">${fmtEUR(inter, 0)}</td></tr>
        <tr><td>Ganancia realizada en ventas</td><td class="num ${cls(realized)}">${fmtPct(realized / baseCap * 100, 2)}</td><td class="num ${cls(realized)}">${fmtEUR(realized, 0)}</td></tr>
        <tr><td>Comisiones e impuestos</td><td class="num neg">${fmtPct(-fees / baseCap * 100, 2)}</td><td class="num neg">${fmtEUR(-fees, 0)}</td></tr>
        <tr class="total"><td>Resultado de inversión</td><td class="num ${cls(P.gain - adjValPre)}">${fmtPct((P.gain - adjValPre) / baseCap * 100, 2)}</td><td class="num ${cls(P.gain - adjValPre)}">${fmtEUR(P.gain - adjValPre, 0)}</td></tr>
      </tbody></table></div></div>
      <div class="card"><div class="head">${help('Dividendos: últimos 12 meses y previsión', 'Qué es: lo cobrado en los últimos 12 meses (TTM) y una previsión de los próximos 12 que repite, posición por posición, lo cobrado por acción en el último año multiplicado por las acciones que tienes hoy. Qué te dice: la renta que cabe esperar si nadie recorta el dividendo. Yield sobre coste = previsión entre lo invertido en esas posiciones.')}<span class="sub">Estimación, no promesa</span></div>
        <div class="pad" style="padding:.4rem 1.1rem .6rem"><div class="rentas-row"><div><b>${fmtK(ttmG)}</b> cobrados TTM</div><div><b>${fmtK(fcTotal)}</b> previstos 12 m</div><div><b>${yocBase ? fmtN(fcTotal / yocBase * 100, 2) + ' %' : '—'}</b> yield sobre coste</div><div><b>${mv ? fmtN(fcTotal / mv * 100, 2) + ' %' : '—'}</b> sobre valor actual</div></div></div>
        <div class="chartbox short"><canvas id="ch-divcal"></canvas></div>
        <div class="tablewrap"><table><thead><tr><th>Posición</th><th class="num">Pagos/año</th><th class="num">Últ. 12 m</th><th class="num">Previsto 12 m</th></tr></thead><tbody>${forecast.slice(0, 8).map(f => `<tr><td><span class="tk">${esc(f.p.ticker)}</span></td><td class="num">${f.n}</td><td class="num">${fmtEUR(f.perShare * (held[f.p.id] || 0), 0)}</td><td class="num">${fmtEUR(f.est, 0)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Sin dividendos en los últimos 12 meses</td></tr>'}${forecast.length > 8 ? `<tr><td colspan="4" class="muted">+${forecast.length - 8} posiciones más</td></tr>` : ''}</tbody></table></div>
      </div>
    </div>
    <div class="card"><div class="head">${help('Dividendos por año', 'Qué es: dividendos y cupones brutos cobrados en cada año natural por la selección. Qué te dice: si la renta crece; el porcentaje es el crecimiento interanual.')}</div><div class="chartbox short"><canvas id="ch-divyear"></canvas></div></div>
    <div class="kpis">
      <div class="kpi y${kpiTip('k_mwr')}"><div class="l">MWR</div><div class="v ${cls(P.mwrPeriod)}">${fmtPct(P.mwrPeriod)}</div><div class="s">${P.mwr != null ? 'Anualizada ' + fmtPct(P.mwr) : 'Sin datos suficientes'}${sp != null ? ' · S&P ' + fmtPct(sp) : ''}</div></div>
      <div class="kpi b${kpiTip('k_twr')}"><div class="l">TWR (Dietz mod.)</div><div class="v ${cls(P.dietz)}">${fmtPct(P.dietz)}</div><div class="s">Neutraliza entradas y salidas</div></div>
      <div class="kpi"><div class="l">RoR (crecimiento)</div><div class="v ${cls(P.ror)}">${fmtPct(P.ror)}</div><div class="s">De ${fmtK(P.V0)} a ${fmtK(P.V1)}</div></div>
      <div class="kpi ${P.gain >= 0 ? 'g' : 'r'}${kpiTip('k_ganancia')}"><div class="l">Ganancia del periodo</div><div class="v ${cls(P.gain)}">${fmtK(P.gain)}</div><div class="s">Aportado neto ${fmtK(P.inflow)}</div></div>
      <div class="kpi ${realized >= 0 ? 'g' : 'r'}${kpiTip('k_gyp_real')}"><div class="l">G/P realizadas</div><div class="v ${cls(realized)}">${fmtK(realized)}</div><div class="s">Compras ${fmtK(buys)} · Ventas ${fmtK(sells)}</div></div>
      <div class="kpi ${unreal >= 0 ? 'g' : 'r'}${kpiTip('k_gyp_no')}"><div class="l">G/P no realizadas</div><div class="v ${cls(unreal)}">${fmtK(unreal)}</div><div class="s">${fmtPct(cost ? unreal / cost * 100 : 0)} sobre invertido</div></div>
      <div class="kpi p${kpiTip('k_divs')}"><div class="l">Dividendos y cupones</div><div class="v">${fmtK(divG)}</div><div class="s">Neto ${fmtK(divN)} · yield ${y} ${fmtN(cost ? yearDivs / cost * 100 : 0, 2)} %</div></div>
      <div class="kpi"><div class="l">Intereses y recompensas</div><div class="v">${fmtK(inter + rew)}</div><div class="s">Intereses ${fmtK(inter)} · stake ${fmtK(rew)}</div></div>
      <div class="kpi r${kpiTip('k_fees')}"><div class="l">Comisiones e impuestos</div><div class="v neg">${fmtK(fees)}</div><div class="s">Operaciones, dividendos y gastos</div></div>
    </div>
    <div class="grid2">
      <div class="card"><div class="head">${help('MWR mensual', 'mwr')}<span class="sub">${fmtYM(fromYM)} a ${fmtYM(thisYM)} · línea: media geométrica</span></div><div class="chartbox"><canvas id="ch-mwr"></canvas></div></div>
      <div class="card"><div class="head">${help('TWR mensual (Dietz)', 'twr')}<span class="sub">Línea discontinua: media geométrica</span></div><div class="chartbox"><canvas id="ch-twr"></canvas></div></div>
      <div class="card"><div class="head">${help('Evolución del valor', 'valor')}<span class="sub">Fin de mes · discontinua: aportado</span></div><div class="chartbox"><canvas id="ch-val"></canvas></div></div>
      <div class="card"><div class="head">${help('Compras y ventas por mes', 'compras')}<span class="sub">Discontinua: mediana de compras</span></div><div class="chartbox"><canvas id="ch-bs"></canvas></div></div>
      <div class="card"><div class="head">${help('Dividendos y cupones por mes', 'dividendos')}<span class="sub">Bruto · discontinua: media mensual</span></div><div class="chartbox"><canvas id="ch-div"></canvas></div></div>
      <div class="card"><div class="head">${help('Rentabilidad por año', 'anual')}<span class="sub">Cartera de inversión sin efectivo · «con Casa 98» usa el perímetro de Filios (vivienda incluida, sin efectivo) · el MWR del año en curso es del periodo; Filios lo anualiza</span></div><div class="tablewrap"><table class="anual"><thead><tr><th>Año</th><th class="num">MWR</th><th class="num">TWR</th><th class="num">${esc(spBench().label)}</th><th class="num">MWR con Casa 98</th><th class="num">MWR Filios</th><th class="num">Aportado</th><th class="num">Ganancia</th><th class="num">Valor fin</th></tr></thead><tbody>
        ${yearRows.map(r => `<tr><td>${r.yy}</td><td class="num ${cls(r.mwr)}">${fmtPct(r.mwr)}${r.mwrAnual != null ? `<div class="muted" style="font-size:.72rem" title="Anualizada: es la cifra que muestra Filios en el año en curso">anual. ${fmtPct(r.mwrAnual)}</div>` : ''}</td><td class="num ${cls(r.twr)}">${fmtPct(r.twr)}</td><td class="num ${cls(r.sp)}">${fmtPct(r.sp)}</td><td class="num ref">${r.mwrViv != null ? fmtPct(r.mwrViv) : '—'}</td><td class="num ref">${r.filios != null ? fmtPct(r.filios) : '—'}</td><td class="num">${fmtK(r.inflow)}</td><td class="num ${cls(r.gain)}">${fmtK(r.gain)}</td><td class="num">${fmtK(r.V1)}</td></tr>`).join('')}
      </tbody></table></div></div>
    </div>
    ${valRows.length ? `<div class="card"><div class="head"><h3>Validación contra Filios</h3><span class="sub">Misma magnitud que Filios: posiciones + Casa 98, sin efectivo; TWR diluido por la vivienda</span></div><div class="tablewrap"><table><thead><tr><th>Mes</th><th class="num">Valor Filios</th><th class="num">Valor aquí</th><th class="num">Dif.</th><th class="num">TWR Filios</th><th class="num">TWR aquí</th><th class="num">Dif. pp</th></tr></thead><tbody>
      ${valRows.map(r => `<tr><td>${fmtYM(r.period)}</td><td class="num">${fmtEUR(r.value, 0)}</td><td class="num">${fmtEUR(r.ours, 0)}</td><td class="num ${r.ours != null && Math.abs(r.ours - r.value) / r.value > 0.01 ? 'warn' : ''}">${r.ours != null ? fmtPct((r.ours / r.value - 1) * 100, 1) : '—'}</td><td class="num">${fmtPct(r.twr)}</td><td class="num">${fmtPct(r.twrOurs)}</td><td class="num ${r.twrOurs != null && r.twr != null && Math.abs(r.twrOurs - r.twr) > 0.3 ? 'warn' : ''}">${r.twrOurs != null && r.twr != null ? fmtN(r.twrOurs - r.twr, 2) : '—'}</td></tr>`).join('')}
    </tbody></table></div></div>` : ''}
    <div class="card"><div class="head"><h3>Rentabilidad por posición</h3><span class="sub">Selección actual · abiertas</span></div><div class="tablewrap"><table><thead><tr><th>Posición</th><th>Cubo</th><th class="num">Valor (€)</th><th class="num">GyP no realiz.</th><th class="num">GyP %</th><th class="num">Realizadas</th><th class="num">Dividendos</th><th class="num">Rent. total %</th></tr></thead><tbody>
      ${posRows.map(r => { const tot = r.gain + r.realized + r.div; const base = r.costEUR + r.sold; return `<tr class="row" data-hold="${r.accountId}|${r.positionId}"><td><span class="tk">${esc(r.p.ticker)}</span><span class="nm">${esc(r.p.name)}</span></td><td><span class="tag b${r.bucket}">${r.bucket}</span></td><td class="num">${fmtEUR(r.mvEUR, 0)}</td><td class="num ${cls(r.gain)}">${fmtEUR(r.gain, 0)}</td><td class="num ${cls(r.gain)}">${fmtPct(r.gainPct, 1)}</td><td class="num ${cls(r.realized)}">${fmtEUR(r.realized, 0)}</td><td class="num">${fmtEUR(r.div, 0)}</td><td class="num ${cls(tot)}">${fmtPct(base ? tot / base * 100 : 0, 1)}</td></tr>`; }).join('') || '<tr><td colspan="8" class="empty">Sin posiciones en la selección.</td></tr>'}
    </tbody></table></div></div>`;
  bindFilterBar();
  $('#prange').onclick = e => { const b = e.target.closest('button'); if (b) { UI.perfRange = b.dataset.r; UI.period = b.dataset.r; render(); } };
  $('#csvperf').onclick = () => exportPerfCSV(series);
  $$('[data-hold]', v).forEach(el => el.onclick = () => openHolding(el.dataset.hold, C));
  const labels = months.map(fmtYM);
  bars('ch-mwr', labels, series.map(s => s.own), { pct: true, stat: 'geo' }); bars('ch-twr', labels, series.map(s => s.twr), { pct: true, stat: 'geo' });
  // Referencia del valor: capital aportado (valor al inicio del periodo más entradas netas acumuladas); la distancia hasta el valor es la ganancia
  const base = []; let acc = series.length ? (series[0].V0 || 0) : 0; series.forEach(s => { acc += (s.inflow || 0); base.push(acc); });
  line('ch-val', labels, [{ label: 'Valor', data: series.map(s => s.value), borderColor: '#9FA8DA', backgroundColor: 'rgba(159,168,218,.18)', borderWidth: 2, fill: true, pointRadius: 0 }, { label: 'Aportado', data: base, borderColor: COL.yellow, borderDash: [6, 4], borderWidth: 1.5, fill: false, pointRadius: 0 }], { money: true });
  chart('ch-bs', { type: 'bar', data: { labels, datasets: [{ label: 'Compras', data: buysM, backgroundColor: '#9FA8DA', borderRadius: 3 }, { label: 'Ventas', data: sellsM, backgroundColor: COL.yellow, borderRadius: 3 }, avgDataset(buysM, { stat: 'median', label: 'Mediana compras' })] }, plugins: [endLabels], options: { layout: { padding: { right: 8 } }, maintainAspectRatio: false, scales: { y: { ticks: { callback: v => fmtK(v) }, grid }, x: { grid: { display: false }, ticks: { maxTicksLimit: 14 } } }, plugins: { endLabels: { fmt: v => fmtK(v) }, legend: { position: 'top' }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmtEUR(c.raw, 0)}` } } } } });
  bars('ch-div', labels, divsM, { colorPos: COL.yellow2, stat: 'mean', label: 'Media mensual' });
  bars('ch-divcal', cal.map(c => fmtYM(c.ym)), cal.map(c => c.v), { colorPos: '#FFF59D', avg: false });
  chart('ch-divyear', { type: 'bar', data: { labels: divYears.map(d => d.yy), datasets: [{ label: 'Dividendos brutos', data: divYears.map(d => d.v), backgroundColor: COL.yellow, borderRadius: 4 }] }, options: { maintainAspectRatio: false, scales: { y: { ticks: { callback: v => fmtK(v) }, grid }, x: { grid: { display: false } } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${fmtEUR(c.raw, 0)}${divYears[c.dataIndex].yoy != null ? ' · ' + fmtPct(divYears[c.dataIndex].yoy, 1) + ' interanual' : ''}` } } } } });
}
