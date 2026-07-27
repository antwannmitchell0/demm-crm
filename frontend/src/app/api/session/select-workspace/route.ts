import { NextResponse, type NextRequest } from 'next/server';
import {
  guardStateChangingRequest,
  refreshCookieOptions,
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_MAX_AGE_SECONDS,
} from '../_lib/config';
import { callBackendAuth, safeBackendError } from '../_lib/backend';

/**
 * Step TWO of login: establishes the actual session.
 *
 * This is the security boundary of the whole BFF. The backend returns both an
 * access token and a refresh token; the refresh token is captured into a
 * first-party httpOnly cookie here and is NEVER included in the JSON handed
 * back to browser JavaScript.
 */
export async function POST(request: NextRequest) {
  const rejection = guardStateChangingRequest(request);
  if (rejection) {
    return NextResponse.json(rejection.body, { status: rejection.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const record = (body ?? {}) as Record<string, unknown>;
  const { preAuthToken, workspaceId } = record;

  if (typeof preAuthToken !== 'string' || typeof workspaceId !== 'string') {
    return NextResponse.json(
      { error: 'preAuthToken and workspaceId are required.' },
      { status: 400 },
    );
  }

  // Reject unknown extra properties rather than silently dropping them, mirroring
  // the backend ValidationPipe's forbidNonWhitelisted posture. A caller sending
  // e.g. a `userId` -- the shape of the old, removed account-takeover contract --
  // gets a clear 400 here instead of having it quietly ignored.
  const allowedKeys = new Set(['preAuthToken', 'workspaceId']);
  const unexpected = Object.keys(record).filter((k) => !allowedKeys.has(k));
  if (unexpected.length > 0) {
    return NextResponse.json(
      { error: `Unexpected field(s): ${unexpected.join(', ')}.` },
      { status: 400 },
    );
  }

  // The pre-auth token travels in the Authorization header, exactly as the
  // hardened backend requires; the body carries only workspaceId, which is the
  // sole property SelectWorkspaceDto accepts.
  const result = await callBackendAuth('api/auth/select-workspace', {
    method: 'POST',
    body: { workspaceId },
    bearerToken: preAuthToken,
  });

  if (result.status >= 400 || !result.data) {
    // No cookie is set on failure, so a rejected or expired pre-auth token
    // cannot leave a half-established session behind.
    return NextResponse.json(
      { error: safeBackendError(result) },
      { status: result.status >= 400 ? result.status : 502 },
    );
  }

  const refreshToken = result.data.refresh_token;
  if (typeof refreshToken !== 'string' || refreshToken === '') {
    return NextResponse.json(
      { error: 'Authentication service returned an unusable session.' },
      { status: 502 },
    );
  }

  // Everything EXCEPT the refresh token is returned to the browser.
  const response = NextResponse.json(
    {
      access_token: result.data.access_token ?? null,
      token_type: result.data.token_type ?? 'Bearer',
      expires_in: result.data.expires_in ?? null,
      user: result.data.user ?? null,
    },
    { status: 200 },
  );

  response.cookies.set({
    name: REFRESH_COOKIE_NAME,
    value: refreshToken,
    ...refreshCookieOptions(REFRESH_COOKIE_MAX_AGE_SECONDS),
  });

  return response;
}
