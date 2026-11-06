import { Injectable } from '@nestjs/common';
import type { Tx } from '../database/unit-of-work';

export interface AuditEntry {
  actor?: string | null;
  approver?: string | null;
  terminalId?: string | null;
  action: string;
  entity?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
}

/** Cross-cutting: every context writes who did what, in the same transaction as the change (spec: audit log). */
@Injectable()
export class AuditService {
  async record(tx: Tx, at: Date, e: AuditEntry): Promise<void> {
    await tx.query(
      `INSERT INTO audit_log (at, actor, approver, terminal_id, action, entity, entity_id, before, after) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [at, e.actor ?? null, e.approver ?? null, e.terminalId ?? null, e.action, e.entity ?? null, e.entityId ?? null, e.before === undefined ? null : JSON.stringify(e.before), e.after === undefined ? null : JSON.stringify(e.after)],
    );
  }
}
