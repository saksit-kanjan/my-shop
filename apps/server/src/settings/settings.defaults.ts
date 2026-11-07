import { DEFAULT_MANUAL_DISCOUNT_CAP_PERCENT } from '@my-shop/domain';
import { DomainError } from '../common/domain-error';

/** Store-wide knobs from the spec's "open questions". Defaults are the spec's suggestions; the owner changes them in the back office. */
export const SETTING_DEFAULTS = {
  /** Satang of net sales that earn 1 point (25 baht = 1 point). */
  pointsEarnSatang: 2500,
  /** Satang one point is worth when redeemed (100 points = 10 baht). */
  pointsValueSatang: 10,
  /** Months until earned points expire; 0 = never. */
  pointsExpiryMonths: 0,
  /** Days after the sale a customer may return goods without a manager's approval. */
  refundDays: 7,
  /** Sell even when the ledger says 0 or less (spec recommends yes, with a warning). */
  allowNegativeStock: true,
  /** Cash difference (satang) at close that needs a supervisor's acknowledgement. */
  cashVarianceLimit: 10000,
  /** Percent of the bill (after promotions) a cashier may take off by hand without approval; more needs `discount.over_cap`. */
  manualDiscountCapPercent: DEFAULT_MANUAL_DISCOUNT_CAP_PERCENT,
  /** Hour the business date rolls over. */
  cutoffHour: 0,
  storeName: 'My Shop',
  branchName: '[ชื่อสาขา]',
  taxId: '[เลขผู้เสียภาษี 13 หลัก]',
  address: '[ที่อยู่ร้าน]',
} as const;

export type Settings = { -readonly [K in keyof typeof SETTING_DEFAULTS]: (typeof SETTING_DEFAULTS)[K] extends number ? number : (typeof SETTING_DEFAULTS)[K] extends boolean ? boolean : string };

export interface SettingChange {
  key: string;
  before: unknown;
  after: unknown;
}

/** Stored values laid over the defaults. A stored value of the wrong type is ignored. */
export function withOverrides(rows: { key: string; value: unknown }[]): Settings {
  const out: Record<string, unknown> = { ...SETTING_DEFAULTS };
  for (const r of rows) if (r.key in SETTING_DEFAULTS && typeof r.value === typeof SETTING_DEFAULTS[r.key as keyof typeof SETTING_DEFAULTS]) out[r.key] = r.value;
  return out as Settings;
}

/** Upper bounds for settings that only make sense up to a point (all settings are whole numbers from 0). */
const SETTING_MAX: Partial<Record<keyof typeof SETTING_DEFAULTS, number>> = { manualDiscountCapPercent: 100, cutoffHour: 23 };

/** Validates a patch (known keys, right types, whole numbers) and returns only what actually changes. */
export function changesFor(current: Settings, patch: Record<string, unknown>): SettingChange[] {
  const changes: SettingChange[] = [];
  for (const [key, value] of Object.entries(patch)) {
    const def = SETTING_DEFAULTS[key as keyof typeof SETTING_DEFAULTS];
    if (def === undefined) throw new DomainError('invalid', `ไม่รู้จักการตั้งค่า ${key}`);
    if (typeof value !== typeof def) throw new DomainError('invalid', `การตั้งค่า ${key} ต้องเป็น ${typeof def === 'number' ? 'ตัวเลข' : typeof def === 'boolean' ? 'เปิดหรือปิด' : 'ข้อความ'}`);
    if (typeof value === 'number' && (!Number.isInteger(value) || value < 0)) throw new DomainError('invalid', `การตั้งค่า ${key} ต้องเป็นจำนวนเต็ม 0 ขึ้นไป`);
    const max = SETTING_MAX[key as keyof typeof SETTING_DEFAULTS];
    if (max !== undefined && (value as number) > max) throw new DomainError('invalid', `การตั้งค่า ${key} ต้องไม่เกิน ${max}`);
    const before = (current as Record<string, unknown>)[key];
    if (before !== value) changes.push({ key, before, after: value });
  }
  return changes;
}
