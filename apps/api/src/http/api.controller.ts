import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { CashMove, Permission, Satang } from '@my-shop/contracts';
import { DomainError } from '../errors';
import { AuthService } from '../services/auth.service';
import { CatalogService } from '../services/catalog.service';
import { PermissionService } from '../services/permission.service';
import { SettingsService } from '../services/settings.service';
import { ApprovalService } from '../services/approval.service';
import { MemberService } from '../services/member.service';
import { ShiftService } from '../services/shift.service';
import { SaleService } from '../services/sale.service';
import { DocumentService } from '../services/document.service';
import type { RefundInput, TaxInvoiceInput } from '../services/document.service';
import type { SaleInput } from '../services/sale.service';
import { Public, type AuthedRequest } from './auth.guard';

/** Thin HTTP layer for the till: every rule lives in the services. Routes mirror `PosApi` in apps/pos. */
@Controller()
export class ApiController {
  constructor(
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(CatalogService) private readonly catalogService: CatalogService,
    @Inject(PermissionService) private readonly permissionsService: PermissionService,
    @Inject(SettingsService) private readonly settingsService: SettingsService,
    @Inject(ApprovalService) private readonly approvalsService: ApprovalService,
    @Inject(MemberService) private readonly membersService: MemberService,
    @Inject(ShiftService) private readonly shiftsService: ShiftService,
    @Inject(SaleService) private readonly salesService: SaleService,
    @Inject(DocumentService) private readonly documentsService: DocumentService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: { code: string; terminalId: string }) {
    return this.authService.login(String(body?.code ?? ''), String(body?.terminalId ?? ''));
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: AuthedRequest) {
    await this.authService.logout(req.session.token);
  }

  // Read-only and shop-internal: the POS loads it before anyone has signed in (prices are on the shelf anyway).
  @Public()
  @Get('catalog')
  catalog() {
    return this.catalogService.getCatalog();
  }

  /** What the signed-in role may do, so screens can hide buttons. The server still checks every call. */
  @Get('me')
  async me(@Req() req: AuthedRequest) {
    const matrix = await this.permissionsService.matrix();
    return { employee: req.session.employee, permissions: matrix[req.session.employee.role], settings: await this.settingsService.getAll() };
  }

  @Get('employees/:id')
  async employee(@Param('id') id: string) {
    const e = await this.authService.findEmployee(id);
    if (!e) throw new DomainError('not_found', 'ไม่พบพนักงาน');
    return e;
  }

  /** The approval dialog: a supervisor types their code, the till learns who approved. */
  @Post('approvals')
  @HttpCode(200)
  approve(@Req() req: AuthedRequest, @Body() body: { permission: Permission; code: string }) {
    return this.approvalsService.check(req.session.employee, body.permission, String(body.code ?? ''), req.session.terminalId);
  }

  @Get('members/:phone')
  async member(@Param('phone') phone: string) {
    return (await this.membersService.findByPhone(phone)) ?? null;
  }

  @Post('members')
  registerMember(@Req() req: AuthedRequest, @Body() body: { phone: string; name: string; birthday?: string; consent: boolean }) {
    return this.membersService.register(body, req.session.employee.id, req.session.terminalId);
  }

  @Get('terminals/:id/open-shift')
  async openShift(@Param('id') id: string) {
    return (await this.shiftsService.getOpenShift(id)) ?? null;
  }

  @Post('shifts')
  open(@Req() req: AuthedRequest, @Body() body: { terminalId: string; float: Satang }) {
    return this.shiftsService.openShift(body.terminalId, req.session.employee.id, body.float);
  }

  @Get('shifts/:id')
  async shift(@Param('id') id: string) {
    const s = await this.shiftsService.getShift(id);
    if (!s) throw new DomainError('not_found', 'ไม่พบกะนี้');
    return s;
  }

  @Post('shifts/:id/sales')
  sale(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: SaleInput) {
    // The signed-in cashier owns the bill, whatever the client says.
    return this.salesService.closeSale(id, { ...body, employeeId: req.session.employee.id });
  }

  @Post('shifts/:id/void')
  voidSale(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: RefundInput) {
    return this.documentsService.credit(id, 'void', body, req.session.employee, req.session.terminalId);
  }

  @Post('shifts/:id/refund')
  refund(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: RefundInput) {
    return this.documentsService.credit(id, 'refund', body, req.session.employee, req.session.terminalId);
  }

  @Post('shifts/:id/drawer-open')
  @HttpCode(204)
  async drawer(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: { reason: string; approverCode?: string }) {
    await this.shiftsService.openDrawer(id, body.reason, req.session.employee, body.approverCode);
  }

  @Post('shifts/:id/cash-moves')
  cashMove(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: Omit<CashMove, 'at' | 'employeeId'>) {
    return this.shiftsService.addCashMove(id, { ...body, employeeId: req.session.employee.id });
  }

  @Post('shifts/:id/close')
  @HttpCode(200)
  close(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: { counted: Satang; note?: string; approverCode?: string }) {
    return this.shiftsService.closeShift(id, body.counted, body.note, req.session.employee, body.approverCode);
  }

  /** Find a closed bill by number or member phone (for refunds and reprints). */
  @Get('sales')
  searchSales(@Query('term') term?: string, @Query('date') date?: string) {
    return this.documentsService.search({ term, date, limit: 30 });
  }

  @Get('sales/:docNo')
  async sale1(@Param('docNo') docNo: string) {
    return this.documentsService.getSale(docNo);
  }

  @Post('sales/:docNo/reprint')
  @HttpCode(200)
  async reprint(@Req() req: AuthedRequest, @Param('docNo') docNo: string) {
    return { copy: await this.documentsService.reprint(docNo, req.session.employee, req.session.terminalId) };
  }

  @Post('sales/:docNo/tax-invoice')
  taxInvoice(@Req() req: AuthedRequest, @Param('docNo') docNo: string, @Body() body: TaxInvoiceInput) {
    return this.documentsService.taxInvoice(docNo, body, req.session.employee, req.session.terminalId);
  }
}
