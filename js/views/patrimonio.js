// Patrimonio completo: neto (activos menos deudas), liquidez por plazos, inmuebles con su ficha, proyectos de Reental,
// rentas recurrentes y cobertura de gastos. Las deudas y el gasto mensual se guardan en Ajustes (settings).
import { DB, saveSettings } from '../store.js?v=25c4e9c';
import { $, $$, esc, fmtEUR, fmtK, fmtN, fmtPct, fmtDate, cls, sum, todayISO, daysBetween, addDays, help, toast, num } from '../util.js?v=25c4e9c';
import { viviendaValue, divAmounts, opAmounts, posOf, acctName, priceAt, fxAt, replay } from '../engine.js?v=25c4e9c';

const LIQ = [
  ['hoy', 'Hoy', r => r.p.type === 'cash' || ['USDT', 'USDC', 'USDX'].includes(r.p.ticker)],
  ['7d', 'En 7 días', r => ['stock', 'etf', 'crypto', 'option'].includes(r.p.type)],
  ['30d', 'En 30 días', r => r.p.type === 'fund'],
  ['1a', 'Más de un año', r => r.p.type === 'plan' || (r.p.type === 'custom' && r.p.custom_type !== 'Inmueble directo') || r.p.type === 'custom' && !r.p.custom_type],
  ['ilq', 'Ilíquido (inmuebles)', r => r.p.type === 'custom' && r.p.custom_type === 'Inmueble directo'],
];

export function renderPatrimonio(v, C, { UI, render }) {
  const today = todayISO();
  const inv = C.rows; const viv = viviendaValue(); const allRows = [...inv, ...viv];
  const posV = sum(inv, r => r.mvEUR), vivV = sum(viv, r => r.mvEUR), cash = C.cashTotal;
  const debts = DB.settings?.debts || []; const debtV = sum(debts, d => num(d.amount));
  const gasto = num(DB.settings?.gasto_mensual) || 0;
  const bruto = posV + cash + vivV, neto = bruto - debtV;
  // liquidez por plazos
  const liq = LIQ.map(([k, l, f]) => ({ k, l, v: (k === 'hoy' ? cash : 0) + sum(allRows.filter(f), r => r.mvEUR) }));
  const liqHoy = liq[0].v, liq7 = liqHoy + liq[1].v;
  // rentas recurrentes últimos 12 meses (netas)
  const from = addDays(today, -365);
  const d12 = DB.dividends.filter(d => d.date > from && d.date <= today);
  const isInm = d => posOf(d.position_id)?.custom_type === 'Inmueble directo';
  const rentAlq = sum(d12.filter(isInm), d => divAmounts(d).netEUR), rentDiv = sum(d12.filter(d => !isInm(d)), d => divAmounts(d).netEUR);
  const rentInt = sum(DB.operations.filter(o => ['interest', 'stakeReward'].includes(o.type) && o.date > from && o.date <= today), o => opAmounts(o).grossEUR);
  const rentas = rentAlq + rentDiv + rentInt;
  // inmuebles: ficha
  const inm = allRows.filter(r => r.p.type === 'custom' && r.p.custom_type === 'Inmueble directo').map(r => {
    const buy = DB.operations.filter(o => o.position_id === r.positionId && o.type === 'buy').sort((a, b) => a.date.localeCompare(b.date))[0];
    const rents = DB.dividends.filter(d => d.position_id === r.positionId); const r12 = sum(rents.filter(d => d.date > from), d => divAmounts(d).netEUR);
    // fecha real de la tasación: desde cuándo vale lo que vale hoy (los volcados diarios repiten el mismo valor)
    const pr0 = priceAt(r.positionId, today); let pr = pr0;
    if (pr0) { const m = DB.prices[r.positionId] || {}; const ks = Object.keys(m).filter(k => k <= today).sort(); let since = pr0.date; for (let i = ks.length - 1; i >= 0; i--) { if (Math.abs(m[ks[i]] - pr0.price) < 1e-6) since = ks[i]; else break; } pr = { ...pr0, date: since }; }
    const dias = pr ? daysBetween(pr.date, today) : null;
    return { r, buy, rentsTot: sum(rents, d => divAmounts(d).netEUR), r12, pr, dias, viv: !inv.includes(r) };
  });
  // Reental por proyecto
  const reental = inv.filter(r => r.p.custom_type === 'Inmobiliario tokenizado (Reental)').map(r => {
    const rents = sum(DB.dividends.filter(d => d.position_id === r.positionId), d => divAmounts(d).netEUR);
    const first = DB.operations.filter(o => o.position_id === r.positionId && o.type === 'buy').sort((a, b) => a.date.localeCompare(b.date))[0];
    return { r, rents, first, pend: r.costEUR - rents, meses: first ? Math.max(1, Math.round(daysBetween(first.date, today) / 30.44)) : 0 };
  }).sort((a, b) => b.r.mvEUR - a.r.mvEUR);
  v.innerHTML = `
    <div class="section-head"><div><div class="eyebrow">Patrimonio completo</div><h2 class="big">${fmtEUR(neto, 0)}</h2><div class="muted" style="font-size:.86rem">Patrimonio neto = posiciones ${fmtEUR(posV, 0)} + efectivo ${fmtEUR(cash, 0)} + vivienda ${fmtEUR(vivV, 0)} − deudas ${fmtEUR(debtV, 0)}</div></div></div>
    <div class="kpis">
      <div class="kpi b tip" tabindex="0" data-tip="Qué es: activos menos deudas (hipotecas, préstamos) registradas en esta pantalla. Qué te dice: lo que es realmente tuyo."><div class="l">Patrimonio neto</div><div class="v">${fmtK(neto)}</div><div class="s">Bruto ${fmtK(bruto)} · deudas ${fmtK(debtV)}</div></div>
      <div class="kpi g tip" tabindex="0" data-tip="Qué es: efectivo y stablecoins (hoy) más lo que se vende en una semana (acciones, ETF, cripto). Qué te dice: cuánto puedes convertir en dinero sin esperar."><div class="l">Líquido en 7 días</div><div class="v">${fmtK(liq7)}</div><div class="s">Hoy ${fmtK(liqHoy)} · ${fmtN(bruto ? liq7 / bruto * 100 : 0, 1)} % del bruto</div></div>
      <div class="kpi y tip" tabindex="0" data-tip="Qué es: meses de gasto esencial cubiertos con lo líquido en 7 días. Qué te dice: el colchón. El gasto mensual se fija abajo."><div class="l">Cobertura de gastos</div><div class="v">${gasto ? fmtN(liq7 / gasto, 1) + ' meses' : '—'}</div><div class="s">${gasto ? 'Gasto mensual ' + fmtEUR(gasto, 0) : 'Indica tu gasto mensual abajo'}</div></div>
      <div class="kpi p tip" tabindex="0" data-tip="Qué es: alquileres, dividendos e intereses netos de los últimos 12 meses. Qué te dice: qué parte del gasto pagan las rentas sin vender nada (cobertura)."><div class="l">Rentas netas 12 m</div><div class="v">${fmtK(rentas)}</div><div class="s">Alquileres ${fmtK(rentAlq)} · dividendos ${fmtK(rentDiv)} · intereses ${fmtK(rentInt)}${gasto ? ' · cubren el ' + fmtN(rentas / 12 / gasto * 100, 0) + ' % del gasto' : ''}</div></div>
    </div>
    <div class="grid2">
      <div class="card"><div class="head">${help('Liquidez por plazos', 'Qué es: cuánto puedes convertir en dinero y en cuánto tiempo, según el tipo de activo: efectivo y stablecoins hoy; acciones, ETF y cripto en una semana; fondos en un mes; plan de pensiones, capital privado y Reental en más de un año; inmuebles, ilíquidos. Qué te dice: que riqueza y disponibilidad no son lo mismo.')}</div><div class="tablewrap"><table><thead><tr><th>Plazo</th><th class="num">Importe</th><th class="num">Acumulado</th><th class="num">% del bruto</th></tr></thead><tbody>
        ${(() => { let acc = 0; return liq.map(l => { acc += l.v; return `<tr><td>${l.l}</td><td class="num">${fmtEUR(l.v, 0)}</td><td class="num">${fmtEUR(acc, 0)}</td><td class="num muted">${fmtN(bruto ? acc / bruto * 100 : 0, 1)} %</td></tr>`; }).join(''); })()}
      </tbody></table></div></div>
      <div class="card"><div class="head">${help('Deudas y gasto mensual', 'Hipotecas, préstamos y otras deudas restan del patrimonio bruto. El gasto mensual esencial sirve para la cobertura de gastos y de rentas.')}<button class="btn sm" id="debt-add">+ Deuda</button></div>
        <div class="tablewrap"><table><thead><tr><th>Deuda</th><th class="num">Pendiente</th><th class="num">Tipo</th><th class="num">Cuota/mes</th><th></th></tr></thead><tbody>
          ${debts.map((d, i) => `<tr><td>${esc(d.name)}</td><td class="num">${fmtEUR(num(d.amount), 0)}</td><td class="num">${d.rate != null && d.rate !== '' ? fmtN(num(d.rate), 2) + ' %' : '—'}</td><td class="num">${d.payment ? fmtEUR(num(d.payment), 0) : '—'}</td><td><button class="btn sm ghost" data-debt-del="${i}">✕</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Sin deudas registradas.</td></tr>'}
        </tbody></table></div>
        <div id="debt-form" class="form hidden" style="padding:.6rem 1.1rem"><div class="field"><label>Nombre</label><input type="text" id="db-name" placeholder="Hipoteca"></div><div class="field"><label>Pendiente (€)</label><input type="number" id="db-amount" inputmode="decimal"></div><div class="field"><label>Tipo de interés (%)</label><input type="number" id="db-rate" step="0.01"></div><div class="field"><label>Cuota mensual (€)</label><input type="number" id="db-payment" inputmode="decimal"></div><div class="actions"><button class="btn" id="db-cancel">Cancelar</button><button class="btn primary" id="db-save">Guardar deuda</button></div></div>
        <div class="form" style="padding:.4rem 1.1rem .9rem"><div class="field"><label>Gasto mensual esencial (€)</label><input type="number" id="gasto" value="${gasto || ''}" inputmode="decimal" placeholder="3000"></div><div class="actions"><button class="btn" id="gasto-save">Guardar gasto</button></div></div>
      </div>
    </div>
    <div class="card"><div class="head">${help('Inmuebles', 'Ficha por inmueble: compra, tasación vigente con su fecha, rentas netas cobradas y rentabilidad neta sobre la tasación. La tasación se actualiza en Posiciones (precio manual con fecha); actualizar el cambio no renueva la antigüedad de la tasación.')}<span class="sub">${inm.length} inmuebles</span></div><div class="tablewrap"><table><thead><tr><th>Inmueble</th><th>Uso</th><th>Compra</th><th class="num">Coste</th><th class="num">Tasación</th><th>Fecha tasación</th><th class="num">Valor (€)</th><th class="num">Revalorización</th><th class="num">Rentas 12 m</th><th class="num">Rent. neta</th></tr></thead><tbody>
      ${inm.map(x => `<tr class="row" data-hold="${x.r.accountId}|${x.r.positionId}"><td><span class="tk">${esc(x.r.p.ticker)}</span></td><td class="muted">${x.viv ? 'Vivienda habitual' : x.r12 > 0 ? 'Alquiler' : 'Inversión'}</td><td>${x.buy ? fmtDate(x.buy.date) : '—'}</td><td class="num">${fmtEUR(x.r.costEUR, 0)}</td><td class="num">${x.pr ? fmtN(x.pr.price, 0) + ' ' + esc(x.r.p.currency) : '—'}</td><td class="${x.dias != null && x.dias > 365 ? 'warn' : ''}">${x.pr ? fmtDate(x.pr.date) + (x.dias > 365 ? ' · antigua' : '') : '—'}</td><td class="num">${fmtEUR(x.r.mvEUR, 0)}</td><td class="num ${cls(x.r.gain)}">${fmtPct(x.r.gainPct, 1)}</td><td class="num">${fmtEUR(x.r12, 0)}</td><td class="num">${x.r.mvEUR ? fmtN(x.r12 / x.r.mvEUR * 100, 2) + ' %' : '—'}</td></tr>`).join('') || '<tr><td colspan="10" class="muted">Sin inmuebles.</td></tr>'}
    </tbody></table></div></div>
    <div class="card"><div class="head">${help('Reental: proyecto a proyecto', 'Capital invertido, rentas netas distribuidas, capital pendiente de recuperar y meses transcurridos desde la primera compra. Qué te dice: qué proyectos ya devuelven y cuánto queda por recuperar; la tasación es la de Filios/Reental, no un precio de mercado.')}<span class="sub">${reental.length} proyectos · ${fmtK(sum(reental, x => x.r.mvEUR))}</span></div><div class="tablewrap"><table><thead><tr><th>Proyecto</th><th class="num">Invertido</th><th class="num">Valor</th><th class="num">Rentas netas</th><th class="num">Pendiente de recuperar</th><th class="num">Meses</th><th class="num">Renta anualizada</th></tr></thead><tbody>
      ${reental.map(x => `<tr class="row" data-hold="${x.r.accountId}|${x.r.positionId}"><td><span class="tk">${esc(x.r.p.ticker)}</span><span class="nm">${esc(x.r.p.name || '')}</span></td><td class="num">${fmtEUR(x.r.costEUR, 0)}</td><td class="num">${fmtEUR(x.r.mvEUR, 0)}</td><td class="num pos">${fmtEUR(x.rents, 0)}</td><td class="num">${fmtEUR(x.pend, 0)}</td><td class="num">${x.meses}</td><td class="num">${x.meses && x.r.costEUR ? fmtN(x.rents / x.r.costEUR * 12 / x.meses * 100, 1) + ' %' : '—'}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Sin proyectos.</td></tr>'}
    </tbody></table></div></div>`;
  $('#debt-add').onclick = () => $('#debt-form').classList.toggle('hidden');
  $('#db-cancel').onclick = () => $('#debt-form').classList.add('hidden');
  $('#db-save').onclick = async () => { const d = { name: $('#db-name').value.trim() || 'Deuda', amount: num($('#db-amount').value), rate: $('#db-rate').value, payment: num($('#db-payment').value) }; if (!(d.amount > 0)) return toast('Falta el importe'); await saveSettings({ debts: [...debts, d] }); toast('Deuda guardada'); render(); };
  $$('[data-debt-del]', v).forEach(b => b.onclick = async () => { const ds = [...debts]; ds.splice(+b.dataset.debtDel, 1); await saveSettings({ debts: ds }); render(); });
  $('#gasto-save').onclick = async () => { await saveSettings({ gasto_mensual: num($('#gasto').value) }); toast('Gasto guardado'); render(); };
  $$('[data-hold]', v).forEach(el => el.onclick = async () => { const F = await import('../forms.js?v=25c4e9c'); F.openHolding(el.dataset.hold, { rows: allRows }); });
}
