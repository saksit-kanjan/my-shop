import { Module } from '@nestjs/common';
import { AdministrationModule } from '../administration/administration.module';
import { MembershipService } from './application/membership.service';
import { MemberRepository } from './domain/member.repository';
import { PgMemberRepository } from './infrastructure/pg-member.repository';
import { MembershipController } from './presentation/membership.controller';

/** Members, PDPA consent and the points ledger. Sales asks it to earn, redeem and adjust points; it knows nothing about bills. */
@Module({
  imports: [AdministrationModule],
  controllers: [MembershipController],
  providers: [MembershipService, { provide: MemberRepository, useClass: PgMemberRepository }],
  exports: [MembershipService],
})
export class MembershipModule {}
