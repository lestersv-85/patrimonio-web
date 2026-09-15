// Taller de dimensionamiento por el criterio de Kelly.
//
// Apoyo a la decisión, no órdenes: los topes escritos de la política mandan. Kelly da el tamaño
// óptimo cuando conoces la distribución de resultados; no la conoces, la estimas, y por eso aquí
// la fracción por defecto es la mitad, Σ va encogida y la columna μ está para que la escribas tú.
import { DB, cargarDiario, saveSettings, refreshSettings } from '../store.js?v=57b99b9';
import { $, $$, esc, fmtEUR, fmtK, fmtN, fmtPct, cls, num, toast, C as COL, TYPES, HELP } from '../util.js?v=57b99b9';

// Ayuda al pasar el cursor, con el mismo patrón que el resto de la app
// Un elemento no puede llevar dos atributos class: el navegador se queda con el primero y el segundo
// se pierde. Si el sitio donde se pone la ayuda ya tiene clase, va aquí como `extra` y no aparte, o la
// burbuja no se pinta (le pasaba a «Sin mercado», que llevaba class="muted").
const ay = (k, extra = '') => ` class="tip${extra ? ' ' + extra : ''}" tabindex="0" data-tip="${esc(HELP[k] || '')}"`;
const conQ = (t, k) => `<span${ay(k)}>${t} <span class="q">?</span></span>`;
import { inSelPos, isInvest, defaultBucket, cerradasConMercado, simbolosEnCartera } from '../engine.js?v=57b99b9';
import { matriz, estadisticos, encoger, betaPareja, kellyIndividual, kellyMulti, aplicarPolitica,
         crecimiento, kellyBinario, kellyDiscreto, tesisAEscenarios, FRACCIONES, MIN_DIAS,
         tangencia, fronteraEficiente, implicitas, puntoRiesgoRetorno } from '../kelly.js?v=57b99b9';
import { openModal, closeModal } from '../forms.js?v=57b99b9';
import { donut, legendHTML, chart, pctTick, grid } from '../charts.js?v=57b99b9';
import { DRAWERS, PALETTE, ESTILOS, ESTILO_COLOR } from '../util.js?v=57b99b9';
import { hacerOrdenables } from '../sortable.js?v=57b99b9';

const LS = 'sp-taller-v1';
const hoyISO = () => new Date().toISOString().slice(0, 10);
// Referencia para la beta del prior. Se elige la que tenga serie más densa: una referencia mensual
// daría betas calculadas sobre un puñado de puntos. Nunca entra en la matriz común (ver betaPareja).
const REFS = [
  { id: 'SXR8.DE', nm: 'S&P 500 TR (EUR)', ccy: 'EUR' },
  { id: '^GSPC', nm: 'S&P 500 (precio, USD)', ccy: 'USD' },
];
function referencia() {
  const con = REFS.map(r => ({ ...r, n: Object.keys(DB.bench[r.id] || DB.diario[r.id] || {}).length }));
  con.sort((a, b) => b.n - a.n);
  return con[0].n ? con[0] : REFS[0];
}

// Parámetros del taller. Viven en `settings.taller`, en la base, para que el reparto sea el mismo
// mires desde donde lo mires: con los mismos datos y parámetros distintos, el Mac y el iPhone daban
// carteras distintas. `localStorage` se queda como copia local: responde al instante y sirve si la
// base no está disponible, pero la base manda en cuanto carga.
// Valores medidos sobre esta cartera, no elegidos a ojo (ver ESTADO.md):
//  · tope 15 %  — con el suelo puesto, la mayor posición pide 13,2 %: el tope no ata y Kelly reparte
//                 libre. Equivale al 12,5 % del cubo 1, por debajo del 15 % que fija la doctrina.
//  · suelo 5 %  — quitar las colas no cuesta crecimiento (+6,5 % con y sin ellas) y deja 10 posiciones.
//  · ventana 5 años — lo limitan ONON y UMG, que salieron a bolsa en 2021. Da n/N ≈ 66 e incluye 2022.
const RECOMENDADO = { tope: 15, suelo: 5, sueloModo: 'descartar', c: 0.5, anosMin: 5 };
const POR_DEFECTO = { r: 2.25, prima: 5, c: 0.5, lam: 0.5, tope: 15, suelo: 5, anosMin: 5, sueloModo: 'descartar', cols: null,
                      marcados: null, mu: {}, manual: [], auto: [], wMan: {}, esc: { p: 30, b: 3, L: 100 } };
let P = { ...POR_DEFECTO };
const local = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch { return {}; } };
// Se llama al montar la vista, cuando DB.settings ya está cargado. Si la base todavía no tiene nada
// guardado pero este navegador sí, se sube lo local una vez: así no se pierde lo que ya habías puesto.
function cargarParametros() {
  const enBase = (DB.settings && DB.settings.taller) || null;
  P = { ...POR_DEFECTO, ...(enBase || local()) };
  if (!enBase) { const l = local(); if (Object.keys(l).length) guardar(); }
}
// Escribir en la base en cada tecla sería una llamada por pulsación: se agrupa y se manda una vez.
// La copia en memoria se actualiza al momento, sin esperar al envío: si no, al salir y volver a la
// pestaña antes de que saliera la llamada, `cargarParametros` leía el valor viejo y deshacía el cambio.
let pendiente = null, enVuelo = false;
const guardar = () => {
  try { localStorage.setItem(LS, JSON.stringify(P)); } catch {}
  if (DB.settings) DB.settings.taller = P; else DB.settings = { id: 'main', taller: P };
  clearTimeout(pendiente); enVuelo = true;
  pendiente = setTimeout(() => {
    pendiente = null;
    saveSettings({ taller: P })
      .catch(e => toast('Los parámetros no se han podido guardar en la nube: ' + e.message))
      .then(() => { enVuelo = false; }, () => { enVuelo = false; });
  }, 1200);
};

// Lo cambiado en otro navegador entra al volver a esta pestaña: se relee la fila de ajustes y, si el
// taller guardado no es el que estás mirando, se repinta. Con un guardado propio pendiente no se mira
// nada: lo que acabas de escribir manda sobre lo que haya en la base.
let vigilando = false;
function vigilarOtrosDispositivos(UI, render) {
  if (vigilando) return; vigilando = true;
  const mirar = async () => {
    if (document.hidden || pendiente || enVuelo || UI.view !== 'tamanos' || DB.mode !== 'cloud') return;
    const antes = JSON.stringify(((DB.settings || {}).taller) || null);
    try {
      const s = await refreshSettings();
      if (JSON.stringify(((s || {}).taller) || null) !== antes) { toast('Parámetros actualizados desde otro dispositivo'); render(); }
    } catch (e) { /* sin red: se queda lo que hay */ }
  };
  document.addEventListener('visibilitychange', mirar);
  window.addEventListener('focus', mirar);
}

// Las tesis viven en `settings.tesis`, no en este navegador: son juicio tuyo sobre cada empresa y
// tienen que estar donde estén tus datos. Clave: id de posición o símbolo del candidato.
const tesisTodas = () => (DB.settings && DB.settings.tesis) || {};
const tesisDe = id => tesisTodas()[id] || null;
async function guardarTesis(id, t) {
  const todas = { ...tesisTodas() };
  if (t) todas[id] = { ...t, actualizada: new Date().toISOString().slice(0, 10) };
  else delete todas[id];
  await saveSettings({ tesis: todas });
}

let CALC = null;      // último cálculo
let cargando = false;

// ---------- lo que Kelly no dimensiona ----------
// Fondos y cripto van a mano por decisión del usuario. No es un capricho: de un fondo no hay tesis
// con desenlaces (su μ saldría del prior CAPM, la estimación más floja de la pantalla) y su σ medida
// es artificialmente baja porque valora una vez al día; y la cripto no tiene objetivo de analista ni
// valor razonable publicado del que sacar un alza. Siguen ocupando capital: su peso lo escribes tú y
// Kelly reparte **solo lo que queda**.
const A_MANO = ['fund', 'crypto'];
// `P.dimTodo` apaga esa regla entera: fondos y cripto pasan a dimensionarse como una acción más.
// No es el modo por defecto y conviene saber qué se está pidiendo: de un fondo o de una cripto no
// hay tesis con desenlaces, así que su μ sale del prior CAPM —la estimación más floja de la
// pantalla— y Kelly reparte en proporción a lo que ese prior dice. El resultado sirve para
// comparar, no para obedecer. Se puede seguir sacando una sola posición con «a mano».
const esAMano = x => (P.auto || []).includes(x.id) ? false
  : (P.manual || []).includes(x.id) ? true
  : (!P.dimTodo && A_MANO.includes(x.tipo));
// Peso a mano de una posición, en % de la base: el que hayas escrito o, si no, el que tiene hoy.
const pesoMano = (x, base) => (P.wMan && P.wMan[x.id] != null) ? P.wMan[x.id] : (base ? x.valor / base * 100 : 0);

// ---------- universo ----------
// Solo se dimensiona lo que cotiza. Casas, Reental, plan y xReental se listan aparte y bloqueados:
// no tienen serie de precios, su σ medida saldría casi cero y Kelly los leería como activos sin
// riesgo. Es el modo de fallo más peligroso que tiene este modelo.
function universo(C) {
  const dim = [], sin = [], mano = [];
  for (const r of C.rows) {
    if (!isInvest(r.p)) continue;
    const fila = { id: r.p.id, tk: r.p.ticker, nm: r.p.name || r.p.ticker, tipo: r.p.type,
                   ccy: r.p.currency, valor: r.mvEUR, bucket: defaultBucket(r.p), fuente: 'cartera' };
    if (r.p.price_mode === 'manual' || !r.p.yahoo_symbol) sin.push(fila);
    else if (esAMano(fila)) mano.push(fila);
    else dim.push(fila);
  }
  mano.sort((a, b) => b.valor - a.valor);

  // Candidata es lo que hoy NO se tiene. Sale de la lista de seguimiento, pero si ese símbolo ya
  // fue tuyo y lo vendiste entero, el candidato hereda el **id de aquella posición**: su histórico
  // completo ya está en `prices` y se dimensiona en el acto, sin esperar a que corra
  // `fetch_market.py watchlist`. De paso, la tesis y la μ que escribas siguen con él si algún día
  // lo vuelves a comprar, porque la clave no cambia.
  const cerradas = cerradasConMercado(C);
  const enCartera = simbolosEnCartera(C);
  const cand = [];
  for (const w of DB.watchlist || []) {
    const sim = String(w.symbol || '').toUpperCase();
    if (enCartera.has(sim)) continue;      // ya la llevas: su fila es la de cartera, no se duplica
    const p = cerradas.get(sim);
    cand.push({
      id: p ? p.id : w.symbol, tk: w.ticker || w.symbol, nm: w.name || (p && p.name) || w.symbol,
      tipo: w.type || (p && p.type) || 'stock', ccy: w.currency || (p && p.currency) || 'EUR',
      valor: 0, bucket: p ? defaultBucket(p) : 1, fuente: p ? 'cerrada' : 'seguimiento', nota: w.note });
  }
  dim.sort((a, b) => b.valor - a.valor);
  sin.sort((a, b) => b.valor - a.valor);
  return { dim, sin, cand, mano };
}

// Base del taller: lo líquido y cotizado (posiciones con mercado más el efectivo). El patrimonio
// total y la parte sin mercado se enseñan al lado como contexto, nunca como denominador: con el
// total el modelo pediría órdenes que no se pueden financiar.
function capital(C, U) {
  const posiciones = U.dim.reduce((s, x) => s + x.valor, 0);
  const enMano = U.mano.reduce((s, x) => s + x.valor, 0);
  const efectivo = Object.values(C.cashEUR || {}).reduce((s, v) => s + v, 0);
  const sinMercado = U.sin.reduce((s, x) => s + x.valor, 0);
  const vivienda = C.rows.filter(r => !isInvest(r.p)).reduce((s, r) => s + r.mvEUR, 0);
  const base = posiciones + enMano + efectivo;
  // Lo que se ha fijado a mano sale del bote antes de repartir: ese dinero ya tiene dueño.
  const mano = U.mano.reduce((s, x) => s + pesoMano(x, base) / 100 * base, 0);
  return { base, baseOptim: base - mano, mano, posiciones, enMano, efectivo, sinMercado, vivienda,
           total: base + sinMercado + vivienda };
}

// Marcado inicial: renta variable directa con al menos tres años de historia. Se deja fuera lo
// recién salido a bolsa o recién comprado no porque sea peor, sino porque la ventana común la fija
// el más joven: un fondo de 0,9 años recortaría a 0,9 años la ventana de McDonald's. Marcarlo es un
// clic y la columna «Ventana» dice de antemano lo que cuesta.
const ANOS_MIN = 3;
// Por debajo de esto una posición es residuo contable, no una posición. En esta cartera hay dos
// restos de traspasos de fondos: 0,000000002 participaciones de un Capital Group (0,00 €) y 0,02 de
// un Santander (0,22 €). Con σ baja el modelo les daba el 12 % del capital, es decir, dimensionaba
// algo que no existe. Siguen en la lista y se pueden marcar a mano; simplemente no entran solas.
const VALOR_MIN = 100;
function historiaAnos(id) {
  const m = DB.diario[id] || DB.prices[id] || DB.bench[id];
  const k = m && Object.keys(m).sort()[0];
  return k ? (Date.now() - new Date(k)) / 31557600000 : null;
}
const marcadosPorDefecto = U => U.dim
  .filter(x => x.bucket === 1 && x.tipo !== 'crypto' && x.valor >= VALOR_MIN && (historiaAnos(x.id) ?? 0) >= ANOS_MIN)
  .map(x => x.id);

// ---------- columnas de la tabla ----------
// Una sola definición manda sobre la cabecera, sobre cada celda y sobre el colspan de las filas de
// sección. Antes había tres listas paralelas y bastó mover una columna para que cabecera y celdas
// se descuadraran: con esto no puede volver a pasar.
//
// El orden es el del bucle de trabajo: marcas, escribes μ y ves inmediatamente al lado el tamaño
// que sale y lo que te separa de él. Lo que explica *por qué* sale ese tamaño (ventana, μ histórica,
// β, Kelly de una sola posición) es diagnóstico: está, pero apagado, porque obliga a desplazarse.
const COLS = [
  { k: 'mk',    th: '',            fijo: true, noord: true, ancho: '26px' },
  { k: 'pos',   th: 'Posición',    fijo: true },
  { k: 'w0',    th: 'Peso hoy',    num: true, ver: true },
  { k: 'mu',    th: '<span class="gr">μ</span> tesis', ayuda: 'tk_mu_tesis', num: true, ver: true, acento: true },
  { k: 'tam',   th: 'Tamaño',      ayuda: 'tk_tamano', num: true, ver: true },
  { k: 'delta', th: '<span class="gr">Δ</span> vs hoy', ayuda: 'tk_delta', num: true, ver: true },
  { k: 'F',     th: 'F* multi.',   ayuda: 'tk_fmulti', num: true, ver: true },
  { k: 'fdisc', th: 'Kelly tesis', ayuda: 'tk_fdisc', num: true, ver: true },
  { k: 'sigma', th: '<span class="gr">σ</span>', ayuda: 'tk_sigma', num: true, ver: true },
  { k: 'peor',  th: 'Peor día',    ayuda: 'tk_peor', num: true, ver: true },
  { k: 'vent',  th: 'Ventana',     ayuda: 'tk_ventana_fila', num: true },
  { k: 'muh',   th: '<span class="gr">μ</span> hist.', ayuda: 'tk_mu_hist', num: true },
  { k: 'beta',  th: '<span class="gr">β</span>', ayuda: 'tk_beta', num: true },
  { k: 'find',  th: 'f* indiv.',   ayuda: 'tk_find', num: true },
];
const visibles = () => {
  const on = new Set(P.cols || COLS.filter(c => c.ver).map(c => c.k));
  return COLS.filter(c => c.fijo || on.has(c.k));
};
const cabecera = () => '<tr>' + visibles().map(c => {
  const est = (c.ancho ? `width:${c.ancho};` : '') + (c.acento ? 'color:var(--accent);' : '');
  return `<th class="${c.num ? 'num' : ''}"${est ? ` style="${est}"` : ''}${c.noord ? ' data-noord' : ''}>`
    + (c.ayuda ? conQ(c.th, c.ayuda) : c.th) + '</th>';
}).join('') + '</tr>';

// ---------- cálculo ----------
async function calcular(U, base) {
  if (!(base > 0)) return { error: 'Los pesos escritos a mano se comen toda la base: no queda capital que repartir.' };
  const ids = P.marcados || marcadosPorDefecto(U);
  const sel = [...U.dim, ...U.cand].filter(x => ids.includes(x.id));
  if (sel.length < 2) return { error: 'Marca al menos dos activos para que haya covarianza que estimar.' };

  const REF = referencia();
  // Se acota la descarga: el taller nunca mira más atrás que su ventana, y tras el backfill hay
  // posiciones con veinte años de diario (PGR arranca en 1980). Se pide la ventana pedida más diez
  // años de holgura, que es de sobra para la intersección y para las betas por pares.
  const desde = (() => { const d = new Date(); d.setFullYear(d.getFullYear() - (Math.max(num(P.anosMin), 0) + 10)); return d.toISOString().slice(0, 10); })();
  await cargarDiario([...sel.map(x => x.id), REF.id], desde);
  const mapa = id => DB.diario[id] || DB.prices[id] || DB.bench[id] || null;

  const activos = sel.map(x => ({ ...x, mapa: mapa(x.id), label: x.tk }));
  const M = matriz(activos.filter(a => a.mapa));
  if (!M.R.length || M.R[0].length < MIN_DIAS)
    return { error: `Solo hay ${M.R[0] ? M.R[0].length : 0} días con precio en todos a la vez; hacen falta ${MIN_DIAS}. Desmarca el activo más joven o ejecuta el histórico profundo.`, M };

  const E = estadisticos(M.R);
  // La beta se calcula activo a activo contra la referencia, fuera de la matriz común: si la serie
  // del índice es más pobre, arrastraría la ventana de todos al suelo.
  const mRef = mapa(REF.id);
  const B = M.activos.map(a => betaPareja(a.mapa, mRef, a.ccy, REF.ccy));

  const keep = M.activos.map((a, i) => i);
  const sub = (m) => keep.map(i => keep.map(j => m[i][j]));
  const act = keep.map(i => M.activos[i]);
  const r = P.r / 100;
  // μ por defecto: prior CAPM. No es una previsión, es el punto de partida que explica por qué las
  // posiciones de beta baja salen a cero. Se sustituye escribiendo el retorno de cada tesis.
  const muPrior = keep.map(i => r + (B[i] == null ? 1 : B[i]) * (P.prima / 100));   // sin beta, se supone 1
  // Orden de preferencia para μ: la tesis con escenarios (lo más informado), luego un μ escrito a
  // mano, y por último el prior CAPM, que no es una previsión sino un punto de partida.
  const TS = act.map(a => { const t = tesisDe(a.id); return t ? { ...tesisAEscenarios(t), t } : null; });
  const mu = act.map((a, k) => {
    if (TS[k] && TS[k].muAnual != null) return TS[k].muAnual;
    if (P.mu[a.id] != null) return P.mu[a.id] / 100;
    return muPrior[k];
  });

  const cov = sub(E.cov);
  const covEnc = encoger(cov, P.lam);
  const fInd = kellyIndividual(mu, cov, r);
  const F = kellyMulti(mu, covEnc, r);
  if (!F) return { error: 'La matriz de covarianzas no se puede invertir con estos activos: hay uno que es combinación casi exacta de otros. Desmarca alguno.', M };

  // El continuo y el discreto miden cosas distintas y ninguno domina al otro:
  //  · el continuo (Σ⁻¹) sabe de correlación, que es lo que evita concentrar sin darse cuenta, pero
  //    supone precios sin saltos y por tanto NO tiene probabilidad de ruina;
  //  · el discreto sabe de ruina, porque se la das tú, pero trata la posición como si fuera la única.
  // Se aplica el MÍNIMO de los dos: ninguno de los dos modelos puede convencerte de un tamaño que el
  // otro rechaza. Cuando se separan mucho, esa distancia es la información: estás dimensionando por
  // volatilidad algo cuyo riesgo real es binario.
  const Fd = act.map((a, k) => (TS[k] && TS[k].f != null && isFinite(TS[k].f) ? TS[k].f : null));
  const Fusado = F.map((f, k) => (Fd[k] == null ? f : Math.min(f, Fd[k] / P.c)));
  const pol = aplicarPolitica(Fusado, { c: P.c, tope: P.tope / 100, suelo: P.suelo / 100, sueloModo: P.sueloModo });
  const g = crecimiento(pol.w, mu, covEnc, r);
  const filas = act.map((a, k) => ({
    ...a, mu: mu[k], muPrior: muPrior[k], muHist: keep[k] != null ? E.mu[keep[k]] : null,
    sigma: E.sigma[keep[k]], peor: E.peor[keep[k]], beta: B[keep[k]],
    fInd: fInd[k] * P.c, F: F[k] * P.c, fDisc: Fd[k] == null ? null : Fd[k],
    manda: Fd[k] == null ? 'continuo' : (Fd[k] / P.c < F[k] ? 'tesis' : 'continuo'),
    tesis: TS[k] ? TS[k].t : null, muTesis: TS[k] ? TS[k].muAnual : null,
    w: pol.w[k], tam: pol.w[k] * base, delta: pol.w[k] * base - a.valor,
  })).sort((a, b) => b.w - a.w || b.valor - a.valor);

  const anos = M.fechas.length ? (new Date(M.fechas[M.fechas.length - 1]) - new Date(M.fechas[0])) / 31557600000 : 0;
  // La historia más larga que hay entre los marcados: si ni el más viejo llega, el problema no es la
  // selección sino que la serie diaria profunda todavía no se ha descargado.
  // Cuánto de la ventana común se pierde por huecos: si entre el arranque común y el primer retorno
  // utilizable hay meses, la serie de ese tramo es mensual y el problema son los datos, no la selección.
  const perdido = (M.arranque && M.fechas.length)
    ? (new Date(M.fechas[0]) - new Date(M.arranque)) / 31557600000 : 0;
  // ---- Frontera eficiente, tangencia y μ implícitas ----
  // Todo sobre la MISMA Σ encogida, la misma μ y el mismo r que acaban de dimensionar: si se
  // calculara aparte saldrían dos respuestas distintas para la misma cartera.
  // Los pesos de hoy se miden sobre lo que ya se tiene de los activos marcados, renormalizado: el
  // punto «tu cartera» tiene que ser comparable con los otros dos, que suman 1 por construcción.
  const valHoy = act.map((a, k) => Math.max(0, filas.find(f => f.id === a.id)?.valor || 0));
  const sumHoy = valHoy.reduce((x, y) => x + y, 0);
  const wHoy = sumHoy > 0 ? valHoy.map(x => x / sumHoy) : null;
  const tan = tangencia(mu, covEnc, r);
  const imp = wHoy ? implicitas(wHoy, covEnc, r, P.prima / 100) : null;
  const frontera = {
    curva: fronteraEficiente(mu, covEnc, 60),
    tangencia: tan ? { ...puntoRiesgoRetorno(tan, mu, covEnc), w: tan } : null,
    kelly: puntoRiesgoRetorno(pol.w, mu, covEnc),
    hoy: wHoy ? puntoRiesgoRetorno(wHoy, mu, covEnc) : null,
    // La μ implícita se devuelve por id para que la tabla no dependa del orden de `act`.
    implicitas: imp ? Object.fromEntries(act.map((a, k) => [a.id, imp.mu[k]])) : null,
    delta: imp ? imp.delta : null,
    ids: act.map(a => a.id), tks: act.map(a => a.tk), wHoy,
  };

  return { filas, M, pol, g, r, base, anos, perdido, frontera, conTesis: TS.filter(Boolean).length, dias: M.R[0].length, n: act.length, nN: M.R[0].length / act.length };
}

// ---------- vista ----------
export function renderTaller(v, C, { UI, render, go }) {
  cargarParametros();
  vigilarOtrosDispositivos(UI, render);
  const U = universo(C);
  let K = capital(C, U);
  const ids = P.marcados || marcadosPorDefecto(U);
  const pIliq = K.total ? (K.sinMercado + K.vivienda) / K.total * 100 : 0;

  v.innerHTML = `<h2>Taller de dimensionamiento</h2>
    <p class="muted" style="margin:.2rem 0 .9rem;font-size:.85rem;max-width:98ch">Kelly da la fracción del capital que maximiza el crecimiento <b>compuesto</b> cuando conoces la distribución de resultados. No la conoces: la estimas. Por eso la fracción por defecto es la mitad, la matriz va encogida y la columna μ está para que <b>escribas el retorno de tu tesis</b>, no para usar la media histórica. <b>Los topes escritos de tu política mandan y ninguna cifra de esta pantalla es una orden.</b></p>

    <div class="note warn" id="tk-ventana">Calculando la ventana común…</div>

    <div class="grid3">
      <div class="card pad">
        <div class="eyebrow">Capital</div>
        <div class="field inline"><label${ay('tk_base')}>Base del taller · <b>líquido y cotizado</b> <span class="q">?</span></label><b class="mono">${fmtEUR(K.base, 0)}</b></div>
        <div class="field inline"><label class="muted">Posiciones con mercado</label><span class="mono muted">${fmtEUR(K.posiciones, 0)}</span></div>
        <div class="field inline"><label class="muted">Efectivo</label><span class="mono muted">${fmtEUR(K.efectivo, 0)}</span></div>
        <div class="field inline"><label${ay('tk_mano')}>Fijado a mano · fondos y cripto <span class="q">?</span></label><span class="mono" id="tk-mano-eur" style="color:var(--purple)">${fmtEUR(K.mano, 0)}</span></div>
        <div class="field inline"><label><b>Queda para repartir</b></label><b class="mono" id="tk-baseoptim">${fmtEUR(K.baseOptim, 0)}</b></div>
        <div class="field inline"><label${ay('tk_sinmercado', 'muted')}>Sin mercado (inmuebles, Reental, plan) <span class="q">?</span></label><span class="mono neg">${fmtEUR(K.sinMercado + K.vivienda, 0)}</span></div>
        <div class="stack" style="margin:.5rem 0"><i style="background:${COL.cyan};width:${(100 - pIliq).toFixed(1)}%"></i><i style="background:${COL.red};width:${pIliq.toFixed(1)}%"></i></div>
        <p class="muted" style="font-size:.74rem;margin:0"><b>El ${fmtN(pIliq, 0)} % de tu patrimonio no se puede reasignar.</b> No entra en la base porque el modelo pediría órdenes que no puedes financiar, y porque sin serie de precios su volatilidad medida sale casi cero: Kelly las leería como activos sin riesgo. Está aquí para que veas la concentración, no para dimensionarla.</p>
      </div>

      <div class="card pad">
        <div class="eyebrow">Parámetros</div>
        <div class="field inline"><label${ay('tk_r')}>Tipo sin riesgo · BCE <span class="q">?</span></label><input type="number" id="tk-r" step="0.05" value="${P.r}"><span class="u">%</span></div>
        <div class="field inline"><label${ay('tk_prima')}>Prima de riesgo del prior <span class="q">?</span></label><input type="number" id="tk-prima" step="0.25" value="${P.prima}"><span class="u">%</span></div>
        <div class="field inline"><label${ay('tk_tope')}>Tope por posición <span class="q">?</span></label><input type="number" id="tk-tope" step="1" value="${P.tope}"><span class="u">%</span></div>
        <div class="field inline"><label${ay('tk_suelo')}>Suelo por posición <span class="q">?</span></label><input type="number" id="tk-suelo" step="0.5" value="${P.suelo}"><span class="u">%</span></div>
        <div class="field inline"><label${ay('tk_suelomodo')}>Lo que cae por debajo del suelo <span class="q">?</span></label><select id="tk-suelomodo" style="grid-column:2/4"><option value="descartar"${P.sueloModo === 'descartar' ? ' selected' : ''}>se descarta y se reparte</option><option value="subir"${P.sueloModo === 'subir' ? ' selected' : ''}>se sube hasta el suelo</option></select></div>
        <div class="field inline"><label${ay('tk_anosmin')}>Ventana mínima aceptable <span class="q">?</span></label><input type="number" id="tk-anosmin" step="1" min="0" max="25" value="${P.anosMin}"><span class="u">años</span></div>
        <div class="field inline"><label${ay('tk_lam')}>Encogimiento de <span class="gr">Σ (λ)</span> <span class="q">?</span></label><input type="number" id="tk-lam" step="0.05" min="0" max="1" value="${P.lam}"><span class="u"></span></div>
        <div class="field inline"><label${ay('tk_dimtodo')}>Dimensionar también fondos y cripto <span class="q">?</span></label><label class="interruptor" style="grid-column:2/4"><input type="checkbox" id="tk-dimtodo"${P.dimTodo ? ' checked' : ''}><span>${P.dimTodo ? 'Kelly los reparte' : 'su peso lo escribes tú'}</span></label></div>
        <div class="toolbar" style="justify-content:flex-end;margin-top:.2rem"><button class="btn sm" id="tk-reco" title="Tope 15 %, suelo 5 % descartando, fracción ½ y ventana mínima de 5 años: los valores medidos sobre esta cartera">Poner los valores recomendados</button></div>
        <div class="field inline" style="margin-top:.3rem"><label${ay('tk_fraccion')}>Fracción de Kelly <span class="q">?</span></label><div class="chips">${FRACCIONES.map(f => `<button class="chip ${Math.abs(P.c - f.c) < 1e-9 ? 'on' : ''}" data-frac="${f.c}">${f.nm}</button>`).join('')}</div></div>
        <div class="tablewrap" style="margin-top:.4rem"><table class="mini"><tbody>
          ${FRACCIONES.map(f => `<tr class="${Math.abs(P.c - f.c) < 1e-9 ? 'me' : 'muted'}"><td>${f.nm}</td><td class="num">${fmtN(f.crec * 100, 0)} % del crecimiento</td><td class="num ${f.ruina > .4 ? 'warn' : ''}">${fmtN(f.ruina * 100, 1)} % de verlo a la mitad</td></tr>`).join('')}
        </tbody></table></div>
        <p class="muted" style="font-size:.73rem;margin:.4rem 0 0">Thorp 2006 §7.4: apostando c·f* conservas c(2−c) del crecimiento con c veces la desviación típica. <b>Medio Kelly es media desviación típica, no media varianza.</b></p>
      </div>

      <div class="card pad">
        <div class="eyebrow">Resultado</div>
        <div class="kpis" id="tk-kpis" style="margin-top:.5rem"><div class="note">Calculando…</div></div>
        <div class="stack" id="tk-mix" style="margin:.5rem 0"></div>
        <p class="muted" style="font-size:.73rem;margin:.3rem 0 0">Se recalcula entero al marcar o desmarcar: la matriz se recorta al conjunto y se resuelve <span class="mono">F* = Σ⁻¹(μ − r·1)</span> de nuevo. Sin cortos ni apalancamiento: tu política los veta, así que lo negativo se trunca a cero y se dice.</p>
      </div>
    </div>

    <div class="card">
      <div class="head"><h3>Posiciones y candidatos</h3><span class="sub" id="tk-sub"></span>
        <div class="toolbar" style="width:100%;margin-top:.4rem">
          <button class="btn sm" data-marca="rv">Solo renta variable</button>
          <button class="btn sm" data-marca="todo">Todo lo que cotiza</button>
          <button class="btn sm" data-marca="largo">Solo historia larga (8 a+)</button>
          <button class="btn sm ghost" data-marca="nada">Ninguno</button>
          <span class="spacer" style="flex:1"></span>
          <button class="btn sm" id="tk-reset-mu">Volver al prior en todas las <span class="gr">μ</span></button>
        </div>
        <div class="toolbar" style="width:100%;margin-top:.3rem;align-items:center">
          <span class="muted" style="font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;font-weight:600">Columnas</span>
          <div class="chips">${COLS.filter(c => !c.fijo).map(c => `<button class="chip ${visibles().some(x => x.k === c.k) ? 'on' : ''}" data-col="${c.k}">${c.th}</button>`).join('')}</div>
          <span class="spacer" style="flex:1"></span>
          <span class="muted" style="font-size:.72rem">Apagadas por defecto las de diagnóstico: explican <i>por qué</i> sale ese tamaño, pero alejan <span class="gr">μ</span> del resultado.</span>
        </div></div>
      <div class="tablewrap"><table id="tk-tabla">
        <thead>${cabecera()}</thead>
        <tbody id="tk-filas"><tr><td colspan="${visibles().length}" class="muted" style="padding:1rem">Calculando…</td></tr></tbody>
      </table></div>
    </div>

    <div class="card">
      <div class="head"><h3>Cómo queda la cartera que estás armando</h3><span class="sub" id="tk-mixsub"></span></div>
      <p class="muted" style="margin:.2rem 1rem .6rem;font-size:.8rem;max-width:100ch">Los tamaños que propone el modelo, repartidos por sector, región, cajón y estilo. Las tres últimas responden a preguntas distintas: <b>el sector dice de qué va</b>, <b>el cajón cuándo la vendes</b> (tu doctrina) y <b>el estilo qué tiene que pasar para que suba</b> — compounder, crecimiento, defensiva, cíclica, valor, renta o especulativa. Las dos últimas se editan en Posiciones. Entre paréntesis, lo que pesa hoy: la diferencia es el giro que estarías dando.</p>
      <div class="grid4" id="tk-graficos">
        <div class="card tk-graf"><div class="head"><h3>Por sector</h3></div><div class="chartbox"><canvas id="tk-g-sector"></canvas></div><div id="tk-l-sector" class="lg"></div></div>
        <div class="card tk-graf"><div class="head"><h3>Por región</h3></div><div class="chartbox"><canvas id="tk-g-region"></canvas></div><div id="tk-l-region" class="lg"></div></div>
        <div class="card tk-graf"><div class="head"><h3>Por cajón</h3></div><div class="chartbox"><canvas id="tk-g-cajon"></canvas></div><div id="tk-l-cajon" class="lg"></div></div>
        <div class="card tk-graf"><div class="head"><h3>Por estilo</h3></div><div class="chartbox"><canvas id="tk-g-estilo"></canvas></div><div id="tk-l-estilo" class="lg"></div></div>
      </div>
    </div>

    <div class="card">
      <div class="head"><h3>Frontera eficiente y portafolio de tangencia</h3><span class="sub" id="tk-fsub"></span></div>
      <p class="muted" style="margin:.2rem 1rem .6rem;font-size:.8rem;max-width:100ch">El mapa de lo posible con los activos que has marcado: cada punto gris es una cartera, la curva es la frontera y la recta es la <b>línea del mercado de capitales</b> desde el tipo sin riesgo. <b>Tangencia y Kelly salen del mismo álgebra</b> —<span class="mono">Σ⁻¹(μ − r·1)</span>— y por eso suelen caer juntos: tangencia lo normaliza a sumar 1, Kelly le aplica tu fracción y tus topes. La distancia entre tu cartera de hoy y esa recta es lo que hay sobre la mesa.</p>
      <div class="chartbox" style="height:340px;padding:.2rem 1rem 0"><canvas id="tk-g-frontera"></canvas></div>
      <div id="tk-fkpis" class="kpis" style="padding:.6rem 1rem 0"></div>
      <div id="tk-fnota" style="padding:.2rem 1rem 0"></div>
      <details style="margin:.6rem 1rem 1rem">
        <summary class="muted" style="cursor:pointer;font-size:.8rem">Qué está afirmando tu cartera de hoy · <span class="gr">μ</span> implícitas</summary>
        <p class="muted" style="font-size:.78rem;margin:.5rem 0 .4rem;max-width:100ch">Optimización inversa: la <span class="gr">μ</span> que haría <b>óptimos los pesos que ya tienes</b>. Es la pregunta del revés, y la única que se sabe contestar: no «¿cuánto rendirá?», sino «<b>¿firmo esto que ya estoy afirmando?</b>». Pulsa «usar» para llevarla a la columna <span class="gr">μ</span> y ajústala desde ahí.</p>
        <div class="tablewrap"><table id="tk-timp"></table></div>
      </details>
    </div>

    <div class="grid2">
      <div class="card pad">
        <h3>Escenario binario</h3>
        <p class="muted" style="font-size:.79rem;margin:.3rem 0 .5rem">Para una apuesta suelta fuera de la cartera: ganas <b>b</b> por unidad con probabilidad <b>p</b> y pierdes la fracción <b>L</b> con 1−p. <span class="mono">f* = p/L − (1−p)/b</span></p>
        <div class="field inline"><label>Probabilidad de acierto (p)</label><input type="number" id="tk-p" step="1" value="${P.esc.p}"><span class="u">%</span></div>
        <div class="field inline"><label>Ganancia neta si acierta (b)</label><input type="number" id="tk-b" step="0.5" value="${P.esc.b}"><span class="u">×</span></div>
        <div class="field inline"><label>Pérdida si falla (L)</label><input type="number" id="tk-L" step="5" value="${P.esc.L}"><span class="u">%</span></div>
        <div class="kpis" id="tk-esc" style="margin-top:.6rem"></div>
        <p class="muted" style="font-size:.73rem;margin:.5rem 0 0">Ojo con el enunciado: «multiplicar por 4» como <i>precio final</i> es ganancia neta 3; como <i>ganancia</i> es 4. La ambigüedad cambia el tamaño por dos, y por eso aquí se pide b explícito.</p>
      </div>
      <div class="card pad" id="tk-avisos"></div>
    </div>

    <div class="card pad" style="font-size:.8rem">
      <h3>Cómo dar los datos para que esto sea lo más preciso posible</h3>
      <p class="muted" style="margin:.4rem 0 .6rem">El modelo es aritmética: su precisión es la de lo que le das. Por orden de cuánto mueve el resultado:</p>
      <div class="note"><b>1 · La probabilidad de deterioro permanente es lo que más pesa.</b> Pasar del 5 % al 10 % puede partir el tamaño por la mitad. No es «la probabilidad de que baje»: es la de un daño sin vuelta atrás. Piensa en sucesos concretos. <b>Nunca la pongas a cero</b>: el cero le dice al modelo que apueste sin límite, y es el único número que puede arruinarte de verdad.</div>
      <div class="note"><b>2 · μ manda veinte veces más que las covarianzas</b> (Chopra-Ziemba). Si vas a afinar algo, afina el retorno esperado. Sácalo de una valoración, no de una intuición, y escríbelo <i>antes</i> de mirar el tamaño que sale.</div>
      <div class="note"><b>3 · Calíbrate contra tu propio historial.</b> De tus diez últimas tesis, ¿cuántas salieron? Si dices 70 % y aciertas 4 de 10, resta 30 puntos a todo lo que escribas. Es el ajuste más barato y el que más gente se salta.</div>
      <div class="note"><b>4 · El caso base casi nunca es cero.</b> Es lo que pasa la mayoría de las veces: «se queda como está» o «rinde como el índice». Poner cero es un sesgo optimista disfrazado de prudencia, porque hace que todo dependa de los extremos.</div>
      <div class="note"><b>5 · Más años de serie mejoran Σ, no μ.</b> Veinte años de historia estiman mejor cómo se mueven juntos los activos; no dicen nada más fiable sobre lo que va a rendir cada uno. Por eso la ventana importa para la matriz y no para la columna μ.</div>
      <div class="note"><b>6 · Sube λ si n/N es bajo.</b> Con pocas observaciones por activo, encoger las correlaciones es lo que evita que el «óptimo» cambie de signo al mover la ventana un mes. Con n/N por debajo de 10, λ 0,7 es más honesto que λ 0,3.</div>
      <div class="note warn"><b>7 · Y lo que ningún ajuste arregla:</b> aquí no hay costes, ni impuestos, ni horquillas, y se supone que puedes rebalancear siempre. En tu cuenta, mover una posición tributa. La distancia que sale en la columna Δ es una distancia, no una orden.</div>
    </div>

    <div class="card pad" style="font-size:.79rem">
      <h3>De dónde sale cada número</h3>
      <p class="muted" style="margin:.4rem 0 0"><b>Precios:</b> cierres diarios de tu base convertidos a euros con el cambio del BCE de ese mismo día. La ventana es la intersección de fechas con precio en <i>todos</i> los marcados: rellenar huecos con el último precio inventa correlación. Se descartan los saltos de más de 7 días.<br>
      <b>μ hist.</b> = media de los log-retornos diarios × 252. Está para que veas <i>por qué no se usa</i> para dimensionar.<br>
      <b>μ tesis</b> = prior CAPM, μᵢ = r + βᵢ × prima. <b>No es una previsión: es el punto de partida que debes sustituir</b> por el retorno esperado de cada tesis a 3-5 años.<br>
      <b>β</b> contra <span class="mono">${referencia().id}</span> (${esc(referencia().nm)}), calculada <b>activo a activo</b> sobre la intersección de ese par: meter el índice en la matriz común hundiría la ventana de todos si su serie es más pobre. <b>Σ</b> = covarianzas diarias × 252, encogidas hacia la diagonal. <b>F* = Σ⁻¹(μ − r·1)</b> por eliminación de Gauss con pivote parcial, sin librerías.<br>
      <b>Kelly de la tesis</b> = versión discreta original (1956): maximiza E[ln(1+f·R)] sobre los desenlaces que escribes en el botón «tesis» de cada fila, resuelto por bisección sobre la derivada. Es el único de los dos que conoce la ruina. <b>El tamaño final es el menor de los dos.</b><br>\n      <b>Supuestos que no se cumplen:</b> sin costes ni impuestos, μ y Σ estacionarios, revisión continua, sin huecos. Rebalancear aquí es gratis; en tu cuenta tributa.</p>
    </div>`;

  // --- eventos ---
  const recal = () => { guardar(); pintar(); };
  const numIn = (id, campo, min, max) => { const el = $('#' + id); if (!el) return; el.onchange = () => { let x = num(el.value); if (min != null) x = Math.max(min, x); if (max != null) x = Math.min(max, x); el.value = x; P[campo] = x; recal(); }; };
  numIn('tk-r', 'r', -1, 20); numIn('tk-prima', 'prima', 0, 25);
  numIn('tk-tope', 'tope', 1, 100); numIn('tk-suelo', 'suelo', 0, 50); numIn('tk-lam', 'lam', 0, 1); numIn('tk-anosmin', 'anosMin', 0, 25);
  const sm = $('#tk-suelomodo'); if (sm) sm.onchange = () => { P.sueloModo = sm.value; recal(); };
  // Cambiar quién entra en el reparto cambia el universo entero, no solo el cálculo: se repinta la
  // pestaña (`render`), no se recalcula sobre las filas viejas (`recal`).
  const dt = $('#tk-dimtodo'); if (dt) dt.onchange = () => { P.dimTodo = dt.checked; P.marcados = null; guardar(); render(); };
  $$('[data-frac]', v).forEach(b => b.onclick = () => { P.c = +b.dataset.frac; $$('[data-frac]', v).forEach(x => x.classList.toggle('on', x === b)); recal(); });
  ['tk-p', 'tk-b', 'tk-L'].forEach(id => { const el = $('#' + id); el.onchange = () => { P.esc = { p: num($('#tk-p').value), b: num($('#tk-b').value), L: num($('#tk-L').value) }; guardar(); pintarEscenario(); }; });
  $('#tk-reset-mu').onclick = () => { P.mu = {}; recal(); };
  const reco = $('#tk-reco'); if (reco) reco.onclick = () => { Object.assign(P, RECOMENDADO); guardar(); render(); };
  $$('[data-col]', v).forEach(b => b.onclick = () => {
    const on = new Set(visibles().filter(c => !c.fijo).map(c => c.k));
    on.has(b.dataset.col) ? on.delete(b.dataset.col) : on.add(b.dataset.col);
    P.cols = COLS.filter(c => !c.fijo && on.has(c.k)).map(c => c.k);
    b.classList.toggle('on', on.has(b.dataset.col));
    // La cabecera se rehace de la misma lista que las celdas, y se vuelve a enganchar el ordenado.
    const t = $('#tk-tabla');
    t.tHead.innerHTML = cabecera();
    delete t.dataset.ord;
    guardar();
    pintar().then(() => hacerOrdenables(v));
  });
  $$('[data-marca]', v).forEach(b => b.onclick = () => {
    const q = b.dataset.marca;
    if (q === 'nada') P.marcados = [];
    else if (q === 'rv') P.marcados = marcadosPorDefecto(U);
    else if (q === 'todo') P.marcados = U.dim.filter(x => x.valor >= VALOR_MIN).map(x => x.id);
    else if (q === 'largo') P.marcados = U.dim.filter(x => x.valor >= VALOR_MIN && (historiaAnos(x.id) ?? 0) >= 8).map(x => x.id);
    recal();
  });

  pintarEscenario();
  pintar();

  // --- pintado ---
  async function pintar() {
    if (cargando) return;
    cargando = true;
    // Los pesos escritos a mano cambian cuánto queda por repartir, así que el capital se rehace aquí
    // y no solo al montar la vista: si no, el reparto seguiría usando el bote de antes.
    K = capital(C, U);
    const mEl = $('#tk-mano-eur'), bEl = $('#tk-baseoptim');
    if (mEl) mEl.textContent = fmtEUR(K.mano, 0);
    if (bEl) bEl.textContent = fmtEUR(K.baseOptim, 0);
    try {
      CALC = await calcular(U, K.baseOptim);
    } catch (e) {
      CALC = { error: 'No se pudieron cargar las series: ' + e.message };
    }
    cargando = false;
    const ids2 = P.marcados || marcadosPorDefecto(U);

    // ventana común
    const vt = $('#tk-ventana');
    if (CALC.error) {
      vt.className = 'note warn';
      vt.innerHTML = `<b>${esc(CALC.error)}</b>`;
    } else {
      const corta = CALC.anos < P.anosMin;
      const cl = CALC.anos >= 8 ? 'pos' : CALC.anos >= 4 ? 'warn' : 'neg';
      // Alarma, no bloqueo: el cálculo se hace igual y se enseña. Solo se dice, en grande, con qué
      // muestra se ha hecho y quién la está recortando, con un clic para arreglarlo.
      vt.className = 'note ' + (corta ? 'bad' : CALC.anos >= 4 ? '' : 'warn');
      const limita = CALC.M.limita || '—';
      const idLimita = (CALC.filas || []).find(f => f.tk === limita || f.id === limita);
      // Dos causas distintas con arreglos distintos: o has marcado algo joven, o la serie diaria
      // profunda no está descargada. Confundirlas haría que desmarcaras posiciones sin que sirviera.
      const porDatos = corta && CALC.perdido > 0.5;   // hay arco pero no hay diario: faltan datos
      const cuerpo = !corta
        ? `<b>${conQ('Ventana común', 'tk_ventana')}: <span class="${cl}">${fmtN(CALC.anos, 1)} ${CALC.anos === 1 ? 'año' : 'años'}</span></b>`
        : `<b class="neg">⚠ Ventana de ${fmtN(CALC.anos, 1)} ${CALC.anos < 2 ? 'año' : 'años'}, por debajo de los ${fmtN(P.anosMin, 0)} que has pedido.</b>
           El cálculo sigue abajo y vale para lo que mide, pero <b>mide un solo régimen de mercado</b>:
           ${CALC.dias} días no contienen un ciclo completo de tipos, ni una recesión, ni un periodo largo de inflación alta.
           Las correlaciones que salen de aquí son las de este régimen, no las de siempre.`;
      vt.innerHTML = cuerpo
        + ` · ${CALC.dias} días con precio en los ${CALC.n} marcados a la vez · ${conQ('n/N = ' + fmtN(CALC.nN, 0), 'tk_nN')}.`
        + (porDatos
            ? ` <b>Y no lo arregla desmarcar nada:</b> hay precios desde ${esc(CALC.M.arranque)}, pero
                <b>${fmtN(CALC.perdido, 1)} años de esa serie son mensuales</b>, no diarios, y un salto de un mes
                no es un retorno diario. Falta descargar el histórico profundo:
                <span class="mono">python3 jobs/fetch_market.py backfill</span> y luego
                <span class="mono">python3 jobs/sync_supabase.py push</span>.`
            : ` La limita <b class="mono">${esc(limita)}</b>, que arranca el ${esc(CALC.M.arranque || '—')}.`
              + (corta && idLimita ? ` <button class="btn sm" id="tk-quitalimita">Desmarcar ${esc(limita)} y recalcular</button>` : ''))
        + ` <span class="muted">Cada activo que marcas recorta la ventana de todos los demás: manda el más joven. La columna «Ventana» dice lo que aporta cada uno antes de marcarlo.</span>`;
      const bq = $('#tk-quitalimita');
      if (bq) bq.onclick = () => {
        const s2 = new Set(P.marcados || marcadosPorDefecto(U));
        s2.delete(idLimita.id); P.marcados = [...s2]; recal();
      };
    }

    // KPIs
    const kp = $('#tk-kpis');
    if (CALC.error) { kp.innerHTML = '<div class="note warn">Sin cálculo.</div>'; $('#tk-mix').innerHTML = ''; }
    else {
      const inv = Math.min(100, Math.max(0, CALC.pol.suma * 100));
      const kpi = (l, val, s, c, k) => `<div class="kpi${k ? ' tip' : ''}"${k ? ` tabindex="0" data-tip="${esc(HELP[k] || '')}"` : ''} style="--kc:${c}"><div class="l">${l}${k ? ' <span class="q">?</span>' : ''}</div><div class="v">${val}</div><div class="s">${s}</div></div>`;
      kp.innerHTML = kpi('Invertido', fmtN(inv, 1) + ' %', fmtK(CALC.pol.suma * K.base), COL.cyan, 'tk_invertido')
        + kpi('En caja', fmtN(Math.max(0, 100 - inv), 1) + ' %', fmtK(Math.max(0, 1 - CALC.pol.suma) * K.base), COL.cash)
        + kpi('σ cartera', fmtN(CALC.g.vol * 100, 1) + ' %', 'anualizada', COL.yellow, 'tk_sigma_cartera')
        + kpi('g(f)', fmtPct(CALC.g.g * 100, 1), 'crecimiento esperado', COL.purple, 'tk_g')
        + kpi('A mano', fmtN(K.base ? K.mano / K.base * 100 : 0, 1) + ' %', fmtK(K.mano) + ' · ' + U.mano.length + ' posiciones', COL.purple, 'tk_mano')
        + kpi('Marcados', String(CALC.n), `de ${U.dim.length + U.cand.length} que sí dimensiona`, COL.blue);
      $('#tk-mix').innerHTML = `<i style="background:${COL.cyan};width:${Math.min(100, inv).toFixed(1)}%"></i><i style="background:${COL.cash};width:${Math.max(0, 100 - inv).toFixed(1)}%"></i>`;
    }

    $('#tk-sub').textContent = CALC.error ? '' :
      `${CALC.n} marcados · fracción ${FRACCIONES.find(f => Math.abs(f.c - P.c) < 1e-9)?.nm || P.c} · λ ${fmtN(P.lam, 2)} · tope ${fmtN(P.tope, 0)} %`;

    // tabla
    const porId = {}; (CALC.filas || []).forEach(f => porId[f.id] = f);
    // Valor ordenable explícito en cada celda numérica: lo que se ve lleva sufijos y una segunda
    // cifra debajo («12,3 %» con «105.234 €»), y ordenar por el texto mezclaría las dos.
    const td = (v, n, c = '') => `<td class="num ${c}"${n == null || !isFinite(n) ? '' : ` data-sort="${n.toFixed(6)}"`}>${v}</td>`;
    const nd = '<span class="muted">—</span>';
    const anosDe = id => {
      const m = DB.diario[id] || DB.prices[id] || DB.bench[id];
      const k = m && Object.keys(m).sort()[0];
      return k ? { a: (Date.now() - new Date(k)) / 31557600000, desde: k.slice(0, 7) } : null;
    };
    // Cada celda se pinta sola, indexada por la misma clave que su cabecera: no hay dos listas que
    // puedan desalinearse.
    const CELDA = {
      mk: (x, f, on) => `<td><input type="checkbox" data-mk="${esc(x.id)}" ${on ? 'checked' : ''}></td>`,
      pos: x => `<td class="tkpos"><b class="mono">${esc(x.tk)}</b>${x.fuente === 'cartera' && x.valor < VALOR_MIN ? ' <span class="badge warn" title="Residuo de un traspaso: no entra en el marcado automático">residuo</span>' : ''}${x.fuente === 'cerrada' ? ' <span class="badge" title="Ya la llevaste y la vendiste entera. Se dimensiona con su propio histórico, el que ya está descargado, no con uno bajado aparte.">ya la llevaste</span>' : ''}
          <button class="btn sm ghost tesis-btn" data-tesis="${esc(x.id)}" title="${tesisDe(x.id) ? 'Editar la tesis' : 'Escribir la tesis: probabilidades y escenarios'}">${tesisDe(x.id) ? '◆ tesis' : '◇ tesis'}</button>
          <span class="sub2">${esc(x.nm)}${x.nota ? ' · <i>' + esc(x.nota) + '</i>' : ''}</span></td>`,
      w0: x => td(x.valor ? fmtN(x.valor / K.base * 100, 1) + ' %' : nd, x.valor ? x.valor / K.base * 100 : null),
      // Si hay tesis escrita, la μ que usa el modelo es la suya, no la del prior ni la escrita a mano.
      // Enseñar aquí otra cifra distinta de la que se está usando sería mentir en la columna que más
      // pesa: se muestra la de la tesis, bloqueada, y se dice de dónde viene.
      mu: (x, f) => {
        if (f && f.muTesis != null) return `<td class="num"><input type="number" class="mu deTesis" readonly
          value="${fmtN(f.muTesis * 100, 1).replace(',', '.')}" data-tesis="${esc(x.id)}"
          title="Viene de la tesis (${esc(f.tesis && f.tesis.actualizada || 'sin fecha')}). Pulsa para editarla; quita la tesis para escribir la μ a mano."></td>`;
        const mu = P.mu[x.id] != null ? P.mu[x.id] : (f ? f.muPrior * 100 : null);
        return `<td class="num"><input type="number" class="mu" step="0.5" data-mu="${esc(x.id)}" value="${mu == null ? '' : fmtN(mu, 1).replace(',', '.')}"></td>`;
      },
      tam: (x, f) => td(f ? `<b>${fmtN(f.w * 100, 1)} %</b><span class="sub2">${fmtEUR(f.tam, 0)}</span>` : '—',
                        f ? f.w * 100 : null, f && f.w > 0 ? 'pos' : 'muted'),
      delta: (x, f) => td(f ? (f.delta > 0 ? '+' : '−') + fmtEUR(Math.abs(f.delta), 0).replace('-', '') : '—',
                          f ? f.delta : null, f ? cls(f.delta) : ''),
      F: (x, f) => td(f ? fmtN(f.F * 100, 1) + ' %' : '—', f ? f.F * 100 : null,
                      f && f.manda === 'continuo' && f.fDisc != null ? 'warn' : 'muted'),
      // Vacío no es «no hay dato»: es «no has escrito la tesis todavía». La celda lo dice y se pulsa
      // para escribirla, que es donde el usuario está mirando cuando se pregunta por qué está en blanco.
      fdisc: (x, f) => td(f && f.fDisc != null ? fmtN(Math.min(f.fDisc * P.c, 9.99) * 100, 1) + ' %'
                            : `<button class="btn sm ghost escribir" data-tesis="${esc(x.id)}" title="Este número no sale de los precios: lo escribes tú. Probabilidad de que la tesis se cumpla, subida si se cumple y probabilidad de deterioro permanente.">escribir</button>`,
                          f && f.fDisc != null ? Math.min(f.fDisc * P.c, 9.99) * 100 : null,
                          f && f.manda === 'tesis' ? 'warn' : 'muted'),
      sigma: (x, f) => td(f ? fmtN(f.sigma * 100, 1) + ' %' : nd, f ? f.sigma * 100 : null),
      peor: (x, f) => td(f ? '−' + fmtN(f.peor * 100, 1) + ' %' : '—', f ? -f.peor * 100 : null,
                         f && f.peor > 0.15 ? 'warn' : 'muted'),
      vent: x => { const a = anosDe(x.id);
        return td(a ? `<span class="${a.a >= 8 ? 'pos' : a.a >= 4 ? 'warn' : 'neg'}">${fmtN(a.a, 1)} a</span><span class="sub2">desde ${a.desde}</span>` : nd, a ? a.a : null); },
      muh: (x, f) => td(f && f.muHist != null ? fmtPct(f.muHist * 100, 0) : '—', f && f.muHist != null ? f.muHist * 100 : null, 'muted'),
      beta: (x, f) => td(f && f.beta != null ? fmtN(f.beta, 2) : nd, f && f.beta != null ? f.beta : null),
      find: (x, f) => td(f ? fmtN(f.fInd * 100, 0) + ' %' : '—', f ? f.fInd * 100 : null, 'muted'),
    };
    // Lo que no cotiza comparte cabecera con el resto: se pinta lo que tiene sentido (peso y valor)
    // y lo demás va vacío. Antes esto era un colspan a mano y bastó mover una columna para
    // descuadrarlo; ahora el número de celdas sale de la misma lista.
    // Filas a mano: ocupan capital pero Kelly no las dimensiona. El tamaño es un campo que se escribe;
    // lo demás va vacío porque calcularlo daría una falsa sensación de que el modelo las ha mirado.
    const CELDA_MANO = {
      mk: () => '<td><span class="muted" title="Fijada a mano: Kelly no la dimensiona">🔒</span></td>',
      pos: x => `<td class="tkpos"><b class="mono">${esc(x.tk)}</b> <span class="badge warn">a mano</span>
          <button class="btn sm ghost" data-auto="${esc(x.id)}" title="Devolverla al cálculo de Kelly">↩ a Kelly</button>
          <span class="sub2">${esc(x.nm)}</span></td>`,
      w0: x => td(fmtN(x.valor / K.base * 100, 1) + ' %', x.valor / K.base * 100),
      tam: x => { const w = pesoMano(x, K.base);
        return `<td class="num"><input type="number" class="mu deTesis" step="0.5" min="0" max="100" data-wman="${esc(x.id)}" value="${fmtN(w, 1).replace(',', '.')}"><span class="sub2">${fmtEUR(w / 100 * K.base, 0)}</span></td>`; },
      delta: x => { const d = pesoMano(x, K.base) / 100 * K.base - x.valor;
        // Mientras no escribas un peso distinto, el tamaño a mano es el que ya tiene: la distancia es
        // cero y enseñar «−0 €» por un redondeo sería ruido.
        return Math.abs(d) < 1 ? td('<span class="muted">—</span>', 0)
          : td((d > 0 ? '+' : '−') + fmtEUR(Math.abs(d), 0).replace('-', ''), d, cls(d)); },
      vent: x => { const a = anosDe(x.id);
        return td(a ? `<span class="muted">${fmtN(a.a, 1)} a</span>` : nd, a ? a.a : null); },
    };
    const CELDA_SIN = {
      mk: () => '<td><input type="checkbox" disabled title="Sin serie de precios: Kelly no puede dimensionarla"></td>',
      pos: x => `<td class="tkpos"><b class="mono">${esc(x.tk)}</b><span class="sub2">${esc(x.nm)} · <i>sin serie de mercado · tasación escalonada · su volatilidad medida saldría casi cero</i></span></td>`,
      w0: x => td(fmtN(x.valor / K.base * 100, 1) + ' %', x.valor / K.base * 100),
      tam: x => td(fmtEUR(x.valor, 0), x.valor, 'muted'),
    };

    const VIS = visibles();
    const linea = (x, extra = '') => {
      const f = porId[x.id], on = ids2.includes(x.id);
      return `<tr class="${on ? '' : 'off'} ${extra}">` + VIS.map(c => CELDA[c.k](x, f, on)).join('') + '</tr>';
    };
    const lineaMano = x => '<tr class="mano">'
      + VIS.map(c => (CELDA_MANO[c.k] || (() => '<td class="num muted">—</td>'))(x)).join('') + '</tr>';
    const lineaSin = x => '<tr class="off nodim">'
      + VIS.map(c => (CELDA_SIN[c.k] || (() => '<td class="num muted">—</td>'))(x)).join('') + '</tr>';
    const sep = t => `<tr class="sep"><td colspan="${VIS.length}"><span class="eyebrow">${t}</span></td></tr>`;

    // Marcadas arriba del todo y ordenadas por el tamaño que pide el modelo; las demás detrás, por
    // valor. Al marcar o desmarcar se repinta con este mismo orden, así que la posición que acabas
    // de meter aparece arriba con su resultado ya calculado.
    const pesoDe = x => (porId[x.id] ? porId[x.id].w : -1);
    const orden = (a, b) => {
      const ma = ids2.includes(a.id), mb = ids2.includes(b.id);
      if (ma !== mb) return ma ? -1 : 1;
      if (ma) return pesoDe(b) - pesoDe(a) || b.valor - a.valor;
      return b.valor - a.valor;
    };
    const dimOrd = [...U.dim].sort(orden);
    const candOrd = [...U.cand].sort(orden);
    $('#tk-filas').innerHTML =
      sep('En cartera · con mercado · ' + dimOrd.filter(x => ids2.includes(x.id)).length + ' marcadas arriba')
      + dimOrd.map(x => linea(x)).join('')
      + (U.mano.length ? sep(`A mano · ${fmtEUR(K.mano, 0)} · fondos y cripto: el tamaño lo escribes tú y Kelly reparte solo el resto`)
                       + [...U.mano].sort((a, b) => b.valor - a.valor).map(lineaMano).join('') : '')
      + (U.cand.length ? sep('Lista de seguimiento · aún no en cartera' + (U.cand.some(x => x.fuente === 'cerrada') ? ' · las que ya llevaste traen su histórico puesto' : '')) + candOrd.map(x => linea(x, 'wl')).join('')
                       : sep('Lista de seguimiento') + `<tr><td colspan="${VIS.length}" class="muted" style="padding:.7rem">Vacía. Añade candidatos en la pestaña <b>Seguimiento</b> para poder dimensionarlos aquí junto a tus posiciones. Vale cualquier símbolo, lo hayas llevado antes o no.</td></tr>`)
      + sep(`Sin mercado · ${fmtEUR(K.sinMercado + K.vivienda, 0)} · Kelly no puede dimensionarlas`)
      + U.sin.map(lineaSin).join('');

    $$('[data-mk]', v).forEach(el => el.onchange = () => {
      const id = el.dataset.mk; const s = new Set(P.marcados || marcadosPorDefecto(U));
      el.checked ? s.add(id) : s.delete(id);
      P.marcados = [...s]; recal();
    });
    $$('[data-wman]', v).forEach(el => el.onchange = () => {
      const id = el.dataset.wman, x = el.value.trim();
      P.wMan = P.wMan || {};
      if (x === '') delete P.wMan[id]; else P.wMan[id] = Math.max(0, Math.min(100, num(x)));
      recal();
    });
    $$('[data-auto]', v).forEach(b => b.onclick = () => {
      const id = b.dataset.auto;
      P.auto = [...new Set([...(P.auto || []), id])];
      P.manual = (P.manual || []).filter(x => x !== id);
      render();
    });
    $$('[data-tesis]', v).forEach(b => b.onclick = () => editarTesis(b.dataset.tesis,
      [...U.dim, ...U.cand].find(x => x.id === b.dataset.tesis)));
    $$('[data-mu]', v).forEach(el => el.onchange = () => {
      const id = el.dataset.mu; const x = el.value.trim();
      if (x === '') delete P.mu[id]; else P.mu[id] = num(x);
      recal();
    });

    // avisos
    const av = $('#tk-avisos');
    const ns = [];
    if (!CALC.error) {
      if (CALC.pol.negativos) ns.push(['', `<b>${CALC.pol.negativos} posiciones salen negativas</b> y se han truncado a cero. Un peso negativo es un corto, que tu política veta. No significa «vender»: significa que con ese μ y esa correlación el modelo no les asigna ventaja propia frente a las demás.`]);
      if (CALC.pol.descartados) ns.push(['', `<b>${CALC.pol.descartados} posiciones quedaban por debajo del suelo del ${fmtN(P.suelo, 1)} %</b> y se han descartado; su dinero se ha repartido entre las demás. Es la forma honesta de decir «solo posiciones con convicción»: <b>menos posiciones, no mínimos mayores</b>. Subirlas hasta el suelo sería apostar de más justo donde el modelo dice que no hay ventaja.`]);
      if (CALC.pol.topados) ns.push(['', `<b>${CALC.pol.topados} posiciones piden más del tope</b> del ${fmtN(P.tope, 0)} % y se han recortado. Ahí manda el tope, no Kelly.`]);
      if (CALC.pol.apalancado) ns.push(['warn', '<b>La suma pasaba del 100 %</b>: Kelly pedía apalancar y se ha reescalado a la baja. Revisa μ antes que el resultado.']);
      if (CALC.nN < 10) ns.push(['warn', `<b>n/N = ${fmtN(CALC.nN, 0)}</b>: pocas observaciones por activo. La inversa de la matriz amplifica el error; sube λ o desmarca los activos jóvenes.`]);
      if (CALC.anos < P.anosMin) ns.push(['warn', `<b>Con ${fmtN(CALC.anos, 1)} años de ventana, μ histórica no significa nada.</b> Un año malo de un valor bueno sale como −40 % anual. Escribe el μ de tu tesis en la columna azul: es para lo que está.`]);
      const fuerte = (CALC.filas || []).filter(f => f.peor > 0.2);
      if (fuerte.length) ns.push(['', `<b>Volatilidad fabricada por un solo día</b> en ${fuerte.map(f => '<span class="mono">' + esc(f.tk) + '</span>').join(', ')}: su peor sesión pasa del 20 %. La σ histórica no acota la cola izquierda (Taleb); mira la columna «peor día» antes de fiarte de σ.`]);
    }
    pintarGraficos();
    pintarFrontera();

    av.innerHTML = `<h3>Lo que esta pantalla no puede decirte</h3>
      <div class="note warn"><b>El error en μ pesa unas 20 veces más que el de las covarianzas</b> (Chopra-Ziemba). Y sobreapostar se castiga mucho más que infraapostar: en f = 2f* el crecimiento esperado es cero. Por eso Kelly completo nunca se presenta como recomendación: es el borde a partir del cual más tamaño reduce el crecimiento.</div>
      <div class="note"><b>Samuelson:</b> maximizar el crecimiento esperado no es lo mismo que maximizar tu utilidad. <b>Taleb:</b> no rechaza Kelly, rechaza calcularlo con media y σ.</div>
      ${ns.map(([c, t]) => `<div class="note ${c}">${t}</div>`).join('')}`;
  }

  // ---------- editor de tesis ----------
  // Aquí es donde el taller deja de ser estadística y pasa a ser juicio. Las instrucciones de cómo
  // estimar bien cada número están dentro del propio formulario, porque es donde hacen falta.
  function editarTesis(id, x) {
    const t = tesisDe(id) || { anos: 3, p: 50, alza: 60, pRuina: 5, perdida: 100, base: 0, salida: '', revisada: hoyISO() };
    const campo = (k, l, v, paso, unidad, ayuda) => `<div class="field inline">
      <label class="tip" tabindex="0" data-tip="${esc(ayuda)}">${l} <span class="q">?</span></label>
      <input type="number" id="ts-${k}" step="${paso}" value="${v}"><span class="u">${unidad}</span></div>`;
    openModal(`<div class="mhead"><h2>Tesis de ${esc(x ? x.tk : id)}</h2><button class="btn ghost" data-close>✕</button></div>
      <p class="muted" style="margin:.2rem 0 .7rem;font-size:.82rem">Kelly nació de esto: una apuesta con desenlaces y probabilidades. La tabla usa la versión continua, que solo sabe de media y volatilidad y <b>no tiene probabilidad de ruina</b>. Aquí le dices los desenlaces de verdad. <b>Se aplicará el menor de los dos tamaños</b>: ningún modelo puede convencerte de algo que el otro rechaza.</p>
      ${campo('anos', 'Horizonte de la tesis', t.anos, 0.5, 'años', 'Qué es: en cuánto tiempo esperas que la tesis se resuelva. Cómo acertar: usa el plazo en el que el catalizador actúa, no el que te gustaría. Si no sabes decirlo, la tesis todavía no está madura. Sirve para anualizar: una subida del 60 % en 2 años no es lo mismo que en 6.')}
      ${campo('p', 'Probabilidad de que se cumpla', t.p, 1, '%', 'Qué es: cuántas veces de cien saldría bien si repitieras esta apuesta. Cómo acertar: parte de la tasa base (¿cuántas empresas en esta situación lo consiguen?) y ajusta desde ahí, no al revés. Huye de 50 %: suele significar «no lo he pensado». Y no uses números redondos si de verdad has hecho el trabajo: 45 o 55 dicen más que 50.')}
      ${campo('alza', 'Subida si se cumple', t.alza, 5, '%', 'Qué es: la revalorización TOTAL en el horizonte, no anual. Cómo acertar: sal de una valoración (múltiplo objetivo por beneficio objetivo), no de una intuición. Si la tesis es «vale el doble», son 100. Descuenta ya el dinero que crees que se diluirá o se gastará.')}
      ${campo('base', 'Caso base (ni se cumple ni se rompe)', t.base, 5, '%', 'Qué es: lo que pasa el resto de las veces, que suele ser lo más probable. Cómo acertar: normalmente no es cero, es «se queda como está más la inflación» o «rinde como el índice». Poner cero aquí es un sesgo optimista disfrazado de prudencia: hace que el resultado dependa solo de los extremos.')}
      ${campo('pRuina', 'Probabilidad de deterioro permanente', t.pRuina, 1, '%', 'Qué es: la probabilidad de un daño sin vuelta atrás: fraude, el regulador la mata, pierde la patente, se queda sin caja y diluye, el sector desaparece. NO es la probabilidad de que baje. Cómo acertar: piensa en sucesos concretos, no en una sensación. Si no se te ocurre ninguno, ponlo bajo (1-3 %) y no cero: el cero le dice al modelo que apueste sin límite. Es el número que más cambia el resultado.')}
      ${campo('perdida', 'Pérdida si se deteriora', t.perdida, 5, '%', 'Qué es: cuánto pierdes en ese caso. Cómo acertar: 100 solo si de verdad puede irse a cero (acción suelta, cripto, un proyecto). Para un fondo diversificado o un índice, un deterioro permanente es más bien 40-60 %, no 100. Poner 100 donde no toca encoge el tamaño sin motivo.')}
      <div class="field" style="margin-top:.6rem"><label class="tip" tabindex="0" data-tip="Qué es: el suceso concreto que te haría cerrar, no un precio. Cómo acertar: escribe algo que se pueda comprobar sin mirar la cotización — «si el margen bruto baja del 70 %», «si pierde el contrato de Google», «si el regulador aprueba la fusión». Para qué sirve: es lo que convierte «aguanto» en una regla. Sin esto, vender acaba dependiendo de cómo te sientas con el precio, y tu propio historial dice que eso corta las ganancias a los tres meses y deja correr las pérdidas dos años.">Cuándo cierro esta posición · <b>suceso, no precio</b> <span class="q">?</span></label>
        <input type="text" id="ts-salida" placeholder="ej.: si el margen cae dos trimestres seguidos, o si el catalizador de FY2028 se retrasa" value="${esc(t.salida || '')}"></div>
      <div class="field inline"><label class="tip" tabindex="0" data-tip="Qué es: la última vez que miraste esta tesis y decidiste que sigue en pie. Qué te dice: el motor de alarmas avisa cuando pasa de un mes, y también cuando el horizonte vence. Revisar no es mirar el precio: es comprobar si el suceso de salida ha ocurrido.">Revisada el <span class="q">?</span></label><input type="date" id="ts-revisada" value="${esc(t.revisada || hoyISO())}"></div>
      <div id="ts-res" class="note" style="margin-top:.7rem"></div>
      <div class="note warn" style="font-size:.78rem"><b>Cómo dar estos números para que el modelo sea preciso.</b>
        <b>1)</b> Calíbrate: de tus diez últimas tesis, ¿cuántas salieron? Si dijiste 70 % y aciertan 4 de 10, resta 30 puntos a todo lo que escribas aquí.
        <b>2)</b> Escríbelos ANTES de mirar el resultado, no después de ver el tamaño que te gustaría.
        <b>3)</b> El error en la probabilidad de ruina pesa mucho más que el de la subida: pasar del 5 % al 10 % puede partir el tamaño por la mitad.
        <b>4)</b> Fecha la tesis y revísala cuando el catalizador se resuelva, no cuando el precio se mueva.</div>
      <div class="toolbar" style="justify-content:space-between;margin-top:.8rem">
        <button class="btn ghost" id="ts-del"${tesisDe(id) ? '' : ' disabled'}>Quitar la tesis</button>
        <span><button class="btn" data-close>Cancelar</button> <button class="btn primary" id="ts-ok">Guardar</button></span></div>`);

    const leer = () => ({ anos: num($('#ts-anos').value), p: num($('#ts-p').value), alza: num($('#ts-alza').value),
                          base: num($('#ts-base').value), pRuina: num($('#ts-pRuina').value), perdida: num($('#ts-perdida').value),
                          salida: $('#ts-salida').value.trim(), revisada: $('#ts-revisada').value || hoyISO() });
    const repinta = () => {
      const T = tesisAEscenarios(leer());
      const el = $('#ts-res');
      if (T.error) { el.className = 'note bad'; el.innerHTML = `<b>${esc(T.error)}</b>`; return; }
      const pb = 1 - (num($('#ts-p').value) + num($('#ts-pRuina').value)) / 100;
      el.className = 'note';
      el.innerHTML = `Escenarios: ${T.esc.map(e => `<b>${fmtN(e.p * 100, 0)} %</b> ${esc(e.nm)} ${fmtPct(e.r * 100, 0)}`).join(' · ')}
        <br>Retorno esperado del horizonte <b>${fmtPct(T.totalEsperado * 100, 1)}</b> → <b class="${T.muAnual > 0 ? 'pos' : 'neg'}">${T.muAnual == null ? 'sin sentido: la esperanza es una pérdida total' : fmtPct(T.muAnual * 100, 1) + ' anual'}</b>
        <br>Kelly de esta tesis: <b>${T.f == null ? '—' : !isFinite(T.f) ? 'sin límite (no has puesto ninguna pérdida posible)' : fmtN(T.f * 100, 1) + ' %'}</b>${T.f > 0 && isFinite(T.f) ? ` · con tu fracción ${FRACCIONES.find(f => Math.abs(f.c - P.c) < 1e-9)?.nm || P.c}: <b>${fmtN(T.f * P.c * 100, 1)} %</b>` : ''}
        ${pb < 0.15 && pb >= 0 ? '<br><span class="warn">Dejas menos del 15 % al caso base: estás diciendo que esto se resuelve casi seguro en un extremo o en el otro. ¿De verdad?</span>' : ''}`;
    };
    ['anos', 'p', 'alza', 'base', 'pRuina', 'perdida'].forEach(k => { $('#ts-' + k).oninput = repinta; });
    repinta();
    $('#ts-ok').onclick = async () => { try { await guardarTesis(id, leer()); closeModal(); pintar(); toast('Tesis guardada'); } catch (e) { toast('No se pudo guardar: ' + e.message); } };
    $('#ts-del').onclick = async () => { try { await guardarTesis(id, null); closeModal(); pintar(); toast('Tesis quitada'); } catch (e) { toast('No se pudo quitar: ' + e.message); } };
  }

  // Composición de la cartera propuesta. Se dibuja con los mismos ayudantes que Distribución para que
  // se lea igual; entre paréntesis va el peso de hoy, que es la referencia contra la que se compara.
  // Solo entran las posiciones que Kelly dimensiona: lo fijado a mano tiene su propia sección.
  function pintarGraficos() {
    const filas = (CALC && CALC.filas) || [];
    const hoy = new Map(), prop = new Map();
    const meta = id => (DB.positions || []).find(p => p.id === id) || {};
    const DIMS = {
      sector: { nodo: 'sector', clave: p => p.sector || 'Sin clasificar' },
      region: { nodo: 'region', clave: p => p.region || 'Sin región' },
      cajon:  { nodo: 'cajon',  clave: p => (p.drawer ? (DRAWERS[p.drawer] || p.drawer) : 'Sin cajón') },
      estilo: { nodo: 'estilo', clave: p => ESTILOS[p.estilo || ''] || 'Sin estilo',
                color: k => ESTILO_COLOR[Object.keys(ESTILOS).find(x => ESTILOS[x] === k) ?? ''] },
    };
    for (const [nm, D] of Object.entries(DIMS)) {
      const pr = new Map(), hy = new Map();
      for (const f of filas) {
        const k = D.clave(meta(f.id));
        if (f.tam > 0) pr.set(k, (pr.get(k) || 0) + f.tam);
        if (f.valor > 0) hy.set(k, (hy.get(k) || 0) + f.valor);
      }
      const totalP = [...pr.values()].reduce((s, x) => s + x, 0) || 1;
      const totalH = [...hy.values()].reduce((s, x) => s + x, 0) || 1;
      const claves = [...new Set([...pr.keys(), ...hy.keys()])].sort((a, b) => (pr.get(b) || 0) - (pr.get(a) || 0));
      const items = claves.map((k, i) => ({ label: k, v: pr.get(k) || 0, color: PALETTE[i % PALETTE.length],
                                            hoy: (hy.get(k) || 0) / totalH * 100 }))
        .filter(x => x.v > 0 || x.hoy > 0);
      // Leyenda propia en vez de la de Distribución: aquí lo que importa es comparar dos columnas
      // (lo que pesa hoy y lo que propone el modelo), y meter ambas en una etiqueta la parte en tres líneas.
      const el = $('#tk-l-' + nm);
      if (el) el.innerHTML = `<div class="legend2"><div class="cab"><span></span><span>hoy</span><span>propuesto</span><span></span></div>`
        + items.map(x => {
            const w = x.v / totalP * 100, dif = w - x.hoy;
            return `<div><i style="background:${x.color}"></i><span class="lb">${esc(x.label)}</span>`
              + `<span class="hoy">${fmtN(x.hoy, 1)} %</span><span class="pro">${fmtN(w, 1)} %</span>`
              + `<span class="${Math.abs(dif) < 0.5 ? 'muted' : dif > 0 ? 'pos' : 'neg'}">${dif > 0 ? '+' : '−'}${fmtN(Math.abs(dif), 1)}</span></div>`;
          }).join('') + '</div>';
      const conPeso = items.filter(x => x.v > 0);
      if (conPeso.length) donut('tk-g-' + nm, conPeso);
    }
    const sub = $('#tk-mixsub');
    if (sub) sub.textContent = filas.filter(f => f.tam > 0).length + ' posiciones con tamaño · ' + fmtEUR(filas.reduce((s, f) => s + (f.tam > 0 ? f.tam : 0), 0), 0);
  }

  // La frontera se dibuja con la misma Σ, μ y r que han dimensionado, así que sus σ NO son las
  // observadas: son las del modelo encogido (λ). Se dice en la nota para que la diferencia con
  // cualquier σ medida en otra pantalla no parezca un fallo.
  function pintarFrontera() {
    const F = CALC && CALC.frontera;
    const sub = $('#tk-fsub'), kp = $('#tk-fkpis'), nota = $('#tk-fnota'), tb = $('#tk-timp');
    if (!F || !F.curva || !F.tangencia) {
      if (sub) sub.textContent = '';
      if (kp) kp.innerHTML = '';
      if (nota) nota.innerHTML = '<div class="note warn">No se puede dibujar la frontera con estos activos: la matriz no se deja invertir o los excesos se cancelan. Desmarca alguno o sube λ.</div>';
      if (tb) tb.innerHTML = '';
      chart('tk-g-frontera', { type: 'scatter', data: { datasets: [] } });
      return;
    }
    const r = CALC.r, pct = x => x * 100;
    const sharpe = q => (q && q.sigma > 0 ? (q.mu - r) / q.sigma : null);
    // La hipérbola se dispara a σ enormes en sus extremos y arrastraba el eje hasta el 45 %, dejando
    // los tres puntos que importan aplastados en el tercio izquierdo. Se acota el eje a lo que se
    // quiere leer y se recorta la curva a ese marco; lo de fuera no es información, es escala perdida.
    const maxX = Math.max(F.tangencia.sigma, F.kelly.sigma, F.hoy ? F.hoy.sigma : 0) * 1.8;
    const pend = (F.tangencia.mu - r) / F.tangencia.sigma;
    const curva = F.curva.filter(q => q.sigma <= maxX);
    const punto = (q, label, color, style, radio) => ({
      label, data: [{ x: pct(q.sigma), y: pct(q.mu) }], backgroundColor: color,
      pointRadius: radio, pointHoverRadius: radio + 2, pointStyle: style, order: 1 });

    chart('tk-g-frontera', {
      type: 'scatter',
      data: { datasets: [
        { label: 'Frontera', type: 'line', showLine: true, pointRadius: 0, borderWidth: 1.4,
          borderColor: COL.blue3, order: 5,
          data: curva.map(q => ({ x: pct(q.sigma), y: pct(q.mu) })) },
        { label: 'Línea del mercado de capitales', type: 'line', showLine: true, pointRadius: 0,
          borderWidth: 1.4, borderDash: [6, 4], borderColor: COL.cyan, order: 4,
          data: [{ x: 0, y: pct(r) }, { x: pct(maxX), y: pct(r + pend * maxX) }] },
        punto(F.tangencia, 'Tangencia · máximo Sharpe', COL.cyan, 'triangle', 8),
        punto(CALC.frontera.kelly, 'Kelly con tu política', COL.yellow, 'rectRot', 7),
        ...(F.hoy ? [punto(F.hoy, 'Tu cartera hoy', COL.red, 'circle', 8)] : []),
        { label: 'Sin riesgo (r)', data: [{ x: 0, y: pct(r) }], backgroundColor: COL.cash,
          pointRadius: 5, pointStyle: 'circle', order: 1 },
      ] },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { labels: { usePointStyle: true } },
          tooltip: { callbacks: { label: it => `${it.dataset.label}: σ ${fmtN(it.parsed.x, 1)} % · μ ${fmtN(it.parsed.y, 1)} %` } } },
        scales: {
          x: { min: 0, max: pct(maxX), title: { display: true, text: 'riesgo · volatilidad anual del modelo' }, ticks: { callback: pctTick }, grid },
          y: { title: { display: true, text: 'retorno esperado (μ)' }, ticks: { callback: pctTick }, grid },
        },
      },
    });

    if (sub) sub.textContent = `${F.ids.length} activos marcados · λ ${fmtN(P.lam, 2)} · r ${fmtN(P.r, 2)} %`;
    const kpi = (l, v, sb, c) => `<div class="kpi" style="--kc:${c}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${sb}</div></div>`;
    const sH = sharpe(F.hoy), sT = sharpe(F.tangencia), sK = sharpe(CALC.frontera.kelly);
    if (kp) kp.innerHTML =
        (F.hoy ? kpi('Tu cartera hoy', sH == null ? '—' : fmtN(sH, 2), `σ ${fmtN(pct(F.hoy.sigma), 1)} % · μ ${fmtN(pct(F.hoy.mu), 1)} %`, COL.red) : '')
      + kpi('Tangencia', sT == null ? '—' : fmtN(sT, 2), `σ ${fmtN(pct(F.tangencia.sigma), 1)} % · μ ${fmtN(pct(F.tangencia.mu), 1)} %`, COL.cyan)
      + kpi('Kelly con tu política', sK == null ? '—' : fmtN(sK, 2), `σ ${fmtN(pct(CALC.frontera.kelly.sigma), 1)} % · μ ${fmtN(pct(CALC.frontera.kelly.mu), 1)} %`, COL.yellow)
      + kpi('Sin riesgo', fmtN(P.r, 2) + ' %', 'parámetro r', COL.cash);

    // El aviso que de verdad importa: si μ no la has escrito tú, este gráfico solo sabe decir
    // «compra beta», porque el prior CAPM hace μ proporcional a β por construcción.
    const escritas = F.ids.filter(id => P.mu[id] != null || tesisDe(id)).length;
    if (nota) nota.innerHTML = escritas === 0
      ? `<div class="note bad"><b>Ninguna <span class="gr">μ</span> es tuya todavía, así que este gráfico aún no dice nada.</b> Con el prior CAPM, <span class="mono">μᵢ = r + βᵢ × prima</span> es proporcional a la beta por construcción: el «óptimo» es, mecánicamente, una apuesta por las betas altas. Abre las <span class="gr">μ</span> implícitas de aquí abajo y firma o corrige una por una.</div>`
      : escritas < F.ids.length
      ? `<div class="note warn"><b>${escritas} de ${F.ids.length} <span class="gr">μ</span> son tuyas.</b> Las demás siguen con el prior CAPM, que es proporcional a la beta. Mientras queden, el óptimo está medio dictado por β y no por tus tesis.</div>`
      : `<div class="note"><b>Las ${F.ids.length} <span class="gr">μ</span> son tuyas.</b> Ahora la frontera dice algo: es tu juicio pasado por la matriz de covarianzas, no una regresión contra el índice.</div>`;

    // Tabla de μ implícitas
    if (tb && F.implicitas) {
      const orden = F.ids.map((id, k) => ({ id, tk: F.tks[k], w: F.wHoy ? F.wHoy[k] : 0, mi: F.implicitas[id] }))
        .filter(x => x.w > 0).sort((a, b) => b.w - a.w);
      const fila = CALC.filas;
      tb.innerHTML = `<thead><tr><th>Valor</th><th class="num">Peso hoy</th><th class="num">Tu cartera afirma</th><th class="num">μ en uso</th><th></th></tr></thead><tbody>`
        + orden.map(x => {
            const f = fila.find(y => y.id === x.id);
            const enUso = f ? f.mu : null;
            const mia = P.mu[x.id] != null || tesisDe(x.id);
            const dif = enUso == null ? null : x.mi - enUso;
            return `<tr><td>${esc(x.tk)}</td><td class="num">${fmtN(x.w * 100, 1)} %</td>`
              + `<td class="num" style="font-weight:600">${fmtN(x.mi * 100, 1)} %</td>`
              + `<td class="num ${mia ? '' : 'muted'}">${enUso == null ? '—' : fmtN(enUso * 100, 1) + ' %'}`
              + `${mia ? '' : ' <span class="sub2">prior</span>'}</td>`
              + `<td class="num"><button class="btn sm" data-usarmu="${esc(x.id)}" data-v="${(x.mi * 100).toFixed(1)}"`
              + `${dif != null && Math.abs(dif) < 0.0005 ? ' disabled' : ''}>usar</button></td></tr>`;
          }).join('')
        + `</tbody>`;
      $$('[data-usarmu]', tb).forEach(b => b.onclick = () => {
        P.mu[b.dataset.usarmu] = num(b.dataset.v);
        toast(`μ de ${b.closest('tr').firstElementChild.textContent} fijada en ${b.dataset.v.replace('.', ',')} %`);
        recal();
      });
    }
  }

  function pintarEscenario() {
    const p = num($('#tk-p').value) / 100, b = num($('#tk-b').value), L = num($('#tk-L').value) / 100;
    const f = kellyBinario(p, b, L);
    const kpi = (l, val, s, c) => `<div class="kpi" style="--kc:${c}"><div class="l">${l}</div><div class="v">${val}</div><div class="s">${s}</div></div>`;
    $('#tk-esc').innerHTML = f == null ? '<div class="note warn">Revisa b y L: tienen que ser mayores que cero.</div>'
      : kpi('Kelly completo', fmtN(Math.max(0, f) * 100, 1) + ' %', f < 0 ? 'sin ventaja: no apostar' : 'techo teórico', COL.cyan)
      + kpi('Con tu fracción', fmtN(Math.max(0, f) * P.c * 100, 1) + ' %', 'lo que usarías', COL.cash)
      + kpi('Tope de política', '1,5 %', '§3 riesgo por operación', COL.red);
  }
}
