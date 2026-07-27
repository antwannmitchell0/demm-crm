import { NextResponse, type NextRequest } from 'next/server';
import {
  guardStateChangingRequest,
  refreshCookieOptions,
  REFRESH_COOKIE_NAME,
} from '../_lib/config';
import { callBackendAuth } from '../_lib/backend';

/**
 * Ends the session.
 *
 * Idempotent by design: the cookie is cleared no matter what the backend says,
 * including when there was no cookie at all or the token was already revoked.
 * A logout that reports failure just leaves users stuck with a credential they
 * asked to destroy.
 *
 * Only single-session logout is implemented here. Logout-all is a deliberate
 * T8 concern -- it needs an access token and belongs with session
 * orchestration.
 */
export async function POST(request: NextRequest) {
  const rejection = guardStateChangingRequest(request);
  if (rejection) {
    return NextResponse.json(rejection.body, { status: rejection.status });
  }

  const refreshToken = request.cookies.get(REFRESH_COOKIE_NAME)?.value;

  if (refreshToken) {
    // Best-effort backend revocation. Its outcome is intentionally not checked:
    // whether it succeeds, 401s on an already-revoked token, or the service is
    // unreachable, this browser's session still ends.
    await callBackendAuth('api/auth/logout', {
      method: 'POST',
      body: { refreshToken },
    });
  }

  const response = NextResponse.json({ status: 'SUCCESS' }, { status: 200 });

  // Same name/path/flags as when set, otherwise the browser keeps the cookie.
  response.cookies.set({
    name: REFRESH_COOKIE_NAME,
    value: '',
    ...refreshCookieOptions(0),
  });

  return response;
}
