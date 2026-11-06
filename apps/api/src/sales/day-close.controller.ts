import { Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { Requires } from '../common/decorators/auth.decorators';
import type { AuthedRequest } from '../common/interfaces/authed-request';
import { DomainError } from '../common/errors/domain-error';
import { DayCloseService } from './day-close.service';
import { SalesDocumentService } from './sales-document.service';

const isDate = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);

/** Back-office views of the sales floor: the shifts of a day, closing the day, and bill search. */
@Controller('bo')
export class DayCloseController {
  constructor(
    private readonly dayClose: DayCloseService,
    private readonly documents: SalesDocumentService,
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
