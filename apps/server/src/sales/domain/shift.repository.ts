import type { Shift } from './shift';

/** What the domain needs from storage; the TypeORM version is in infrastructure/. */
export abstract class ShiftRepository {
  abstract findById(id: string): Promise<Shift | null>;
  /** Same, and locks the row until the transaction ends. */
  abstract lockById(id: string): Promise<Shift | null>;
  abstract findOpenByTerminal(terminalId: string): Promise<Shift | null>;
  abstract add(shift: Shift): Promise<void>;
  /** Writes the closing fields and any new cash moves. */
  abstract save(shift: Shift): Promise<void>;
}
