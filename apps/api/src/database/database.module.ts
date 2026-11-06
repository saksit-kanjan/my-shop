import { Global, Inject, Injectable, Module, type DynamicModule, type OnModuleInit } from '@nestjs/common';
import { DB, type Db } from './database';
import { migrate } from './schema';
import { UnitOfWork } from './unit-of-work';

/** Creates or upgrades the tables before the first request. */
@Injectable()
export class MigrationRunner implements OnModuleInit {
  constructor(@Inject(DB) private readonly db: Db) {}
  async onModuleInit() {
    await migrate(this.db);
  }
}

/**
 * The database as a Nest provider: the `Db` connection (pg or embedded PGlite, chosen by the caller), the `UnitOfWork`
 * features use to run a use case in one transaction, and the migrations. Global.
 */
@Global()
@Module({})
export class DatabaseModule {
  static forRoot(db: Db): DynamicModule {
    return { module: DatabaseModule, providers: [{ provide: DB, useValue: db }, UnitOfWork, MigrationRunner], exports: [DB, UnitOfWork] };
  }
}
