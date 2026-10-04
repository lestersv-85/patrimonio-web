// Aviso de versión nueva.
//
// GitHub Pages cachea diez minutos y esto es una aplicación de una sola página: quien la deja abierta
// en el iPhone o en una pestaña del Mac **se queda con el build que cargó** y no tiene forma de
// enterarse de que hay otro. Antes, la única salida era recargar a mano por si acaso.
//
// Va suelto en su propia etiqueta <script> de index.html y no lo importa `app.js` a propósito: el caso
// en el que más falta hace este aviso es justamente aquel en el que la aplicación NO arranca porque
// tiene módulos viejos mezclados en la caché —el mismo fallo que ya vigila el guardarraíl de
// index.html—, y un aviso que dependiera de `app.js` no llegaría a dibujarse.
//
// La versión no hace falta inyectarla en ningún sitio: `jobs/publish_web.sh` sella cada `src="js/…"`
// con `?v=<commit>`, así que este módulo la lleva puesta en su propia URL. Sirviendo en local no hay
// sello, `ACTUAL` sale vacío y no se arma nada: avisar de una versión nueva mientras editas los
// ficheros no tiene sentido.
const ACTUAL = new URL(import.meta.url).searchParams.get('v') || '';
const CADA = 5 * 60 * 1000;

const CSS = `
.nueva-version { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(var(--nav-h, 62px) + 1.2rem + env(safe-area-inset-bottom)); z-index: 61; display: flex; align-items: center; gap: 0.6rem; max-width: calc(100vw - 32px); padding: 0.5rem 0.55rem 0.5rem 0.9rem; background: var(--surface-2); color: var(--ink); border: 1px solid var(--line-2); border-radius: 10px; box-shadow: var(--shadow); font-size: 0.85rem; }
.nueva-version span { min-width: 0; }
.nueva-version .btn { padding: 0.3rem 0.7rem; font-size: 0.8rem; }
.nueva-version .nv-x { background: none; border: 0; color: var(--muted); cursor: pointer; padding: 0.2rem 0.3rem; line-height: 1; font-size: 0.9rem; }
.nueva-version .nv-x:hover { color: var(--ink); }
@media (min-width: 960px) { .nueva-version { bottom: 1.5rem; } }
@media (max-width: 420px) { .nueva-version { font-size: 0.8rem; gap: 0.45rem; } }
`;

async function publicada() {
  // `no-store` y el sufijo de tiempo son cinturón y tirantes: sin los dos, el propio index.html que se
  // pide para comprobar la versión podría venir de la caché que se está intentando detectar.
  const r = await fetch('index.html?_=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const m = (await r.text()).match(/js\/app\.js\?v=([\w.-]+)/);
  return m ? m[1] : '';
}

function avisar(v) {
  if (document.getElementById('nueva-version')) return;
  if (!document.getElementById('nueva-version-css')) {
    const st = document.createElement('style'); st.id = 'nueva-version-css'; st.textContent = CSS;
    document.head.appendChild(st);
  }
  const b = document.createElement('div');
  b.id = 'nueva-version';
  b.className = 'nueva-version';
  b.innerHTML = `<span>Hay una versión nueva de la web.</span>
    <button type="button" class="btn primary" id="nv-recargar">Recargar</button>
    <button type="button" class="nv-x" id="nv-cerrar" aria-label="Ahora no">✕</button>`;
  document.body.appendChild(b);
  // Recargar con la versión en la URL salta la caché: sin ella, Safari puede devolver el mismo build y
  // el aviso reaparecería a los cinco minutos, que es la peor versión posible de esto.
  b.querySelector('#nv-recargar').onclick = () => {
    const u = new URL(location.href);
    u.searchParams.set('v', v);
    location.replace(u.toString());
  };
  // Cerrar no es «no avisar nunca más», es «de esta versión no». Si se publica otra, se vuelve a avisar.
  b.querySelector('#nv-cerrar').onclick = () => {
    try { sessionStorage.setItem('sp-version-oculta', v); } catch {}
    b.remove();
  };
}

async function mirar() {
  try {
    const v = await publicada();
    let oculta = ''; try { oculta = sessionStorage.getItem('sp-version-oculta') || ''; } catch {}
    if (v && v !== ACTUAL && v !== oculta) avisar(v);
  } catch { /* sin red o Pages caído: no se avisa de nada y no se rompe nada */ }
}

export function vigilarVersion() {
  if (!ACTUAL) return;                       // sirviendo en local, sin sello: no se vigila
  setInterval(mirar, CADA);
  // También al volver a la pestaña: es cuando el usuario mira, y el intervalo puede estar frenado.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) mirar(); });
}

vigilarVersion();
