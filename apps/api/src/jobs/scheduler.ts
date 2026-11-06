import { Inject, Injectable, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { BackupService } from '../modules/administration/application/backup.service';
import { AdministrationModule } from '../modules/administration/administration.module';
import { MembershipService } from '../modules/membership/application/membership.service';
import { MembershipModule } from '../modules/membership/membership.module';

/** Runs the daily backup (03:00 Bangkok) and then the points-expiry job. Only started on the real server. */
@Injectable()
export class Scheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(BackupService) private readonly backup: BackupService,
    @Inject(MembershipService) private readonly members: MembershipService,
  ) {}

  onApplicationBootstrap() {
    const tick = () => void this.backup.tick().then((ran) => (ran ? this.members.expireDue() : undefined)).catch((e) => console.error('scheduled job failed', e));
    this.timer = setInterval(tick, 10 * 60_000);
    this.timer.unref();
    tick();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }
}

@Module({ imports: [AdministrationModule, MembershipModule], providers: [Scheduler] })
export class JobsModule {}
