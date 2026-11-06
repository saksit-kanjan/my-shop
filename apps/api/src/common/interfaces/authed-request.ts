import type { Session } from './session';

/** The request after `AuthGuard` has attached the session. */
export interface AuthedRequest {
  headers: Record<string, string | string[] | undefined>;
  session: Session;
}
