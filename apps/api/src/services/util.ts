export type Clock = () => Date;

export const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

const BANGKOK = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' });

/**
 * Business date (spec: separate from the calendar date). `cutoffHour` shifts the day boundary
 * for shops that close after midnight; 0 means the calendar date in Bangkok.
 */
export function businessDate(at: Date, cutoffHour = 0): string {
  return BANGKOK.format(new Date(at.getTime() - cutoffHour * 3_600_000));
}

/** Buddhist-era yymm, the middle part of a document number. */
export function docPeriod(at: Date): string {
  const [y, m] = BANGKOK.format(at).split('-');
  return String(Number(y) + 543).slice(-2) + m;
}
