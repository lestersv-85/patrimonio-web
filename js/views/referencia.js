// Taller del índice de referencia: pesos editables y riesgo de la mezcla, calculado con los
// rendimientos mensuales reales de cada proxy. Los pesos guardados son los que dibuja Inicio.
import { DB, saveSettings } from '../store.js?v=25c4e9c';
import { $, $$, esc, fmtN, fmtPct, fmtYM, cls, todayISO, monthKey, addMonths, toast, C as COL } from '../util.js?v=25c4e9c';
import { BENCH_LEGS, BENCH_DEFAULT, benchWeights, benchComposite, benchMonthReturn, riskMetrics, nivelRiesgo, spBench, inSelPos, inSelCash, defaultBucket } from '../engine.js?v=25c4e9c';
import { chart, grid, pctTick, endLabels } from '../charts.js?v=25c4e9c';

// Carteras modelo (RV / Oro / Bitcoin / Bonos / Caja). «Trabajo» guarda en este navegador los últimos
// pesos tocados a mano, para poder saltar a un modelo y volver.
const PRESETS = [
  { id: 'doctrina', nm: 'Doctrina 63,5/14/22,5', w: { ...BENCH_DEFAULT } },
  { id: 'm80', nm: '80 / 5 / 5 / 5 / 5', w: { rv: 80, oro: 5, btc: 5, bonos: 5, caja: 5 } },
  { id: 'm70', nm: '70 / 5 / 10 / 5 / 10', w: { rv: 70, oro: 5, btc: 10, bonos: 5, caja: 10 } },
  { id: 'm60', nm: '60 / 10 / 10 / 10 / 10', w: { rv: 60, oro: 10, btc: 10, bonos: 10, caja: 10 } },
  { id: 'm20', nm: '20 / 20 / 20 / 20 / 20', w: { rv: 20, oro: 20, btc: 20, bonos: 20, caja: 20 } },
];
const TRABAJO_KEY = 'sp-bm-trabajo';
const leerTrabajo = () => { try { const w = JSON.parse(localStorage.getItem(TRABAJO_KEY) || 'null'); return w && BENCH_LEGS.every(l => typeof w[l.id] === 'number') ? w : null; } catch { return null; } };
const guardarTrabajo = w => { try { localStorage.setItem(TRABAJO_KEY, JSON.stringify(w)); } catch {} };

// Los pesos que hoy tiene la cartera de verdad, sobre lo rebalanceable (cubos 1 a 3; el cubo 4,
// ilíquido, queda fuera igual que en la doctrina). Oro y bitcoin salen del cubo 2 por tipo.
function estructuraActual(C) {
  if (!C) return null;
  const v = { rv: 0, oro: 0, btc: 0, bonos: 0, caja: 0 };
  for (const r of C.rows) {
    if (!inSelPos(r.p, r.accountId)) continue;
    const b = defaultBucket(r.p);
    if (b === 1) v.rv += r.mvEUR;
    else if (b === 2) v[r.p.type === 'crypto' ? 'btc' : 'oro'] += r.mvEUR;
    else if (b === 3) v[r.p.type === 'cash' ? 'caja' : 'bonos'] += r.mvEUR;
  }
  for (const a in C.cashEUR) if (inSelCash(a)) v.caja += C.cashEUR[a];
  const t = BENCH_LEGS.reduce((s, l) => s + v[l.id], 0);
  if (t <= 0) return null;
  return Object.fromEntries(BENCH_LEGS.map(l => [l.id, Math.round(v[l.id] / t * 1000) / 10]));
}

let W = null;          // pesos en edición (no se guardan hasta pulsar Guardar)
let M = null;          // métricas de la mezcla actual
let SPM = null;        // métricas del S&P
let MESES = [];        // meses del periodo común

const suma = w => BENCH_LEGS.reduce((s, l) => s + (w[l.id] || 0), 0);
// La caja es la pata de ajuste: absorbe lo que falte hasta 100. Si las otras cuatro ya pasan de 100 se queda en 0 y el aviso lo dice.
const cuadrarCaja = w => { const resto = BENCH_LEGS.filter(l => l.id !== 'caja').reduce((s, l) => s + (w[l.id] || 0), 0); w.caja = Math.max(0, Math.round((100 - resto) * 100) / 100); return w; };
const igual = (a, b) => BENCH_LEGS.every(l => Math.abs((a[l.id] || 0) - (b[l.id] || 0)) < 0.01);

// Primer mes con dato en todas las patas con peso: antes de eso la mezcla no existe
function rango(w) {
  const hoy = todayISO();
  const fin = monthKey(hoy) === monthKey(hoy) && hoy.slice(8) < '28' ? addMonths(monthKey(hoy), -1) : monthKey(hoy);
  const syms = BENCH_LEGS.filter(l => (w[l.id] || 0) > 0).map(l => l.sym);
  let ini = null;
  for (const sym of syms) {
    const m = DB.bench[sym]; if (!m) return null;
    const k = Object.keys(m).sort()[0]; if (!k) return null;
    const primero = addMonths(k.slice(0, 7), 1);
    if (!ini || primero > ini) ini = primero;
  }
  return ini && ini < fin ? { ini, fin } : null;
}

export function renderReferencia(v, C, { UI, render, go }) {
  const actual = estructuraActual(C);
  // «Trabajo» está siempre en la lista; se oculta mientras no haya pesos tocados a mano
  const presets = [
    { id: 'trabajo', nm: 'Trabajo', w: leerTrabajo() },
    ...(actual ? [{ id: 'actual', nm: 'Tu cartera hoy', w: actual }] : []),
    ...PRESETS];
  W = W || benchWeights();
  const guardados = benchWeights();
  const sp = spBench();
  const faltan = BENCH_LEGS.filter(l => !DB.bench[l.sym]);

  v.innerHTML = `<h2>Índice de referencia</h2>
    <p class="muted" style="margin:.2rem 0 .9rem;font-size:.85rem;max-width:78ch">Una cartera con oro, bonos, caja y cripto no se mide contra un índice de acciones. Mueve los pesos y mira qué riesgo compras con cada reparto: todo se calcula con los rendimientos mensuales reales de cada activo, nunca con estimaciones. <b>Los pesos que guardes son los que dibuja el gráfico de Inicio.</b></p>
    ${faltan.length ? `<div class="note warn" style="margin-bottom:.8rem"><b>Faltan series.</b> Sin datos de ${faltan.map(l => esc(l.nm) + ' (' + l.sym + ')').join(', ')}. Ejecuta <span class="mono">python3 jobs/fetch_market.py backfill</span> y sincroniza.</div>` : ''}
    <div class="grid2">
      <div class="card pad">
        <div class="head" style="padding:0 0 .5rem"><h3>Pesos del índice</h3><span class="sub">Rebalanceo mensual</span></div>
        <div class="chips" id="bm-presets" style="margin-bottom:.7rem">${presets.map(p => `<button class="chip" data-preset="${p.id}">${esc(p.nm)}</button>`).join('')}</div>
        <div id="bm-rows"></div>
        <div class="stack" id="bm-stack" aria-hidden="true"></div>
        <div class="bm-total">
          <span class="muted">Suma de pesos</span>
          <span style="display:flex;align-items:center;gap:.5rem">
            <b class="mono" id="bm-sum">—</b><span class="badge" id="bm-chip">—</span>
            <button class="btn sm" id="bm-norm">Normalizar</button>
          </span>
        </div>
        <div class="toolbar" style="justify-content:flex-end;margin-top:.7rem">
          <button class="btn" id="bm-undo">Descartar</button>
          <button class="btn primary" id="bm-save">Guardar y usar en Inicio</button>
        </div>
        <div class="muted" style="font-size:.74rem;margin-top:.5rem" id="bm-estado"></div>
      </div>

      <div class="card pad">
        <div class="head" style="padding:0 0 .5rem"><h3>Nivel de riesgo</h3><span class="sub">Volatilidad anualizada de la mezcla</span></div>
        <div style="display:flex;align-items:baseline;gap:.5rem;flex-wrap:wrap"><b id="bm-lvl" style="font-family:Manrope,sans-serif;font-size:1.6rem;font-weight:800;letter-spacing:-.02em">—</b><span class="muted" id="bm-lvlnote"></span></div>
        <div class="bm-meter"><span class="pin" id="bm-pin"></span></div>
        <div class="bm-meter-l"><span>0 %</span><span>10 %</span><span>20 %</span><span>30 %+</span></div>
        <div class="kpis" style="margin-top:.9rem" id="bm-kpis"></div>
        <p class="muted" style="font-size:.74rem;margin:.8rem 0 0" id="bm-pie"></p>
      </div>
    </div>

    <div class="card">
      <div class="head"><h3>Cómo se habría comportado</h3><span class="sub" id="bm-sub"></span></div>
      <div class="chartbox tall"><canvas id="bm-ch"></canvas></div>
    </div>
    <div class="card">
      <div class="head"><h3>Caída desde máximos</h3><span class="sub">Lo que habrías tenido que aguantar</span></div>
      <div class="chartbox"><canvas id="bm-dd"></canvas></div>
    </div>

    <div class="card">
      <div class="head"><h3>Frente a las alternativas</h3><span class="sub">Mismo periodo, mismas reglas</span></div>
      <div class="tablewrap"><table><thead><tr><th>Cartera</th><th class="num">Rentab.</th><th class="num">Vol.</th><th class="num">Máx. caída</th><th class="num">Mejor 12 m</th><th class="num">Peor 12 m</th><th class="num">Sharpe</th></tr></thead><tbody id="bm-cmp"></tbody></table></div>
    </div>

    <div class="card pad" style="display:grid;gap:.5rem;font-size:.8rem">
      <h3>Qué estás midiendo</h3>
      <p class="muted" style="margin:0">Proxies reales cotizados en euros, así que no hay cambio de divisa que estimar: ${BENCH_LEGS.map(l => `${esc(l.nm)} <span class="mono">${l.sym}</span>`).join(' · ')}. Referencia <span class="mono">${sp.sym}</span> (${esc(sp.label)}). ${sp.tr ? '' : '<b>Aún no está descargado el S&amp;P de acumulación: se compara con el índice de precio en dólares, que no incluye dividendos.</b>'}</p>
      <p class="muted" style="margin:0"><b>Tres cosas que este cuadro no puede decirte.</b> El rebalanceo mensual aquí es gratis y en la vida real tributa, sobre todo con bitcoin dentro. La rentabilidad del bitcoin desde 2015 no era conocible en 2015: cualquier mezcla que lo lleve se ve mejor de lo que se podía decidir. Y el histórico disponible contiene un solo mercado bajista serio y ningún periodo largo de inflación alta: no es una muestra representativa.</p>
      <p class="muted" style="margin:0"><b>Umbrales del nivel de riesgo.</b> Volatilidad anualizada: por debajo de 5 % muy bajo · 5-10 % bajo · 10-15 % medio · 15-22 % alto · por encima de 22 % muy alto.</p>
    </div>`;

  // filas de pesos
  $('#bm-rows').innerHTML = BENCH_LEGS.map(l => `
    <div class="bm-w" style="--sw:${l.color}">
      <span class="sw" style="background:${l.color}"></span>
      <span class="nm">${esc(l.nm)} <span class="mono tk">${l.sym}</span><span class="muted nota">${l.id === 'caja' ? 'se ajusta sola: 100 menos el resto' : esc(l.nota)}</span></span>
      <span class="val"><input type="number" id="bm-n-${l.id}" min="0" max="100" step="0.25" aria-label="Peso de ${esc(l.nm)} en por ciento"${l.id === 'caja' ? ' disabled' : ''}><span class="muted">%</span></span>
      <input type="range" id="bm-s-${l.id}" min="0" max="100" step="0.25" aria-label="Ajustar ${esc(l.nm)}"${l.id === 'caja' ? ' disabled' : ''}>
    </div>`).join('');

  for (const l of BENCH_LEGS) {
    if (l.id === 'caja') continue;
    const set = x => { W[l.id] = Math.max(0, Math.min(100, +x || 0)); cuadrarCaja(W); guardarTrabajo(W); presets[0].w = { ...W }; pinta(); };
    $('#bm-s-' + l.id).oninput = e => set(e.target.value);
    $('#bm-n-' + l.id).oninput = e => set(e.target.value);
  }
  $('#bm-presets').onclick = e => { const b = e.target.closest('button[data-preset]'); if (!b) return; const p = presets.find(x => x.id === b.dataset.preset); if (!p.w) return; W = { ...p.w }; pinta(); };
  $('#bm-norm').onclick = () => { const t = suma(W); if (!t) return; for (const l of BENCH_LEGS) W[l.id] = Math.round((W[l.id] || 0) / t * 1000) / 10; cuadrarCaja(W); guardarTrabajo(W); presets[0].w = { ...W }; pinta(); };
  $('#bm-undo').onclick = () => { W = benchWeights(); pinta(); };
  $('#bm-save').onclick = async () => {
    const t = suma(W);
    if (Math.abs(t - 100) > 0.05) { toast('Los pesos deben sumar 100 %'); return; }
    // El histórico va dentro del mismo JSON: settings no tiene columna aparte y así no hace falta migración
    const hist = [...(DB.settings?.benchmark?.history || []), { date: todayISO(), w: { ...W } }].slice(-12);
    await saveSettings({ benchmark: { ...W, updated: todayISO(), history: hist } });
    toast('Índice guardado: Inicio ya lo usa');
    render();
  };

  pinta();

  function pinta() {
    const tot = suma(W);
    for (const l of BENCH_LEGS) {
      $('#bm-s-' + l.id).value = W[l.id] || 0;
      if (document.activeElement !== $('#bm-n-' + l.id)) $('#bm-n-' + l.id).value = W[l.id] || 0;
    }
    $('#bm-sum').textContent = fmtN(tot, 1) + ' %';
    const ok = Math.abs(tot - 100) < 0.05;
    const chip = $('#bm-chip');
    chip.className = 'badge ' + (ok ? 'pos' : 'warn');
    chip.textContent = ok ? 'cuadra' : (tot > 100 ? 'las otras patas se pasan ' + fmtN(tot - 100, 1) + ' pp' : 'faltan ' + fmtN(100 - tot, 1) + ' pp');
    $('#bm-norm').classList.toggle('hidden', ok);
    $('#bm-stack').innerHTML = BENCH_LEGS.filter(l => W[l.id] > 0).map(l => `<i style="background:${l.color};width:${(W[l.id] / (tot || 1)) * 100}%" title="${esc(l.nm)} ${fmtN(W[l.id], 1)} %"></i>`).join('');
    $$('#bm-presets .chip').forEach(b => { const p = presets.find(x => x.id === b.dataset.preset); b.classList.toggle('hidden', !p.w); b.classList.toggle('on', !!p.w && igual(p.w, W)); });
    const cambiado = !igual(W, guardados);
    $('#bm-save').disabled = !cambiado || !ok;
    $('#bm-undo').classList.toggle('hidden', !cambiado);
    $('#bm-estado').textContent = cambiado ? 'Sin guardar: Inicio sigue dibujando los pesos anteriores.' : 'Guardado' + (DB.settings?.benchmark?.updated ? ' el ' + DB.settings.benchmark.updated : '') + '. Es el índice que dibuja Inicio.';

    calcula();
  }

  function calcula() {
    const rg = rango(W);
    const kpis = $('#bm-kpis');
    if (!rg) { M = null; kpis.innerHTML = '<div class="note warn">No hay histórico suficiente para estas patas.</div>'; $('#bm-cmp').innerHTML = ''; return; }
    MESES = [];
    for (let ym = rg.ini; ym <= rg.fin; ym = addMonths(ym, 1)) MESES.push(ym);

    const serie = w => benchComposite(w, rg.ini, rg.fin).map(x => x.r);
    const huecos = benchComposite(W, rg.ini, rg.fin).filter(x => x.r == null);
    const rfSerie = MESES.map(ym => benchMonthReturn('XEON.DE', ym));
    const rf = riskMetrics(rfSerie, 0);
    const rfC = rf ? rf.cagr : 0;

    M = riskMetrics(serie(W), rfC);
    SPM = riskMetrics(MESES.map(ym => benchMonthReturn(spBench().sym, ym)), rfC);
    if (!M) { kpis.innerHTML = '<div class="note warn">Serie insuficiente.</div>'; return; }

    $('#bm-lvl').textContent = nivelRiesgo(M.vol);
    $('#bm-lvlnote').textContent = `volatilidad ${fmtN(M.vol, 1)} %` + (SPM ? ` · S&P 500 ${fmtN(SPM.vol, 1)} %` : '');
    $('#bm-pin').style.left = Math.min(100, M.vol / 30 * 100).toFixed(1) + '%';

    const kpi = (k, val, d, color) => `<div class="kpi" style="--kc:${color}"><div class="l">${k}</div><div class="v">${val}</div><div class="s">${d}</div></div>`;
    kpis.innerHTML =
      kpi('Rentabilidad', `<span class="${cls(M.cagr)}">${fmtPct(M.cagr)}</span>`, 'anual compuesta', COL.cyan) +
      kpi('Volatilidad', fmtN(M.vol, 1) + ' %', 'anualizada', COL.yellow) +
      kpi('Máxima caída', `<span class="neg">${fmtN(M.dd, 1)} %</span>`, 'suelo en ' + fmtYM(MESES[M.ddi]), COL.red) +
      kpi('Upside 12 m', `<span class="pos">${fmtPct(M.up, 0)}</span>`, 'mejor año observado', COL.cash) +
      kpi('Downside 12 m', `<span class="neg">${fmtPct(M.dn, 0)}</span>`, 'peor año observado', COL.red) +
      kpi('Sharpe', fmtN(M.sharpe, 2), 'sobre caja €STR', COL.purple);

    $('#bm-pie').innerHTML = `Todo es <b>histórico observado</b>, no una previsión: el mejor y el peor de los ${M.nwin} periodos de 12 meses consecutivos entre ${fmtYM(MESES[0])} y ${fmtYM(MESES[MESES.length - 1])}; ${fmtN(M.neg, 0)} % de esos periodos acabaron en pérdidas.`
      + (huecos.length ? ` <span class="warn"><b>${huecos.length} ${huecos.length === 1 ? 'mes sin dato' : 'meses sin dato'}</b> en alguna pata: esos meses no se dibujan (no se cuentan como 0 %).</span>` : '');

    $('#bm-sub').textContent = `Base 100 desde ${fmtYM(MESES[0])} · ${M.n} meses · rebalanceo mensual`;

    const labels = MESES.map(fmtYM);
    chart('bm-ch', { type: 'line', data: { labels, datasets: [
      { label: 'Índice compuesto', data: M.eq, borderColor: COL.cyan, backgroundColor: 'rgba(0,172,193,.16)', borderWidth: 2.5, fill: true, tension: .3, pointRadius: 0 },
      ...(SPM ? [{ label: spBench().label, data: SPM.eq, borderColor: COL.yellow, backgroundColor: 'transparent', borderWidth: 2, tension: .3, pointRadius: 0 }] : []) ] },
      plugins: [endLabels], options: { layout: { padding: { right: 10 } }, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        scales: { y: { grid }, x: { grid: { display: false }, ticks: { maxTicksLimit: 14 } } },
        plugins: { endLabels: { fmt: v => fmtN(v, 0) }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmtN(c.raw, 0)}` } } } } });

    chart('bm-dd', { type: 'line', data: { labels, datasets: [
      { label: 'Caída desde máximos', data: M.ddc, borderColor: COL.red, backgroundColor: 'rgba(229,57,53,.18)', borderWidth: 1.5, fill: 'origin', tension: .25, pointRadius: 0 } ] },
      options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        scales: { y: { ticks: { callback: pctTick }, grid }, x: { grid: { display: false }, ticks: { maxTicksLimit: 14 } } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ' + fmtPct(c.raw, 1) } } } } });

    const fila = (nm, m, me) => m ? `<tr class="${me ? 'me' : ''}"><td>${nm}</td>
      <td class="num ${cls(m.cagr)}">${fmtPct(m.cagr)}</td><td class="num">${fmtN(m.vol, 1)} %</td>
      <td class="num neg">${fmtN(m.dd, 1)} %</td><td class="num pos">${fmtPct(m.up, 0)}</td>
      <td class="num neg">${fmtPct(m.dn, 0)}</td><td class="num">${fmtN(m.sharpe, 2)}</td></tr>` : '';
    $('#bm-cmp').innerHTML = fila('<b>Tu mezcla</b>', M, true)
      + fila(esc(spBench().label), SPM)
      + presets.filter(p => p.w && !igual(p.w, W)).map(p => fila(esc(p.nm), riskMetrics(serie(p.w), rfC))).join('')
      + BENCH_LEGS.map(l => fila(`<span class="muted">solo ${esc(l.nm)}</span>`, riskMetrics(MESES.map(ym => benchMonthReturn(l.sym, ym)), rfC))).join('');
  }
}
