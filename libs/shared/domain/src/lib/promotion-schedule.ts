import type { Promotion, PromotionSchedule } from '@my-shop/contracts';

const SHOP_TIME = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' });
const SHOP_WEEKDAY = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', weekday: 'short' });
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Does a schedule allow the moment `at`? Dates and weekdays are read in shop time (Bangkok), not the machine's. */
export function isScheduled(schedule: PromotionSchedule | undefined, at: Date): boolean {
  if (!schedule) return true;
  const date = SHOP_TIME.format(at);
  if (schedule.from && date < schedule.from) return false;
  if (schedule.to && date > schedule.to) return false;
  if (schedule.weekdays && schedule.weekdays.length > 0 && !schedule.weekdays.includes(WEEKDAYS.indexOf(SHOP_WEEKDAY.format(at)))) return false;
  return true;
}

export const isPromotionActive = (p: Promotion, at: Date): boolean => isScheduled(p.schedule, at);

/** Why a schedule is not usable, or null when it is fine. For the back office to check before saving. */
export function scheduleProblem(schedule: PromotionSchedule | undefined): string | null {
  if (!schedule) return null;
  const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
  if (schedule.from !== undefined && !isDate(schedule.from)) return 'วันที่เริ่มต้องเป็นรูปแบบ ปปปป-ดด-วว';
  if (schedule.to !== undefined && !isDate(schedule.to)) return 'วันที่สิ้นสุดต้องเป็นรูปแบบ ปปปป-ดด-วว';
  if (schedule.from && schedule.to && schedule.from > schedule.to) return 'วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด';
  if (schedule.weekdays && !schedule.weekdays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return 'วันในสัปดาห์ไม่ถูกต้อง';
  return null;
}
