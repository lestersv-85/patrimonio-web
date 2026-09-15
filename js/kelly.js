// Criterio de Kelly: dimensionado de posiciones a partir de series diarias reales en euros.
//
// Kelly (1956) y Thorp (2006) dan la fracción del capital que maximiza el crecimiento logarítmico
// esperado. Para un activo con retorno esperado μ, volatilidad σ y tipo sin riesgo r: f* = (μ−r)/σ².
// Para varios activos correlacionados: F* = Σ⁻¹(μ − r·1). Sumar f* individuales sobreestima la
// exposición porque ignora la correlación; por eso el taller enseña las dos columnas.
//
// Tres cosas que este módulo hace distintas de la receta de libro, y por qué:
//  1. La ventana es la intersección de fechas con dato en TODOS los activos pedidos. Rellenar huecos
//     con el último precio inventa correlación (dos activos que no se movieron el mismo día parecen
//     moverse juntos). Se dice cuántos días quedan y quién los limita.
//  2. Σ se encoge hacia su diagonal. Con n observaciones y N activos, Σ⁻¹ es ruido amplificado
//     cuando n/N es pequeño; encoger las covarianzas fuera de la diagonal es el remedio clásico
//     (Ledoit-Wolf). Sin esto el «óptimo» cambia de signo al mover la ventana un mes.
//  3. μ por defecto es un prior CAPM (r + β·prima), no la media histórica. La media histórica de un
//     año dice que Boston Scientific rinde −80 % anual: sirve para enseñar por qué no se usa.
import { DB } from './store.js?v=57b99b9';
import { latestAtOrBefore } from './engine.js?v=57b99b9';

export const HUECO_MAX = 7;      // días naturales: un salto mayor no es un retorno diario
export const MIN_DIAS = 60;      // por debajo de esto no hay covarianza que merezca el nombre

// ---------- series en euros ----------
// Precio de cierre convertido a euros con el cambio BCE de ese mismo día (el último publicado
// si la fecha cae en fin de semana o festivo).
function serieEUR(mapa, ccy) {
  if (!mapa) return null;
  const out = [];
  for (const d of Object.keys(mapa).sort()) {
    const c = mapa[d];
    if (c == null || !isFinite(c) || c <= 0) continue;
    const fx = !ccy || ccy === 'EUR' ? 1 : (latestAtOrBefore(DB.fx[ccy], d) || {}).value;
    if (!fx) continue;
    out.push([d, c * fx]);
  }
  return out.length ? out : null;
}

// ---------- matriz de retornos sobre la ventana común ----------
// activos: [{ id, label, mapa, ccy }]. Devuelve los log-retornos alineados por fecha.
export function matriz(activos, desde, hasta) {
  const series = [], faltan = [];
  for (const a of activos) {
    const s = serieEUR(a.mapa, a.ccy);
    if (!s) { faltan.push(a.label || a.id); continue; }
    const m = new Map();
    for (const [d, v] of s) if ((!desde || d >= desde) && (!hasta || d <= hasta)) m.set(d, v);
    if (m.size < 2) { faltan.push(a.label || a.id); continue; }
    series.push({ ...a, m });
  }
  if (!series.length) return { activos: [], fechas: [], R: [], faltan, arranque: null, limita: null };

  // La ventana común empieza donde empieza el más joven: es quien manda
  let arranque = null, limita = null;
  for (const s of series) {
    const p = [...s.m.keys()].sort()[0];
    if (!arranque || p > arranque) { arranque = p; limita = s.label || s.id; }
  }
  // Fechas con precio en todos a la vez
  const fechas = [...series[0].m.keys()].filter(d => d >= arranque && series.every(s => s.m.has(d))).sort();

  // Log-retornos, descartando los saltos con hueco largo (un puente de tres semanas no es un día)
  const R = series.map(() => []);
  const usadas = [];
  for (let i = 1; i < fechas.length; i++) {
    const d0 = fechas[i - 1], d1 = fechas[i];
    if ((new Date(d1) - new Date(d0)) / 86400000 > HUECO_MAX) continue;
    usadas.push(d1);
    series.forEach((s, k) => R[k].push(Math.log(s.m.get(d1) / s.m.get(d0))));
  }
  return { activos: series, fechas: usadas, R, faltan, arranque, limita };
}

// ---------- estadísticos ----------
const DIAS = 252;
export const media = v => v.reduce((s, x) => s + x, 0) / (v.length || 1);

export function estadisticos(R) {
  const mu = R.map(v => media(v) * DIAS);
  const cov = covarianzas(R);
  const sigma = cov.map((f, i) => Math.sqrt(Math.max(0, f[i])));
  const peor = R.map(v => v.reduce((m, x) => Math.max(m, Math.abs(x)), 0));
  return { mu, sigma, cov, peor };
}

export function covarianzas(R) {
  const n = R.length, T = R[0] ? R[0].length : 0;
  const m = R.map(media);
  const C = Array.from({ length: n }, () => new Array(n).fill(0));
  if (T < 2) return C;
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let s = 0;
      for (let t = 0; t < T; t++) s += (R[i][t] - m[i]) * (R[j][t] - m[j]);
      const v = s / (T - 1) * DIAS;
      C[i][j] = v; C[j][i] = v;
    }
  }
  return C;
}

// Encogimiento hacia la diagonal: conserva las varianzas y encoge las covarianzas. λ=0 deja la
// matriz cruda, λ=1 la vuelve diagonal (como si nada estuviera correlacionado).
export function encoger(C, lam) {
  const n = C.length;
  return C.map((f, i) => f.map((v, j) => (i === j ? v : v * (1 - lam))));
}

// Beta contra un índice ya incluido en la matriz (su columna), para el prior CAPM
export function betas(cov, idx) {
  if (idx < 0 || !cov[idx] || !cov[idx][idx]) return cov.map(() => null);
  return cov.map((f) => f[idx] / cov[idx][idx]);
}

// Beta calculada activo a activo contra la referencia, sobre la intersección de ESE par.
// Meter el índice en la matriz común sería un error caro: si su serie es más pobre que las demás
// (por ejemplo mensual mientras los activos son diarios), arrastra la ventana de todos al suelo.
// Medido en esta cartera: 19 acciones comparten 239 días entre ellas y solo 5 con un índice mensual.
export function betaPareja(mapaA, mapaRef, ccyA, ccyRef) {
  if (!mapaA || !mapaRef) return null;
  const M = matriz([{ id: 'a', ccy: ccyA, mapa: mapaA }, { id: 'ref', ccy: ccyRef, mapa: mapaRef }]);
  if (M.R.length < 2 || M.R[0].length < 30) return null;
  const C = covarianzas(M.R);
  return C[1][1] ? C[0][1] / C[1][1] : null;
}

// ---------- álgebra ----------
// Inversa por eliminación de Gauss con pivote parcial. Sin librerías: la web no carga ninguna.
export function inversa(M) {
  const n = M.length;
  const A = M.map((f, i) => [...f, ...M.map((_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-14) return null;   // singular: se avisa, no se inventa
    [A[c], A[p]] = [A[p], A[c]];
    const d = A[c][c];
    for (let k = 0; k < 2 * n; k++) A[c][k] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c || !A[r][c]) continue;
      const f = A[r][c];
      for (let k = 0; k < 2 * n; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map(f => f.slice(n));
}

// ---------- Kelly ----------
// f* individual: (μ−r)/σ². Ignora que los activos se mueven juntos, así que suma de más.
export const kellyIndividual = (mu, cov, r) => mu.map((m, i) => (cov[i][i] ? (m - r) / cov[i][i] : 0));

// F* multiactivo: Σ⁻¹(μ − r·1). Devuelve null si Σ no se puede invertir.
export function kellyMulti(mu, cov, r) {
  const Si = inversa(cov);
  if (!Si) return null;
  const ex = mu.map(m => m - r);
  return Si.map(f => f.reduce((s, v, j) => s + v * ex[j], 0));
}

// Tamaños con la política puesta encima: fracción c, sin cortos, tope y suelo por posición, y
// sin apalancar. Lo que se recorta se dice, no se reparte en silencio.
// `sueloModo` decide qué hacer con lo que el modelo quiere en tamaño pequeño:
//  · 'subir'     — lo sube hasta el suelo. Es **apostar de más** justo donde el modelo dice que no
//                  hay ventaja, y sobreapostar se castiga mucho más que infraapostar.
//  · 'descartar' — lo deja fuera y su dinero se reparte entre las demás. Es la forma honesta de
//                  decir «solo quiero posiciones con convicción»: menos posiciones, no mínimos mayores.
export function aplicarPolitica(F, { c = 0.5, tope = 0.15, suelo = 0, sueloModo = 'descartar' } = {}) {
  const w = F.map(f => f * c);
  const negativos = w.filter(x => x < 0).length;
  let out = w.map(x => (x < 0 ? 0 : Math.min(x, tope)));
  const topados = w.filter(x => x > tope).length;
  let descartados = 0;
  if (suelo > 0) {
    if (sueloModo === 'subir') out = out.map(x => (x > 0 && x < suelo ? suelo : x));
    else {
      // Descartar y repartir: se quitan los pequeños y su peso se devuelve al resto en proporción,
      // respetando el tope. Se repite porque al repartir pueden aparecer nuevos topados.
      out = out.map(x => (x > 0 && x < suelo ? (descartados++, 0) : x));
      for (let it = 0; it < 12; it++) {
        const suma = out.reduce((s, x) => s + x, 0);
        const hueco = Math.min(1, F.reduce((s, f, i) => s + (out[i] > 0 ? tope : 0), 0)) - suma;
        if (hueco <= 1e-9 || suma <= 0 || suma >= 1) break;
        const libres = out.map(x => (x > 0 && x < tope ? tope - x : 0));
        const total = libres.reduce((s, x) => s + x, 0);
        if (total <= 1e-9) break;
        const reparto = Math.min(hueco, 1 - suma);
        out = out.map((x, i) => x + reparto * libres[i] / total);
      }
    }
  }
  const suma = out.reduce((s, x) => s + x, 0);
  let apalancado = false;
  if (suma > 1) { apalancado = true; out = out.map(x => x / suma); }
  return { w: out, suma: out.reduce((s, x) => s + x, 0), negativos, topados, apalancado, descartados };
}

// Crecimiento esperado de la mezcla (Thorp 2006, ec. 7.3 generalizada):
// g = r + wᵀ(μ − r·1) − wᵀΣw/2, y su volatilidad √(wᵀΣw).
export function crecimiento(w, mu, cov, r) {
  const n = w.length;
  let exceso = 0, varianza = 0;
  for (let i = 0; i < n; i++) {
    exceso += w[i] * (mu[i] - r);
    for (let j = 0; j < n; j++) varianza += w[i] * cov[i][j] * w[j];
  }
  return { g: r + exceso - varianza / 2, vol: Math.sqrt(Math.max(0, varianza)), exceso };
}

// ---------- Kelly discreto: el original de 1956, el que sí sabe que existe el cero ----------
//
// La formulación continua de arriba (f* = (μ−r)/σ², F* = Σ⁻¹(μ−r·1)) supone que el precio se mueve
// SIN SALTOS: si cae, te da tiempo a rebalancear antes de arruinarte. Por construcción su
// probabilidad de ruina es cero. En la realidad los precios saltan —en esta cartera hay días de
// −29,3 % (UMG), −22,6 % (UNH) y −18,1 % (NVO)— y contra un salto no hay rebalanceo que valga.
// Consecuencia: el modelo continuo SOBREDIMENSIONA sistemáticamente todo lo que tenga riesgo de
// deterioro permanente. Es exactamente el reproche de Taleb: no rechaza Kelly, rechaza calcularlo
// con media y desviación típica.
//
// Kelly (1956) parte de una distribución discreta de resultados y maximiza E[ln(1 + f·R)]. Para el
// caso de dos resultados sale la fórmula cerrada f* = p/L − (1−p)/b. Para tres o más no hay fórmula
// cerrada, pero la derivada es monótona decreciente y la raíz se encuentra por bisección en dos
// líneas. Se resuelve el caso general porque una tesis real tiene al menos tres desenlaces: sale
// bien, se queda en nada, o se deteriora sin vuelta atrás.
//
// escenarios: [{ p, r }] con p probabilidad (suman 1) y r retorno de la apuesta (−1 = pérdida total).
// Devuelve la fracción del capital, o null si los datos no son coherentes.
export function kellyDiscreto(escenarios) {
  if (!escenarios || escenarios.length < 2) return null;
  const suma = escenarios.reduce((s, e) => s + e.p, 0);
  if (Math.abs(suma - 1) > 1e-6) return null;            // si no suman 1, no es una distribución
  const esperado = escenarios.reduce((s, e) => s + e.p * e.r, 0);
  if (esperado <= 0) return 0;                           // sin ventaja esperada no se apuesta nada
  const peor = Math.min(...escenarios.map(e => e.r));
  if (peor >= 0) return Infinity;                        // si no se puede perder, Kelly no acota
  const fMax = -1 / peor;                                // más allá, 1 + f·r ≤ 0: ruina segura
  const g = f => escenarios.reduce((s, e) => s + e.p * e.r / (1 + f * e.r), 0);
  let lo = 0, hi = fMax * (1 - 1e-12);
  if (g(hi) > 0) return hi;
  for (let i = 0; i < 300; i++) { const m = (lo + hi) / 2; if (g(m) > 0) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

// Una tesis en la forma en que se piensa: en N años, con probabilidad p sube `alza`; con probabilidad
// `pRuina` se deteriora sin vuelta y pierdes `perdida`; el resto del tiempo pasa el caso base.
// Devuelve los escenarios, el retorno esperado anualizado (μ implícita) y el Kelly discreto.
export function tesisAEscenarios({ p = 0, alza = 0, pRuina = 0, perdida = 100, base = 0, anos = 3 }) {
  const pp = p / 100, pr = pRuina / 100, pb = 1 - pp - pr;
  if (pp < 0 || pr < 0 || pb < -1e-9) return { error: 'Las dos probabilidades juntas pasan del 100 %.' };
  const esc = [
    { nm: 'se cumple', p: pp, r: alza / 100 },
    { nm: 'caso base', p: Math.max(0, pb), r: base / 100 },
    { nm: 'deterioro', p: pr, r: -Math.abs(perdida) / 100 },
  ].filter(e => e.p > 1e-9);
  const totalEsperado = esc.reduce((s, e) => s + e.p * e.r, 0);
  const n = Math.max(0.25, anos);
  // Anualizar el retorno total del horizonte. Con pérdida total posible, la media aritmética puede
  // ser negativa; entonces no hay raíz n-ésima real y se devuelve null en vez de inventar una cifra.
  const muAnual = 1 + totalEsperado > 0 ? Math.pow(1 + totalEsperado, 1 / n) - 1 : null;
  return { esc, totalEsperado, muAnual, f: kellyDiscreto(esc) };
}

// Tabla de Kelly fraccional (Thorp 2006, §7.4): apostando c·f* se conserva c(2−c) del crecimiento
// máximo con c veces la desviación típica, y la probabilidad de ver el capital reducido a la mitad
// en algún momento es 0,5^(2/c − 1). Medio Kelly es media desviación típica, no media varianza.
export const FRACCIONES = [
  { c: 0.25, nm: '¼' }, { c: 0.5, nm: '½' }, { c: 0.75, nm: '¾' }, { c: 1, nm: 'completo' },
].map(f => ({ ...f, crec: f.c * (2 - f.c), ruina: Math.pow(0.5, 2 / f.c - 1) }));

// Escenario binario asimétrico: ganas b por unidad con probabilidad p, pierdes la fracción L con 1−p.
// f* = p/L − (1−p)/b. Con L=1 se reduce al Kelly clásico.
export const kellyBinario = (p, b, L = 1) => (b > 0 && L > 0 ? p / L - (1 - p) / b : null);

// ---------- Frontera eficiente, tangencia y μ implícitas (Markowitz 1952) ----------
//
// Nada de esto es un método nuevo: es el MISMO álgebra que ya hace `kellyMulti`, mirada desde otro
// lado. Por eso vive aquí y se dibuja en el taller, y no en una pestaña aparte con su propia
// selección de activos, su propia ventana y su propia base de capital — tres sitios donde discrepar
// del taller y acabar con dos respuestas «oficiales» que no cuadran.

// Portafolio de tangencia: el de máximo Sharpe. Es **el vector de `kellyMulti` normalizado a sumar 1**.
// Kelly dice qué fracción del capital total poner; tangencia, en qué proporciones repartir el dinero
// que se pone. Mismo Σ⁻¹(μ − r·1), distinto denominador.
export function tangencia(mu, cov, r) {
  const F = kellyMulti(mu, cov, r);
  if (!F) return null;
  const s = F.reduce((a, x) => a + x, 0);
  // Si la suma es ~0 el vector no se puede normalizar: pasa cuando los excesos se cancelan y no hay
  // una cartera de riesgo preferida. Devolver null es más honesto que dividir por casi cero.
  if (!isFinite(s) || Math.abs(s) < 1e-9) return null;
  return F.map(f => f / s);
}

// σ y μ de una mezcla cualquiera. `crecimiento()` ya da la volatilidad, pero necesita r y devuelve g;
// aquí hacen falta las dos coordenadas crudas para situar un punto en el gráfico.
export function puntoRiesgoRetorno(w, mu, cov) {
  const n = w.length;
  let m = 0, v = 0;
  for (let i = 0; i < n; i++) {
    m += w[i] * mu[i];
    for (let j = 0; j < n; j++) v += w[i] * cov[i][j] * w[j];
  }
  return { mu: m, sigma: Math.sqrt(Math.max(0, v)) };
}

// Frontera SIN restricciones, por el teorema de los dos fondos. Admite cortos, como la del vídeo:
// es la hipérbola completa, no la frontera larga. Se dibuja para situar los puntos, no para operarla.
export function fronteraEficiente(mu, cov, n = 60) {
  const Si = inversa(cov);
  if (!Si) return null;
  const k = mu.length, uno = new Array(k).fill(1);
  const por = (M, v) => M.map(f => f.reduce((s, x, j) => s + x * v[j], 0));
  const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
  const Su = por(Si, uno), Sm = por(Si, mu);
  const A = dot(uno, Su), B = dot(uno, Sm), C = dot(mu, Sm), D = A * C - B * B;
  if (!isFinite(D) || Math.abs(D) < 1e-18) return null;
  const lo = Math.min(...mu), hi = Math.max(...mu);
  const out = [];
  for (let i = 0; i < n; i++) {
    const m = lo - (hi - lo) * 0.15 + (hi - lo) * 1.3 * (i / (n - 1));
    const v = (A * m * m - 2 * B * m + C) / D;
    if (v > 0) out.push({ sigma: Math.sqrt(v), mu: m });
  }
  return out;
}

// Optimización inversa: **la μ que haría óptimos los pesos que ya tienes**.
//
// Es la pregunta del revés, y es la única que un humano sabe contestar. Nadie sabe decir en frío
// cuánto rendirá McDonald's a cinco años; cualquiera sabe mirar «tu cartera de hoy afirma un 5,4 %»
// y decir si lo firma o no. μ = r + δ·Σw, con δ = prima / (wᵀΣw) para que la prima del conjunto sea
// la que se le pide al tramo (Sharpe implícito = prima / σ).
export function implicitas(w, cov, r, prima) {
  const n = w.length;
  let v = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) v += w[i] * cov[i][j] * w[j];
  if (!(v > 0)) return null;
  const delta = prima / v;
  return { delta, mu: cov.map(f => r + delta * f.reduce((s, x, j) => s + x * w[j], 0)) };
}
