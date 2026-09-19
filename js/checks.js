// Comprobaciones de coherencia: cada operación tiene que mover el efectivo y las cantidades de forma coherente.
// Devuelve alarmas con nivel (alta, media, info) para la campana de la cabecera.
import { DB } from './store.js?v=3bf8a9f';
import { compute, replay, opAmounts, divAmounts, posOf, acctOf, acctName, defaultBucket, expandirCubos, saludComposiciones } from './engine.js?v=3bf8a9f';
import { fmtEUR, fmtN, fmtDate, todayISO, OP_LABEL, daysBetween, addDays, sum } from './util.js?v=3bf8a9f';
import { tesisAEscenarios } from './kelly.js?v=3bf8a9f';
import { targets, ORO_IDS } from './recommend.js?v=3bf8a9f';

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
  // 1 bis. Datos contradictorios que el motor no puede resolver con aritmética (ver removeQty en
  // engine.js): retirar más títulos de los que la posición tiene, y traspasos cuya pata de compra
  // nunca apareció. Los dos ensucian el coste en silencio, así que se dicen en voz alta.
  for (const av of (replay().avisos || [])) {
    const tk = posOf(av.positionId)?.ticker || av.positionId;
    if (av.huerfano != null) add('alta', 'trasp-' + av.positionId + av.date, `Traspaso sin pata de compra: ${tk} (${fmtDate(av.date)})`, `Se reembolsó una posición para traspasarla a ${tk} y no hay ninguna suscripción que recoja ${fmtEUR(av.huerfano, 2)} de coste. Mientras falte, ese coste no está en ninguna posición y «invertido» sale corto.`, 'movimientos');
    else add('alta', 'sobregiro-' + av.positionId + av.date + av.tipo, `Se retiran más títulos de los que hay: ${tk} (${fmtDate(av.date)})`, `${OP_LABEL[av.tipo] || av.tipo} de ${fmtN(av.qty, 6)} títulos sobre ${fmtN(av.disponible, 6)} disponibles. El coste medio de la posición queda descuadrado y puede acabar como una pérdida realizada que no ocurrió. Revisa el orden y los duplicados de ese día.`, 'movimientos');
  }
  // 1 bis B. La composición de los fondos: sin ella, un mixto cuenta entero donde no le toca.
  // No es una alarma de doctrina, es de DATO: el reparto por cubos de toda la web depende de esto.
  {
    const S = saludComposiciones(C.rows);
    if (S.sinDato > 0)
      add(S.sinDato > S.conDato ? 'alta' : 'media', 'comp-faltan',
        `${fmtEUR(S.sinDato, 0)} en fondos sin composición medida`,
        `Estos fondos cuentan ENTEROS en su cubo declarado porque nadie ha mirado qué llevan dentro: `
        + `${S.faltan.slice(0, 8).join(', ')}${S.faltan.length > 8 ? ` y ${S.faltan.length - 8} más` : ''}. `
        + `Si alguno es mixto, su peso está en el cubo equivocado. Se arregla con «python3 jobs/composicion.py <ISIN>».`,
        'posiciones');
    // Un fondo de gestión activa cambia de composición: la de hace medio año ya no lo describe.
    if (S.dias != null && S.dias > 35)
      add(S.dias > 100 ? 'alta' : 'media', 'comp-vieja',
        `La composición de los fondos lleva ${S.dias} días sin refrescarse`,
        `La más antigua es del ${fmtDate(S.masVieja)}. El reparto por cubos se calcula con ella, así que `
        + `cuanto más vieja, menos se parece a lo que el fondo lleva hoy — y en gestión activa eso cambia `
        + `cada mes. Debería refrescarse mensualmente.`, 'posiciones');
  }
  // 1 ter. Doctrina: lo que está escrito frente a lo que se hizo. Ninguna de estas alarmas opina sobre
  // la doctrina; solo comparan el objetivo que el usuario fijó con las operaciones que hay en la base.
  {
    const T = targets(); const byB = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const r of expandirCubos(C.rows)) byB[r.bucket] = (byB[r.bucket] || 0) + r.mvEUR;
    for (const a in C.cashEUR) byB[3] += C.cashEUR[a];
    const reb = byB[1] + byB[2] + byB[3];
    // Un objetivo que nadie ha ejecutado nunca. El oro tenía el 15 % de objetivo y cero operaciones en
    // once años, mientras el comentario de recommend.js afirmaba que había órdenes automáticas vigentes.
    for (const [campo, ids, nom] of [['oro_base', ORO_IDS, 'oro'], ['btc_base', ['BTC'], 'bitcoin']]) {
      const obj = (T[campo] || 0) / 100 * reb; if (obj <= 0) continue;
      const pos = DB.positions.filter(p => ids.includes(p.ticker) || ids.includes(p.id) || ids.includes(p.isin || ''));
      const ops = DB.operations.filter(o => pos.some(p => p.id === o.position_id) && ['buy', 'switchBuy', 'deposit'].includes(o.type));
      const val = sum(C.rows.filter(r => pos.some(p => p.id === r.p.id)), r => r.mvEUR);
      if (!ops.length) add('alta', 'objetivo-sin-ejecutar-' + campo, `Objetivo de ${nom} del ${fmtN(T[campo], 0)} % sin una sola compra`, `El objetivo son ${fmtEUR(obj, 0)} y en toda la historia de la base no hay ninguna operación de compra de ${nom}. Un objetivo que nadie ejecuta no es una política: o se compra o se baja el objetivo.`, 'estrategia');
      else if (val < obj * 0.5) add('media', 'objetivo-corto-' + campo, `${nom.charAt(0).toUpperCase() + nom.slice(1)} a menos de la mitad de su objetivo`, `${fmtEUR(val, 0)} frente a ${fmtEUR(obj, 0)}. Última compra: ${fmtDate(ops.map(o => o.date).sort().pop())}.`, 'estrategia');
    }
    // El dinero nuevo yendo al cubo que la doctrina declara cerrado mientras otro está por debajo.
    const desde = addDays(today, -365);
    const nuevo = b => sum(DB.operations.filter(o => o.type === 'buy' && o.date >= desde
      && defaultBucket(posOf(o.position_id)) === b), o => (+o.total_eur || +o.total || 0));
    const bajo = [1, 2, 3].map(b => ({ b, pp: byB[b] / reb * 100 - (T.cubos_rebalanceable?.[b] ?? 0) }))
      .sort((x, y) => x.pp - y.pp)[0];
    const n4 = nuevo(4), nBajo = nuevo(bajo.b);
    if (bajo.pp < -2 && n4 > nBajo) add('media', 'doctrina-cubo4', `El dinero nuevo va al cubo 4 mientras el cubo ${bajo.b} está corto`, `En los últimos doce meses el cubo 4 (ilíquidos, que la doctrina declara cerrado a aportaciones nuevas) recibió ${fmtEUR(n4, 0)} y el cubo ${bajo.b} ${fmtEUR(nBajo, 0)}, estando ${fmtN(-bajo.pp, 1)} pp por debajo de su objetivo. O la doctrina deja de llamar cerrado al cubo 4, o el dinero cambia de destino.`, 'estrategia');
    // La válvula de rebalanceo que la doctrina da por hecha. La regla dice que el exceso del cubo 1
    // «solo se corrige vendiendo índice global», y el 17 sep 2026 el cajón `indice` eran cuatro fondos
    // de gestión activa de Santander, uno de ellos un mixto: no hay ni un ETF indexado mundial en toda
    // la cartera, así que la regla no tiene qué vender y el cubo 1 solo puede converger dejando de
    // aportar. Es la pieza que falta para que la doctrina se pueda ejecutar.
    if (byB[1] / reb * 100 - (T.cubos_rebalanceable?.[1] ?? 50) > (T.banda_pp ?? 5)) {
      const idx = C.rows.filter(r => r.bucket === 1 && r.p.drawer === 'indice');
      const etf = idx.filter(r => r.p.type === 'etf');
      if (!etf.length) add('media', 'valvula-vacia', 'El cubo 1 está por encima de banda y la válvula no existe', `Tu regla dice que el exceso de renta variable solo se corrige vendiendo índice global, y en el cajón «índice» no hay ningún ETF indexado: ${idx.length ? `son ${idx.length} fondos de gestión activa (${fmtEUR(sum(idx, r => r.mvEUR), 0)})` : 'está vacío'}. Sin válvula, el cubo 1 solo puede converger dejando de aportarle, que es mucho más lento.`, 'estrategia');
    }
    // Una doctrina reescrita muchas veces en pocos días no puede reprocharle nada a la cartera.
    const h = DB.settings?.benchmark?.history || [];
    if (h.length >= 5) {
      const fechas = h.map(x => String(x.date || x.ts || '').slice(0, 10)).filter(Boolean).sort();
      const dias = fechas.length >= 2 ? daysBetween(fechas[0], fechas[fechas.length - 1]) : null;
      if (dias != null && dias <= 30) add('info', 'doctrina-inestable', `Los pesos objetivo se han reescrito ${h.length} veces en ${dias} días`, 'Una política que cambia tantas veces en tan poco tiempo no puede servir de vara para medir la cartera: la desviación que enseña la web mide sobre todo el último cambio de opinión. Fija los pesos y deja pasar un trimestre antes de volver a tocarlos.', 'estrategia');
    }
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
    // Solo tiene sentido en un cobro. En una reversión el bruto es negativo y la retención se devuelve,
    // así que el neto queda por encima del bruto y eso es lo normal, no un error: las cuatro reversiones
    // de Realty Income del 27 mar 2026 (bruto −9,40 € / neto −6,49 €, y tres más) hacían saltar esta
    // alarma de forma permanente. Una campana que avisa siempre enseña a no mirarla.
    const A = divAmounts(d); if (A.grossEUR > 0 && A.netEUR > A.grossEUR + 0.01) add('media', 'divnet-' + d.id, `Dividendo con neto mayor que bruto: ${posOf(d.position_id)?.ticker || ''} ${fmtDate(d.date)}`, 'Revisa retenciones y comisión.', 'movimientos');
    // Una reversión lleva el bruto en negativo y DEVUELVE la retención, así que esta va en el mismo
    // sentido. Las cuatro reversiones de Realty Income del 27 mar 2026 tenían el bruto negativo y la
    // retención en origen positiva y no saltó nada, porque en una reversión el neto negativo es lo
    // normal: se contaron como retenidos 24,50 € que se habían devuelto. La misma comprobación, en
    // Python, es retencion_coherente() de jobs/cordura.py.
    const bruto = +d.gross || 0;
    if (Math.abs(bruto) > 0.005) {
      for (const [v, campo] of [[+d.withhold_origin || 0, 'en origen'], [+d.withhold_dest_eur || 0, 'en destino']]) {
        if (Math.abs(v) > 0.005 && (v < 0) !== (bruto < 0)) add('alta', 'divsig-' + d.id + campo, `Retención ${campo} con el signo cambiado: ${posOf(d.position_id)?.ticker || ''} ${fmtDate(d.date)}`, `El bruto es ${fmtN(bruto, 2)} y la retención ${campo} es ${fmtN(v, 2)}. Una reversión devuelve la retención, así que va en el mismo sentido que el bruto; con signos opuestos se cuenta dos veces y el neto cobrado sale corto.`, 'movimientos');
      }
    }
  }
  // 5. Precios: posiciones automáticas sin precio reciente y manuales muy antiguas
  for (const r of C.rows) {
    if (r.p.price_mode === 'manual') { if (r.priceDate && daysBetween(r.priceDate, today) > 365) add('info', 'old-' + r.p.id, `${r.p.ticker}: precio manual de hace más de un año (${fmtDate(r.priceDate)})`, 'Actualiza la tasación en Posiciones si ha cambiado.', 'posiciones'); continue; }
    if (!r.priceDate) add('media', 'noprice-' + r.p.id, `${r.p.ticker} sin ningún precio: se valora al coste`, 'Resuelve el símbolo (Posiciones) o introduce un precio manual.', 'posiciones');
    else if (daysBetween(r.priceDate, today) > 40) add('media', 'stale-' + r.p.id, `${r.p.ticker}: último precio de hace ${daysBetween(r.priceDate, today)} días (${fmtDate(r.priceDate)})`, 'La fuente automática no ha devuelto precio. Comprueba el símbolo o introduce el precio a mano.', 'posiciones');
  }
  // 5 bis. La divisa de la ficha tiene que ser la de la SERIE DE PRECIOS, no la de las compras.
  // El motor hace valor = títulos × precio × cambio(ficha), así que una ficha en euros con la serie en
  // dólares cuenta un dólar como un euro. El 17 sep 2026 había trece así: MSFT llegó a contar 2.724 €
  // de más y GUBRA multiplicaba por 7,46. La misma tabla, en Python, está en jobs/cordura.py.
  const DIVISA_PLAZA = { MC: 'EUR', F: 'EUR', DE: 'EUR', AS: 'EUR', PA: 'EUR', MI: 'EUR', BR: 'EUR', LS: 'EUR', VI: 'EUR', HE: 'EUR', IR: 'EUR', CO: 'DKK', ST: 'SEK', OL: 'NOK', IL: 'USD', HK: 'HKD', TO: 'CAD' };
  for (const pos of DB.positions || []) {
    if (pos.price_mode === 'manual') continue;
    const sym = (pos.yahoo_symbol || '').trim(); if (!sym) continue;
    // En Londres y en Suiza la misma clase de un ETF cotiza en varias divisas (XRSU:LSE:USD y
    // XRSG:LSE:GBX son el mismo fondo), así que el sufijo no decide y no se avisa.
    const suf = sym.includes('.') ? sym.slice(sym.lastIndexOf('.') + 1).toUpperCase() : '';
    const esperada = sym.endsWith('-EUR') ? 'EUR' : suf ? DIVISA_PLAZA[suf] : 'USD';
    if (esperada && (pos.currency || 'EUR').toUpperCase() !== esperada) add('alta', 'ccy-' + pos.id, `${pos.ticker}: la ficha dice ${pos.currency || 'EUR'} y ${sym} cotiza en ${esperada}`, `El valor se calcula como títulos × precio × cambio de la divisa de la ficha: con la divisa mal, un ${esperada === 'EUR' ? 'euro' : esperada} se cuenta como un euro. Cámbiala en Posiciones; los precios no se tocan.`, 'posiciones');
  }
  // 5 ter. Los cuatro paquetes de arranque son vistas materializadas: fotos que rehace el ciclo diario.
  // Materializarlas quitó el fallo de «canceling statement due to statement timeout» (prices_compact
  // tardaba 6.654 ms con todo en memoria y el corte son 8 s), pero mete un riesgo nuevo: si el
  // refresco falla, la web enseña datos viejos CON CARA DE ESTAR AL DÍA. Cinco días cubren un puente
  // largo sin dar falsas alarmas: el ciclo corre de lunes a viernes.
  if (DB.mode === 'cloud' && DB.compactRefresh) {
    const n = daysBetween(String(DB.compactRefresh).slice(0, 10), today);
    if (n > 5) add('alta', 'paquete', `Los datos que ves son una foto de hace ${n} días (${fmtDate(String(DB.compactRefresh).slice(0, 10))})`, 'Los paquetes de arranque son vistas materializadas que rehace el ciclo diario, y lleva días sin rehacerse: los precios, cambios e índices que ves pueden no ser los últimos aunque estén en la base. Comprueba el trabajo de GitHub Actions, o ejecuta «select refresh_prices_compact();» en Supabase.', 'inicio');
  }
  // 5 bis. El efecto disposición, medido en esta cartera y convertido en alarma.
  // Réplica FIFO de las 2.758 operaciones (17 sep 2026): en Trade Republic las ganadoras se cerraron a
  // los 88,9 días ponderados por coste y las perdedoras siguen abiertas 310,4 —3,5 veces más—, y en
  // 2026 la asimetría sigue (233,4 frente a 151,4). La otra mitad del efecto son las que no se cierran:
  // ADA −4.607 € (−76,4 %) tras 526 días, LINK −3.169 € tras 302, NEXO −1.455 € tras 426, ninguna con
  // tesis ni condición de salida escrita. Aguantar una perdedora es una decisión legítima; aguantarla
  // sin haberla escrito no lo es, y es justo lo que el historial dice que pasa.
  {
    const tes = (DB.settings && DB.settings.tesis) || {};
    const primera = {};
    for (const o of DB.operations) {
      if (!o.position_id || !['buy', 'switchBuy', 'deposit', 'spinOffBuy'].includes(o.type)) continue;
      const k = o.account_id + '|' + o.position_id;
      if (!primera[k] || o.date < primera[k]) primera[k] = o.date;
    }
    for (const r of C.rows) {
      if (r.mvEUR < 500 || r.p.price_mode === 'manual' || !r.costEUR) continue;
      const d0 = primera[r.accountId + '|' + r.p.id]; if (!d0) continue;
      const dias = daysBetween(d0, today);
      if (dias < 180 || r.gainPct > -20) continue;
      if (tes[r.p.id] && tes[r.p.id].salida) continue;    // tiene escrito cuándo cerrarla: es una decisión, no un olvido
      add('media', 'disposicion-' + r.accountId + r.p.id, `${r.p.ticker} lleva ${dias} días a ${fmtN(r.gainPct, 1)} % sin condición de salida escrita`,
        `Pérdida latente de ${fmtEUR(r.gain, 0)} sobre ${fmtEUR(r.costEUR, 0)} invertidos, comprada por primera vez el ${fmtDate(d0)}. Tu propio historial dice que aguantas las perdedoras 3,5 veces más que las ganadoras (310,4 días frente a 88,9 en Trade Republic). Mantenerla puede estar bien; lo que no puede es no estar escrito. Escribe el suceso que te haría venderla, o véndela.`, 'tamanos');
    }
    // Stop escrito en lo especulativo, que es lo que exige la §3 de la doctrina. El 17 sep 2026 no
    // había ni una posición con la palabra «stop» en sus notas: 0 de 208.
    for (const r of C.rows) {
      if (r.p.drawer !== 'especulativa' || r.mvEUR < 500) continue;
      if (/stop/i.test(r.p.notes || '')) continue;
      add('media', 'sinstop-' + r.accountId + r.p.id, `${r.p.ticker} es especulativa y no tiene stop escrito`,
        `${fmtEUR(r.mvEUR, 0)} en el cajón especulativa. La §3 de tu doctrina pide stop para estas posiciones y no hay ninguno escrito en la ficha. Escríbelo en las notas de la posición.`, 'posiciones');
    }
  }
  // 6. Tesis del taller: revisión mensual, condición de salida escrita y horizonte vencido.
  // No es burocracia: el propio historial del usuario dice que las ganadoras se cerraron a los 92 días
  // de mediana y las perdedoras siguen abiertas 214. Una tesis sin suceso de salida escrito acaba
  // vendiéndose por cómo se siente el precio. Revisar es comprobar si ese suceso ha ocurrido.
  const tesis = (DB.settings && DB.settings.tesis) || {};
  const nombre = id => posOf(id)?.ticker || id;
  const vivas = C.rows.filter(r => tesis[r.p.id]).map(r => r.p.id);
  for (const id of Object.keys(tesis)) {
    const t = tesis[id] || {};
    if (!vivas.includes(id) && !DB.positions.some(p => p.id === id)) continue;
    // Una tesis que, con los números que tú mismo escribiste, espera menos que el tipo sin riesgo.
    // El taller ya le da peso cero, pero eso solo se ve abriendo el taller.
    // OJO CON LA UNIDAD. `alza`, `p` y `base` son de PRECIO —las tasas base salen de series de precio
    // sin dividendos— así que muAnual es apreciación, no retorno total. El tipo sin riesgo SÍ es
    // retorno total, y por tanto esta comparación INFRAVALORA la tesis: es un suelo, no una medida.
    //
    // Durante unas horas del 18 sep 2026 se tapó el hueco sumando `rendimiento_flujo_pct`, el flujo
    // de caja libre del año 1 sobre el precio. Estaba mal y lo dijo el usuario: el flujo libre no es
    // un retorno para el accionista salvo que se reparta, y si se retiene es justo lo que produce el
    // crecimiento que ya está dentro de `g`. Sumarlo lo contaba dos veces —en ADSK metía 6,78 puntos
    // en una empresa que no paga dividendo—. El arreglo de verdad es calcular las tasas base sobre
    // serie de RETORNO TOTAL; hasta entonces se compara de precio contra total y se avisa de ello.
    if (vivas.includes(id)) {
      const e = tesisAEscenarios(t); const rSin = (DB.settings?.taller?.r ?? 2.5) / 100;
      if (e.muAnual != null && e.muAnual < rSin) {
        const val = sum(C.rows.filter(r => r.p.id === id), r => r.mvEUR);
        add('media', 'tesispobre-' + id, `${nombre(id)}: la tesis espera menos que el tipo sin riesgo`, `Con tus propios números la esperanza anual de PRECIO es ${fmtN(e.muAnual * 100, 2)} % frente a un tipo sin riesgo del ${fmtN(rSin * 100, 1)} %, que es retorno TOTAL. La comparación va a favor de la posición —le falta el dividendo— así que es un suelo: si aun así no llega, el problema es real. La posición vale ${fmtEUR(val, 0)}. O la tesis está desactualizada o la posición sobra.`, 'taller');
      }
    }
    if (!t.salida) add('info', 'tesis-salida-' + id, `${nombre(id)}: la tesis no dice cuándo cerrar`,
      'Falta el suceso que te haría vender (no un precio). Sin él, la venta depende de cómo te sientas con la cotización. Escríbelo en Dimensionado › botón «tesis».', 'tamanos');
    const rev = t.revisada || t.actualizada;
    const d = rev ? daysBetween(rev, today) : null;
    if (d != null && d > 30) add(d > 90 ? 'media' : 'info', 'tesis-rev-' + id,
      `${nombre(id)}: la tesis lleva ${d} días sin revisar`,
      `Última revisión el ${fmtDate(rev)}. Revisar no es mirar el precio: es comprobar si el suceso de salida ha ocurrido y si las probabilidades siguen en pie.`, 'tamanos');
    if (rev && t.anos > 0) {
      const vence = addDays(rev, Math.round(t.anos * 365));
      if (vence < today) add('media', 'tesis-vence-' + id, `${nombre(id)}: el horizonte de la tesis venció el ${fmtDate(vence)}`,
        `Escribiste ${fmtN(t.anos, 1)} años desde el ${fmtDate(rev)}. O se cumplió, o no se cumplió: en ambos casos toca decidir, no dejarla correr.`, 'tamanos');
    }
  }

  // 7. Cambios del BCE al día
  const usd = DB.fx.USD; if (usd) { const k = Object.keys(usd).sort(); const last = k[k.length - 1]; if (daysBetween(last, today) > 7) add('media', 'fxold', `Cambio USD del BCE de hace ${daysBetween(last, today)} días (${fmtDate(last)})`, 'El trabajo diario de cambios no ha corrido. Revisa GitHub Actions.', 'ajustes'); }
  const order = { alta: 0, media: 1, info: 2 };
  out.sort((a, b) => order[a.level] - order[b.level]);
  return out;
}

const DISMISS_KEY = 'sp.alarmas.vistas';
export function dismissedKeys() { try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')); } catch { return new Set(); } }
export function dismiss(keys) { try { const s = dismissedKeys(); keys.forEach(k => s.add(k)); localStorage.setItem(DISMISS_KEY, JSON.stringify([...s])); } catch { /* sin almacenamiento */ } }
export function undismissAll() { try { localStorage.removeItem(DISMISS_KEY); } catch { /* sin almacenamiento */ } }
