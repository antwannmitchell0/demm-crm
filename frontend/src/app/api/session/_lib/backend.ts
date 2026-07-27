/**
 * Server-only fetch helper for the session routes.
 *
 * This is NOT a generic proxy. Only the four auth endpoints below may be
 * called, so a bug in a route handler cannot turn the BFF into an open relay
 * into the backend or the wider network.
 */
import { resolveBackendBaseUrl } from './config';

/**
 * The complete set of backend paths these routes may reach. Anything else
 * throws before a request is made.
 *
 * Note `api/auth/*`: the backend mounts AuthController at 'api/auth' while
 * every other controller is unprefixed. That inconsistency is load-bearing
 * (backend security suites hit these exact paths), so it is matched here
 * rather than "corrected".
 */
const ALLOWED_BACKEND_PATHS = [
  'api/auth/login',
  'api/auth/select-workspace',
  'api/auth/refresh',
  'api/auth/logout',
] as const;

export type AllowedBackendPath = (typeof ALLOWED_BACKEND_PATHS)[number];

const REQUEST_TIMEOUT_MS = 10_000;

export interface BackendResult {
  status: number;
  /** Parsed JSON body, or null when the backend returned a non-JSON payload. */
  data: Record<string, unknown> | null;
  /** True when the backend was unreachable or timed out. */
  transportFailed: boolean;
}

/**
 * Calls one allowlisted backend auth endpoint.
 *
 * Never logs the request body: every one of these carries either a password, a
 * pre-auth token, or a refresh token. Never surfaces the backend URL to the
 * caller either -- an internal hostname is not the browser's business.
 */
export async function callBackendAuth(
  path: AllowedBackendPath,
  init: { method: 'POST'; body?: unknown; bearerToken?: string },
): Promise<BackendResult> {
  if (!ALLOWED_BACKEND_PATHS.includes(path)) {
    throw new Error('Refusing to call a non-allowlisted backend path.');
  }

  const baseUrl = resolveBackendBaseUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    // Only headers this helper constructs are sent; nothing from the incoming
    // browser request is forwarded blindly.
    if (init.bearerToken) {
      headers.Authorization = `Bearer ${init.bearerToken}`;
    }

    const response = await fetch(`${baseUrl}/${path}`, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
      cache: 'no-store',
    });

    // The backend returns JSON for both success and error, but a proxy or an
    // unhandled crash can return HTML. Parse defensively so a non-JSON body
    // degrades into a clean status rather than throwing.
    let data: Record<string, unknown> | null = null;
    const raw = await response.text();
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        data =
          parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
      } catch {
        data = null;
      }
    }

    return { status: response.status, data, transportFailed: false };
  } catch {
    // Timeout or network failure. No error detail is echoed to the caller: it
    // could disclose the backend hostname or topology.
    return { status: 502, data: null, transportFailed: true };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Extracts a safe error message from a backend response.
 *
 * Backend validation errors are useful to the user ("email must be an email"),
 * but the raw body is never passed through wholesale -- it can contain echoed
 * input. Only a string/array `message` is surfaced.
 */
export function safeBackendError(result: BackendResult): string {
  if (result.transportFailed) return 'Authentication service is unavailable.';

  const message = result.data?.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message) && message.every((m) => typeof m === 'string')) {
    return message.join(', ');
  }
  return 'Request failed.';
}
