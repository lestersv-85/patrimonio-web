// Utilidades de formato y fechas (es-ES, base EUR)
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
export const pad2 = n => String(n).padStart(2, '0');
export const isoDate = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const todayISO = () => isoDate(new Date());
export const nowHM = () => new Date().toTimeString().slice(0, 5);
export const parseISO = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d || 1); };
export const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);
export const monthEnd = ym => { const [y, m] = ym.split('-').map(Number); return isoDate(new Date(y, m, 0)); };
export const monthKey = iso => String(iso).slice(0, 7);
export const addMonths = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; };
export const addDays = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return isoDate(d); };
export const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const nf = (min, max) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: min, maximumFractionDigits: max });
export const fmtEUR = (n, d = 2) => { if (n == null || isNaN(n)) return '—'; if (Math.abs(n) < Math.pow(10, -d) / 2) n = 0; return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: d, maximumFractionDigits: d }).format(n); };
export const fmtK = n => (n == null || isNaN(n)) ? '—' : Math.abs(n) < 0.5 ? '0 €' : Math.abs(n) >= 1e6 ? nf(0, 2).format(n / 1e6) + ' M€' : Math.abs(n) >= 1e4 ? nf(0, 1).format(n / 1e3) + ' k€' : fmtEUR(n, 0);
export const fmtN = (n, d = 2) => (n == null || isNaN(n)) ? '—' : nf(0, d).format(n);
export const fmtPct = (n, d = 2) => (n == null || isNaN(n)) ? '—' : (n > 0 ? '+' : '') + fmtN(n, d) + ' %';
export const fmtCcy = (n, ccy, d = 2) => { if (n == null || isNaN(n)) return '—'; const s = fmtN(n, d); return ccy === 'EUR' ? s + ' €' : ccy === 'USD' ? '$' + s : s + ' ' + (ccy || ''); };
export const fmtDate = iso => { if (!iso) return ''; const [y, m, d] = String(iso).split('-'); return `${+d} ${MONTHS[+m - 1]} ${y}`; };
export const fmtYM = ym => { const [y, m] = ym.split('-'); return `${MONTHS[+m - 1]} ${y.slice(2)}`; };
export const num = v => { if (v === '' || v == null) return 0; const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? 0 : n; };
export const cls = n => n > 0 ? 'pos' : n < 0 ? 'neg' : '';
export const sum = (arr, f) => arr.reduce((s, x) => s + (f ? f(x) : x), 0);
export const r2 = n => Math.round(n * 100) / 100;
export function toast(msg) { const t = $('#toast'); if (!t) return; t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600); }

export const TYPES = { stock: 'Acción', etf: 'ETF', fund: 'Fondo', plan: 'Plan de pensiones', crypto: 'Cripto', cash: 'Efectivo', custom: 'Otro', option: 'Opción' };
export const TYPE_SHORT = { stock: 'ACC', etf: 'ETF', fund: 'FDO', plan: 'PP', crypto: 'CTO', cash: 'EFE', custom: 'OTR', option: 'OPC' };
// Paleta base (rojo · amarillo · azul) y paleta categórica de 16 tonos bien separados para que sectores, regiones y cuentas no se confundan
export const C = { blue: '#3F51B5', blue2: '#7986CB', blue3: '#9FA8DA', blue4: '#C5CAE9', yellow: '#FFD600', yellow2: '#FFE45C', yellow3: '#FFF59D', yellow4: '#FFF9C4', red: '#E53935', red2: '#EF6C63', red3: '#F9B6B0', red4: '#FCDAD7', cash: '#43A047', cyan: '#00ACC1', orange: '#FF7043', purple: '#8E24AA', pos: '#3F51B5', neg: '#E53935', avg: '#C5CAE9' };
export const BUCKETS = {
  1: { name: 'Renta variable', short: 'Cubo 1 · RV', color: C.blue, job: 'El motor. Produce el retorno', wins: 'recuperacion' },
  2: { name: 'Oro y cripto', short: 'Cubo 2 · Oro y cripto', color: C.yellow, job: 'Reserva de valor', wins: 'sobrecalentamiento' },
  3: { name: 'Renta fija y caja', short: 'Cubo 3 · RF y caja', color: C.cyan, job: 'El colchón y la pólvora', wins: 'estanflacion' },
  4: { name: 'No rebalancea', short: 'Cubo 4 · No rebalancea', color: C.orange, job: 'Lastre estructural', wins: '' },
};
export const HELP = {
  mwr: 'Qué es: la rentabilidad ponderada por dinero (TIR) de las posiciones: compras como entradas, ventas y dividendos como salidas, igual que Filios. Qué te dice: lo que ha ganado tu dinero contando cuándo entró y salió cada euro; una aportación grande justo antes de una caída pesa más que una pequeña. Cada barra es un mes; la línea discontinua es la media geométrica mensual, la que repetida cada mes daría el mismo acumulado.',
  mwrsp: 'Qué es: barras con el MWR de cada mes de la selección y línea amarilla con la variación mensual del S&P 500. Qué te dice: si tu dinero hizo mejor o peor que el índice ese mes. En modo acumulado ambas parten de 100 y se ve la distancia total.',
  twr: 'Qué es: la rentabilidad ponderada por tiempo (Dietz modificado): mide la gestión de la cartera sin el efecto de las aportaciones y retiradas. Qué te dice: cómo lo han hecho tus elecciones de activos, y es la cifra comparable con un índice. Línea discontinua: media geométrica mensual.',
  ror: 'Qué es: el crecimiento simple del valor entre el inicio y el final del periodo, aportaciones incluidas. Qué te dice: cuánto ha crecido el saldo, sin distinguir lo que ganaste de lo que aportaste; por eso es mayor que el MWR cuando aportas.',
  valor: 'Qué es: el valor de mercado de las posiciones de la selección al cierre de cada mes (línea continua), sin efectivo salvo que elijas el tipo Efectivo, igual que Filios, frente al capital aportado: valor al inicio del periodo más entradas netas acumuladas (línea discontinua). Qué te dice: la distancia entre ambas es la ganancia; si se cruzan, estás por debajo de lo aportado.',
  compras: 'Qué es: dinero destinado a compras y recibido por ventas cada mes, con comisiones e impuestos. Qué te dice: tu ritmo de inversión y de rotación. La línea discontinua es la mediana de las compras: con meses muy dispares representa mejor el mes típico que la media.',
  dividendos: 'Qué es: dividendos y cupones brutos cobrados cada mes, antes de retenciones. Qué te dice: la renta que produce la cartera y su estacionalidad. La línea discontinua es la media mensual (el total del periodo entre sus meses).',
  evolucion: 'Qué es: el valor en euros de la cartera al cierre de cada mes, con tres curvas. «Valor de mercado» es lo que vale hoy lo que tienes abierto; «invertido» es lo que te costó eso mismo, no la suma de todo lo que has aportado nunca; «con rentas cobradas» suma los dividendos netos y las plusvalías ya realizadas. Qué te dice: la distancia entre las dos primeras es la ganancia latente, y la que hay hasta la tercera es dinero que ya entró. El periodo y la selección se eligen en los filtros de arriba.',
  estilo: 'Qué es: cómo gana dinero cada posición — compounder, crecimiento, defensiva, cíclica, valor, renta o especulativa para las acciones, y RV indexada, renta fija o cripto para lo que no es una acción, que no tiene estilo propio sino el de lo que lleva dentro. Qué te dice: es la tercera clasificación y responde a una pregunta distinta de las otras dos. El sector dice de qué va la empresa, el cajón dice cuándo la vendes (tu regla de venta) y el estilo dice qué tiene que pasar para que suba. Una cartera puede estar bien repartida por sector y seguir siendo toda la misma apuesta si todo es crecimiento. Se edita en Posiciones.',
  cubo: 'Qué es: los cuatro cubos de la doctrina: 1 renta variable, 2 oro y cripto, 3 renta fija y caja, 4 lo que no rebalancea (ilíquido o bloqueado). Qué te dice: el peso de cada uno frente a su objetivo; el rebalanceo mueve dinero entre los tres primeros.',
  tipo: 'Qué es: reparto por tipo de activo: acciones, fondos, ETF, cripto, planes, otros y efectivo. Qué te dice: cuánta liquidez y cuánta complejidad fiscal tienes (los fondos se traspasan sin peaje; las acciones no).',
  cajones: 'Qué es: dentro del cubo 1, cada posición vive en un cajón según su regla de venta: núcleo, tesis, índice (válvula), especulativa, reserva o en venta. Qué te dice: si la válvula (índice) tiene tamaño para rebalancear y si hay demasiadas tesis o especulativas.',
  region: 'Qué es: reparto por región de exposición del activo. Qué te dice: la concentración geográfica y el riesgo de divisa asociado.',
  sector: 'Qué es: reparto por sector económico. Qué te dice: si la cartera depende de un solo motor (tecnología, financiero…) o está repartida.',
  cuenta: 'Qué es: reparto por bróker o wallet, efectivo incluido. Qué te dice: el riesgo de custodia por entidad y qué parte está fuera de España (modelo 720).',
  divisa: 'Qué es: reparto por divisa de cotización. Qué te dice: lo que no es euro tiene riesgo de cambio; un dólar más débil resta valor aunque las acciones no bajen.',
  nucleo: 'Qué es: sectores del núcleo frente a su peso de diseño (8 sectores, 2 nombres como máximo por sector). Qué te dice: qué sector se ha salido de banda por subir o por bajar, y cuál está vacío.',
  anual: 'Qué es: la rentabilidad de cada año natural calculada aquí con el cambio del BCE. MWR y TWR son de la cartera de inversión (posiciones, sin efectivo ni Casa 98). Qué te dice: cómo ha ido cada año frente al S&P 500. La columna «MWR con Casa 98» usa el mismo perímetro que Filios (vivienda incluida, sin efectivo) para poder compararla con el MWR que publicaba Filios; lo que queda de diferencia viene de cuándo se fecharon las tasaciones manuales y de traspasos de fondos incoherentes en Filios.',
  media: 'La línea discontinua es el estadístico de referencia del periodo: media geométrica para rentabilidades, mediana para compras y media para dividendos.',
  fase: 'Qué es: la fase del reloj de inversión estimada con datos reales: crecimiento (S&P 500 a 6 meses y frente a su media de 200 sesiones, ratio cobre/oro, curva 10 años menos 3 meses, regla de Sahm con el paro) e inflación (IPC interanual frente a su media de 6 meses, Brent a 6 meses). Qué te dice: qué cubo gana en esta fase y con qué prioridad rebalancear. Un cambio se confirma con dos lecturas mensuales seguidas.',
  // Dimensionado (criterio de Kelly)
  tk_mano: 'Qué es: el capital de las posiciones que Kelly no dimensiona — por defecto fondos y cripto — cuyo peso escribes tú a mano. Qué te dice: ese dinero ya tiene dueño y sale del bote antes de repartir, así que el modelo solo optimiza lo que queda. Sin esto, el taller propondría mover euros que no están en juego. Por qué quedan fuera: de un fondo no hay tesis con desenlaces y de la cripto no hay objetivo de analista ni valor razonable publicado, así que su μ saldría del prior CAPM, la estimación más floja de la pantalla. Corrección de lo que decía antes esta ayuda: NO es porque su σ medida salga baja por valorar una vez al día. Medido sobre estos fondos, la σ calculada y la publicada quedan dentro de ±1,5 puntos, y la medida es mayor en 3 de 8. Se pueden activar todos con el interruptor «Dimensionar también fondos y cripto», o uno a uno con «↩ a Kelly».',
  tk_dimtodo: 'Qué es: mete fondos y cripto en el reparto de Kelly en vez de dejar que escribas su peso. Qué te dice: qué haría el modelo si tratara un fondo como una acción más. Qué NO te dice: un tamaño en el que apoyarte. Sin tesis escrita, su μ es el prior CAPM (tipo sin riesgo + β × prima), así que lo que sale mide su beta y su correlación, no una convicción tuya. Úsalo para comparar carteras, y fíjate en la columna «Ventana»: un fondo joven recorta la ventana común de todos los demás.',
  tk_suelomodo: 'Qué es: qué hacer con las posiciones a las que el modelo asigna menos que el suelo. Qué te dice: «se descarta y se reparte» las deja fuera y da su dinero a las demás — es la forma honesta de exigir convicción: menos posiciones, no mínimos mayores. «Se sube hasta el suelo» las infla hasta el mínimo, que es apostar de más justo donde el modelo dice que no hay ventaja, y sobreapostar se castiga mucho más que infraapostar (en f = 2f* el crecimiento esperado es cero).',
  tk_base: 'Qué es: el dinero que este taller puede repartir: posiciones con mercado más efectivo. Qué te dice: sobre qué capital se calculan los tamaños. Las casas, Reental y el plan no entran aunque sean tuyos: no se pueden reasignar mañana, así que el modelo pediría órdenes que no podrías financiar, y como no tienen serie de precios su volatilidad medida saldría casi cero y Kelly los leería como activos sin riesgo.',
  tk_sinmercado: 'Qué es: lo que vale tu patrimonio sin cotización: inmuebles, tokens de Reental, plan de pensiones y xReental. Qué te dice: cuánto de tu riqueza no puedes mover. Está aquí para que veas la concentración, no para dimensionarla: sus tasaciones son escalones fechados, no precios de mercado.',
  tk_r: 'Qué es: el tipo sin riesgo, la facilidad de depósito del BCE. Qué te dice: el listón que tiene que superar cada activo. Kelly dimensiona el exceso sobre este tipo (μ − r): si una posición no lo bate, su tamaño óptimo es cero o negativo.',
  tk_prima: 'Qué es: la prima de riesgo con la que se construye el μ de partida: μ = r + β × prima. Qué te dice: cuánto supones que paga el mercado por encima del tipo sin riesgo. Es un supuesto tuyo, no un dato: el 5 % es la media larga histórica de la bolsa, y no tiene por qué repetirse.',
  tk_tope: 'Qué es: el peso máximo que puede alcanzar una posición. Qué te dice: dónde manda tu política y no el modelo. Kelly no sabe de riesgo de empresa concreta ni de liquidez: el tope es tu protección contra un μ demasiado optimista en un solo nombre.',
  tk_suelo: 'Qué es: el peso mínimo de una posición marcada que no se vaya a cero. Qué te dice: si quieres obligar a que todas las marcadas cuenten. Con suelo 0 dejas que el modelo diga cuáles no quiere; con 3-5 % le obligas a repartir.',
  tk_lam: 'Qué es: cuánto se encogen las covarianzas hacia la diagonal (Ledoit-Wolf). Qué te dice: cuánta confianza das a las correlaciones estimadas. Con pocas observaciones por activo, invertir la matriz amplifica el error y el «óptimo» cambia de signo al mover la ventana un mes. 0 deja la matriz cruda; 1 la vuelve diagonal, como si nada estuviera correlacionado; 0,5 es un término medio prudente.',
  tk_anosmin: 'Qué es: la ventana mínima que consideras aceptable. Qué te dice: cuándo avisarte de que estás midiendo poco. Por debajo salta una alarma, pero el cálculo sigue: una ventana corta contiene un solo régimen de mercado, sin un ciclo de tipos completo ni una recesión.',
  tk_fraccion: 'Qué es: la parte de Kelly que apuestas de verdad. Qué te dice: cuánto crecimiento cambias por cuánta tranquilidad. Con c·f* conservas c(2−c) del crecimiento máximo con c veces la desviación típica. Medio Kelly conserva el 75 % del crecimiento y baja de un 50 % a un 12,5 % la probabilidad de ver el capital a la mitad en algún momento. Kelly completo nunca es una recomendación: es el borde a partir del cual más tamaño reduce el crecimiento.',
  tk_ventana: 'Qué es: los días con precio en todos los activos marcados a la vez. Qué te dice: con cuánta muestra estás estimando. La fija el activo más joven que marques, porque la matriz de covarianzas necesita fechas comunes: rellenar los huecos con el último precio inventaría correlación.',
  tk_nN: 'Qué es: observaciones por activo (días entre número de activos). Qué te dice: si la matriz aguanta. Por debajo de 10, la inversa amplifica el error de estimación más de lo que informa; con 30 o más el resultado empieza a ser estable.',
  tk_invertido: 'Qué es: la suma de los tamaños que pide el modelo, después de tu fracción, el tope y el veto a los cortos. Qué te dice: cuánto capital emplearía y cuánto dejaría en caja. Si Kelly pedía pasar del 100 % se reescala a la baja, porque tu política no apalanca.',
  tk_sigma_cartera: 'Qué es: la volatilidad anualizada de la mezcla que propone el modelo, contando las correlaciones. Qué te dice: cuánto se movería esa cartera. Siempre es menor que la media de las volatilidades individuales: eso que falta es la diversificación.',
  tk_g: 'Qué es: la tasa de crecimiento compuesto esperada de la mezcla, g = r + wᵀ(μ−r) − wᵀΣw/2. Qué te dice: lo que el modelo cree que compondría a largo plazo con tus μ. Ojo: hereda por completo el error de tus μ, y el término de varianza es el peaje que cobra el riesgo.',
  tk_mu_tesis: 'Qué es: el retorno anual que TÚ esperas de esa posición a 3-5 años. Qué te dice: es la entrada que de verdad manda. Empieza con un prior CAPM (r + β × prima) que no es una previsión, solo un punto de partida. El error en μ pesa unas 20 veces más que el de las covarianzas: si vas a afinar algo, afina esta columna.',
  tk_mu_hist: 'Qué es: la media de los retornos diarios de la ventana, anualizada. Qué te dice: por qué no se usa para dimensionar. Con un año de muestra dice que Boston Scientific rinde −80 % anual y Exxon +40 %: es lo que pasó, no lo que va a pasar.',
  tk_sigma: 'Qué es: la volatilidad anualizada del activo en la ventana común. Qué te dice: cuánto se mueve. Es el denominador de Kelly (f* = (μ−r)/σ²), así que una σ mal medida cambia el tamaño al cuadrado: si σ sale el doble, el tamaño sale cuatro veces menor.',
  tk_peor: 'Qué es: la mayor variación de un solo día en la ventana. Qué te dice: si la volatilidad la está fabricando un único suceso. La σ histórica supone que los movimientos son suaves y no acota la cola izquierda: mira esta columna antes de fiarte de σ.',
  tk_beta: 'Qué es: cuánto se mueve el activo cuando el mercado se mueve un 1 %, calculada contra el índice de referencia. Qué te dice: cuánta de su variación es del mercado y cuánta suya. Se calcula activo a activo sobre la intersección de ese par, no dentro de la matriz común, para que una serie pobre del índice no recorte la ventana de todos.',
  tk_find: 'Qué es: el tamaño que pediría Kelly si esa posición fuera la única, (μ−r)/σ², por tu fracción. Qué te dice: su atractivo aislado. Sumarlas todas da de más, porque ignora que los activos se mueven juntos.',
  tk_fmulti: 'Qué es: el tamaño que pide Kelly teniendo en cuenta cómo se mueven todas las marcadas entre sí, Σ⁻¹(μ − r·1), por tu fracción y con el tope aplicado. Qué te dice: cuánto aporta esa posición DADO lo que ya llevas. Un cero no significa «vender»: significa que con ese μ y esa correlación no añade nada que no den ya las demás.',
  tk_tamano: 'Qué es: el peso que pide el modelo llevado a euros sobre la base del taller. Qué te dice: la orden que saldría de aquí si siguieras el modelo al pie de la letra. No lo hagas sin pasar por tu política, la fiscalidad y el bróker.',
  tk_delta: 'Qué es: la distancia en euros entre el tamaño que pide el modelo y lo que tienes hoy. Qué te dice: cuánto habría que mover. Es una distancia, no una orden: rebalancear aquí es gratis y en tu cuenta tributa.',
  tk_ventana_fila: 'Qué es: los años de serie que aporta este activo. Qué te dice: lo que cuesta marcarlo. La ventana común la fija el más joven de los marcados, así que meter uno con dos años recorta a dos años la muestra de todos los demás.',
  tk_fdisc: 'Qué es: el Kelly de la tesis que TÚ has escrito, calculado con la fórmula discreta original de 1956: maximiza E[ln(1+f·R)] sobre los desenlaces que le has dado. Qué te dice: cuánto justifica tu juicio, contando explícitamente la probabilidad de deterioro permanente. La columna F* multi. no la tiene: el modelo continuo supone precios sin saltos y por construcción su probabilidad de ruina es cero. El tamaño final es el MENOR de los dos: ninguno de los dos modelos puede convencerte de algo que el otro rechaza. En amarillo cuando manda la tesis.',
  // Tarjetas (indicadores)
  k_posiciones: 'Qué es: valor de mercado de las posiciones de la selección con los últimos precios y el cambio de hoy. Qué te dice: lo que vale hoy la cartera de inversión sin contar el efectivo; «invertido» es lo que te costó.',
  k_gyp_no: 'Qué es: valor de mercado menos coste de las posiciones abiertas (precio medio). Qué te dice: lo que ganarías o perderías si vendieras todo hoy, antes de impuestos.',
  k_efectivo: 'Qué es: saldo en cuenta de cada bróker según las operaciones registradas (ingresos, retiradas, compras, ventas, dividendos). Qué te dice: la pólvora disponible. No entra en la curva ni en las rentabilidades salvo que elijas el tipo Efectivo; un saldo negativo indica ingresos sin registrar.',
  k_mwr: 'Qué es: rentabilidad ponderada por dinero (TIR) del periodo. Qué te dice: lo que ha rendido tu dinero contando cuándo entró y salió cada euro; «anualizada» lo lleva a ritmo de un año para poder compararlo con el S&P 500 del mismo periodo.',
  k_twr: 'Qué es: rentabilidad ponderada por tiempo (Dietz modificado). Qué te dice: la calidad de las decisiones de inversión sin el efecto del momento de las aportaciones; es la cifra comparable con un índice.',
  k_ror: 'Qué es: variación simple del valor entre el inicio y el fin del periodo. Qué te dice: cuánto ha crecido el saldo en total, aportaciones incluidas; no es una rentabilidad.',
  k_ganancia: 'Qué es: valor final menos valor inicial menos aportado neto. Qué te dice: lo que la cartera ha generado por sí misma en el periodo, en euros.',
  k_gyp_real: 'Qué es: ganancias y pérdidas de las ventas del periodo con precio medio; «FIFO» es el criterio fiscal (lo primero comprado es lo primero vendido). Qué te dice: lo ya materializado, que tributa.',
  k_divs: 'Qué es: dividendos y cupones brutos del periodo; el neto descuenta retenciones y comisiones. Qué te dice: la renta que produce la cartera; el yield la compara con lo invertido.',
  k_int: 'Qué es: intereses de cuentas remuneradas y recompensas de staking o préstamo de cripto. Qué te dice: rentas que no vienen de dividendos y que también tributan como capital mobiliario.',
  k_fees: 'Qué es: comisiones e impuestos de operaciones, dividendos y custodia. Qué te dice: el coste de operar; si crece más que la cartera, hay rotación de más.',
};
export const DRAWERS = { '': '—', nucleo: 'Núcleo', tesis: 'Tesis', indice: 'Índice (válvula)', especulativa: '§3 especulativa', reserva: 'Reserva de liquidez', venta: 'En venta' };
// Estilo: cómo gana dinero la posición, no en qué sector está ni cuándo se vende. Es la tercera
// clasificación y responde a una pregunta distinta de las otras dos: el sector dice «de qué va»,
// el cajón dice «cuándo la vendo» y el estilo dice «qué tiene que pasar para que suba».
// Los siete primeros son estilos de acción y hacen falta tres más para lo que no es una acción: los
// fondos y la cripto no tienen estilo propio, tienen el de lo que llevan dentro, y meterlos con
// calzador en «crecimiento» o «valor» diría de la cartera algo que no es verdad.
export const ESTILOS = {
  '': 'Sin estilo',
  compounder: 'Compounder',
  crecimiento: 'Crecimiento',
  defensiva: 'Defensiva',
  ciclica: 'Cíclica',
  valor: 'Valor',
  renta: 'Renta',
  especulativa: 'Especulativa',
  rvindexada: 'RV indexada',
  rentafija: 'Renta fija',
  cripto: 'Cripto',
};
export const ESTILO_COLOR = { compounder: '#3F51B5', crecimiento: '#00ACC1', defensiva: '#43A047',
  ciclica: '#FF7043', valor: '#FFD600', renta: '#8E24AA', especulativa: '#E53935',
  rvindexada: '#C0CA33', rentafija: '#90CAF9', cripto: '#EC407A', '': '#8D6E63' };
export const PHASES = { recuperacion: 'Recuperación', sobrecalentamiento: 'Sobrecalentamiento', estanflacion: 'Estanflación', reflacion: 'Reflación', indeterminada: 'Indeterminada' };
export const OP_LABEL = { buy: 'Compra', sell: 'Venta', deposit: 'Ingreso', withdrawal: 'Retirada', interest: 'Interés', commission: 'Comisión', switch: 'Traspaso (salida)', switchBuy: 'Traspaso (entrada)', stakeReward: 'Recompensa stake', spinOff: 'Spin-off (origen)', spinOffBuy: 'Spin-off (recibido)', optionBuy: 'Compra opción', optionSell: 'Venta opción', scrip: 'Scrip dividend', split: 'Split', adjust: 'Ajuste de conciliación', transfer: 'Transferencia entre cuentas' };
export const PALETTE = ['#3F51B5', '#FFD600', '#E53935', '#43A047', '#FF7043', '#8E24AA', '#00ACC1', '#EC407A', '#C0CA33', '#8D6E63', '#26A69A', '#90CAF9', '#FFA000', '#B39DDB', '#F5F5F5', '#FFAB91'];
// Colores fijos: Santander en rojo (el del banco), USD en verde y EUR en azul; el resto toma tonos que no chocan con esos
const OTHER_COLORS = ['#FFD600', '#FF7043', '#8E24AA', '#00ACC1', '#EC407A', '#C0CA33', '#8D6E63', '#B39DDB'];
// Colores fijos por tipo de activo (el efectivo es verde; ningún otro tipo usa verde)
const TYPE_COLORS = { stock: '#3F51B5', fund: '#FFD600', etf: '#8E24AA', crypto: '#FF7043', plan: '#00ACC1', option: '#EC407A', 'Inmueble directo': '#E53935', 'Inmobiliario tokenizado (Reental)': '#8D6E63', 'Capital privado': '#B39DDB', custom: '#F5F5F5', cash: '#43A047' };
export const typeColor = (k, i) => TYPE_COLORS[k] || OTHER_COLORS[i % OTHER_COLORS.length];
export const accountColor = (name, i) => /santander/i.test(name || '') ? C.red : OTHER_COLORS[i % OTHER_COLORS.length];
export const ccyColor = (ccy, i) => ccy === 'EUR' ? C.blue : ccy === 'USD' ? C.cash : OTHER_COLORS[i % OTHER_COLORS.length];
export const kpiTip = key => ` tip" tabindex="0" data-tip="${esc(HELP[key] || '')}`;
export const help = (title, key) => `<h3 class="tip" tabindex="0" data-tip="${esc(HELP[key] || key)}">${title} <span class="q">?</span></h3>`;
