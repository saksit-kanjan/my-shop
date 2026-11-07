import { Injectable } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DataSource, type EntityManager } from 'typeorm';
import type { Tx } from './database.types';
import { rows } from './sql';

/**
 * The one place services reach the database. `manager` is for reads outside a transaction; `transaction` runs a whole
 * use case (the bill, its lines, stock, points, the audit row) so that all of it commits or none of it does.
 */
@Injectable()
export class DatabaseService {
  /** The manager of the transaction this code runs in, so repositories join it without being handed a `tx`. */
  private readonly current = new AsyncLocalStorage<EntityManager>();

  constructor(private readonly dataSource: DataSource) {}

  /** The open transaction's manager, or the plain one outside a transaction. */
  get manager(): EntityManager {
    return this.current.getStore() ?? this.dataSource.manager;
  }

  /** Plain SQL outside a transaction (tests, one-off reads). Repositories are the normal way. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    return rows<T>(this.manager, sql, params);
  }

  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.dataSource.transaction((manager) => this.current.run(manager, () => work(manager)));
  }

  async backup(dir: string): Promise<string> {
    await mkdir(dir, { recursive: true });
    const file = join(dir, `myshop-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`);
    const url = (this.dataSource.options as { url?: string }).url;
    // pg_dump must be installed on the shop server (it ships with PostgreSQL); PG_DUMP_PATH points at it when it is not on PATH.
    await promisify(execFile)(process.env['PG_DUMP_PATH'] ?? 'pg_dump', ['--format=custom', `--file=${file}`, url as string]);
    return file;
  }
}
