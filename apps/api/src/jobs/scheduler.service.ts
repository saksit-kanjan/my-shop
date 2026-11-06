import { Injectable, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { BackupService } from '../administration/backup.service';
import { AdministrationModule } from '../administration/administration.module';
import { MembershipService } from '../membership/membership.service';
import { MembershipModule } from '../membership/membership.module';

/** Runs the daily backup (03:00 Bangkok) and then the points-expiry job. Only started on the real server. */
@Injectable()
export class Scheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly backup: BackupService,
    private readonly members: MembershipService,
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

