import { demoCatalog, demoEmployees } from '@my-shop/seed';
import type { Db } from '../shared/database/database';
import type { CodeHasher, PasswordHasher } from '../modules/identity/domain/credential-hasher';

/**
 * DEMO credentials for local development only. Production never runs this (SEED_DEMO=0, see bootstrapOwner).
 * The till codes for the three cashiers/supervisor are in libs/shared/seed; the back-office accounts are here.
 */
const DEMO_BACK_OFFICE = [
  { id: 'E004', code: '400111', name: 'มานี', initials: 'มน', role: 'manager', username: 'manager', password: 'myshop-demo-1234' },
  { id: 'E005', code: '500222', name: 'เจ้าของร้าน', initials: 'จร', role: 'owner', username: 'owner', password: 'myshop-demo-1234' },
] as const;

/** Loads the demo catalog, staff and opening stock once, when the database is empty. */
export async function seedDemo(db: Db, codes: CodeHasher, passwords: PasswordHasher, terminalIds: string[] = ['T01']): Promise<boolean> {
  const [{ n }] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM products`);
  if (n > 0) return false;
  const now = new Date();
  const staff = [...demoEmployees.map((e) => ({ ...e, username: undefined as string | undefined, password: undefined as string | undefined })), ...DEMO_BACK_OFFICE];
  await db.transaction(async (tx) => {
    for (const t of terminalIds) await tx.query(`INSERT INTO terminals (id, name) VALUES ($1,$1) ON CONFLICT DO NOTHING`, [t]);
    for (const e of staff) {
      await tx.query(`INSERT INTO employees (id, code_hash, name, initials, role, username, password_hash) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
        e.id, codes.hash(e.code), e.name, e.initials, e.role, e.username ?? null, e.password ? await passwords.hash(e.password) : null,
      ]);
    }
    for (const [i, c] of demoCatalog.categories.entries()) await tx.query(`INSERT INTO categories (id, name, sort) VALUES ($1,$2,$3)`, [c.id, c.name, i]);
    await tx.query(`INSERT INTO suppliers (id, name, contact, terms) VALUES ('SUP1','ผู้ขายตัวอย่าง','[เบอร์ติดต่อ]','เครดิต 30 วัน')`);
    for (const [i, p] of demoCatalog.products.entries()) {
      // Demo cost is 65% of the shelf price; every product starts with 50 on hand and reorders at 10.
      const cost = Math.round(p.price * 0.65);
      await tx.query(`INSERT INTO products (id, sku, name, category_id, price, member_price, image_key, cost, reorder_point, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,10,$9)`, [p.id, p.sku, p.name, p.categoryId, p.price, p.memberPrice, p.imageKey ?? null, cost, i]);
      for (const code of p.barcodes) await tx.query(`INSERT INTO barcodes (code, product_id) VALUES ($1,$2)`, [code, p.id]);
      await tx.query(`INSERT INTO stock_movements (product_id, qty, kind, doc_no, unit_cost, at) VALUES ($1,50,'opening','OPENING',$2,$3)`, [p.id, cost, now]);
    }
    for (const p of demoCatalog.premiums) {
      await tx.query(`INSERT INTO premiums (id, name) VALUES ($1,$2)`, [p.id, p.name]);
      await tx.query(`INSERT INTO stock_movements (premium_id, qty, kind, doc_no, at) VALUES ($1,$2,'opening','OPENING',$3)`, [p.id, p.stock, now]);
    }
    for (const [i, p] of demoCatalog.promotions.entries()) await tx.query(`INSERT INTO promotions (id, kind, body, sort) VALUES ($1,$2,$3,$4)`, [p.id, p.kind, JSON.stringify(p), i]);
  });
  return true;
}

/**
 * First run on a real server: create the owner from OWNER_USERNAME / OWNER_PASSWORD / OWNER_CODE when no owner exists,
 * so the back office is reachable without demo accounts.
 */
export async function bootstrapOwner(db: Db, codes: CodeHasher, passwords: PasswordHasher, env: Record<string, string | undefined>): Promise<boolean> {
  const [{ n }] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM employees WHERE role='owner' AND active`);
  if (n > 0) return false;
  const { OWNER_USERNAME: username, OWNER_PASSWORD: password, OWNER_CODE: code } = env;
  if (!username || !password || !code) return false;
  if (password.length < 8 || !/^\d{6}$/.test(code)) throw new Error('OWNER_PASSWORD needs 8+ characters and OWNER_CODE exactly 6 digits.');
  await db.query(`INSERT INTO employees (id, code_hash, name, initials, role, username, password_hash) VALUES ('OWNER',$1,'เจ้าของร้าน','จร','owner',$2,$3)`, [codes.hash(code), username, await passwords.hash(password)]);
  return true;
}
