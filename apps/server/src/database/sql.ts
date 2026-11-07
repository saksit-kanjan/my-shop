import type { Tx } from './database.types';

/**
 * Hand-written SQL for the few places a repository is the wrong tool (report aggregates, ledger sums).
 * TypeORM hands back UPDATE/DELETE results as `[rows, count]`; this always gives plain rows.
 */
export async function rows<T = Record<string, unknown>>(tx: Tx, sql: string, params: unknown[] = []): Promise<T[]> {
  const raw: unknown = await tx.query(sql, params);
  return (Array.isArray(raw) && raw.length === 2 && Array.isArray(raw[0]) && typeof raw[1] === 'number' ? raw[0] : raw) as T[];
}
