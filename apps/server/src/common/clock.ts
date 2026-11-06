import { Global, Module } from '@nestjs/common';

/** Time comes from the server clock only (spec); tests replace it with `overrideProvider(CLOCK)`. */
export type Clock = () => Date;
export const CLOCK = Symbol('CLOCK');

@Global()
@Module({ providers: [{ provide: CLOCK, useValue: (): Date => new Date() }], exports: [CLOCK] })
export class ClockModule {}
