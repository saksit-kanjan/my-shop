import { Injectable } from '@nestjs/common';
import type { Tx } from '../database/unit-of-work';

/** Gapless numbering series. Runs inside the caller's transaction, so a rollback gives the number back (spec: เลขเอกสารไม่มีช่องว่าง). */
@Injectable()
export class DocumentNumbersService {
  async next(tx: Tx, series: string): Promise<number> {
    const [row] = await tx.query<{ last: number }>(`INSERT INTO doc_counters (key, last) VALUES ($1, 1) ON CONFLICT (key) DO UPDATE SET last = doc_counters.last + 1 RETURNING last`, [series]);
    return row.last;
  }

  /** `PREFIX-yymm-000001`, or any `${series}-000001`. */
  async format(tx: Tx, series: string): Promise<string> {
    return `${series}-${String(await this.next(tx, series)).padStart(6, '0')}`;
  }
}
