import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { bootstrapOwner, seedDemo } from './bootstrap/seed';
import { CodeHasher, PasswordHasher } from './modules/identity/domain/credential-hasher';
import { SettingsService } from './modules/administration/application/settings.service';
import { createPgDb } from './shared/database/pg-db';
import { createPgliteDb } from './shared/database/pglite-db';

async function bootstrap() {
  // DATABASE_URL = PostgreSQL in production. Without it the API runs on embedded Postgres kept under
  // .data/, so `nx serve api` works on a laptop with no Docker.
  const url = process.env['DATABASE_URL'];
  const db = url ? createPgDb(url) : await createPgliteDb(process.env['PGLITE_DIR'] ?? join(process.cwd(), '.data', 'pglite'));
  const secret = process.env['CODE_SECRET'] ?? 'dev-only-secret-change-me';
  if (url && !process.env['CODE_SECRET']) throw new Error('Set CODE_SECRET when using DATABASE_URL: it keys the employee code hashes.');
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.forRoot({
      db,
      secret,
      backupDir: process.env['BACKUP_DIR'] ?? join(process.cwd(), '.data', 'backups'),
      backupRetentionDays: Number(process.env['BACKUP_RETENTION_DAYS'] ?? 30),
      schedule: true,
    }),
  );
  app.enableShutdownHooks();
  // The prefix has to be set before init(): routes are registered then.
  app.setGlobalPrefix('api');

  // On the shop server one origin serves the API, the POS (/) and the customer display (/display/),
  // which keeps the BroadcastChannel between the two screens same-origin. Build first: nx run-many -t build.
  const dist = join(process.cwd(), 'dist', 'apps');
  for (const [prefix, dir] of [['/display', 'customer-display'], ['/admin', 'backoffice'], ['', 'pos']] as const) {
    const root = join(dist, dir);
    if (!existsSync(root)) continue;
    app.useStaticAssets(root, { prefix: prefix || undefined, index: false });
    app.use(`${prefix}/`, (req: { method: string; path: string; originalUrl: string }, res: { sendFile(p: string): void }, next: () => void) => {
      const isPage = req.method === 'GET' && !req.originalUrl.startsWith('/api') && !/\.[a-z0-9]+$/i.test(req.path);
      const owner = req.originalUrl.startsWith('/display') ? 'customer-display' : req.originalUrl.startsWith('/admin') ? 'backoffice' : 'pos';
      if (isPage && owner === dir) res.sendFile(join(root, 'index.html'));
      else next();
    });
  }

  await app.init(); // runs the migrations before anything below touches the tables
  const codes = app.get(CodeHasher, { strict: false });
  const passwords = app.get(PasswordHasher, { strict: false });
  if (process.env['SEED_DEMO'] !== '0' && (await seedDemo(db, codes, passwords))) console.log('Seeded demo catalog and employees.');
  if (await bootstrapOwner(db, codes, passwords, process.env)) console.log('Created the owner account from OWNER_* settings.');
  if (process.env['BUSINESS_DAY_CUTOFF_HOUR']) await db.transaction((tx) => app.get(SettingsService, { strict: false }).update(tx, { cutoffHour: Number(process.env['BUSINESS_DAY_CUTOFF_HOUR']) }));

  const port = Number(process.env['PORT'] ?? 3000);
  await app.listen(port);
  console.log(`API on http://localhost:${port}/api`);
}

void bootstrap();
