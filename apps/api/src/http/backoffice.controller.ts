import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query, Req } from '@nestjs/common';
import type { Promotion, Role } from '@my-shop/contracts';
import { DomainError } from '../errors';
import { AuthService } from '../services/auth.service';
import { BackOfficeService } from '../services/backoffice.service';
import { CatalogService } from '../services/catalog.service';
import { PermissionService } from '../services/permission.service';
import { ReportService } from '../services/report.service';
import { DocumentService } from '../services/document.service';
import { MemberService } from '../services/member.service';
import { UserService } from '../services/user.service';
import { SettingsService } from '../services/settings.service';
import { BackupService } from '../services/backup.service';
import type { ProductInput } from '../services/backoffice.service';
import { Public, Requires, type AuthedRequest } from './auth.guard';

const isDate = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);

/** Back-office routes. Each one names the permission it needs; the guard checks it against the role matrix. */
@Controller('bo')
export class BackOfficeController {
  constructor(
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(BackOfficeService) private readonly backofficeService: BackOfficeService,
    @Inject(CatalogService) private readonly catalogService: CatalogService,
    @Inject(PermissionService) private readonly permissionsService: PermissionService,
    @Inject(ReportService) private readonly reportsService: ReportService,
    @Inject(DocumentService) private readonly documentsService: DocumentService,
    @Inject(MemberService) private readonly membersService: MemberService,
    @Inject(UserService) private readonly usersService: UserService,
    @Inject(SettingsService) private readonly settingsService: SettingsService,
    @Inject(BackupService) private readonly backupService: BackupService,
  ) {}

  private async range(q: { from?: string; to?: string; terminalId?: string; employeeId?: string; categoryId?: string }) {
    const today = await this.backofficeService.today();
    const from = q.from ?? today;
    const to = q.to ?? from;
    if (!isDate(from) || !isDate(to) || from > to) throw new DomainError('invalid', 'ช่วงวันที่ไม่ถูกต้อง');
    return { from, to, terminalId: q.terminalId, employeeId: q.employeeId, categoryId: q.categoryId };
  }

  private cost(req: AuthedRequest) {
    return this.permissionsService.can(req.session.employee.role, 'reports.cost');
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: { username: string; password: string }) {
    return this.authService.loginBackOffice(String(body?.username ?? ''), String(body?.password ?? ''));
  }

  @Get('dashboard')
  @Requires('reports.all')
  dashboard() {
    return this.reportsService.dashboard();
  }

  /* products, categories, promotions */
  @Get('products')
  @Requires('stock.view')
  async products(@Req() req: AuthedRequest) {
    const canCost = await this.cost(req);
    return (await this.backofficeService.listProducts()).map((p) => (canCost ? p : { ...p, cost: 0 }));
  }

  @Post('products')
  @Requires('products.manage')
  async createProduct(@Req() req: AuthedRequest, @Body() body: ProductInput) {
    return this.backofficeService.saveProduct(null, body, req.session.employee, await this.cost(req));
  }

  @Put('products/:id')
  @Requires('products.manage')
  async updateProduct(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: ProductInput) {
    return this.backofficeService.saveProduct(id, body, req.session.employee, await this.cost(req));
  }

  @Get('categories')
  @Requires('stock.view')
  categories() {
    return this.backofficeService.listCategories();
  }

  @Post('categories')
  @Requires('products.manage')
  createCategory(@Req() req: AuthedRequest, @Body() body: { name: string }) {
    return this.backofficeService.saveCategory(null, body.name, req.session.employee);
  }

  @Put('categories/:id')
  @Requires('products.manage')
  updateCategory(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: { name: string }) {
    return this.backofficeService.saveCategory(id, body.name, req.session.employee);
  }

  @Get('promotions')
  @Requires('promos.manage')
  async promotions() {
    const [promotions, catalog] = await Promise.all([this.backofficeService.listPromotions(), this.catalogService.getCatalog()]);
    return { promotions, premiums: catalog.premiums };
  }

  @Post('promotions')
  @Requires('promos.manage')
  @HttpCode(204)
  async createPromotion(@Req() req: AuthedRequest, @Body() body: { promotion: Promotion; active?: boolean }) {
    await this.backofficeService.savePromotion({ ...body.promotion, id: body.promotion?.id || `promo-${Date.now().toString(36)}` }, body.active ?? true, req.session.employee);
  }

  @Put('promotions/:id')
  @Requires('promos.manage')
  @HttpCode(204)
  async updatePromotion(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: { promotion: Promotion; active: boolean }) {
    await this.backofficeService.savePromotion({ ...body.promotion, id }, body.active, req.session.employee);
  }

  @Post('premiums')
  @Requires('promos.manage')
  createPremium(@Req() req: AuthedRequest, @Body() body: { name: string }) {
    return this.backofficeService.savePremium(null, body.name, req.session.employee);
  }

  @Post('premiums/:id/stock')
  @Requires('stock.manage')
  @HttpCode(204)
  async premiumStock(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: { qty: number }) {
    await this.backofficeService.premiumStock(id, body.qty, req.session.employee);
  }

  /* suppliers, receiving, stock */
  @Get('suppliers')
  @Requires('stock.view')
  suppliers() {
    return this.backofficeService.listSuppliers();
  }

  @Post('suppliers')
  @Requires('stock.manage')
  async createSupplier(@Req() req: AuthedRequest, @Body() body: { name: string; contact?: string; terms?: string }) {
    return { id: await this.backofficeService.saveSupplier(null, body, req.session.employee) };
  }

  @Get('receipts')
  @Requires('stock.view')
  receipts() {
    return this.backofficeService.listReceipts();
  }

  @Post('receipts')
  @Requires('stock.manage')
  async receive(@Req() req: AuthedRequest, @Body() body: { supplierId: string; ref?: string; note?: string; lines: { productId: string; qty: number; unitCost: number }[] }) {
    return this.backofficeService.receive(body, req.session.employee, await this.cost(req));
  }

  @Get('stock')
  @Requires('stock.view')
  async stock(@Req() req: AuthedRequest, @Query('categoryId') categoryId?: string, @Query('low') low?: string) {
    return this.backofficeService.stock({ categoryId, lowOnly: low === '1' }, await this.cost(req));
  }

  @Get('stock/:productId/movements')
  @Requires('stock.view')
  movements(@Param('productId') productId: string) {
    return this.backofficeService.movements(productId);
  }

  @Post('stock/adjust')
  @Requires('stock.manage')
  @HttpCode(204)
  async adjust(@Req() req: AuthedRequest, @Body() body: { productId: string; qty: number; reason: 'waste' | 'lost' | 'expired' | 'other'; note?: string }) {
    await this.backofficeService.adjust(body, req.session.employee);
  }

  @Get('counts/open')
  @Requires('stock.view')
  async openCount() {
    const id = await this.backofficeService.openCount();
    return id ? this.backofficeService.getCount(id) : null;
  }

  @Post('counts')
  @Requires('stock.manage')
  startCount(@Req() req: AuthedRequest, @Body() body: { categoryId?: string }) {
    return this.backofficeService.startCount(body ?? {}, req.session.employee);
  }

  @Get('counts/:id')
  @Requires('stock.view')
  count(@Param('id') id: string) {
    return this.backofficeService.getCount(id);
  }

  @Put('counts/:id/lines')
  @Requires('stock.manage')
  @HttpCode(204)
  async saveCounted(@Param('id') id: string, @Body() body: { lines: { productId: string; qty: number }[] }) {
    await this.backofficeService.saveCounted(id, body.lines ?? []);
  }

  @Post('counts/:id/approve')
  @Requires('stock.manage')
  @HttpCode(200)
  approveCount(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.backofficeService.approveCount(id, req.session.employee);
  }

  @Post('counts/:id/cancel')
  @Requires('stock.manage')
  @HttpCode(204)
  async cancelCount(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.backofficeService.cancelCount(id, req.session.employee);
  }

  /* shifts and day close */
  @Get('days/:date')
  @Requires('reports.all')
  day(@Param('date') date: string) {
    if (!isDate(date)) throw new DomainError('invalid', 'วันที่ไม่ถูกต้อง');
    return this.backofficeService.dayShifts(date);
  }

  @Post('days/:date/close')
  @Requires('reports.all')
  @HttpCode(200)
  closeDay(@Req() req: AuthedRequest, @Param('date') date: string) {
    if (!isDate(date)) throw new DomainError('invalid', 'วันที่ไม่ถูกต้อง');
    return this.backofficeService.closeDay(date, req.session.employee);
  }

  /* reports */
  @Get('reports/sales')
  @Requires('reports.all')
  async salesReport(@Query() q: Record<string, string>) {
    return this.reportsService.salesSummary(await this.range(q));
  }

  @Get('reports/hourly')
  @Requires('reports.all')
  async hourly(@Query() q: Record<string, string>) {
    return this.reportsService.hourly(await this.range(q));
  }

  @Get('reports/products')
  @Requires('reports.all')
  async productsReport(@Req() req: AuthedRequest, @Query() q: Record<string, string>) {
    return this.reportsService.products(await this.range(q), await this.cost(req));
  }

  @Get('reports/cash')
  @Requires('reports.all')
  async cashReport(@Query() q: Record<string, string>) {
    return this.reportsService.cash(await this.range(q));
  }

  @Get('reports/credits')
  @Requires('reports.all')
  async credits(@Query() q: Record<string, string>) {
    return this.reportsService.credits(await this.range(q));
  }

  @Get('reports/stock-value')
  @Requires('reports.cost')
  async stockValue(@Query('asOf') asOf?: string, @Query('categoryId') categoryId?: string) {
    const d = asOf ?? (await this.backofficeService.today());
    if (!isDate(d)) throw new DomainError('invalid', 'วันที่ไม่ถูกต้อง');
    return this.reportsService.stockValue(d, categoryId);
  }

  @Get('reports/tax')
  @Requires('reports.cost')
  tax(@Query('month') month: string) {
    if (!/^\d{4}-\d{2}$/.test(month ?? '')) throw new DomainError('invalid', 'ใส่เดือนในรูปแบบ 2026-11');
    return this.reportsService.tax(month);
  }

  @Get('reports/members')
  @Requires('members.manage')
  async membersReport(@Query() q: Record<string, string>) {
    return this.reportsService.membersAndPromos(await this.range(q));
  }

  @Get('audit')
  @Requires('audit.view')
  async audit(@Query() q: Record<string, string>) {
    const r = await this.range(q);
    return this.reportsService.audit({ from: r.from, to: r.to, action: q['action'] });
  }

  @Get('sales')
  @Requires('reports.all')
  searchSales(@Query('term') term?: string, @Query('date') date?: string) {
    return this.documentsService.search({ term, date, limit: 100 });
  }

  /* members */
  @Get('members')
  @Requires('members.manage')
  members(@Query('term') term = '') {
    return this.membersService.search(term);
  }

  @Put('members/:id')
  @Requires('members.manage')
  @HttpCode(204)
  async updateMember(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: { name?: string; birthday?: string | null; tier?: string; tax?: unknown }) {
    await this.membersService.update(id, body, req.session.employee.id);
  }

  @Post('members/:id/anonymize')
  @Requires('members.manage')
  @HttpCode(204)
  async anonymize(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.membersService.anonymize(id, req.session.employee.id);
  }

  @Get('members/:id/points')
  @Requires('members.manage')
  points(@Param('id') id: string) {
    return this.membersService.ledger(id);
  }

  /* users, permissions, settings, backup */
  @Get('users')
  @Requires('users.manage')
  users() {
    return this.usersService.list();
  }

  @Post('users')
  @Requires('users.manage')
  createUser(@Req() req: AuthedRequest, @Body() body: { name: string; role: Role; code: string; username?: string; password?: string }) {
    return this.usersService.create(body, req.session.employee.id);
  }

  @Put('users/:id')
  @Requires('users.manage')
  @HttpCode(204)
  async updateUser(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: { name?: string; role?: Role; active?: boolean; code?: string; password?: string; username?: string }) {
    await this.usersService.update(id, body, req.session.employee.id);
  }

  @Get('permissions')
  @Requires('users.manage')
  permissions() {
    return this.permissionsService.matrix();
  }

  @Put('permissions')
  @Requires('users.manage')
  @HttpCode(204)
  async setPermission(@Req() req: AuthedRequest, @Body() body: { role: Role; permission: import('@my-shop/contracts').Permission; allowed: boolean }) {
    await this.backofficeService.audited(req.session.employee, 'permission.set', body, async (tx) => {
      try {
        await this.permissionsService.set(tx, body.role, body.permission, body.allowed);
      } catch (e) {
        throw new DomainError('conflict', e instanceof Error ? e.message : 'ตั้งสิทธิ์ไม่สำเร็จ');
      }
    });
  }

  @Get('settings')
  @Requires('reports.all')
  settings() {
    return this.settingsService.getAll();
  }

  @Put('settings')
  @Requires('settings.manage')
  async updateSettings(@Req() req: AuthedRequest, @Body() body: Record<string, unknown>) {
    let changes: { key: string; before: unknown; after: unknown }[] = [];
    await this.backofficeService.audited(req.session.employee, 'settings.change', body, async (tx) => {
      try {
        changes = await this.settingsService.update(tx, body);
      } catch (e) {
        throw new DomainError('invalid', e instanceof Error ? e.message : 'ตั้งค่าไม่สำเร็จ');
      }
    }, (): unknown => changes);
    return this.settingsService.getAll();
  }

  @Get('backups')
  @Requires('settings.manage')
  backups() {
    return this.backupService.list();
  }

  @Post('backups')
  @Requires('settings.manage')
  @HttpCode(200)
  runBackup(@Req() req: AuthedRequest) {
    return this.backupService.run(req.session.employee.id);
  }
}
