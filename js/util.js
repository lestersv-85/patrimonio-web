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
