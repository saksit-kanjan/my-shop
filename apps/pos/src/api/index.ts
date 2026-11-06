import { createHttpPosApi } from './http-pos-api';
import { localPosApi } from './local-pos-api';
import type { PosApi } from './pos-api';

/**
 * VITE_API_URL unset  -> the shop server at /api (same origin, like production).
 * VITE_API_URL=local  -> browser-only demo data, no server needed.
 * VITE_API_URL=<url>  -> a server somewhere else.
 */
const setting = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

export const api: PosApi = setting === 'local' ? localPosApi : createHttpPosApi(setting);
export { SESSION_EXPIRED_EVENT } from './http-pos-api';
