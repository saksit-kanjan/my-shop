export { BACK_OFFICE_TERMINAL, type Session } from '../../common/interfaces/session';

/** A till session ends after this long with no request. */
export const IDLE_LOGOUT_MS = 8 * 3_600_000;

export const isIdle = (lastSeen: Date, now: Date): boolean => now.getTime() - lastSeen.getTime() > IDLE_LOGOUT_MS;
