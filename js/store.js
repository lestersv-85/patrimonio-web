// Acceso a datos: Supabase (nube) o copia local (snapshot) con cambios en localStorage.
import { CONFIG } from './config.js?v=25c4e9c';
import { toast, uid } from './util.js?v=25c4e9c';

export const DB = {
  mode: 'local', client: null, user: null, ready: false,
  accounts: [], positions: [], operations: [], dividends: [], clock: [], filiosHistory: [], settings: null, syncLog: [],
  prices: {},      // position_id -> {date: close}
  fx: {},          // ccy -> {date: rate}
  bench: {},       // symbol -> {date: close}
  macro: {},       // series -> {date: value}
  meta: { loadedAt: null, source: '' },
};
const LS_EDITS = 'sp-local-edits-v1';

async function supabase() {
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) return null;
  if (new URLSearchParams(location.search).has('local')) return null; // ?local=1 fuerza la copia local (data/snapshot.json)
  const mod = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm'); // versión fijada: una actualización del CDN no puede romper la app
  return mod.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
}

async function fetchAll(client, table, select = '*', orderCol = null) {
  const out = []; const page = 1000; let from = 0;
  for (;;) {
    let q = client.from(table).select(select).range(from, from + page - 1);
    if (orderCol) q = q.order(orderCol);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < page) break;
    from += page;
  }
  return out;
}

function compactToMap(rows, keyField) {
  const m = {};
  for (const r of rows) m[r[keyField]] = r.h || {};
  return m;
}

export async function loadAll() {
  const client = await supabase();
  if (client) {
    DB.mode = 'cloud'; DB.client = client;
    const { data: { session } } = await client.auth.getSession();
    if (!session) { DB.ready = false; return { needLogin: true }; }
    DB.user = session.user;
    // Lo esencial (cuentas, posiciones, operaciones, dividendos, precios, cambios) es obligatorio; el resto puede faltar sin tumbar la app
    const jobs = {
      accounts: fetchAll(client, 'accounts'), positions: fetchAll(client, 'positions'), operations: fetchAll(client, 'operations', '*', 'date'), dividends: fetchAll(client, 'dividends', '*', 'date'),
      clock: fetchAll(client, 'clock_readings', '*', 'month'), hist: fetchAll(client, 'filios_history'), settings: client.from('settings').select('*').maybeSingle().then(r => r.data),
      syncLog: client.from('sync_log').select('*').order('id', { ascending: false }).limit(20).then(r => r.data || []),
      prices: fetchAll(client, 'prices_compact'), fx: fetchAll(client, 'fx_compact'), bench: fetchAll(client, 'bench_compact'), macro: fetchAll(client, 'macro_compact'),
    };
    const keys = Object.keys(jobs); const res = await Promise.allSettled(keys.map(k => jobs[k]));
    const got = {}; const failed = [];
    keys.forEach((k, i) => { if (res[i].status === 'fulfilled') got[k] = res[i].value; else { failed.push(`${k}: ${res[i].reason?.message || res[i].reason}`); got[k] = k === 'settings' ? null : []; } });
    const essential = ['accounts', 'positions', 'operations', 'dividends', 'prices', 'fx'].filter(k => res[keys.indexOf(k)].status === 'rejected');
    if (essential.length) throw new Error(failed.join(' · '));
    if (failed.length) { DB.loadWarnings = failed; console.warn('Carga parcial:', failed); }
    const { accounts, positions, operations, dividends, clock, hist, settings, syncLog, prices, fx, bench, macro } = got;
    Object.assign(DB, { accounts, positions, operations, dividends, clock, filiosHistory: hist, settings, syncLog, prices: compactToMap(prices, 'position_id'), fx: compactToMap(fx, 'ccy'), bench: compactToMap(bench, 'symbol'), macro: compactToMap(macro, 'series') });
    DB.meta = { loadedAt: new Date(), source: 'Supabase' };
  } else {
    DB.mode = 'local';
    const r = await fetch(CONFIG.SNAPSHOT_URL, { cache: 'no-store' });
    if (!r.ok) throw new Error('No se encontró data/snapshot.json. Ejecuta jobs/export_snapshot.py');
    const s = await r.json();
    Object.assign(DB, { accounts: s.accounts || [], positions: s.positions || [], operations: s.operations || [], dividends: s.dividends || [], clock: s.clock_readings || [], filiosHistory: s.filios_history || [], settings: (s.settings || [])[0] || null, syncLog: s.sync_log || [], prices: s.prices || {}, fx: s.fx || {}, bench: s.benchmarks || {}, macro: s.macro || {} });
    DB.meta = { loadedAt: new Date(), source: 'snapshot ' + (s.exported_at || '') };
    applyLocalEdits();
  }
  DB.ready = true;
  return { needLogin: false };
}

export async function signIn(email, password) {
  const { error } = await DB.client.auth.signInWithPassword({ email, password });
  if (error) throw error;
}
export async function signInWithLink(email) {
  // shouldCreateUser: false → un correo distinto al de la cuenta no crea un usuario vacío (fue la causa del móvil sin datos)
  const { error } = await DB.client.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href.split('#')[0], shouldCreateUser: false } });
  if (error) throw error;
}
export async function setPassword(password) {
  const { error } = await DB.client.auth.updateUser({ password });
  if (error) throw error;
}
export async function signOut() { if (DB.client) await DB.client.auth.signOut(); location.reload(); }

// ---- Escritura ----
function localEdits() { try { return JSON.parse(localStorage.getItem(LS_EDITS) || '{"upserts":{},"deletes":{}}'); } catch (e) { return { upserts: {}, deletes: {} }; } }
function saveLocalEdits(e) { try { localStorage.setItem(LS_EDITS, JSON.stringify(e)); } catch (err) {} }
function applyLocalEdits() {
  const e = localEdits();
  for (const key in e.upserts) { const [table, id] = key.split(':'); const arr = tableArr(table); if (!arr) continue; const i = arr.findIndex(x => x.id === id); if (i >= 0) arr[i] = e.upserts[key]; else arr.push(e.upserts[key]); }
  for (const key in e.deletes) { const [table, id] = key.split(':'); const arr = tableArr(table); if (!arr) continue; const i = arr.findIndex(x => x.id === id); if (i >= 0) arr.splice(i, 1); }
  if (e.upserts['settings:main']) DB.settings = e.upserts['settings:main'];
}
function tableArr(table) { return { accounts: DB.accounts, positions: DB.positions, operations: DB.operations, dividends: DB.dividends }[table]; }
export function localEditCount() { const e = localEdits(); return Object.keys(e.upserts).length + Object.keys(e.deletes).length; }
export function clearLocalEdits() { localStorage.removeItem(LS_EDITS); }

export async function upsert(table, row) {
  row = { ...row }; if (!row.id) row.id = uid(); row.updated_at = new Date().toISOString();
  const arr = tableArr(table);
  if (arr) { const i = arr.findIndex(x => x.id === row.id); if (i >= 0) arr[i] = row; else arr.push(row); }
  if (table === 'settings') DB.settings = row;
  if (DB.mode === 'cloud') {
    // settings no tiene columna id en Supabase (su clave es user_id): el id 'main' es solo de la copia local
    const payload = { ...row }; delete payload.user_id; if (table === 'settings') delete payload.id;
    const { error } = await DB.client.from(table).upsert(payload, { onConflict: table === 'settings' ? 'user_id' : 'id' });
    if (error) { toast('No se pudo guardar: ' + error.message); throw error; }
  } else {
    const e = localEdits(); e.upserts[`${table}:${row.id}`] = row; delete e.deletes[`${table}:${row.id}`]; saveLocalEdits(e);
  }
  return row;
}
export async function remove(table, id) {
  const arr = tableArr(table); if (arr) { const i = arr.findIndex(x => x.id === id); if (i >= 0) arr.splice(i, 1); }
  if (DB.mode === 'cloud') { const { error } = await DB.client.from(table).delete().eq('id', id); if (error) { toast('No se pudo borrar: ' + error.message); throw error; } }
  else { const e = localEdits(); delete e.upserts[`${table}:${id}`]; e.deletes[`${table}:${id}`] = true; saveLocalEdits(e); }
}
export async function savePrice(positionId, date, close, source = 'manual') {
  (DB.prices[positionId] = DB.prices[positionId] || {})[date] = close;
  if (DB.mode === 'cloud') { const { error } = await DB.client.from('prices').upsert({ position_id: positionId, date, close, source }, { onConflict: 'position_id,date' }); if (error) toast('Precio no guardado: ' + error.message); }
  else { const e = localEdits(); e.upserts[`prices:${positionId}:${date}`] = { position_id: positionId, date, close, source }; saveLocalEdits(e); }
}
export async function saveSettings(patch) {
  const row = { ...(DB.settings || {}), ...patch, id: 'main' };
  if (DB.mode === 'cloud') row.user_id = DB.user.id;
  return upsert('settings', row);
}
