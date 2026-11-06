import { Inject, Injectable } from '@nestjs/common';
import type { Employee } from '@my-shop/contracts';
import { summarizeShift } from '@my-shop/domain';
import { AuditService } from '../audit/audit.service';
import { UnitOfWork } from '../database/unit-of-work';
import { CLOCK, type Clock } from '../common/clock/clock';
import { businessDate, iso } from '../common/utils/dates';
import { DomainError } from '../common/errors/domain-error';
import { SettingsService } from '../administration/settings.service';
import { AuthService } from '../identity/auth.service';
import { ShiftRepository } from './repositories/shift.repository';
import { ShiftService } from './shift.service';

/** The shifts of a business date and closing the day once every one of them is closed (spec step 6). */
@Injectable()
export class DayCloseService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly repo: ShiftRepository,
    private readonly shifts: ShiftService,
    private readonly auth: AuthService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async today(): Promise<string> {
    return businessDate(this.clock(), (await this.settings.getAll()).cutoffHour);
  }

  async dayShifts(date: string) {
    const read = this.uow.read;
    const [ids, closed] = await Promise.all([this.repo.idsOfDay(read, date), this.repo.dayClose(read, date)]);
    const names = new Map<string, string>();
    const shifts = [];
    for (const id of ids) {
      const shift = await this.shifts.getShift(id);
      if (!shift) continue;
      if (!names.has(shift.employeeId)) names.set(shift.employeeId, (await this.auth.findEmployee(shift.employeeId))?.name ?? shift.employeeId);
      const s = summarizeShift(shift);
      shifts.push({
        id: shift.id, terminalId: shift.terminalId, cashier: names.get(shift.employeeId) ?? shift.employeeId, openedAt: shift.openedAt, closedAt: shift.closedAt ?? null, bills: s.bills, net: s.net,
        expected: s.expectedCash, counted: shift.counted ?? null, variance: shift.counted != null ? shift.counted - s.expectedCash : null, note: shift.note ?? null,
      });
    }
    return { date, closed: closed ? { at: iso(closed.at), by: closed.by } : null, shifts };
  }

  /** The manager closes the day; the figures are frozen for reports and the books. */
  async closeDay(date: string, actor: Employee): Promise<{ date: string; net: number; bills: number }> {
    const now = this.clock();
    const day = await this.dayShifts(date);
    if (day.closed) throw new DomainError('conflict', 'ปิดวันนี้ไปแล้ว');
    if (day.shifts.length === 0) throw new DomainError('invalid', 'วันนี้ยังไม่มีกะ');
    const open = day.shifts.filter((s) => !s.closedAt);
    if (open.length) throw new DomainError('conflict', `ยังมี ${open.length} กะที่ไม่ได้ปิด (${open.map((s) => s.terminalId).join(', ')})`);
    const summary = { net: day.shifts.reduce((a, s) => a + s.net, 0), bills: day.shifts.reduce((a, s) => a + s.bills, 0), variance: day.shifts.reduce((a, s) => a + (s.variance ?? 0), 0), shifts: day.shifts.length };
    await this.uow.run(async (tx) => {
      await this.repo.insertDayClose(tx, date, now, actor.id, summary);
      await this.audit.record(tx, now, { actor: actor.id, action: 'day.close', entity: 'day', entityId: date, after: summary });
    });
    return { date, net: summary.net, bills: summary.bills };
  }
}
