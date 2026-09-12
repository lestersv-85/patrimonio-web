// Estrategia: fase del reloj con su lectura completa, objetivos de la doctrina frente a la cartera, recomendaciones con
// su explicación visible, y objetivos personales (importe, fecha, aportación necesaria).
import { DB, saveSettings } from '../store.js?v=25c4e9c';
import { $, $$, esc, fmtEUR, fmtK, fmtN, fmtPct, fmtDate, cls, sum, todayISO, daysBetween, BUCKETS, PHASES, HELP, help, toast, num } from '../util.js?v=25c4e9c';
import { inSelPos, inSelCash, selIsAll, viviendaValue } from '../engine.js?v=25c4e9c';
import { phaseHeaderHTML, currentPhase } from '../clock.js?v=25c4e9c';
import { recommendations, targets } from '../recommend.js?v=25c4e9c';

const DOCTRINA = [
  ['Cubo 1 · Renta variable', 'El motor: produce el retorno. Núcleo por sectores, tesis acotadas, índice global como válvula, un par de especulativas con stop escrito.'],
  ['Cubo 2 · Oro y cripto', 'Reserva de valor. Oro por calendario (ancla del 5 %), BTC como destino del bloque cripto al final del ciclo.'],
  ['Cubo 3 · Renta fija y caja', 'El colchón y la pólvora: caja remunerada y deuda pública en euros a corto plazo. Recibe dividendos y ventas hasta su objetivo.'],
  ['Cubo 4 · No rebalancea', 'Lastre estructural: inmuebles, proyectos ilíquidos, plan de pensiones. Se mantiene o se vende cuando hay liquidez; no recibe aportaciones nuevas.'],
];

export function renderEstrategia(v, C, { UI, render }) {
  const T = targets(); const ph = currentPhase(); const today = todayISO();
  const rows = C.rows.filter(r => inSelPos(r.p, r.accountId)); let cash = 0; for (const a in C.cashEUR) if (inSelCash(a)) cash += C.cashEUR[a];
  const byB = { 1: 0, 2: 0, 3: cash, 4: 0 }; rows.forEach(r => byB[r.bucket] += r.mvEUR);
  const reb = byB[1] + byB[2] + byB[3]; const total = reb + byB[4];
  const recs = recommendations(C);
  const goals = (DB.settings?.goals || []);
  const patrimonio = sum(C.rows, r => r.mvEUR) + C.cashTotal + sum(viviendaValue(), r => r.mvEUR);
  const hist = (DB.settings?.targets_history || []).slice(-6).reverse();
  v.innerHTML = `
    <div class="section-head"><div><div class="eyebrow">Estrategia</div><h2>Reloj, doctrina y objetivos</h2></div></div>
    <div class="grid2">
      <div class="card pad"><h3 class="tip" tabindex="0" data-tip="${esc(HELP.fase)}">Fase del reloj de inversión <span class="q">?</span></h3>${phaseHeaderHTML()}
        ${ph.phase !== 'estanflacion' ? `<div class="note warn" style="margin-top:.6rem"><b>Discrepancia.</b> El sistema estima <b>${esc(PHASES[ph.phase] || ph.phase)}</b> con datos de mercado; en Inversor la fase declarada es <b>Estanflación</b> (31 ago 2026). Los objetivos que se aplican son los de la doctrina (Ajustes) y no cambian con la fase; la fase solo ordena las recomendaciones (qué cubo gana). Para fijarla a mano: Ajustes › Fase.</div>` : ''}
        <div class="muted" style="font-size:.8rem;margin-top:.5rem">Un cambio de fase se confirma con dos lecturas mensuales seguidas. Lecturas guardadas: ${(DB.clock || []).map(c => `${c.month} ${PHASES[c.phase] || c.phase}${c.confirmed ? ' ✓' : ''}`).join(' · ') || 'ninguna'}.</div></div>
      <div class="card pad"><h3>Los cuatro cubos frente a la doctrina</h3><div class="tablewrap"><table><thead><tr><th>Cubo</th><th class="num">Actual</th><th class="num">Objetivo</th><th class="num">Desviación</th><th class="num">Importe</th></tr></thead><tbody>
        ${[1, 2, 3].map(b => { const w = reb ? byB[b] / reb * 100 : 0, t = T.cubos_rebalanceable[b]; const d = w - t; return `<tr><td><span class="tag b${b}">${b}</span> ${BUCKETS[b].name}</td><td class="num">${fmtN(w, 1)} %</td><td class="num">${fmtN(t, 1)} %</td><td class="num ${Math.abs(d) > T.banda_pp ? 'neg' : ''}">${fmtPct(d, 1)} pp</td><td class="num ${cls(-d)}">${fmtEUR((t - w) / 100 * reb, 0)}</td></tr>`; }).join('')}
        <tr><td><span class="tag b4">4</span> ${BUCKETS[4].name}</td><td class="num">${fmtN(total ? byB[4] / total * 100 : 0, 1)} % del total</td><td class="num muted">fuera del rebalanceo</td><td></td><td class="num">${fmtEUR(byB[4], 0)}</td></tr>
      </tbody></table></div><div class="muted" style="font-size:.78rem;margin-top:.4rem">Pesos sobre lo rebalanceable (cubos 1 a 3): ${fmtEUR(reb, 0)}. Banda tolerada ±${T.banda_pp} pp. Objetivos editables en Ajustes.${hist.length ? ` Objetivos vigentes desde ${fmtDate(hist[0].date)}.` : ''}</div>
        ${DOCTRINA.map(([t, d]) => `<div style="margin-top:.45rem;font-size:.82rem"><b>${t}</b> <span class="muted">${d}</span></div>`).join('')}</div>
    </div>
    <div class="card pad"><h3>Recomendaciones de rebalanceo${selIsAll() ? '' : ' · ' + esc('selección actual')}</h3><div class="muted" style="font-size:.8rem;margin-bottom:.4rem">Propuestas revisables, nunca órdenes: cada una cita la regla y el importe. Por prioridad.</div>
      ${recs.map((r, i) => `<div class="rec-full"><div class="rec-n">${i + 1}</div><div><div class="rec-t">${esc(r.title)}</div><div class="rec-b">${esc(r.body)}</div><div class="muted" style="font-size:.74rem">${esc(r.rule)}${r.amount != null ? ' · ' + fmtK(Math.abs(r.amount)) : ''}</div></div></div>`).join('') || '<div class="muted">Sin recomendaciones para esta selección.</div>'}</div>
    <div class="card pad"><div class="head" style="padding:0 0 .4rem"><h3>Objetivos personales</h3><button class="btn sm" id="goal-add">+ Objetivo</button></div>
      <div class="muted" style="font-size:.8rem;margin-bottom:.4rem">Importe que quieres alcanzar y fecha. La aportación mensual necesaria supone que la cartera rinde lo indicado (por defecto 5 % anual) y parte del patrimonio actual (${fmtEUR(patrimonio, 0)}).</div>
      <div class="tablewrap"><table><thead><tr><th>Objetivo</th><th class="num">Importe</th><th>Fecha</th><th class="num">Rentabilidad supuesta</th><th class="num">Falta</th><th class="num">Aportación mensual necesaria</th><th></th></tr></thead><tbody>
        ${goals.map((g, i) => { const months = Math.max(1, Math.round(daysBetween(today, g.date || today) / 30.44)); const r = (g.rate ?? 5) / 100 / 12; const fv = patrimonio * Math.pow(1 + r, months); const need = g.amount - fv; const pmt = need <= 0 ? 0 : need / ((Math.pow(1 + r, months) - 1) / r); return `<tr><td>${esc(g.name)}</td><td class="num">${fmtEUR(g.amount, 0)}</td><td>${fmtDate(g.date)}</td><td class="num">${fmtN(g.rate ?? 5, 1)} %</td><td class="num ${need > 0 ? 'neg' : 'pos'}">${need > 0 ? fmtEUR(need, 0) : 'alcanzado con el rendimiento previsto'}</td><td class="num"><b>${fmtEUR(pmt, 0)}</b></td><td><button class="btn sm ghost" data-goal-del="${i}">✕</button></td></tr>`; }).join('') || '<tr><td colspan="7" class="muted">Sin objetivos. Añade el primero.</td></tr>'}
      </tbody></table></div>
      <div id="goal-form" class="form hidden" style="margin-top:.6rem"><div class="field"><label>Nombre</label><input type="text" id="g-name" placeholder="Independencia financiera"></div><div class="field"><label>Importe (€)</label><input type="number" id="g-amount" inputmode="decimal"></div><div class="field"><label>Fecha</label><input type="date" id="g-date"></div><div class="field"><label>Rentabilidad anual supuesta (%)</label><input type="number" id="g-rate" value="5" step="0.5"></div><div class="actions"><button class="btn" id="g-cancel">Cancelar</button><button class="btn primary" id="g-save">Guardar objetivo</button></div></div>
    </div>`;
  $('#goal-add').onclick = () => $('#goal-form').classList.toggle('hidden');
  $('#g-cancel').onclick = () => $('#goal-form').classList.add('hidden');
  $('#g-save').onclick = async () => { const g = { name: $('#g-name').value.trim() || 'Objetivo', amount: num($('#g-amount').value), date: $('#g-date').value, rate: num($('#g-rate').value) || 5 }; if (!(g.amount > 0) || !g.date) return toast('Falta el importe o la fecha'); await saveSettings({ goals: [...goals, g] }); toast('Objetivo guardado'); render(); };
  $$('[data-goal-del]', v).forEach(b => b.onclick = async () => { const gs = [...goals]; gs.splice(+b.dataset.goalDel, 1); await saveSettings({ goals: gs }); render(); });
}
