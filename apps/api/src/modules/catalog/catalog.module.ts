import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { CatalogAdminService } from './application/catalog-admin.service';
import { CatalogService } from './application/catalog.service';
import { CatalogRepository } from './domain/catalog.repository';
import { PgCatalogRepository } from './infrastructure/pg-catalog.repository';
import { CatalogController } from './presentation/catalog.controller';

/** Products, categories, promotions and free gifts. Knows nothing about stock, bills or members. */
@Module({
  imports: [IdentityModule],
  controllers: [CatalogController],
  providers: [CatalogService, CatalogAdminService, { provide: CatalogRepository, useClass: PgCatalogRepository }],
  exports: [CatalogService, CatalogAdminService],
})
export class CatalogModule {}
