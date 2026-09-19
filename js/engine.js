// Motor de cálculo: posiciones, caja por divisa, coste medio y FIFO, valoración a fecha,
// flujos de la selección, MWR (TIR), TWR (Dietz modificado), series mensuales.
import { DB } from './store.js?v=3bf8a9f';
import { daysBetween, monthEnd, monthKey, addMonths, todayISO, sum, num } from './util.js?v=3bf8a9f';

// ---------- lookups ----------
const sortedKeysCache = new WeakMap();
function sortedKeys(obj) { let k = sortedKeysCache.get(obj); if (!k) { k = Object.keys(obj).sort(); sortedKeysCache.set(obj, k); } return k; }
export function latestAtOrBefore(map, date) {
  if (!map) return null;
  const keys = sortedKeys(map); let lo = 0, hi = keys.length - 1, best = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (keys[mid] <= date) { best = mid; lo = mid + 1; } else hi = mid - 1; }
  return best >= 0 ? { date: keys[best], value: map[keys[best]] } : null;
}
export function fxAt(ccy, date) {
  if (!ccy || ccy === 'EUR') return 1;
  const m = DB.fx[ccy]; if (!m) return 1;
  const r = latestAtOrBefore(m, date); if (r) return r.value;
  const k = sortedKeys(m); return k.length ? m[k[0]] : 1;
}
export function priceAt(pid, date) {
  const m = DB.prices[pid]; if (!m) return null;
  const p = posOf(pid);
  if (p && p.price_mode === 'manual') {
    // Valoración manual (casas, Reental, plan, fondos privados): el primer precio es el de compra; la primera tasación posterior
    // vale desde la compra (como en Filios) y las tasaciones fechadas después se respetan como escalones.
    const k = sortedKeys(m);
    if (k.length === 1) return { price: m[k[0]], date: k[0], stale: false, manual: true };
    if (date < k[1]) return { price: m[k[1]], date: k[1], stale: false, manual: true };
    const r = latestAtOrBefore(m, date); return { price: r.value, date: r.date, stale: false, manual: true };
  }
  const r = latestAtOrBefore(m, date); if (r) return { price: r.value, date: r.date, stale: daysBetween(r.date, date) > 40 };
  const k = sortedKeys(m); return k.length ? { price: m[k[0]], date: k[0], stale: true, before: true } : null;
}
export const posOf = id => DB.positions.find(p => p.id === id);
export const acctOf = id => DB.accounts.find(a => a.id === id);
export const acctName = id => acctOf(id)?.name || id || '—';
export const defaultBucket = p => p?.bucket || ({ stock: 1, etf: 1, fund: 1, option: 1, crypto: 2, cash: 3, plan: 4, custom: 4 }[p?.type] || 4);
export const isInvest = p => (p?.scope || 'inversion') !== 'vivienda';

// ---------- tener vs. tener ficha ----------
// Vender una posición entera NO la borra: su registro sigue en `positions` y el trabajo de precios
// sigue actualizando su serie todos los días. «Tener» es tener participaciones hoy, no tener ficha.
// Estas dos funciones son la ÚNICA definición de eso en toda la web. Antes cada pantalla tenía la
// suya y no coincidían: la lista de seguimiento miraba si existía el registro («ya es una posición
// tuya») y el taller miraba la tenencia viva, así que los 131 tickers vendidos —MSFT entre ellos—
// caían por el hueco: no se podían añadir al seguimiento porque supuestamente ya se tenían, y no
// aparecían en el taller porque no se tenían. Si algún día hace falta otra vez, se usa esto.
export const idsEnCartera = C => new Set((C?.rows || []).map(r => r.p.id));
export const simbolosEnCartera = C => new Set((C?.rows || [])
  .map(r => String(r.p.yahoo_symbol || '').toUpperCase()).filter(Boolean));

// Posiciones que ya no se tienen pero cotizan: candidatas de pleno derecho y con una ventaja que no
// tiene ninguna candidata nueva, su histórico ya descargado. Se indexan por símbolo en mayúsculas.
export function cerradasConMercado(C) {
  const vivas = idsEnCartera(C), sim = simbolosEnCartera(C), out = new Map();
  for (const p of DB.positions || []) {
    const s = String(p.yahoo_symbol || '').toUpperCase();
    if (!s || vivas.has(p.id) || sim.has(s) || !isInvest(p) || p.price_mode === 'manual') continue;
    if (!out.has(s)) out.set(s, p);
  }
  return out;
}

// ---------- importes de una operación con cambio BCE ----------
export function opAmounts(op) {
  const ccy = op.currency || 'EUR';
  const fx = op.fx || fxAt(ccy, op.date);
  const gross = num(op.total) || num(op.qty) * num(op.price);
  const grossEUR = gross * fx;
  const commEUR = num(op.commission) * fxAt(op.commission_ccy || ccy, op.date);
  const taxEUR = num(op.tax) * fxAt(op.tax_ccy || ccy, op.date);
  const isSale = ['sell', 'optionSell', 'switch'].includes(op.type);
  const totalEUR = isSale ? grossEUR - commEUR - taxEUR : grossEUR + commEUR + taxEUR;
  return { ccy, fx, gross, grossEUR, commEUR, taxEUR, totalEUR };
}
export function divAmounts(d) {
  const ccy = d.currency || 'EUR'; const fx = d.fx || fxAt(ccy, d.date);
  const gross = num(d.gross) || num(d.shares) * num(d.gross_per_share);
  const wOrig = num(d.withhold_origin); const comm = num(d.commission) * (d.commission_ccy && d.commission_ccy !== ccy ? fxAt(d.commission_ccy, d.date) / fx : 1);
  const net = num(d.net) || (gross - wOrig - comm);
  const grossEUR = gross * fx, wOrigEUR = wOrig * fx, wDestEUR = num(d.withhold_dest_eur);
  const netEUR = net * fx - wDestEUR;
  return { ccy, fx, gross, grossEUR, wOrigEUR, wDestEUR, commEUR: comm * fx, net, netEUR, netWithReturnEUR: num(d.net_with_return_eur) || netEUR };
}
const opOrder = { switch: 0, sell: 1, optionSell: 1, withdrawal: 1, commission: 1, spinOff: 2, split: 3, buy: 4, switchBuy: 5, spinOffBuy: 5, deposit: 6, interest: 6, stakeReward: 6, scrip: 6, optionBuy: 4, adjust: 9 };
export const sortOps = (a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || '') || (opOrder[a.type] ?? 5) - (opOrder[b.type] ?? 5) || String(a.id).localeCompare(String(b.id));

// ---------- replay hasta una fecha ----------
export function replay(cutoff) {
  const H = {}; const cash = {}; const lotsMap = {};
  const income = { realized: 0, realizedFifo: 0, rewards: 0, interest: 0, fees: 0, divGross: 0, divNet: 0 };
  const pendingCost = {}; // spin-offs: coste que viaja a la posición de destino
  const avisos = [];      // datos contradictorios detectados durante el recorrido (ver removeQty)
  const cur = { date: null, tipo: null };
  const hold = (a, p) => H[a + '|' + p] || (H[a + '|' + p] = { accountId: a, positionId: p, qty: 0, costCcy: 0, costEUR: 0, realized: 0, realizedFifo: 0, bought: 0, sold: 0, div: 0, lots: [] });
  const cashAdd = (a, ccy, v) => { (cash[a] = cash[a] || {}); cash[a][ccy] = (cash[a][ccy] || 0) + v; };
  const ops = DB.operations.filter(o => !cutoff || o.date <= cutoff).sort(sortOps);
  const divs = DB.dividends.filter(d => !cutoff || d.date <= cutoff).sort((a, b) => a.date.localeCompare(b.date));
  let di = 0;
  const applyDiv = d => {
    const A = divAmounts(d); const h = hold(d.account_id, d.position_id); h.div += A.grossEUR;
    income.divGross += A.grossEUR; income.divNet += A.netEUR;
    if (d.auto_fx === false && A.ccy !== 'EUR' && acctOf(d.account_id)?.multi_currency) cashAdd(d.account_id, A.ccy, A.net - num(d.withhold_dest_eur) / A.fx); else cashAdd(d.account_id, 'EUR', A.netEUR);
  };
  const removeQty = (h, q, { realize = true, proceedsEUR = 0 } = {}) => {
    // Retirar más títulos de los que la posición tiene en ese instante es un dato contradictorio, no
    // un caso que el motor pueda resolver con aritmética: el tope de `frac` saca TODO el coste y deja
    // la cantidad en negativo, y si después una compra repone los títulos, el coste queda colgando de
    // lo que quede. Pasó con AVAX en Nexo el 2 abr 2026 (venta de 98,53 seguida de un traspaso de otros
    // 98,53): 825,03 € de coste se quedaron sobre 0,013 títulos y acabaron como 824,92 € de pérdida
    // inventada dentro de «GyP realizadas». Se sigue topando —es lo menos malo— pero se avisa.
    // Tolerancia relativa del 0,5 %: una retirada total trae la cantidad redondeada del extracto y en
    // binario cae un pelo por encima de la tenencia (LINK 496,4111 sobre 496,4111), y un traspaso de
    // fondo puede pedir 8,73 participaciones sobre 8,72. Eso no descuadra nada porque el coste se topa
    // al 100 %. Lo que hay que ver son los casos como el de AVAX: 98,53 títulos sobre 0,0132.
    if (q > h.qty * 1.005 + 1e-6) avisos.push({ accountId: h.accountId, positionId: h.positionId, date: cur.date, tipo: cur.tipo, qty: q, disponible: h.qty });
    const frac = h.qty > 1e-12 ? Math.min(1, q / h.qty) : 0; const costOut = h.costEUR * frac, costCcyOut = h.costCcy * frac;
    h.qty -= q; h.costEUR -= costOut; h.costCcy -= costCcyOut;
    let fifoOut = 0, left = q;
    while (left > 1e-12 && h.lots.length) { const l = h.lots[0]; const take = Math.min(left, l.qty); fifoOut += l.costEUR * (take / l.qty); l.costEUR -= l.costEUR * (take / l.qty); l.qty -= take; left -= take; if (l.qty <= 1e-12) h.lots.shift(); }
    if (realize) { const g = proceedsEUR - costOut, gf = proceedsEUR - fifoOut; h.realized += g; h.realizedFifo += gf; income.realized += g; income.realizedFifo += gf; h.sold += proceedsEUR; }
    return { costOut, q };
  };
  // Un traspaso mueve el coste de la posición de origen a la de destino, pero las dos patas NO
  // comparten fecha: el bróker liquida el reembolso y la suscripción en días distintos, y eso pasaba
  // en 17 de los 46 `switchBuy` del histórico. Emparejarlas por fecha dejaba 21.292,23 € de coste
  // huérfano y valoraba la pata de compra a precio de mercado, inflando «invertido» en 2.608,26 €,
  // casi todo en la cartera gestionada de Santander. Se empareja por destino e importe, que es lo que
  // el extracto sí conserva en las dos patas, y si el importe exacto no aparece se toma el traspaso
  // pendiente más antiguo hacia ese destino.
  const pendingSwitch = {};
  const anotarTraspaso = (dest, importe, date, costEUR) => {
    (pendingSwitch[dest] = pendingSwitch[dest] || []).push({ importe: Math.round(importe * 100), date, costEUR });
  };
  const cobrarTraspaso = (dest, importe) => {
    const cola = pendingSwitch[dest]; if (!cola || !cola.length) return null;
    const clave = Math.round(importe * 100);
    let i = cola.findIndex(x => x.importe === clave);
    if (i < 0) i = 0;                                    // sin importe exacto, el más antiguo
    return cola.splice(i, 1)[0].costEUR;
  };
  const addQty = (h, q, costEUR, costCcy) => { h.qty += q; h.costEUR += costEUR; h.costCcy += costCcy; h.lots.push({ qty: q, costEUR }); };
  for (const op of ops) {
    cur.date = op.date; cur.tipo = op.type;
    while (di < divs.length && divs[di].date < op.date) applyDiv(divs[di++]);
    const a = op.account_id, pid = op.position_id, t = op.type, q = num(op.qty);
    const A = opAmounts(op);
    if (!pid) { // caja
      if (t === 'deposit') cashAdd(a, A.ccy, A.gross);
      else if (t === 'withdrawal') cashAdd(a, A.ccy, -A.gross);
      else if (t === 'interest') { cashAdd(a, A.ccy, A.gross); income.interest += A.grossEUR; }
      else if (t === 'commission') { cashAdd(a, A.ccy, -A.gross); income.fees += A.grossEUR; }
      else if (t === 'transfer') { cashAdd(a, A.ccy, -A.gross); cashAdd(op.to_account_id, A.ccy, A.gross); }
      continue;
    }
    const h = hold(a, pid); const p = posOf(pid); const multi = acctOf(a)?.multi_currency;
    // Coste en la divisa de la posición: si el bróker liquidó en otra divisa (Trade Republic opera en euros), se convierte con el cambio del día
    const pc = p?.currency || 'EUR'; const gPos = A.ccy === pc ? A.gross : A.grossEUR / (fxAt(pc, op.date) || 1); A.grossPos = gPos;
    const payCash = (sign, amounts) => { // sign -1 compra, +1 venta
      if (op.auto_fx || A.ccy === 'EUR' || !multi) cashAdd(a, 'EUR', sign * amounts.totalEUR);
      else { cashAdd(a, A.ccy, sign * amounts.gross); cashAdd(a, 'EUR', -amounts.commEUR - amounts.taxEUR); }
    };
    if (t === 'buy' || t === 'optionBuy' || t === 'scrip') { addQty(h, q, A.totalEUR, A.grossPos); h.bought += A.totalEUR; if (t !== 'scrip') payCash(-1, A); else cashAdd(a, 'EUR', -A.commEUR); }
    else if (t === 'sell' || t === 'optionSell') { removeQty(h, q, { proceedsEUR: A.totalEUR }); payCash(+1, A); }
    else if (t === 'switch') { const { costOut } = removeQty(h, q, { realize: false }); anotarTraspaso(op.switch_to, A.gross, op.date, costOut); }
    else if (t === 'switchBuy') { const carried = cobrarTraspaso(pid, A.gross); addQty(h, q, carried != null ? carried : A.totalEUR, A.grossPos); }
    else if (t === 'spinOff') { const alloc = num(op.spinoff_alloc) / 100; if (alloc > 0 && alloc < 1) { const move = h.costEUR * alloc; h.costEUR -= move; h.costCcy -= h.costCcy * alloc; h.lots.forEach(l => l.costEUR *= (1 - alloc)); pendingCost[op.spinoff_to + '|' + op.date] = (pendingCost[op.spinoff_to + '|' + op.date] || 0) + move; } }
    else if (t === 'spinOffBuy') { const key = pid + '|' + op.date; const c = pendingCost[key] || 0; pendingCost[key] = 0; addQty(h, q, c, 0); }
    else if (t === 'split') { const f = q || 1; h.qty *= f; h.lots.forEach(l => l.qty *= f); }
    else if (t === 'stakeReward') { addQty(h, q, A.grossEUR, A.grossPos); income.rewards += A.grossEUR; }
    else if (t === 'interest') { addQty(h, q, A.grossEUR, A.grossPos); income.interest += A.grossEUR; }
    else if (t === 'deposit') { addQty(h, q, A.grossEUR, A.grossPos); }
    else if (t === 'withdrawal') { removeQty(h, q, { realize: false }); }
    else if (t === 'commission') { removeQty(h, q, { realize: false }); income.fees += A.grossEUR; }
    else if (t === 'adjust') { if (q >= 0) addQty(h, q, A.grossEUR, A.grossPos); else removeQty(h, -q, { realize: false }); }
  }
  while (di < divs.length) applyDiv(divs[di++]);
  // Umbral de 1 €: por debajo es ruido de redondeo de las patas y no merece una alarma alta.
  for (const dest in pendingSwitch) for (const x of pendingSwitch[dest]) if (Math.abs(x.costEUR) > 1) avisos.push({ positionId: dest, date: x.date, tipo: 'switch', huerfano: x.costEUR });
  return { H, cash, income, avisos };
}

// ---------- splits y series retroajustadas ----------
// Las series que descargan las fuentes vienen RETROAJUSTADAS: un precio de 2024 ya está expresado en
// títulos de hoy. El replay aplica el split el día que ocurre, que es lo correcto para que la cantidad
// de HOY cuadre con el extracto; pero valorar una fecha ANTERIOR al split con los títulos de entonces
// y el precio ya ajustado contaba el ajuste dos veces, y el patrimonio daba saltos que no existieron:
// RLI pasó de 448,23 € el 15 ene 2025 a 907,41 € el 16 (+102,4 %), y AVGO enseñaba −90 % durante los
// cinco días previos al 15 jul 2024. La corrección es llevar los títulos de entonces a la escala de
// hoy multiplicándolos por los splits POSTERIORES a la fecha que se valora. Hoy el factor es 1.
let splitsCache = null, splitsSrc = null;
function splitsPorPosicion() {
  if (splitsCache && splitsSrc === DB.operations) return splitsCache;
  const m = {};
  for (const o of DB.operations || []) if (o.type === 'split') (m[o.position_id] = m[o.position_id] || []).push({ date: o.date, f: num(o.qty) || 1 });
  splitsSrc = DB.operations; splitsCache = m; return m;
}
export function ajusteSplit(pid, date) {
  const l = splitsPorPosicion()[pid]; if (!l) return 1;
  let f = 1; for (const s of l) if (s.date > date) f *= s.f;
  return f;
}

// ---------- valoración ----------
export function compute(cutoff, { includeVivienda = false } = {}) {
  const date = cutoff || todayISO(); const R = replay(cutoff);
  const rows = [];
  for (const h of Object.values(R.H)) {
    if (Math.abs(h.qty) < 1e-9) continue;
    const p = posOf(h.positionId) || { id: h.positionId, ticker: h.positionId, name: '', currency: 'EUR', type: 'custom' };
    if (!includeVivienda && !isInvest(p)) continue;
    const fx = fxAt(p.currency, date); const pr = priceAt(p.id, date);
    // Títulos llevados a la escala de la serie de precios (ver ajusteSplit). Hoy el factor es 1; en
    // fechas anteriores a un split lleva los títulos de entonces a títulos de hoy, que es en lo que
    // está expresado el precio retroajustado. Se aplica también al coste medio para que la fila sea
    // coherente consigo misma: precio, coste medio y títulos en la misma escala.
    const adj = ajusteSplit(p.id, date); const qty = h.qty * adj;
    let last = pr ? pr.price : null, priceDate = pr ? pr.date : null, stale = pr ? pr.stale : true;
    if (last == null) { last = qty ? h.costCcy / qty : 0; priceDate = null; }
    const mvCcy = qty * last, mvEUR = mvCcy * fx;
    const avg = qty ? h.costCcy / qty : 0, avgEUR = qty ? h.costEUR / qty : 0;
    const gain = mvEUR - h.costEUR; const gainPct = h.costEUR ? gain / h.costEUR * 100 : 0;
    rows.push({ ...h, qty, p, bucket: defaultBucket(p), fx, last, priceDate, stale, mvCcy, mvEUR, avg, avgEUR, gain, gainPct });
  }
  const cashEUR = {}, cashRaw = {}, cashWarnings = []; let cashTotal = 0;
  for (const a in R.cash) {
    let v = 0; for (const c in R.cash[a]) v += R.cash[a][c] * fxAt(c, date);
    cashRaw[a] = v;
    // Cuentas «sin caja» (nota del usuario): su efectivo no se cuenta; las compras son aportaciones
    if (/sin caja/i.test(acctOf(a)?.notes || '')) { cashEUR[a] = 0; continue; }
    // Un saldo negativo significa que faltan ingresos por registrar (Filios no los guardaba): no se resta al valor, se avisa
    if (v < -1) cashWarnings.push({ accountId: a, v });
    cashEUR[a] = Math.max(0, v); cashTotal += cashEUR[a];
  }
  return { ...R, rows, cashEUR, cashRaw, cashWarnings, cashTotal, date };
}
export function viviendaValue(date) {
  const C = compute(date, { includeVivienda: true });
  return C.rows.filter(r => !isInvest(r.p));
}

// ---------- selección ----------
export const SEL = { buckets: [], types: [], accounts: [] };
export const selIsAll = () => !SEL.buckets.length && !SEL.types.length && !SEL.accounts.length;
export function inSelPos(p, accountId) { return isInvest(p) && (!SEL.buckets.length || SEL.buckets.includes(defaultBucket(p))) && (!SEL.types.length || SEL.types.includes(p.type)) && (!SEL.accounts.length || SEL.accounts.includes(accountId)); }
export function inSelCash(accountId) { return (!SEL.buckets.length || SEL.buckets.includes(3)) && (!SEL.types.length || SEL.types.includes('cash')) && (!SEL.accounts.length || SEL.accounts.includes(accountId)); }
// Para valor y rentabilidad la cartera son las posiciones (como en Filios); el efectivo solo entra si se elige el tipo Efectivo
export function cashInPerf(accountId) { return SEL.types.includes('cash') && inSelCash(accountId); }

export function valueAt(date, { vivienda = false } = {}) {
  const C = compute(date, { includeVivienda: vivienda }); let v = 0;
  for (const r of C.rows) if (inSelPos(r.p, r.accountId) || (vivienda && !isInvest(r.p))) v += r.mvEUR;
  for (const a in C.cashEUR) if (cashInPerf(a)) v += C.cashEUR[a];
  return v;
}
// Flujos externos de la selección en (a, b], signo de inversor: negativo = dinero que entra
export function flowsBetween(a, b, { vivienda = false } = {}) {
  const F = [];
  const inPos = (pid, acc) => { const p = posOf(pid); return p ? (inSelPos(p, acc) || (vivienda && !isInvest(p))) : false; };
  for (const op of DB.operations) {
    if (!(op.date > a && op.date <= b)) continue;
    const t = op.type; const A = opAmounts(op); const acc = op.account_id; const cin = cashInPerf(acc);
    if (!op.position_id) {
      if (!cin) continue;
      if (t === 'deposit') F.push({ date: op.date, v: -A.grossEUR }); else if (t === 'withdrawal') F.push({ date: op.date, v: +A.grossEUR });
      else if (t === 'transfer') { const to = cashInPerf(op.to_account_id); if (cin && !to) F.push({ date: op.date, v: +A.grossEUR }); }
      continue;
    }
    const pin = inPos(op.position_id, acc);
    if (t === 'transfer' && !cin && cashInPerf(op.to_account_id)) { F.push({ date: op.date, v: -A.grossEUR }); continue; }
    if (['buy', 'optionBuy'].includes(t)) { if (pin && !cin) F.push({ date: op.date, v: -A.totalEUR }); else if (!pin && cin) F.push({ date: op.date, v: +A.totalEUR }); }
    else if (['sell', 'optionSell'].includes(t)) { if (pin && !cin) F.push({ date: op.date, v: +A.totalEUR }); else if (!pin && cin) F.push({ date: op.date, v: -A.totalEUR }); }
    else if (t === 'switch') { const pout = inPos(op.switch_to, op.switch_account || acc); if (pin && !pout) F.push({ date: op.date, v: +A.totalEUR }); else if (!pin && pout) F.push({ date: op.date, v: -A.totalEUR }); }
    else if (t === 'deposit') { if (pin) F.push({ date: op.date, v: -A.grossEUR }); }
    else if (t === 'withdrawal') { if (pin) F.push({ date: op.date, v: +A.grossEUR }); }
    else if (t === 'adjust') { if (pin) F.push({ date: op.date, v: -A.grossEUR }); }
  }
  for (const d of DB.dividends) {
    if (!(d.date > a && d.date <= b)) continue; const pin = inPos(d.position_id, d.account_id), cin = cashInPerf(d.account_id); const { netEUR } = divAmounts(d);
    if (pin && !cin) F.push({ date: d.date, v: +netEUR }); else if (!pin && cin) F.push({ date: d.date, v: -netEUR });
  }
  return F;
}
export function xirr(cfs) {
  if (cfs.length < 2) return null; const f = r => cfs.reduce((s, c) => s + c.v / Math.pow(1 + r, c.t / 365), 0);
  let lo = -0.9999, hi = 50; let flo = f(lo), fhi = f(hi); if (!isFinite(flo) || !isFinite(fhi) || flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; const fm = f(mid); if (flo * fm <= 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; } }
  return (lo + hi) / 2;
}
export function perf(a, b, opts = {}) {
  const V0 = valueAt(a, opts), V1 = valueAt(b, opts); const F = flowsBetween(a, b, opts); const T = Math.max(1, daysBetween(a, b));
  const inflow = -sum(F, f => f.v); const gain = V1 - V0 - inflow;
  if (Math.abs(V0) < 1 && !F.length) return { V0, V1, inflow, gain, mwr: null, mwrPeriod: null, dietz: null, ror: null, days: T };
  const cfs = [{ t: 0, v: -V0 }, ...F.map(f => ({ t: daysBetween(a, f.date), v: f.v })), { t: T, v: V1 }];
  const r = xirr(cfs); const mwrPeriod = r == null ? null : (Math.pow(1 + r, T / 365) - 1) * 100;
  const denom = V0 + sum(F, f => -f.v * (T - daysBetween(a, f.date)) / T); const dietz = denom > 0 ? gain / denom * 100 : null;
  const ror = V0 > 0 ? (V1 - V0) / V0 * 100 : null;
  return { V0, V1, inflow, gain, mwr: r == null ? null : r * 100, mwrPeriod, dietz, ror, days: T };
}
// ---------- la vara: los mismos flujos, en un índice ----------
// Es la única medida que contesta a «¿merece la pena elegir valores?». La TIR sola no lo dice: una TIR
// del 5 % puede ser excelente o pésima según lo que hiciera el mercado mientras tanto, y el dinero que
// entra tarde pesa más que el que entra pronto. Aquí se compran participaciones del índice con el mismo
// dinero, en las mismas fechas, y no se toca nada más.
//
// OJO CON EL PERÍMETRO, que es donde se equivocó la primera versión de este comentario. Comparar una
// CUENTA con un índice mete dentro dos cosas distintas: si eliges bien y si despliegas el dinero. El
// índice está invertido al 100 % desde el primer día y la cuenta tiene caja parada, así que la cuenta
// sale castigada por algo que no es la selección. Medido el 17 sep 2026 en Trade Republic: 266.854,65 €
// aportados, 3.241,36 € retirados, valor 285.795 € y TIR 7,94 % frente a 306.353 € y 14,99 % del índice.
//
// Pero el mismo cálculo POSICIÓN A POSICIÓN —cada euro en el índice el día que entró en cada valor—
// dice lo contrario: 124 acciones, 889.952 € desplegados, 247.416 € hoy frente a 216.685 € del índice,
// +30.731 €; y en cripto +7.889 €. La selección de valores del usuario BATE al MSCI World; lo que
// arrastra a la cuenta es el dinero sin desplegar. Por eso esta función se usa con la selección
// filtrada por posiciones, y nunca como veredicto sobre una cuenta entera.
//
// Por orden: el ISIN de IWDA, que en esta base tiene serie DIARIA (4.427 cierres); si no está, la
// versión mensual; y por último el S&P en euros. Con serie mensual el resultado es aproximado y se
// dice: `diaria` viene a false.
export const INDICE_VARA = ['IE00B4L5Y983', 'IWDA.AS', 'SXR8.DE'];
export function serieIndice(simbolos = INDICE_VARA) {
  let mejor = null;
  for (const s of simbolos) { const m = DB.bench[s]; if (!m) continue; const n = Object.keys(m).length; if (!mejor || n > mejor.n) mejor = { symbol: s, m, n }; }
  return mejor;
}
export function perfIndice(a, b, opts = {}, simbolos = INDICE_VARA) {
  const S = serieIndice(simbolos); if (!S) return null;
  const px = d => { const r = latestAtOrBefore(S.m, d); return r && r.value > 0 ? r.value : null; };
  const p0 = px(a), p1 = px(b); if (!p0 || !p1) return null;
  const V0 = valueAt(a, opts); const F = flowsBetween(a, b, opts); const T = Math.max(1, daysBetween(a, b));
  let uds = V0 / p0;
  for (const f of F) { const p = px(f.date); if (!p) return null; uds += (-f.v) / p; }
  const V1 = uds * p1;
  const cfs = [{ t: 0, v: -V0 }, ...F.map(f => ({ t: daysBetween(a, f.date), v: f.v })), { t: T, v: V1 }];
  const r = xirr(cfs);
  // Una serie de 141 puntos es mensual: el cierre que se usa para cada flujo puede ser de hace semanas.
  const diaria = S.n > (daysBetween(Object.keys(S.m).sort()[0], b) / 365) * 100;
  return { symbol: S.symbol, V1, mwr: r == null ? null : r * 100, diaria, puntos: S.n };
}

// ---------- el pulso: último cierre y cierre anterior ----------
// «Hoy» no es `todayISO()`. El trabajo de precios corre a las 22:00 UTC de lunes a viernes, así que a
// media mañana el último cierre que hay en la base es el de ayer. Enseñar una cifra de hoy calculada
// con el cierre de ayer y llamarla «hoy» es una mentira educada: la fecha se mide y se escribe.
//
// El cierre anterior se busca solo entre las posiciones que SÍ tienen el último (las frescas), y
// dejando fuera la cripto si hay alguna acción fresca: la cripto cotiza los siete días y, si mandara
// ella, el día de la bolsa saldría «domingo contra lunes», que para una acción no es un día.
export function cierres(C) {
  let hoy = null;
  const vale = r => isInvest(r.p) && r.p.price_mode !== 'manual' && r.priceDate;
  for (const r of C.rows) if (vale(r) && (!hoy || r.priceDate > hoy)) hoy = r.priceDate;
  if (!hoy) return null;
  const frescas = C.rows.filter(r => vale(r) && r.priceDate === hoy);
  const base = frescas.some(r => r.p.type !== 'crypto') ? frescas.filter(r => r.p.type !== 'crypto') : frescas;
  let previo = null;
  for (const r of base) {
    const m = DB.prices[r.p.id]; if (!m) continue;
    for (const k in m) if (k < hoy && (!previo || k > previo)) previo = k;
  }
  return { hoy, previo };
}

// Cuánto de la cartera cotizada lleva el último cierre y cuánto se ha quedado atrás. Sin esto, una
// posición sin precio nuevo aporta 0,00 € al día y se lee como «no se movió», cuando es «no lo sé».
export function cobertura(C, hoy) {
  const out = { alDia: 0, atrasadas: 0, eurAtrasado: 0, masViejo: null };
  for (const r of C.rows) {
    if (!isInvest(r.p) || r.p.price_mode === 'manual') continue;
    if (r.priceDate === hoy) { out.alDia++; continue; }
    out.atrasadas++; out.eurAtrasado += r.mvEUR;
    if (r.priceDate && (!out.masViejo || r.priceDate < out.masViejo)) out.masViejo = r.priceDate;
  }
  return out;
}

// Ejecuta algo como si no hubiera ningún filtro puesto. La tira de Inicio va ENCIMA de la barra de
// filtros, junto al patrimonio total, y habla siempre de la cartera entera: si cambiara al filtrar
// estaría midiendo una cosa y titulando otra.
export function sinFiltros(fn) {
  const b = SEL.buckets, t = SEL.types, a = SEL.accounts;
  SEL.buckets = []; SEL.types = []; SEL.accounts = [];
  try { return fn(); } finally { SEL.buckets = b; SEL.types = t; SEL.accounts = a; }
}

export function firstOpDate() { let m = null; for (const o of DB.operations) if (!m || o.date < m) m = o.date; return m || todayISO(); }
export function benchReturn(symbol, a, b) { const m = DB.bench[symbol]; if (!m) return null; const x = latestAtOrBefore(m, a), y = latestAtOrBefore(m, b); return x && y && x.value ? (y.value / x.value - 1) * 100 : null; }

// ---------- índice compuesto de referencia ----------
// Cinco patas con un proxy real cotizado en euros: no hay divisa que estimar. Todos son de
// acumulación (el precio ya es retorno total) salvo EUNH.DE, de reparto, que fetch_market.py
// guarda con los cupones reinvertidos. Orden: los cuatro cubos de la doctrina.
export const BENCH_LEGS = [
  { id: 'rv', sym: 'IWDA.AS', nm: 'Renta variable mundial', color: '#3F51B5', def: 50, nota: 'MSCI World, acumulación' },
  { id: 'oro', sym: '4GLD.DE', nm: 'Oro', color: '#FFD600', def: 15, nota: 'Xetra-Gold, oro físico en euros' },
  { id: 'btc', sym: 'BTC-EUR', nm: 'Bitcoin', color: '#FF7043', def: 15, nota: 'Bitcoin en euros' },
  { id: 'bonos', sym: 'EUNH.DE', nm: 'Bonos euro', color: '#8E24AA', def: 10, nota: 'Deuda pública euro, cupones reinvertidos' },
  { id: 'caja', sym: 'XEON.DE', nm: 'Caja €STR', color: '#43A047', def: 10, nota: 'Tipo a un día del BCE, acumulación' },
];
export const BENCH_DEFAULT = Object.fromEntries(BENCH_LEGS.map(l => [l.id, l.def]));
// Pesos guardados en Ajustes; el formato viejo (spx/gold/cash) no tiene estas claves y cae al de la doctrina
export function benchWeights() {
  const w = DB.settings?.benchmark || {};
  if (!BENCH_LEGS.some(l => w[l.id] != null)) return { ...BENCH_DEFAULT };
  return Object.fromEntries(BENCH_LEGS.map(l => [l.id, +w[l.id] || 0]));
}
// Un dato muy anterior al cierre pedido es un hueco, no un dato: devolver 0 % sería inventarlo
const BENCH_STALE = 45;
export function benchMonthReturn(sym, ym) {
  const m = DB.bench[sym]; if (!m) return null;
  const a = monthEnd(addMonths(ym, -1)), b = monthEnd(ym);
  const x = latestAtOrBefore(m, a), y = latestAtOrBefore(m, b);
  if (!x || !y || !x.value) return null;
  if (daysBetween(x.date, a) > BENCH_STALE || daysBetween(y.date, b) > BENCH_STALE) return null;
  return (y.value / x.value - 1) * 100;
}
// Rendimiento mensual del compuesto. Si falta una pata con peso se devuelve null y se nombra:
// el gráfico dibuja un hueco y la vista lo avisa, nunca se cuenta como 0 %.
export function benchComposite(weights, fromYM, toYM) {
  const w = weights || benchWeights();
  const tot = BENCH_LEGS.reduce((s, l) => s + (w[l.id] || 0), 0);
  const out = [];
  for (let ym = fromYM; ym <= toYM; ym = addMonths(ym, 1)) {
    let r = 0; const falta = [];
    for (const l of BENCH_LEGS) {
      const p = (w[l.id] || 0) / (tot || 1); if (!p) continue;
      const x = benchMonthReturn(l.sym, ym);
      if (x == null) falta.push(l.id); else r += p * x;
    }
    out.push({ ym, r: falta.length ? null : r, falta });
  }
  return out;
}
// Riesgo y recorrido de una serie de rendimientos mensuales en %: todo observado, nada estimado
export function riskMetrics(rs, rfCagr) {
  const r = rs.filter(x => x != null).map(x => x / 100);
  if (r.length < 12) return null;
  let v = 1; for (const x of r) v *= 1 + x;
  const cagr = (Math.pow(v, 12 / r.length) - 1) * 100;
  const mu = r.reduce((s, x) => s + x, 0) / r.length;
  const vol = Math.sqrt(r.reduce((s, x) => s + (x - mu) ** 2, 0) / (r.length - 1)) * Math.sqrt(12) * 100;
  let e = 1, pk = 1, dd = 0, ddi = 0; const eq = [], ddc = [];
  for (let i = 0; i < r.length; i++) {
    e *= 1 + r[i]; pk = Math.max(pk, e);
    const d = e / pk - 1; if (d < dd) { dd = d; ddi = i; }
    eq.push(e * 100); ddc.push(d * 100);
  }
  const roll = [];
  for (let i = 0; i + 12 <= r.length; i++) { let p = 1; for (let j = i; j < i + 12; j++) p *= 1 + r[j]; roll.push((p - 1) * 100); }
  return { n: r.length, cagr, vol, dd: dd * 100, ddi, up: Math.max(...roll), dn: Math.min(...roll),
    neg: roll.filter(x => x < 0).length / roll.length * 100, nwin: roll.length, eq, ddc,
    sharpe: vol ? (cagr - (rfCagr || 0)) / vol : null };
}
export const RIESGO = [[5, 'Muy bajo'], [10, 'Bajo'], [15, 'Medio'], [22, 'Alto'], [Infinity, 'Muy alto']];
export const nivelRiesgo = v => RIESGO.find(x => v < x[0])[1];
// El S&P para comparar rentabilidad es el UCITS de acumulación en euros (retorno total, sin divisa
// que estimar). Si aún no está descargado se usa el índice de precio y la etiqueta lo dice.
export const spBench = () => DB.bench['SXR8.DE']
  ? { sym: 'SXR8.DE', label: 'S&P 500 TR (EUR)', tr: true }
  : { sym: '^GSPC', label: 'S&P 500 (precio, USD)', tr: false };
export const spReturn = (a, b) => benchReturn(spBench().sym, a, b);
// Serie mensual de la selección (MWR y Dietz del mes) y del S&P 500
const seriesCache = new Map();
export function invalidate() { seriesCache.clear(); }
export function monthlySeries(fromYM, toYM) {
  const key = JSON.stringify([fromYM, toYM, SEL, DB.operations.length, DB.dividends.length]);
  if (seriesCache.has(key)) return seriesCache.get(key);
  const today = todayISO(); const out = [];
  for (let ym = fromYM; ym <= toYM; ym = addMonths(ym, 1)) {
    const end = monthEnd(ym) < today ? monthEnd(ym) : today; const start = monthEnd(addMonths(ym, -1));
    const row = { ym, sp: spReturn(start, end), own: null, twr: null, value: null };
    if (end > start) {
      const p = perf(start, end); row.value = p.V1; row.V0 = p.V0; row.inflow = p.inflow; row.gain = p.gain;
      // Sin base no hay rentabilidad mensual que tenga sentido (evita picos absurdos el mes en que arranca una selección)
      const noBase = p.V0 < 1000 || p.V0 < Math.abs(p.inflow) * 0.05;
      row.own = noBase ? null : p.mwrPeriod; row.twr = noBase ? null : p.dietz;
    }
    out.push(row);
  }
  seriesCache.set(key, out);
  return out;
}
// Serie mensual de valor al estilo Filios: tres curvas sobre el mismo eje en euros.
//   valor      — valor de mercado de las posiciones al cierre de cada mes (lo mismo que dibuja Filios)
//   conRentas  — ese valor más los dividendos cobrados y las plusvalías realizadas acumuladas: lo que
//                habrías tenido si nada hubiera salido de la cartera
//   invertido  — el coste de lo que está abierto en ese momento, no la suma de todo lo aportado nunca
// La diferencia entre valor e invertido es la ganancia latente; entre conRentas y valor, lo ya cobrado.
// Se recalcula una vez por mes con el mismo replay que el resto del motor, así que respeta la selección
// de filtros y las reglas de siempre (el efectivo no entra; las posiciones manuales valen su tasación).
export function monthlyValueSeries(fromYM, toYM) {
  const key = 'val|' + JSON.stringify([fromYM, toYM, SEL, DB.operations.length, DB.dividends.length]);
  if (seriesCache.has(key)) return seriesCache.get(key);
  const today = todayISO(); const out = [];
  for (let ym = fromYM; ym <= toYM; ym = addMonths(ym, 1)) {
    const end = monthEnd(ym) < today ? monthEnd(ym) : today;
    const C = compute(end);
    const rows = C.rows.filter(r => inSelPos(r.p, r.accountId));
    const valor = sum(rows, r => r.mvEUR);
    const invertido = sum(rows, r => r.costEUR);
    // Cobrado: dividendos netos y plusvalías realizadas hasta ese cierre, dentro de la selección
    const div = DB.dividends.filter(d => d.date <= end && inSelPos(posOf(d.position_id) || {}, d.account_id))
      .reduce((a, d) => a + divAmounts(d).netEUR, 0);
    // Las plusvalías realizadas se leen del mapa de tenencias, no de las filas: `rows` solo trae lo
    // que sigue abierto, y lo que más plusvalía ha realizado es precisamente lo que ya se vendió.
    let realizado = 0;
    for (const h of Object.values(C.H)) {
      const p = posOf(h.positionId); if (p && inSelPos(p, h.accountId)) realizado += h.realized;
    }
    out.push({ ym, valor, invertido, conRentas: valor + div + realizado });
  }
  seriesCache.set(key, out);
  return out;
}
export function groupBy(rows, keyFn, labelFn, colorFn, PALETTE) {
  const m = {}; rows.forEach(r => { const k = keyFn(r); (m[k] = m[k] || { k, v: 0, cost: 0, gain: 0, n: 0 }); m[k].v += r.mvEUR; m[k].cost += r.costEUR; m[k].gain += r.gain; m[k].n++; });
  return Object.values(m).sort((a, b) => b.v - a.v).map((g, i) => ({ ...g, label: labelFn(g.k), color: colorFn ? colorFn(g.k, i) : PALETTE[i % PALETTE.length] }));
}

// ---------- mirar DENTRO de los fondos ----------
//
// Un fondo no es una sola cosa. La base guarda un cubo por posición, y eso obliga a contar entera en
// renta variable una cartera gestionada que lleva el 43 % en bonos. El usuario lo pidió el 19 sep
// 2026: «en el caso de los fondos mixtos que sumen proporcionalmente donde les corresponda».
//
// La composición la baja `jobs/composicion.py` de Financial Times y vive en `settings.composiciones`,
// con su fecha y su fuente. Tres reglas, y las tres se decidieron explícitamente:
//  · **bolsa → cubo 1; bonos y caja → cubo 3.** Para MEDIR cuentan todos los bonos, soberanos o no;
//    lo de «solo soberanos» es la regla de lo que se COMPRA, no de cómo se mide lo que ya se tiene.
//  · **«otros» se queda en el cubo declarado de la posición.** En esa fila de FT caben oro,
//    inmobiliario y derivados; repartirlo sería inventar. Y sacarlo del reparto rompería los totales.
//  · **la caja negativa se respeta.** Es apalancamiento de verdad y truncarla escondería información.
//
// Se normaliza por la suma cruda de FT (99,98 a 100,01 en los siete fondos medidos) para que las
// partes sumen EXACTAMENTE el valor de la posición: si no, los cubos dejarían de cuadrar con la
// cartera por unas centésimas y todos los totales quedarían descuadrados sin motivo aparente.
export const composicionDe = id => (DB.settings && DB.settings.composiciones && DB.settings.composiciones[id]) || null;

// Fracciones por cubo que suman 1. Sin composición, todo al cubo declarado.
export function repartoCubos(r) {
  const b = r.bucket || defaultBucket(r.p);
  const c = composicionDe(r.p && r.p.id);
  if (!c) return { [b]: 1 };
  // **Ninguna pata reparte en negativo: se recorta a cero y se reescala sobre lo que queda.**
  // La caja negativa que publica FT es real —es apalancamiento: el fondo está invertido al 109 % y
  // pide prestado el 9 %—, pero la primera versión de esto la sumaba a los bonos, y eso cargaba TODO
  // el préstamo a la renta fija sin ninguna razón. El préstamo no es deuda pública en negativo: es un
  // pasivo que financia todo el fondo a la vez, y FT no dice qué compró con él. Recortar y reescalar
  // lo reparte en proporción, que es la única respuesta neutral cuando el dato no existe. De paso
  // desaparece el absurdo de que un fondo que TIENES haga tu renta fija más pequeña en euros.
  //
  // El crudo NO se toca: `settings.composiciones` sigue guardando el -9,09 % con su fecha y su
  // fuente, que es donde se ve el apalancamiento. El recorte es solo para repartir.
  const cero = v => Math.max(0, num(v));
  const bolsa = cero(c.bolsa), bonos = cero(c.bonos), caja = cero(c.caja), otros = cero(c.otros);
  const suma = bolsa + bonos + caja + otros;
  if (!suma) return { [b]: 1 };
  const out = {};
  const add = (cubo, v) => { if (v > 1e-12) out[cubo] = (out[cubo] || 0) + v; };
  add(1, bolsa / suma);
  add(3, (bonos + caja) / suma);
  add(b, otros / suma);
  return Object.keys(out).length ? out : { [b]: 1 };
}

// Las filas de una posición mixta se desdoblan en una por cubo, con su parte del valor. Solo se usa
// donde se agrupa POR CUBO: en el reparto por tipo, región o sector desdoblar duplicaría la fila.
export function expandirCubos(rows) {
  const out = [];
  for (const r of rows) {
    const f = repartoCubos(r);
    const ks = Object.keys(f);
    if (ks.length === 1 && +ks[0] === (r.bucket || defaultBucket(r.p))) { out.push(r); continue; }
    for (const k of ks) {
      const q = f[k];
      out.push({ ...r, bucket: +k, mvEUR: r.mvEUR * q, costEUR: r.costEUR * q,
                 gain: (r.gain || 0) * q, div: (r.div || 0) * q, realized: (r.realized || 0) * q,
                 mirado: true, parte: q });
    }
  }
  return out;
}

// Cuánto de lo que hay en fondos NO tiene composición medida, y desde cuándo está la más vieja.
// Lo usa la campana: una composición de hace medio año ya no describe un fondo de gestión activa.
export function saludComposiciones(rows) {
  let conDato = 0, sinDato = 0, masVieja = null;
  const faltan = [];
  for (const r of rows) {
    if (!r.p || !['fund', 'etf'].includes(r.p.type) || !(r.mvEUR > 0)) continue;
    const c = composicionDe(r.p.id);
    if (!c) { sinDato += r.mvEUR; faltan.push(r.p.ticker || r.p.id); continue; }
    conDato += r.mvEUR;
    if (c.fecha && (!masVieja || c.fecha < masVieja)) masVieja = c.fecha;
  }
  return { conDato, sinDato, faltan, masVieja,
           dias: masVieja ? daysBetween(masVieja, todayISO()) : null };
}
