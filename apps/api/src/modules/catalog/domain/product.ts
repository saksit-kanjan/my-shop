import type { Product, Satang } from '@my-shop/contracts';
import { DomainError } from '../../../shared/kernel/domain-error';

/** A product as the back office sees it: the shelf data plus cost and the reorder point. Stock is the inventory context's. */
export interface ProductRecord extends Product {
  cost: Satang;
  reorderPoint: number;
  active: boolean;
}

export interface ProductInput {
  sku: string;
  name: string;
  categoryId: string;
  price: number;
  memberPrice: number;
  cost?: number;
  reorderPoint?: number;
  barcodes?: string[];
  imageKey?: string;
  active?: boolean;
}

const isSatang = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0;

export function assertValidProduct(input: ProductInput): void {
  if (!input.sku?.trim() || !input.name?.trim()) throw new DomainError('invalid', 'ใส่รหัสสินค้าและชื่อสินค้า');
  if (!isSatang(input.price) || !isSatang(input.memberPrice)) throw new DomainError('invalid', 'ราคาต้องเป็นจำนวนเงินที่ไม่ติดลบ');
  if (input.memberPrice > input.price) throw new DomainError('invalid', 'ราคาสมาชิกต้องไม่สูงกว่าราคาปกติ');
  if (input.cost !== undefined && !isSatang(input.cost)) throw new DomainError('invalid', 'ต้นทุนไม่ถูกต้อง');
}

/** Only the owner may set or see cost (spec: "ดูต้นทุนและกำไร"); anyone else keeps what is stored. */
export const costToStore = (input: ProductInput, stored: number | undefined, canSeeCost: boolean): number => (canSeeCost && input.cost !== undefined ? input.cost : stored ?? 0);

export const cleanBarcodes = (codes: string[]): string[] => [...new Set(codes.map((c) => c.trim()).filter(Boolean))];
