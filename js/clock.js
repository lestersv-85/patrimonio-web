// Reloj de inversión: lectura estimada (calculada por jobs/fetch_market.py) y cabecera explicativa
import { DB } from './store.js?v=3bf8a9f';
import { PHASES, fmtN, fmtPct, fmtDate, esc } from './util.js?v=3bf8a9f';

export function currentPhase() {
  const readings = [...(DB.clock || [])].sort((a, b) => a.month.localeCompare(b.month));
  const last = readings[readings.length - 1];
  const override = DB.settings?.phase_override;
  if (override) return { phase: override, source: 'manual', reading: last, confirmed: true };
  if (!last) return { phase: 'indeterminada', source: 'sin datos', reading: null, confirmed: false };
  return { phase: last.phase, source: 'estimada', reading: last, confirmed: !!last.confirmed };
}

// Versión compacta para la barra lateral: solo la fase y su estado
export function phaseLineHTML() {
  const c = currentPhase();
  return `<div class="phase ph-${esc(c.phase)} compact"><div class="ph-top"><span class="eyebrow">Fase ${c.source === 'manual' ? 'fijada' : 'estimada'}${c.reading && c.source !== 'manual' ? (c.phase === 'indeterminada' ? ' · sin señal' : c.confirmed ? ' · confirmada' : ' · en revisión') : ''}</span><b>${esc(PHASES[c.phase] || c.phase)}</b></div></div>`;
}
// Cuatro de las seis señales se mueven a diario y dos publican una vez al mes. Enseñar una sola
// fecha haría pasar por fresco un IPC de hace seis semanas: cada bloque lleva la suya.
const dias = iso => iso ? Math.round((Date.now() - new Date(iso)) / 86400000) : null;
function frescura(ev) {
  const p = [];
  if (ev.fecha_mercado) { const n = dias(ev.fecha_mercado); p.push(`mercado al ${fmtDate(ev.fecha_mercado)}${n > 4 ? ` <span class="warn">(${n} días)</span>` : ''}`); }
  if (ev.ipc_dato) { const n = dias(ev.ipc_dato); p.push(`IPC de ${fmtDate(ev.ipc_dato)}${n > 45 ? ` <span class="warn">(${n} días)</span>` : ''}`); }
  if (ev.paro_dato) { const n = dias(ev.paro_dato); p.push(`paro de ${fmtDate(ev.paro_dato)}${n > 45 ? ` <span class="warn">(${n} días)</span>` : ''}`); }
  return p.length ? 'Cierre de ' + p.join(' · ') : `Datos a ${fmtDate(ev.fecha_datos || '')}`;
}

// Qué ha dicho el reloj en toda su historia, y si lo que se ha fijado a mano coincide con algo que el
// sistema haya estimado alguna vez. El 17 sep 2026 había nueve lecturas, seis «indeterminada», una sola
// fase declarada (sobrecalentamiento, abr-jun) y la fase fijada a mano era estanflación, que el sistema
// NO ha estimado ni una vez. Y las nueve llevaban el mismo `computed_at`: son relleno hacia atrás, no
// seguimiento, así que la confirmación «dos lecturas seguidas» nunca ha operado en tiempo real.
function historial() {
  const L = DB.clock || []; if (!L.length) return '';
  const p = [];
  const fases = {}; L.forEach(r => { fases[r.phase] = (fases[r.phase] || 0) + 1; });
  const dichas = Object.keys(fases).filter(f => f !== 'indeterminada');
  p.push(`${L.length} lecturas${fases.indeterminada ? `, ${fases.indeterminada} sin señal` : ''}`);
  p.push(dichas.length ? 'fases estimadas: ' + dichas.map(f => `${PHASES[f] || f} (${fases[f]})`).join(', ') : 'ninguna fase estimada todavía');
  const ov = DB.settings?.phase_override;
  if (ov && !fases[ov]) p.push(`<span class="warn">la fase fijada a mano (${PHASES[ov] || ov}) no la ha estimado el sistema ni una vez</span>`);
  const ca = [...new Set(L.map(r => String(r.computed_at || '').slice(0, 10)).filter(Boolean))];
  if (ca.length === 1 && L.length > 2) p.push(`<span class="warn">las ${L.length} se calcularon el mismo día (${fmtDate(ca[0])}): es relleno hacia atrás, no seguimiento, y la confirmación a la segunda lectura nunca ha operado en tiempo real</span>`);
  return ' · ' + p.join(' · ');
}

export function phaseHeaderHTML() {
  const c = currentPhase(); const ev = c.reading?.evidence || {}; const arrow = v => v > 0 ? '↑' : v < 0 ? '↓' : '·';
  const gTxt = [ev.spx_6m != null ? `S&P 6 m ${fmtPct(ev.spx_6m, 1)}` : null, ev.cobre_oro_6m != null ? `cobre/oro ${fmtPct(ev.cobre_oro_6m, 1)}` : null, ev.curva_10a_3m != null ? `curva ${fmtN(ev.curva_10a_3m, 2)} pp` : null, ev.sahm != null ? `Sahm ${fmtN(ev.sahm, 2)} pp` : null].filter(Boolean).join(' · ');
  const pp = (n, d = 2) => (n == null || isNaN(n)) ? '—' : (n > 0 ? '+' : '') + fmtN(n, d) + ' pp';
  const iTxt = [ev.ipc_interanual != null ? `IPC ${fmtN(ev.ipc_interanual, 1)} % frente a ${fmtN(ev.ipc_media_6m, 1)} % media 6 m` : null, ev.brent_6m != null ? `Brent ${fmtPct(ev.brent_6m, 1)}` : null, ev.breakeven_5a != null ? `implícita 5a ${fmtN(ev.breakeven_5a, 2)} % (${pp(ev.breakeven_5a_6m)} en 6 m)` : null].filter(Boolean).join(' · ');
  const g = c.reading ? arrow(c.reading.growth) : '·', i = c.reading ? arrow(c.reading.inflation) : '·';
  return `<div class="phase ph-${esc(c.phase)}">
    <div class="ph-top"><span class="eyebrow">Fase ${c.source === 'manual' ? 'fijada a mano' : 'estimada'}${c.reading && c.source !== 'manual' ? (c.phase === 'indeterminada' ? ' · sin señal suficiente' : c.confirmed ? ' · confirmada' : ' · en revisión (falta 2.ª lectura)') : ''}</span><b>${esc(PHASES[c.phase] || c.phase)}</b></div>
    <div class="ph-ev"><span>Crecimiento ${g}</span> ${esc(gTxt || 'sin datos')}</div>
    <div class="ph-ev"><span>Inflación ${i}</span> ${esc(iTxt || 'sin datos')}</div>
    ${ev.motivo_indeterminada ? `<div class="ph-ev"><span>Sin fase</span> ${esc(ev.motivo_indeterminada)}. Cada eje necesita ${esc(String(ev.min_votos || 2))} indicadores y mayoría; un empate no decide.</div>` : ''}
    ${(ev.sin_voto || []).length ? `<div class="ph-foot">No votan: ${esc(ev.sin_voto.join(' · '))}</div>` : ''}
    <div class="ph-foot">${c.reading ? frescura(ev) : 'Ejecuta jobs/fetch_market.py clock'}${historial()}</div>
    <div class="ph-foot">El reloj es <b>informativo</b>: en las recomendaciones la fase solo desempata entre propuestas casi iguales (15-25 puntos de <span class="mono">score</span>), nunca decide por sí sola qué comprar. Si quieres que pese de verdad, eso es un cambio de doctrina, no de código.</div>
  </div>`;
}
