// Adaptador privado: los datos y la configuración viven separados de settings.
import { DB } from '../store.js?v=bb18823';
import { esc } from '../util.js?v=bb18823';

export function createLwsAdapters() {
  async function context() {
    if (DB.mode !== 'cloud' || !DB.client) throw new Error('Modo local: importa una base JSON para trabajar. El guardado privado requiere iniciar sesión.');
    const { data, error } = await DB.client.auth.getSession();
    if (error) throw error;
    const owner = data?.session?.user?.id;
    if (!owner || owner !== DB.user?.id) throw new Error('La sesión ha cambiado. Recarga e inicia sesión de nuevo.');
    return { client: DB.client, owner };
  }
  return {
    async loadData() {
      if (DB.mode === 'local') return null;
      const { client, owner } = await context();
      const { data, error } = await client.from('cartera_analysis_artifacts')
        .select('payload').eq('owner_id', owner).eq('filename', 'lws-method-data.json').maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return JSON.parse(data.payload);
    },
    async loadSaved() {
      if (DB.mode === 'local') return null;
      const { client, owner } = await context();
      const { data, error } = await client.from('cartera_method_configs')
        .select('config,revision').eq('owner_id', owner).eq('id', 'active').maybeSingle();
      if (error) throw error;
      return data;
    },
    async loadHistory() {
      const { client, owner } = await context();
      const { data, error } = await client.from('cartera_method_config_versions')
        .select('config,revision,archived_at').eq('owner_id',owner).eq('id','active')
        .order('revision',{ascending:false}).limit(100);
      if(error)throw error;
      return data;
    },
    async saveSaved(config, expectedRevision) {
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('Revisión inválida.');
      const { client, owner } = await context();
      const revision = expectedRevision + 1;
      const body = { config, revision, updated_at: new Date().toISOString() };
      const table = client.from('cartera_method_configs');
      const query = expectedRevision === 0
        ? table.insert({ ...body, owner_id: owner, id: 'active' })
        : table.update(body).eq('owner_id', owner).eq('id', 'active').eq('revision', expectedRevision);
      const { data, error } = await query.select('config,revision');
      if (error && error.code !== '23505') throw error;
      if (error || !Array.isArray(data) || data.length !== 1) {
        const conflict = new Error('Conflicto de revisión: vuelve a cargar la configuración antes de guardar.');
        conflict.code = 'REVISION_CONFLICT';
        throw conflict;
      }
      return data[0];
    },
  };
}

export function renderLws(v) {
  v.innerHTML = `<h2>Método LWS</h2>${DB.mode === 'local' ? '<p class="note">Modo local: los datos privados no se descargan. Importa una base JSON desde el archivo para utilizar el método; guardar en la nube requiere sesión.</p>' : ''}<div class="lws-method-host"><p class="muted">Cargando método…</p></div>`;
  const host = v.querySelector('.lws-method-host');
  // Carga diferida: la ausencia temporal del módulo compartido no bloquea otras rutas.
  import('../lws-method-ui.js?v=bb18823').then(async ({ mountLWSMethod }) => {
    if (!host.isConnected) return;
    await mountLWSMethod(host, createLwsAdapters());
  }).catch(error => {
    if (host.isConnected) host.innerHTML = `<div class="note warn">No se pudo cargar el método LWS: ${esc(error.message)}</div>`;
  });
}
