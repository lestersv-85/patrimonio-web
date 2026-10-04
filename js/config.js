// Configuración de la web. Rellena SUPABASE_URL y SUPABASE_ANON_KEY (la anon key es pública por diseño; la seguridad la ponen las políticas RLS).
// Si están vacías, la app carga ../data/snapshot.json (copia local generada por jobs/export_snapshot.py) en modo solo lectura con cambios guardados en el navegador.
export const CONFIG = {
  SUPABASE_URL: 'https://bowuuimtsgeelgmhsdgu.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_ay0-wCWuBp77QtE9-v2e7Q_KILYPJP7',
  SNAPSHOT_URL: '../data/snapshot.json',
  APP_NAME: 'Seguimiento del patrimonio',
};
