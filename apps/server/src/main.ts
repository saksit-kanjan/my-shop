import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureApp } from './common/app-setup';
import { CredentialsService } from './auth/credentials.service';
import { DatabaseService } from './database/database.service';
import { bootstrapOwner, seedDemo } from './database/demo.seed';
import { SettingsService } from './settings/settings.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  app.enableShutdownHooks();
  await app.init(); // runs the migrations before anything below touches the tables

  const config = app.get(ConfigService);
  const db = app.get(DatabaseService);
  const credentials = app.get(CredentialsService);
  if (config.get('SEED_DEMO') !== '0' && (await seedDemo(db, credentials))) console.log('Seeded demo catalog and employees.');
  if (await bootstrapOwner(db, credentials, process.env)) console.log('Created the owner account from OWNER_* settings.');
  const cutoff = config.get<string>('BUSINESS_DAY_CUTOFF_HOUR');
  if (cutoff) await db.transaction((tx) => app.get(SettingsService).update(tx, { cutoffHour: Number(cutoff) }));

  const port = config.get<number>('PORT') ?? 3000;
  await app.listen(port);
  console.log(`Server on http://localhost:${port}/api`);
}

void bootstrap();
