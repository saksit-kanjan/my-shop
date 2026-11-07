import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { MembersModule } from '../members/members.module';
import { ProductsModule } from '../products/products.module';
import { SettingsModule } from '../settings/settings.module';
import { StockModule } from '../stock/stock.module';
import { CreditNotesService } from './credit-notes.service';
import { CashMoveEntity, CreditNoteEntity, CreditNoteLine, CreditNotePayment, DayClose, PaymentEntity, Reprint, SaleEntity, SaleLineEntity, ShiftEntity, TaxInvoiceEntity } from './entities/sales.entities';
import { ShiftRepository } from './domain/shift.repository';
import { CreditNoteRepository } from './domain/credit-note.repository';
import { TypeOrmCreditNoteRepository } from './infrastructure/typeorm-credit-note.repository';
import { SaleRepository } from './domain/sale.repository';
import { TypeOrmSaleRepository } from './infrastructure/typeorm-sale.repository';
import { TypeOrmShiftRepository } from './infrastructure/typeorm-shift.repository';
import { DayCloseController } from './day-close.controller';
import { DayCloseService } from './day-close.service';
import { DocumentsService } from './documents.service';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { ShiftsService } from './shifts.service';

/** The sales floor: shifts, bills, voids and refunds, documents, day close. Uses products, stock, members, auth and settings. */
@Module({
  imports: [TypeOrmModule.forFeature([ShiftEntity, CashMoveEntity, SaleEntity, SaleLineEntity, PaymentEntity, CreditNoteEntity, CreditNoteLine, CreditNotePayment, TaxInvoiceEntity, Reprint, DayClose]), AuthModule, SettingsModule, ProductsModule, StockModule, MembersModule],
  controllers: [SalesController, DayCloseController],
  providers: [{ provide: ShiftRepository, useClass: TypeOrmShiftRepository }, { provide: SaleRepository, useClass: TypeOrmSaleRepository }, { provide: CreditNoteRepository, useClass: TypeOrmCreditNoteRepository }, SalesService, ShiftsService, CreditNotesService, DocumentsService, DayCloseService],
  exports: [DayCloseService],
})
export class SalesModule {}
