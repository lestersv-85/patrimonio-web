// Análisis: atribución por posición, concentración, divisa, caída máxima, volatilidad, costes, rotación, escenarios y calidad de datos.
// Cada bloque declara método y cobertura. Nada aquí es una predicción.
import { DB, saveSettings } from '../store.js?v=25c4e9c';
import { $, $$, esc, fmtEUR, fmtK, fmtN, fmtPct, fmtDate, fmtYM, cls, sum, todayISO, daysBetween, monthKey, addMonths, parseISO, isoDate, monthEnd, help, toast, num, BUCKETS, TYPES } from '../util.js?v=25c4e9c';
import { compute, inSelPos, inSelCash, selIsAll, monthlySeries, firstOpDate, perf, acctName, acctOf, opAmounts, divAmounts, posOf, replay } from '../engine.js?v=25c4e9c';
import { chart, bars, grid, endLabels } from '../charts.js?v=25c4e9c';
import { selDescription } from './inicio.js?v=25c4e9c';

export function renderAnalisis(v, C, { UI, render, filterBarHTML, bindFilterBar }) {
  const today = todayISO(); const y = today.slice(0, 4); const first = firstOpDate();
  const ago = (yrs) => { const d = parseISO(today); d.setFullYear(d.getFullYear() - yrs); return isoDate(d); };
  const PER = { month: [monthEnd(addMonths(monthKey(today), -1)), 'este mes'], ytd: [`${+y - 1}-12-31`, 'en ' + y], '12m': [ago(1), 'en 12 meses'], '3a': [ago(3), 'en 3 años'], '5a': [ago(5), 'en 5 años'], '10a': [ago(10), 'en 10 años'], max: [first, 'desde ' + first.slice(0, 4)] };
  const [p0, perLabel] = PER[UI.period] || PER.ytd; const a = p0 < first ? first : p0;
  const rows = C.rows.filter(r => inSelPos(r.p, r.accountId)); const mv = sum(rows, r => r.mvEUR);
  // ---- Atribución por posición en el periodo: variación de (GyP no realizada + realizada + dividendos) entre inicio y hoy
  const C0 = compute(a); const k = r => r.accountId + '|' + r.positionId;
  const at0 = {}; C0.rows.forEach(r => { at0[k(r)] = r.gain + r.realized + r.div; });
  const seen = new Set(); const attr = [];
  for (const r of rows) { seen.add(k(r)); attr.push({ r, c: (r.gain + r.realized + r.div) - (at0[k(r)] || 0) }); }
  for (const r of C0.rows.filter(r => inSelPos(r.p, r.accountId) && !seen.has(k(r)))) { const RH = replay(today).H[k(r)]; if (RH) attr.push({ r, c: (RH.realized + RH.div - (RH.qty ? 0 : 0)) - (r.gain + r.realized + r.div), closed: true }); }
  attr.sort((x, y2) => y2.c - x.c); const attrTot = sum(attr, x => x.c);
  // ---- Concentración
  const sorted = [...rows].sort((x, y2) => y2.mvEUR - x.mvEUR); const topN = n => sum(sorted.slice(0, n), r => r.mvEUR) / (mv || 1) * 100;
  const byAcc = {}; rows.forEach(r => byAcc[r.accountId] = (byAcc[r.accountId] || 0) + r.mvEUR); const topAcc = Object.entries(byAcc).sort((x, y2) => y2[1] - x[1])[0];
  const byCountry = {}; rows.forEach(r => { const c = r.p.region || r.p.country || 'Sin región'; byCountry[c] = (byCountry[c] || 0) + r.mvEUR; }); const topCountry = Object.entries(byCountry).sort((x, y2) => y2[1] - x[1])[0];
  // ---- Divisa: exposición económica por divisa de cotización y efecto del cambio en el periodo
  const byCcy = {}; rows.forEach(r => byCcy[r.p.currency] = (byCcy[r.p.currency] || 0) + r.mvEUR);
  const fxEff = sum(rows.filter(r => r.p.currency !== 'EUR'), r => { const avgFx = r.avg ? r.avgEUR / r.avg : r.fx; return r.qty * r.avg * (r.fx - avgFx); });
  // ---- Serie mensual TWR (desde el inicio) → caída máxima, tiempo bajo máximos, volatilidad
  const series = monthlySeries(monthKey(first), monthKey(today)); let idx = 100, peak = 100, maxDD = 0, cur = 0, peakYM = null, ddStart = null, longest = 0, under = 0; const idxSeries = [];
  const twrs = [];
  for (const s of series) { if (s.twr == null) { idxSeries.push(null); continue; } twrs.push(s.twr); idx *= 1 + s.twr / 100; idxSeries.push(+idx.toFixed(2)); if (idx >= peak) { peak = idx; peakYM = s.ym; under = 0; } else { under++; longest = Math.max(longest, under); } const dd = (idx / peak - 1) * 100; if (dd < maxDD) { maxDD = dd; ddStart = peakYM; } cur = dd; }
  const mean = twrs.length ? twrs.reduce((x, y2) => x + y2, 0) / twrs.length : 0; const sd = twrs.length > 1 ? Math.sqrt(twrs.reduce((x, y2) => x + (y2 - mean) ** 2, 0) / (twrs.length - 1)) : 0; const vol = sd * Math.sqrt(12);
  const last12 = twrs.slice(-12); const m12 = last12.length ? last12.reduce((x, y2) => x + y2, 0) / last12.length : 0; const vol12 = last12.length > 1 ? Math.sqrt(last12.reduce((x, y2) => x + (y2 - m12) ** 2, 0) / (last12.length - 1)) * Math.sqrt(12) : 0;
  // ---- Costes y rotación en el periodo
  const P = perf(a, today); const opsIn = DB.operations.filter(o => o.date > a && o.date <= today && (o.position_id ? inSelPos(posOf(o.position_id) || {}, o.account_id) : inSelCash(o.account_id)));
  const fees = sum(opsIn.filter(o => ['buy', 'sell', 'optionBuy', 'optionSell'].includes(o.type)), o => opAmounts(o).commEUR + opAmounts(o).taxEUR) + sum(opsIn.filter(o => o.type === 'commission'), o => opAmounts(o).grossEUR) + sum(DB.dividends.filter(d => d.date > a && d.date <= today && inSelPos(posOf(d.position_id) || {}, d.account_id)), d => divAmounts(d).commEUR || 0);
  const traded = sum(opsIn.filter(o => ['buy', 'sell', 'optionBuy', 'optionSell'].includes(o.type)), o => opAmounts(o).totalEUR);
  const avgCap = (P.V0 + P.V1) / 2 || 1; const days = Math.max(1, daysBetween(a, today));
  // ---- Escenarios (configurables, guardados en Ajustes)
  const sc = Object.assign({ rv: -20, cripto: -30, usd: -10, inm: -15, rf: -3 }, DB.settings?.scenarios || {});
  const impact = { rv: sum(rows.filter(r => r.bucket === 1), r => r.mvEUR) * sc.rv / 100, cripto: sum(rows.filter(r => r.p.type === 'crypto' && !['USDT', 'USDC', 'USDX'].includes(r.p.ticker)), r => r.mvEUR) * sc.cripto / 100, usd: sum(rows.filter(r => r.p.currency === 'USD'), r => r.mvEUR) * sc.usd / 100, inm: sum(rows.filter(r => r.p.type === 'custom'), r => r.mvEUR) * sc.inm / 100, rf: sum(rows.filter(r => r.bucket === 3 && r.p.type !== 'cash'), r => r.mvEUR) * sc.rf / 100 };
  const impTot = Object.values(impact).reduce((x, y2) => x + y2, 0);
  // ---- Calidad de datos
  const fresh = sum(rows.filter(r => !r.stale || r.p.price_mode === 'manual'), r => r.mvEUR); const classified = sum(rows.filter(r => r.p.bucket && (r.bucket !== 1 || r.p.drawer)), r => r.mvEUR); const sectored = sum(rows.filter(r => r.p.sector || r.p.type === 'cash'), r => r.mvEUR);
  const adj = DB.operations.filter(o => o.type === 'adjust').length;
  v.innerHTML = `
    <div class="section-head"><div><div class="eyebrow">Análisis · ${esc(selDescription())}</div><h2>Riesgo, atribución y calidad · ${perLabel}</h2></div></div>
    ${filterBarHTML()}
    <div class="kpis">
      <div class="kpi r tip" tabindex="0" data-tip="Qué es: la mayor caída desde un máximo de la serie mensual TWR (ajustada por flujos, desde el inicio). Qué te dice: cuánto ha llegado a perder la gestión de la cartera y cuánto lleva ahora bajo máximos. Método: Dietz modificado encadenado por meses; activos tasados a mano suavizan la cifra."><div class="l">Caída máxima</div><div class="v neg">${fmtPct(maxDD, 1)}</div><div class="s">${ddStart ? 'desde ' + fmtYM(ddStart) : ''} · ahora ${fmtPct(cur, 1)} bajo máximos · máx. ${longest} meses sin recuperar</div></div>
      <div class="kpi y tip" tabindex="0" data-tip="Qué es: desviación típica de la rentabilidad mensual TWR, anualizada (×√12). Qué te dice: cuánto oscila la cartera; comparable con un índice (el S&P 500 ronda el 15-18 %). Cobertura: ${twrs.length} meses; las tasaciones manuales la rebajan artificialmente."><div class="l">Volatilidad anualizada</div><div class="v">${fmtN(vol, 1)} %</div><div class="s">Últimos 12 meses ${fmtN(vol12, 1)} % · ${twrs.length} meses de datos</div></div>
      <div class="kpi b tip" tabindex="0" data-tip="Qué es: peso de la mayor posición y de las 5 y 10 mayores sobre la selección. Qué te dice: dependencia de pocos nombres; en la doctrina ninguna acción supera el 15 % del bloque."><div class="l">Concentración</div><div class="v">${fmtN(topN(1), 0)} / ${fmtN(topN(5), 0)} / ${fmtN(topN(10), 0)} %</div><div class="s">Top 1 · 5 · 10${sorted[0] ? ' · mayor: ' + esc(sorted[0].p.ticker) : ''}${topAcc ? ' · custodio ' + esc(acctName(topAcc[0])) + ' ' + fmtN(topAcc[1] / (mv || 1) * 100, 0) + ' %' : ''}</div></div>
      <div class="kpi p tip" tabindex="0" data-tip="Qué es: comisiones e impuestos de operar en el periodo sobre el capital medio, y volumen negociado (compras más ventas) sobre el capital medio, ambos anualizados. Qué te dice: el lastre de costes y cuánto se rota la cartera."><div class="l">Coste y rotación</div><div class="v">${fmtN(fees / avgCap * 365 / days * 100, 2)} %</div><div class="s">${fmtEUR(fees, 0)} de costes · rotación ${fmtN(traded / avgCap * 365 / days * 100, 0) } % anual</div></div>
    </div>
    <div class="grid2">
      <div class="card"><div class="head">${help('Atribución por posición', 'Qué es: cuánto ha aportado cada posición al resultado del periodo, en euros: variación de su ganancia no realizada más lo realizado y los dividendos. Qué te dice: qué explica la rentabilidad total; la suma coincide con el resultado de inversión salvo intereses de caja y costes de cuenta. Se muestran las 12 mayores contribuciones positivas y negativas.')}<span class="sub">Total ${fmtEUR(attrTot, 0)}</span></div><div class="chartbox tall"><canvas id="ch-attr"></canvas></div></div>
      <div class="card"><div class="head">${help('Evolución TWR y caídas', 'Qué es: índice base 100 de la rentabilidad ponderada por tiempo desde el inicio, con la caída desde máximos (línea inferior). Qué te dice: dónde estuvieron los baches y cuánto tardaron en recuperarse.')}</div><div class="chartbox tall"><canvas id="ch-dd"></canvas></div></div>
    </div>
    <div class="grid2">
      <div class="card"><div class="head">${help('Riesgo de divisa', 'Qué es: peso de cada divisa de cotización en la selección y efecto acumulado del tipo de cambio en las posiciones abiertas (diferencia entre el cambio medio de compra y el de hoy). Qué te dice: cuánto de tu resultado depende del euro-dólar y no de las empresas. Exposición económica: un fondo en euros puede tener activos en dólares; aquí se mira la divisa de cotización.')}</div><div class="pad" style="padding:.4rem 1.1rem .9rem"><div class="tablewrap"><table><thead><tr><th>Divisa</th><th class="num">Valor</th><th class="num">Peso</th></tr></thead><tbody>${Object.entries(byCcy).sort((x, y2) => y2[1] - x[1]).map(([c, val]) => `<tr><td>${esc(c)}</td><td class="num">${fmtEUR(val, 0)}</td><td class="num">${fmtN(val / (mv || 1) * 100, 1)} %</td></tr>`).join('')}</tbody></table></div><div class="muted" style="font-size:.8rem;margin-top:.4rem">Efecto del cambio en las posiciones abiertas: <b class="${cls(fxEff)}">${fmtEUR(fxEff, 0)}</b> (cambio medio de compra frente al de hoy).</div></div></div>
      <div class="card"><div class="head">${help('Escenarios de tensión', 'Qué es: qué pasaría con la selección si cada bloque cayera lo indicado, a la vez. Son supuestos configurables, no predicciones; el efecto es lineal y no cuenta correlaciones ni liquidez.')}<button class="btn sm" id="sc-save">Guardar supuestos</button></div><div class="pad" style="padding:.4rem 1.1rem .9rem"><div class="tablewrap"><table><thead><tr><th>Bloque</th><th class="num">Supuesto</th><th class="num">Impacto</th></tr></thead><tbody>
        ${[['rv', 'Renta variable (cubo 1)'], ['cripto', 'Cripto (sin stablecoins)'], ['usd', 'Dólar frente al euro'], ['inm', 'Inmuebles y proyectos'], ['rf', 'Renta fija']].map(([kk, l]) => `<tr><td>${l}</td><td class="num"><input type="number" class="sc" data-k="${kk}" value="${sc[kk]}" step="1" style="width:70px;text-align:right"> %</td><td class="num neg">${fmtEUR(impact[kk], 0)}</td></tr>`).join('')}
        <tr class="total"><td>Todo a la vez</td><td></td><td class="num neg"><b>${fmtEUR(impTot, 0)}</b> (${fmtN(impTot / (mv || 1) * 100, 1)} %)</td></tr>
      </tbody></table></div></div></div>
    </div>
    <div class="card pad"><h3 class="tip" tabindex="0" data-tip="Qué es: qué parte del valor de la selección tiene precio reciente, clasificación completa (cubo y, en el cubo 1, cajón) y sector; y cuántos ajustes de conciliación quedan. Qué te dice: cuánto fiarte del panel.">Calidad de datos <span class="q">?</span></h3>
      <div class="rentas-row"><div><b>${fmtN(fresh / (mv || 1) * 100, 0)} %</b> con precio reciente</div><div><b>${fmtN(classified / (mv || 1) * 100, 0)} %</b> clasificado (cubo y cajón)</div><div><b>${fmtN(sectored / (mv || 1) * 100, 0)} %</b> con sector</div><div><b>${adj}</b> ajustes de conciliación</div><div><b>${twrs.length}</b> meses de serie</div></div></div>`;
  bindFilterBar();
  const top = [...attr.slice(0, 12), ...attr.slice(-12).filter(x => x.c < 0 && !attr.slice(0, 12).includes(x))].sort((x, y2) => y2.c - x.c);
  bars('ch-attr', top.map(x => x.r.p.ticker + (x.closed ? ' (cerrada)' : '')), top.map(x => x.c), { colorPos: '#9FA8DA', colorNeg: '#EF6C63', money: true, avg: false });
  const dd = []; let pk = 0; idxSeries.forEach(x => { if (x == null) { dd.push(null); return; } pk = Math.max(pk, x); dd.push(+((x / pk - 1) * 100).toFixed(2)); });
  chart('ch-dd', { type: 'line', data: { labels: series.map(s => fmtYM(s.ym)), datasets: [{ label: 'TWR base 100', data: idxSeries, borderColor: '#9FA8DA', backgroundColor: 'rgba(159,168,218,.15)', fill: true, tension: .3, pointRadius: 0, yAxisID: 'y' }, { label: 'Caída desde máximos', data: dd, borderColor: '#EF6C63', backgroundColor: 'rgba(239,108,99,.2)', fill: true, tension: .3, pointRadius: 0, yAxisID: 'y2' }] }, plugins: [endLabels], options: { layout: { padding: { right: 8 } }, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: { grid, position: 'left' }, y2: { position: 'right', grid: { display: false }, ticks: { callback: v => fmtN(v, 0) + ' %' }, max: 0 }, x: { grid: { display: false }, ticks: { maxTicksLimit: 14 } } }, plugins: { endLabels: { fmt: v => fmtN(v, 1) } } } });
  $('#sc-save').onclick = async () => { const o = {}; $$('input.sc', v).forEach(i => o[i.dataset.k] = num(i.value)); await saveSettings({ scenarios: o }); toast('Supuestos guardados'); render(); };
}
