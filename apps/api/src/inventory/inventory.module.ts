import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { IdentityModule } from '../identity/identity.module';
import { ReceivingService } from './receiving.service';
import { StockLedgerService } from './stock-ledger.service';
import { StockService } from './stock.service';
import { StocktakeService } from './stocktake.service';
import { ProductDirectory } from './providers/product-directory';
import { StockRepository } from './repositories/stock.repository';
import { CatalogProductDirectory } from './providers/catalog-product-directory';
import { PgStockRepository } from './repositories/pg-stock.repository';
import { InventoryController } from './inventory.controller';

/**
 * The stock ledger, receiving, adjustments and stock counts. It depends on the catalog only through the `ProductDirectory` port.
 * Sales uses `StockLedgerService`; no one else writes stock.
 */
@Module({
  imports: [IdentityModule, CatalogModule],
  controllers: [InventoryController],
  providers: [
    StockLedgerService,
    StockService,
    ReceivingService,
    StocktakeService,
    { provide: StockRepository, useClass: PgStockRepository },
    { provide: ProductDirectory, useClass: CatalogProductDirectory },
  ],
  exports: [StockLedgerService, StockService],
})
export class InventoryModule {}
