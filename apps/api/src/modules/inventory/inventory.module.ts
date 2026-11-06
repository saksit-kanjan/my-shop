import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { IdentityModule } from '../identity/identity.module';
import { ReceivingService } from './application/receiving.service';
import { StockLedgerService } from './application/stock-ledger.service';
import { StockService } from './application/stock.service';
import { StocktakeService } from './application/stocktake.service';
import { ProductDirectory } from './domain/product-directory';
import { StockRepository } from './domain/stock.repository';
import { CatalogProductDirectory } from './infrastructure/catalog-product-directory';
import { PgStockRepository } from './infrastructure/pg-stock.repository';
import { InventoryController } from './presentation/inventory.controller';

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
