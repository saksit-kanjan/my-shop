import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import { Requires } from '../../../shared/http/auth.decorators';
import type { AuthedRequest } from '../../../shared/http/authed-request';
import { DomainError } from '../../../shared/kernel/domain-error';
import { PermissionService } from '../../identity/application/permission.service';
import { DayCloseService } from '../../sales/application/day-close.service';
import { ReportService } from '../application/report.service';

const isDate = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);

/** Read-only report routes. Each names the permission it needs; cost and profit need `reports.cost` (owner by default). */
@Controller('bo')
export class ReportingController {
  constructor(
    @Inject(ReportService) private readonly reports: ReportService,
    @Inject(DayCloseService) private readonly days: DayCloseService,
    @Inject(PermissionService) private readonly permissions: PermissionService,
  ) {}

  private async range(q: { from?: string; to?: string; terminalId?: string; employeeId?: string; categoryId?: string }) {
    const from = q.from ?? (await this.days.today());
    const to = q.to ?? from;
    if (!isDate(from) || !isDate(to) || from > to) throw new DomainError('invalid', 'ช่วงวันที่ไม่ถูกต้อง');
    return { from, to, terminalId: q.terminalId, employeeId: q.employeeId, categoryId: q.categoryId };
  }

  private canSeeCost(req: AuthedRequest) {
    return this.permissions.can(req.session.employee.role, 'reports.cost');
  }

  @Get('dashboard')
  @Requires('reports.all')
  dashboard() {
    return this.reports.dashboard();
  }

  @Get('reports/sales')
  @Requires('reports.all')
  async sales(@Query() q: Record<string, string>) {
    return this.reports.salesSummary(await this.range(q));
  }

  @Get('reports/hourly')
  @Requires('reports.all')
  async hourly(@Query() q: Record<string, string>) {
    return this.reports.hourly(await this.range(q));
  }

  @Get('reports/products')
  @Requires('reports.all')
  async products(@Req() req: AuthedRequest, @Query() q: Record<string, string>) {
    return this.reports.products(await this.range(q), await this.canSeeCost(req));
  }

  @Get('reports/cash')
  @Requires('reports.all')
  async cash(@Query() q: Record<string, string>) {
    return this.reports.cash(await this.range(q));
  }

  @Get('reports/credits')
  @Requires('reports.all')
  async credits(@Query() q: Record<string, string>) {
    return this.reports.credits(await this.range(q));
  }

  @Get('reports/stock-value')
  @Requires('reports.cost')
  async stockValue(@Query('asOf') asOf?: string, @Query('categoryId') categoryId?: string) {
    const d = asOf ?? (await this.days.today());
    if (!isDate(d)) throw new DomainError('invalid', 'วันที่ไม่ถูกต้อง');
    return this.reports.stockValue(d, categoryId);
  }

  @Get('reports/tax')
  @Requires('reports.cost')
  tax(@Query('month') month: string) {
    if (!/^\d{4}-\d{2}$/.test(month ?? '')) throw new DomainError('invalid', 'ใส่เดือนในรูปแบบ 2026-11');
    return this.reports.tax(month);
  }

  @Get('reports/members')
  @Requires('members.manage')
  async members(@Query() q: Record<string, string>) {
    return this.reports.membersAndPromos(await this.range(q));
  }

  @Get('audit')
  @Requires('audit.view')
  async audit(@Query() q: Record<string, string>) {
    const r = await this.range(q);
    return this.reports.audit({ from: r.from, to: r.to, action: q['action'] });
  }
}
