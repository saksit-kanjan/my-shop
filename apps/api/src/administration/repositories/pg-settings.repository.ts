import { Injectable } from '@nestjs/common';
import type { Tx } from '../../database/unit-of-work';
import { SettingsRepository } from './settings.repository';

@Injectable()
export class PgSettingsRepository extends SettingsRepository {
  all(tx: Tx) {
    return tx.query<{ key: string; value: unknown }>(`SELECT key, value FROM settings`);
  }

  async save(tx: Tx, key: string, value: unknown) {
    await tx.query(`INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [key, JSON.stringify(value)]);
  }
}
