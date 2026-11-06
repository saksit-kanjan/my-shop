import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { CashMove, Satang } from '@my-shop/contracts';
import { Public } from '../common/decorators/auth.decorators';
import type { AuthedRequest } from '../common/interfaces/authed-request';
import { DomainError } from '../common/errors/domain-error';
import { CreditNoteService, type RefundInput } from './credit-note.service';
import { PosCatalogService } from './pos-catalog.service';
import { SaleService } from './sale.service';
import { SalesDocumentService, type TaxInvoiceInput } from './sales-document.service';
import { ShiftService } from './shift.service';
import type { SaleInput } from './entities/sales.types';

/** The till's routes: catalog, shifts, bills, voids and refunds, and the documents made from them. Thin: rules live in the services. */
@Controller()
export class TillController {
  constructor(
    private readonly posCatalog: PosCatalogService,
    private readonly shiftService: ShiftService,
    private readonly saleService: SaleService,
    private readonly creditService: CreditNoteService,
    private readonly documents: SalesDocumentService,
  ) {}

  // Read-only and shop-internal: the POS loads it before anyone has signed in (prices are on the shelf anyway).
  @Public()
  @Get('catalog')
  catalog() {
    return this.posCatalog.get();
  }

  @Get('terminals/:id/open-shift')
  async openShift(@Param('id') id: string) {
    return (await this.shiftService.getOpenShift(id)) ?? null;
  }

  @Post('shifts')
  open(@Req() req: AuthedRequest, @Body() body: { terminalId: string; float: Satang }) {
    return this.shiftService.openShift(body.terminalId, req.session.employee.id, body.float);
  }

  @Get('shifts/:id')
  async shift(@Param('id') id: string) {
    const s = await this.shiftService.getShift(id);
    if (!s) throw new DomainError('not_found', 'ไม่พบกะนี้');
    return s;
  }

  @Post('shifts/:id/sales')
  sale(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: SaleInput) {
    // The signed-in cashier owns the bill, whatever the client says.
    return this.saleService.closeSale(id, { ...body, employeeId: req.session.employee.id });
  }

  @Post('shifts/:id/void')
  voidSale(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: RefundInput) {
    return this.creditService.credit(id, 'void', body, req.session.employee, req.session.terminalId);
  }

  @Post('shifts/:id/refund')
  refund(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: RefundInput) {
    return this.creditService.credit(id, 'refund', body, req.session.employee, req.session.terminalId);
  }

  @Post('shifts/:id/drawer-open')
  @HttpCode(204)
  async drawer(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: { reason: string; approverCode?: string }) {
    await this.shiftService.openDrawer(id, body.reason, req.session.employee, body.approverCode);
  }

  @Post('shifts/:id/cash-moves')
  cashMove(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: Omit<CashMove, 'at' | 'employeeId'>) {
    return this.shiftService.addCashMove(id, { ...body, employeeId: req.session.employee.id });
  }

  @Post('shifts/:id/close')
  @HttpCode(200)
  close(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: { counted: Satang; note?: string; approverCode?: string }) {
    return this.shiftService.closeShift(id, body.counted, body.note, req.session.employee, body.approverCode);
  }

  /** Find a closed bill by number or member phone (for refunds and reprints). */
  @Get('sales')
  searchSales(@Query('term') term?: string, @Query('date') date?: string) {
    return this.documents.search({ term, date, limit: 30 });
  }

  @Get('sales/:docNo')
  sale1(@Param('docNo') docNo: string) {
    return this.documents.getSale(docNo);
  }

  @Post('sales/:docNo/reprint')
  @HttpCode(200)
  async reprint(@Req() req: AuthedRequest, @Param('docNo') docNo: string) {
    return { copy: await this.documents.reprint(docNo, req.session.employee, req.session.terminalId) };
  }

  @Post('sales/:docNo/tax-invoice')
  taxInvoice(@Req() req: AuthedRequest, @Param('docNo') docNo: string, @Body() body: TaxInvoiceInput) {
    return this.documents.taxInvoice(docNo, body, req.session.employee, req.session.terminalId);
  }
}
