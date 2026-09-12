// Arranque, navegación, barra de selección y render
import { DB, loadAll, signIn, signInWithLink, signOut, localEditCount } from './store.js?v=25c4e9c';
import { $, $$, esc, todayISO, fmtDate, toast, BUCKETS, TYPES, HELP } from './util.js?v=25c4e9c';
import { SEL, selIsAll, compute, invalidate } from './engine.js?v=25c4e9c';
import { setupChartDefaults, destroyCharts } from './charts.js?v=25c4e9c';
import { phaseHeaderHTML, phaseLineHTML } from './clock.js?v=25c4e9c';
import { recommendationsHTML } from './recommend.js?v=25c4e9c';
import { renderInicio } from './views/inicio.js?v=25c4e9c';
import { renderCartera } from './views/cartera.js?v=25c4e9c';
import { renderMovimientos } from './views/movimientos.js?v=25c4e9c';
import { renderRendimientos } from './views/rendimientos.js?v=25c4e9c';
import { renderDistribucion } from './views/distribucion.js?v=25c4e9c';
import { renderPosiciones } from './views/posiciones.js?v=25c4e9c';
import { renderCuentas } from './views/cuentas.js?v=25c4e9c';
import { renderAjustes } from './views/ajustes.js?v=25c4e9c';
import { renderImpuestos } from './views/impuestos.js?v=25c4e9c';
import { renderEstrategia } from './views/estrategia.js?v=25c4e9c';
import { renderPatrimonio } from './views/patrimonio.js?v=25c4e9c';
import { renderAnalisis } from './views/analisis.js?v=25c4e9c';
import { renderReferencia } from './views/referencia.js?v=25c4e9c';
import { runChecks, dismissedKeys, dismiss, undismissAll } from './checks.js?v=25c4e9c';
import { openModal, closeModal } from './forms.js?v=25c4e9c';
import { openOpForm, setRerender } from './forms.js?v=25c4e9c';

let _fo = null; try { _fo = localStorage.getItem('sp-filters-open'); } catch {}
export const UI = { filtersOpen: _fo == null ? window.innerWidth >= 960 : _fo === '1', view: 'inicio', account: 'all', opTab: 'ops', search: '', range: '12m', posFilter: 'held', chartMode: 'cum', chartRange: 'max', perfRange: 'ytd', period: 'ytd', distBase: 'mv' };
export const PERIODS = [['month', 'Este mes'], ['ytd', 'Este año'], ['12m', '12 meses'], ['3a', '3 años'], ['5a', '5 años'], ['10a', '10 años'], ['max', 'Desde el inicio']];
// Vistas guardadas: perímetros de un clic
export const VIEWS = { todo: { l: 'Toda la inversión', sel: { buckets: [], types: [], accounts: [] } }, liquida: { l: 'Cartera líquida', sel: { buckets: [1, 2, 3], types: [], accounts: [] } }, rv: { l: 'Solo renta variable', sel: { buckets: [1], types: [], accounts: [] } }, tr: { l: 'Trade Republic', sel: { buckets: [], types: [], accounts: ['tr'] } }, santander: { l: 'Santander', sel: { buckets: [], types: [], accounts: ['santander'] } } };
try { const u = JSON.parse(localStorage.getItem('sp-ui') || '{}'); if (u.sel) Object.assign(SEL, u.sel); if (u.view) UI.view = u.view; } catch (e) {}
export const saveUI = () => { try { localStorage.setItem('sp-ui', JSON.stringify({ sel: SEL, view: UI.view })); } catch (e) {} };

const ICONS = {
  inicio: '<svg viewBox="0 0 24 24"><path d="M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2z"/></svg>',
  cartera: '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18"/></svg>',
  movimientos: '<svg viewBox="0 0 24 24"><path d="M4 7h13M13 3l4 4-4 4M20 17H7M11 13l-4 4 4 4"/></svg>',
  rendimientos: '<svg viewBox="0 0 24 24"><path d="M4 19h16M4 15l4-4 4 3 4-6 4 2"/><path d="M17 8h3v3"/></svg>',
  distribucion: '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M12 3v9h9a9 9 0 0 0-9-9z"/></svg>',
  posiciones: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  cuentas: '<svg viewBox="0 0 24 24"><path d="M3 10l9-6 9 6M5 10v9M19 10v9M9 19v-6h6v6M3 19h18"/></svg>',
  analisis: '<svg viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/></svg>',
  patrimonio: '<svg viewBox="0 0 24 24"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/></svg>',
  estrategia: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  referencia: '<svg viewBox="0 0 24 24"><path d="M12 3v18M5 7l7-4 7 4"/><path d="M5 7l-2 6a3 3 0 0 0 6 0zM19 7l-2 6a3 3 0 0 0 6 0z"/><path d="M8 21h8"/></svg>',
  impuestos: '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>',
  ajustes: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  mas: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
};
const NAV = [['inicio', 'Inicio', 'both'], ['cartera', 'Cartera', 'desk'], ['patrimonio', 'Patrimonio', 'desk'], ['movimientos', 'Movimientos', 'both'], ['rendimientos', 'Rendimientos', 'both'], ['distribucion', 'Distribución', 'both'], ['analisis', 'Análisis', 'desk'], ['posiciones', 'Posiciones', 'desk'], ['cuentas', 'Cuentas', 'desk'], ['impuestos', 'Impuestos', 'desk'], ['estrategia', 'Estrategia', 'desk'], ['referencia', 'Referencia', 'desk'], ['ajustes', 'Ajustes', 'desk'], ['mas', 'Más', 'mob']];
const MAS_VIEWS = ['cartera', 'patrimonio', 'analisis', 'posiciones', 'cuentas', 'impuestos', 'estrategia', 'referencia', 'ajustes'];

function renderNav() { $('#nav').innerHTML = NAV.map(([k, l, w]) => `<button class="${w === 'both' ? '' : w} ${UI.view === k || (k === 'mas' && MAS_VIEWS.includes(UI.view)) ? 'on' : ''}" data-view="${k}">${ICONS[k]}<span>${l}</span></button>`).join(''); }
export function go(v, push = true) { UI.view = v; saveUI(); if (push && location.hash !== '#/' + v) history.pushState(null, '', '#/' + v); render(); window.scrollTo(0, 0); }
window.addEventListener('popstate', () => { const v = (location.hash.match(/^#\/([a-z]+)/) || [])[1]; if (v && v !== UI.view) go(v, false); });
$('#nav').addEventListener('click', e => { const b = e.target.closest('button'); if (b) go(b.dataset.view); });
$('#fab').addEventListener('click', () => openOpForm());
$('#today').textContent = fmtDate(todayISO());
$('#storage').addEventListener('click', () => go('ajustes'));

function renderStorage() {
  const el = $('#storage'); el.className = 'storage ' + (DB.mode === 'cloud' ? 'cloud' : '');
  const n = DB.mode === 'local' ? localEditCount() : 0;
  const last = (DB.syncLog || [])[0]; const lastMarket = (DB.syncLog || []).find(l => /market|fetch|daily|backfill/i.test(l.job || ''));
  const when = l => l && l.started_at ? fmtDate(l.started_at.slice(0, 10)) + ' ' + l.started_at.slice(11, 16) : '—';
  const bad = (DB.syncLog || []).slice(0, 5).filter(l => l.ok === false || l.ok === 0).length;
  el.querySelector('span').textContent = (DB.mode === 'cloud' ? `Nube · ${DB.user?.email || 'Supabase'}` : `Copia local${n ? ` · ${n} cambios sin subir` : ''}`) + (last ? ` · sync ${when(last)}` : '') + (bad ? ` · ${bad} fallos` : '');
  el.title = `${DB.mode === 'cloud' ? 'Datos en Supabase con esta cuenta' : 'Copia local (data/snapshot.json)'}\nÚltimo trabajo: ${last ? last.job + ' ' + when(last) + (last.ok ? ' ✓' : ' ✗') : '—'}\nÚltimos precios (mercado): ${lastMarket ? when(lastMarket) : 'sin registro'}`;
  document.querySelectorAll('.tip').forEach(el => { if (!el._tipBound) { el._tipBound = true; el.addEventListener('click', e => { if (e.target.closest('button, a, input, select')) return; el.classList.toggle('open'); }); } });
  const pv = $('#privacy'); if (pv && !pv.onclick) { const apply = () => { let on = false; try { on = localStorage.getItem('sp-privacy') === '1'; } catch {} document.body.classList.toggle('privacy', on); }; apply(); pv.onclick = () => { try { localStorage.setItem('sp-privacy', document.body.classList.contains('privacy') ? '0' : '1'); } catch {} apply(); }; }
}

// ---- Barra de selección ----
export function filterBarHTML() {
  const types = [...new Set(DB.positions.filter(p => p.type !== 'cash').map(p => p.type))].sort(); types.push('cash');
  const chip = (group, val, label, color) => `<button class="chip ${SEL[group].includes(val) ? 'on' : ''}" data-g="${group}" data-v="${esc(val)}" ${color ? `style="--dot:${color}"` : ''}>${color ? '<i></i>' : ''}${esc(label)}</button>`;
  const viewOn = k => JSON.stringify(VIEWS[k].sel) === JSON.stringify({ buckets: [...SEL.buckets].sort(), types: [...SEL.types].sort(), accounts: [...SEL.accounts].sort() });
  const desc = [UI.period ? (PERIODS.find(p => p[0] === UI.period) || [])[1] : '', selIsAll() ? 'toda la inversión' : [SEL.buckets.map(b => BUCKETS[b].short), SEL.types.map(t => TYPES[t] || t), SEL.accounts.map(a => (DB.accounts.find(x => x.id === a) || {}).name || a)].flat().join(', ')].filter(Boolean).join(' · ');
  return `<div class="card filterbar ${UI.filtersOpen ? 'open' : ''}" id="filterbar"><button class="fb-toggle" data-fb-toggle="1"><span>Filtros</span><span class="muted">${esc(desc)}</span><span class="chev">${UI.filtersOpen ? '▴' : '▾'}</span></button><div class="fb-body">
    <div class="row"><span class="lbl">Periodo</span><div class="chips">${PERIODS.map(([k, l]) => `<button class="chip ${UI.period === k ? 'on' : ''}" data-period="${k}">${l}</button>`).join('')}</div></div>
    <div class="row"><span class="lbl">Vistas</span><div class="chips">${Object.entries(VIEWS).map(([k, v]) => `<button class="chip ${viewOn(k) ? 'on' : ''}" data-view-preset="${k}">${v.l}</button>`).join('')}</div></div>
    <div class="row"><span class="lbl">Cubos</span><div class="chips"><button class="chip all ${selIsAll() ? 'on' : ''}" data-all="1">Todo</button>${[1, 2, 3, 4].map(b => chip('buckets', b, BUCKETS[b].short, BUCKETS[b].color)).join('')}</div></div>
    <div class="row"><span class="lbl">Tipos</span><div class="chips">${types.map(t => chip('types', t, TYPES[t] || t)).join('')}</div></div>
    <div class="row"><span class="lbl">Cuentas</span><div class="chips">${DB.accounts.map(a => chip('accounts', a.id, a.name)).join('')}${selIsAll() ? '' : '<button class="chip reset" data-all="1" title="Quitar todos los filtros">✕ Restablecer</button>'}</div></div>
    </div>
  </div>`;
}
export function bindFilterBar() {
  const fb = $('#filterbar'); if (!fb) return;
  fb.onclick = e => { const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.fbToggle) { UI.filtersOpen = !UI.filtersOpen; try { localStorage.setItem('sp-filters-open', UI.filtersOpen ? '1' : '0'); } catch {} render(); return; }
    if (b.dataset.period) { UI.period = b.dataset.period; UI.perfRange = b.dataset.period; UI.chartRange = b.dataset.period; render(); return; }
    if (b.dataset.viewPreset) { const p = VIEWS[b.dataset.viewPreset].sel; SEL.buckets = [...p.buckets]; SEL.types = [...p.types]; SEL.accounts = [...p.accounts]; invalidate(); saveUI(); render(); return; }
    if (b.dataset.all) { SEL.buckets = []; SEL.types = []; SEL.accounts = []; }
    else { const g = b.dataset.g; let v = b.dataset.v; if (g === 'buckets') v = +v; const arr = SEL[g]; const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); }
    invalidate(); saveUI(); render(); };
}

// ---- Render ----
let rendering = false;
export function render() {
  if (!DB.ready || rendering) return; rendering = true;
  try {
    renderNav(); renderStorage(); destroyCharts();
    const v = $('#view'); const C = compute();
    const views = { inicio: renderInicio, cartera: renderCartera, patrimonio: renderPatrimonio, analisis: renderAnalisis, movimientos: renderMovimientos, rendimientos: renderRendimientos, distribucion: renderDistribucion, posiciones: renderPosiciones, cuentas: renderCuentas, impuestos: renderImpuestos, estrategia: renderEstrategia, referencia: renderReferencia, ajustes: renderAjustes, mas: renderMas };
    (views[UI.view] || renderInicio)(v, C, { UI, render, go, filterBarHTML, bindFilterBar });
    $('#fab').classList.toggle('hidden', !['inicio', 'cartera', 'movimientos'].includes(UI.view));
    renderBell(); applyFullChart();
    const side = $('#sidebar-extra'); if (side) side.innerHTML = `<h3 class="tip" tabindex="0" data-tip="${esc(HELP.fase)}">Fase y recomendaciones IA <span class="q">?</span></h3>${phaseLineHTML()}${recommendationsHTML(C)}<button class="btn sm" style="margin-top:.4rem;width:100%" data-view="estrategia" id="side-estrategia">Ver estrategia completa</button>`; const se = $('#side-estrategia'); if (se) se.onclick = () => go('estrategia');
  } catch (e) { console.error(e); $('#view').innerHTML = `<div class="note warn">Error al dibujar la vista: ${esc(e.message)}</div>`; }
  rendering = false;
}
function renderMas(v) {
  const items = [['cartera', 'Cartera', 'Tabla completa de posiciones valoradas'], ['patrimonio', 'Patrimonio', 'Neto, deudas, liquidez, inmuebles y Reental'], ['analisis', 'Análisis', 'Atribución, concentración, divisa, caídas, volatilidad, costes y escenarios'], ['posiciones', 'Posiciones', 'Catálogo, precios, cubos y regiones'], ['cuentas', 'Cuentas', 'Brókers, wallets y efectivo'], ['impuestos', 'Impuestos', 'Resumen fiscal por ejercicio, FIFO, dividendos y modelo 720'], ['estrategia', 'Estrategia', 'Reloj de inversión, doctrina, recomendaciones y objetivos'], ['referencia', 'Referencia', 'Pesos del índice compuesto, riesgo, upside y caída máxima'], ['ajustes', 'Ajustes', 'Objetivos, sincronización, exportar y restaurar']];
  v.innerHTML = `<h2>Más</h2><div class="menu">${items.map(([k, t, d]) => `<div class="card it" data-v="${k}">${ICONS[k]}<div><div class="t">${t}</div><div class="d">${d}</div></div></div>`).join('')}</div><div class="card pad"><h3 class="tip" tabindex="0" data-tip="${esc(HELP.fase)}">Fase y recomendaciones IA <span class="q">?</span></h3>${phaseHeaderHTML()}${recommendationsHTML()}</div>`;
  $$('[data-v]', v).forEach(el => el.onclick = () => go(el.dataset.v));
}

// ---- Gráfico a pantalla completa (misma tarjeta y misma barra de filtros, solo se recolocan) ----
function applyFullChart() {
  const ov = $('#fullchart'); if (!ov) return;
  // botón de ampliar en cada gráfico de líneas o barras
  $$('#view .card .chartbox canvas').forEach(cv => {
    if (cv.closest('.donutwrap') || !cv.id) return; const card = cv.closest('.card'); const head = card.querySelector('.head'); if (!head || head.querySelector('.fc-open')) return;
    const b = document.createElement('button'); b.className = 'btn sm fc-open'; b.title = 'Ver a pantalla completa'; b.setAttribute('aria-label', 'Pantalla completa'); b.textContent = '⤢'; b.dataset.fc = cv.id;
    b.onclick = () => { UI.fullChart = cv.id; render(); };
    (head.querySelector('.toolbar') || head).appendChild(b);
  });
  if (!UI.fullChart) { ov.classList.add('hidden'); ov.innerHTML = ''; document.body.style.overflow = ''; return; }
  const cv = document.getElementById(UI.fullChart); if (!cv) { UI.fullChart = null; ov.classList.add('hidden'); ov.innerHTML = ''; return; }
  const card = cv.closest('.card'); const fb = $('#filterbar');
  ov.innerHTML = '<div class="fc-top"><div class="eyebrow">Pantalla completa · los filtros actúan sobre este gráfico</div><button class="btn" id="fc-close">✕ Cerrar</button></div><div class="fc-filters"></div><div class="fc-body"></div>';
  if (fb) ov.querySelector('.fc-filters').appendChild(fb);
  card.classList.add('fc-card'); const btn = card.querySelector('.fc-open'); if (btn) btn.remove();
  ov.querySelector('.fc-body').appendChild(card); ov.classList.remove('hidden'); document.body.style.overflow = 'hidden';
  $('#fc-close').onclick = () => { UI.fullChart = null; render(); };
  const key = e => { if (e.key === 'Escape') { UI.fullChart = null; document.removeEventListener('keydown', key); render(); } };
  document.addEventListener('keydown', key);
  bindFilterBar();
}

// ---- Campana de alarmas ----
let lastAlarms = [];
function renderBell() {
  const b = $('#bell'); if (!b) return;
  try { lastAlarms = runChecks(); } catch (e) { console.error('checks', e); lastAlarms = []; }
  const seen = dismissedKeys(); const live = lastAlarms.filter(a => !seen.has(a.key));
  const n = live.filter(a => a.level !== 'info').length;
  $('#bellcnt').textContent = String(n); $('#bellcnt').classList.toggle('hidden', n === 0);
  b.className = 'bell ' + (live.some(a => a.level === 'alta') ? 'alta' : live.some(a => a.level === 'media') ? 'media' : '');
  b.onclick = () => openAlarms();
}
function openAlarms() {
  const seen = dismissedKeys(); const live = lastAlarms.filter(a => !seen.has(a.key)); const hidden = lastAlarms.length - live.length;
  const lvl = { alta: 'Alta', media: 'Media', info: 'Aviso' };
  openModal(`<div class="mhead"><h2>Alarmas de coherencia</h2><button class="btn ghost" data-close>✕</button></div>
    <p class="muted" style="margin:.2rem 0 .6rem;font-size:.8rem">Cada operación debe mover el efectivo y las cantidades de forma coherente. Se revisa en cada carga: efectivo negativo, cantidades negativas, importes que no cuadran, dividendos sin posición, precios antiguos y cambios del BCE.</p>
    ${live.length ? ['alta', 'media', 'info'].filter(l => live.some(a => a.level === l)).map(l => `<div class="eyebrow" style="margin:.6rem 0 .2rem">${l === 'alta' ? 'Errores' : l === 'media' ? 'Advertencias' : 'Ajustes e información'} · ${live.filter(a => a.level === l).length}</div>` + live.filter(a => a.level === l).map(a => `<div class="alarm ${a.level}"><i></i><div><div class="t">${esc(a.title)}</div><div class="d">${esc(a.detail)}</div></div><div style="display:grid;gap:.3rem"><button class="btn sm" data-go="${a.where}">Ver</button><button class="btn sm ghost" data-ok="${esc(a.key)}" title="No volver a avisar">Ocultar</button></div></div>`).join('')).join('') : '<div class="note">Sin alarmas: todas las comprobaciones pasan.</div>'}
    <div class="toolbar" style="margin-top:.8rem;justify-content:space-between"><span class="muted" style="font-size:.76rem">${hidden ? hidden + ' ocultadas' : ''}</span>${hidden ? '<button class="btn sm" id="alarm-reset">Mostrar ocultadas</button>' : ''}</div>`);
  $$('[data-go]').forEach(b => b.onclick = () => { closeModal(); go(b.dataset.go); });
  $$('[data-ok]').forEach(b => b.onclick = () => { dismiss([b.dataset.ok]); renderBell(); openAlarms(); });
  const r = $('#alarm-reset'); if (r) r.onclick = () => { undismissAll(); renderBell(); openAlarms(); };
  $$('[data-close]').forEach(b => b.onclick = closeModal);
}

// ---- Login ----
function renderLogin(msg = '') {
  $('#view').innerHTML = `<div class="card pad login"><h2>Entrar</h2><p class="muted" style="margin:0;font-size:.85rem">Con tu correo y contraseña, o pide un enlace de acceso por correo (sin contraseña).</p>${msg ? `<div class="note ${/enviado/i.test(msg) ? '' : 'warn'}">${esc(msg)}</div>` : ''}
    <div class="field"><label>Correo</label><input type="email" id="l-email" autocomplete="username" value="${esc(localStorage.getItem('sp-email') || '')}"></div><div class="field"><label>Contraseña</label><input type="password" id="l-pass" autocomplete="current-password"></div>
    <div class="toolbar"><button class="btn primary" id="l-go">Entrar</button><button class="btn" id="l-link">Enviarme un enlace de acceso</button></div>
    <p class="muted" style="margin:0;font-size:.78rem">Para usar la copia local del Mac sin nube: <a href="?local=1">modo local</a>.</p></div>`;
  const email = () => { const v = $('#l-email').value.trim(); localStorage.setItem('sp-email', v); return v; };
  $('#l-go').onclick = async () => { try { await signIn(email(), $('#l-pass').value); boot(); } catch (e) { renderLogin(e.message); } };
  $('#l-link').onclick = async () => { try { await signInWithLink(email()); renderLogin('Enlace enviado: revisa el correo y ábrelo en este mismo dispositivo.'); } catch (e) { renderLogin(e.message); } };
  $('#l-pass').onkeydown = e => { if (e.key === 'Enter') $('#l-go').click(); };
}
export { signOut };

async function boot() {
  setupChartDefaults(); setRerender(render);
  try {
    const r = await loadAll();
    if (r.needLogin) return renderLogin();
    { const v = (location.hash.match(/^#\/([a-z]+)/) || [])[1]; if (v) UI.view = v; }
    if (DB.mode === 'cloud' && !DB.accounts.length && !DB.positions.length) { toast(`La cuenta ${DB.user?.email || ''} no tiene datos: entra con la cuenta dueña de la cartera`); }
    if (DB.loadWarnings?.length) toast('Carga parcial: ' + DB.loadWarnings.join(' · '));
    render();
  } catch (e) { console.error(e); $('#view').innerHTML = `<div class="note warn">No se pudieron cargar los datos: ${esc(e.message)}<br><button class="btn" id="retry" style="margin-top:.6rem">Reintentar</button></div>`; const b = $('#retry'); if (b) b.onclick = () => boot(); }
}
boot();
