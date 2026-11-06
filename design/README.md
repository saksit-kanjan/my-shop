# Design reference

Screens designed in claude.ai, exported as the original `.dc.html` files. They are the visual source
of truth: copy their layout, spacing, copy text and Tailwind/daisyUI classes into React.

## How to read a `.dc.html` file

- Markup uses Tailwind v4 + daisyUI 5 classes, same as the apps. The `myshop` theme tokens are already in
  `libs/ui/src/theme.css`; do not re-declare them.
- `<sc-for list="{{rows}}" as="r">` is a loop, `<sc-if value="{{flag}}">` is a condition, `{{x}}` is a binding.
  Convert them to `.map()`, `{flag && …}` and JSX expressions.
- The `<script type="text/x-dc">` block at the bottom has `renderVals()`. That is **sample data and demo
  logic only**. Take the shape, not the numbers; real data comes from `@my-shop/domain` and the API.
- `@@…@@`, `./support.js` and `/_blob/…` URLs are artifacts of the design tool. Ignore them.
- `.pimg .p-water` etc. is the demo product picture sprite (`assets/products-sprite.svg`, already wired in
  `libs/ui`). Real products will use uploaded photos.
- `canvas.json` lists every screen with its position on the design canvas; row order = flow order.

## Screen map

| Design file | Becomes | Status |
| --- | --- | --- |
| `Main` | POS `/login` | done |
| `OpenShift` | POS `/open-shift` | done |
| `Sale` | POS `/sale` | done |
| `Offers` | POS `/offers` | done |
| `Payment` | POS `/payment` | done |
| `Success` | POS `/success` | done |
| `Held` | POS `/held` | done |
| `CashMove` | POS `/cash` | done |
| `CloseShift`, `ZReport` | POS `/close-shift`, `/z-report` | done |
| `Refund` | POS `/refund` (void and refund, supervisor code) | done |
| `CdIdle`, `CdCart`, `CdOffers`, `CdPay`, `CdThanks` | `apps/customer-display` screens | done |
| `CdOffers3`, `CdOffers4` | same screen with 3 or 4 bags, for checking `countMode: 'set'` | reference |
| `PromoExamples` | the two counting rules side by side | reference |
| `Backoffice` (dashboard) | `apps/backoffice` | done (screens re-laid out as one app) |
| `BoProducts`, `BoProductEdit` | back office products | done (screens re-laid out as one app) |
| `BoPromos` | back office promotions (qty price, buy A get B, 1 get 1, premium gifts) | done (screens re-laid out as one app) |
| `BoReceive`, `BoCount` | back office receiving and stock count | done (screens re-laid out as one app) |
| `BoDayClose`, `BoReport`, `BoUsers` | back office day close, reports, users and roles | done (screens re-laid out as one app) |

Built without a design (so look at them before relying on the layout): sales documents (search, reprint), members, stock levels, store settings and backup, audit log, reports tabs.

## Full written spec

The exported design document is `design/spec.md` (roles and permission matrix, payments, voids and
refunds, shifts, stock rules, member points, tax documents, reports, entities).
