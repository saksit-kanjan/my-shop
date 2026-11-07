import { Injectable } from '@nestjs/common';
import { AuditLog } from './entities/audit-log.entity';
import type { Tx } from '../database/database.types';

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

/** Every feature writes who did what, in the same transaction as the change (spec: audit log). */
@Injectable()
export class AuditService {
  async record(tx: Tx, at: Date, e: AuditEntry): Promise<void> {
    await tx.insert(AuditLog, {
      at, actor: e.actor ?? null, approver: e.approver ?? null, terminalId: e.terminalId ?? null, action: e.action, entity: e.entity ?? null, entityId: e.entityId ?? null,
      before: (e.before ?? null) as object | null, after: (e.after ?? null) as object | null,
    });
  }
}
