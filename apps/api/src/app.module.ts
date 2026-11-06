import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JobsModule } from './jobs/scheduler';
import { AdministrationModule } from './modules/administration/administration.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { IdentityModule } from './modules/identity/identity.module';
import { AuthGuard } from './modules/identity/presentation/auth.guard';
import { InventoryModule } from './modules/inventory/inventory.module';
import { MembershipModule } from './modules/membership/membership.module';
import { ReportingModule } from './modules/reporting/reporting.module';
import { SalesModule } from './modules/sales/sales.module';
import { DomainErrorFilter } from './shared/http/domain-error.filter';
import { SharedModule, type SharedOptions } from './shared/shared.module';

export interface AppOptions extends SharedOptions {
  /** Run the daily backup and points-expiry timer. On for the server, off in tests. */
  schedule?: boolean;
}

/**
 * The composition root. Bounded contexts, each a Nest module with domain / application / infrastructure / presentation:
 *
 *   shared ─ kernel, database, unit of work, audit, document numbers
 *   identity ─ sign-in, approvals, staff, permissions          administration ─ settings, backup
 *   catalog ─ products, promotions                             membership ─ members, points
 *   inventory ─ stock ledger, receiving, counts                sales ─ shifts, bills, credit notes, documents, day close
 *   reporting ─ read side over all of them
 *
 * Dependencies point one way: sales -> (catalog, inventory, membership, identity, administration); inventory -> catalog;
 * identity -> administration; reporting -> (sales, inventory). Nobody depends on reporting or sales.
 */
@Module({})
export class AppModule {
  static forRoot(o: AppOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [
        SharedModule.forRoot(o),
        AdministrationModule,
        IdentityModule,
        CatalogModule,
        MembershipModule,
        InventoryModule,
        SalesModule,
        ReportingModule,
        ...(o.schedule ? [JobsModule] : []),
      ],
      providers: [
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_FILTER, useClass: DomainErrorFilter },
      ],
    };
  }
}
