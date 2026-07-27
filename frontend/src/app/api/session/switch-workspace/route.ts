import { NextResponse, type NextRequest } from 'next/server';
import {
  guardStateChangingRequest,
  refreshCookieOptions,
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_MAX_AGE_SECONDS,
} from '../_lib/config';
import { callBackendAuth, safeBackendError } from '../_lib/backend';

/**
 * Moves an established session into another workspace, with no password.
 *
 * Previously switching workspace meant a full re-login: the only way to mint a
 * workspace-bound session was `select-workspace`, which needs the pre-auth
 * token that only a password produces. The backend now exposes
 * `switch-workspace`, which spends the CURRENT refresh token and issues a
 * session for the requested workspace after re-checking membership.
 *
 * The refresh token is read only from the httpOnly cookie -- never from the
 * body -- so browser JavaScript cannot supply, observe, or influence which
 * session is being moved. The body carries workspaceId and nothing else.
 *
 * Failure handling mirrors /refresh rather than /select-workspace, because this
 * route SPENDS the cookie's token: on a 401 that token is already gone
 * backend-side, so the cookie is cleared instead of being left to replay.
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
  const { workspaceId } = record;

  if (typeof workspaceId !== 'string' || workspaceId === '') {
    return NextResponse.json(
      { error: 'workspaceId is required.' },
      { status: 400 },
    );
  }

  // Reject unknown extra properties rather than silently dropping them,
  // mirroring the backend ValidationPipe's forbidNonWhitelisted posture. In
  // particular a caller passing `refreshToken` is trying to move a session
  // other than the one this browser holds, and must be refused loudly.
  const unexpected = Object.keys(record).filter((k) => k !== 'workspaceId');
  if (unexpected.length > 0) {
    return NextResponse.json(
      { error: `Unexpected field(s): ${unexpected.join(', ')}.` },
      { status: 400 },
    );
  }

  const refreshToken = request.cookies.get(REFRESH_COOKIE_NAME)?.value;
  if (!refreshToken) {
    return NextResponse.json({ error: 'No active session.' }, { status: 401 });
  }

  const result = await callBackendAuth('api/auth/switch-workspace', {
    method: 'POST',
    body: { refreshToken, workspaceId },
  });

  if (result.status === 401 || result.status === 403) {
    const response = NextResponse.json(
      { error: 'Session expired. Please sign in again.' },
      { status: 401 },
    );
    response.cookies.set({
      name: REFRESH_COOKIE_NAME,
      value: '',
      ...refreshCookieOptions(0),
    });
    return response;
  }

  if (result.status >= 400 || !result.data) {
    // Upstream/transport failure: the claim may not have been made at all, so
    // the cookie is left alone rather than logging the user out over a blip.
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

  // The presented token is spent backend-side; keeping it would arm a false
  // replay signal on the next refresh.
  response.cookies.set({
    name: REFRESH_COOKIE_NAME,
    value: rotated,
    ...refreshCookieOptions(REFRESH_COOKIE_MAX_AGE_SECONDS),
  });

  return response;
}
