import 'dotenv/config';
import pg from 'pg';
import { env } from '../config.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.databaseUrl,
  max: 10,
  connectionTimeoutMillis: 8000,
});

export async function query<T extends pg.QueryResultRow = any>(text: string, params?: unknown[]): Promise<pg.QueryResult<T>> {
  try {
    return await pool.query<T>(text, params as any[]);
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { code?: string };
    const msg = e.message
      ? `${e.message} (db via DATABASE_URL)`
      : `database connection failed (${e.code ?? e.name ?? 'unknown error'}) — is DATABASE_URL set on this deployment and reachable?`;
    const wrapped = new Error(msg, { cause: err });
    (wrapped as any).code = e.code;
    throw wrapped;
  }
}