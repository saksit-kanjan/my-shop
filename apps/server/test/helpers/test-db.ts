import { Client } from 'pg';
import { closeApps } from './services';

/**
 * Tests run on a real PostgreSQL. TEST_DATABASE_URL is an admin connection to a server
 * (default postgres://postgres@localhost:5432/postgres); each test gets its own throwaway database, dropped afterwards.
 */
export async function openTestDb(): Promise<{ url: string; drop: () => Promise<void> }> {
  const admin = process.env['TEST_DATABASE_URL'] ?? 'postgres://postgres@localhost:5432/postgres';
  const name = `myshop_test_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
  const client = new Client({ connectionString: admin });
  await client.connect();
  await client.query(`CREATE DATABASE ${name}`);
  const url = new URL(admin);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    drop: async () => {
      await closeApps(url.toString());
      await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await client.end();
    },
  };
}
