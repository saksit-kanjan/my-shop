/** Wrong-code lockout, shared by the till login, the approval dialog and the back-office login (CLAUDE.md rule 8). */
export const MAX_FAILS = 5;
export const LOCK_SECONDS = 30;

export interface AttemptState {
  fails: number;
  lockedUntil: Date | null;
}

/** Seconds left on a lock, or 0 when the key may try. */
export function lockedFor(state: AttemptState | null, now: Date): number {
  if (!state?.lockedUntil || state.lockedUntil <= now) return 0;
  return Math.ceil((state.lockedUntil.getTime() - now.getTime()) / 1000);
}

/** The state after one more wrong code. A lock that has run out starts the count again. */
export function afterFailure(state: AttemptState | null, now: Date): AttemptState {
  const expired = !!state?.lockedUntil && state.lockedUntil <= now;
  const fails = (state && !expired ? state.fails : 0) + 1;
  return { fails, lockedUntil: fails >= MAX_FAILS ? new Date(now.getTime() + LOCK_SECONDS * 1000) : null };
}
