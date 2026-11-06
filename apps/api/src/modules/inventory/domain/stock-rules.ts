/** Kinds of ledger rows. Stock is only ever the sum of these; nobody edits a balance (spec: "ไม่มีการแก้ตัวเลขคงเหลือตรง ๆ"). */
export type MovementKind =
  | 'opening' | 'receive' | 'sale' | 'void' | 'refund' | 'waste' | 'count' | 'premium'
  | 'adjust_waste' | 'adjust_lost' | 'adjust_expired' | 'adjust_other';

export type AdjustReason = 'waste' | 'lost' | 'expired' | 'other';
export const ADJUST_REASONS: AdjustReason[] = ['waste', 'lost', 'expired', 'other'];

/** A good's average cost after a receipt: weighted over what is on hand. With nothing (or negative) on hand the new cost stands. */
export function weightedAverageCost(onHand: number, currentCost: number, receivedQty: number, unitCost: number): number {
  const held = Math.max(0, onHand);
  return Math.round((held * currentCost + receivedQty * unitCost) / (held + receivedQty));
}

/** A stock count's difference: what was counted against the ledger balance now (snapshot plus everything that moved since). */
export const countDifference = (counted: number, balanceNow: number): number => counted - balanceNow;

export const isLow = (stock: number, reorderPoint: number): boolean => reorderPoint > 0 && stock <= reorderPoint;
