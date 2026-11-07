import { Injectable } from '@nestjs/common';
import type { Tx } from './database.types';
import { rows } from './sql';

/** Gapless numbering series. Runs inside the caller's transaction, so a rollback gives the number back (spec: เลขเอกสารไม่มีช่องว่าง). */
@Injectable()
export class NumberingService {
  /** `${series}-000001`, `${series}-000002` ... */
  async next(tx: Tx, series: string): Promise<string> {
    // One atomic upsert: two tills closing a bill at once never get the same number.
    const [row] = await rows<{ last: number }>(tx, `INSERT INTO doc_counters (key, last) VALUES ($1, 1) ON CONFLICT (key) DO UPDATE SET last = doc_counters.last + 1 RETURNING last`, [series]);
    return `${series}-${String(row.last).padStart(6, '0')}`;
  }
}
