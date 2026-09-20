import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, 'migrations');

export async function migrate(): Promise<string[]> {
  const client = await pool.connect();
  const appliedNow: string[] = [];
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

    const files = (await import('node:fs')).readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    const { rows } = await client.query(`SELECT name FROM _migrations`);
    const applied = new Set(rows.map((r: any) => r.name));

    for (const file of files) {
      if (applied.has(file)) {
        continue;
      }
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      console.log(`apply  ${file}`);
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(`INSERT INTO _migrations (name) VALUES ($1)`, [file]);
      await client.query('COMMIT');
      appliedNow.push(file);
    }
    console.log('migrations up to date');
    return appliedNow;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Direct CLI run: `npm run migrate`
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('migrate.ts')) {
  migrate()
    .then(async () => {
      await pool.end();
    })
    .catch(async (err) => {
      console.error('migration failed:', err);
      await pool.end().catch(() => {});
      process.exit(1);
    });
}