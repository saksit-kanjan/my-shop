import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SalesModule } from '../sales/sales.module';
import { StockModule } from '../stock/stock.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/** Reports, the dashboard and the audit view. Read-only: it reads the documents of the other features and writes nothing. */
@Module({ imports: [AuthModule, SalesModule, StockModule], controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule {}
