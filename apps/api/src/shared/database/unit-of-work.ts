import { Inject, Injectable } from '@nestjs/common';
import { DB, type Db, type Queryable } from './database';

/** One open database transaction. Repositories take it as their first argument, so a use case decides what commits together. */
export type Tx = Queryable;

/**
 * The application layer's only view of the database: run a use case in one transaction, or read outside one.
 * Closing a bill, cutting stock, issuing the document number and moving points all share one `run`.
 */
@Injectable()
export class UnitOfWork {
  constructor(@Inject(DB) private readonly db: Db) {}

  run<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  /** Writes a full copy of the database into `dir` and returns the file path. */
  backup(dir: string): Promise<string> {
    return this.db.backup(dir);
  }

  /** A connection for queries that do not need a transaction. */
  get read(): Tx {
    return this.db;
  }
}
