import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MembersModule } from '../members/members.module';
import { ProductsModule } from '../products/products.module';
import { SettingsModule } from '../settings/settings.module';
import { StockModule } from '../stock/stock.module';
import { CreditNotesService } from './credit-notes.service';
import { DayCloseController } from './day-close.controller';
import { DayCloseService } from './day-close.service';
import { DocumentsService } from './documents.service';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { ShiftsService } from './shifts.service';

/** The sales floor: shifts, bills, voids and refunds, documents, day close. Uses products, stock, members, auth and settings. */
@Module({
  imports: [AuthModule, SettingsModule, ProductsModule, StockModule, MembersModule],
  controllers: [SalesController, DayCloseController],
  providers: [SalesService, ShiftsService, CreditNotesService, DocumentsService, DayCloseService],
  exports: [DayCloseService],
})
export class SalesModule {}
