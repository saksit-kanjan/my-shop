import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AdministrationModule } from './administration/administration.module';
import { AuditModule } from './audit/audit.module';
import { CatalogModule } from './catalog/catalog.module';
import { CommonModule, type CommonOptions } from './common/common.module';
import { DomainErrorFilter } from './common/filters/domain-error.filter';
import type { Db } from './database/database';
import { DatabaseModule } from './database/database.module';
import { AuthGuard } from './identity/guards/auth.guard';
import { IdentityModule } from './identity/identity.module';
import { InventoryModule } from './inventory/inventory.module';
import { JobsModule } from './jobs/jobs.module';
import { MembershipModule } from './membership/membership.module';
import { NumberingModule } from './numbering/numbering.module';
import { ReportingModule } from './reporting/reporting.module';
import { SalesModule } from './sales/sales.module';

export interface AppOptions extends CommonOptions {
  /** The database the app owns the schema of. Closing it is the caller's job. */
  db: Db;
  /** Run the daily backup and points-expiry timer. On for the server, off in tests. */
  schedule?: boolean;
}

/**
 * The root module. Each feature is a Nest module in its own folder (module, controllers, services, dto, entities,
 * repositories, policies). Features depend one way: sales -> catalog, inventory, membership, identity, administration;
 * inventory -> catalog; identity -> administration; reporting -> sales, inventory. Nobody depends on reporting or sales.
 */
@Module({})
export class AppModule {
  static forRoot(o: AppOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [
        CommonModule.forRoot(o),
        DatabaseModule.forRoot(o.db),
        AuditModule,
        NumberingModule,
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
