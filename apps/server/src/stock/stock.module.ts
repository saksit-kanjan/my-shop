import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ProductsModule } from '../products/products.module';
import { ReceiptEntity, ReceiptLine, StockCount, StockCountLine, StockMovement, SupplierEntity } from './entities/stock.entities';
import { ReceivingService } from './receiving.service';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';
import { StocktakeService } from './stocktake.service';

/** The stock ledger, receiving, adjustments and stock counts. Sales writes stock through `StockService.record`. */
@Module({
  imports: [AuthModule, ProductsModule, TypeOrmModule.forFeature([StockMovement, SupplierEntity, ReceiptEntity, ReceiptLine, StockCount, StockCountLine])],
  controllers: [StockController],
  providers: [StockService, ReceivingService, StocktakeService],
  exports: [StockService],
})
export class StockModule {}
