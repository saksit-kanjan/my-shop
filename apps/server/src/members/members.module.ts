import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsModule } from '../settings/settings.module';
import { MemberRepository } from './domain/member.repository';
import { TypeOrmMemberRepository } from './infrastructure/typeorm-member.repository';
import { MemberEntity, PointsLedger } from './entities/members.entities';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';

@Module({ imports: [SettingsModule, TypeOrmModule.forFeature([MemberEntity, PointsLedger])], controllers: [MembersController], providers: [{ provide: MemberRepository, useClass: TypeOrmMemberRepository }, MembersService], exports: [MembersService] })
export class MembersModule {}
