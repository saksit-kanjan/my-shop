import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { InventoryModule } from '../inventory/inventory.module';
import { SalesModule } from '../sales/sales.module';
import { ReportService } from './report.service';
import { ReportingController } from './reporting.controller';

/** Reports, the dashboard and the audit view. A pure read side: it imports the contexts it reads and nobody imports it. */
@Module({
  imports: [IdentityModule, InventoryModule, SalesModule],
  controllers: [ReportingController],
  providers: [ReportService],
  exports: [ReportService],
})
export class ReportingModule {}
