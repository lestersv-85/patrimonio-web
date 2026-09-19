// Atajo para las pruebas de node: expone el mismo objeto DB que store.js sin arrancar la web
// (store.js abre sesión contra Supabase al importarse). Solo lo usa jobs/test_motor.mjs.
export { DB } from './store.js?v=3bf8a9f';
