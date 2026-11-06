import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { PermissionsService } from '../auth/permissions.service';
import { Requires } from '../common/decorators';
import type { AuthedRequest } from '../common/session';
import { AdjustStockDto, CountedDto, PremiumStockDto, ReceiptDto, StartCountDto, SupplierDto } from './dto/stock.dto';
import { ReceivingService } from './receiving.service';
import { StockService } from './stock.service';
import { StocktakeService } from './stocktake.service';

@Controller('bo')
export class StockController {
  constructor(
    private readonly stock: StockService,
    private readonly receiving: ReceivingService,
    private readonly stocktake: StocktakeService,
    private readonly permissions: PermissionsService,
  ) {}

  private canSeeCost(req: AuthedRequest) {
    return this.permissions.can(req.session.employee.role, 'reports.cost');
  }

  @Get('stock')
  @Requires('stock.view')
  async levels(@Req() req: AuthedRequest, @Query('categoryId') categoryId?: string, @Query('low') low?: string) {
    return this.stock.levels({ categoryId, lowOnly: low === '1' }, await this.canSeeCost(req));
  }

  @Get('stock/:productId/movements')
  @Requires('stock.view')
  movements(@Param('productId') productId: string) {
    return this.stock.movements(productId);
  }

  @Post('stock/adjust')
  @Requires('stock.manage')
  @HttpCode(204)
  async adjust(@Req() req: AuthedRequest, @Body() body: AdjustStockDto) {
    await this.stock.adjust(body, req.session.employee);
  }

  @Get('premiums/stock')
  @Requires('stock.view')
  async premiumLevels() {
    return [...(await this.stock.premiumBalances())].map(([id, stock]) => ({ id, stock }));
  }

  @Post('premiums/:id/stock')
  @Requires('stock.manage')
  @HttpCode(204)
  async premiumStock(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: PremiumStockDto) {
    await this.stock.premiumStock(id, body.qty, req.session.employee);
  }

  @Get('suppliers')
  @Requires('stock.view')
  suppliers() {
    return this.receiving.suppliers();
  }

  @Post('suppliers')
  @Requires('stock.manage')
  async createSupplier(@Req() req: AuthedRequest, @Body() body: SupplierDto) {
    return { id: await this.receiving.saveSupplier(body, req.session.employee) };
  }

  @Get('receipts')
  @Requires('stock.view')
  receipts() {
    return this.receiving.receipts();
  }

  @Post('receipts')
  @Requires('stock.manage')
  async receive(@Req() req: AuthedRequest, @Body() body: ReceiptDto) {
    return this.receiving.receive(body, req.session.employee, await this.canSeeCost(req));
  }

  @Get('counts/open')
  @Requires('stock.view')
  openCount() {
    return this.stocktake.open();
  }

  @Post('counts')
  @Requires('stock.manage')
  startCount(@Req() req: AuthedRequest, @Body() body: StartCountDto) {
    return this.stocktake.start(body, req.session.employee);
  }

  @Get('counts/:id')
  @Requires('stock.view')
  count(@Param('id') id: string) {
    return this.stocktake.get(id);
  }

  @Put('counts/:id/lines')
  @Requires('stock.manage')
  @HttpCode(204)
  async saveCounted(@Param('id') id: string, @Body() body: CountedDto) {
    await this.stocktake.saveCounted(id, body.lines);
  }

  @Post('counts/:id/approve')
  @Requires('stock.manage')
  @HttpCode(200)
  approveCount(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.stocktake.approve(id, req.session.employee);
  }

  @Post('counts/:id/cancel')
  @Requires('stock.manage')
  @HttpCode(204)
  async cancelCount(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.stocktake.cancel(id, req.session.employee);
  }
}
