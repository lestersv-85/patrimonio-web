// Taller de dimensionamiento por el criterio de Kelly.
//
// Apoyo a la decisión, no órdenes: los topes escritos de la política mandan. Kelly da el tamaño
// óptimo cuando conoces la distribución de resultados; no la conoces, la estimas, y por eso aquí
// la fracción por defecto es la mitad, Σ va encogida y la columna μ está para que la escribas tú.
import { DB, cargarDiario, saveSettings, refreshSettings } from '../store.js?v=3bf8a9f';
import { $, $$, esc, fmtEUR, fmtK, fmtN, fmtPct, fmtDate, cls, num, toast, C as COL, TYPES, HELP } from '../util.js?v=3bf8a9f';

// Ayuda al pasar el cursor, con el mismo patrón que el resto de la app
// Un elemento no puede llevar dos atributos class: el navegador se queda con el primero y el segundo
// se pierde. Si el sitio donde se pone la ayuda ya tiene clase, va aquí como `extra` y no aparte, o la
// burbuja no se pinta (le pasaba a «Sin mercado», que llevaba class="muted").
const ay = (k, extra = '') => ` class="tip${extra ? ' ' + extra : ''}" tabindex="0" data-tip="${esc(HELP[k] || '')}"`;
const conQ = (t, k) => `<span${ay(k)}>${t} <span class="q">?</span></span>`;
import { inSelPos, isInvest, defaultBucket, cerradasConMercado, simbolosEnCartera, fxAt } from '../engine.js?v=3bf8a9f';
import { matriz, estadisticos, encoger, betaPareja, kellyIndividual, kellyMulti, aplicarPolitica,
         crecimiento, kellyBinario, kellyDiscreto, tesisAEscenarios, FRACCIONES, MIN_DIAS,
         tangencia, fronteraEficiente, implicitas, puntoRiesgoRetorno, maxSharpeLargo,
         contribucionRiesgo, porQueNoHayTangencia } from '../kelly.js?v=3bf8a9f';
import { targets, ORO_IDS, esEstable } from '../recommend.js?v=3bf8a9f';
import { openModal, closeModal } from '../forms.js?v=3bf8a9f';
import { donut, legendHTML, chart, pctTick, grid } from '../charts.js?v=3bf8a9f';
import { DRAWERS, PALETTE, ESTILOS, ESTILO_COLOR } from '../util.js?v=3bf8a9f';
import { hacerOrdenables } from '../sortable.js?v=3bf8a9f';

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
// ---------- dividendo cobrado: la mitad de μ que faltaba ----------
// La tesis que se escribe en cada ficha es de PRECIO: «sube un 40 % en tres años». Usarla como μ
// mide media rentabilidad. En esta cartera la diferencia no es un matiz: hay nombres cuya tesis de
// precio es negativa y que, con el dividendo, rinden. Aquí se suma lo que la posición ha pagado de
// verdad en los últimos doce meses, **por título y en euros**, leído de la tabla de dividendos.
//
// Por título y no en total porque el número de participaciones cambia a lo largo del año: dividir el
// dinero cobrado entre el valor de hoy daría un rendimiento falso en cuanto se compre o se venda.
// Se usa el BRUTO, no el neto: la retención es un impuesto, no una propiedad del activo, y el resto
// de la pantalla razona antes de impuestos.
const HOY_MS = () => Date.now();
function dividendoTTM(id) {
  const desde = new Date(HOY_MS() - 365 * 86400000).toISOString().slice(0, 10);
  let porTitulo = 0, n = 0, ultimo = null;
  for (const d of DB.dividends || []) {
    if (d.position_id !== id || !d.date || d.date < desde) continue;
    const gps = num(d.gross_per_share) || (num(d.shares) > 0 ? num(d.gross) / num(d.shares) : 0);
    if (!gps) continue;
    porTitulo += gps * (d.fx || fxAt(d.currency || 'EUR', d.date));
    n++;
    if (!ultimo || d.date > ultimo) ultimo = d.date;
  }
  return { porTitulo, n, ultimo };
}
// Rendimiento por dividendo: euros cobrados por título entre el precio de hoy, también en euros.
function rentaTTM(id, mapa, ccy) {
  const D = dividendoTTM(id);
  if (!D.n || !mapa) return { ...D, y: null };
  const k = Object.keys(mapa).sort(); if (!k.length) return { ...D, y: null };
  const f = k[k.length - 1], precio = num(mapa[f]) * fxAt(ccy, f);
  return { ...D, y: precio > 0 ? D.porTitulo / precio : null, precioEUR: precio, fecha: f };
}

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
  { k: 'div',   th: 'Dividendo',   ayuda: 'tk_div', num: true, ver: true },
  { k: 'marg',  th: 'Margen',       ayuda: 'tk_margen', num: true, ver: true },
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

// Cuánto ha caído un valor desde su máximo histórico, en porcentaje. Es la magnitud contra la que se
// contrasta el alza de las tesis (ver la nota de «tu alza mide la caída»).
function caidaDesdeMaximo(mapa) {
  if (!mapa) return null;
  const k = Object.keys(mapa).sort(); if (k.length < 2) return null;
  let max = 0; for (const d of k) { const v = +mapa[d]; if (v > max) max = v; }
  const ult = +mapa[k[k.length - 1]];
  return max > 0 && ult > 0 ? (1 - ult / max) * 100 : null;
}

// ---------- cartera objetivo por cajones ----------
//
// Esto contesta una pregunta distinta de la de Kelly. Kelly dice *cuánto* apostar; aquí el cuánto
// ya está decidido por la doctrina —cubo 1, cubo 2, cubo 3— y lo que se optimiza es *quién ocupa
// cada plaza dentro de su cajón*. El presupuesto del cajón NO sale del optimizador: sale de la
// política escrita en Ajustes. El optimizador solo reparte dentro.
//
// Dos decisiones del usuario que conviene no confundir nunca:
//  · el número de plazas está fijado de antemano (8 acciones, 2 índices, 1+1+1+1);
//  · dentro del cajón de acciones los pesos son DISTINTOS, y por eso se usa suelo y no tope. El
//    óptimo libre deja varias a cero y te quedas con menos nombres de los que has pedido; un tope
//    plano hace lo contrario y saca media docena pegadas al tope. El suelo es la forma de decir
//    «estas ocho, todas con algo, y que el modelo decida cuánto a cada una».
const OBJ_DEF = { nAcc: 8, nIx: 2, sueloAcc: 5, pctIx: 25, rCaja: 2.5, muBonos: null };
const obj = () => ({ ...OBJ_DEF, ...(P.objetivo || {}) });

// Los cajones que no son acciones se miden con el VEHÍCULO DE REFERENCIA de la doctrina, no con el
// fondo concreto que se tenga hoy. Dos razones: la comparación tiene que ser contra el índice, y
// los fondos de gestión que hay hoy en cartera llevan meses de serie mientras estos llevan años.
const PROXY = {
  world: { id: 'IE00B4L5Y983', nm: 'Índice mundial', det: 'iShares Core MSCI World, cierres diarios en EUR desde 2009', ccy: 'EUR' },
  em:    { id: 'IE00BKM4GZ66', nm: 'Índice emergentes', det: 'iShares Core MSCI EM IMI, cierres diarios en EUR desde 2014', ccy: 'EUR' },
  oro:   { id: 'DE000A0S9GB0', nm: 'Oro físico', det: 'Xetra-Gold, cierres diarios en EUR desde 2015', ccy: 'EUR' },
  btc:   { id: 'BTC', nm: 'Bitcóin', det: 'BTC-EUR, cierres diarios desde 2014', ccy: 'EUR' },
  // **Vehículo real, no proxy.** Hasta el 18 sep 2026 esta pata se medía con `EUNH.DE`, cuya serie
  // en la base es MENSUAL, así que no cabía en la matriz semanal: los bonos entraban con ρ = 0 con
  // todo lo demás y se avisaba de que la σ del conjunto salía optimista. Ese mismo día se bajó de FT
  // la serie diaria del fondo elegido y el supuesto se pudo medir. **Salió lo contrario de lo que
  // el supuesto insinuaba**: ρ con el índice mundial +0,2582 sobre 263 semanas (sep 2021 a sep
  // 2026), no cero. La deuda pública euro de este tramo se movió CON la bolsa, no contra ella, que
  // es lo que pasa cuando el régimen lo manda la inflación y no el ciclo.
  bonos: { id: 'IE0007472990', nm: 'Deuda pública euro', det: 'Vanguard Euro Government Bond Index, cierres diarios en EUR (FT)', ccy: 'EUR' },
};
// La caja NO entra en la matriz. Su vehículo es un monetario: σ ~0 y, sobre todo, su serie arranca
// en feb 2022 y la ventana común la fija el más joven. Perder ocho meses de historia en doce activos
// para medir un cero es un mal negocio. Su retorno es el parámetro que escribes, no una medición.
const CAJA_VEHICULO = { id: 'FR0013314234', nm: 'Groupama Trésorerie NC', det: 'FCP monetario euro, acumulación, 0,14 % de gastos' };
const PROXY_IDS = Object.values(PROXY).map(x => x.id);

// En qué cajón cuenta HOY cada cosa que se tiene. Es la clasificación que usa la columna «hoy»; si
// algo está mal colocado se arregla en Posiciones (cajón y estilo), no aquí.
function cajonDe(p) {
  if (!p) return null;
  if (ORO_IDS.includes(p.id) || ORO_IDS.includes(p.ticker)) return 'oro';
  if (p.ticker === 'BTC') return 'btc';
  if (p.estilo === 'rentafija') return 'bonos';
  if (p.type === 'cash' || esEstable(p)) return 'caja';
  if (p.drawer === 'indice' || p.estilo === 'rvindexada') return 'indices';
  const b = defaultBucket(p);
  if (b === 1) return p.type === 'stock' ? 'acciones' : 'indices';   // fondos y ETF de RV
  if (b === 2) return 'btc';            // el resto de cripto cuenta en la plaza de bitcóin
  if (b === 3) return 'caja';
  return null;                          // cubo 4: no rebalancea, fuera del reparto
}

// ---------- cálculo ----------
async function calcular(U, base, C, baseTotal) {
  if (!(base > 0)) return { error: 'Los pesos escritos a mano se comen toda la base: no queda capital que repartir.' };
  const ids = P.marcados || marcadosPorDefecto(U);
  const sel = [...U.dim, ...U.cand].filter(x => ids.includes(x.id));
  // Los marcados se guardan por id y sobreviven a que la posición desaparezca de la cartera o de la
  // lista de seguimiento. Hasta ahora se caían por el hueco sin decir nada, así que el taller
  // calculaba con menos activos de los que la pantalla enseñaba marcados. Se dicen por su nombre.
  const inexistentes = ids.filter(id => !sel.some(x => x.id === id));
  if (sel.length < 2) return { error: 'Marca al menos dos activos para que haya covarianza que estimar.', inexistentes };

  const REF = referencia();
  // Se acota la descarga: el taller nunca mira más atrás que su ventana, y tras el backfill hay
  // posiciones con veinte años de diario (PGR arranca en 1980). Se pide la ventana pedida más diez
  // años de holgura, que es de sobra para la intersección y para las betas por pares.
  const desde = (() => { const d = new Date(); d.setFullYear(d.getFullYear() - (Math.max(num(P.anosMin), 0) + 10)); return d.toISOString().slice(0, 10); })();
  // Las series de los vehículos de referencia se piden en la MISMA llamada: son cuatro símbolos más
  // y evitan una segunda ronda de peticiones cuando se calcula la cartera objetivo.
  await cargarDiario([...sel.map(x => x.id), REF.id, ...PROXY_IDS], desde);
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
  const RT = act.map(a => rentaTTM(a.id, a.mapa, a.ccy));
  const mu = act.map((a, k) => {
    // **La tesis es de PRECIO y μ tiene que ser retorno TOTAL.** Los escenarios que se escriben en
    // la ficha («sube un 40 % en tres años») no incluyen el dividendo, así que usarlos tal cual mide
    // media rentabilidad. Se le suma lo cobrado en los últimos doce meses por título. Con esto,
    // nombres cuya tesis de precio queda por debajo del tipo sin riesgo pasan a estar por encima,
    // que es exactamente la razón por la que antes no había cartera de tangencia.
    if (TS[k] && TS[k].muAnual != null) return TS[k].muAnual + (RT[k].y || 0);
    // Una μ escrita a mano ya es retorno total —así la devuelve la tabla de μ implícitas— y el prior
    // CAPM también lo es por construcción. A ninguna de las dos se le suma nada: sería contar doble.
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
    tesis: TS[k] ? TS[k].t : null, muTesis: TS[k] ? TS[k].muAnual : null, caidaMax: caidaDesdeMaximo(a.mapa),
    divY: RT[k].y, divN: RT[k].n, divUlt: RT[k].ultimo,
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
  const sinTangencia = tan ? null : porQueNoHayTangencia(mu, covEnc, r);
  const imp = wHoy ? implicitas(wHoy, covEnc, r, P.prima / 100) : null;
  const frontera = {
    curva: fronteraEficiente(mu, covEnc, 60),
    tangencia: tan ? { ...puntoRiesgoRetorno(tan, mu, covEnc), w: tan } : null,
    kelly: puntoRiesgoRetorno(pol.w, mu, covEnc),
    hoy: wHoy ? puntoRiesgoRetorno(wHoy, mu, covEnc) : null,
    // La μ implícita se devuelve por id para que la tabla no dependa del orden de `act`.
    implicitas: imp ? Object.fromEntries(act.map((a, k) => [a.id, imp.mu[k]])) : null,
    delta: imp ? imp.delta : null,
    ids: act.map(a => a.id), tks: act.map(a => a.tk), wHoy, sinTangencia,
    muMedia: mu.reduce((a, b) => a + b, 0) / mu.length,
    bajoR: mu.filter(m => m < r).length,
  };

  // ---- Cartera objetivo por cajones ----
  const objetivo = carteraObjetivo(act, mu, r, baseTotal || base, C);
  if (objetivo && objetivo.punto) frontera.objetivo = objetivo.punto;

  return { filas, M, pol, g, r, base, anos, perdido, frontera, objetivo, inexist: inexistentes, conTesis: TS.filter(Boolean).length, dias: M.R[0].length, n: act.length, nN: M.R[0].length / act.length };
}

// El reparto por cajones. Se calcula sobre la MISMA selección de activos marcados —las acciones
// candidatas son las marcadas que son acciones— y con las mismas μ, pero con la matriz medida en
// SEMANAL, no en diario: el desfase horario entre plazas hunde la correlación diaria y el
// optimizador se cree diversificado cuando no lo está (ver `matriz` en kelly.js).
function carteraObjetivo(act, mu, r, base, C) {
  const O = obj(), T = targets();
  const pcOro = num(T.oro_base), pcBtc = num(T.btc_base), pcBon = num(T.bonos_base), pcCaja = num(T.caja_base);
  const pcRV = 100 - pcOro - pcBtc - pcBon - pcCaja;
  if (!(pcRV > 0)) return { error: 'Los objetivos de oro, bitcóin, bonos y caja de Ajustes ya suman el 100 %: no queda cajón de renta variable que repartir.' };
  const pcIx = Math.min(Math.max(0, num(O.pctIx)), pcRV);
  const pcAcc = pcRV - pcIx;

  // Candidatas del cajón de acciones: las marcadas que son acciones. La lista se gobierna con los
  // mismos botones de marcado de la tabla de arriba, para que no haya dos selecciones distintas.
  const cand = act.map((a, k) => ({ ...a, mu: mu[k] })).filter(a => a.tipo === 'stock');
  const px = k => ({ ...PROXY[k], mapa: DB.diario[PROXY[k].id] || DB.prices[PROXY[k].id] || DB.bench[PROXY[k].id] || null });
  const pW = px('world'), pE = px('em'), pO = px('oro'), pB = px('btc'), pF = px('bonos');
  const enMatriz = [...cand.map(a => ({ id: a.id, label: a.tk, ccy: a.ccy, mapa: a.mapa, tk: a.tk, nm: a.nm, mu: a.mu, clase: 'acciones' })),
    ...[[pW, 'indices'], [pE, 'indices'], [pO, 'oro'], [pB, 'btc'], [pF, 'bonos']]
      .map(([x, clase]) => ({ id: x.id, label: x.nm, ccy: x.ccy, mapa: x.mapa, tk: x.nm, nm: x.det, clase, proxy: true }))];

  const MS = matriz(enMatriz.filter(x => x.mapa), undefined, undefined, 'semana');
  if (!MS.R.length || MS.R[0].length < 52)
    return { error: `Solo hay ${MS.R[0] ? MS.R[0].length : 0} semanas con precio en todas a la vez; hacen falta 52. Desmarca la posición más joven.` };
  const SEM = 52;
  const E = estadisticos(MS.R, SEM);
  const covS = encoger(E.cov, P.lam);
  const A = MS.activos;                          // las que han sobrevivido, en su orden
  const iW = A.findIndex(x => x.id === PROXY.world.id);

  // μ de los vehículos de referencia: el mismo prior CAPM del taller, con la beta medida EN ESTA
  // matriz semanal contra el índice mundial y sobre la matriz CRUDA, no la encogida (encogerla
  // encogería también la beta). Si has escrito una μ a mano para uno de ellos, manda la tuya.
  const betaW = i => (iW >= 0 && E.cov[iW][iW] ? E.cov[i][iW] / E.cov[iW][iW] : null);
  // La μ de los bonos NO sale del prior CAPM ni de su historia: es la TIR del fondo, un dato que este
  // sistema no tiene, así que es el parámetro que se escribe arriba (por defecto, el tipo sin riesgo).
  // Su historia en esta ventana es NEGATIVA —el hundimiento de 2022 está dentro— y usarla como μ
  // sería el error contra el que avisa el resto de la pantalla.
  const muBonosParam = obj().muBonos != null ? num(obj().muBonos) / 100 : r;
  const muDe = (x, i) => {
    if (P.mu[x.id] != null) return P.mu[x.id] / 100;
    if (x.clase === 'bonos') return muBonosParam;
    if (!x.proxy) return x.mu;
    const b = betaW(i);
    return r + (b == null ? 1 : b) * (P.prima / 100);
  };
  const muV = A.map((x, i) => muDe(x, i));
  const sgV = E.sigma;

  // --- cajón de acciones: primero cuáles, luego cuánto ---
  // La cardinalidad («exactamente ocho») no la resuelve ningún tope: es una restricción entera. Se
  // resuelve como se resuelve en la práctica, y se dice que es una heurística: se optimiza libre,
  // se cogen las ocho de mayor peso y se vuelve a optimizar solo sobre ellas con el suelo puesto.
  const iAcc = A.map((x, i) => i).filter(i => A[i].clase === 'acciones');
  const trozo = idx => ({ m: idx.map(i => muV[i]), c: idx.map(a => idx.map(b => covS[a][b])) });
  let elegidas = iAcc, wAcc = [], libres = null, nAcc = Math.max(1, Math.min(Math.round(num(O.nAcc)), iAcc.length));
  if (iAcc.length) {
    const t0 = trozo(iAcc);
    libres = maxSharpeLargo(t0.m, t0.c, r, {});
    elegidas = iAcc.map((i, j) => ({ i, w: libres[j] })).sort((a, b) => b.w - a.w).slice(0, nAcc).map(x => x.i);
    const t1 = trozo(elegidas);
    wAcc = maxSharpeLargo(t1.m, t1.c, r, { suelo: num(O.sueloAcc) / 100, pasos: 40000 });
  }
  // --- cajón de índices: los dos vehículos, máximo Sharpe sin más restricción ---
  const iIx = A.map((x, i) => i).filter(i => A[i].clase === 'indices').slice(0, Math.max(1, Math.round(num(O.nIx))));
  const tIx = trozo(iIx);
  const wIx = iIx.length ? maxSharpeLargo(tIx.m, tIx.c, r, { pasos: 40000 }) : [];
  const iOro = A.findIndex(x => x.clase === 'oro'), iBtc = A.findIndex(x => x.clase === 'btc'),
        iBon = A.findIndex(x => x.clase === 'bonos');

  // --- pesos sobre la cartera entera, en tanto por uno ---
  const W = new Array(A.length).fill(0);
  elegidas.forEach((i, j) => (W[i] = wAcc[j] * pcAcc / 100));
  iIx.forEach((i, j) => (W[i] = wIx[j] * pcIx / 100));
  if (iOro >= 0) W[iOro] = pcOro / 100;
  if (iBtc >= 0) W[iBtc] = pcBtc / 100;
  if (iBon >= 0) W[iBon] = pcBon / 100;
  // Todo lo que tiene serie va en la misma matriz. La única pata fuera es la caja, que por
  // definición no se mueve: el tramo medido es la cartera entera menos la caja.
  const pcRiesgo = W.reduce((a, x) => a + x, 0) * 100;

  // σ y μ del tramo de riesgo, renormalizado a sumar 1 para que `puntoRiesgoRetorno` mida la mezcla
  const wR = pcRiesgo > 0 ? W.map(x => x / (pcRiesgo / 100)) : W;
  const pR = puntoRiesgoRetorno(wR, muV, covS);
  const contrib = contribucionRiesgo(wR, covS);

  // --- caja ---
  // Ya no hay nada que suponer sobre los bonos: están dentro de la matriz, con su σ y su correlación
  // medidas como las de cualquier otro. Lo único que queda fuera es la caja, y de la caja sí se sabe
  // que su σ es cero, no se supone.
  const muBon = muBonosParam;
  const muCaja = num(O.rCaja) / 100;
  const wCaja = pcCaja / 100, wRie = pcRiesgo / 100;
  const sgBon = iBon >= 0 ? sgV[iBon] : null;
  const rhoBonMundo = (iBon >= 0 && iW >= 0 && E.cov[iBon][iBon] > 0 && E.cov[iW][iW] > 0)
    ? E.cov[iBon][iW] / Math.sqrt(E.cov[iBon][iBon] * E.cov[iW][iW]) : null;
  const muHistBon = iBon >= 0 ? E.mu[iBon] : null;
  const sigmaTot = wRie * pR.sigma;
  const muTot = wRie * pR.mu + wCaja * muCaja;

  // --- lo que hay hoy en cada cajón ---
  const hoy = { acciones: 0, indices: 0, oro: 0, btc: 0, bonos: 0, caja: 0, fuera: 0 };
  // De la caja que hay HOY, cuánta está en stablecoin de dólar. La doctrina las cuenta como pólvora
  // del cubo 3 y así se deja, pero **no son caja sin volatilidad y decirlo sería falso**: son dólares.
  // Para una cartera en euros eso es riesgo de cambio puro, y el riesgo de cambio se mide.
  let cajaEstable = 0;
  for (const f of (C && C.rows) || []) {
    if (!isInvest(f.p)) continue;
    const k = cajonDe(f.p);
    if (k) hoy[k] += f.mvEUR; else hoy.fuera += f.mvEUR;
    if (esEstable(f.p)) cajaEstable += f.mvEUR;
  }
  hoy.caja += Object.values((C && C.cashEUR) || {}).reduce((a, v) => a + v, 0);
  // σ del dólar contra el euro, con el mismo muestreo semanal y la misma ventana que todo lo demás.
  // La serie de cambios vale como serie de precios: un euro invertido en dólares vale el cambio.
  const mFx = (DB.fx && DB.fx.USD) || null;
  const MFX = mFx ? matriz([{ id: 'USD', label: 'USD', ccy: 'EUR', mapa: mFx }], MS.fechas[0], undefined, 'semana') : null;
  const sgUSD = MFX && MFX.R.length && MFX.R[0].length >= 52 ? estadisticos(MFX.R, SEM).sigma[0] : null;
  // **La divisa de la pólvora se mide contra lo que va a comprar, no contra el euro.** Guardar
  // dólares para comprar algo que cotiza con σ del 50 % no es lo mismo que guardarlos para gastarlos
  // en euros: si la divisa se mueve con el destino, cubre; si no, su ruido queda enterrado bajo el
  // del destino. Aquí se calculan las dos pólvoras —en euros y en dólares— en unidades del activo
  // más volátil de la cartera, que es el destino natural de la pólvora del cubo 2.
  const iDest = A.reduce((mej, x, i) => (sgV[i] > (mej < 0 ? -1 : sgV[mej]) ? i : mej), -1);
  const polvora = (() => {
    if (iDest < 0 || !MFX || !MFX.R.length) return null;
    // Se alinean las dos series semanales por fecha antes de restar: son dos matrices distintas.
    const fD = MS.fechas, fF = MFX.fechas, rD = MS.R[iDest], rF = MFX.R[0];
    const mapF = new Map(fF.map((d, k) => [d, rF[k]]));
    const par = fD.map((d, k) => [rD[k], mapF.get(d)]).filter(x => x[1] != null);
    if (par.length < 52) return null;
    const sd = v => { const m = v.reduce((a, x) => a + x, 0) / v.length;
      return Math.sqrt(v.reduce((a, x) => a + (x - m) * (x - m), 0) / (v.length - 1) * SEM); };
    return { nm: A[iDest].tk, sigmaDestino: sgV[iDest], n: par.length,
             enEuros: sd(par.map(x => -x[0])),            // un euro, medido en unidades del destino
             enDolares: sd(par.map(x => x[1] - x[0])) };  // un dólar, lo mismo
  })();

  const eur = pc => pc / 100 * base;
  // Plazas OCUPADAS, no plazas ofrecidas. Con dos vehículos de índice el óptimo puede dejar uno a
  // cero, y entonces decir «2 plazas» en la leyenda mientras la tabla enseña una sola es mentir.
  const ocupadas = idx => idx.filter(i => W[i] > 1e-9).length;
  const CAJ = [
    { k: 'acciones', nm: 'Acciones', pc: pcAcc, plazas: ocupadas(elegidas), pedidas: nAcc, color: COL.blue, valvula: 'La caja es su válvula: lo que sobra o falta aquí se compensa con caja.' },
    { k: 'indices', nm: 'Índices', pc: pcIx, plazas: ocupadas(iIx), pedidas: iIx.length, color: COL.blue3, valvula: 'Los bonos son su válvula: lo que sobra o falta aquí se compensa con bonos.' },
    { k: 'oro', nm: 'Oro', pc: pcOro, plazas: iOro >= 0 ? 1 : 0, color: COL.yellow, valvula: 'Ancla. Peso fijo de la doctrina; la caja es su válvula.' },
    { k: 'btc', nm: 'Bitcóin', pc: pcBtc, plazas: iBtc >= 0 ? 1 : 0, color: COL.orange,
      valvula: 'Ancla. Peso fijo de la doctrina; la caja es su válvula. En la columna «hoy» cuenta TODA la cripto del cubo 2, no solo el bitcóin: las altcoins que estén camino de consolidarse en bitcóin ya suman aquí.' },
    { k: 'bonos', nm: 'Bonos', pc: pcBon, plazas: iBon >= 0 ? 1 : 0, color: COL.cyan, valvula: 'Válvula de los índices.' },
    { k: 'caja', nm: 'Caja', pc: pcCaja, plazas: 1, color: COL.cash, valvula: 'Válvula de acciones, oro y bitcóin. Remunerada al ' + fmtN(num(O.rCaja), 2) + ' %.' },
  ].map(c => ({ ...c, eur: eur(c.pc), hoy: hoy[c.k] || 0, hoyPc: base > 0 ? (hoy[c.k] || 0) / base * 100 : 0,
                delta: eur(c.pc) - (hoy[c.k] || 0) }));

  const cTot = contrib.reduce((a, x) => a + x, 0) || 1;
  const filas = A.map((x, i) => ({
    id: x.id, tk: x.tk, nm: x.nm, clase: x.clase, proxy: !!x.proxy,
    w: W[i], eur: W[i] * base, mu: muV[i], sigma: sgV[i], beta: betaW(i),
    riesgo: pcRiesgo > 0 ? contrib[i] / cTot : 0,
    valor: x.proxy ? null : (act.find(a => a.id === x.id) || {}).valor || 0,
  })).filter(x => x.w > 1e-9 || x.clase !== 'acciones');
  const descartadas = iAcc.filter(i => !elegidas.includes(i)).map(i => A[i].tk);

  return {
    CAJ, filas, descartadas, base, r, nAcc, semanas: MS.R[0].length,
    desde: MS.fechas[0], hasta: MS.fechas[MS.fechas.length - 1], limita: MS.limita,
    punto: { mu: muTot, sigma: sigmaTot }, riesgo: { ...pR, pc: pcRiesgo },
    bonos: { mu: muBon, sigma: sgBon, muHist: muHistBon, rhoMundo: rhoBonMundo, hay: iBon >= 0,
             nm: PROXY.bonos.nm, det: PROXY.bonos.det, isin: PROXY.bonos.id },
    caja: { mu: muCaja, ...CAJA_VEHICULO, estableHoy: cajaEstable, sigmaUSD: sgUSD }, polvora, hoy, sinMedir: iBon < 0,
  };
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

    <div class="card" id="tk-objetivo">
      <div class="head"><h3>Cartera objetivo por cajones</h3><span class="sub" id="tk-osub"></span></div>
      <p class="muted" style="margin:.2rem 1rem .6rem;font-size:.8rem;max-width:100ch"><b>Estos pesos son el diseño a largo plazo, no una orden de rotar hoy.</b> La columna de distancia dice a cuánto estás del diseño; cómo y en cuánto tiempo se recorre esa distancia —con aportaciones, con el rebalanceo, o dejando que el tiempo la cierre— es una decisión aparte que esta pantalla no toma. <b>El presupuesto de cada cajón sale de tu doctrina, no del optimizador</b> (se edita en Ajustes). Lo que se optimiza es quién ocupa cada plaza y con qué peso <i>dentro</i> de su cajón, por máximo Sharpe <b>solo largo</b>: sin cortos y sin apalancar, que es lo único que puedes ejecutar. Las <span class="gr">μ</span> son <b>retorno total</b> —tesis de precio más dividendo cobrado— y la matriz va medida en <b>semanal</b>, no en diario, porque el desfase horario entre plazas hunde la correlación diaria y hace parecer la cartera más diversificada de lo que está.</p>
      <div class="toolbar" style="margin:0 1rem .6rem;gap:.8rem;flex-wrap:wrap;align-items:center">
        <label class="tkmini">Plazas de acciones <input type="number" id="tk-onacc" step="1" min="1" max="30" value="${obj().nAcc}"></label>
        <label class="tkmini">Suelo por acción <input type="number" id="tk-osuelo" step="0.5" min="0" max="25" value="${obj().sueloAcc}"><span class="u">%</span></label>
        <label class="tkmini">Plazas de índices <input type="number" id="tk-onix" step="1" min="1" max="5" value="${obj().nIx}"></label>
        <label class="tkmini">A índices <input type="number" id="tk-opcix" step="1" min="0" max="80" value="${obj().pctIx}"><span class="u">%</span></label>
        <label class="tkmini">Caja remunerada <input type="number" id="tk-orcaja" step="0.25" min="0" max="10" value="${obj().rCaja}"><span class="u">%</span></label>
        <label class="tkmini"><span${ay('tk_mubonos')}><span class="gr">μ</span> de los bonos <span class="q">?</span></span> <input type="number" id="tk-omubon" step="0.25" placeholder="= r" value="${obj().muBonos == null ? '' : obj().muBonos}"><span class="u">%</span></label>
      </div>
      <div id="tk-ocaj" style="padding:0 1rem"></div>
      <div class="tablewrap" style="margin-top:.7rem"><table id="tk-otabla"></table></div>
      <div id="tk-onota" style="padding:.5rem 1rem 0"></div>
      <div class="grid2" style="margin-top:.4rem">
        <div class="card pad">
          <div class="eyebrow">De dónde sale el riesgo</div>
          <p class="muted" style="font-size:.76rem;margin:.3rem 0 .4rem">Contribución de cada plaza a la <span class="gr">σ</span> del tramo de riesgo, <span class="mono">wᵢ(Σw)ᵢ/σ</span>, frente a lo que pesa en dinero. Suma exactamente <span class="gr">σ</span>. Es el número que desmiente el «solo es un 15 % de la cartera».</p>
          <div class="chartbox" style="height:260px"><canvas id="tk-g-oriesgo"></canvas></div>
        </div>
        <div class="card pad">
          <div class="eyebrow">Qué cartera sale</div>
          <div class="kpis" id="tk-okpis" style="margin-top:.5rem"></div>
          <div id="tk-osupuestos" style="margin-top:.5rem"></div>
        </div>
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
      <p class="muted" style="margin:.2rem 1rem .6rem;font-size:.8rem;max-width:100ch">El mapa de lo posible con los activos que has marcado: la curva azul es la frontera, la de puntos es su rama dominada —mismo riesgo, menos retorno— y la recta es la <b>línea del mercado de capitales</b> desde el tipo sin riesgo. Si no hay recta es porque no hay cartera de tangencia, y eso se explica debajo. <b>Tangencia y Kelly salen del mismo álgebra</b> —<span class="mono">Σ⁻¹(μ − r·1)</span>— y por eso suelen caer juntos: tangencia lo normaliza a sumar 1, Kelly le aplica tu fracción y tus topes. La distancia entre tu cartera de hoy y esa recta es lo que hay sobre la mesa.</p>
      <div class="chartbox tk-frontera"><canvas id="tk-g-frontera"></canvas></div>
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
  // Parámetros de la cartera objetivo. Viven en `P.objetivo` y viajan a la base como el resto.
  const objIn = (id, campo, min, max, vacio) => { const el = $('#' + id); if (!el) return;
    el.onchange = () => {
      if (vacio && el.value.trim() === '') { P.objetivo = { ...obj(), [campo]: null }; recal(); return; }
      let x = num(el.value); if (min != null) x = Math.max(min, x); if (max != null) x = Math.min(max, x);
      el.value = x; P.objetivo = { ...obj(), [campo]: x }; recal();
    }; };
  objIn('tk-onacc', 'nAcc', 1, 30); objIn('tk-osuelo', 'sueloAcc', 0, 25);
  objIn('tk-onix', 'nIx', 1, 5); objIn('tk-opcix', 'pctIx', 0, 80);
  objIn('tk-orcaja', 'rCaja', 0, 10); objIn('tk-omubon', 'muBonos', -5, 25, true);
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
      CALC = await calcular(U, K.baseOptim, C, K.base);
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
          value="${fmtN(f.mu * 100, 1).replace(',', '.')}" data-tesis="${esc(x.id)}"
          title="Retorno total: ${fmtN(f.muTesis * 100, 1)} % de la tesis de precio (${esc(f.tesis && f.tesis.actualizada || 'sin fecha')}) más ${f.divY ? fmtN(f.divY * 100, 2) + ' % de dividendo cobrado' : 'ningún dividendo'}. Pulsa para editar la tesis; quítala para escribir la μ a mano."></td>`;
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
      // Margen de seguridad de la valoracion por fundamentales. Vacio no es «no hay dato»: es «esta
      // posicion no se ha valorado todavia», y se dice, que es lo que este proyecto lleva toda la
      // sesion aprendiendo a distinguir.
      marg: (x) => {
        const V = DB.settings?.tesis?.[x.id]?.valoracion;
        if (!V) return td('<span class="muted" title="Sin valorar por fundamentales todavia">sin valorar</span>', null, 'muted');
        const m = +V.margen_base_pct;
        const t = `${esc(V.metodo || '')}${V.descuento_pct ? ` al ${fmtN(+V.descuento_pct, 0)} %` : ''}. Valor ${fmtN(+V.valor_base, 2)} frente a ${fmtN(+V.precio, 2)} de precio (${fmtDate(V.fecha)}). Abre la ficha de la posicion para ver fuentes y supuestos.`;
        return td(`<span title="${esc(t)}">${fmtPct(m, 0)}</span>`, m, m >= 30 ? 'pos' : m < -15 ? 'neg' : 'muted');
      },
      // Rendimiento por dividendo de los últimos doce meses, que es lo que se le suma a la tesis.
      // Se enseña el número de pagos porque **es el aviso**: con dos pagos en una trimestral, el
      // rendimiento que sale es la mitad del real y μ se queda corta.
      div: (x, f) => {
        if (!f || f.divY == null) return td('<span class="muted" title="Sin dividendos cobrados en los últimos doce meses">—</span>', null, 'muted');
        const pocos = f.divN <= 2;
        const t = `${f.divN} pago${f.divN === 1 ? '' : 's'} en 12 meses, el último el ${fmtDate(f.divUlt)}.`
          + (pocos ? ' Con tan pocos, lo más probable es que falten cobros en la base y que este rendimiento se quede corto.' : '');
        return td(`<span title="${esc(t)}">${fmtN(f.divY * 100, 2)} %</span>${pocos ? ' <span class="sub2 warn">' + f.divN + ' pagos</span>' : ''}`,
                  f.divY * 100, pocos ? 'warn' : 'pos');
      },
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
      // Tres diagnósticos que la auditoría del 17 sep 2026 encontró leyendo los números, no el código.
      // El taller SÍ dimensiona con el μ de la tesis, así que una tesis que dice menos que el tipo sin
      // riesgo ya sale a cero sola; el problema es que eso pasa en silencio y la posición sigue viva.
      const pobres = (CALC.filas || []).filter(f => f.muTesis != null && f.muTesis < CALC.r);
      if (pobres.length) ns.push(['warn', `<b>${pobres.length} tesis esperan menos que el tipo sin riesgo</b> (${fmtN(CALC.r * 100, 1)} %): ${pobres.map(f => '<span class="mono">' + esc(f.tk) + '</span> ' + fmtN(f.muTesis * 100, 2) + ' %').join(', ')}. Con tus propios números no merecen tenerse, y el taller ya les da peso cero. Lo que queda por decidir es qué hacen todavía en la cartera: hoy suman ${fmtEUR(pobres.reduce((x, f) => x + (f.valor || 0), 0), 0)}.`]);
      // Si casi todo choca con el tope, el que dimensiona es el tope y Kelly no está informando nada.
      const nTop = CALC.pol.topados, nAct = (CALC.filas || []).length;
      if (nAct >= 4 && nTop >= nAct * 0.6) {
        // Y si además la suma pasaba de 100 y hubo que reescalar, todos los topados salen al MISMO
        // peso: el resultado deja de depender de Kelly, de las correlaciones y de λ. Con los
        // parámetros del 17 sep 2026 (c = 1, tope 10 %, suelo 5 %) las diecisiete supervivientes
        // salían las diecisiete al 5,88 %. Eso no es dimensionar: es repartir a partes iguales.
        const vivos = CALC.pol.w.filter(x => x > 1e-9);
        const distintos = new Set(vivos.map(x => x.toFixed(6))).size;
        const iguales = distintos === 1 && vivos.length >= 4;
        ns.push(['warn', `<b>${nTop} de ${nAct} posiciones salen topadas al ${fmtN(P.tope, 0)} %.</b> Cuando casi todas chocan con el tope, quien dimensiona es el tope y no Kelly: el modelo devuelve la misma respuesta para activos distintos.${iguales ? ` Y como la suma pasaba del 100 % y hubo que reescalar, <b>las ${vivos.length} salen exactamente al mismo peso (${fmtN(vivos[0] * 100, 2)} %)</b>: el resultado ya no depende de Kelly, ni de las correlaciones, ni de λ. Es una cartera a partes iguales con pasos intermedios.` : ''} Baja <span class="mono">c</span>, sube el tope o revisa unos μ que piden más de la mitad del patrimonio por posición.`]);
      }
      // μ escritos a mano que la tesis pisa. El orden de preferencia es tesis > μ a mano > prior CAPM,
      // así que un μ escrito hace meses se queda en `settings.taller.mu` sin efecto y sin avisar. El
      // 17 sep 2026 había dieciocho, y la distancia con lo que dicen las tesis llegaba a 15 pp (XOM:
      // 8,7 % a mano frente a −0,72 % en su tesis). Ver un número que no manda es peor que no verlo.
      const pisados = (CALC.filas || []).filter(f => f.muTesis != null && P.mu[f.id] != null
        && Math.abs(P.mu[f.id] / 100 - f.muTesis) > 0.02);
      if (pisados.length) ns.push(['', `<b>${pisados.length} μ escritos a mano ya no se usan:</b> los pisa la tesis, que va delante. ${pisados.slice(0, 6).map(f => '<span class="mono">' + esc(f.tk) + '</span> ' + fmtN(P.mu[f.id], 1) + ' % a mano frente a ' + fmtN(f.muTesis * 100, 1) + ' % de la tesis').join(', ')}. El taller dimensiona con el de la tesis; el otro solo estorba. Bórralos o actualiza la tesis.`]);
      // «Objetivo = máximo histórico» convierte el alza en una medida de cuánto ha caído el valor, no
      // de cuánto vale: lo que más ha caído tiene el mayor recorrido hasta su máximo por aritmética, y
      // lo que está en máximos se queda mudo. Se mide en vivo: si el alza de las tesis va pegada a la
      // caída desde el máximo, la regla está midiendo la caída y no la convicción.
      const cd = (CALC.filas || []).filter(f => f.tesis && f.tesis.alza != null && f.caidaMax != null);
      if (cd.length >= 8) {
        const x = cd.map(f => f.caidaMax), y = cd.map(f => f.tesis.alza);
        const mx = x.reduce((a, b) => a + b, 0) / x.length, my = y.reduce((a, b) => a + b, 0) / y.length;
        let sxy = 0, sxx = 0, syy = 0;
        for (let i = 0; i < x.length; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
        const rho = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
        if (rho > 0.7) ns.push(['warn', `<b>Tu alza mide la caída, no la convicción.</b> Entre el recorrido que escribes en las ${cd.length} tesis y lo que cada valor ha caído desde su máximo hay una correlación de ${fmtN(rho, 2)} (R² ${fmtN(rho * rho, 2)}). Con la regla «objetivo = máximo histórico» eso es aritmética, no juicio: lo que más ha caído tiene por fuerza el mayor recorrido y lo que está en máximos se queda sin nada que decir. ${cd.filter(f => f.tesis.alza < 15).length} tesis traen menos del 15 % de recorrido a cinco años por esa razón.`]);
      }
      // El alza se multiplica por el horizonte: a cinco años cualquier tesis parece grande. Si la
      // condición de salida es de 2026-2027, el horizonte real es uno, no cinco.
      const horiz = (CALC.filas || []).filter(f => f.tesis && (f.tesis.anos || 0) >= 4).map(f => {
        const un = tesisAEscenarios({ ...f.tesis, anos: 1 });
        return { tk: f.tk, n: f.tesis.anos, cinco: f.muTesis, uno: un.muAnual };
      }).filter(x => x.uno != null && x.cinco != null && x.uno > x.cinco * 1.8);
      if (horiz.length) ns.push(['', `<b>El horizonte es lo que hace grandes a estas tesis.</b> ${horiz.slice(0, 6).map(x => '<span class="mono">' + esc(x.tk) + '</span> ' + fmtN(x.cinco * 100, 1) + ' % a ' + x.n + ' años frente a ' + fmtN(x.uno * 100, 1) + ' % a uno').join(', ')}. Si tu condición de salida es un suceso de los próximos doce meses, el horizonte real es ese: anualizar a cinco años reparte el alza entre cinco y la hace parecer sostenible.`]);
      if ((CALC.inexist || []).length) ns.push(['warn', `<b>${CALC.inexist.length} activos marcados ya no existen</b> como posición ni como candidato (<span class="mono">${CALC.inexist.map(esc).join('</span>, <span class="mono">')}</span>) y no entran en el cálculo. Desmárcalos o vuelve a darlos de alta.`]);
      const fuerte = (CALC.filas || []).filter(f => f.peor > 0.2);
      if (fuerte.length) ns.push(['', `<b>Volatilidad fabricada por un solo día</b> en ${fuerte.map(f => '<span class="mono">' + esc(f.tk) + '</span>').join(', ')}: su peor sesión pasa del 20 %. La σ histórica no acota la cola izquierda (Taleb); mira la columna «peor día» antes de fiarte de σ.`]);
    }
    pintarObjetivo();
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
  // La cartera objetivo: presupuesto por cajón, quién ocupa cada plaza y de dónde sale el riesgo.
  function pintarObjetivo() {
    const O = CALC && CALC.objetivo;
    const caj = $('#tk-ocaj'), tb = $('#tk-otabla'), sub = $('#tk-osub'),
          nota = $('#tk-onota'), kp = $('#tk-okpis'), sup = $('#tk-osupuestos');
    if (!O || O.error) {
      if (sub) sub.textContent = '';
      if (caj) caj.innerHTML = `<div class="note warn">${esc((O && O.error) || (CALC && CALC.error) || 'Calculando…')}</div>`;
      if (tb) tb.innerHTML = ''; if (nota) nota.innerHTML = ''; if (kp) kp.innerHTML = ''; if (sup) sup.innerHTML = '';
      chart('tk-g-oriesgo', { type: 'bar', data: { labels: [], datasets: [] } });
      return;
    }
    const pc = x => fmtN(x, 1) + ' %';
    if (sub) sub.textContent = `${O.filas.filter(f => f.w > 0).length + 1} plazas · ${fmtEUR(O.base, 0)} · `
      + `${O.semanas} semanas (${fmtDate(O.desde)} a ${fmtDate(O.hasta)})`;

    // 1 · el presupuesto, con lo que hay hoy debajo
    if (caj) caj.innerHTML = '<div class="stack" style="margin:.2rem 0 .5rem">'
      + O.CAJ.map(c => `<i style="background:${c.color};width:${c.pc.toFixed(2)}%" title="${esc(c.nm)} ${pc(c.pc)}"></i>`).join('')
      + '</div><div class="legend2"><div class="cab"><span></span><span>hoy</span><span>diseño</span><span>distancia</span></div>'
      + O.CAJ.map(c => `<div title="${esc(c.valvula)}"><i style="background:${c.color}"></i>`
          + `<span class="lb">${esc(c.nm)}${c.plazas ? ' <span class="sub2">' + c.plazas + (c.plazas === 1 ? ' plaza' : ' plazas') + '</span>' : ''}</span>`
          + `<span class="hoy">${pc(c.hoyPc)}</span><span class="pro">${pc(c.pc)}</span>`
          + `<span class="${Math.abs(c.delta) < O.base * 0.005 ? 'muted' : cls(c.delta)}">${c.delta > 0 ? '+' : '−'}${fmtK(Math.abs(c.delta))}</span></div>`).join('')
      + '</div>';

    // 2 · quién ocupa cada plaza
    const grupo = { acciones: 'Acciones', indices: 'Índices', oro: 'Oro', btc: 'Bitcóin', bonos: 'Bonos' };
    const orden = ['acciones', 'indices', 'oro', 'btc', 'bonos'];
    const pres = Object.fromEntries(O.CAJ.map(c => [c.k, c.pc]));
    let cuerpo = '';
    for (const g of orden) {
      const fs = O.filas.filter(f => f.clase === g && f.w > 0).sort((a, b) => b.w - a.w);
      if (!fs.length) continue;
      const c = O.CAJ.find(x => x.k === g) || {};
      cuerpo += `<tr class="sep"><td colspan="8"><span class="eyebrow">${grupo[g]} · ${pc(pres[g])} de la cartera · ${fmtEUR(pres[g] / 100 * O.base, 0)}`
        + ` · hoy ${pc(c.hoyPc || 0)}, distancia ${c.delta > 0 ? '+' : '−'}${fmtEUR(Math.abs(c.delta || 0), 0).replace('-', '')}</span></td></tr>`
        + fs.map(f => {
            const d = f.valor == null ? null : f.eur - f.valor;
            return `<tr><td class="tkpos"><b class="mono">${esc(f.tk)}</b>${f.proxy ? ' <span class="badge" title="Vehículo de referencia de la doctrina, no el fondo que tengas hoy">referencia</span>' : ''}<span class="sub2">${esc(f.nm)}</span></td>`
              + `<td class="num"><b>${pc(f.w * 100)}</b></td>`
              + `<td class="num muted">${pres[g] ? pc(f.w * 100 / pres[g] * 100) : '—'}</td>`
              + `<td class="num">${fmtEUR(f.eur, 0)}</td>`
              + `<td class="num">${fmtN(f.mu * 100, 1)} %</td>`
              + `<td class="num">${fmtN(f.sigma * 100, 1)} %</td>`
              + `<td class="num ${f.riesgo > 0.25 ? 'warn' : 'muted'}">${pc(f.riesgo * 100)}</td>`
              + `<td class="num ${d == null ? 'muted' : cls(d)}">${d == null ? '—' : (d > 0 ? '+' : '−') + fmtEUR(Math.abs(d), 0).replace('-', '')}</td></tr>`;
          }).join('');
    }
    // Bonos y caja: peso fijo de la doctrina, sin optimizar, y se dice con qué se ha medido cada uno.
    const fijo = (nm, det, p, mu, sg, hoy) => `<tr><td class="tkpos"><b class="mono">${nm}</b><span class="sub2">${esc(det)}</span></td>`
      + `<td class="num"><b>${pc(p)}</b></td><td class="num muted">100,0 %</td><td class="num">${fmtEUR(p / 100 * O.base, 0)}</td>`
      + `<td class="num">${fmtN(mu * 100, 1)} %</td><td class="num">${sg == null ? '<span class="muted">sin medir</span>' : fmtN(sg * 100, 1) + ' %'}</td>`
      + `<td class="num muted">—</td><td class="num ${cls(p / 100 * O.base - hoy)}">${p / 100 * O.base - hoy > 0 ? '+' : '−'}${fmtEUR(Math.abs(p / 100 * O.base - hoy), 0).replace('-', '')}</td></tr>`;
    const cC = O.CAJ.find(c => c.k === 'caja');
    cuerpo += `<tr class="sep"><td colspan="8"><span class="eyebrow">Caja · ${pc(cC.pc)} de la cartera · ${fmtEUR(cC.pc / 100 * O.base, 0)}`
      + ` · hoy ${pc(cC.hoyPc)}, distancia ${cC.delta > 0 ? '+' : '−'}${fmtEUR(Math.abs(cC.delta), 0).replace('-', '')}</span></td></tr>`
      + fijo(esc(O.caja.nm), O.caja.det + ' · remunerada al ' + fmtN(O.caja.mu * 100, 2) + ' %. Sin volatilidad PORQUE ES EN EUROS'
             + (O.caja.estableHoy > 0 ? '; lo que tienes hoy en stablecoin de dólar no cumple ninguna de las dos cosas' : ''),
             cC.pc, O.caja.mu, 0, cC.hoy);
    if (tb) tb.innerHTML = '<thead><tr><th>Plaza</th><th class="num">Peso</th><th class="num">Del cajón</th>'
      + '<th class="num">Importe</th><th class="num"><span class="gr">μ</span></th><th class="num"><span class="gr">σ</span></th>'
      + `<th class="num" title="Parte de la σ del tramo medido (el ${pc(O.riesgo.pc)} de la cartera que no es caja) que aporta esta plaza. Las de este tramo suman 100 %.">Del riesgo</th>`
      + '<th class="num"><span class="gr">Δ</span> vs hoy</th></tr></thead><tbody>' + cuerpo + '</tbody>';

    // 3 · lo que se queda fuera y los supuestos que no se cumplen
    const fuera = O.descartadas;
    const cortos = O.CAJ.filter(c => c.pedidas && c.plazas < c.pedidas);
    if (nota) nota.innerHTML =
      (cortos.length ? `<div class="note warn"><b>Hay cajones que no se llenan.</b> `
        + cortos.map(c => `${esc(c.nm)}: ${c.pedidas} ${c.pedidas === 1 ? 'plaza pedida' : 'plazas pedidas'}, ${c.plazas} con peso.`).join(' ')
        + ` El óptimo deja la plaza vacía porque con tus μ no aporta nada al Sharpe del cajón. Si la quieres ocupada de todas formas, ponle suelo o escríbele una μ.</div>` : '')
      + (fuera.length ? `<div class="note warn"><b>Salen del cajón de acciones ${fuera.length} de las ${fuera.length + O.nAcc} marcadas.</b> `
        + `<span class="mono">${fuera.map(esc).join(' · ')}</span><br>No es una orden ni un juicio sobre la empresa: es lo que sale de <b>tus propias μ</b> `
        + `cuando solo caben ${O.nAcc} plazas. Cambia una μ y cambia la lista.</div>` : '')
      + `<div class="note"><b>Cómo se eligen las ${O.nAcc}.</b> «Exactamente ocho» no lo resuelve ningún tope: es una restricción entera. `
      + `Se hace en dos pasos, y es una heurística, no el óptimo demostrado: se optimiza libre sobre todas las marcadas, se cogen las `
      + `${O.nAcc} de mayor peso y se vuelve a optimizar solo sobre ellas <b>con suelo</b>. El suelo —y no un tope— es lo que hace que salgan `
      + `${O.nAcc} nombres con pesos distintos: sin él el óptimo deja varias a cero y te quedas con menos de las que pediste; con un tope plano `
      + `salen media docena pegadas al tope, que es la cartera equiponderada disfrazada.</div>`;

    // 4 · riesgo: peso frente a contribución
    const rf = O.filas.filter(f => f.w > 0).sort((a, b) => b.riesgo - a.riesgo).slice(0, 12);
    chart('tk-g-oriesgo', {
      type: 'bar',
      data: { labels: rf.map(f => f.tk), datasets: [
        { label: 'Peso en dinero', data: rf.map(f => f.w * 100), backgroundColor: COL.blue3, borderRadius: 3 },
        { label: 'Aporta al riesgo', data: rf.map(f => f.riesgo * O.riesgo.pc), backgroundColor: COL.red, borderRadius: 3 },
      ] },
      options: { indexAxis: 'y', maintainAspectRatio: false,
        plugins: { legend: { labels: { usePointStyle: true, boxWidth: 8, padding: 8 } },
          tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmtN(c.raw, 1)} %` } } },
        scales: { x: { ticks: { callback: pctTick }, grid }, y: { grid: { display: false }, ticks: { font: { size: 10 }, autoSkip: false } } } },
    });

    // 5 · la cartera que sale
    const sh = (m, sg) => (sg > 0 ? (m - CALC.r) / sg : null);
    const kpi = (l, v, sb, c) => `<div class="kpi" style="--kc:${c}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${sb}</div></div>`;
    const hoyP = CALC.frontera && CALC.frontera.hoy;
    if (kp) kp.innerHTML =
        kpi('Riesgo (σ)', pc(O.punto.sigma * 100), `tramo medido ${pc(O.riesgo.sigma * 100)} sobre el ${pc(O.riesgo.pc)} de la cartera; el resto es caja`, COL.red)
      + kpi('Retorno (μ)', pc(O.punto.mu * 100), 'retorno total, con dividendo', COL.blue)
      + kpi('Sharpe', sh(O.punto.mu, O.punto.sigma) == null ? '—' : fmtN(sh(O.punto.mu, O.punto.sigma), 2), `con r ${fmtN(CALC.r * 100, 2)} %`, COL.cyan)
      + (hoyP ? kpi('Tu cartera hoy', sh(hoyP.mu, hoyP.sigma) == null ? '—' : fmtN(sh(hoyP.mu, hoyP.sigma), 2),
                    `σ ${pc(hoyP.sigma * 100)} · μ ${pc(hoyP.mu * 100)} · solo lo marcado`, COL.yellow) : '');

    if (sup) sup.innerHTML =
      (O.sinMedir
        ? `<div class="note bad"><b>El cajón de bonos no tiene serie</b>, así que ni su σ ni su correlación entran en el cálculo: la σ del conjunto sale baja por eso. Ejecuta <span class="mono">python3 jobs/fetch_market.py watchlist</span>.</div>`
        : `<div class="note"><b>Los bonos ya no van con un supuesto: van medidos.</b> `
          + `Hasta el 18 sep 2026 su serie en la base era mensual, no cabía en la matriz semanal y entraban con <b>ρ = 0</b> con todo lo demás. `
          + `Con la serie diaria del fondo elegido, la correlación con el índice mundial es de `
          + `<b>${O.bonos.rhoMundo == null ? '—' : fmtN(O.bonos.rhoMundo, 4).replace('.', ',')}</b>, no cero: `
          + `en esta ventana la deuda pública euro se movió <b>con</b> la bolsa, no contra ella. `
          + `El supuesto viejo no era conservador, era optimista, y la σ que ves ahora es mayor por eso.</div>`)
      + `<div class="note"><b>La <span class="gr">μ</span> de los bonos no se inventa.</b> Es la TIR del fondo, un dato que este sistema no tiene, así que por defecto entra igualada al tipo sin riesgo `
      + `(${fmtN(CALC.r * 100, 2)} %), que es el supuesto conservador. `
      + (O.bonos.hay && O.bonos.muHist != null
          ? `Su rentabilidad medida en esta ventana fue del <b class="${O.bonos.muHist < 0 ? 'neg' : ''}">${fmtN(O.bonos.muHist * 100, 2)} %</b> anual`
            // El «2022 está dentro» solo se dice si de verdad lo está: la ventana la fija el activo
            // más joven y puede empezar después. Afirmarlo siempre sería inventarse el motivo.
            + (O.desde && O.desde <= '2022-12-31' ? ' —el hundimiento de 2022 cae dentro de la ventana—' : '')
            + `, que es historia y no previsión: copiarla aquí sería el error contra el que avisa el resto de la pantalla. ` : '')
      + `Escríbela arriba cuando mires la ficha.</div>`
      + (O.caja.estableHoy > 0 && O.polvora
          ? `<div class="note warn"><b>Ojo con la caja que tienes HOY: ${fmtEUR(O.caja.estableHoy, 0)} de ella `
            + `(${fmtN(O.hoy.caja > 0 ? O.caja.estableHoy / O.hoy.caja * 100 : 0, 0)} %) está en stablecoin de dólar, no en euros.</b> `
            + `El objetivo de este cajón es un monetario en euros, y de ese sí se sabe que su σ es cero. De lo que hay hoy, no: `
            + (O.caja.sigmaUSD != null
                ? `la σ medida del dólar contra el euro es del <b>${fmtN(O.caja.sigmaUSD * 100, 2)} %</b> anual en esta misma ventana`
                  // La comparación con los bonos se comprueba antes de hacerla: es la que convence,
                  // pero afirmarla sin mirar sería el mismo defecto que esta pantalla persigue.
                  + (O.bonos.sigma != null && O.caja.sigmaUSD > O.bonos.sigma
                      ? `, <b>más que la del fondo de bonos</b> (${fmtN(O.bonos.sigma * 100, 2)} %)` : '')
                  + '. '
                : '')
            + `Que el saldo sea estable en dólares no lo hace estable en tu divisa. Y si además está remunerado por encima del tipo sin riesgo, `
            + `esa diferencia no es un regalo: es el precio de prestarle dinero a una contraparte, lo fije ella o lo fije un pool por oferta y demanda.<br>`
            // Matiz que importa y que la advertencia de arriba, sola, se deja fuera: **la divisa de la
            // pólvora hay que medirla contra lo que va a comprar, no contra el euro**. Si el destino
            // es un activo mucho más volátil, la divisa deja de decidir nada. Se comprueba, no se
            // afirma: el dólar solo compensa si ρ(divisa, destino) > σ_divisa / (2·σ_destino).
            + `<b>Ahora bien, si esta caja es pólvora para comprar otra cosa, el euro no es la vara de medir:</b> lo que cuenta es `
            + `cuánto compra de <i>eso</i>. Contra un destino de σ ${fmtN(O.polvora.sigmaDestino * 100, 0)} % como ${esc(O.polvora.nm)}, `
            + `la pólvora en dólares tiene una σ del ${fmtN(O.polvora.enDolares * 100, 2)} % y en euros del ${fmtN(O.polvora.enEuros * 100, 2)} %: `
            + `${Math.abs(O.polvora.enDolares - O.polvora.enEuros) * 100 < 1
                 ? '<b>la diferencia es ruido</b> y la divisa no decide nada aquí. La advertencia de arriba vale para caja que se queda caja, no para pólvora'
                 : (O.polvora.enDolares < O.polvora.enEuros ? 'el dólar sale <b>mejor</b>' : 'el dólar sale <b>peor</b>')}.</div>`
          : '')
      + `<div class="note"><b>La ventana la marca ${esc(O.limita || '—')}</b>, que es quien tiene la serie más corta: ${O.semanas} semanas comunes. `
      + `Todo lo de esta tarjeta —σ, μ, correlaciones— está medido en ese tramo y no en otro.</div>`;
  }

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
    // **La curva y la recta son dos cosas distintas y antes se perdían juntas.** La frontera sale de
    // Σ⁻¹ y existe siempre que la matriz se deje invertir; la línea del mercado de capitales necesita
    // además una cartera de tangencia, que solo existe si el conjunto bate al tipo sin riesgo. Atar
    // el dibujo entero a la tangencia dejaba la pantalla en blanco justo cuando el resultado —«nada
    // de esto bate al 2,5 %»— era la información. Ahora falta la recta, no el mapa.
    if (!F || !F.curva) {
      if (sub) sub.textContent = '';
      if (kp) kp.innerHTML = '';
      if (nota) nota.innerHTML = '<div class="note warn">La matriz de covarianzas no se deja invertir con estos activos: hay uno que es combinación casi exacta de otros. Desmarca alguno o sube λ.</div>';
      if (tb) tb.innerHTML = '';
      chart('tk-g-frontera', { type: 'scatter', data: { datasets: [] } });
      return;
    }
    const r = CALC.r, pct = x => x * 100;
    const motivo = F.tangencia ? null : F.sinTangencia;
    const avisoTan = !motivo ? ''
      : motivo === 'nobate'
      ? `<div class="note warn"><b>No hay línea del mercado de capitales, y eso es un resultado, no un fallo.</b> `
        + `La mejor mezcla de riesgo que permiten tus <span class="gr">μ</span> rinde MENOS que el `
        + `${fmtN(r * 100, 2)} % sin riesgo, así que no hay prima que capturar: la recta saldría con `
        + `pendiente negativa y no se dibuja. <b>La curva sí existe y está ahí arriba.</b> Ahora mismo `
        + `<b>${F.bajoR} de ${F.ids.length}</b> μ están por debajo del tipo sin riesgo y la media es `
        + `<b>${fmtN(F.muMedia * 100, 2)} %</b>. O tus tesis están demasiado pesimistas, o lo que dicen es `
        + `que hoy toca esperar en liquidez.</div>`
      : motivo === 'cancelan'
      ? '<div class="note warn">Los excesos sobre el tipo sin riesgo se cancelan entre sí: no hay una cartera de tangencia preferida, así que no hay recta. La curva se dibuja igual.</div>'
      : '<div class="note warn">Sin tangencia: la matriz está casi degenerada. La curva se dibuja igual.</div>';
    const sharpe = q => (q && q.sigma > 0 ? (q.mu - r) / q.sigma : null);
    // La hipérbola se dispara a σ enormes en sus extremos y arrastraba el eje hasta el 45 %, dejando
    // los tres puntos que importan aplastados en el tercio izquierdo. Se acota el eje a lo que se
    // quiere leer y se recorta la curva a ese marco; lo de fuera no es información, es escala perdida.
    const movil = window.matchMedia('(max-width: 700px)').matches;
    // Escala redondeada a un número legible: con el máximo crudo el último rótulo salía «28,2 %» y
    // los tres puntos que importan quedaban aplastados en el tercio izquierdo.
    const redondea = x => { const p = Math.pow(10, Math.floor(Math.log10(x))); return Math.ceil(x / p * 2) / 2 * p; };
    const puntos = [F.tangencia, F.kelly, F.hoy, F.objetivo, F.curva.mvp].filter(Boolean);
    const sigmas = puntos.map(q => q.sigma);
    const maxX = redondea(Math.max(...sigmas, 0.02) * (movil ? 1.25 : 1.4) * 100) / 100;
    const pend = F.tangencia ? (F.tangencia.mu - r) / F.tangencia.sigma : null;
    // La rama de abajo de la hipérbola está dominada —mismo riesgo, menos retorno—, así que no es
    // «frontera eficiente» y se dibuja aparte, tenue: informa de la forma sin robar la mitad del alto.
    const dentro = q => q.sigma <= maxX;
    const efic = F.curva.filter(q => q.eficiente && dentro(q)).map(q => ({ x: pct(q.sigma), y: pct(q.mu) }));
    const domi = F.curva.filter(q => !q.eficiente && dentro(q)).map(q => ({ x: pct(q.sigma), y: pct(q.mu) }));
    const mus = [...efic, ...domi].map(q => q.y).concat([pct(r)], puntos.map(q => pct(q.mu)));
    const maxY = redondea(Math.max(...mus) * 1.08);
    // El suelo es 0 salvo que de verdad haya un μ negativo: fijarlo a 0 a secas escondería el punto
    // de una cartera con retorno esperado negativo, que es justo el que hay que ver.
    const minPunto = Math.min(pct(r), ...puntos.map(q => pct(q.mu)));
    const minY = minPunto < 0 ? -redondea(Math.abs(minPunto) * 1.15) : 0;
    const punto = (q, label, color, style, radio) => ({
      label, data: [{ x: pct(q.sigma), y: pct(q.mu) }], backgroundColor: color, borderColor: color,
      pointRadius: radio, pointHoverRadius: radio + 3, pointStyle: style, order: 1 });

    chart('tk-g-frontera', {
      type: 'scatter',
      data: { datasets: [
        { label: 'Frontera eficiente', type: 'line', showLine: true, pointRadius: 0, borderWidth: 2.2,
          borderColor: COL.blue3, order: 5, data: efic },
        { label: 'Rama dominada', type: 'line', showLine: true, pointRadius: 0, borderWidth: 1,
          borderDash: [3, 3], borderColor: COL.blue3 + '66', order: 6, data: domi },
        ...(pend != null ? [{ label: 'Línea del mercado de capitales', type: 'line', showLine: true, pointRadius: 0,
          borderWidth: 1.6, borderDash: [6, 4], borderColor: COL.cyan, order: 4,
          data: [{ x: 0, y: pct(r) }, { x: pct(maxX), y: pct(r + pend * maxX) }] }] : []),
        // La cartera de varianza mínima es el vértice de la hipérbola: sitúa la curva aunque no haya
        // ni tangencia ni recta, y es el punto que dice cuánto riesgo NO se puede quitar.
        ...(F.curva.mvp && dentro(F.curva.mvp) ? [punto(F.curva.mvp, 'Varianza mínima', COL.blue, 'crossRot', 7)] : []),
        ...(F.tangencia ? [punto(F.tangencia, 'Tangencia · máximo Sharpe', COL.cyan, 'triangle', 9)] : []),
        punto(CALC.frontera.kelly, 'Kelly con tu política', COL.yellow, 'rectRot', 8),
        ...(F.objetivo ? [punto(F.objetivo, 'Cartera objetivo por cajones', COL.purple, 'star', 11)] : []),
        ...(F.hoy ? [punto(F.hoy, 'Tu cartera hoy', COL.red, 'circle', 9)] : []),
        { label: 'Sin riesgo (r)', data: [{ x: 0, y: pct(r) }], backgroundColor: COL.cash,
          pointRadius: 5, pointStyle: 'circle', order: 1 },
      ] },
      options: {
        maintainAspectRatio: false,
        layout: { padding: { right: movil ? 8 : 4, top: 6 } },
        plugins: {
          // En el móvil la leyenda ocupaba tres filas y empujaba el gráfico fuera de la pantalla.
          // Los cuatro puntos ya llevan su color en las tarjetas de debajo, que sí caben.
          legend: { display: !movil, labels: { usePointStyle: true, boxWidth: 8, padding: 10 } },
          tooltip: { callbacks: { label: it => `${it.dataset.label}: σ ${fmtN(it.parsed.x, 1)} % · μ ${fmtN(it.parsed.y, 1)} %` } } },
        scales: {
          x: { min: 0, max: pct(maxX), offset: false,
               title: { display: !movil, text: 'riesgo · volatilidad anual del modelo' },
               ticks: { callback: pctTick, maxTicksLimit: movil ? 5 : 9, maxRotation: 0, autoSkipPadding: 12 }, grid },
          y: { min: minY, max: maxY,
               title: { display: !movil, text: 'retorno esperado (μ)' },
               ticks: { callback: pctTick, maxTicksLimit: movil ? 6 : 9 }, grid },
        },
      },
    });

    if (sub) sub.textContent = `${F.ids.length} activos marcados · λ ${fmtN(P.lam, 2)} · r ${fmtN(P.r, 2)} %`;
    const kpi = (l, v, sb, c) => `<div class="kpi" style="--kc:${c}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${sb}</div></div>`;
    const tarjeta = (q, l, c) => (q ? kpi(l, sharpe(q) == null ? '—' : fmtN(sharpe(q), 2),
      `σ ${fmtN(pct(q.sigma), 1)} % · μ ${fmtN(pct(q.mu), 1)} %`, c) : '');
    if (kp) kp.innerHTML =
        tarjeta(F.hoy, 'Tu cartera hoy', COL.red)
      + tarjeta(F.objetivo, 'Cartera objetivo', COL.purple)
      + tarjeta(F.tangencia, 'Tangencia', COL.cyan)
      + tarjeta(CALC.frontera.kelly, 'Kelly', COL.yellow)
      + kpi('Sin riesgo', fmtN(P.r, 2) + ' %', 'parámetro r', COL.cash);

    // El aviso que de verdad importa: si μ no la has escrito tú, este gráfico solo sabe decir
    // «compra beta», porque el prior CAPM hace μ proporcional a β por construcción.
    const escritas = F.ids.filter(id => P.mu[id] != null || tesisDe(id)).length;
    if (nota) nota.innerHTML = avisoTan + (escritas === 0
      ? `<div class="note bad"><b>Ninguna <span class="gr">μ</span> es tuya todavía, así que este gráfico aún no dice nada.</b> Con el prior CAPM, <span class="mono">μᵢ = r + βᵢ × prima</span> es proporcional a la beta por construcción: el «óptimo» es, mecánicamente, una apuesta por las betas altas. Abre las <span class="gr">μ</span> implícitas de aquí abajo y firma o corrige una por una.</div>`
      : escritas < F.ids.length
      ? `<div class="note warn"><b>${escritas} de ${F.ids.length} <span class="gr">μ</span> son tuyas.</b> Las demás siguen con el prior CAPM, que es proporcional a la beta. Mientras queden, el óptimo está medio dictado por β y no por tus tesis.</div>`
      : `<div class="note"><b>Las ${F.ids.length} <span class="gr">μ</span> son tuyas.</b> Ahora la frontera dice algo: es tu juicio pasado por la matriz de covarianzas, no una regresión contra el índice.</div>`);

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
