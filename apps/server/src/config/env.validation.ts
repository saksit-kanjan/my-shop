/** Checks the environment when the server starts, so a missing secret stops it at once instead of failing on the first login. */
export function validateEnv(env: Record<string, unknown>): Record<string, unknown> {
  const port = env['PORT'] === undefined ? 3000 : Number(env['PORT']);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a number from 1 to 65535.');
  const url = env['DATABASE_URL'];
  const secret = env['CODE_SECRET'];
  // With a real PostgreSQL the employee-code hashes must be keyed by a secret that never changes.
  if (url && !secret) throw new Error('Set CODE_SECRET when DATABASE_URL is set: it keys the employee code hashes and must never change.');
  const cutoff = env['BUSINESS_DAY_CUTOFF_HOUR'];
  if (cutoff !== undefined && cutoff !== '' && !(Number.isInteger(Number(cutoff)) && Number(cutoff) >= 0 && Number(cutoff) <= 23)) throw new Error('BUSINESS_DAY_CUTOFF_HOUR must be 0 to 23.');
  return { ...env, PORT: port, CODE_SECRET: secret ?? 'dev-only-secret-change-me' };
}
