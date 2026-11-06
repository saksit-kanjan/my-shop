import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './common/app-setup';

async function main() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  app.enableShutdownHooks();
  const port = app.get(ConfigService).get<number>('PORT') ?? 3000;
  await app.listen(port);
  new Logger('Server').log(`API on http://localhost:${port}/api`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
