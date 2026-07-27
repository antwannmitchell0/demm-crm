import { NextResponse, type NextRequest } from 'next/server';
import {
  guardStateChangingRequest,
  refreshCookieOptions,
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_MAX_AGE_SECONDS,
} from '../_lib/config';
import { callBackendAuth, safeBackendError } from '../_lib/backend';

/**
 * Exchanges the httpOnly refresh cookie for a fresh access token.
 *
 * The refresh token is read ONLY from the cookie -- never from the request
 * body -- so browser JavaScript cannot supply, observe, or influence it.
 *
 * On a backend 401 the cookie is cleared and a generic failure is returned. The
 * backend distinguishes unknown / expired / revoked-and-replayed internally
 * (replay triggers T6 session-family revocation), but that distinction is
 * deliberately NOT surfaced here: telling a caller which one occurred would
 * turn this route into an oracle. There is no automatic retry -- a retry would
 * present an already-consumed token and, post-T6, look exactly like a replay.
 */
export async function POST(request: NextRequest) {
  const rejection = guardStateChangingRequest(request);
  if (rejection) {
    return NextResponse.json(rejection.body, { status: rejection.status });
  }

  const refreshToken = request.cookies.get(REFRESH_COOKIE_NAME)?.value;
  if (!refreshToken) {
    return NextResponse.json({ error: 'No active session.' }, { status: 401 });
  }

  const result = await callBackendAuth('api/auth/refresh', {
    method: 'POST',
    body: { refreshToken },
  });

  if (result.status === 401 || result.status === 403) {
    const response = NextResponse.json(
      { error: 'Session expired. Please sign in again.' },
      { status: 401 },
    );
    // Clear with the SAME name/path/flags used when setting, or the browser
    // keeps the dead cookie and every later refresh replays a revoked token.
    response.cookies.set({
      name: REFRESH_COOKIE_NAME,
      value: '',
      ...refreshCookieOptions(0),
    });
    return response;
  }

  if (result.status >= 400 || !result.data) {
    // Upstream/transport failure: leave the cookie alone. The session may still
    // be perfectly valid and clearing it would log the user out over a blip.
    return NextResponse.json(
      { error: safeBackendError(result) },
      { status: result.status >= 400 ? result.status : 502 },
    );
  }

  const rotated = result.data.refresh_token;
  if (typeof rotated !== 'string' || rotated === '') {
    return NextResponse.json(
      { error: 'Authentication service returned an unusable session.' },
      { status: 502 },
    );
  }

  const response = NextResponse.json(
    {
      access_token: result.data.access_token ?? null,
      token_type: result.data.token_type ?? 'Bearer',
      expires_in: result.data.expires_in ?? null,
      user: result.data.user ?? null,
    },
    { status: 200 },
  );

  // Replace the cookie with the rotated token. The previous value is now
  // revoked backend-side, so keeping it would arm a false replay signal.
  response.cookies.set({
    name: REFRESH_COOKIE_NAME,
    value: rotated,
    ...refreshCookieOptions(REFRESH_COOKIE_MAX_AGE_SECONDS),
  });

  return response;
}
