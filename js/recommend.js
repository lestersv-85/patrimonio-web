// Recomendaciones de rebalanceo según la doctrina de los cubos, la fase estimada y la selección.
// Nunca son órdenes: cada una lleva importe, regla de origen y aviso.
import { DB } from './store.js?v=3bf8a9f';
import { compute, SEL, selIsAll, inSelPos, inSelCash, defaultBucket, benchReturn, latestAtOrBefore, posOf, expandirCubos } from './engine.js?v=3bf8a9f';
import { BUCKETS, DRAWERS, fmtK, fmtN, fmtPct, sum, todayISO, esc } from './util.js?v=3bf8a9f';
import { currentPhase } from './clock.js?v=3bf8a9f';

// Doctrina fijada por el usuario el 15 sep 2026: caja 10, bonos 10, bitcoin 15, oro 15 y el resto
// renta variable. De ahí salen los tres cubos rebalanceables: RV 50, oro+cripto 30, RF+caja 20.
// Los cinco puntos que salen del bitcoin van al oro: sobre las series propias (141 cierres
// mensuales 2015-2026) 50/15/15/10/10 da el mismo retorno a cinco años que 50/20/10/10/10
// (12,19 % frente a 12,25 %) con 2,3 pp menos de volatilidad y 4,1 pp menos de caída máxima.
export const DEFAULT_TARGETS = {
  cubos_rebalanceable: { 1: 50, 2: 30, 3: 20 },
  rv_suelo: 45, rv_techo: 55,
  oro_base: 15, btc_base: 15, caja_base: 10, bonos_base: 10,
  cajones_cubo1: { nucleo: 50, tesis: 21, indice: 21, especulativa: 8 },
  tesis_max: 6, especulativas_max: 2, nombres_por_sector_max: 2,
  nucleo_sectores: { 'Software': 13, 'Cloud': 13, 'Lujo': 13, 'Datos y derechos': 13, 'Pagos': 12, 'Inmobiliario de renta': 12, 'Salud': 12, 'Servicios esenciales': 12 },
  escalon_supervision: 1.5, escalon_recorte: 2.0,
  banda_pp: 5, btc_fin_ciclo: 80, caida_indice_doblar: -10, caida_indice_triplicar: -20, bund30_tope: 4.1,
  // Plan de aportación DECLARADO, no ejecutado: 450 Fidelity World + 50 Fidelity emergentes + 500 de
  // oro cada quince días (1.000 al mes) + la minería, ~50 USD a la semana en bitcoin (187,58 € al mes
  // al cambio del 14 sep 2026). Total 1.688 € al mes, de los que 1.188 van al cubo 2.
  //
  // Esta línea decía «Órdenes automáticas vigentes» y no lo son. El 17 sep 2026, con el objetivo de
  // oro en el 15 %, Xetra-Gold (DE000A0S9GB0) tenía CERO operaciones en toda la historia de la base
  // —once años— y Fidelity World tampoco había recibido nada. La campana compara ahora el plan con lo
  // que de verdad entró (ver checks.js, «Doctrina»): un objetivo que nadie ejecuta no es una política.
  aportacion_mensual: 1688, dividendos_a_cubo3_hasta: 11,
};
export function targets() { return { ...DEFAULT_TARGETS, ...(DB.settings?.targets || {}) }; }

// Vehículos que cuentan como oro. Estaba dentro de una regla y ahora lo usa también la campana
// (checks.js) para comprobar que el objetivo de oro tiene detrás alguna compra de verdad.
export const ORO_IDS = ['IE00B4ND3602', 'IGLN', 'DE000A0S9GB0', '4GLD.DE'];

// Las stablecoins son caja en dólares, no cripto de riesgo: cuentan como pólvora del cubo 3 (§6).
// Vive aquí y no dentro de cada regla porque antes cada bloque tenía su propia lista y, al pasarlas
// de cubo, el cubo 3 las habría contado como deuda pública, que es justo lo que no son.
export const esEstable = p => ['USDT', 'USDC', 'USDX'].includes(p?.ticker);

export function recommendations(C) {
  const T = targets(); const ph = currentPhase(); const out = [];
  C = C || compute();
  const rows = C.rows.filter(r => inSelPos(r.p, r.accountId));
  let cash = 0; for (const a in C.cashEUR) if (inSelCash(a)) cash += C.cashEUR[a];
  // Los pesos por cubo miran dentro de los fondos (ver `expandirCubos`): lo que recomienda mover
  // tiene que partir del reparto real, no del cubo declarado de un mixto.
  const byB = { 1: 0, 2: 0, 3: cash, 4: 0 }; expandirCubos(rows).forEach(r => byB[r.bucket] += r.mvEUR);
  const total = byB[1] + byB[2] + byB[3] + byB[4]; const reb = byB[1] + byB[2] + byB[3];
  const add = (score, title, body, rule, amount, types) => out.push({ score, title, body, rule, amount, types });
  const singleBucket = SEL.buckets.length === 1 ? SEL.buckets[0] : null;
  // Con un solo tipo de activo filtrado, las recomendaciones son las de ese tipo (y las generales que le afectan)
  const singleType = SEL.types.length === 1 ? SEL.types[0] : null;
  const spxDD = (() => { const m = DB.bench['^GSPC']; if (!m) return null; const keys = Object.keys(m).sort(); const last = m[keys[keys.length - 1]]; let mx = 0; for (const k of keys) if (k >= '2024-01-01' && m[k] > mx) mx = m[k]; return mx ? (last / mx - 1) * 100 : null; })();

  if (!singleBucket && reb > 0) {
    // 1. Cubos frente a objetivo sobre lo rebalanceable
    const devs = [1, 2, 3].map(b => { const w = byB[b] / reb * 100, t = T.cubos_rebalanceable[b]; return { b, w, t, pp: w - t, eur: (t - w) / 100 * reb }; }).sort((a, b) => a.pp - b.pp);
    const low = devs[0], high = devs[devs.length - 1];
    const idxVal = sum(rows.filter(r => r.bucket === 1 && r.p.drawer === 'indice'), r => r.mvEUR);
    if (low.pp < 0) {
      const bigGap = -low.pp > T.banda_pp;
      add(100 + -low.pp * 4 + (BUCKETS[low.b].wins === ph.phase ? 15 : 0),
        `Dirige la próxima aportación y las rentas al cubo ${low.b} (${BUCKETS[low.b].name})`,
        `Está en ${fmtN(low.w, 1)} % de lo rebalanceable frente al ${fmtN(low.t, 1)} % objetivo: faltan ${fmtK(low.eur)}. ${bigGap ? (idxVal > 0 ? `Desviación mayor de ${T.banda_pp} pp: además de la aportación, vender índice global (válvula, ${fmtK(idxVal)} disponibles) hasta cerrar el hueco.` : `Desviación mayor de ${T.banda_pp} pp, pero no hay índice global (válvula) que vender: solo aportaciones y rentas hasta cerrar el hueco.`) : `Desviación menor de ${T.banda_pp} pp: converge con aportaciones en unos 12 meses, sin vender nada.`}${BUCKETS[low.b].wins === ph.phase ? ' Es además el cubo que gana en la fase actual.' : ''}`,
        'Rebalancear sumando, §7 · jerarquía 1 y 2', low.eur);
    }
    if (high.pp > T.banda_pp) {
      add(80 + high.pp * 2, `Cubo ${high.b} (${BUCKETS[high.b].name}) por encima de banda`, `Pesa ${fmtN(high.w, 1)} % frente a ${fmtN(high.t, 1)} %: ${fmtK(-high.eur)} de exceso. ${high.b === 1 ? (idxVal > 0 ? `Solo se corrige vendiendo índice global (${fmtK(idxVal)} disponibles), nunca núcleo ni tesis.` : 'No hay índice global que vender (la válvula está vacía): se corrige dejando de aportar al cubo 1 hasta que converja.') : high.b === 2 ? 'El exceso sobre objetivo compra oro sin dinero nuevo (rotación interna).' : 'Despliega el exceso hacia el cubo más infraponderado en la próxima revisión.'}`, 'Válvula índice · §7', -high.eur);
    }
    const rvW = byB[1] / reb * 100;
    if (rvW < T.rv_suelo) add(95, 'Renta variable por debajo del suelo', `El cubo 1 pesa ${fmtN(rvW, 1)} % de lo rebalanceable; el suelo de la política es ${T.rv_suelo} %. Aportaciones al índice hasta recuperar la banda.`, 'Política de inversión §1', (T.rv_suelo - rvW) / 100 * reb);
  }
  // 2. Gatillos de mercado
  if (spxDD != null && spxDD <= T.caida_indice_triplicar) add(120, 'El índice ha caído más del 20 % desde máximos', `S&P 500 ${fmtPct(spxDD, 1)} desde el máximo. Triplicar la aportación al índice y desplegar un tramo grande desde los cubos 2 y 3.`, 'Gatillo −20 %, §7', null);
  else if (spxDD != null && spxDD <= T.caida_indice_doblar) add(90, 'El índice ha caído más del 10 % desde máximos', `S&P 500 ${fmtPct(spxDD, 1)} desde el máximo: doblar la aportación mensual al índice (de ${fmtK(T.aportacion_mensual / 3)} a ${fmtK(T.aportacion_mensual / 3 * 2)}).`, 'Gatillo −10 %, §7', null);
  // 3. Cubo 1 interno
  if (!singleBucket || singleBucket === 1) {
    const b1 = rows.filter(r => r.bucket === 1); const v1 = sum(b1, r => r.mvEUR);
    if (v1 > 0) {
      const byD = {}; b1.forEach(r => { const d = r.p.drawer || 'sin'; byD[d] = (byD[d] || 0) + r.mvEUR; });
      const idxW = (byD.indice || 0) / v1 * 100;
      if (idxW < T.cajones_cubo1.indice / 2) add(85 + (singleBucket ? 20 : 0), 'La válvula del cubo 1 está casi vacía', `El cajón índice pesa ${fmtN(idxW, 1)} % del cubo 1 frente al ${T.cajones_cubo1.indice} % objetivo (faltan ${fmtK((T.cajones_cubo1.indice - idxW) / 100 * v1)}). Sin índice no hay con qué rebalancear: lo que entre en el cubo 1 (cuando le toque por prioridad) va al índice global, no a nombres nuevos.`, 'Cajones 50/21/21/8, §4 · válvula, §7', (T.cajones_cubo1.indice - idxW) / 100 * v1);
      const nTesis = b1.filter(r => r.p.drawer === 'tesis').length, nEsp = b1.filter(r => r.p.drawer === 'especulativa').length;
      if (nTesis > T.tesis_max) add(70, 'Demasiadas tesis', `Hay ${nTesis} posiciones en el cajón tesis y el tope es ${T.tesis_max}. Una tesis cumplida o falsada se vende; no asciende al núcleo por inercia.`, 'Cajón tesis, §4', null);
      if (nEsp > T.especulativas_max) add(70, 'Demasiadas especulativas', `Hay ${nEsp} posiciones §3 y el tope es ${T.especulativas_max}. Cada una necesita stop y objetivo escritos antes de entrar.`, '§3', null);
      const noStop = b1.filter(r => r.p.drawer === 'especulativa' && !(r.p.notes || '').toLowerCase().includes('stop'));
      if (noStop.length) add(60, 'Especulativas sin stop escrito', `${noStop.map(r => r.p.ticker).join(', ')}: no consta stop en las notas de la posición. Escribirlo (cifra) o pasar la posición al cajón que le corresponda.`, 'Modo de fallo: reglas sin número', null);
      // Sectores del núcleo frente a su peso de diseño
      const nuc = b1.filter(r => r.p.drawer === 'nucleo'); const vN = sum(nuc, r => r.mvEUR); const targetN = v1 * T.cajones_cubo1.nucleo / 100;
      if (vN > 0) {
        const byS = {}; nuc.forEach(r => { const s = r.p.nucleo_sector || 'Sin sector'; byS[s] = (byS[s] || { v: 0, n: 0 }); byS[s].v += r.mvEUR; byS[s].n++; });
        for (const s in byS) {
          const design = (T.nucleo_sectores[s] || 0) / 100 * targetN; if (!design) continue;
          const ratio = byS[s].v / design;
          if (ratio >= T.escalon_recorte) add(88, `${s} en ${fmtN(ratio, 2)}× su peso de diseño`, `Vale ${fmtK(byS[s].v)} frente a ${fmtK(design)} de diseño. Escalón 2×: obliga a decidir en la revisión (subir el peso por escrito o recortar), no a seguir «temporal».`, 'Escalones 1,5× y 2×, §7', design - byS[s].v);
          else if (ratio >= T.escalon_supervision) add(55, `${s} en banda de supervisión (${fmtN(ratio, 2)}×)`, `Vale ${fmtK(byS[s].v)} frente a ${fmtK(design)} de diseño. Se anota; no se actúa salvo que supere 2×.`, 'Escalón 1,5×, §7', null);
          if (byS[s].n > T.nombres_por_sector_max) add(65, `${s}: más de ${T.nombres_por_sector_max} nombres`, `Hay ${byS[s].n} posiciones en el sector. Un tercer nombre exige que salga uno; añadir nunca añade peso, lo parte.`, 'Núcleo por sectores, §4', null);
        }
        const missing = Object.keys(T.nucleo_sectores).filter(s => !byS[s]);
        if (missing.length) add(50, 'Sectores del núcleo sin cubrir', `${missing.join(', ')}: ${missing.length} de ${Object.keys(T.nucleo_sectores).length} sectores de diseño están vacíos. Las oportunidades entran por tesis o §3, no directamente al núcleo.`, 'Núcleo por sectores, §4', null);
      }
    }
  }
  // 3 bis. Destino del dinero que entra sin ser aportación: ventas de acciones e ingresos
  // excepcionales. Regla del usuario del 17 sep 2026: van al MENOS PONDERADO de oro, bonos e índice.
  // Se calcula aquí y no se deja escrito en la doctrina porque una regla que no se ejecuta es
  // exactamente el problema que tenía el oro, con objetivo del 15 % y cero compras en once años.
  if (!singleBucket && reb > 0) {
    const base = reb;
    // Renta fija de VERDAD: ni las stablecoins (que son caja en dólares y ya cuentan como pólvora
    // del cubo 3) ni los mixtos. Se reconoce por el nombre del fondo, que es lo único que hay.
    const esBono = p => /renta fija|bono|bond|deuda|soberan|treasur|aggregate/i.test((p.name || '') + ' ' + (p.sector || ''));
    const oro = sum(rows.filter(r => /oro|gold/i.test(r.p.sector || '') || ORO_IDS.includes(r.p.ticker) || ORO_IDS.includes(r.p.isin || '')), r => r.mvEUR);
    const bonos = sum(rows.filter(r => esBono(r.p) && !esEstable(r.p)), r => r.mvEUR);
    const indice = sum(rows.filter(r => r.bucket === 1 && r.p.drawer === 'indice'), r => r.mvEUR);
    const indiceReal = sum(rows.filter(r => r.bucket === 1 && r.p.drawer === 'indice' && r.p.type === 'etf'), r => r.mvEUR);
    const D = [
      { k: 'oro', nm: 'oro', v: oro, t: T.oro_base / 100 * base },
      { k: 'bonos', nm: 'bonos', v: bonos, t: T.bonos_base / 100 * base },
      { k: 'indice', nm: 'índice global', v: indice, t: T.cajones_cubo1.indice / 100 * byB[1] },
    ].map(d => ({ ...d, falta: d.t - d.v })).sort((a, b) => b.falta - a.falta);
    const peor = D[0];
    if (peor.falta > 0) {
      const detalle = D.map(d => `${d.nm} ${fmtK(d.v)} de ${fmtK(d.t)}${d.falta > 0 ? ` (faltan ${fmtK(d.falta)})` : ' (cubierto)'}`).join(' · ');
      add(95 + Math.min(20, peor.falta / base * 100),
        `La próxima venta de acciones o ingreso excepcional va a ${peor.nm}`,
        `${detalle}. Tu regla del 17 sep 2026 manda el dinero que no es aportación al menos ponderado de los tres, y ahora mismo es ${peor.nm}.` +
        (peor.k === 'indice' && indiceReal < 1 ? ' Ojo: el cajón «índice» son fondos de gestión activa y no hay ningún ETF indexado, así que como válvula de rebalanceo sigue a cero.' : ''),
        'Destino de ventas e ingresos excepcionales · regla del usuario', peor.falta);
    }
  }
  // 3 ter. La válvula que la doctrina da por hecha y no existe: el cajón «índice» son fondos activos.
  // Mientras no haya un ETF indexado que vender, las candidatas a recorte por VALORACIÓN son la única
  // fuente ordenada de dinero para rebalancear. No es una orden de venta: es de dónde saldría el dinero
  // si hace falta, ordenado por cuánto se aparta el precio del valor y no por cómo se siente la cotización.
  if (!singleBucket && reb > 0) {
    const tes = DB.settings?.tesis || {};
    const cand = rows.filter(r => /^CANDIDATA/.test(tes[r.p.id]?.valoracion?.veredicto || ''))
      .map(r => ({ tk: r.p.ticker, v: r.mvEUR, m: +tes[r.p.id].valoracion.margen_base_pct,
                   mu: tes[r.p.id].mu_anual_pct == null ? null : +tes[r.p.id].mu_anual_pct }))
      .sort((a, b) => a.m - b.m);
    // El margen es una foto: distancia del precio al valor DE HOY. La tesis calibrada el 18 sep 2026
    // mira a cinco años, y las dos no coinciden: una empresa que cotiza un 32 % por encima de su valor
    // pero compone al 12 % puede seguir teniendo un recorrido positivo, y otra con margen pequeño puede
    // no tenerlo. Se enseñan las dos cifras para que la diferencia esté a la vista y no se recorte por
    // la foto cuando la película dice otra cosa.
    // μ es apreciación de PRECIO y el tipo sin riesgo es retorno total, así que esta lista va a favor
    // de las posiciones: le falta el dividendo de cada una. Es un suelo. Sumarle el flujo de caja
    // libre, como se probó unas horas el 18 sep 2026, NO lo arregla: el flujo libre no es un retorno
    // salvo que se reparta, y si se retiene ya está dentro de `g`. El arreglo es la serie de retorno
    // total para las tasas base.
    const rSin = DB.settings?.taller?.r ?? 2.5;
    const totalDe = (t) => (t?.mu_anual_pct == null ? null : +t.mu_anual_pct);
    const sinCaso = rows.filter(r => totalDe(tes[r.p.id]) != null && totalDe(tes[r.p.id]) < rSin)
      .map(r => ({ tk: r.p.ticker, v: r.mvEUR, mu: totalDe(tes[r.p.id]) }))
      .sort((a, b) => a.mu - b.mu);
    const bolsa = sum(cand, c => c.v);
    const low = [1, 2, 3].map(b => ({ b, falta: (T.cubos_rebalanceable[b] ?? 0) / 100 * reb - byB[b] })).sort((a, b) => b.falta - a.falta)[0];
    if (cand.length && low.falta > 0) {
      add(88, `${cand.length} posiciones cotizan por encima de su valor: ${fmtK(bolsa)} disponibles para rebalancear`,
        `${cand.map(c => `${c.tk} ${fmtN(c.m, 0)} %${c.mu == null ? '' : ` (μ ${fmtN(c.mu, 1)} %)`}`).join(' · ')}. El cubo ${low.b} necesita ${fmtK(low.falta)} y no hay índice global que vender, así que esta lista es la válvula. ` +
        (sinCaso.length ? `Ojo con el orden: el margen es la foto de hoy y μ es la tesis a cinco años. Por μ por debajo del ${fmtN(rSin, 2)} % sin riesgo —que es un suelo, porque μ es de precio y no lleva dividendo— la lista sería otra, ${fmtK(sum(sinCaso, c => c.v))} en ${sinCaso.map(c => `${c.tk} ${fmtN(c.mu, 1)} %`).join(' · ')}. ` : '') +
        `Recortar aquí no es vender por el modelo: es elegir de dónde sale el dinero que el rebalanceo necesita de todos modos, empezando por donde el precio más se aparta del valor. ` +
        `Tu selección de valores bate al índice en 30.731 €, así que una valoración mía no basta por sí sola para vender: hacen falta dos de tres (margen por debajo de −15 %, condición de salida disparada, o necesidad de dinero).`,
        'Bandas por margen de seguridad · válvula de rebalanceo', Math.min(bolsa, low.falta));
    }
  }
  // 4. Cubo 2 interno
  if (!singleBucket || singleBucket === 2) {
    const b2 = rows.filter(r => r.bucket === 2); const v2 = sum(b2, r => r.mvEUR);
    if (v2 > 0) {
      const btc = sum(b2.filter(r => r.p.ticker === 'BTC'), r => r.mvEUR);
      // Se buscan en toda la cartera: viven en el cubo 3 pero siguen siendo el depósito
      // desde el que las altcoins pasan a bitcoin, así que el glide interno las necesita.
      const stables = sum(rows.filter(r => esEstable(r.p)), r => r.mvEUR);
      // DE000A0S9GB0 es Xetra-Gold, el vehículo elegido: va en la lista para que cuente como oro
      // aunque la posición se dé de alta sin sector, que es como se pierde el ancla sin avisar.
      const gold = sum(b2.filter(r => /oro|gold/i.test(r.p.sector || '') || ORO_IDS.includes(r.p.ticker) || ORO_IDS.includes(r.p.isin || '')), r => r.mvEUR);
      // El bloque cripto es el de riesgo: sin oro y sin stablecoins que sigan en este cubo
      const crypto = v2 - gold - sum(b2.filter(r => esEstable(r.p)), r => r.mvEUR);
      const btcW = crypto ? btc / crypto * 100 : 0;
      if (crypto > 0 && btcW < T.btc_fin_ciclo) add(60 + (singleBucket ? 25 : 0) + (ph.phase === 'sobrecalentamiento' ? 15 : 0), `BTC es ${fmtN(btcW, 1)} % del bloque cripto; destino ${T.btc_fin_ciclo} %`, `Faltan ${fmtK((T.btc_fin_ciclo - btcW) / 100 * crypto)} en BTC, financiados desde dentro del bloque (altcoins → stablecoins → BTC en el año posterior al techo). Stablecoins hoy ${fmtK(stables)}. Falta definir con número «fin de ciclo».`, 'Glide interno del cripto, §5', (T.btc_fin_ciclo - btcW) / 100 * crypto);
      const base = reb > 0 ? reb : total; const goldT = T.oro_base / 100 * base, btcT = T.btc_base / 100 * base;
      if (gold < goldT * 0.5) add(75 + (ph.phase === 'estanflacion' || ph.phase === 'sobrecalentamiento' ? 15 : 0), `Oro por debajo del ancla del ${fmtN(T.oro_base, 0)} %`, `Oro ${fmtK(gold)} frente a ${fmtK(goldT)} objetivo. Se compra por calendario (no tiene nivel de entrada), con la orden automática quincenal hasta llegar; el exceso de cripto sobre objetivo también compra oro. Escalonar tiene precio: sobre la serie propia de Xetra-Gold, repartir la compra en 60 meses salió más caro que comprarla de una vez en la mediana de los arranques desde 2015.`, 'Ancla del oro, §5 · financiación, §8', goldT - gold);
      // El bitcoin tiene ancla propia sobre la base, no solo un peso dentro del bloque cripto
      if (btc < btcT * 0.5) add(70, `Bitcoin por debajo del ancla del ${fmtN(T.btc_base, 0)} %`, `BTC ${fmtK(btc)} frente a ${fmtK(btcT)} objetivo. La rotación de altcoins (${fmtK(crypto - btc)}) cubre la mayor parte sin dinero nuevo; el resto, de la aportación. Rotar altcoins no sube el peso del cubo 2, solo arregla su mezcla.`, 'Ancla del bitcoin, §5', btcT - btc);
    }
  }
  // 5. Cubo 3 interno
  if (!singleBucket || singleBucket === 3) {
    const base = reb > 0 ? reb : total;
    // Dentro del cubo 3, las stablecoins suman a la caja y no a la deuda pública
    const estables3 = sum(rows.filter(r => r.bucket === 3 && esEstable(r.p)), r => r.mvEUR);
    const bonds = sum(rows.filter(r => r.bucket === 3 && !esEstable(r.p)), r => r.mvEUR);
    const polvora = cash + estables3;
    const cajaT = T.caja_base / 100 * base, bonosT = T.bonos_base / 100 * base;
    if (polvora < cajaT * 0.6) add(78 + (ph.phase === 'estanflacion' ? 20 : 0), 'Caja remunerada por debajo de objetivo', `Efectivo ${fmtK(cash)}${estables3 > 0 ? ` más ${fmtK(estables3)} en stablecoins` : ''} frente a ${fmtK(cajaT)} (${T.caja_base} % de la base). ${ph.phase === 'estanflacion' ? 'En estanflación gana el cash: acumular pólvora es la prioridad. ' : ''}Los dividendos se quedan en la remunerada mientras el cubo 3 esté por debajo del ${T.dividendos_a_cubo3_hasta} % de lo rebalanceable.`, 'Cubo 3, §6 · dividendos, §8', cajaT - polvora);
    const bund = latestAtOrBefore(DB.bench['^TNX'] || {}, todayISO());
    if (bonds < bonosT * 0.6) add(62, 'Deuda pública EUR por debajo de objetivo', `Bonos ${fmtK(bonds)} frente a ${fmtK(bonosT)}. Solo soberano EUR corto mientras no se confirme el giro de tipos; nada de corporativo ni high yield.`, 'Lista negra defensiva, §6', bonosT - bonds);
    if (cash < 0) add(110, 'Efectivo negativo en alguna cuenta', `La caja calculada es ${fmtK(cash)}: hay ingresos sin registrar o compras pagadas desde fuera. Cuadrar antes de rebalancear.`, 'Modo de fallo: la defensiva se financia a sí misma hacia abajo', null);
  }
  // 6. Fase: cubo que gana
  const win = Object.entries(BUCKETS).find(([, b]) => b.wins === ph.phase);
  if (win && !singleBucket) add(40, `En ${ph.phase} gana el cubo ${win[0]}`, `${BUCKETS[win[0]].name}: ${BUCKETS[win[0]].job.toLowerCase()}. El reloj fija tamaño y momento dentro de las bandas, nunca el qué; no se venden compounders por macro.`, 'Reloj de inversión', null);
  // 7. Recomendaciones por tipo de activo (cuando se filtra un tipo)
  if (singleType) {
    const tv = sum(rows, r => r.mvEUR); const n = rows.length;
    if (singleType === 'stock') {
      const top = [...rows].sort((a, b) => b.mvEUR - a.mvEUR)[0]; const w = top && tv ? top.mvEUR / tv * 100 : 0;
      if (w > 15) add(90, `${top.p.ticker} pesa ${fmtN(w, 1)} % de las acciones`, `Ninguna acción debería superar el 15 % del bloque: por encima, se deja de añadir y se recorta con el escalón 2× si sigue subiendo.`, 'Escalones 1,5× y 2×, §7', null, ['stock']);
      const noDrawer = rows.filter(r => !r.p.drawer); if (noDrawer.length) add(70, `${noDrawer.length} acciones sin cajón asignado`, `${noDrawer.slice(0, 6).map(r => r.p.ticker).join(', ')}${noDrawer.length > 6 ? '…' : ''}: sin cajón no hay regla de venta. Asígnalo en Posiciones (núcleo, tesis, índice, especulativa, reserva o en venta).`, 'Cajones, §4', null, ['stock']);
      const venta = rows.filter(r => r.p.drawer === 'venta'); if (venta.length) add(85, `${venta.length} acciones en el cajón «en venta»`, `${venta.map(r => r.p.ticker).join(', ')} (${fmtK(sum(venta, r => r.mvEUR))}). Salen en el próximo rebalanceo o al primer rebote; su importe va al cubo más infraponderado.`, 'Jerarquía de rebalanceo, §7', sum(venta, r => r.mvEUR), ['stock']);
    }
    if (singleType === 'fund') {
      const losers = rows.filter(r => r.gainPct < -5); if (losers.length) add(65, `${losers.length} fondos con más de un 5 % de pérdida`, `${losers.map(r => r.p.ticker).join(', ')}. Un fondo se traspasa a otro sin peaje fiscal: si no encaja en el cubo 1, traspásalo al índice global en vez de reembolsar.`, 'Traspasos con diferimiento fiscal', null, ['fund']);
      add(55, 'Aportación recurrente a fondos: sigue el calendario', `Los fondos son la vía sin peaje fiscal para la aportación mensual (${fmtK(T.aportacion_mensual)}) al cubo 1; si el índice global pesa menos del ${T.cajones_cubo1.indice} % del cubo 1, la aportación va ahí.`, 'Válvula índice, §4 y §7', T.aportacion_mensual, ['fund']);
    }
    if (singleType === 'plan') add(60, 'Plan de pensiones: hasta 1.500 € al año con deducción', `Aportado este año ${fmtK(sum(DB.operations.filter(o => o.type === 'buy' && o.date.startsWith(todayISO().slice(0, 4)) && posOf(o.position_id)?.type === 'plan'), o => o.total_eur || 0))}. El límite deducible en el IRPF es 1.500 €; por encima no hay ventaja fiscal y el dinero queda bloqueado (cubo 4).`, 'Cubo 4: no rebalancea', null, ['plan']);
    if (singleType === 'etf') { const idx = rows.filter(r => r.p.drawer === 'indice'); if (!idx.length) add(80, 'Ningún ETF marcado como válvula (cajón índice)', 'El ETF indexado global es la válvula del cubo 1: márcalo con el cajón «índice» en Posiciones para que el rebalanceo lo use.', 'Válvula índice, §7', null, ['etf']); }
    if (singleType === 'crypto') { const btc = sum(rows.filter(r => r.p.ticker === 'BTC'), r => r.mvEUR); const stables = sum(rows.filter(r => ['USDT', 'USDC', 'USDX'].includes(r.p.ticker)), r => r.mvEUR); const risk = tv - stables; const btcW = risk ? btc / risk * 100 : 0;
      add(70, `Stablecoins: ${fmtK(stables)} (${fmtN(tv ? stables / tv * 100 : 0, 1)} % del bloque)`, 'Las stablecoins son caja en dólares: cuentan como pólvora del cubo 3, no como cripto de riesgo. Si superan lo que vas a desplegar en 3 meses, pásalas a euro remunerado.', 'Cubo 3, §6', null, ['crypto']);
      if (risk > 0 && btcW < T.btc_fin_ciclo) add(75, `BTC es ${fmtN(btcW, 1)} % de la cripto de riesgo; destino ${T.btc_fin_ciclo} %`, `Faltan ${fmtK((T.btc_fin_ciclo - btcW) / 100 * risk)}: las altcoins se van rotando a BTC a lo largo del ciclo, sin dinero nuevo.`, 'Glide interno, §5', (T.btc_fin_ciclo - btcW) / 100 * risk, ['crypto']); }
    if (singleType === 'cash') { const base = reb > 0 ? reb : total; const cajaT = T.caja_base / 100 * base; add(80, `Efectivo ${fmtK(cash)} frente a ${fmtK(cajaT)} objetivo`, `${cash < cajaT ? 'Falta pólvora: los dividendos y ventas se quedan en la remunerada hasta llegar al objetivo.' : 'Hay exceso: desplegar hacia el cubo más infraponderado en la próxima revisión.'} Todo el efectivo debe estar remunerado.`, 'Cubo 3, §6', cajaT - cash, ['cash']); }
    if (singleType === 'custom') add(60, `Cubo 4: ${n} posiciones ilíquidas por ${fmtK(tv)}`, 'No rebalancean ni reciben aportaciones nuevas: solo se mantienen o se venden cuando haya liquidez. Revisa una vez al año la tasación manual de cada una.', 'Cubo 4: lastre estructural', null, ['custom']);
    if (singleType === 'option') add(60, 'Opciones: solo cubiertas y de corto plazo', `${n} posiciones abiertas. Ninguna venta de opción sin el subyacente o el efectivo detrás; cerrar antes de vencimiento si la prima ya se ha ganado en más del 80 %.`, '§3 especulativa', null, ['option']);
  }
  out.sort((a, b) => b.score - a.score);
  // Con un tipo filtrado, solo lo que afecta a ese tipo (las de tipo llevan etiqueta; las generales se descartan)
  const sel = singleType ? out.filter(r => r.types && r.types.includes(singleType)) : out;
  return (sel.length ? sel : out).slice(0, 5);
}
export function recommendationsHTML(C) {
  const recs = recommendations(C);
  return `<div class="recs">${recs.map((r, i) => `<div class="rec tip" tabindex="0" data-tip="${esc(r.body + ' — ' + r.rule + (r.amount != null ? ' · ' + fmtK(Math.abs(r.amount)) : ''))}"><div class="rec-n">${i + 1}</div><div class="rec-t">${esc(r.title)}</div></div>`).join('') || '<div class="muted">Sin recomendaciones: la selección está dentro de banda.</div>'}<div class="rec-foot">No es una orden. Pasa el cursor por cada una para ver el porqué.</div></div>`;
}
