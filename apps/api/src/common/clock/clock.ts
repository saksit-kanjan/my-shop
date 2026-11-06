/** Time comes from the server clock only (spec), and tests replace it. */
export type Clock = () => Date;
export const CLOCK = Symbol('CLOCK');
