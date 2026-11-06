export const normalizePhone = (p: string): string => p.replace(/\D/g, '');
export const isValidPhone = (digits: string): boolean => /^0\d{8,9}$/.test(digits);
