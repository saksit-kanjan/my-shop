import { Injectable } from '@nestjs/common';
import { UnitOfWork, type Tx } from '../database/unit-of-work';
import { StockRepository, type Movement } from './repositories/stock.repository';

/** The inventory context's public API for the sales floor: write ledger rows and read balances. Nothing else edits stock. */
@Injectable()
export class StockLedgerService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly repo: StockRepository,
  ) {}

  async record(tx: Tx, movements: Movement[]): Promise<void> {
    for (const m of movements) await this.repo.append(tx, m);
  }

  balanceOf(tx: Tx, productId: string): Promise<number> {
    return this.repo.balanceOf(tx, productId);
  }

  balances(tx: Tx = this.uow.read): Promise<Map<string, number>> {
    return this.repo.balances(tx);
  }

  /** Remaining stock of each free gift (premium). */
  premiumBalances(tx: Tx = this.uow.read): Promise<Map<string, number>> {
    return this.repo.premiumBalances(tx);
  }
}
