import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/** The audit log every feature writes to, inside its own transaction. Global. */
@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
