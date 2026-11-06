import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { DomainError, HTTP_STATUS } from '../errors';

interface Res {
  status(code: number): Res;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
}

@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Res>();
    if (err instanceof DomainError) {
      const retry = err.details?.['retryAfterSeconds'];
      if (typeof retry === 'number') res.setHeader('Retry-After', String(retry));
      res.status(HTTP_STATUS[err.code]).json({ code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) });
      return;
    }
    if (err instanceof HttpException) {
      res.status(err.getStatus()).json({ code: 'invalid', message: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ code: 'internal', message: 'ระบบขัดข้อง ลองอีกครั้ง ถ้ายังไม่ได้ให้แจ้งหัวหน้างาน' });
  }
}
