import { ValidationError, ValidationPipe, type INestApplication } from '@nestjs/common';
import { DomainError } from './domain-error';
import { DomainErrorFilter } from './domain-error.filter';

const messageOf = (errors: ValidationError[]): string =>
  errors.flatMap((e) => (e.constraints ? Object.values(e.constraints) : e.children ? [messageOf(e.children)] : [])).join(', ');

/** Settings shared by the real server and the tests: the /api prefix, request validation and the error filter. */
export function configureApp(app: INestApplication): void {
  // The prefix has to be set before init(): routes are registered then.
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      exceptionFactory: (errors) => new DomainError('invalid', `ข้อมูลที่ส่งมาไม่ถูกต้อง: ${messageOf(errors)}`),
    }),
  );
  app.useGlobalFilters(new DomainErrorFilter());
}
