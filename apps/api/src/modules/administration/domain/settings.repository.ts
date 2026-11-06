import type { Tx } from '../../../shared/database/unit-of-work';

export abstract class SettingsRepository {
  abstract all(tx: Tx): Promise<{ key: string; value: unknown }[]>;
  abstract save(tx: Tx, key: string, value: unknown): Promise<void>;
}
