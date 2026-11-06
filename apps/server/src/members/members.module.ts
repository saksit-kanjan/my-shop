import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';

@Module({ imports: [SettingsModule], controllers: [MembersController], providers: [MembersService], exports: [MembersService] })
export class MembersModule {}
