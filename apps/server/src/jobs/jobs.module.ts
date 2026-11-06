import { Injectable, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { BackupModule } from '../backup/backup.module';
import { BackupService } from '../backup/backup.service';
import { MembersModule } from '../members/members.module';
import { MembersService } from '../members/members.service';

/** Runs the daily backup (03:00 Bangkok) and then the points-expiry job. Only started on the real server. */
@Injectable()
export class Scheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly backup: BackupService,
    private readonly members: MembersService,
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

@Module({ imports: [BackupModule, MembersModule], providers: [Scheduler] })
export class JobsModule {}
