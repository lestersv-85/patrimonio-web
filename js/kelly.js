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
import { DB } from './store.js?v=3bf8a9f';
import { latestAtOrBefore } from './engine.js?v=3bf8a9f';

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

// El domingo que cierra la semana de una fecha. Sirve de etiqueta común para el muestreo semanal:
// si se agrupara por la fecha del último cierre de cada serie, dos activos cuyo último día hábil de
// la semana no coincide (Wall Street abierto un Viernes Santo, Tokio cerrado un lunes) no tendrían
// ni una sola fecha en común y la intersección saldría vacía.
const domingoDe = (d) => {
  const t = new Date(d + 'T00:00:00Z');
  const dow = (t.getUTCDay() + 6) % 7;            // lunes 0 … domingo 6
  t.setUTCDate(t.getUTCDate() + (6 - dow));
  return t.toISOString().slice(0, 10);
};
// Último cierre de cada semana, etiquetado por su domingo.
const aSemanal = (m) => {
  const out = new Map();
  for (const d of [...m.keys()].sort()) out.set(domingoDe(d), m.get(d));   // el orden deja el último
  return out;
};

// ---------- matriz de retornos sobre la ventana común ----------
// activos: [{ id, label, mapa, ccy }]. Devuelve los log-retornos alineados por fecha.
//
// `paso` 'semana' remuestrea a cierres semanales. No es un detalle de gusto: **el desfase horario
// entre Asia, Europa y EE.UU. hunde la correlación diaria**, porque el cierre de Tokio de hoy ya
// recoge la sesión americana de ayer y el de Nueva York todavía no. Medido en esta cartera el 18 sep
// 2026, ρ(mundial, emergentes) pasa de 0,3496 en diario a 0,5506 en semanal, un 57 % más. Con la
// diaria el optimizador se cree mucho más diversificado de lo que está, y eso es un error caro.
export function matriz(activos, desde, hasta, paso = 'dia') {
  const semanal = paso === 'semana';
  const hueco = semanal ? 10 : HUECO_MAX;         // una semana saltada son 14 días
  const series = [], faltan = [];
  for (const a of activos) {
    const s = serieEUR(a.mapa, a.ccy);
    if (!s) { faltan.push(a.label || a.id); continue; }
    let m = new Map();
    for (const [d, v] of s) if ((!desde || d >= desde) && (!hasta || d <= hasta)) m.set(d, v);
    if (semanal) m = aSemanal(m);
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
    if ((new Date(d1) - new Date(d0)) / 86400000 > hueco) continue;
    usadas.push(d1);
    series.forEach((s, k) => R[k].push(Math.log(s.m.get(d1) / s.m.get(d0))));
  }
  return { activos: series, fechas: usadas, R, faltan, arranque, limita };
}

// ---------- estadísticos ----------
const DIAS = 252;
export const media = v => v.reduce((s, x) => s + x, 0) / (v.length || 1);

// `porAno` es el número de observaciones que tiene un año con el muestreo que se le pasa: 252 para
// diario, 52 para semanal. Pasarlo mal no cambia los pesos relativos, pero sí las σ y las μ que se
// enseñan, y por tanto el Sharpe.
export function estadisticos(R, porAno = DIAS) {
  const mu = R.map(v => media(v) * porAno);
  const cov = covarianzas(R, porAno);
  const sigma = cov.map((f, i) => Math.sqrt(Math.max(0, f[i])));
  // El peor día es la mayor CAÍDA, no el mayor movimiento. Con `Math.max(|x|)` una posición cuyo mayor
  // salto fue al alza enseñaba esa subida con el signo menos que pone la tabla: siete de las diecinueve
  // fichas mostraban su mejor día disfrazado de peor, y HSBK imprimía «−23,8 %» en una sesión en que
  // subió 26,8 %. Se guarda como magnitud positiva porque así lo pintan la tabla y sus umbrales.
  const peor = R.map(v => Math.max(0, -v.reduce((m, x) => Math.min(m, x), 0)));   // con paso semanal, la peor SEMANA
  return { mu, sigma, cov, peor };
}

export function covarianzas(R, porAno = DIAS) {
  const n = R.length, T = R[0] ? R[0].length : 0;
  const m = R.map(media);
  const C = Array.from({ length: n }, () => new Array(n).fill(0));
  if (T < 2) return C;
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let s = 0;
      for (let t = 0; t < T; t++) s += (R[i][t] - m[i]) * (R[j][t] - m[j]);
      const v = s / (T - 1) * porAno;
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
      // Se reparte EXACTAMENTE el dinero que dejan los descartados, ni un euro más. El hueco que se
      // calculaba antes era la distancia de los supervivientes hasta el tope, así que la función
      // inflaba a todo el mundo hasta el tope aunque no hubiera descartado a nadie: con once activos
      // al 1 % de Kelly cada uno (10,9 % en total) devolvía 9,1 % a cada uno y la cartera al 100 %,
      // nueve veces la apuesta calculada. Una política de riesgo existe para reducir la apuesta.
      let liberado = 0;
      out = out.map(x => (x > 0 && x < suelo ? (descartados++, liberado += x, 0) : x));
      for (let it = 0; it < 12 && liberado > 1e-9; it++) {
        const libres = out.map(x => (x > 0 && x < tope ? tope - x : 0));
        const total = libres.reduce((s, x) => s + x, 0);
        if (total <= 1e-9) break;
        const reparto = Math.min(liberado, total);
        out = out.map((x, i) => x + reparto * libres[i] / total);
        liberado -= reparto;
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
  //
  // Y si la suma es NEGATIVA tampoco hay cartera de tangencia, aunque el álgebra devuelva números:
  // dividir por un negativo **invierte el signo de todos los pesos** y lo que sale es la cartera
  // espejo, que vive en la rama dominada, por debajo del tipo sin riesgo. El 18 sep 2026, con once
  // de diecinueve μ por debajo de r, esto devolvía una «tangencia» de μ −35,9 % y la línea del
  // mercado de capitales salía con pendiente NEGATIVA: el gráfico no estaba roto, estaba dibujando
  // con fidelidad un disparate. La tangencia solo existe si el conjunto bate al tipo sin riesgo.
  if (!isFinite(s) || s < 1e-9) return null;
  return F.map(f => f / s);
}

// Por qué no hay tangencia, para poder decirlo en pantalla en vez de un «no se puede dibujar».
// Devuelve null cuando sí la hay.
export function porQueNoHayTangencia(mu, cov, r) {
  const F = kellyMulti(mu, cov, r);
  if (!F) return 'matriz';
  const s = F.reduce((a, x) => a + x, 0);
  if (!isFinite(s)) return 'matriz';
  if (Math.abs(s) < 1e-9) return 'cancelan';
  if (s < 0) return 'nobate';
  return null;
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
  // Vértice de la hipérbola: la cartera de varianza mínima. Es la frontera entre la rama de arriba,
  // que es la EFICIENTE (para cada riesgo, el mayor retorno), y la de abajo, que está dominada:
  // mismo riesgo, menos retorno. Dibujarlas iguales confunde y gasta la mitad del alto del gráfico.
  const mvp = { mu: B / A, sigma: Math.sqrt(1 / A) };
  const out = [];
  for (let i = 0; i < n; i++) {
    const m = lo - (hi - lo) * 0.15 + (hi - lo) * 1.3 * (i / (n - 1));
    const v = (A * m * m - 2 * B * m + C) / D;
    if (v > 0) out.push({ sigma: Math.sqrt(v), mu: m, eficiente: m >= mvp.mu });
  }
  out.mvp = mvp;
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

// ---------- optimización SOLO LARGO: lo único que se puede ejecutar ----------
// La tangencia de `tangencia()` sale del álgebra sin restricciones y admite cortos: cuando no existe
// —porque la mejor mezcla no bate al tipo sin riesgo— no hay nada que enseñar. Pero la cartera que
// de verdad se puede comprar nunca lleva cortos, y ese problema **siempre tiene solución**. Estas
// tres funciones la resuelven.

// Proyección euclídea sobre el símplex {w ≥ 0, Σw = b} (Duchi et al., 2008). Es el paso que
// convierte un gradiente cualquiera en una cartera válida sin cortos.
const num0 = x => (isFinite(x) && x > 0 ? x : 0);
export function proySimplex(v, b = 1) {
  if (!v.length) return [];
  const u = [...v].sort((a, c) => c - a);
  let s = 0, rho = 0;
  for (let i = 0; i < u.length; i++) { s += u[i]; if (u[i] - (s - b) / (i + 1) > 0) rho = i + 1; }
  if (!rho) return v.map(() => b / v.length);
  const th = (u.slice(0, rho).reduce((a, c) => a + c, 0) - b) / rho;
  return v.map(x => Math.max(0, x - th));
}

// Proyección sobre el símplex ACOTADO {0 ≤ w ≤ tope, Σw = 1}.
//
// **Recortar al tope y renormalizar no vale, y es un error que cuesta caro.** Al dividir por la suma
// se vuelve a pasar del tope: con tope 15 % salían pesos del 15,6 % bajo una etiqueta que decía 15 %.
// Lo correcto es fijar en el tope las que se pasan, descontar su presupuesto y volver a proyectar el
// resto sobre lo que queda, repitiendo mientras aparezcan nuevas topadas.
export function proyAcotado(v, tope) {
  const n = v.length;
  // Un tope por debajo de 1/n es IMPOSIBLE: n posiciones que no pasen del tope no llegan a sumar 1.
  // Antes esto se resolvía ignorando el tope, que es justo la mentira que esta función existe para
  // evitar. Se sube el tope efectivo a 1/n —la equiponderada, el único punto factible en el límite—
  // y así lo que se devuelve nunca pasa del tope que de verdad se ha podido aplicar.
  const t = Math.max(num0(tope), 1 / n);
  const fijo = new Array(n).fill(false);
  for (let it = 0; it <= n; it++) {
    const lib = v.map((_, i) => i).filter(i => !fijo[i]);
    const gastado = fijo.reduce((a, f) => a + (f ? t : 0), 0);
    const sub = proySimplex(lib.map(i => v[i]), 1 - gastado);
    const exc = lib.filter((i, j) => sub[j] > t + 1e-12);
    if (!exc.length) { const o = v.map((_, i) => (fijo[i] ? t : 0)); lib.forEach((i, j) => (o[i] = sub[j])); return o; }
    exc.forEach(i => (fijo[i] = true));
  }
  return v.map(() => 1 / n);
}

// Máximo Sharpe SOLO LARGO por gradiente proyectado, con suelo y/o tope por posición.
//
// El suelo y el tope dicen cosas contrarias y no son intercambiables:
//  · **tope**  — «ninguna puede pasar de esto». Reparte, y cuantas más plazas quieras, más bajo.
//  · **suelo** — «todas las plazas tienen que llevar algo». Es lo que hay que usar cuando el número
//                de nombres está decidido de antemano y se quiere que salgan con PESOS DISTINTOS:
//                el óptimo libre deja a varias en cero y te quedas con menos nombres de los pedidos.
// Gradiente de Sharpe: ∂/∂wᵢ (μₚ−r)/σ = μᵢ/σ − (μₚ−r)(Σw)ᵢ/σ³.
export function maxSharpeLargo(mu, cov, r, { suelo = 0, tope = 1, pasos = 20000, paso = 0.02 } = {}) {
  const n = mu.length;
  if (!n) return [];
  if (n === 1) return [1];
  const sueloOk = suelo > 0 && suelo * n < 1 ? suelo : 0;
  const libre = 1 - sueloOk * n;
  const Sw = w => cov.map(f => f.reduce((s, x, j) => s + x * w[j], 0));
  let w = new Array(n).fill(1 / n);
  for (let it = 0; it < pasos; it++) {
    const sw = Sw(w);
    const v = w.reduce((s, x, i) => s + x * sw[i], 0);
    const sd = Math.sqrt(Math.max(v, 1e-18));
    const m = w.reduce((s, x, i) => s + x * mu[i], 0);
    const g = w.map((_, i) => mu[i] / sd - (m - r) * sw[i] / (v * sd));
    if (!g.every(x => isFinite(x))) break;
    const paso1 = w.map((x, i) => x + paso * g[i]);
    w = sueloOk
      ? proySimplex(paso1.map(x => x - sueloOk), libre).map(x => x + sueloOk)
      : proyAcotado(paso1, tope);
  }
  return w;
}

// De dónde sale el riesgo: la contribución de cada posición a la σ de la mezcla, wᵢ(Σw)ᵢ/σ.
// Suma exactamente σ, y es el número que desmiente «solo es un 15 % de la cartera».
export function contribucionRiesgo(w, cov) {
  const sw = cov.map(f => f.reduce((s, x, j) => s + x * w[j], 0));
  const v = w.reduce((s, x, i) => s + x * sw[i], 0);
  const sd = Math.sqrt(Math.max(0, v));
  if (!(sd > 0)) return w.map(() => 0);
  return w.map((x, i) => x * sw[i] / sd);
}
