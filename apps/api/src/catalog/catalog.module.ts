import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { CatalogAdminService } from './catalog-admin.service';
import { CatalogService } from './catalog.service';
import { CatalogRepository } from './repositories/catalog.repository';
import { PgCatalogRepository } from './repositories/pg-catalog.repository';
import { CatalogController } from './catalog.controller';

/** Products, categories, promotions and free gifts. Knows nothing about stock, bills or members. */
@Module({
  imports: [IdentityModule],
  controllers: [CatalogController],
  providers: [CatalogService, CatalogAdminService, { provide: CatalogRepository, useClass: PgCatalogRepository }],
  exports: [CatalogService, CatalogAdminService],
})
export class CatalogModule {}
