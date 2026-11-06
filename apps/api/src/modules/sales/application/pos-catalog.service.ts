import { Inject, Injectable } from '@nestjs/common';
import type { Catalog } from '@my-shop/contracts';
import { UnitOfWork, type Tx } from '../../../shared/database/unit-of-work';
import { CatalogService } from '../../catalog/application/catalog.service';
import { StockLedgerService } from '../../inventory/application/stock-ledger.service';

/** The catalog as the till sees it: the catalog context's products and promotions, plus the stock left of each free gift. */
@Injectable()
export class PosCatalogService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(StockLedgerService) private readonly ledger: StockLedgerService,
  ) {}

  async get(tx: Tx = this.uow.read): Promise<Catalog> {
    const [snap, premiumStock] = await Promise.all([this.catalog.snapshot(tx), this.ledger.premiumBalances(tx)]);
    return { categories: snap.categories, products: snap.products, promotions: snap.promotions, premiums: snap.premiums.map((p) => ({ id: p.id, name: p.name, stock: premiumStock.get(p.id) ?? 0 })) };
  }
}
