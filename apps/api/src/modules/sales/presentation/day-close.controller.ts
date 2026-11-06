import { Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { Requires } from '../../../shared/http/auth.decorators';
import type { AuthedRequest } from '../../../shared/http/authed-request';
import { DomainError } from '../../../shared/kernel/domain-error';
import { DayCloseService } from '../application/day-close.service';
import { SalesDocumentService } from '../application/sales-document.service';

const isDate = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);

/** Back-office views of the sales floor: the shifts of a day, closing the day, and bill search. */
@Controller('bo')
export class DayCloseController {
  constructor(
    @Inject(DayCloseService) private readonly dayClose: DayCloseService,
    @Inject(SalesDocumentService) private readonly documents: SalesDocumentService,
  ) {}

  @Get('days/:date')
  @Requires('reports.all')
  day(@Param('date') date: string) {
    if (!isDate(date)) throw new DomainError('invalid', 'วันที่ไม่ถูกต้อง');
    return this.dayClose.dayShifts(date);
  }

  @Post('days/:date/close')
  @Requires('reports.all')
  @HttpCode(200)
  close(@Req() req: AuthedRequest, @Param('date') date: string) {
    if (!isDate(date)) throw new DomainError('invalid', 'วันที่ไม่ถูกต้อง');
    return this.dayClose.closeDay(date, req.session.employee);
  }

  @Get('sales')
  @Requires('reports.all')
  search(@Query('term') term?: string, @Query('date') date?: string) {
    return this.documents.search({ term, date, limit: 100 });
  }
}
