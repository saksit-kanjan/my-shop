import type { Employee } from '@my-shop/contracts';

/** The signed-in user at a terminal. */
export interface Session {
  token: string;
  employee: Employee;
  terminalId: string;
}

/** Terminal id of back-office sessions. */
export const BACK_OFFICE_TERMINAL = 'BO';

/** The request after the auth guard attached the session. */
export interface AuthedRequest {
  headers: Record<string, string | string[] | undefined>;
  session: Session;
}
