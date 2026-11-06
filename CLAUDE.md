# My Shop: working notes for Claude Code

On-prem POS for one shop: cashier POS, customer display, back office (`/admin/`) and the NestJS API behind them.
Runs on a LAN without internet. UI copy is Thai; code and comments are English.

Read `design/README.md` first. The full written spec is `design/spec.md` (Thai). Match `design/screens/*.dc.html` before inventing UI.

## Layout

- `apps/pos`: React + Vite POS. Data goes through `src/api/pos-api.ts` (`PosApi`). `src/api/index.ts` picks the
  implementation: `http-pos-api.ts` (the server at `/api`, default) or `local-pos-api.ts` (browser-only demo,
  build with `VITE_API_URL=local`).
- `apps/api`: NestJS 11, organised as bounded contexts with clean / DDD layers. See "API architecture" below.
- `apps/customer-display`: second screen, served at `/display/`, shows state only, no buttons.
- `libs/shared/contracts`: shared types and the customer-display channel messages.
- `libs/shared/domain`: money, VAT and the promotion engine. Must stay free of React and browser APIs.
- `libs/shared/seed`: demo catalog and employees (loaded into an empty database; the POS demo mode reads it too).
- `libs/ui`: daisyUI theme and shared components (`PromoChip`, `PriceStack`, `ProductThumb`).
- `apps/backoffice`: React + Vite, served at `/admin/`. Uses the same daisyUI theme; talks only to `/api/bo/*` (each route names the permission it needs). Tag imports so apps never import each other.

## Commands

```bash
pnpm install                     # pnpm only: do not use npm or yarn (package.json pins pnpm)
pnpm nx serve pos                  # :4200
pnpm nx serve customer-display     # open :4200/display/ on the second screen
pnpm nx run-many -t build test
pnpm nx serve api                  # :3000, embedded Postgres in .data/pglite, demo data seeded when empty
pnpm nx serve pos                  # :4200, proxies /api to :3000
pnpm nx serve backoffice           # :4202/admin/, proxies /api to :3000
PORT=8080 pnpm exec tsx --tsconfig apps/api/tsconfig.app.json apps/api/src/main.ts   # after nx run-many -t build:
                                  # the shop setup: POS (/), display (/display/), back office (/admin/) and API all on :8080
python3 tools/e2e-smoke.py        # Playwright run of a full shift against :8080 (needs the line above)
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

## API architecture (`apps/api/src`)

```
app.module.ts          composition root: AppModule.forRoot({ db, secret, clock, ... })
main.ts                boots Nest, serves the built apps, seeds on first run
shared/                kernel (DomainError, clock, dates, Session), database (Db port, pg and PGlite adapters, schema, UnitOfWork),
                       audit log, document numbers, http (error filter, auth decorators), SharedModule (global)
modules/<context>/     one Nest module per bounded context
  domain/              pure TypeScript: entities, value objects, policies, and the repository PORTS (abstract classes)
  application/         use cases: @Injectable services that orchestrate domain + ports in a UnitOfWork transaction
  infrastructure/      adapters: Pg*Repository (all SQL lives here), crypto, anti-corruption adapters to other contexts
  presentation/        controllers (thin: parse, call one use case, return)
  <context>.module.ts  providers, and exports ONLY application services
jobs/                  scheduler (backup + points expiry), only on the real server
bootstrap/             demo seed and first-run owner (not part of the app graph)
testing/               createServices(): boots the real module graph without HTTP, for tests
```

Contexts: **identity** (sign-in, approvals, staff, permission matrix), **administration** (settings, backup), **catalog**
(products, promotions, free gifts), **membership** (members, points ledger), **inventory** (stock ledger, receiving, counts),
**sales** (shifts, bills, credit notes, documents, day close; the only context that orchestrates others) and **reporting**
(read side). Dependencies point one way: sales -> catalog, inventory, membership, identity, administration; inventory -> catalog;
identity -> administration; reporting -> sales, inventory. `src/architecture.spec.ts` enforces the rules: domain has no Nest or
SQL, application never imports infrastructure or presentation, SQL stays in infrastructure (reporting's query side excepted), a
context reaches another only through its `application/` services, the shared kernel imports no context, and there are no cycles.

How to add things:
- A rule -> `domain/` as a pure function with a test; the use case calls it. A table -> a method on that context's repository port,
  implemented in `infrastructure/pg-*.repository.ts` (repositories take the open `Tx` as their first argument).
- A new use case -> an `@Injectable()` in `application/`, injecting ports and other contexts' services; run writes in
  `UnitOfWork.run`, call `AuditLog.record(tx, ...)` and `DocumentNumbers.format(tx, series)` inside the same transaction.
- Every constructor parameter needs an explicit `@Inject(...)`: tests and `tsx` run through esbuild, which emits no decorator metadata.
- Call `setGlobalPrefix` before `init()` in `main.ts`; routes are registered at init.
- Products and stock are different contexts, so the back-office screens join `/bo/products` with `/bo/stock`, and `/bo/promotions` with `/bo/premiums/stock`.

## What the API does now

Login (till code, back-office username + password), shifts, cash moves, no-sale drawer, **approvals** (a supervisor types
their own code at the till, wrong codes are counted and lock the terminal), close-sale with server-side re-pricing,
**void and refund** as credit notes (re-priced under the promotion rules of the day, money split back over the original
payment methods, points clawed back, late returns need `refund.late`), **members and points** (PDPA consent, earn,
redeem, expiry, erasure), tax invoices and reprint counts, products and price history, promotions, suppliers, receiving
with average cost, stock ledger, adjustments, stock counts (snapshot, approve), day close, reports (sales, hourly,
products, gross profit, cash, credits, stock value, monthly tax, members and promos), users and the permission matrix
with owner overrides, settings, audit log, daily backup (kept 30 days). Closed documents are append-only through database triggers.

Settings that answer the spec's open questions are in `SETTING_DEFAULTS` (`modules/administration/domain/settings.ts`) and editable in the
back office: negative stock allowed, refund window 7 days, points 25 baht = 1 point and 100 points = 10 baht, no expiry,
cash variance limit 100 baht, business-day cutoff hour 0. **They are the spec's suggestions, not decisions the owner made.**

Demo accounts (local only, `src/bootstrap/seed.ts`): back office `owner` and `manager`; production creates the owner from
`OWNER_USERNAME`, `OWNER_PASSWORD`, `OWNER_CODE` and never seeds demo data (`SEED_DEMO=0`).

## Not built yet

1. Purchase orders and "ใบคืนผู้ขาย" (receiving has no PO to compare against); lot and expiry tracking; weighed items.
2. Manual discounts at the till and the per-role cap (`discount.over_cap` exists as a permission, no screen uses it); coupons;
   member-tier promotions; promotions have no date window, weekday or priority yet (the spec asks for them).
3. Exchange screen at the till (the API takes `exchangeFor` on a sale, nothing in the POS sets it).
4. Receipt printing (ESC/POS over LAN), cash drawer and card terminal adapters, device config and the print queue.
   Receipts print through the browser today.
5. PDF and Excel export are CSV plus the browser's print dialog. No scheduled report emails.
6. Only PostgreSQL 18 (DBngin) has been tried; older majors are untested. `pg_dump` must be on PATH or set `PG_DUMP_PATH`.
7. Back-office screens are typechecked, built and clicked through, but have no component tests; the API has the tests.
8. Approver "รออนุมัติ" queue on the dashboard only counts open stock counts.

## Testing

Set `TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres` to run the same API suite on a real PostgreSQL (each test gets a throwaway database, dropped after); the default is in-memory PGlite. All pass on both.
The API is covered by `apps/api/src/*.spec.ts` (56 cases: rules, rollbacks, approvals, refunds, reports, permissions over HTTP, and the architecture rules).
Pricing is covered in `libs/shared/domain/src/lib/pricing.spec.ts` (all three promo kinds, set vs all, gifts,
premiums, bill threshold, member). Add a test there before changing pricing behaviour.
