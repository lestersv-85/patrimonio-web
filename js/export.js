// Exportación: CSV (punto y coma, coma decimal) y Excel con SheetJS (global XLSX)
import { DB } from './store.js?v=3bf8a9f';
import { todayISO, r2, TYPES, BUCKETS, DRAWERS, OP_LABEL, toast, monthKey } from './util.js?v=3bf8a9f';
import { acctName, posOf, opAmounts, divAmounts, defaultBucket, monthlySeries, firstOpDate, isInvest } from './engine.js?v=3bf8a9f';

const csvNum = n => (n == null || n === '' || isNaN(n)) ? '' : String(n).replace('.', ',');
function toCSV(headers, rows) { const q = s => { s = String(s ?? ''); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }; return '﻿' + [headers, ...rows].map(r => r.map(q).join(';')).join('\r\n'); }
export function download(filename, data, mime = 'text/plain;charset=utf-8') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: mime })); a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}
function opsTable(ops) {
  const H = ['Fecha', 'Hora', 'Cuenta', 'Tipo', 'Ticker', 'Nombre', 'Tipo posición', 'Cubo', 'Cantidad', 'Precio', 'Divisa', 'Comisión', 'Divisa comisión', 'Impuestos (€)', 'Cambio BCE', 'Cambio Filios', 'AutoFx', 'Total divisa', 'Total (€)', 'Total con com. e imp. (€)', 'Traspaso a', 'Origen', 'Notas', 'Id'];
  const R = ops.map(o => { const p = posOf(o.position_id); const A = opAmounts(o); return [o.date, o.time || '', acctName(o.account_id), OP_LABEL[o.type] || o.type, p?.ticker || (o.position_id ? o.position_id : 'Efectivo'), p?.name || '', p ? TYPES[p.type] : 'Efectivo', p ? defaultBucket(p) : '', o.qty, o.price, A.ccy, o.commission || 0, o.commission_ccy || '', r2(A.taxEUR), A.fx, o.fx_filios ?? '', o.auto_fx ? 'Sí' : 'No', r2(A.gross), r2(A.grossEUR), r2(A.totalEUR), o.switch_to || '', o.source || '', o.description || '', o.id]; });
  return [H, R];
}
function divsTable(divs) {
  const H = ['Fecha', 'Cuenta', 'Ticker', 'Nombre', 'Títulos', 'Divisa', 'Bruto por título', 'Bruto', 'Cambio BCE', 'Bruto (€)', 'Ret. origen (€)', 'Ret. destino (€)', 'Comisión (€)', 'Neto (€)', 'Neto con devolución (€)', 'Origen', 'Notas', 'Id'];
  const R = divs.map(d => { const p = posOf(d.position_id); const A = divAmounts(d); return [d.date, acctName(d.account_id), p?.ticker || '', p?.name || '', d.shares, A.ccy, d.gross_per_share, r2(A.gross), A.fx, r2(A.grossEUR), r2(A.wOrigEUR), r2(A.wDestEUR), r2(A.commEUR), r2(A.netEUR), r2(A.netWithReturnEUR), d.source || '', d.description || '', d.id]; });
  return [H, R];
}
function positionsTable(C) {
  const H = ['Ticker', 'Nombre', 'Tipo', 'Cubo', 'Cajón', 'Sector núcleo', 'Región', 'Cuenta', 'Divisa', 'Cantidad', 'Precio medio', 'Precio medio (€) con com.', 'Último', 'Fecha precio', 'Valor mercado', 'Valor mercado (€)', 'Invertido (€)', 'GyP no realizadas (€)', 'GyP %', 'GyP realizadas (€)', 'GyP realizadas FIFO (€)', 'Dividendos brutos (€)', 'ISIN', 'Sector', 'Etiquetas'];
  const R = [...C.rows].sort((a, b) => b.mvEUR - a.mvEUR).map(r => [r.p.ticker, r.p.name, TYPES[r.p.type] || r.p.type, r.bucket, DRAWERS[r.p.drawer || ''] || '', r.p.nucleo_sector || '', r.p.region || '', acctName(r.accountId), r.p.currency, r.qty, r2(r.avg * 100) / 100, r2(r.avgEUR), r.last, r.priceDate || '', r2(r.mvCcy), r2(r.mvEUR), r2(r.costEUR), r2(r.gain), r2(r.gainPct), r2(r.realized), r2(r.realizedFifo), r2(r.div), r.p.isin || '', r.p.sector || '', (r.p.tags || []).join(', ')]);
  return [H, R];
}
function catalogTable() {
  const H = ['Id', 'Ticker', 'Nombre', 'Tipo', 'Alcance', 'Cubo', 'Cajón', 'Sector núcleo', 'Región', 'Divisa', 'ISIN', 'País', 'Mercado', 'Sector', 'Precio', 'Símbolo Yahoo', 'CoinGecko', 'Etiquetas', 'Notas'];
  return [H, DB.positions.map(p => [p.id, p.ticker, p.name, TYPES[p.type] || p.type, p.scope || 'inversion', defaultBucket(p), DRAWERS[p.drawer || ''] || '', p.nucleo_sector || '', p.region || '', p.currency, p.isin || '', p.country || '', p.exchange || '', p.sector || '', p.price_mode || '', p.yahoo_symbol || '', p.coingecko_id || '', (p.tags || []).join(', '), p.notes || ''])];
}
function perfTable(series) { return [['Mes', 'MWR mensual %', 'TWR mensual %', 'S&P 500 mensual %', 'Valor fin de mes (€)', 'Aportado neto (€)', 'Ganancia (€)'], series.map(r => [r.ym, r.own == null ? '' : r2(r.own), r.twr == null ? '' : r2(r.twr), r.sp == null ? '' : r2(r.sp), r.value == null ? '' : r2(r.value), r.inflow == null ? '' : r2(r.inflow), r.gain == null ? '' : r2(r.gain)])]; }
function accountsTable(C) { return [['Id', 'Nombre', 'Bróker', 'País', 'Multidivisa', 'Retiene en destino', 'Efectivo (€)', 'Notas'], DB.accounts.map(a => [a.id, a.name, a.broker || '', a.country || '', a.multi_currency ? 'Sí' : 'No', a.withholds_dest ? 'Sí' : 'No', r2(C.cashEUR[a.id] || 0), a.notes || ''])]; }
function pricesTable() { const R = []; for (const pid in DB.prices) { const p = posOf(pid); for (const d in DB.prices[pid]) R.push([p?.ticker || pid, d, DB.prices[pid][d], p?.currency || '']); } return [['Ticker', 'Fecha', 'Cierre', 'Divisa'], R.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]))]; }
function fxTable() { const R = []; for (const c in DB.fx) for (const d in DB.fx[c]) R.push([c, d, DB.fx[c][d]]); return [['Divisa', 'Fecha', 'EUR por unidad'], R.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]))]; }
function benchTable() { const R = []; for (const s in DB.bench) for (const d in DB.bench[s]) R.push([s, d, DB.bench[s][d]]); return [['Símbolo', 'Fecha', 'Cierre'], R]; }
function clockTable() { return [['Mes', 'Crecimiento', 'Inflación', 'Fase', 'Confirmada', 'Evidencia'], (DB.clock || []).map(c => [c.month, c.growth, c.inflation, c.phase, c.confirmed ? 'Sí' : 'No', JSON.stringify(c.evidence || {})])]; }

// ---------- Formato Filios, para las skills de análisis de cartera ----------
// Las skills de cartera (investment-portfolio, agente-inversion-bd) leen CSV exportados de Filios.
// Su parser usa csv.DictReader con la coma por separador y convierte los números con
// float(valor.replace(',', '')), es decir espera formato inglés. Nuestro CSV normal lleva punto y
// coma, coma decimal y marca de orden de bytes: con él, el parser lee TODAS las filas a cero y no
// avisa — comprobado, devuelve «muy diversificado» con índice de Herfindahl 0,00 sobre una cartera
// vacía. Por eso este export va aparte y en su formato: coma, punto decimal y sin marca inicial.
// Los nombres de columna son los que el parser busca literalmente; no se tocan.
const numUS = n => (n == null || n === '' || isNaN(n)) ? '' : String(r2(n));
function toCSVus(headers, rows) {
  const q = s => { s = String(s ?? ''); return /[,"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [headers, ...rows].map(r => r.map(q).join(',')).join('\r\n');
}
const csvRowsUS = ([H, R]) => toCSVus(H, R.map(r => r.map(v => typeof v === 'number' ? numUS(v) : v)));

// Misma regla que el taller de dimensionado (taller.js): cotiza lo que tiene precio de mercado.
// Importa separarlo porque el parser de la skill SUMA todo lo que le den: con las casas dentro, las
// tres primeras posiciones eran inmuebles cubanos (276.051 EUR, el 40 % del total) y toda la lectura
// de concentración salía falseada. Y el marco de comparación de la propia skill dice, literalmente,
// que la cartera real se compara excluyendo inmuebles.
const cotiza = p => p.price_mode !== 'manual' && !!p.yahoo_symbol;

function filiosCarteraTable(C, quiero = 'cotizadas') {
  const H = ['Tipo de activo', 'Ticker', 'Nombre', 'Divisa', 'Sector', 'País de exposición', 'ISIN', 'Etiquetas',
             'Títulos / Part. / Cantidad', 'Precio medio de compra + com. e imp. (EUR)',
             'Total invertido + com. e imp. (EUR)', 'Valor de mercado (EUR)',
             'Ganancia/Pérdida total no realizada (EUR)', 'Ganancia/Pérdida total % no realizada (EUR)',
             'Rent. por dividendo histórica (%)', 'Cuenta', 'Cubo', 'Último', 'Fecha precio'];
  const R = [...C.rows]
    .filter(r => quiero === 'cotizadas' ? (isInvest(r.p) && cotiza(r.p)) : !(isInvest(r.p) && cotiza(r.p)))
    .sort((a, b) => b.mvEUR - a.mvEUR).map(r => [
    TYPES[r.p.type] || r.p.type, r.p.ticker, r.p.name, r.p.currency, r.p.sector || '', r.p.region || '',
    r.p.isin || '', (r.p.tags || []).join(', '),
    r.qty, r2(r.avgEUR), r2(r.costEUR), r2(r.mvEUR), r2(r.gain), r2(r.gainPct),
    r.costEUR > 0 ? r2(r.div / r.costEUR * 100) : 0,
    acctName(r.accountId), r.bucket, r.last, r.priceDate || '']);
  return [H, R];
}

// El equivalente de jobs/cordura.js no_todo_cero, del lado que produce: si salen filas pero ninguna
// trae valor, el fichero es inservible y quien lo lea dictaminará sobre una cartera vacía sin saberlo.
// Más vale enterarse aquí que en el informe de la skill.
function revisaCartera([H, R]) {
  const iValor = H.indexOf('Valor de mercado (EUR)');
  const vivas = R.filter(r => Number(r[iValor]) > 0).length;
  if (R.length && !vivas) throw new Error('la cartera sale con ' + R.length + ' filas y ninguna con valor: '
    + 'no exporto un fichero que haría dictaminar sobre una cartera vacía');
  return [H, R];
}

export function exportParaSkills(C) {
  const hoy = todayISO();
  const series = monthlySeries(monthKey(firstOpDate()), monthKey(hoy));
  const ops = [...DB.operations].sort((a, b) => a.date.localeCompare(b.date));
  const divs = [...DB.dividends].sort((a, b) => a.date.localeCompare(b.date));
  // Los nombres son los que buscan las skills: «Filios - Cartera*.csv», «Filios - Operaciones*.csv»…
  const ficheros = [
    [`Filios - Cartera ${hoy}.csv`, revisaCartera(filiosCarteraTable(C, 'cotizadas'))],
    [`Filios - Sin mercado ${hoy}.csv`, filiosCarteraTable(C, 'resto')],
    [`Filios - Operaciones ${hoy}.csv`, opsTable(ops)],
    [`Filios - Dividendos ${hoy}.csv`, divsTable(divs)],
    [`Filios - Rentabilidad ${hoy}.csv`, perfTable(series)],
  ];
  ficheros.forEach(([nombre, tabla], i) =>
    setTimeout(() => download(nombre, csvRowsUS(tabla), 'text/csv;charset=utf-8'), i * 400));
}

const csvRows = ([H, R]) => toCSV(H, R.map(r => r.map(v => typeof v === 'number' ? csvNum(v) : v)));
export function exportOpsCSV(ops) { download(`operaciones-${todayISO()}.csv`, csvRows(opsTable(ops))); }
export function exportDivsCSV(divs) { download(`dividendos-${todayISO()}.csv`, csvRows(divsTable(divs))); }
export function exportPositionsCSV(C) { download(`cartera-${todayISO()}.csv`, csvRows(positionsTable(C))); }
export function exportCatalogCSV() { download(`posiciones-${todayISO()}.csv`, csvRows(catalogTable())); }
export function exportPerfCSV(series) { download(`rentabilidad-mensual-${todayISO()}.csv`, csvRows(perfTable(series))); }
export function exportAllCSV(C) {
  const series = monthlySeries(monthKey(firstOpDate()), monthKey(todayISO()));
  const files = { cuentas: accountsTable(C), posiciones: catalogTable(), cartera: positionsTable(C), operaciones: opsTable([...DB.operations].sort((a, b) => a.date.localeCompare(b.date))), dividendos: divsTable([...DB.dividends].sort((a, b) => a.date.localeCompare(b.date))), 'rentabilidad-mensual': perfTable(series), precios: pricesTable(), cambios: fxTable(), indices: benchTable(), reloj: clockTable() };
  let i = 0; for (const name in files) setTimeout(() => download(`${name}-${todayISO()}.csv`, csvRows(files[name])), i++ * 400);
  toast('Descargando 10 archivos CSV…');
}
export function exportAllXLSX(C) {
  if (!window.XLSX) return toast('La librería de Excel no ha cargado');
  const series = monthlySeries(monthKey(firstOpDate()), monthKey(todayISO()));
  const wb = XLSX.utils.book_new();
  const add = (name, [H, R]) => { const ws = XLSX.utils.aoa_to_sheet([H, ...R]); ws['!cols'] = H.map((h, i) => ({ wch: Math.min(40, Math.max(String(h).length, ...R.slice(0, 200).map(r => String(r[i] ?? '').length)) + 2) })); XLSX.utils.book_append_sheet(wb, ws, name); };
  add('Cuentas', accountsTable(C)); add('Posiciones', catalogTable()); add('Cartera', positionsTable(C)); add('Operaciones', opsTable([...DB.operations].sort((a, b) => a.date.localeCompare(b.date)))); add('Dividendos', divsTable([...DB.dividends].sort((a, b) => a.date.localeCompare(b.date))));
  add('Rentabilidad mensual', perfTable(series)); add('Precios', pricesTable()); add('Cambios BCE', fxTable()); add('Índices', benchTable()); add('Reloj', clockTable());
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  download(`seguimiento-patrimonio-${todayISO()}.xlsx`, new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}
