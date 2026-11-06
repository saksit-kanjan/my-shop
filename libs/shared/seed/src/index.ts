import type { Catalog, Employee } from '@my-shop/contracts';

const b = (n: number) => Math.round(n * 100);

/** Demo data until the NestJS API is ready. Mirrors the agreed design. */
export const demoCatalog: Catalog = {
  categories: [
    { id: 'drink', name: 'เครื่องดื่ม' },
    { id: 'food', name: 'ขนมและอาหาร' },
    { id: 'home', name: 'ของใช้' },
    { id: 'stationery', name: 'เครื่องเขียน' },
  ],
  products: [
    { id: 'water', sku: 'DR-0001', name: 'น้ำดื่ม 600 ml', categoryId: 'drink', price: b(10), memberPrice: b(9), barcodes: ['8850000000011'], imageKey: 'water' },
    { id: 'coffee', sku: 'DR-0002', name: 'กาแฟกระป๋อง', categoryId: 'drink', price: b(18), memberPrice: b(17), barcodes: ['8850000000028'], imageKey: 'coffee' },
    { id: 'tea', sku: 'DR-0003', name: 'ชาเขียวขวด', categoryId: 'drink', price: b(20), memberPrice: b(19), barcodes: ['8850000000035'], imageKey: 'tea' },
    { id: 'milk', sku: 'DR-0004', name: 'นมจืด 225 ml', categoryId: 'drink', price: b(14), memberPrice: b(13), barcodes: ['8850000000042'], imageKey: 'milk' },
    { id: 'bread', sku: 'FD-0001', name: 'ขนมปังโฮลวีท', categoryId: 'food', price: b(45), memberPrice: b(42), barcodes: ['8850000000059'], imageKey: 'bread' },
    { id: 'chips', sku: 'FD-0002', name: 'มันฝรั่งทอด', categoryId: 'food', price: b(20), memberPrice: b(19), barcodes: ['8850000000066'], imageKey: 'chips' },
    { id: 'biscuit', sku: 'FD-0003', name: 'บิสกิต', categoryId: 'food', price: b(15), memberPrice: b(14), barcodes: ['8850000000073'], imageKey: 'biscuit' },
    { id: 'soap', sku: 'HH-0001', name: 'สบู่ก้อน', categoryId: 'home', price: b(25), memberPrice: b(23), barcodes: ['8850000000080'], imageKey: 'soap' },
    { id: 'paste', sku: 'HH-0002', name: 'ยาสีฟัน', categoryId: 'home', price: b(39), memberPrice: b(37), barcodes: ['8850000000097'], imageKey: 'paste' },
    { id: 'tissue', sku: 'HH-0003', name: 'ทิชชู่ 6 ม้วน', categoryId: 'home', price: b(89), memberPrice: b(85), barcodes: ['8850000000103'], imageKey: 'tissue' },
    { id: 'pen', sku: 'ST-0001', name: 'ปากกาลูกลื่น', categoryId: 'stationery', price: b(12), memberPrice: b(12), barcodes: ['8850000000110'], imageKey: 'pen' },
    { id: 'battery', sku: 'HH-0004', name: 'ถ่าน AA 2 ก้อน', categoryId: 'home', price: b(35), memberPrice: b(33), barcodes: ['8850000000127'], imageKey: 'battery' },
  ],
  premiums: [{ id: 'brush', name: 'แปรงสีฟันพกพา', stock: 120 }],
  promotions: [
    { kind: 'qty', id: 'promo-chips', name: 'มันฝรั่งทอด 2 ชิ้น ชิ้นละ ฿15', productId: 'chips', minQty: 2, unitPrice: b(15), countMode: 'set' },
    { kind: 'qty', id: 'promo-biscuit', name: 'บิสกิต 2 ชิ้น ชิ้นละ ฿10', productId: 'biscuit', minQty: 2, unitPrice: b(10), countMode: 'set' },
    { kind: 'gift', id: 'promo-bread-milk', name: 'ซื้อขนมปัง แถมนมจืด', buyProductId: 'bread', buyQty: 1, gift: { type: 'product', productId: 'milk' }, giftQty: 1 },
    { kind: 'gift', id: 'promo-paste-brush', name: 'ซื้อยาสีฟัน แถมแปรงพกพา', buyProductId: 'paste', buyQty: 1, gift: { type: 'premium', premiumId: 'brush' }, giftQty: 1 },
    { kind: 'bogo', id: 'promo-tea', name: 'ชาเขียว 1 แถม 1', productId: 'tea', buyQty: 1, freeQty: 1 },
    { kind: 'bogo', id: 'promo-water', name: 'น้ำดื่ม 1 แถม 1', productId: 'water', buyQty: 1, freeQty: 1 },
    { kind: 'bill', id: 'promo-bill-200', name: 'ซื้อครบ ฿200 ลด ฿20', minAmount: b(200), discount: b(20) },
  ],
};

/** Employee codes are 6-digit secrets. */
export const demoEmployees: Employee[] = [
  { id: 'E001', code: '100123', name: 'สมชาย', initials: 'สช', role: 'cashier' },
  { id: 'E002', code: '200456', name: 'วิภา', initials: 'วภ', role: 'cashier' },
  { id: 'E003', code: '300789', name: 'ปรีชา', initials: 'ปช', role: 'supervisor' },
];
