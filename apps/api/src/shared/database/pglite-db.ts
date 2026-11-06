import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { Db, Queryable } from './database';

/** Embedded Postgres. `dataDir` omitted = in memory (tests). */
export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const lite = new PGlite(dataDir);
  await lite.waitReady;
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      return (await lite.query(sql, params)).rows as T[];
    },
    transaction<T>(fn: (tx: Queryable) => Promise<T>) {
      return lite.transaction((tx) => fn({ query: async <R>(sql: string, params: unknown[] = []) => (await tx.query(sql, params)).rows as R[] }));
    },
    async backup(dir: string) {
      await mkdir(dir, { recursive: true });
      const file = join(dir, `myshop-${new Date().toISOString().replace(/[:.]/g, '-')}.tar.gz`);
      const dump = await lite.dumpDataDir('gzip');
      await writeFile(file, Buffer.from(await dump.arrayBuffer()));
      return file;
    },
    close: () => lite.close(),
  };
}
