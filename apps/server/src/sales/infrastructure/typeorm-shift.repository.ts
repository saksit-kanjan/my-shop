import { Injectable } from '@nestjs/common';
import { IsNull } from 'typeorm';
import { DatabaseService } from '../../database/database.service';
import { CashMoveEntity, ShiftEntity } from '../entities/sales.entities';
import { Shift } from '../domain/shift';
import { ShiftRepository } from '../domain/shift.repository';

@Injectable()
export class TypeOrmShiftRepository extends ShiftRepository {
  constructor(private readonly db: DatabaseService) {
    super();
  }

  private async restore(row: ShiftEntity | null): Promise<Shift | null> {
    if (!row) return null;
    const moves = await this.db.manager.find(CashMoveEntity, { where: { shiftId: row.id }, order: { id: 'ASC' } });
    return Shift.restore({
      id: row.id, terminalId: row.terminalId, employeeId: row.employeeId, businessDate: row.businessDate, openedAt: row.openedAt, float: row.float,
      closedAt: row.closedAt, counted: row.counted, note: row.note,
      cashMoves: moves.map((m) => ({ at: m.at, type: m.type, amount: m.amount, reason: m.reason, employeeId: m.employeeId, approvedBy: m.approvedBy })),
    });
  }

  findById(id: string) {
    return this.db.manager.findOneBy(ShiftEntity, { id }).then((r) => this.restore(r));
  }

  lockById(id: string) {
    return this.db.manager.findOne(ShiftEntity, { where: { id }, lock: { mode: 'pessimistic_write' } }).then((r) => this.restore(r));
  }

  findOpenByTerminal(terminalId: string) {
    return this.db.manager.findOneBy(ShiftEntity, { terminalId, closedAt: IsNull() }).then((r) => this.restore(r));
  }

  async add(shift: Shift): Promise<void> {
    const s = shift.snapshot();
    await this.db.manager.insert(ShiftEntity, { id: s.id, terminalId: s.terminalId, employeeId: s.employeeId, businessDate: s.businessDate, openedAt: s.openedAt, float: s.float });
  }

  async save(shift: Shift): Promise<void> {
    const s = shift.snapshot();
    await this.db.manager.update(ShiftEntity, { id: s.id }, { closedAt: s.closedAt, counted: s.counted, note: s.note });
    const moves = shift.takeNewCashMoves();
    if (moves.length) await this.db.manager.insert(CashMoveEntity, moves.map((m) => ({ shiftId: s.id, ...m })));
  }
}
