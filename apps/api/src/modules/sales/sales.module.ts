import { Module } from '@nestjs/common';
import { AdministrationModule } from '../administration/administration.module';
import { CatalogModule } from '../catalog/catalog.module';
import { IdentityModule } from '../identity/identity.module';
import { InventoryModule } from '../inventory/inventory.module';
import { MembershipModule } from '../membership/membership.module';
import { CreditNoteService } from './application/credit-note.service';
import { DayCloseService } from './application/day-close.service';
import { PosCatalogService } from './application/pos-catalog.service';
import { SaleService } from './application/sale.service';
import { SalesDocumentService } from './application/sales-document.service';
import { ShiftService } from './application/shift.service';
import { CreditNoteRepository } from './domain/credit-note.repository';
import { SalesRepository } from './domain/sales.repository';
import { ShiftRepository } from './domain/shift.repository';
import { PgCreditNoteRepository } from './infrastructure/pg-credit-note.repository';
import { PgSalesRepository } from './infrastructure/pg-sales.repository';
import { PgShiftRepository } from './infrastructure/pg-shift.repository';
import { DayCloseController } from './presentation/day-close.controller';
import { TillController } from './presentation/till.controller';

/**
 * The sales floor: shifts, bills, voids and refunds, documents, day close. It is the only context that orchestrates others:
 * catalog (prices), inventory (stock), membership (points), identity (approvals) and administration (settings).
 */
@Module({
  imports: [AdministrationModule, CatalogModule, IdentityModule, InventoryModule, MembershipModule],
  controllers: [TillController, DayCloseController],
  providers: [
    PosCatalogService,
    ShiftService,
    SaleService,
    CreditNoteService,
    SalesDocumentService,
    DayCloseService,
    { provide: ShiftRepository, useClass: PgShiftRepository },
    { provide: SalesRepository, useClass: PgSalesRepository },
    { provide: CreditNoteRepository, useClass: PgCreditNoteRepository },
  ],
  exports: [ShiftService, SaleService, CreditNoteService, SalesDocumentService, DayCloseService, PosCatalogService],
})
export class SalesModule {}
