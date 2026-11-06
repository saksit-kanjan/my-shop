import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProductsModule } from '../products/products.module';
import { ReceivingService } from './receiving.service';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';
import { StocktakeService } from './stocktake.service';

/** The stock ledger, receiving, adjustments and stock counts. Sales writes stock through `StockService.record`. */
@Module({
  imports: [AuthModule, ProductsModule],
  controllers: [StockController],
  providers: [StockService, ReceivingService, StocktakeService],
  exports: [StockService],
})
export class StockModule {}
