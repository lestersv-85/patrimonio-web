// Comprobaciones de coherencia: cada operación tiene que mover el efectivo y las cantidades de forma coherente.
// Devuelve alarmas con nivel (alta, media, info) para la campana de la cabecera.
import { DB } from './store.js?v=25c4e9c';
import { compute, replay, opAmounts, divAmounts, posOf, acctOf, acctName } from './engine.js?v=25c4e9c';
import { fmtEUR, fmtN, fmtDate, todayISO, OP_LABEL, daysBetween, addDays } from './util.js?v=25c4e9c';

const KNOWN = new Set(['buy', 'sell', 'switch', 'switchBuy', 'spinOff', 'spinOffBuy', 'split', 'scrip', 'stakeReward', 'interest', 'deposit', 'withdrawal', 'commission', 'optionBuy', 'optionSell', 'transfer', 'adjust']);
const CASH_MOVES = new Set(['buy', 'sell', 'deposit', 'withdrawal', 'interest', 'commission', 'optionBuy', 'optionSell', 'transfer']);

export function runChecks() {
  const out = []; const today = todayISO();
  const add = (level, key, title, detail, where) => out.push({ level, key, title, detail, where });
  const C = compute();
  // 1. Efectivo: saldo negativo = compras pagadas sin ingreso registrado
  for (const a in C.cashRaw) {
    const acc = acctOf(a); if (/sin caja/i.test(acc?.notes || '')) continue;
    if (C.cashRaw[a] < -1) add('alta', 'cash-' + a, `Efectivo negativo en ${acctName(a)}: ${fmtEUR(C.cashRaw[a], 0)}`, 'Hay compras pagadas sin un ingreso registrado. Registra la aportación con su fecha (Movimientos › + Operación › Ingreso, nota «aportación») o revisa las ventas que faltan. Mientras tanto ese saldo no resta al valor.', 'cuentas');
  }
  // 2. Operaciones: tipo desconocido, sin cambio, importes incoherentes, fechas futuras
  const seen = new Set();
  for (const op of DB.operations) {
    const p = posOf(op.position_id);
    if (!KNOWN.has(op.type)) add('alta', 'type-' + op.id, `Operación con tipo desconocido «${op.type}»`, `${fmtDate(op.date)} ${acctName(op.account_id)} ${p?.ticker || ''}. El motor no sabe si mueve efectivo o cantidades: no se contabiliza.`, 'movimientos');
    if (op.date > today) add('media', 'future-' + op.id, `Operación con fecha futura: ${p?.ticker || OP_LABEL[op.type] || op.type} el ${fmtDate(op.date)}`, 'No entra en el valor de hoy. Corrige la fecha si es un error.', 'movimientos');
    const ccy = op.currency || 'EUR';
    if (ccy !== 'EUR' && !(op.fx > 0) && !DB.fx[ccy]) add('media', 'fx-' + op.id, `Sin cambio ${ccy}→EUR para ${p?.ticker || ''} el ${fmtDate(op.date)}`, 'No hay cambio BCE guardado para esa fecha ni en la operación: se valora a 1. Ejecuta el job de cambios (fetch_market fx).', 'movimientos');
    if (['buy', 'sell', 'switch', 'switchBuy'].includes(op.type)) {
      const A = opAmounts(op); const q = Math.abs(+op.qty || 0), pr = +op.price || 0;
      if (q > 0 && pr > 0 && A.gross > 1 && Math.abs(A.gross - q * pr) / A.gross > 0.02) add('media', 'amt-' + op.id, `Importe incoherente en ${p?.ticker || ''} (${fmtDate(op.date)})`, `Total ${fmtN(A.gross, 2)} ${ccy} frente a cantidad × precio ${fmtN(q * pr, 2)}: difieren más del 2 %. Comprueba precio, cantidad o total.`, 'movimientos');
      if (!(q > 0)) add('media', 'qty-' + op.id, `${OP_LABEL[op.type] || op.type} de ${p?.ticker || ''} sin cantidad (${fmtDate(op.date)})`, 'Una compra o venta con cantidad 0 no mueve la cartera.', 'movimientos');
    }
    if (op.type === 'adjust' && !seen.has('adjust')) { seen.add('adjust'); const n = DB.operations.filter(o => o.type === 'adjust').length; add('info', 'adjust', `${n} ajustes de conciliación en la cartera`, 'Cuadran cantidades que el historial de Filios no explica (traspasos incoherentes). Si corriges el origen en Filios y reimportas, desaparecen solos.', 'movimientos'); }
  }
  // 3. Cantidades negativas o ventas mayores que la posición (replay)
  const R = replay();
  for (const h of Object.values(R.H)) { if (h.qty < -0.05) { const p = posOf(h.positionId); add('alta', 'neg-' + h.accountId + h.positionId, `Cantidad negativa: ${p?.ticker || h.positionId} en ${acctName(h.accountId)} (${fmtN(h.qty, 4)})`, 'Se ha vendido o traspasado más de lo que había. Falta una compra o un traspaso de entrada, o sobra una venta.', 'posiciones'); } }
  // 4. Dividendos de posiciones que no se tenían ese día
  for (const d of DB.dividends) {
    // El pago llega semanas después de la fecha ex-dividendo: vale con haber tenido la posición en esa cuenta en los 90 días anteriores
    // (se tuvo si hay saldo ese día o si hubo cualquier operación de esa posición en esa cuenta en la ventana)
    const from = addDays(d.date, -90);
    const held = (() => { const h = replay(d.date).H[d.account_id + '|' + d.position_id]; if (h && h.qty > 1e-9) return true; return DB.operations.some(o => o.position_id === d.position_id && o.account_id === d.account_id && o.date >= from && o.date <= d.date); })();
    if (!held && !/aceptado por el usuario/i.test(d.description || '')) { const p = posOf(d.position_id); add('media', 'div-' + d.id, `Dividendo de ${p?.ticker || d.position_id} sin posición en ${acctName(d.account_id)} (${fmtDate(d.date)})`, 'Ni ese día ni en los 90 días anteriores hubo títulos ni operaciones de esa posición en esa cuenta: falta la compra en el historial o el dividendo está en otra cuenta.', 'movimientos'); }
    const A = divAmounts(d); if (A.netEUR > A.grossEUR + 0.01) add('media', 'divnet-' + d.id, `Dividendo con neto mayor que bruto: ${posOf(d.position_id)?.ticker || ''} ${fmtDate(d.date)}`, 'Revisa retenciones y comisión.', 'movimientos');
  }
  // 5. Precios: posiciones automáticas sin precio reciente y manuales muy antiguas
  for (const r of C.rows) {
    if (r.p.price_mode === 'manual') { if (r.priceDate && daysBetween(r.priceDate, today) > 365) add('info', 'old-' + r.p.id, `${r.p.ticker}: precio manual de hace más de un año (${fmtDate(r.priceDate)})`, 'Actualiza la tasación en Posiciones si ha cambiado.', 'posiciones'); continue; }
    if (!r.priceDate) add('media', 'noprice-' + r.p.id, `${r.p.ticker} sin ningún precio: se valora al coste`, 'Resuelve el símbolo (Posiciones) o introduce un precio manual.', 'posiciones');
    else if (daysBetween(r.priceDate, today) > 40) add('media', 'stale-' + r.p.id, `${r.p.ticker}: último precio de hace ${daysBetween(r.priceDate, today)} días (${fmtDate(r.priceDate)})`, 'La fuente automática no ha devuelto precio. Comprueba el símbolo o introduce el precio a mano.', 'posiciones');
  }
  // 6. Cambios del BCE al día
  const usd = DB.fx.USD; if (usd) { const k = Object.keys(usd).sort(); const last = k[k.length - 1]; if (daysBetween(last, today) > 7) add('media', 'fxold', `Cambio USD del BCE de hace ${daysBetween(last, today)} días (${fmtDate(last)})`, 'El trabajo diario de cambios no ha corrido. Revisa GitHub Actions.', 'ajustes'); }
  const order = { alta: 0, media: 1, info: 2 };
  out.sort((a, b) => order[a.level] - order[b.level]);
  return out;
}

const DISMISS_KEY = 'sp.alarmas.vistas';
export function dismissedKeys() { try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')); } catch { return new Set(); } }
export function dismiss(keys) { try { const s = dismissedKeys(); keys.forEach(k => s.add(k)); localStorage.setItem(DISMISS_KEY, JSON.stringify([...s])); } catch { /* sin almacenamiento */ } }
export function undismissAll() { try { localStorage.removeItem(DISMISS_KEY); } catch { /* sin almacenamiento */ } }
