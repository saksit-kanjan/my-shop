import { Module } from '@nestjs/common';
import { AdministrationModule } from '../administration/administration.module';
import { MembershipModule } from '../membership/membership.module';
import { Scheduler } from './scheduler.service';

/** The daily backup and points-expiry timer. Only imported when the real server starts. */
@Module({ imports: [AdministrationModule, MembershipModule], providers: [Scheduler] })
export class JobsModule {}
