/**
 * Server-only configuration for the first-party session (BFF) routes.
 *
 * Nothing here may be imported by client components: it resolves the backend
 * base URL and owns the refresh-token cookie contract. Files under `_lib` sit
 * in a private folder, so Next never routes them.
 */
import type { NextRequest } from 'next/server';

/**
 * Name of the single first-party refresh-token cookie.
 *
 * Scoped to `/api/session` so the browser only ever attaches it to these four
 * routes -- it is never sent with page navigations, static asset requests, or
 * any other API call.
 */
export const REFRESH_COOKIE_NAME = 'demm_crm_refresh';
export const REFRESH_COOKIE_PATH = '/api/session';

/**
 * Mirrors the backend's 7-day refresh-token lifetime (auth.service.ts issues
 * `new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)`). Keeping these aligned means
 * the cookie does not outlive the credential it carries.
 */
export const REFRESH_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export const isProduction = process.env.NODE_ENV === 'production';

export interface RefreshCookieOptions {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge?: number;
}

export function refreshCookieOptions(maxAge?: number): RefreshCookieOptions {
  return {
    // Unreadable from document.cookie -- the entire point of the BFF.
    httpOnly: true,
    // Lax still sends the cookie on top-level same-site navigation but not on
    // cross-site POSTs. It is a second line of defence only; Origin validation
    // below is the primary CSRF control.
    sameSite: 'lax',
    // Cloud Run terminates TLS, so production is always https. Left off in
    // local development so the cookie works over plain http.
    secure: isProduction,
    path: REFRESH_COOKIE_PATH,
    ...(maxAge === undefined ? {} : { maxAge }),
  };
}

/**
 * Resolves the backend base URL.
 *
 * Two sources, both referenced STATICALLY because Next only inlines literal
 * `process.env.X` references (a dynamic `process.env[name]` lookup is not
 * replaced at build time):
 *
 *  - `BACKEND_API_URL` -- server-only, read at runtime. Lets an operator point
 *    the BFF somewhere else without rebuilding the image.
 *  - `NEXT_PUBLIC_API_URL` -- inlined at build time by `next build`. This is
 *    what frontend/Dockerfile actually provides today (builder stage only), so
 *    the fallback keeps the routes working with the existing deployment
 *    pipeline unchanged.
 *
 * There is deliberately NO localhost default. A literal `http://localhost:...`
 * here would be compiled into `.next/standalone` and fail
 * scripts/verify-no-localhost-in-bundle.js, which scans the server bundle and
 * blocks any production build containing a loopback URL. Failing loudly on
 * missing configuration also matches verify-production-config.js's posture.
 */
export function resolveBackendBaseUrl(): string {
  const configured =
    process.env.BACKEND_API_URL || process.env.NEXT_PUBLIC_API_URL;

  if (!configured || configured.trim() === '') {
    throw new Error(
      'Backend API URL is not configured. Set BACKEND_API_URL (server-only, read at runtime) or NEXT_PUBLIC_API_URL (inlined at build time).',
    );
  }

  return configured.replace(/\/+$/, '');
}

/**
 * CSRF defence for every state-changing session route.
 *
 * SameSite=Lax alone is not sufficient, so each route independently verifies
 * the Origin header:
 *  - a missing Origin is REJECTED. Browsers send it on all cross-site requests
 *    and on same-origin `fetch`, so its absence means the caller is not the
 *    first-party app.
 *  - `ALLOWED_FRONTEND_ORIGINS` (comma-separated) is an explicit allowlist for
 *    deployments where the public origin differs from what the container sees.
 *  - otherwise the request's own origin is used, i.e. strict same-origin.
 *
 * `x-forwarded-host` is deliberately NOT consulted: it is attacker-controllable
 * unless a verified proxy strips and re-sets it, which is not established here.
 */
export function isTrustedOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;

  const allowlist = (process.env.ALLOWED_FRONTEND_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (allowlist.length > 0) return allowlist.includes(origin);

  // Default: compare the Origin header against the Host the client actually
  // addressed -- the OWASP-recommended same-origin check.
  //
  // `request.nextUrl.origin` is deliberately NOT used. It was tried first and
  // verified not to reflect the address the client used when served from the
  // standalone build, so every same-origin request was rejected. The same
  // mismatch would occur behind Cloud Run, where TLS is terminated upstream.
  //
  // Only HOST is compared, not scheme: TLS terminates at the load balancer, so
  // the browser's Origin is https while the request reaching this process is
  // http. Comparing scheme would reject every legitimate production request.
  //
  // `x-forwarded-host` remains deliberately unconsulted -- it is
  // attacker-settable without a verified proxy that strips and re-sets it.
  // A browser cannot forge the Origin header, which is what makes this a valid
  // CSRF control; a non-browser client could forge both, but such a caller can
  // simply talk to the backend directly and gains nothing here.
  const host = request.headers.get('host');
  if (!host) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Rejects anything that is not a JSON POST from a trusted origin. Returns null
 * when the request is acceptable.
 */
export function guardStateChangingRequest(
  request: NextRequest,
): { status: number; body: { error: string } } | null {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return {
      status: 415,
      body: { error: 'Content-Type must be application/json.' },
    };
  }

  if (!isTrustedOrigin(request)) {
    // Deliberately vague: do not disclose the allowlist or the expected origin.
    return { status: 403, body: { error: 'Request origin is not allowed.' } };
  }

  return null;
}
