import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'node:path';
import { DB_CONNECTION, DatabaseService } from './database.service';
import { NumberingService } from './numbering.service';
import { createPgDb } from './pg-db';
import { createPgliteDb } from './pglite-db';

/**
 * PostgreSQL when DATABASE_URL is set, otherwise embedded PGlite under .data/ so `make dev` works on a laptop with no
 * database installed. Tests replace DB_CONNECTION with `overrideProvider`.
 */
@Global()
@Module({
  providers: [
    {
      provide: DB_CONNECTION,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('DATABASE_URL');
        return url ? createPgDb(url) : createPgliteDb(config.get<string>('PGLITE_DIR') ?? join(process.cwd(), '.data', 'pglite'));
      },
    },
    DatabaseService,
    NumberingService,
  ],
  exports: [DatabaseService, NumberingService],
})
export class DatabaseModule {}
