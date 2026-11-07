import type { CartLine, ManualDiscount } from '@my-shop/contracts';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SaleRecord } from '../api/pos-api';

export interface HeldBill {
  id: string;
  at: string;
  lines: CartLine[];
  memberPhone: string | null;
  manualDiscount?: ManualDiscount | null;
  note: string;
}

interface CartState {
  lines: CartLine[];
  memberPhone: string | null;
  /** A discount the cashier gave by hand; the server decides whether it needs a supervisor. */
  manualDiscount: ManualDiscount | null;
  lastAddedProductId: string | null;
  /** Suggestions the customer declined on the offers screen, by promotion id. */
  skipped: string[];
  held: HeldBill[];
  lastSale: SaleRecord | null;
  add: (productId: string, qty?: number) => void;
  setQty: (productId: string, qty: number) => void;
  clear: () => void;
  attachMember: (phone: string) => void;
  detachMember: () => void;
  setManualDiscount: (discount: ManualDiscount | null) => void;
  skip: (promotionId: string) => void;
  hold: (note: string) => void;
  resume: (id: string) => boolean;
  deleteHeld: (id: string) => void;
  completeSale: (sale: SaleRecord) => void;
}

const emptyBill = { lines: [] as CartLine[], memberPhone: null, manualDiscount: null as ManualDiscount | null, lastAddedProductId: null, skipped: [] as string[] };

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      ...emptyBill,
      held: [],
      lastSale: null,
      add: (productId, qty = 1) =>
        set((s) => {
          const exists = s.lines.some((l) => l.productId === productId);
          const lines = exists
            ? s.lines.map((l) => (l.productId === productId ? { ...l, qty: l.qty + qty } : l))
            : [...s.lines, { productId, qty }];
          return { lines, lastAddedProductId: productId };
        }),
      setQty: (productId, qty) =>
        set((s) => {
          const lines = qty <= 0 ? s.lines.filter((l) => l.productId !== productId) : s.lines.map((l) => (l.productId === productId ? { ...l, qty } : l));
          // An empty bill starts over: a discount given to the last customer must not follow the next one.
          return lines.length === 0 ? { lines, manualDiscount: null } : { lines };
        }),
      clear: () => set({ ...emptyBill }),
      attachMember: (phone) => set({ memberPhone: phone }),
      detachMember: () => set({ memberPhone: null }),
      setManualDiscount: (manualDiscount) => set({ manualDiscount }),
      skip: (promotionId) => set((s) => ({ skipped: s.skipped.includes(promotionId) ? s.skipped : [...s.skipped, promotionId] })),
      hold: (note) =>
        set((s) =>
          s.lines.length === 0
            ? s
            : {
                ...emptyBill,
                held: [...s.held, { id: crypto.randomUUID(), at: new Date().toISOString(), lines: s.lines, memberPhone: s.memberPhone, manualDiscount: s.manualDiscount, note }],
              },
        ),
      resume: (id) => {
        const s = get();
        const bill = s.held.find((h) => h.id === id);
        if (!bill || s.lines.length > 0) return false;
        set({ ...emptyBill, lines: bill.lines, memberPhone: bill.memberPhone, manualDiscount: bill.manualDiscount ?? null, held: s.held.filter((h) => h.id !== id) });
        return true;
      },
      deleteHeld: (id) => set((s) => ({ held: s.held.filter((h) => h.id !== id) })),
      completeSale: (sale) => set({ ...emptyBill, lastSale: sale }),
    }),
    { name: 'myshop.pos.cart' },
  ),
);
