import type { Employee } from '@my-shop/contracts';

/** The signed-in principal at a terminal. Identity creates it; every context's controllers read it from the request. */
export interface Session {
  token: string;
  employee: Employee;
  terminalId: string;
}

/** Terminal id used by back-office sessions. */
export const BACK_OFFICE_TERMINAL = 'BO';
