/** A close whose cash difference passes the store's limit needs a note and a supervisor's code. */
export const needsVarianceApproval = (variance: number, limit: number): boolean => Math.abs(variance) > limit;
