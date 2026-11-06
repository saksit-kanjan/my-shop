import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { Public } from '../common/decorators';
import { DomainError } from '../common/domain-error';
import type { AuthedRequest } from '../common/session';
import { CreditNotesService } from './credit-notes.service';
import { DocumentsService } from './documents.service';
import { CashMoveDto, CloseShiftDto, CreditNoteDto, DrawerOpenDto, OpenShiftDto, SaleDto, TaxInvoiceDto } from './dto/sales.dto';
import { SalesService } from './sales.service';
import type { SaleInput } from './sales.types';
import { ShiftsService } from './shifts.service';

/** The till's routes: catalog, shifts, bills, voids and refunds, and the documents made from them. */
@Controller()
export class SalesController {
  constructor(
    private readonly sales: SalesService,
    private readonly shifts: ShiftsService,
    private readonly creditNotes: CreditNotesService,
    private readonly documents: DocumentsService,
  ) {}

  // Read-only and shop-internal: the POS loads it before anyone has signed in (prices are on the shelf anyway).
  @Public()
  @Get('catalog')
  catalog() {
    return this.sales.catalog();
  }

  @Get('terminals/:id/open-shift')
  async openShift(@Param('id') id: string) {
    return (await this.shifts.getOpenShift(id)) ?? null;
  }

  @Post('shifts')
  open(@Req() req: AuthedRequest, @Body() body: OpenShiftDto) {
    return this.shifts.openShift(body.terminalId, req.session.employee.id, body.float);
  }

  @Get('shifts/:id')
  async shift(@Param('id') id: string) {
    const s = await this.shifts.getShift(id);
    if (!s) throw new DomainError('not_found', 'ไม่พบกะนี้');
    return s;
  }

  @Post('shifts/:id/sales')
  closeSale(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: SaleDto) {
    // The signed-in cashier owns the bill, whatever the client says.
    return this.sales.closeSale(id, { ...body, change: body.change ?? 0, employeeId: req.session.employee.id } as SaleInput);
  }

  @Post('shifts/:id/void')
  voidSale(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: CreditNoteDto) {
    return this.creditNotes.credit(id, 'void', body, req.session.employee, req.session.terminalId);
  }

  @Post('shifts/:id/refund')
  refund(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: CreditNoteDto) {
    return this.creditNotes.credit(id, 'refund', body, req.session.employee, req.session.terminalId);
  }

  @Post('shifts/:id/drawer-open')
  @HttpCode(204)
  async drawer(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: DrawerOpenDto) {
    await this.shifts.openDrawer(id, body.reason, req.session.employee, body.approverCode);
  }

  @Post('shifts/:id/cash-moves')
  cashMove(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: CashMoveDto) {
    return this.shifts.addCashMove(id, { ...body, employeeId: req.session.employee.id });
  }

  @Post('shifts/:id/close')
  @HttpCode(200)
  close(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: CloseShiftDto) {
    return this.shifts.closeShift(id, body.counted, body.note, req.session.employee, body.approverCode);
  }

  /** Find a closed bill by number or member phone (for refunds and reprints). */
  @Get('sales')
  search(@Query('term') term?: string, @Query('date') date?: string) {
    return this.documents.search({ term, date, limit: 30 });
  }

  @Get('sales/:docNo')
  sale(@Param('docNo') docNo: string) {
    return this.documents.getSale(docNo);
  }

  @Post('sales/:docNo/reprint')
  @HttpCode(200)
  async reprint(@Req() req: AuthedRequest, @Param('docNo') docNo: string) {
    return { copy: await this.documents.reprint(docNo, req.session.employee, req.session.terminalId) };
  }

  @Post('sales/:docNo/tax-invoice')
  taxInvoice(@Req() req: AuthedRequest, @Param('docNo') docNo: string, @Body() body: TaxInvoiceDto) {
    return this.documents.taxInvoice(docNo, { ...body, buyerBranch: body.buyerBranch ?? '' }, req.session.employee, req.session.terminalId);
  }
}
