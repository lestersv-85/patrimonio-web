// Gráficos con Chart.js (global cargado desde cdnjs)
import { fmtEUR, fmtN, fmtK, fmtPct, esc, sum } from './util.js?v=25c4e9c';
const charts = {};
export function chart(id, cfg) {
  const el = document.getElementById(id); if (!el || !window.Chart) return;
  if (charts[id]) charts[id].destroy();
  const prev = Chart.getChart(el); if (prev) prev.destroy();
  try { charts[id] = new Chart(el, cfg); } catch (e) { console.error('chart', id, e.message, (e.stack || '').split('\n').slice(1, 4).join(' | '), JSON.stringify(cfg.data.datasets.map(d => ({ label: d.label, type: d.type, bg: typeof d.backgroundColor, bc: d.borderColor, n: (d.data || []).length })))); }
  return charts[id];
}
export function destroyCharts() { for (const k in charts) { charts[k].destroy(); delete charts[k]; } }
export function setupChartDefaults() {
  if (!window.Chart) return;
  const cs = getComputedStyle(document.documentElement); const muted = cs.getPropertyValue('--muted').trim() || '#8a9bb5'; const line = cs.getPropertyValue('--line').trim() || '#1b2537';
  Chart.defaults.animation = false; Chart.defaults.color = muted; grid.color = line; Chart.defaults.borderColor = 'rgba(27,37,55,.9)'; Chart.defaults.font.family = '"IBM Plex Sans", sans-serif'; Chart.defaults.font.size = 11;
  Chart.defaults.plugins.legend.labels.boxWidth = 10; Chart.defaults.plugins.legend.labels.boxHeight = 10;
  Chart.defaults.plugins.tooltip.backgroundColor = '#16213a'; Chart.defaults.plugins.tooltip.titleColor = '#f1f5fb'; Chart.defaults.plugins.tooltip.bodyColor = '#c0cbdc';
}
export const pctTick = v => fmtN(v, 1) + ' %';
// Etiqueta con el último valor al extremo derecho de cada línea
const rrect = (ctx, x, y, w, h, r) => { if (ctx.roundRect) return ctx.roundRect(x, y, w, h, r); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
export const endLabels = { id: 'endLabels', afterDatasetsDraw(c, args, opts) { try { endLabelsDraw(c, opts); } catch (e) { console.warn('endLabels', e.message); } } };
function endLabelsDraw(c, opts) {
  const ctx = c.ctx; const fmt = (opts && opts.fmt) || (v => fmtN(v, 1)); ctx.save(); ctx.font = '600 11px "IBM Plex Mono", monospace'; ctx.textBaseline = 'middle';
  c.data.datasets.forEach((ds, i) => {
    if (!c.isDatasetVisible(i)) return; const meta = c.getDatasetMeta(i);
    if (ds.isAvg) { // estadístico de referencia: valor encima de la línea, a la derecha
      const v = ds.data.find(x => x != null); if (v == null || !meta.data.length) return;
      // etiqueta sobre fondo oscuro para que se lea encima de las barras
      const y = Math.max(c.chartArea.top + 9, meta.data[meta.data.length - 1].y - 11);
      const text = `${ds.label} ${fmt(v)}`; const w = ctx.measureText(text).width + 10; const x = c.chartArea.right - w;
      ctx.fillStyle = '#0b1220'; ctx.globalAlpha = .55; ctx.beginPath(); rrect(ctx, x, y - 9, w, 18, 4); ctx.fill(); ctx.globalAlpha = .8;
      ctx.strokeStyle = ds.borderColor || AVG_COLOR; ctx.lineWidth = 1; ctx.beginPath(); rrect(ctx, x, y - 9, w, 18, 4); ctx.stroke();
      ctx.fillStyle = ds.borderColor || AVG_COLOR; ctx.textAlign = 'left'; ctx.fillText(text, x + 5, y); return;
    }
    if (ds.type === 'bar' || c.config.type === 'bar' && !ds.type) return;
    let last = null; for (let k = meta.data.length - 1; k >= 0; k--) { if (ds.data[k] != null) { last = meta.data[k]; break; } }
    if (!last) return; const v = ds.data[meta.data.indexOf(last)]; const text = fmt(v); const w = ctx.measureText(text).width + 8;
    const x = Math.min(last.x + 6, c.chartArea.right - w); const y = Math.min(Math.max(last.y, c.chartArea.top + 9), c.chartArea.bottom - 9);
    ctx.fillStyle = ds.borderColor || '#fff'; ctx.globalAlpha = .92; ctx.beginPath(); rrect(ctx, x, y - 9, w, 18, 4); ctx.fill(); ctx.globalAlpha = 1; ctx.fillStyle = '#0b1220'; ctx.fillText(text, x + 4, y);
  }); ctx.restore();
}
export const grid = { color: 'rgba(27,37,55,.8)' }; // se ajusta al tema en setupChartDefaults
// Porciones menores del umbral (5 %) se agrupan en «Varios»; la nota dice qué incluye
export const VARIOS_COLOR = '#78909C';
export function groupSmall(items, minPct = 5) {
  const total = sum(items, i => Math.max(0, i.v)) || 1;
  const small = items.filter(i => Math.max(0, i.v) / total * 100 < minPct);
  if (small.length < 2) return items;
  const big = items.filter(i => !small.includes(i));
  const v = sum(small, i => Math.max(0, i.v));
  return [...big, { k: 'varios', label: 'Varios', v, color: VARIOS_COLOR, cost: sum(small, i => i.cost || 0), gain: sum(small, i => i.gain || 0), n: sum(small, i => i.n || 0), parts: small.map(i => ({ label: i.label, v: i.v, pct: Math.max(0, i.v) / total * 100 })) }];
}
export const partsText = g => g.parts ? `Incluye ${g.parts.length} grupos por debajo del 5 %:\n` + g.parts.map(p => `• ${p.label}  ${fmtN(p.pct, 1)} %`).join('\n') : '';
export function donut(id, items) {
  // Con muchas categorías el anillo no se lee: barras horizontales ordenadas (todas, sin agrupar)
  if (items.length > 8) {
    const total = sum(items, i => Math.max(0, i.v)) || 1; const sorted = [...items].sort((a, b) => b.v - a.v); const el = document.getElementById(id); if (el) { const box = el.closest('.chartbox'); if (box) { box.style.height = Math.max(140, 18 * sorted.length + 24) + 'px'; } }
    chart(id, { type: 'bar', data: { labels: sorted.map(i => i.label), datasets: [{ data: sorted.map(i => Math.max(0, i.v)), backgroundColor: sorted.map(i => i.color), borderRadius: 3, barThickness: 12 }] }, options: { indexAxis: 'y', maintainAspectRatio: false, scales: { x: { ticks: { callback: v => fmtK(v) }, grid }, y: { grid: { display: false }, ticks: { font: { size: 10 }, autoSkip: false } } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${fmtEUR(c.raw, 0)} · ${fmtN(c.raw / total * 100, 1)} %` } } } } });
    return;
  }
  items = groupSmall(items);
  const total = sum(items, i => Math.max(0, i.v)) || 1;
  chart(id, { type: 'doughnut', data: { labels: items.map(i => i.label), datasets: [{ data: items.map(i => Math.max(0, i.v)), backgroundColor: items.map(i => i.color), borderWidth: 2, borderColor: getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#0e141d', hoverOffset: 4 }] }, options: { cutout: '52%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => { const g = items[c.dataIndex]; const head = ` ${c.label}: ${fmtEUR(c.raw, 0)} · ${fmtN(c.raw / total * 100, 1)} %`; return g && g.parts ? [head, ...g.parts.map(p => `   ${p.label}: ${fmtEUR(p.v, 0)} · ${fmtN(p.pct, 1)} %`)] : head; } } } }, maintainAspectRatio: false } });
}
export const AVG_COLOR = '#F5F5F5';
// Estadístico de referencia de un gráfico: media aritmética, mediana o media geométrica (para rentabilidades en %)
export function avgDataset(data, { stat = 'mean', label } = {}) {
  const vals = data.filter(v => v != null && !isNaN(v)); let v = null;
  if (vals.length) {
    if (stat === 'median') { const s = [...vals].sort((a, b) => a - b); const m = s.length >> 1; v = s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
    else if (stat === 'geo') { let acc = 1, ok = true; for (const x of vals) { if (1 + x / 100 <= 0) { ok = false; break; } acc *= 1 + x / 100; } v = ok ? (Math.pow(acc, 1 / vals.length) - 1) * 100 : vals.reduce((a, b) => a + b, 0) / vals.length; }
    else v = vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  const name = label || (stat === 'median' ? 'Mediana' : stat === 'geo' ? 'Media geom.' : 'Media');
  return { type: 'line', label: name, data: data.map(() => v), borderColor: AVG_COLOR, borderDash: [6, 4], borderWidth: 2, pointRadius: 0, fill: false, order: 0, isAvg: true };
}
export function legendHTML(items, max = 12) { items = groupSmall(items); const total = sum(items, i => Math.max(0, i.v)) || 1; return `<div class="legend">${items.slice(0, max).map(i => `<div${i.parts ? ` class="tip" tabindex="0" data-tip="${esc(partsText(i))}"` : ''}><i style="background:${i.color}"></i><span class="lb">${esc(i.label)}${i.parts ? ' <span class="q">?</span>' : ''}</span><span class="amt">${fmtK(i.v)}</span><span class="pct">${fmtN(Math.max(0, i.v) / total * 100, 1)} %</span></div>`).join('')}${items.length > max ? `<div class="more">+${items.length - max} más</div>` : ''}</div>`; }
export function bars(id, labels, data, { colorPos = '#9FA8DA', colorNeg = '#EF6C63', pct = false, money = false, avg = true, stat, label } = {}) {
  const ds = [{ type: 'bar', label: pct ? 'Mes' : 'Importe', data, backgroundColor: data.map(x => x >= 0 ? colorPos : colorNeg), borderRadius: 4, order: 1 }];
  if (avg) ds.push(avgDataset(data, { stat: stat || (pct ? 'geo' : 'mean'), label }));
  const fmt = pct ? (v => fmtPct(v, 2)) : (v => fmtK(v));
  chart(id, { type: 'bar', data: { labels, datasets: ds }, plugins: [endLabels], options: { layout: { padding: { right: 8 } }, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: { ticks: { callback: pct ? pctTick : (v => fmtK(v)) }, grid }, x: { grid: { display: false }, ticks: { maxTicksLimit: 14 } } }, plugins: { endLabels: { fmt }, legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ` + (pct ? fmtPct(c.raw) : fmtEUR(c.raw, 0)) } } } } });
}
export function line(id, labels, datasets, { money = false, pct = false, avg = false } = {}) {
  const ds = datasets.map(d => ({ tension: .3, pointRadius: 2, spanGaps: true, ...d }));
  if (avg && datasets[0]) ds.push(avgDataset(datasets[0].data, typeof avg === 'object' ? avg : {}));
  chart(id, { type: 'line', data: { labels, datasets: ds }, plugins: [endLabels], options: { layout: { padding: { right: 8 } }, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: { ticks: { callback: pct ? pctTick : money ? (v => fmtK(v)) : undefined }, grid }, x: { grid: { display: false }, ticks: { maxTicksLimit: 14 } } }, plugins: { endLabels: { fmt: pct ? (v => fmtPct(v, 1)) : money ? (v => fmtK(v)) : (v => fmtN(v, 1)) }, legend: { display: datasets.length > 1 }, tooltip: { callbacks: { label: c => ` ${c.dataset.label || ''}: ${pct ? fmtPct(c.raw) : money ? fmtEUR(c.raw, 0) : fmtN(c.raw, 2)}` } } } } });
}
