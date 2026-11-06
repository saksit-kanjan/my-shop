# My Shop: working notes for Claude Code

On-prem POS for one shop: cashier POS, customer display, back office (`/admin/`) and the NestJS API behind them.
Runs on a LAN without internet. UI copy is Thai; code and comments are English.

Read `design/README.md` first. The full written spec is `design/spec.md` (Thai). Match `design/screens/*.dc.html` before inventing UI.

## Layout

- `apps/pos`: React + Vite POS. Data goes through `src/api/pos-api.ts` (`PosApi`). `src/api/index.ts` picks the
  implementation: `http-pos-api.ts` (the server at `/api`, default) or `local-pos-api.ts` (browser-only demo,
  build with `VITE_API_URL=local`).
- `apps/server`: the API only (NestJS 11, JSON under `/api`, PostgreSQL). It serves no web pages. See "Server" below.
- `apps/customer-display`: second screen, served at `/display/`, shows state only, no buttons.
- `libs/shared/contracts`: shared types and the customer-display channel messages.
- `libs/shared/domain`: money, VAT and the promotion engine. Must stay free of React and browser APIs.
- `libs/shared/seed`: demo catalog and employees (loaded into an empty database; the POS demo mode reads it too).
- `libs/ui`: daisyUI theme and shared components (`PromoChip`, `PriceStack`, `ProductThumb`).
- `apps/backoffice`: React + Vite, served at `/admin/`. Uses the same daisyUI theme; talks only to `/api/bo/*` (each route names the permission it needs). Tag imports so apps never import each other.

## Docker

`docker compose up -d --build` runs three containers: PostgreSQL, the server (`--target server`) and nginx (`--target web`) which serves the three web apps and proxies `/api`.
Needs `POSTGRES_PASSWORD` and `CODE_SECRET` in `.env`. Both images build and the stack runs (checked: pages through nginx, login, daily backup with the bundled `pg_dump`).

## Commands

```bash
pnpm install                     # pnpm only: do not use npm or yarn (package.json pins pnpm)
pnpm nx serve pos                  # :4200
pnpm nx serve customer-display     # open :4200/display/ on the second screen
pnpm nx run-many -t build test
pnpm nx serve server               # :3000, JSON API only; uses DATABASE_URL from .env, else embedded PGlite in .data/ with demo data
pnpm nx serve pos                  # :4200, proxies /api to :3000
pnpm nx serve backoffice           # :4202/admin/, proxies /api to :3000
docker compose up -d --build       # the shop: nginx (POS /, display /display/, back office /admin/) + server + PostgreSQL
python3 tools/e2e-smoke.py        # Playwright run of a full shift against :8080 (point it at the nginx address)
```

Demo employee codes: 100123, 200456, 300789.

## Rules that must not drift

1. **Money is integer satang.** Never use floats for money. `formatBaht` for screens (฿159, ฿8.50),
   `formatBahtFull` for receipts and reports. Prices include VAT 7%.
2. **Prices are computed only by `priceCart`** in `libs/shared/domain`. UI components never do price math.
   When the API exists it recomputes at close-sale and its result wins.
3. **Closed documents are append-only.** Never edit or delete a closed bill. Void and refund create new
   documents that reference the original, with reason and approver. Closing a bill, cutting stock, issuing
   the document number and recording points happen in one transaction.
4. **Promotion status colour is a contract**, defined once in `PromoChip`:
   green solid with ✓ = already in the bill; orange dashed with + = customer can still get it.
   Do not use orange for anything already applied.
5. **Promotion kinds**: `qty` (buy N, unit price drops; `countMode: 'set'` leftovers pay full price,
   `'all'` every unit gets the promo price), `gift` (buy A get B; B may be a product or a premium),
   `bogo`, `bill`. Member price applies only to lines with no promotion.
6. **Gifts** nest under the line that earned them (↳). A gift product shows its struck-through price and
   "ฟรี". A **premium** (non-sale item) has no price, its own stock, and does not count in "saved".
   If premium stock runs out the promo stops suggesting and the cashier is told.
7. **Customer display** shows few numbers: one price per line (original struck through when discounted),
   short chips for promo status, big total, "ประหยัดแล้ว". Large type, no scrollbars, no inputs.
   It follows the POS through `BroadcastChannel` (`DisplayState` in contracts). Keep POS and display
   same-origin. For a separate device later, swap the transport for WebSocket and keep the message shape.
8. **Login** is a secret 6-digit employee code on a keypad, locked 30 s after 5 wrong tries. Supervisor PIN
   approves discounts over the cap, voids, refunds and no-sale drawer opens (approver is stored).
9. **Hardware is an adapter, not core.** Printer, cash drawer and card terminal plug in through events and a
   device config; the sale flow must work with none of them (browser print, manual approval code).
10. UI copy: plain Thai, sentence case, name things the way the cashier says them, errors say what to do.

## Server (`apps/server`)

A plain NestJS API. One folder per feature, each with the usual files; no repository layer, services write SQL through
`DatabaseService` (`query` outside a transaction, `transaction(tx => ...)` for a whole use case).

```
src/main.ts, app.module.ts   boot (ConfigModule, validation pipe, error filter) and the root module
src/config/                  env validation (@nestjs/config); .env is read from the repo root
src/common/                  DomainError + filter, @Public/@Requires, session, clock, dates, app-setup (prefix, ValidationPipe)
src/database/                DatabaseService (pg or embedded PGlite), schema/migrations, NumberingService, demo seed
src/audit/                   AuditService (every feature writes who did what, inside its transaction)
src/<feature>/               auth, users, settings, backup, products, members, stock, sales, reports, jobs
  <feature>.module.ts, .controller.ts, .service.ts, dto/    plus small pure helpers like points-policy.ts, refund-rules.ts
test/                        *.e2e-spec.ts over the real module graph (Test.createTestingModule), structure.spec.ts, helpers/
```

Features depend one way: sales -> products, stock, members, auth, settings; stock -> products; reports -> sales, stock. Nothing
depends on sales or reports (`test/structure.spec.ts` checks cycles, thin controllers, and that the server serves no web pages).
Request bodies are DTO classes (class-validator) behind a global `ValidationPipe`; business rules throw `DomainError`.

Runtime: TypeScript runs through SWC (`@swc-node/register`, `unplugin-swc` in vitest) because Nest injects by constructor type and needs
decorator metadata; esbuild and `tsx` do not emit it, so do not use them for the server. Only non-class tokens (`CLOCK`, `DB_CONNECTION`)
need `@Inject`. Call `setGlobalPrefix` before `init()` (`configureApp` does). Tests replace the database and the clock with
`overrideProvider(DB_CONNECTION)` / `overrideProvider(CLOCK)`.
Products and stock are different features, so the back-office screens join `/bo/products` with `/bo/stock`, and `/bo/promotions` with `/bo/premiums/stock`.

## What the API does now

Login (till code, back-office username + password), shifts, cash moves, no-sale drawer, **approvals** (a supervisor types
their own code at the till, wrong codes are counted and lock the terminal), close-sale with server-side re-pricing,
**void and refund** as credit notes (re-priced under the promotion rules of the day, money split back over the original
payment methods, points clawed back, late returns need `refund.late`), **members and points** (PDPA consent, earn,
redeem, expiry, erasure), tax invoices and reprint counts, products and price history, promotions, suppliers, receiving
with average cost, stock ledger, adjustments, stock counts (snapshot, approve), day close, reports (sales, hourly,
products, gross profit, cash, credits, stock value, monthly tax, members and promos), users and the permission matrix
with owner overrides, settings, audit log, daily backup (kept 30 days). Closed documents are append-only through database triggers.

Settings that answer the spec's open questions are in `SETTING_DEFAULTS` (`src/administration/entities/settings.entity.ts`) and editable in the
back office: negative stock allowed, refund window 7 days, points 25 baht = 1 point and 100 points = 10 baht, no expiry,
cash variance limit 100 baht, business-day cutoff hour 0. **They are the spec's suggestions, not decisions the owner made.**

Demo accounts (local only, `src/database/demo.seed.ts`): back office `owner` and `manager`; production creates the owner from
`OWNER_USERNAME`, `OWNER_PASSWORD`, `OWNER_CODE` and never seeds demo data (`SEED_DEMO=0`).

## Not built yet

1. Purchase orders and "ใบคืนผู้ขาย" (receiving has no PO to compare against); lot and expiry tracking; weighed items.
2. Manual discounts at the till and the per-role cap (`discount.over_cap` exists as a permission, no screen uses it); coupons;
   member-tier promotions; promotion priority. (Dates and weekdays per promotion are done: `Promotion.schedule`, evaluated in shop time
   by `priceCart` with `at`; a refund re-prices at the bill's own time.)
3. Exchange screen at the till (the server takes `exchangeFor` on a sale, nothing in the POS sets it).
4. Receipt printing (ESC/POS over LAN), cash drawer and card terminal adapters, device config and the print queue.
   Receipts print through the browser today.
5. PDF export is the browser's print dialog; Excel export is a real .xlsx (`exportExcel` in the back office). No scheduled report emails.
6. A customer display on a separate device: the display follows the POS through a BroadcastChannel, so it works only in the same
   browser on the same machine. Swap the transport for WebSocket and keep the `DisplayState` message.
7. Back-office screens have no component tests; the server has e2e tests. `tools/e2e-smoke.py` still points at port 8080 and was not run.
8. Needs the owner and the accountant, not code: the spec's open questions (negative stock, refund window, points rates, cash
   variance limit, business-day cutoff are set to the spec's suggestions), the tax-invoice format, and the Revenue Department approval of the POS.

## Testing

Set `TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres` to run the same API suite on a real PostgreSQL (each test gets a throwaway database, dropped after); the default is in-memory PGlite. All pass on both.
The API is covered by `apps/server/test/*.e2e-spec.ts` (49 cases: rules, rollbacks, approvals, refunds, reports, permissions over HTTP) plus `structure.spec.ts`.
Pricing is covered in `libs/shared/domain/src/lib/pricing.spec.ts` (all three promo kinds, set vs all, gifts,
premiums, bill threshold, member). Add a test there before changing pricing behaviour.
