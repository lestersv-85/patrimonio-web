// Lista de seguimiento: candidatos que aún no están en cartera.
//
// Sirven para una pregunta concreta del taller de Tamaños: ¿este candidato aporta algo *dado lo que
// ya tengo*? Un activo puede ser excelente y no merecer sitio si se mueve igual que lo que ya llevas.
// Por eso se dan de alta aquí y se marcan allí, en la misma tabla que las posiciones reales.
//
// El histórico no se descarga desde el navegador: la web es estática y no puede llamar a Yahoo
// (CORS). Lo baja `python3 jobs/fetch_market.py watchlist`, que escribe en `benchmarks` y anota en
// la fila desde cuándo hay dato. Hasta que corra, el candidato existe pero no se puede dimensionar,
// y la tabla lo dice en vez de callarlo.
import { DB, upsert, remove } from '../store.js?v=57b99b9';
import { simbolosEnCartera, cerradasConMercado } from '../engine.js?v=57b99b9';
import { $, $$, esc, fmtN, fmtDate, todayISO, uid, toast, TYPES } from '../util.js?v=57b99b9';

const TIPOS = { stock: 'Acción', etf: 'ETF', fund: 'Fondo', crypto: 'Cripto' };

// Sugerencias con el símbolo de Yahoo ya resuelto, para no pelearse con el buscador
const SUGERENCIAS = [
  ['IWDA.AS', 'iShares Core MSCI World acc (EUR)', 'etf'],
  ['SXR8.DE', 'iShares Core S&P 500 acc (EUR)', 'etf'],
  ['4GLD.DE', 'Xetra-Gold (EUR)', 'etf'],
  ['EUNH.DE', 'iShares Deuda pública euro 7-10a (EUR)', 'etf'],
  ['XEON.DE', 'Xtrackers €STR overnight acc (EUR)', 'etf'],
  ['VWCE.DE', 'Vanguard FTSE All-World acc (EUR)', 'etf'],
];

const anos = w => (w.history_from && w.history_to)
  ? (new Date(w.history_to) - new Date(w.history_from)) / 31557600000 : null;

export function renderSeguimiento(v, C, { UI, render, go }) {
  const W = [...(DB.watchlist || [])].sort((a, b) => (a.ticker || a.symbol).localeCompare(b.ticker || b.symbol));
  // Tener es tener participaciones HOY, no tener ficha. Este era el fallo: se miraba si existía el
  // registro en `positions`, y una posición vendida entera no se borra nunca. Resultado: los 131
  // tickers que este usuario ha cerrado desde 2015 —MSFT el último, vendido el 2 sept 2026— no se
  // podían añadir aquí («ya es una posición tuya») ni aparecían en Dimensionado, que solo lista
  // tenencias vivas. Quedaban fuera de las dos pantallas a la vez. La definición vive ahora en
  // `engine.js` y es la misma que usa el taller, para que no puedan volver a discrepar.
  const enCartera = simbolosEnCartera(C);
  const yaEnCartera = s => enCartera.has(String(s).toUpperCase());
  // Las que ya llevaste: candidatas con el histórico ya descargado. Se ofrecen para añadir de un
  // clic porque, si no, no hay forma de saber que están ahí.
  const cerradas = cerradasConMercado(C);
  const enLista = new Set((DB.watchlist || []).map(w => String(w.symbol || '').toUpperCase()));
  const exLlevadas = [...cerradas.values()]
    .filter(p => !enLista.has(String(p.yahoo_symbol).toUpperCase()) && p.type !== 'option')
    .sort((a, b) => String(a.ticker).localeCompare(String(b.ticker)));

  v.innerHTML = `<h2>Lista de seguimiento</h2>
    <p class="muted" style="margin:.2rem 0 .9rem;font-size:.85rem;max-width:95ch">Candidatos que todavía no tienes. Sirven para una sola pregunta: <b>¿este activo aporta algo dado lo que ya llevas?</b> Un valor excelente no merece sitio si se mueve igual que lo que ya tienes. Se dan de alta aquí y se marcan en <b>Dimensionado</b>, en la misma tabla que tus posiciones, para que el modelo calcule con ellos dentro.</p>

    <div class="grid2">
      <div class="card pad">
        <h3>Añadir candidato</h3>
        <div class="field"><label>Símbolo de Yahoo</label><input type="text" id="wl-sym" placeholder="TSM · ASML.AS · 0700.HK" autocomplete="off"></div>
        <div class="field"><label>Etiqueta corta</label><input type="text" id="wl-tk" placeholder="opcional: cómo quieres verlo en la tabla"></div>
        <div class="field"><label>Nombre</label><input type="text" id="wl-nm" placeholder="opcional"></div>
        <div class="field"><label>Tipo</label><select id="wl-tipo">${Object.entries(TIPOS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
        <div class="field"><label>Por qué está en la lista</label><input type="text" id="wl-nota" placeholder="la tesis en una línea"></div>
        <div class="field"><label>Retorno esperado de la tesis</label><input type="number" id="wl-mu" step="0.5" placeholder="8"><span class="muted">% anual</span></div>
        <div class="toolbar" style="justify-content:flex-end;margin-top:.6rem"><button class="btn primary" id="wl-add">Añadir</button></div>
        <div class="chips" style="margin-top:.7rem">${SUGERENCIAS.filter(s => !W.some(w => w.symbol === s[0]) && !yaEnCartera(s[0])).map(([s, n, t]) => `<button class="chip" data-sug="${esc(s)}|${esc(n)}|${t}" title="${esc(n)}">+ ${esc(s)}</button>`).join('')}</div>
        ${exLlevadas.length ? `<details style="margin-top:.7rem">
          <summary class="muted" style="cursor:pointer;font-size:.8rem">Las que ya llevaste y vendiste enteras · ${exLlevadas.length}</summary>
          <p class="muted" style="font-size:.74rem;margin:.5rem 0 .4rem">Vender no borra nada: su histórico completo sigue en la base y el trabajo de precios lo actualiza a diario. Si la añades aquí, se dimensiona <b>en el acto</b>, sin esperar a ninguna descarga.</p>
          <div class="chips">${exLlevadas.map(p => `<button class="chip" data-sug="${esc(p.yahoo_symbol)}|${esc(p.name || p.ticker)}|${esc(p.type || 'stock')}" title="${esc(p.name || p.ticker)}">+ ${esc(p.ticker)}</button>`).join('')}</div>
        </details>` : ''}
        <p class="muted" style="font-size:.74rem;margin:.6rem 0 0">El símbolo tiene que ser el de Yahoo Finance, con su sufijo de mercado: <span class="mono">ASML.AS</span> (Ámsterdam), <span class="mono">NESN.SW</span> (Suiza), <span class="mono">0700.HK</span> (Hong Kong). Sin sufijo se entiende mercado americano.</p>
      </div>

      <div class="card pad">
        <h3>Cómo llega el histórico</h3>
        <div class="note"><b>No se descarga desde el navegador.</b> La web es estática y no puede llamar a un mercado. Lo baja el trabajo de precios, que escribe la serie completa y anota desde cuándo hay dato.</div>
        <div class="note"><b>Lo baja el trabajo de los sábados</b> (06:30 UTC), no el diario de las 22:00: el ciclo diario solo actualiza lo que ya tienes. Un candidato nuevo tarda como mucho una semana en tener serie, y no hay que tocar ningún ordenador.</div>
        <div class="note"><b>Para no esperar:</b> Actions → «Histórico de precios (backfill)» → <i>Run workflow</i>. O en tu Mac, <span class="mono">python3 jobs/fetch_market.py watchlist</span> y <span class="mono">python3 jobs/sync_supabase.py push</span>.</div>
        <div class="note"><b>Tres fuentes, por ISIN.</b> justETF para los ETF, Business Insider para las acciones sueltas y Yahoo cuando responde. Si das de alta un ticker, escribe el ISIN entre paréntesis en el nombre: es lo que usan las dos primeras para encontrarlo.</div>
        <div class="note warn"><b>El histórico real de cada activo es el que es.</b> Se pide todo lo que haya desde su salida a bolsa, pero un valor que empezó a cotizar en 2021 no tiene veinte años por mucho que se le pidan. Y en el taller <b>la ventana común la fija el más joven que marques</b>: un candidato con tres años recorta a tres años la ventana de todos los demás. Por eso la columna «Histórico» está aquí y no escondida.</div>
      </div>
    </div>

    <div class="card">
      <div class="head"><h3>Candidatos</h3><span class="sub">${W.length} en la lista</span></div>
      <div class="tablewrap"><table>
        <thead><tr><th>Símbolo</th><th>Nombre y tesis</th><th>Tipo</th><th class="num">μ tesis</th>
          <th class="num">Histórico</th><th class="num">Puntos</th><th>Última descarga</th><th></th></tr></thead>
        <tbody id="wl-filas">${W.length ? W.map(fila).join('') : `<tr><td colspan="8" class="muted" style="padding:1rem">Lista vacía. Añade el primero arriba, o usa una de las sugerencias.</td></tr>`}</tbody>
      </table></div>
    </div>`;

  // El histórico de un candidato puede venir de dos sitios y la tabla tiene que decir de cuál: de la
  // descarga del trabajo de precios (columnas `history_*`) o, si ese símbolo ya fue tuyo, de su
  // propia serie, que ya está en la base. Lo segundo no se anota en la fila de seguimiento, así que
  // sin esto la tabla diría «sin bajar» de algo que lleva años descargado.
  function histDe(w) {
    const p = cerradas.get(String(w.symbol || '').toUpperCase());
    const m = p ? DB.prices[p.id] : null;
    const k = m ? Object.keys(m).sort() : null;
    if (k && k.length > 1)
      return { a: (new Date(k[k.length - 1]) - new Date(k[0])) / 31557600000, desde: k[0].slice(0, 7), propio: true };
    return { a: anos(w), desde: w.history_from ? w.history_from.slice(0, 7) : null, propio: false };
  }

  function fila(w) {
    const h = histDe(w);
    const cl = h.a == null ? 'muted' : h.a >= 8 ? 'pos' : h.a >= 4 ? 'warn' : 'neg';
    const estado = h.propio
      ? '<span class="pos" title="No hace falta descargar nada: es tu propia serie, la que el trabajo de precios actualiza a diario porque la posición sigue en la base.">ya en la base</span>'
      : w.last_error ? `<span class="neg" title="${esc(w.last_error)}">falló</span>`
      : w.last_fetch ? `<span class="muted">${esc(String(w.last_fetch).slice(0, 10))}</span>`
      : '<span class="warn">pendiente</span>';
    const marca = yaEnCartera(w.symbol)
      ? ' <span class="badge warn" title="Ya la llevas otra vez: en Dimensionado sale como posición, con su peso real. Como candidata no se cuenta, para no meterla dos veces en la matriz.">ya en cartera</span>'
      : h.propio ? ' <span class="badge" title="Ya la llevaste y la vendiste entera. Se dimensiona con su propio histórico.">ya la llevaste</span>' : '';
    return `<tr>
      <td><b class="mono">${esc(w.symbol)}</b>${marca}${w.ticker && w.ticker !== w.symbol ? `<span class="sub2">${esc(w.ticker)}</span>` : ''}</td>
      <td>${esc(w.name || '—')}${w.note ? `<span class="sub2">${esc(w.note)}</span>` : ''}</td>
      <td class="muted">${esc(TIPOS[w.type] || w.type || '—')}</td>
      <td class="num">${w.mu_tesis == null ? '<span class="muted">—</span>' : fmtN(w.mu_tesis, 1) + ' %'}</td>
      <td class="num ${cl}">${h.a == null ? '<span class="muted">sin bajar</span>' : fmtN(h.a, 1) + ' a'}${h.desde ? `<span class="sub2">desde ${esc(h.desde)}</span>` : ''}</td>
      <td class="num muted">${h.propio ? `<span title="El taller usa tu serie diaria completa. Esta copia del navegador va comprimida (dos años de diario y fin de mes antes), así que aquí no se cuenta.">serie propia</span>` : (w.history_n || '—')}</td>
      <td>${estado}</td>
      <td class="num"><button class="btn sm ghost" data-del="${esc(w.id)}" title="Quitar de la lista">✕</button></td></tr>`;
  }

  $$('[data-sug]', v).forEach(b => b.onclick = () => {
    const [s, n, t] = b.dataset.sug.split('|');
    $('#wl-sym').value = s; $('#wl-nm').value = n; $('#wl-tipo').value = t; $('#wl-sym').focus();
  });

  $('#wl-add').onclick = async () => {
    const symbol = $('#wl-sym').value.trim();
    if (!symbol) { toast('Hace falta el símbolo de Yahoo'); return; }
    if ((DB.watchlist || []).some(w => w.symbol.toUpperCase() === symbol.toUpperCase())) { toast('Ya está en la lista'); return; }
    // Solo se rechaza lo que se tiene AHORA: esa ya sale en Dimensionado con su peso real, y
    // duplicarla como candidata la contaría dos veces en la matriz de covarianzas.
    if (yaEnCartera(symbol)) { toast('Esa sí la llevas hoy: ya sale en Dimensionado con su peso, no hace falta añadirla'); return; }
    const mu = $('#wl-mu').value.trim();
    try {
      await upsert('watchlist', {
        id: uid(), symbol, ticker: $('#wl-tk').value.trim() || symbol,
        name: $('#wl-nm').value.trim() || null, type: $('#wl-tipo').value,
        note: $('#wl-nota').value.trim() || null, mu_tesis: mu === '' ? null : +mu,
        added_at: todayISO(),
      });
      toast(cerradas.has(symbol.toUpperCase())
        ? 'Añadido. Ya la llevaste: su histórico está descargado y se dimensiona ya.'
        : 'Añadido. El histórico llega con el próximo trabajo de precios.');
      render();
    } catch (e) { toast('No se pudo añadir: ' + e.message); }
  };
  $('#wl-sym').onkeydown = e => { if (e.key === 'Enter') $('#wl-add').click(); };

  $$('[data-del]', v).forEach(b => b.onclick = async () => {
    const w = (DB.watchlist || []).find(x => x.id === b.dataset.del);
    if (!w || !confirm(`¿Quitar ${w.symbol} de la lista de seguimiento?\n\nSu histórico descargado se queda en la base; solo desaparece de esta lista.`)) return;
    try { await remove('watchlist', w.id); render(); } catch (e) { toast('No se pudo quitar: ' + e.message); }
  });
}
