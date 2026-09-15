// Ordenar cualquier tabla pulsando su cabecera. Se aplica sola a todas las tablas de la vista.
//
// Tres cosas que no son obvias y que aquí sí se respetan:
//  1. Los números vienen formateados en español: «1.234,56 €», «+12,3 %», «−24.167 €», «11,7 a».
//     El punto es separador de miles y la coma decimal, y el menos suele ser el signo tipográfico
//     (−, U+2212), no el guion. Ordenar por texto pondría «9 €» por encima de «1.234 €».
//  2. Hay tablas con filas de sección (una celda con colspan que hace de título). Ordenar la tabla
//     entera las mezclaría: se ordena dentro de cada bloque y las cabeceras de sección no se mueven.
//  3. Lo que falta («—», vacío) va siempre al final, suba o baje el orden: un hueco no es un cero.
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// Número en formato español a número. Devuelve null si la celda no es numérica.
export function numES(s) {
  const t = String(s).replace(/[−–—]/g, '-').replace(/[^\d,.\-]/g, '');
  if (!t || t === '-' || t === '.' || t === ',') return null;
  const n = parseFloat(t.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return isNaN(n) ? null : n;
}

// «13 sep 2026» → «2026-09-13» para que ordene como fecha y no como texto
function fechaES(s) {
  const m = String(s).trim().match(/^(\d{1,2})\s+([a-zñ]{3})\.?\s+(\d{4})$/i);
  if (!m) return null;
  const i = MESES.indexOf(m[2].toLowerCase());
  return i < 0 ? null : `${m[3]}-${String(i + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// Valor ordenable de una celda: `data-sort` manda; si no, lo que se ve (y lo que hay escrito en un
// campo editable, que es lo que el usuario está mirando).
function valor(tr, i) {
  const td = tr.cells[i];
  if (!td) return '';
  if (td.dataset.sort != null) return td.dataset.sort;
  const inp = td.querySelector('input, select');
  if (inp && inp.type !== 'checkbox') return inp.value;
  if (inp && inp.type === 'checkbox') return inp.checked ? '1' : '0';
  return td.textContent.trim();
}

const esSeccion = tr => tr.cells.length === 1 && tr.cells[0].colSpan > 1;

function comparar(a, b, i, dir) {
  const va = valor(a, i), vb = valor(b, i);
  const vacio = v => v === '' || v === '—' || v === '-';
  if (vacio(va) && vacio(vb)) return 0;
  if (vacio(va)) return 1;          // los huecos, siempre al final
  if (vacio(vb)) return -1;
  const fa = fechaES(va), fb = fechaES(vb);
  if (fa && fb) return dir * fa.localeCompare(fb);
  const na = numES(va), nb = numES(vb);
  if (na != null && nb != null) return dir * (na - nb);
  return dir * String(va).localeCompare(String(vb), 'es', { numeric: true, sensitivity: 'base' });
}

function ordenar(tabla, i, th) {
  const dir = th.dataset.dir === 'asc' ? -1 : 1;
  [...tabla.tHead.rows[0].cells].forEach(x => { delete x.dataset.dir; x.classList.remove('ord-on'); });
  th.dataset.dir = dir === 1 ? 'asc' : 'desc';
  th.classList.add('ord-on');
  const cuerpo = tabla.tBodies[0];
  const filas = [...cuerpo.rows];
  // Bloques separados por las filas de sección; cada uno se ordena por su cuenta
  const bloques = []; let actual = { cabecera: null, filas: [] };
  for (const tr of filas) {
    if (esSeccion(tr)) { bloques.push(actual); actual = { cabecera: tr, filas: [] }; }
    else actual.filas.push(tr);
  }
  bloques.push(actual);
  const frag = document.createDocumentFragment();
  for (const b of bloques) {
    if (b.cabecera) frag.appendChild(b.cabecera);
    b.filas.sort((x, y) => comparar(x, y, i, dir)).forEach(tr => frag.appendChild(tr));
  }
  cuerpo.appendChild(frag);
}

// Marca todas las tablas de `root` como ordenables. Idempotente: se puede llamar en cada render.
// Una cabecera con `data-noord` se queda quieta (la columna de casillas, la de botones).
export function hacerOrdenables(root) {
  for (const t of root.querySelectorAll('table')) {
    const th0 = t.tHead && t.tHead.rows[0];
    if (!th0 || !t.tBodies[0] || t.dataset.ord === '1') continue;
    t.dataset.ord = '1';
    [...th0.cells].forEach((th, i) => {
      if (th.dataset.noord != null || !th.textContent.trim()) return;
      th.classList.add('ord');
      th.title = 'Ordenar por esta columna';
      th.onclick = () => ordenar(t, i, th);
    });
  }
}
