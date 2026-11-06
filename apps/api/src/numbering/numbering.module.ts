import { Global, Module } from '@nestjs/common';
import { DocumentNumbersService } from './document-numbers.service';

/** Gapless document number series (bills, credit notes, receipts). Global. */
@Global()
@Module({ providers: [DocumentNumbersService], exports: [DocumentNumbersService] })
export class NumberingModule {}
