import 'dotenv/config';
import { boot } from './api/server.js';
import { pool } from './db/pool.js';
import { migrate } from './db/migrate.js';
import { syncCatalog, syncOrders } from './shopify/sync.js';
import { log } from './config.js';

async function main() {
  const dbOk = await pool.query(`SELECT 1`).then(() => true).catch(() => false);
  if (dbOk) {
    try {
      await migrate();
      await syncCatalog();
      await syncOrders();
    } catch (e: any) {
      log('startup migrate/sync warning:', e.message);
    }
  } else {
    log('database not reachable at boot — server will start degraded (db:false). Set DATABASE_URL to a reachable Postgres and restart.');
  }
  await boot(dbOk);
}

main().catch(async (e) => {
  console.error('boot failed:', e.message);
  await pool.end().catch(() => {});
  process.exit(1);
});