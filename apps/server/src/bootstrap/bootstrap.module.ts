import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SettingsModule } from '../settings/settings.module';
import { BootstrapService } from './bootstrap.service';

@Module({ imports: [AuthModule, SettingsModule], providers: [BootstrapService] })
export class BootstrapModule {}
