import type { Promotion } from '@my-shop/contracts';
import { DomainError } from '../../common/errors/domain-error';

const positive = (n: unknown, message: string) => {
  if (!Number.isInteger(n) || (n as number) <= 0) throw new DomainError('invalid', message);
};

/**
 * Checks the numbers of a promotion and returns what it points at, so the application layer can confirm those exist.
 * The pricing itself lives in libs/shared/domain (`priceCart`), which must stay the only place prices are computed.
 */
export function checkPromotion(p: Promotion): { productIds: string[]; premiumIds: string[] } {
  if (!p?.id?.trim() || !p.name?.trim()) throw new DomainError('invalid', 'ใส่ชื่อโปรโมชัน');
  switch (p.kind) {
    case 'qty':
      positive(p.minQty, 'จำนวนขั้นต่ำต้องมากกว่า 0');
      if (!Number.isInteger(p.unitPrice) || p.unitPrice < 0) throw new DomainError('invalid', 'ราคาโปรไม่ถูกต้อง');
      if (p.countMode !== 'set' && p.countMode !== 'all') throw new DomainError('invalid', 'เลือกวิธีนับโปร');
      return { productIds: [p.productId], premiumIds: [] };
    case 'gift':
      positive(p.buyQty, 'จำนวนที่ต้องซื้อต้องมากกว่า 0');
      positive(p.giftQty, 'จำนวนของแถมต้องมากกว่า 0');
      return p.gift.type === 'product' ? { productIds: [p.buyProductId, p.gift.productId], premiumIds: [] } : { productIds: [p.buyProductId], premiumIds: [p.gift.premiumId] };
    case 'bogo':
      positive(p.buyQty, 'จำนวนที่ต้องซื้อต้องมากกว่า 0');
      positive(p.freeQty, 'จำนวนที่แถมต้องมากกว่า 0');
      return { productIds: [p.productId], premiumIds: [] };
    case 'bill':
      positive(p.minAmount, 'ยอดขั้นต่ำต้องมากกว่า 0');
      positive(p.discount, 'ส่วนลดต้องมากกว่า 0');
      if (p.discount >= p.minAmount) throw new DomainError('invalid', 'ส่วนลดต้องน้อยกว่ายอดขั้นต่ำ');
      return { productIds: [], premiumIds: [] };
    default:
      throw new DomainError('invalid', 'ประเภทโปรโมชันไม่ถูกต้อง');
  }
}
