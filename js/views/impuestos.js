// Impuestos: resumen fiscal por ejercicio (IRPF), ganancias FIFO por activo, dividendos con retenciones,
// intereses y recompensas, comisiones, avisos (regla de los dos meses, modelo 720/721) y pérdidas aprovechables.
import { DB, saveSettings } from '../store.js?v=25c4e9c';
import { $, $$, esc, fmtEUR, fmtK, fmtN, fmtPct, fmtDate, cls, sum, todayISO, addDays, TYPES, help, toast } from '../util.js?v=25c4e9c';
import { replay, compute, opAmounts, divAmounts, posOf, acctOf, acctName, isInvest } from '../engine.js?v=25c4e9c';

const TAX_TYPE = { stock: 'Valores', etf: 'ETF', fund: 'Fondos', plan: 'Plan de pensiones', crypto: 'Cripto', option: 'Opciones', custom: 'Otros', cash: 'Efectivo' };
const CASILLAS = [
  ['Dividendos (rendimientos del capital mobiliario)', '0029', 'Ingresos íntegros brutos; la retención en destino va en la 0031 (retenciones)'],
  ['Intereses de cuentas y recompensas de staking', '0027 / 0033', 'Intereses de cuentas (0027); las recompensas de staking se declaran como capital mobiliario (0033, «otros»)'],
  ['Ganancias y pérdidas por transmisión de valores', '1626 y siguientes', 'Una fila por activo: valor de transmisión, valor de adquisición y gastos'],
  ['Ganancias por venta de criptomonedas', '1800 y siguientes', 'Como «otros elementos patrimoniales»; FIFO por moneda'],
  ['Deducción por doble imposición internacional', '0588', 'Impuesto pagado en el extranjero sobre dividendos, con el límite del convenio (15 % en EE. UU.)'],
];

function yearBounds(y) { return [`${y - 1}-12-31`, `${y}-12-31` < todayISO() ? `${y}-12-31` : todayISO()]; }
function yearRealized(y) {
  const [a, b] = yearBounds(y); const R0 = replay(a), R1 = replay(b); const out = [];
  for (const k in R1.H) {
    const h1 = R1.H[k], h0 = R0.H[k] || { sold: 0, realizedFifo: 0, realized: 0 };
    const sold = h1.sold - h0.sold, gain = h1.realizedFifo - h0.realizedFifo, gainAvg = h1.realized - h0.realized;
    if (Math.abs(sold) < 0.005 && Math.abs(gain) < 0.005) continue;
    const p = posOf(h1.positionId); out.push({ k, p, accountId: h1.accountId, sold, acq: sold - gain, gain, gainAvg });
  }
  return out.sort((x, y) => Math.abs(y.gain) - Math.abs(x.gain));
}
function yearDivs(y, inmuebles = false) {
  const [a, b] = yearBounds(y); const m = {};
  for (const d of DB.dividends) {
    if (!(d.date > a && d.date <= b)) continue; if ((posOf(d.position_id)?.custom_type === 'Inmueble directo') !== inmuebles) continue; const A = divAmounts(d); const p = posOf(d.position_id); const k = d.position_id;
    const g = m[k] = m[k] || { p, gross: 0, wOrig: 0, wDest: 0, comm: 0, net: 0, returned: 0, n: 0 };
    g.gross += A.grossEUR; g.wOrig += A.wOrigEUR; g.wDest += A.wDestEUR; g.comm += (A.commEUR || 0); g.net += A.netEUR; g.returned += +(d.retention_returned_eur || 0); g.n++;
  }
  return Object.values(m).sort((x, y) => y.gross - x.gross);
}
function yearOps(y) { const [a, b] = yearBounds(y); return DB.operations.filter(o => o.date > a && o.date <= b); }
// Regla de los dos meses: pérdida con recompra del mismo valor en los dos meses anteriores o posteriores (no se puede computar hasta vender de nuevo)
function twoMonthRule(y) {
  const [a, b] = yearBounds(y); const out = [];
  const sells = DB.operations.filter(o => o.type === 'sell' && o.date > a && o.date <= b && ['stock', 'etf', 'fund'].includes(posOf(o.position_id)?.type));
  for (const s of sells) {
    const R0 = replay(addDays(s.date.slice(0, 10), -1)); const h = R0.H[s.account_id + '|' + s.position_id]; if (!h || h.qty <= 0) continue;
    const A = opAmounts(s); const avg = h.qty ? h.costEUR / h.qty : 0; const lossEUR = A.totalEUR - avg * (+s.qty || 0);
    if (lossEUR >= 0) continue;
    const win = DB.operations.find(o => o.type === 'buy' && o.position_id === s.position_id && o.id !== s.id && Math.abs((new Date(o.date) - new Date(s.date)) / 86400000) <= 61);
    if (win) out.push({ p: posOf(s.position_id), date: s.date, loss: lossEUR, rebuy: win.date });
  }
  return out;
}
function model720(y) {
  // Valor a 31 de diciembre por cuenta fuera de España, agrupado en las categorías del modelo 720
  const [, b] = yearBounds(y); const C = compute(b, { includeVivienda: false }); const byAcc = {};
  for (const r of C.rows) { const acc = acctOf(r.accountId); if (!acc || (acc.country || 'ES') === 'ES') continue; const cat = r.p.type === 'crypto' ? '721 Criptomonedas' : '720 Valores en el extranjero'; const k = cat + '|' + acc.name; byAcc[k] = byAcc[k] || { cat, acc: acc.name, v: 0 }; byAcc[k].v += r.mvEUR; }
  for (const a in C.cashEUR) { const acc = acctOf(a); if (!acc || (acc.country || 'ES') === 'ES' || !C.cashEUR[a]) continue; const k = '720 Cuentas en el extranjero|' + acc.name; byAcc[k] = byAcc[k] || { cat: '720 Cuentas en el extranjero', acc: acc.name, v: 0 }; byAcc[k].v += C.cashEUR[a]; }
  const totals = {}; Object.values(byAcc).forEach(x => totals[x.cat] = (totals[x.cat] || 0) + x.v);
  return { rows: Object.values(byAcc).sort((x, y) => y.v - x.v), totals };
}

export function renderImpuestos(v, C, { UI, render }) {
  const today = todayISO(); const thisY = +today.slice(0, 4);
  const y = UI.taxYear || thisY; UI.taxYear = y;
  const first = DB.operations.length ? Math.min(...DB.operations.map(o => +o.date.slice(0, 4))) : thisY;
  const years = []; for (let k = thisY; k >= first; k--) years.push(k);
  const real = yearRealized(y); const divs = yearDivs(y); const alq = yearDivs(y, true); const alqN = sum(alq, d => d.net); const ops = yearOps(y);
  const byType = {}; real.forEach(r => { const t = TAX_TYPE[r.p?.type] || 'Otros'; const g = byType[t] = byType[t] || { t, sold: 0, acq: 0, gain: 0, n: 0 }; g.sold += r.sold; g.acq += r.acq; g.gain += r.gain; g.n++; });
  const gains = real.filter(r => r.gain > 0), losses = real.filter(r => r.gain < 0);
  const totGain = sum(gains, r => r.gain), totLoss = sum(losses, r => r.gain), net = totGain + totLoss;
  const divG = sum(divs, d => d.gross), divO = sum(divs, d => d.wOrig), divD = sum(divs, d => d.wDest), divN = sum(divs, d => d.net), divRet = sum(divs, d => d.returned), divC = sum(divs, d => d.comm);
  const interest = sum(ops.filter(o => o.type === 'interest'), o => opAmounts(o).grossEUR), rewards = sum(ops.filter(o => o.type === 'stakeReward'), o => opAmounts(o).grossEUR);
  const fees = sum(ops, o => opAmounts(o).commEUR + opAmounts(o).taxEUR) + sum(ops.filter(o => o.type === 'commission'), o => opAmounts(o).grossEUR) + divC;
  const rule = twoMonthRule(y); const m720 = model720(y);
  // Pérdidas latentes a hoy (solo si es el año en curso): candidatas a aflorar antes del 31 de diciembre para compensar ganancias
  const latent = y === thisY ? C.rows.filter(r => isInvest(r.p) && r.gain < -100 && r.p.type !== 'custom').sort((a, b) => a.gain - b.gain).slice(0, 8) : [];
  const TAX = Object.assign({ residencia: 'España', convenio_pct: 15, tipo_ahorro: 19, compensacion_anos: 4 }, DB.settings?.tax || {});
  const dobleImp = sum(divs, d => Math.min(d.wOrig, d.gross * TAX.convenio_pct / 100));
  // Pérdidas pendientes de compensar: saldos negativos de transmisiones de los últimos años, hasta el plazo de compensación
  const carry = []; for (let k = y - TAX.compensacion_anos; k < y; k++) { if (k < first) continue; const rr = yearRealized(k); const net = sum(rr, r => r.gain); if (net < 0) carry.push({ yy: k, loss: net, caduca: k + TAX.compensacion_anos }); }
  v.innerHTML = `
    <div class="section-head"><div><div class="eyebrow">Impuestos · IRPF · toda la cartera</div><h2>Ejercicio ${y}</h2></div><div class="toolbar"><div class="seg" id="taxyears">${years.map(k => `<button class="${k === y ? 'on' : ''}" data-y="${k}">${k}</button>`).join('')}</div><button class="btn" id="taxcsv">CSV</button></div></div>
    <div class="kpis">
      <div class="kpi ${net >= 0 ? 'g' : 'r'} tip" tabindex="0" data-tip="Qué es: ganancias menos pérdidas realizadas en el año, por FIFO (lo primero que compraste es lo primero que vendes), que es el criterio de Hacienda. Qué te dice: la base del ahorro que tributa por transmisiones; si es negativa, se compensa con ganancias de los cuatro años siguientes."><div class="l">G/P realizadas (FIFO)</div><div class="v ${cls(net)}">${fmtK(net)}</div><div class="s">Ganancias ${fmtK(totGain)} · pérdidas ${fmtK(totLoss)}</div></div>
      <div class="kpi p tip" tabindex="0" data-tip="Qué es: dividendos y cupones brutos cobrados en el año, antes de retenciones. Qué te dice: la cifra que va como ingreso íntegro del capital mobiliario (casilla 0029)."><div class="l">Dividendos brutos</div><div class="v">${fmtK(divG)}</div><div class="s">Neto cobrado ${fmtK(divN)}</div></div>
      <div class="kpi y tip" tabindex="0" data-tip="Qué es: lo que retuvo el país de origen (por ejemplo el 15 % en EE. UU.) y lo que retuvo el bróker en España a cuenta del IRPF. Qué te dice: la retención en destino ya está pagada; la de origen se recupera en parte por la deducción por doble imposición."><div class="l">Retenciones</div><div class="v">${fmtK(divO + divD)}</div><div class="s">Origen ${fmtK(divO)} · destino ${fmtK(divD)}</div></div>
      <div class="kpi b tip" tabindex="0" data-tip="Qué es: impuesto extranjero deducible: la retención en origen hasta el límite del convenio (15 %). Qué te dice: cuánto puedes recuperar en la casilla 0588. Lo retenido por encima del convenio no se recupera en la renta."><div class="l">Doble imposición deducible</div><div class="v">${fmtK(dobleImp)}</div><div class="s">Casilla 0588 · límite ${TAX.convenio_pct} %</div></div>
      <div class="kpi tip" tabindex="0" data-tip="Qué es: intereses de cuentas remuneradas y recompensas de staking o préstamo de cripto valoradas al cobrarlas. Qué te dice: también tributan como capital mobiliario aunque no sean dividendos."><div class="l">Intereses y stake</div><div class="v">${fmtK(interest + rewards)}</div><div class="s">Intereses ${fmtK(interest)} · stake ${fmtK(rewards)}</div></div>
      <div class="kpi r tip" tabindex="0" data-tip="Qué es: comisiones e impuestos de operaciones y dividendos y comisiones de custodia. Qué te dice: los gastos de compra y venta reducen la ganancia; los de custodia y administración son deducibles del capital mobiliario."><div class="l">Comisiones e impuestos</div><div class="v neg">${fmtK(fees)}</div><div class="s">Operaciones, dividendos y custodia</div></div>
    </div>
    ${rule.length ? `<div class="note warn"><b>Regla de los dos meses.</b> ${rule.length} venta${rule.length > 1 ? 's' : ''} con pérdida y recompra del mismo valor dentro de dos meses: esa pérdida no se puede computar este año hasta que vendas de nuevo. ${rule.map(r => `${esc(r.p?.ticker || '')} ${fmtDate(r.date)} (${fmtK(r.loss)}, recompra ${fmtDate(r.rebuy)})`).join(' · ')}</div>` : ''}
    <div class="grid2">
      <div class="card"><div class="head">${help('Casillas de la renta', 'Dónde va cada cifra en Renta Web. Orientativo: comprueba con tu asesor; las casillas cambian de numeración algunos años.')}</div><div class="tablewrap"><table><thead><tr><th>Concepto</th><th class="num">Importe</th><th>Casilla</th></tr></thead><tbody>
        <tr><td>${CASILLAS[0][0]}<div class="muted" style="font-size:.74rem">${CASILLAS[0][2]}</div></td><td class="num">${fmtEUR(divG, 2)}</td><td>${CASILLAS[0][1]}</td></tr>
        <tr><td>Retenciones en destino sobre dividendos</td><td class="num">${fmtEUR(divD, 2)}</td><td>0031</td></tr>
        <tr><td>Alquileres cobrados (rendimientos del capital inmobiliario)<div class="muted" style="font-size:.74rem">Ingresos íntegros de los inmuebles; los gastos deducibles (IBI, comunidad, reparaciones, amortización) se restan aparte</div></td><td class="num">${fmtEUR(alqN, 2)}</td><td>0062 y siguientes</td></tr>
        <tr><td>${CASILLAS[1][0]}<div class="muted" style="font-size:.74rem">${CASILLAS[1][2]}</div></td><td class="num">${fmtEUR(interest + rewards, 2)}</td><td>${CASILLAS[1][1]}</td></tr>
        <tr><td>${CASILLAS[2][0]}<div class="muted" style="font-size:.74rem">${CASILLAS[2][2]}</div></td><td class="num ${cls(net - (byType['Cripto']?.gain || 0))}">${fmtEUR(net - (byType['Cripto']?.gain || 0), 2)}</td><td>${CASILLAS[2][1]}</td></tr>
        <tr><td>${CASILLAS[3][0]}<div class="muted" style="font-size:.74rem">${CASILLAS[3][2]}</div></td><td class="num ${cls(byType['Cripto']?.gain || 0)}">${fmtEUR(byType['Cripto']?.gain || 0, 2)}</td><td>${CASILLAS[3][1]}</td></tr>
        <tr><td>${CASILLAS[4][0]}<div class="muted" style="font-size:.74rem">${CASILLAS[4][2]}</div></td><td class="num">${fmtEUR(dobleImp, 2)}</td><td>${CASILLAS[4][1]}</td></tr>
      </tbody></table></div></div>
      <div class="card"><div class="head">${help('G/P realizadas por tipo', 'Ganancia o pérdida FIFO del año agrupada por tipo de activo. Los fondos traspasados entre sí no tributan (traspaso con diferimiento); aquí solo aparecen los reembolsos.')}</div><div class="tablewrap"><table><thead><tr><th>Tipo</th><th class="num">Transmisión</th><th class="num">Adquisición</th><th class="num">G/P</th><th class="num">Op.</th></tr></thead><tbody>
        ${Object.values(byType).sort((a, b) => b.gain - a.gain).map(g => `<tr><td>${g.t}</td><td class="num">${fmtEUR(g.sold, 0)}</td><td class="num">${fmtEUR(g.acq, 0)}</td><td class="num ${cls(g.gain)}">${fmtEUR(g.gain, 0)}</td><td class="num">${g.n}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Sin ventas en el ejercicio</td></tr>'}
      </tbody></table></div></div>
    </div>
    <div class="card"><div class="head">${help('Ganancia o pérdida por activo (FIFO)', 'Cada fila es un activo vendido en el año: valor de transmisión (neto de comisiones), valor de adquisición FIFO y resultado. La columna «coste medio» es la ganancia con precio medio, la que usan los brókers en sus informes; Hacienda exige FIFO.')}<span class="sub">${real.length} activos</span></div><div class="tablewrap"><table><thead><tr><th>Activo</th><th>Cuenta</th><th>Tipo</th><th class="num">Transmisión</th><th class="num">Adquisición</th><th class="num">Ganancia</th><th class="num">Pérdida</th><th class="num">Coste medio</th></tr></thead><tbody>
      ${real.map(r => `<tr><td><span class="tk">${esc(r.p?.ticker || r.k)}</span><span class="nm">${esc(r.p?.name || '')}</span></td><td class="muted">${esc(acctName(r.accountId))}</td><td class="muted">${TAX_TYPE[r.p?.type] || '—'}</td><td class="num">${fmtEUR(r.sold, 2)}</td><td class="num">${fmtEUR(r.acq, 2)}</td><td class="num pos">${r.gain > 0 ? fmtEUR(r.gain, 2) : ''}</td><td class="num neg">${r.gain < 0 ? fmtEUR(r.gain, 2) : ''}</td><td class="num muted">${fmtEUR(r.gainAvg, 2)}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">Sin ventas en el ejercicio</td></tr>'}
    </tbody></table></div></div>
    <div class="card"><div class="head">${help('Dividendos y cupones por posición', 'Bruto cobrado, retención en origen (país del emisor), retención en destino (bróker español a cuenta del IRPF), comisión y neto. «Devuelto» es la retención en origen que el bróker recuperó (Trade Republic la devuelve en parte).')}<span class="sub">${divs.length} posiciones</span></div><div class="tablewrap"><table><thead><tr><th>Posición</th><th class="num">Bruto</th><th class="num">Ret. origen</th><th class="num">Ret. destino</th><th class="num">Comisión</th><th class="num">Neto</th><th class="num">Devuelto</th><th class="num">Pagos</th></tr></thead><tbody>
      <tr><td><b>Total</b></td><td class="num"><b>${fmtEUR(divG, 2)}</b></td><td class="num">${fmtEUR(divO, 2)}</td><td class="num">${fmtEUR(divD, 2)}</td><td class="num">${fmtEUR(divC, 2)}</td><td class="num"><b>${fmtEUR(divN, 2)}</b></td><td class="num">${fmtEUR(divRet, 2)}</td><td class="num">${sum(divs, d => d.n)}</td></tr>
      ${divs.map(d => `<tr><td><span class="tk">${esc(d.p?.ticker || '')}</span><span class="nm">${esc(d.p?.name || '')}</span></td><td class="num">${fmtEUR(d.gross, 2)}</td><td class="num">${fmtEUR(d.wOrig, 2)}</td><td class="num">${fmtEUR(d.wDest, 2)}</td><td class="num">${fmtEUR(d.comm, 2)}</td><td class="num">${fmtEUR(d.net, 2)}</td><td class="num">${fmtEUR(d.returned, 2)}</td><td class="num">${d.n}</td></tr>`).join('')}
    </tbody></table></div></div>
    <div class="grid2">
      <div class="card"><div class="head">${help('Modelo 720 y 721', 'Obligación informativa (no se paga) si a 31 de diciembre tienes más de 50.000 € en el extranjero en alguna categoría: cuentas, valores (720) o criptomonedas (721). Se calcula por país de la cuenta: Trade Republic es Alemania, Nexo es Francia.')}</div><div class="pad" style="padding:.6rem 1.1rem 1rem">
        ${Object.entries(m720.totals).map(([cat, t]) => `<div style="display:flex;justify-content:space-between;gap:.6rem;padding:.3rem 0;border-bottom:1px solid var(--line)"><span>${cat}</span><span class="num ${t > 50000 ? 'warn' : ''}">${fmtEUR(t, 0)} ${t > 50000 ? '· obligatorio' : '· por debajo de 50 k€'}</span></div>`).join('') || '<div class="muted">Sin cuentas fuera de España.</div>'}
        <div class="muted" style="font-size:.76rem;margin-top:.5rem">${m720.rows.map(r => `${esc(r.acc)}: ${fmtK(r.v)}`).join(' · ')}</div></div></div>
      <div class="card"><div class="head">${help('Pérdidas latentes aprovechables', 'Posiciones que hoy valen menos que su coste. Venderlas antes del 31 de diciembre aflora la pérdida y compensa ganancias del año (o de los cuatro siguientes). Ojo con la regla de los dos meses si piensas recomprar.')}</div><div class="tablewrap"><table><thead><tr><th>Posición</th><th class="num">Valor</th><th class="num">Coste</th><th class="num">Pérdida latente</th></tr></thead><tbody>
        ${latent.map(r => `<tr><td><span class="tk">${esc(r.p.ticker)}</span><span class="nm">${esc(r.p.name || '')}</span></td><td class="num">${fmtEUR(r.mvEUR, 0)}</td><td class="num">${fmtEUR(r.costEUR, 0)}</td><td class="num neg">${fmtEUR(r.gain, 0)}</td></tr>`).join('') || `<tr><td colspan="4" class="muted">${y === thisY ? 'Ninguna posición en pérdidas relevantes.' : 'Solo se calcula para el año en curso.'}</td></tr>`}
      </tbody></table></div></div>
    </div>
    <div class="grid2"><div class="card pad"><h3>Parámetros fiscales</h3><div class="muted" style="font-size:.8rem">Residencia fiscal y convenio determinan el límite deducible de la retención en origen; el tipo del ahorro y el plazo de compensación afectan a las pérdidas pendientes.</div><div class="form" style="margin-top:.5rem"><div class="field"><label>Residencia fiscal</label><input type="text" id="tx-res" value="${esc(TAX.residencia)}"></div><div class="field"><label>Límite convenio (%)</label><input type="number" id="tx-conv" value="${TAX.convenio_pct}" step="0.5"></div><div class="field"><label>Tipo del ahorro (%)</label><input type="number" id="tx-tipo" value="${TAX.tipo_ahorro}" step="0.5"></div><div class="field"><label>Años de compensación</label><input type="number" id="tx-anos" value="${TAX.compensacion_anos}"></div><div class="actions"><button class="btn" id="tx-save">Guardar</button></div></div></div>
      <div class="card"><div class="head">${help('Pérdidas pendientes de compensar', 'Saldos negativos de transmisiones de ejercicios anteriores que aún pueden compensar ganancias (plazo de compensación desde el año siguiente). Orientativo: la Agencia Tributaria lleva el cómputo oficial en la declaración.')}</div><div class="tablewrap"><table><thead><tr><th>Ejercicio</th><th class="num">Pérdida neta</th><th>Compensable hasta</th></tr></thead><tbody>${carry.map(c => `<tr><td>${c.yy}</td><td class="num neg">${fmtEUR(c.loss, 0)}</td><td>${c.caduca}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Sin pérdidas pendientes de ejercicios anteriores.</td></tr>'}</tbody></table></div></div></div>
    <div class="note">Cálculo propio a partir de tus operaciones con el cambio del BCE de cada día. Es una ayuda para preparar la declaración, no asesoramiento fiscal: contrasta con los informes fiscales de cada bróker.</div>`;
  $('#tx-save').onclick = async () => { await saveSettings({ tax: { residencia: $('#tx-res').value.trim(), convenio_pct: +$('#tx-conv').value, tipo_ahorro: +$('#tx-tipo').value, compensacion_anos: +$('#tx-anos').value } }); toast('Parámetros guardados'); render(); };
  $('#taxyears').onclick = e => { const b = e.target.closest('button'); if (b) { UI.taxYear = +b.dataset.y; render(); } };
  $('#taxcsv').onclick = () => {
    const lines = [['Ejercicio', y], [], ['Activo', 'Cuenta', 'Tipo', 'Transmision', 'Adquisicion', 'GP FIFO', 'GP coste medio'], ...real.map(r => [r.p?.ticker || r.k, acctName(r.accountId), TAX_TYPE[r.p?.type] || '', r.sold.toFixed(2), r.acq.toFixed(2), r.gain.toFixed(2), r.gainAvg.toFixed(2)]), [], ['Posicion', 'Bruto', 'Ret origen', 'Ret destino', 'Comision', 'Neto', 'Devuelto'], ...divs.map(d => [d.p?.ticker || '', d.gross.toFixed(2), d.wOrig.toFixed(2), d.wDest.toFixed(2), d.comm.toFixed(2), d.net.toFixed(2), d.returned.toFixed(2)])];
    const csv = lines.map(l => l.map(x => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })); a.download = `impuestos-${y}.csv`; a.click();
  };
}
