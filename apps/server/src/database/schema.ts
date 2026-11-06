import type { Queryable } from './database.types';

/**
 * Closed documents are append-only (CLAUDE.md rule 3): the triggers below make UPDATE and DELETE on
 * them fail in the database itself, not just in application code.
 */
const APPEND_ONLY = [
  'sales', 'sale_lines', 'payments', 'stock_movements', 'audit_log',
  'credit_notes', 'credit_note_lines', 'credit_note_payments', 'points_ledger', 'tax_invoices', 'receipts', 'receipt_lines',
];

const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS terminals (id text PRIMARY KEY, name text NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS employees (
     id text PRIMARY KEY, code_hash text NOT NULL UNIQUE, name text NOT NULL, initials text NOT NULL,
     role text NOT NULL CHECK (role IN ('cashier','supervisor','manager','owner')), active boolean NOT NULL DEFAULT true)`,
  `CREATE TABLE IF NOT EXISTS login_attempts (terminal_id text PRIMARY KEY, fails int NOT NULL DEFAULT 0, locked_until timestamptz)`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token text PRIMARY KEY, employee_id text NOT NULL REFERENCES employees(id), terminal_id text NOT NULL,
     created_at timestamptz NOT NULL, last_seen timestamptz NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS categories (id text PRIMARY KEY, name text NOT NULL, sort int NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS products (
     id text PRIMARY KEY, sku text NOT NULL UNIQUE, name text NOT NULL, category_id text NOT NULL REFERENCES categories(id),
     price int NOT NULL CHECK (price >= 0), member_price int NOT NULL CHECK (member_price >= 0), image_key text,
     active boolean NOT NULL DEFAULT true, sort int NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS barcodes (code text PRIMARY KEY, product_id text NOT NULL REFERENCES products(id))`,
  `CREATE TABLE IF NOT EXISTS premiums (id text PRIMARY KEY, name text NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS promotions (id text PRIMARY KEY, kind text NOT NULL, body jsonb NOT NULL, active boolean NOT NULL DEFAULT true, sort int NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS shifts (
     id text PRIMARY KEY, terminal_id text NOT NULL, employee_id text NOT NULL REFERENCES employees(id),
     business_date date NOT NULL, opened_at timestamptz NOT NULL, float int NOT NULL CHECK (float >= 0),
     closed_at timestamptz, counted int, note text)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS one_open_shift_per_terminal ON shifts (terminal_id) WHERE closed_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS doc_counters (key text PRIMARY KEY, last int NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sales (
     doc_no text PRIMARY KEY, shift_id text NOT NULL REFERENCES shifts(id), employee_id text NOT NULL REFERENCES employees(id),
     at timestamptz NOT NULL, business_date date NOT NULL, member_phone text,
     gross int NOT NULL, discount int NOT NULL, net int NOT NULL, vat int NOT NULL, change int NOT NULL, cart jsonb NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sale_lines (
     id bigserial PRIMARY KEY, doc_no text NOT NULL REFERENCES sales(doc_no), product_id text NOT NULL,
     name text NOT NULL, qty int NOT NULL, unit_price int NOT NULL, gross int NOT NULL, discount int NOT NULL, net int NOT NULL,
     applied jsonb NOT NULL, gift_of_product_id text)`,
  `CREATE TABLE IF NOT EXISTS payments (
     id bigserial PRIMARY KEY, doc_no text NOT NULL REFERENCES sales(doc_no),
     method text NOT NULL CHECK (method IN ('cash','promptpay','card','transfer')),
     amount int NOT NULL CHECK (amount > 0), tendered int, reference text)`,
  `CREATE TABLE IF NOT EXISTS cash_moves (
     id bigserial PRIMARY KEY, shift_id text NOT NULL REFERENCES shifts(id), at timestamptz NOT NULL,
     type text NOT NULL CHECK (type IN ('drop','out','in')), amount int NOT NULL CHECK (amount > 0),
     reason text NOT NULL, employee_id text NOT NULL REFERENCES employees(id), approved_by text)`,
  `CREATE TABLE IF NOT EXISTS stock_movements (
     id bigserial PRIMARY KEY, product_id text, premium_id text, qty int NOT NULL,
     kind text NOT NULL, doc_no text, at timestamptz NOT NULL,
     CHECK ((product_id IS NULL) <> (premium_id IS NULL)))`,
  `CREATE TABLE IF NOT EXISTS audit_log (
     id bigserial PRIMARY KEY, at timestamptz NOT NULL, actor text, approver text, terminal_id text,
     action text NOT NULL, entity text, entity_id text, before jsonb, after jsonb)`,

  // ---- back office, members, refunds (added after the first release: ALTERs keep older databases working) ----
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS username text UNIQUE`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS password_hash text`,
  `ALTER TABLE products ADD COLUMN IF NOT EXISTS cost int NOT NULL DEFAULT 0`,
  `ALTER TABLE products ADD COLUMN IF NOT EXISTS reorder_point int NOT NULL DEFAULT 0`,
  `ALTER TABLE sales ADD COLUMN IF NOT EXISTS member_id text`,
  `ALTER TABLE sales ADD COLUMN IF NOT EXISTS points_earned int NOT NULL DEFAULT 0`,
  `ALTER TABLE sales ADD COLUMN IF NOT EXISTS points_redeemed int NOT NULL DEFAULT 0`,
  `ALTER TABLE sales ADD COLUMN IF NOT EXISTS points_value int NOT NULL DEFAULT 0`,
  /* Prices and promotions as they were when the bill closed, so a refund re-prices against the same rules. */
  `ALTER TABLE sales ADD COLUMN IF NOT EXISTS pricing jsonb`,
  `ALTER TABLE sales ADD COLUMN IF NOT EXISTS exchange_for text`,
  `ALTER TABLE sale_lines ADD COLUMN IF NOT EXISTS cost int NOT NULL DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value jsonb NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS role_permissions (role text NOT NULL, permission text NOT NULL, allowed boolean NOT NULL, PRIMARY KEY (role, permission))`,
  `CREATE TABLE IF NOT EXISTS members (
     id text PRIMARY KEY, phone text UNIQUE, name text NOT NULL, birthday date, tier text NOT NULL DEFAULT 'Standard',
     joined_at timestamptz NOT NULL, pdpa_consent_at timestamptz, tax jsonb, anonymized_at timestamptz)`,
  `CREATE TABLE IF NOT EXISTS points_ledger (
     id bigserial PRIMARY KEY, member_id text NOT NULL REFERENCES members(id), points int NOT NULL,
     kind text NOT NULL CHECK (kind IN ('earn','redeem','refund','void','expire','adjust')),
     doc_no text, source_id bigint, expires_at timestamptz, at timestamptz NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS credit_notes (
     doc_no text PRIMARY KEY, sale_doc_no text NOT NULL REFERENCES sales(doc_no), shift_id text NOT NULL REFERENCES shifts(id),
     type text NOT NULL CHECK (type IN ('void','refund')), at timestamptz NOT NULL, business_date date NOT NULL,
     amount int NOT NULL CHECK (amount >= 0), reason text NOT NULL, restock boolean NOT NULL,
     employee_id text NOT NULL REFERENCES employees(id), approved_by text NOT NULL REFERENCES employees(id))`,
  `CREATE TABLE IF NOT EXISTS credit_note_lines (
     id bigserial PRIMARY KEY, doc_no text NOT NULL REFERENCES credit_notes(doc_no), product_id text NOT NULL,
     name text NOT NULL, qty int NOT NULL CHECK (qty > 0), amount int NOT NULL, cost int NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS credit_note_payments (
     id bigserial PRIMARY KEY, doc_no text NOT NULL REFERENCES credit_notes(doc_no), method text NOT NULL, amount int NOT NULL CHECK (amount > 0))`,
  `CREATE TABLE IF NOT EXISTS tax_invoices (
     doc_no text PRIMARY KEY, sale_doc_no text NOT NULL REFERENCES sales(doc_no), at timestamptz NOT NULL,
     buyer_name text NOT NULL, buyer_address text NOT NULL, buyer_tax_id text NOT NULL, buyer_branch text NOT NULL, issued_by text NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS reprints (id bigserial PRIMARY KEY, doc_no text NOT NULL, at timestamptz NOT NULL, employee_id text NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS suppliers (id text PRIMARY KEY, name text NOT NULL, contact text, terms text, active boolean NOT NULL DEFAULT true)`,
  `CREATE TABLE IF NOT EXISTS receipts (
     doc_no text PRIMARY KEY, supplier_id text NOT NULL REFERENCES suppliers(id), at timestamptz NOT NULL, ref text, note text, employee_id text NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS receipt_lines (
     id bigserial PRIMARY KEY, doc_no text NOT NULL REFERENCES receipts(doc_no), product_id text NOT NULL REFERENCES products(id),
     qty int NOT NULL CHECK (qty > 0), unit_cost int NOT NULL CHECK (unit_cost >= 0))`,
  `CREATE TABLE IF NOT EXISTS stock_counts (
     id text PRIMARY KEY, scope text NOT NULL, category_id text, started_at timestamptz NOT NULL, started_by text NOT NULL,
     status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','approved','cancelled')), approved_at timestamptz, approved_by text)`,
  `CREATE TABLE IF NOT EXISTS stock_count_lines (
     count_id text NOT NULL REFERENCES stock_counts(id), product_id text NOT NULL, snapshot_qty int NOT NULL, counted_qty int,
     PRIMARY KEY (count_id, product_id))`,
  `CREATE TABLE IF NOT EXISTS day_closes (
     business_date date PRIMARY KEY, closed_at timestamptz NOT NULL, closed_by text NOT NULL, summary jsonb NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS price_history (
     id bigserial PRIMARY KEY, product_id text NOT NULL, price int NOT NULL, member_price int NOT NULL, cost int NOT NULL, at timestamptz NOT NULL, by text)`,
  `ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS unit_cost int`,
  `CREATE OR REPLACE FUNCTION forbid_change() RETURNS trigger AS $$
   BEGIN RAISE EXCEPTION 'append-only table: % is not allowed on %', TG_OP, TG_TABLE_NAME; END $$ LANGUAGE plpgsql`,
  ...APPEND_ONLY.flatMap((t) => [
    `DROP TRIGGER IF EXISTS ${t}_append_only ON ${t}`,
    `CREATE TRIGGER ${t}_append_only BEFORE UPDATE OR DELETE ON ${t} FOR EACH ROW EXECUTE FUNCTION forbid_change()`,
  ]),
];

export async function migrate(db: Queryable): Promise<void> {
  for (const stmt of SCHEMA) await db.query(stmt);
}
