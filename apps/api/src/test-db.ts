import pg from 'pg';
import type { Db } from './db/db';
import { createPgDb } from './db/pg-db';
import { createPgliteDb } from './db/pglite-db';

/**
 * Tests run on embedded Postgres (PGlite) by default. Set TEST_DATABASE_URL (an admin connection to a
 * PostgreSQL server, e.g. postgres://postgres@localhost:5432/postgres) to run the same suite on the real
 * `pg` driver: each test gets its own throwaway database, dropped afterwards.
 */
export async function openTestDb(): Promise<{ db: Db; drop: () => Promise<void> }> {
  const admin = process.env['TEST_DATABASE_URL'];
  if (!admin) {
    const db = await createPgliteDb();
    return { db, drop: () => db.close() };
  }
  const name = `myshop_test_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
  const client = new pg.Client({ connectionString: admin });
  await client.connect();
  await client.query(`CREATE DATABASE ${name}`);
  const url = new URL(admin);
  url.pathname = `/${name}`;
  const db = createPgDb(url.toString());
  return {
    db,
    drop: async () => {
      await db.close();
      await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await client.end();
    },
  };
}
