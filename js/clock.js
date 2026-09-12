// Reloj de inversión: lectura estimada (calculada por jobs/fetch_market.py) y cabecera explicativa
import { DB } from './store.js?v=25c4e9c';
import { PHASES, fmtN, fmtPct, fmtDate, esc } from './util.js?v=25c4e9c';

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
  return `<div class="phase ph-${esc(c.phase)} compact"><div class="ph-top"><span class="eyebrow">Fase ${c.source === 'manual' ? 'fijada' : 'estimada'}${c.reading && c.source !== 'manual' ? (c.confirmed ? ' · confirmada' : ' · en revisión') : ''}</span><b>${esc(PHASES[c.phase] || c.phase)}</b></div></div>`;
}
export function phaseHeaderHTML() {
  const c = currentPhase(); const ev = c.reading?.evidence || {}; const arrow = v => v > 0 ? '↑' : v < 0 ? '↓' : '·';
  const gTxt = [ev.spx_6m != null ? `S&P 6 m ${fmtPct(ev.spx_6m, 1)}` : null, ev.cobre_oro_6m != null ? `cobre/oro ${fmtPct(ev.cobre_oro_6m, 1)}` : null, ev.curva_10a_3m != null ? `curva ${fmtN(ev.curva_10a_3m, 2)} pp` : null, ev.sahm != null ? `Sahm ${fmtN(ev.sahm, 2)} pp` : null].filter(Boolean).join(' · ');
  const iTxt = [ev.ipc_interanual != null ? `IPC ${fmtN(ev.ipc_interanual, 1)} % frente a ${fmtN(ev.ipc_media_6m, 1)} % media 6 m` : null, ev.brent_6m != null ? `Brent ${fmtPct(ev.brent_6m, 1)}` : null].filter(Boolean).join(' · ');
  const g = c.reading ? arrow(c.reading.growth) : '·', i = c.reading ? arrow(c.reading.inflation) : '·';
  return `<div class="phase ph-${esc(c.phase)}">
    <div class="ph-top"><span class="eyebrow">Fase ${c.source === 'manual' ? 'fijada a mano' : 'estimada'}${c.reading && c.source !== 'manual' ? (c.confirmed ? ' · confirmada' : ' · en revisión (falta 2.ª lectura)') : ''}</span><b>${esc(PHASES[c.phase] || c.phase)}</b></div>
    <div class="ph-ev"><span>Crecimiento ${g}</span> ${esc(gTxt || 'sin datos')}</div>
    <div class="ph-ev"><span>Inflación ${i}</span> ${esc(iTxt || 'sin datos')}</div>
    <div class="ph-foot">${c.reading ? `Datos a ${fmtDate(ev.fecha_datos || '')}${ev.ipc_dato ? ' · IPC de ' + fmtDate(ev.ipc_dato) : ''}` : 'Ejecuta jobs/fetch_market.py clock'} · Fase declarada en Inversor: Estanflación (31 ago 2026)</div>
  </div>`;
}
