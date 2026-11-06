import { Body, Controller, Get, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import type { Promotion } from '@my-shop/contracts';
import { Requires } from '../common/decorators/auth.decorators';
import type { AuthedRequest } from '../common/interfaces/authed-request';
import { PermissionService } from '../identity/permission.service';
import { CatalogAdminService } from './catalog-admin.service';
import type { ProductInput } from './entities/product.entity';

/** Back-office catalog routes. The till's read-only /catalog is served by the sales context, which adds the gifts' stock. */
@Controller('bo')
export class CatalogController {
  constructor(
    private readonly admin: CatalogAdminService,
    private readonly permissions: PermissionService,
  ) {}

  private canSeeCost(req: AuthedRequest) {
    return this.permissions.can(req.session.employee.role, 'reports.cost');
  }

  @Get('products')
  @Requires('stock.view')
  async products(@Req() req: AuthedRequest) {
    return this.admin.listProducts(await this.canSeeCost(req));
  }

  @Post('products')
  @Requires('products.manage')
  async createProduct(@Req() req: AuthedRequest, @Body() body: ProductInput) {
    return this.admin.saveProduct(null, body, req.session.employee, await this.canSeeCost(req));
  }

  @Put('products/:id')
  @Requires('products.manage')
  async updateProduct(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: ProductInput) {
    return this.admin.saveProduct(id, body, req.session.employee, await this.canSeeCost(req));
  }

  @Get('categories')
  @Requires('stock.view')
  categories() {
    return this.admin.listCategories();
  }

  @Post('categories')
  @Requires('products.manage')
  createCategory(@Req() req: AuthedRequest, @Body() body: { name: string }) {
    return this.admin.saveCategory(null, body.name, req.session.employee);
  }

  @Put('categories/:id')
  @Requires('products.manage')
  updateCategory(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: { name: string }) {
    return this.admin.saveCategory(id, body.name, req.session.employee);
  }

  /** Promotions and the names of the free gifts. How many of each gift is left is the inventory context's (GET /bo/premiums/stock). */
  @Get('promotions')
  @Requires('promos.manage')
  promotions() {
    return this.admin.listPromotions();
  }

  @Post('premiums')
  @Requires('promos.manage')
  createPremium(@Req() req: AuthedRequest, @Body() body: { name: string }) {
    return this.admin.savePremium(null, body.name, req.session.employee);
  }

  @Post('promotions')
  @Requires('promos.manage')
  @HttpCode(204)
  async createPromotion(@Req() req: AuthedRequest, @Body() body: { promotion: Promotion; active?: boolean }) {
    await this.admin.savePromotion({ ...body.promotion, id: body.promotion?.id || `promo-${Date.now().toString(36)}` }, body.active ?? true, req.session.employee);
  }

  @Put('promotions/:id')
  @Requires('promos.manage')
  @HttpCode(204)
  async updatePromotion(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: { promotion: Promotion; active: boolean }) {
    await this.admin.savePromotion({ ...body.promotion, id }, body.active, req.session.employee);
  }
}
