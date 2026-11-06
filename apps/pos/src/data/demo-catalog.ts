export { demoCatalog, demoEmployees } from '@my-shop/seed';

export const storeInfo = {
  storeName: 'My Shop',
  branchName: '[ชื่อสาขา]',
  taxId: '[เลขผู้เสียภาษี 13 หลัก]',
  terminalId: (import.meta.env.VITE_TERMINAL_ID as string | undefined) ?? 'T01',
};
