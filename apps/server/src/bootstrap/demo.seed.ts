import { demoCatalog, demoEmployees } from '@my-shop/seed';
import type { CredentialsService } from '../auth/credentials.service';
import { EmployeeEntity, Terminal } from '../auth/entities/auth.entities';
import { BarcodeEntity, CategoryEntity, PremiumEntity, ProductEntity, PromotionEntity } from '../products/entities/products.entities';
import { StockMovement, SupplierEntity } from '../stock/entities/stock.entities';
import type { DatabaseService } from '../database/database.service';

/**
 * DEMO credentials for local development only. Production never runs this (SEED_DEMO=0, see bootstrapOwner).
 * The till codes for the three cashiers/supervisor are in libs/shared/seed; the back-office accounts are here.
 */
const DEMO_BACK_OFFICE = [
  { id: 'E004', code: '400111', name: 'มานี', initials: 'มน', role: 'manager', username: 'manager', password: 'myshop-demo-1234' },
  { id: 'E005', code: '500222', name: 'เจ้าของร้าน', initials: 'จร', role: 'owner', username: 'owner', password: 'myshop-demo-1234' },
] as const;

/** Loads the demo catalog, staff and opening stock once, when the database is empty. */
export async function seedDemo(db: DatabaseService, credentials: CredentialsService, terminalIds: string[] = ['T01']): Promise<boolean> {
  if ((await db.manager.count(ProductEntity)) > 0) return false;
  const now = new Date();
  const staff = [...demoEmployees.map((e) => ({ ...e, username: undefined as string | undefined, password: undefined as string | undefined })), ...DEMO_BACK_OFFICE];
  await db.transaction(async (tx) => {
    await tx.save(Terminal, terminalIds.map((id) => ({ id, name: id })));
    for (const e of staff) {
      await tx.insert(EmployeeEntity, { id: e.id, codeHash: credentials.hashCode(e.code), name: e.name, initials: e.initials, role: e.role, username: e.username ?? null, passwordHash: e.password ? await credentials.hashPassword(e.password) : null });
    }
    await tx.insert(CategoryEntity, demoCatalog.categories.map((c, i) => ({ id: c.id, name: c.name, sort: i })));
    await tx.insert(SupplierEntity, { id: 'SUP1', name: 'ผู้ขายตัวอย่าง', contact: '[เบอร์ติดต่อ]', terms: 'เครดิต 30 วัน' });
    // Demo cost is 65% of the shelf price; every product starts with 50 on hand and reorders at 10.
    const costOf = (price: number) => Math.round(price * 0.65);
    await tx.insert(ProductEntity, demoCatalog.products.map((p, i) => ({ id: p.id, sku: p.sku, name: p.name, categoryId: p.categoryId, price: p.price, memberPrice: p.memberPrice, imageKey: p.imageKey ?? null, cost: costOf(p.price), reorderPoint: 10, sort: i })));
    const barcodes = demoCatalog.products.flatMap((p) => p.barcodes.map((code) => ({ code, productId: p.id })));
    if (barcodes.length) await tx.insert(BarcodeEntity, barcodes);
    await tx.insert(StockMovement, demoCatalog.products.map((p) => ({ productId: p.id, qty: 50, kind: 'opening', docNo: 'OPENING', unitCost: costOf(p.price), at: now })));
    if (demoCatalog.premiums.length) {
      await tx.insert(PremiumEntity, demoCatalog.premiums.map((p) => ({ id: p.id, name: p.name })));
      await tx.insert(StockMovement, demoCatalog.premiums.map((p) => ({ premiumId: p.id, qty: p.stock, kind: 'opening', docNo: 'OPENING', at: now })));
    }
    if (demoCatalog.promotions.length) await tx.insert(PromotionEntity, demoCatalog.promotions.map((p, i) => ({ id: p.id, kind: p.kind, body: p, sort: i })));
  });
  return true;
}

/**
 * First run on a real server: create the owner from OWNER_USERNAME / OWNER_PASSWORD / OWNER_CODE when no owner exists,
 * so the back office is reachable without demo accounts.
 */
export async function bootstrapOwner(db: DatabaseService, credentials: CredentialsService, env: Record<string, string | undefined>): Promise<boolean> {
  if (await db.manager.existsBy(EmployeeEntity, { role: 'owner', active: true })) return false;
  const { OWNER_USERNAME: username, OWNER_PASSWORD: password, OWNER_CODE: code } = env;
  if (!username || !password || !code) return false;
  if (password.length < 8 || !/^\d{6}$/.test(code)) throw new Error('OWNER_PASSWORD needs 8+ characters and OWNER_CODE exactly 6 digits.');
  await db.manager.insert(EmployeeEntity, { id: 'OWNER', codeHash: credentials.hashCode(code), name: 'เจ้าของร้าน', initials: 'จร', role: 'owner', username, passwordHash: await credentials.hashPassword(password) });
  return true;
}
