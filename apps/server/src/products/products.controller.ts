import { Body, Controller, Get, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import { PermissionsService } from '../auth/permissions.service';
import { Requires } from '../common/decorators';
import type { AuthedRequest } from '../common/session';
import { NameDto, ProductDto, PromotionDto } from './dto/products.dto';
import { ProductsService } from './products.service';

/** Back-office routes for products, categories, promotions and free gifts. The till's read-only /catalog is in the sales feature. */
@Controller('bo')
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly permissions: PermissionsService,
  ) {}

  private canSeeCost(req: AuthedRequest) {
    return this.permissions.can(req.session.employee.role, 'reports.cost');
  }

  @Get('products')
  @Requires('stock.view')
  async list(@Req() req: AuthedRequest) {
    return this.products.listProducts(await this.canSeeCost(req));
  }

  @Post('products')
  @Requires('products.manage')
  async create(@Req() req: AuthedRequest, @Body() body: ProductDto) {
    return this.products.saveProduct(null, body, req.session.employee, await this.canSeeCost(req));
  }

  @Put('products/:id')
  @Requires('products.manage')
  async update(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: ProductDto) {
    return this.products.saveProduct(id, body, req.session.employee, await this.canSeeCost(req));
  }

  @Get('categories')
  @Requires('stock.view')
  categories() {
    return this.products.listCategories();
  }

  @Post('categories')
  @Requires('products.manage')
  createCategory(@Req() req: AuthedRequest, @Body() body: NameDto) {
    return this.products.saveCategory(null, body.name, req.session.employee);
  }

  @Put('categories/:id')
  @Requires('products.manage')
  updateCategory(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: NameDto) {
    return this.products.saveCategory(id, body.name, req.session.employee);
  }

  /** Promotions and the names of the free gifts. How many gifts are left is in GET /bo/premiums/stock. */
  @Get('promotions')
  @Requires('promos.manage')
  promotions() {
    return this.products.listPromotions();
  }

  @Post('promotions')
  @Requires('promos.manage')
  @HttpCode(204)
  async createPromotion(@Req() req: AuthedRequest, @Body() body: PromotionDto) {
    await this.products.savePromotion({ ...body.promotion, id: body.promotion?.id || `promo-${Date.now().toString(36)}` }, body.active ?? true, req.session.employee);
  }

  @Put('promotions/:id')
  @Requires('promos.manage')
  @HttpCode(204)
  async updatePromotion(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: PromotionDto) {
    await this.products.savePromotion({ ...body.promotion, id }, body.active ?? true, req.session.employee);
  }

  @Post('premiums')
  @Requires('promos.manage')
  createPremium(@Req() req: AuthedRequest, @Body() body: NameDto) {
    return this.products.savePremium(body.name, req.session.employee);
  }
}
