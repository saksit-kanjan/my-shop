# My Shop

Nx monorepo for the shop's on-prem POS.

| Path | What |
| --- | --- |
| `apps/pos` | POS for cashiers (React + Vite + daisyUI) |
| `apps/api` | NestJS API: login, shifts, sales, stock ledger (PostgreSQL, or embedded PGlite for dev) |
| `apps/backoffice` | Back office at `/admin/`: catalog, promotions, receiving, stock count, day close, reports, users |
| `apps/customer-display` | Customer-facing second screen, served under `/display/` |
| `libs/shared/contracts` | Shared types and the display channel messages |
| `libs/shared/domain` | Money, VAT and the promotion engine (unit tested) |
| `libs/shared/seed` | Demo catalog and employees |
| `libs/ui` | Shared components and the daisyUI theme |
| `tools/serve-dist.mjs` | Serves both built apps on one origin for on-prem testing |

```bash
npm install            # .npmrc sets legacy-peer-deps
npx nx serve api       # http://localhost:3000/api (embedded Postgres, demo data)
npx nx serve pos       # http://localhost:4200 (proxies /api)
npx nx serve backoffice  # http://localhost:4202/admin/
npx nx serve customer-display   # then open http://localhost:4200/display/ on the second screen
npx nx run-many -t test
```

Demo till codes: 100123 (สมชาย, cashier), 200456 (วิภา, cashier), 300789 (ปรีชา, supervisor). Back-office demo accounts are in `apps/api/src/seed.ts` (local only).
Build the POS with `VITE_API_URL=local` to run it on browser-only demo data without the API.
