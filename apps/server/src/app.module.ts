import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BackupModule } from './backup/backup.module';
import { BootstrapModule } from './bootstrap/bootstrap.module';
import { ClockModule } from './common/clock';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { JobsModule } from './jobs/jobs.module';
import { MembersModule } from './members/members.module';
import { ProductsModule } from './products/products.module';
import { ReportsModule } from './reports/reports.module';
import { SalesModule } from './sales/sales.module';
import { SettingsModule } from './settings/settings.module';
import { StockModule } from './stock/stock.module';
import { UsersModule } from './users/users.module';

/**
 * The server is only an API: JSON under /api. The POS, the customer display and the back office are separate apps
 * (apps/pos, apps/customer-display, apps/backoffice) that call it.
 *
 * Features depend one way: sales -> products, stock, members, auth, settings; stock -> products;
 * reports -> sales, stock. Nothing depends on sales or reports.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env', validate: validateEnv }),
    ClockModule,
    DatabaseModule,
    AuditModule,
    SettingsModule,
    AuthModule,
    BootstrapModule,
    UsersModule,
    BackupModule,
    ProductsModule,
    MembersModule,
    StockModule,
    SalesModule,
    ReportsModule,
    // The backup and points-expiry timer belongs to the real server, not to tests.
    ...(process.env['NODE_ENV'] === 'test' ? [] : [JobsModule]),
  ],
})
export class AppModule {}
