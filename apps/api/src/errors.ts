export type ErrorCode = 'invalid' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'locked';

/** A business-rule failure with a message the cashier can act on (Thai, per CLAUDE.md rule 10). */
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const HTTP_STATUS: Record<ErrorCode, number> = { invalid: 400, unauthorized: 401, forbidden: 403, not_found: 404, conflict: 409, locked: 423 };
