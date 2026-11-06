import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Pool, types } from 'pg';
import type { Db, Queryable } from './database';

// int8 (sum() results) arrives as a string by default; satang totals stay well under 2^53.
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => Number(v));

export function createPgDb(connectionString: string): Db {
  const pool = new Pool({ connectionString });
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      return (await pool.query(sql, params)).rows as T[];
    },
    async transaction<T>(fn: (tx: Queryable) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({ query: async <R>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as R[] });
        await client.query('COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
    async backup(dir: string) {
      await mkdir(dir, { recursive: true });
      const file = join(dir, `myshop-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`);
      // pg_dump must be installed on the shop server (it ships with PostgreSQL); PG_DUMP_PATH points at it when it is not on PATH.
      await promisify(execFile)(process.env['PG_DUMP_PATH'] ?? 'pg_dump', ['--format=custom', `--file=${file}`, connectionString]);
      return file;
    },
    close: () => pool.end(),
  };
}
