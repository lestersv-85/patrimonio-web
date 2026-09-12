import { DB, saveSettings, localEditCount, clearLocalEdits, signOut, setPassword } from '../store.js?v=25c4e9c';
import { $, $$, esc, fmtN, fmtDate, toast, sum, PHASES } from '../util.js?v=25c4e9c';
import { fxAt, latestAtOrBefore } from '../engine.js?v=25c4e9c';
import { targets, DEFAULT_TARGETS } from '../recommend.js?v=25c4e9c';
import { exportAllXLSX, exportAllCSV, exportOpsCSV, exportDivsCSV, exportPositionsCSV, exportCatalogCSV } from '../export.js?v=25c4e9c';
import { importFiliosCSV } from '../forms.js?v=25c4e9c';

export function renderAjustes(v, C, { render, go }) {
  const T = targets(); const today = new Date().toISOString().slice(0, 10);
  const fxRows = ['USD', 'GBP', 'CHF', 'CAD', 'HKD'].map(c => { const r = latestAtOrBefore(DB.fx[c] || {}, today); return r ? `${c} ${fmtN(r.value, 5)} (${fmtDate(r.date)})` : `${c} sin datos`; });
  const staleAuto = C.rows.filter(r => r.stale && r.p.price_mode !== 'manual'); const noSym = DB.positions.filter(p => p.price_mode !== 'manual' && p.type !== 'cash' && !p.yahoo_symbol && !p.coingecko_id && C.rows.some(r => r.positionId === p.id));
  const log = (DB.syncLog || []).slice(0, 8);
  v.innerHTML = `
    <h2>Ajustes</h2>
    <div class="card pad" style="display:grid;gap:.6rem"><h3>Datos</h3>
      <dl class="kv"><dt>Origen</dt><dd>${DB.mode === 'cloud' ? 'Supabase (nube)' : 'Copia local ' + esc(DB.meta.source)}</dd><dt>Cambios BCE</dt><dd>${fxRows.join(' · ')}</dd><dt>Posiciones con precio antiguo</dt><dd>${staleAuto.length ? staleAuto.map(r => r.p.ticker).join(', ') : 'ninguna'}</dd><dt>Sin símbolo de precio</dt><dd>${noSym.length ? noSym.map(p => p.ticker).join(', ') : 'ninguna'}</dd><dt>Operaciones</dt><dd>${DB.operations.length} (${DB.operations.filter(o => o.source === 'filios').length} de Filios)</dd><dt>Dividendos</dt><dd>${DB.dividends.length}</dd><dt>Posiciones</dt><dd>${DB.positions.length}</dd></dl>
      ${DB.mode === 'local' && localEditCount() ? `<div class="note warn">${localEditCount()} cambios guardados solo en este navegador. Exporta una copia JSON o configura Supabase para sincronizar. <button class="btn sm" id="clear-local">Descartar cambios locales</button></div>` : ''}
      ${DB.mode === 'cloud' ? `<div class="form"><div class="field"><label>Nueva contraseña</label><input type="password" id="pw-new" autocomplete="new-password"></div><div class="field" style="justify-content:end"><div class="toolbar"><button class="btn" id="pw-save">Guardar contraseña</button><button class="btn sm" id="logout">Cerrar sesión</button></div></div></div><p class="muted" style="margin:0;font-size:.78rem">Sesión: ${esc(DB.user?.email || '')}</p>` : ''}
      ${log.length ? `<div class="muted" style="font-size:.78rem">Últimos trabajos: ${log.map(l => `${esc(l.job)} ${l.ok ? '✓' : '✗'} ${esc((l.finished_at || l.started_at || '').slice(0, 16).replace('T', ' '))}`).join(' · ')}</div>` : ''}
    </div>
    <div class="card pad" style="display:grid;gap:.6rem"><h3>Fase del reloj</h3>
      <div class="form"><div class="field"><label>Fase</label><select id="ph-ov"><option value="">Estimada por el sistema</option>${Object.entries(PHASES).filter(([k]) => k !== 'indeterminada').map(([k, l]) => `<option value="${k}" ${DB.settings?.phase_override === k ? 'selected' : ''}>${l} (fijada a mano)</option>`).join('')}</select><span class="hint">Si la fijas a mano, el widget lo indica.</span></div></div>
    </div>
    <div class="card pad" style="display:grid;gap:.6rem"><h3>Objetivos de la doctrina</h3>
      <div class="form">
        <div class="field"><label>Cubo 1 RV (% rebalanceable)</label><input type="number" step="0.1" id="t-c1" value="${T.cubos_rebalanceable[1]}"></div>
        <div class="field"><label>Cubo 2 oro y cripto (%)</label><input type="number" step="0.1" id="t-c2" value="${T.cubos_rebalanceable[2]}"></div>
        <div class="field"><label>Cubo 3 RF y caja (%)</label><input type="number" step="0.1" id="t-c3" value="${T.cubos_rebalanceable[3]}"></div>
        <div class="field"><label>Suelo RV (%)</label><input type="number" step="1" id="t-rv" value="${T.rv_suelo}"></div>
        <div class="field"><label>Oro (% base)</label><input type="number" step="0.5" id="t-oro" value="${T.oro_base}"></div>
        <div class="field"><label>Caja (% base)</label><input type="number" step="0.5" id="t-caja" value="${T.caja_base}"></div>
        <div class="field"><label>Deuda pública (% base)</label><input type="number" step="0.5" id="t-bonos" value="${T.bonos_base}"></div>
        <div class="field"><label>BTC a fin de ciclo (% del cripto)</label><input type="number" step="1" id="t-btc" value="${T.btc_fin_ciclo}"></div>
        <div class="field"><label>Banda (pp)</label><input type="number" step="0.5" id="t-banda" value="${T.banda_pp}"></div>
        <div class="field"><label>Aportación mensual (€)</label><input type="number" step="100" id="t-apo" value="${T.aportacion_mensual}"></div>
        <div class="field full"><label>Cajones del cubo 1 (núcleo / tesis / índice / especulativa, %)</label><input type="text" id="t-caj" value="${Object.values(T.cajones_cubo1).join(' / ')}"></div>
        <div class="field full"><label>Sectores del núcleo (nombre: %, separados por coma)</label><input type="text" id="t-sec" value="${esc(Object.entries(T.nucleo_sectores).map(([k, v]) => `${k}: ${v}`).join(', '))}"></div>
      </div>
      <div class="toolbar" style="justify-content:flex-end"><button class="btn" id="t-reset">Valores de la doctrina</button><button class="btn primary" id="t-save">Guardar objetivos</button></div>
    </div>
    <div class="card pad"><h3>Índice compuesto de referencia</h3><div class="muted" style="font-size:.8rem">Los pesos del índice contra el que se compara la cartera se editan en su propia pestaña, con el riesgo, el recorrido y la caída máxima de cada reparto calculados al vuelo.</div><div class="toolbar" style="margin-top:.6rem"><button class="btn" id="bm-go">Abrir Referencia</button></div>
    </div>
    <div class="card pad" style="display:grid;gap:.6rem"><h3>Exportar</h3>
      <p class="muted" style="margin:0;font-size:.82rem">Excel con una hoja por tabla (cuentas, posiciones, operaciones, dividendos, cartera valorada, rentabilidad mensual, precios, cambios, reloj). Los CSV usan punto y coma y decimales con coma.</p>
      <div class="toolbar"><button class="btn primary" id="e-xlsx">Toda la base a Excel</button><button class="btn" id="e-allcsv">Toda la base a CSV</button><button class="btn" id="e-ops">Operaciones CSV</button><button class="btn" id="e-divs">Dividendos CSV</button><button class="btn" id="e-pos">Cartera CSV</button><button class="btn" id="e-cat">Posiciones CSV</button></div>
    </div>
    <div class="card pad" style="display:grid;gap:.6rem"><h3>Cargar desde Filios</h3>
      <p class="muted" style="margin:0;font-size:.82rem">El trabajo diario ya lo hace solo si tiene credenciales. También puedes cargar a mano el CSV de Operaciones o de Dividendos exportado de Filios: las filas nuevas se añaden y las existentes se conservan.</p>
      <input type="file" id="importfile" accept=".csv,text/csv" multiple>
    </div>`;
  $('#ph-ov').onchange = async e => { await saveSettings({ phase_override: e.target.value || null }); toast('Fase actualizada'); render(); };
  $('#bm-go').onclick = () => go('referencia');
  $('#t-save').onclick = async () => {
    const caj = $('#t-caj').value.split('/').map(s => +s.trim()); const sec = {}; $('#t-sec').value.split(',').forEach(s => { const [k, val] = s.split(':'); if (k && val) sec[k.trim()] = +val; });
    const t = { ...T, cubos_rebalanceable: { 1: +$('#t-c1').value, 2: +$('#t-c2').value, 3: +$('#t-c3').value }, rv_suelo: +$('#t-rv').value, oro_base: +$('#t-oro').value, caja_base: +$('#t-caja').value, bonos_base: +$('#t-bonos').value, btc_fin_ciclo: +$('#t-btc').value, banda_pp: +$('#t-banda').value, aportacion_mensual: +$('#t-apo').value, cajones_cubo1: { nucleo: caj[0], tesis: caj[1], indice: caj[2], especulativa: caj[3] }, nucleo_sectores: sec };
    const hist = [...(DB.settings?.targets_history || []), { date: today, targets: t }].slice(-20);
    await saveSettings({ targets: t, targets_history: hist }); toast('Objetivos guardados y versionados'); render();
  };
  $('#t-reset').onclick = async () => { await saveSettings({ targets: DEFAULT_TARGETS }); toast('Objetivos de la doctrina restaurados'); render(); };
  $('#e-xlsx').onclick = () => exportAllXLSX(C); $('#e-allcsv').onclick = () => exportAllCSV(C);
  $('#e-ops').onclick = () => exportOpsCSV([...DB.operations].sort((a, b) => b.date.localeCompare(a.date))); $('#e-divs').onclick = () => exportDivsCSV([...DB.dividends].sort((a, b) => b.date.localeCompare(a.date)));
  $('#e-pos').onclick = () => exportPositionsCSV(C); $('#e-cat').onclick = () => exportCatalogCSV();
  $('#importfile').onchange = async e => { for (const f of e.target.files) { try { await importFiliosCSV(await f.text(), f.name); } catch (err) { console.error(err); toast('Error al importar ' + f.name + ': ' + err.message); } } e.target.value = ''; render(); };
  if ($('#clear-local')) $('#clear-local').onclick = () => { if (confirm('¿Descartar los cambios locales?')) { clearLocalEdits(); location.reload(); } };
  if ($('#logout')) $('#logout').onclick = () => signOut();
  if ($('#pw-save')) $('#pw-save').onclick = async () => { const p = $('#pw-new').value; if (p.length < 8) return toast('Mínimo 8 caracteres'); try { await setPassword(p); toast('Contraseña guardada'); $('#pw-new').value = ''; } catch (e) { toast(e.message); } };
}
