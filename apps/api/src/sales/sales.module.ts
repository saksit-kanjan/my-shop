import { Module } from '@nestjs/common';
import { AdministrationModule } from '../administration/administration.module';
import { CatalogModule } from '../catalog/catalog.module';
import { IdentityModule } from '../identity/identity.module';
import { InventoryModule } from '../inventory/inventory.module';
import { MembershipModule } from '../membership/membership.module';
import { CreditNoteService } from './credit-note.service';
import { DayCloseService } from './day-close.service';
import { PosCatalogService } from './pos-catalog.service';
import { SaleService } from './sale.service';
import { SalesDocumentService } from './sales-document.service';
import { ShiftService } from './shift.service';
import { CreditNoteRepository } from './repositories/credit-note.repository';
import { SalesRepository } from './repositories/sales.repository';
import { ShiftRepository } from './repositories/shift.repository';
import { PgCreditNoteRepository } from './repositories/pg-credit-note.repository';
import { PgSalesRepository } from './repositories/pg-sales.repository';
import { PgShiftRepository } from './repositories/pg-shift.repository';
import { DayCloseController } from './day-close.controller';
import { TillController } from './till.controller';

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
