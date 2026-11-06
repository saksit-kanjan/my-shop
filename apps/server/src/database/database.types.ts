/** Minimal SQL surface the services use. Works the same on pg (production) and PGlite (tests, no-Docker dev). */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

/** One open transaction. Service methods that must commit together take it as a parameter. */
export type Tx = Queryable;

export interface Db extends Queryable {
  /** Runs `fn` in one transaction: commits when it resolves, rolls back when it throws. */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** Writes a full copy of the database into `dir` and returns the file path. */
  backup(dir: string): Promise<string>;
  close(): Promise<void>;
}
