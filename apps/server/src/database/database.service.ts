import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { Db, Tx } from './database.types';
import { migrate } from './schema';

export const DB_CONNECTION = Symbol('DB_CONNECTION');

/**
 * The one place services talk to the database. `query` runs outside a transaction; `transaction` runs a whole use case
 * (the bill, its lines, stock, points, the audit row) so that all of it commits or none of it does.
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnApplicationShutdown {
  constructor(@Inject(DB_CONNECTION) private readonly db: Db) {}

  /** Creates or upgrades the tables before the first request. */
  async onModuleInit() {
    await migrate(this.db);
  }

  async onApplicationShutdown() {
    await this.db.close();
  }

  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    return this.db.query<T>(sql, params);
  }

  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  /** The raw connection, for the demo seed. */
  get connection(): Db {
    return this.db;
  }

  backup(dir: string): Promise<string> {
    return this.db.backup(dir);
  }
}
