import { Inject, Injectable } from '@nestjs/common';
import { DB, type Queryable } from '../db/db';

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
  /** Hour the business date rolls over. */
  cutoffHour: 0,
  storeName: 'My Shop',
  branchName: '[ชื่อสาขา]',
  taxId: '[เลขผู้เสียภาษี 13 หลัก]',
  address: '[ที่อยู่ร้าน]',
} as const;

export type Settings = { -readonly [K in keyof typeof SETTING_DEFAULTS]: (typeof SETTING_DEFAULTS)[K] extends number ? number : (typeof SETTING_DEFAULTS)[K] extends boolean ? boolean : string };

@Injectable()
export class SettingsService {
  constructor(
    @Inject(DB) private readonly db: Queryable,
  ) {}

  async getAll(q: Queryable = this.db): Promise<Settings> {
    const rows = await q.query<{ key: string; value: unknown }>(`SELECT key, value FROM settings`);
    const out: Record<string, unknown> = { ...SETTING_DEFAULTS };
    for (const r of rows) if (r.key in SETTING_DEFAULTS && typeof r.value === typeof SETTING_DEFAULTS[r.key as keyof typeof SETTING_DEFAULTS]) out[r.key] = r.value;
    return out as Settings;
  }

  /** Validates keys and types so a typo in the back office cannot store junk. Returns the keys that changed. */
  async update(q: Queryable, patch: Record<string, unknown>): Promise<{ key: string; before: unknown; after: unknown }[]> {
    const before = await this.getAll(q);
    const changes: { key: string; before: unknown; after: unknown }[] = [];
    for (const [key, value] of Object.entries(patch)) {
      const def = SETTING_DEFAULTS[key as keyof typeof SETTING_DEFAULTS];
      if (def === undefined) throw new Error(`unknown setting ${key}`);
      if (typeof value !== typeof def) throw new Error(`setting ${key} must be a ${typeof def}`);
      if (typeof value === 'number' && (!Number.isInteger(value) || value < 0)) throw new Error(`setting ${key} must be a whole number, 0 or more`);
      if ((before as Record<string, unknown>)[key] === value) continue;
      await q.query(`INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [key, JSON.stringify(value)]);
      changes.push({ key, before: (before as Record<string, unknown>)[key], after: value });
    }
    return changes;
  }
}
