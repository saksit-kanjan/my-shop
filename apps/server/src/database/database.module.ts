import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { types } from 'pg';
import { DatabaseService } from './database.service';
import { InitialSchema1700000000000 } from './migrations/1700000000000-initial-schema';
import { NumberingService } from './numbering.service';
import { SnakeNamingStrategy } from './snake-naming.strategy';

// int8 (count(), sum() results) arrives as a string by default; satang totals stay well under 2^53.
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => Number(v));

/**
 * PostgreSQL through TypeORM. Each feature registers its own entities (`TypeOrmModule.forFeature`); migrations run at start,
 * so a new database gets its tables and an older one is upgraded.
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.getOrThrow<string>('DATABASE_URL'),
        autoLoadEntities: true,
        migrations: [InitialSchema1700000000000],
        migrationsRun: true,
        synchronize: false,
        namingStrategy: new SnakeNamingStrategy(),
      }),
    }),
  ],
  providers: [DatabaseService, NumberingService],
  exports: [DatabaseService, NumberingService],
})
export class DatabaseModule {}
