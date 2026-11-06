# My Shop

Nx monorepo for the shop's on-prem POS.

| Path | What |
| --- | --- |
| `apps/pos` | POS for cashiers (React + Vite + daisyUI) |
| `apps/server` | The API only (NestJS, JSON under `/api`) on PostgreSQL, or embedded PGlite for dev |
| `apps/backoffice` | Back office at `/admin/`: catalog, promotions, receiving, stock count, day close, reports, users |
| `apps/customer-display` | Customer-facing second screen, served under `/display/` |
| `libs/shared/contracts` | Shared types and the display channel messages |
| `libs/shared/domain` | Money, VAT and the promotion engine (unit tested) |
| `libs/shared/seed` | Demo catalog and employees |
| `libs/ui` | Shared components and the daisyUI theme |

```bash
pnpm install          # pnpm 10+; build scripts of esbuild and nx are allowed in pnpm-workspace.yaml
pnpm nx serve server    # http://localhost:3000/api (JSON only)
pnpm nx serve pos       # http://localhost:4200 (proxies /api)
pnpm nx serve backoffice  # http://localhost:4202/admin/
pnpm nx serve customer-display   # then open http://localhost:4200/display/ on the second screen
pnpm nx run-many -t test
```

Demo till codes: 100123 (สมชาย, cashier), 200456 (วิภา, cashier), 300789 (ปรีชา, supervisor). Back-office demo accounts are in `apps/server/src/database/demo.seed.ts` (local only).
Build the POS with `VITE_API_URL=local` to run it on browser-only demo data without the API.
