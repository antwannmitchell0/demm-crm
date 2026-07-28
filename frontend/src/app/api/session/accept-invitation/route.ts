import { NextResponse, type NextRequest } from 'next/server';
import {
  guardStateChangingRequest,
  refreshCookieOptions,
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_MAX_AGE_SECONDS,
} from '../_lib/config';
import { callBackendAuth, safeBackendError } from '../_lib/backend';

/**
 * Accepting an invitation to a workspace you are not yet a member of.
 *
 * WHY THIS IS ONE SERVER-SIDE ROUTE AND NOT FOUR BROWSER CALLS
 *
 * A person invited to their first workspace holds no membership, so no access
 * token can be minted for them and the ordinary accept endpoint is unreachable.
 * Acceptance is instead authorized by a short-lived capability naming exactly
 * one invitation.
 *
 * That capability must never reach the browser. It is minted in the second hop
 * below and spent in the third, inside this handler, so it is never returned in
 * a body, never written to storage, never placed in a URL, and never visible to
 * client JavaScript. The pre-session token is handled the same way.
 *
 * The chain, all server-side:
 *
 *   1. login                      -> pre-session token (password verified)
 *   2. mint capability            -> names ONE invitation (2 minute lifetime)
 *   3. accept with the capability -> membership created, idempotently
 *   4. select-workspace           -> the real session, refresh token captured
 *                                    into the httpOnly cookie
 *
 * Step 4 can only succeed because step 3 created the membership. If step 3
 * reports that the account has no access -- an administrator removed them after
 * they used the link -- the chain STOPS there and no session is established.
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
  const { email, passwordPlain, token } = record;

  if (
    typeof email !== 'string' ||
    typeof passwordPlain !== 'string' ||
    typeof token !== 'string'
  ) {
    return NextResponse.json(
      { error: 'email, passwordPlain and token are required.' },
      { status: 400 },
    );
  }

  // Reject unknown properties rather than dropping them, mirroring the
  // backend's forbidNonWhitelisted posture. A caller trying to supply a userId,
  // invitationId, role or workspaceId gets a visible 400 instead of having the
  // attempt silently ignored.
  const allowedKeys = new Set(['email', 'passwordPlain', 'token']);
  const unexpected = Object.keys(record).filter((k) => !allowedKeys.has(k));
  if (unexpected.length > 0) {
    return NextResponse.json(
      { error: `Unexpected field(s): ${unexpected.join(', ')}.` },
      { status: 400 },
    );
  }

  // --- 1. Prove the password. -------------------------------------------
  const login = await callBackendAuth('api/auth/login', {
    method: 'POST',
    body: { email, passwordPlain },
  });
  if (login.status >= 400 || !login.data) {
    return NextResponse.json(
      { error: safeBackendError(login) },
      { status: login.status >= 400 ? login.status : 502 },
    );
  }
  const preAuthToken = login.data.preAuthToken;
  if (typeof preAuthToken !== 'string' || preAuthToken === '') {
    return NextResponse.json(
      { error: 'Authentication service returned an unusable response.' },
      { status: 502 },
    );
  }

  // --- 2. Exchange possession of the link for a capability. -------------
  const minted = await callBackendAuth(
    'api/auth/pre-session/invitation-capability',
    { method: 'POST', body: { token }, bearerToken: preAuthToken },
  );
  if (minted.status >= 400 || !minted.data) {
    return NextResponse.json(
      { error: safeBackendError(minted) },
      { status: minted.status >= 400 ? minted.status : 502 },
    );
  }
  const capabilityToken = minted.data.capabilityToken;
  if (typeof capabilityToken !== 'string' || capabilityToken === '') {
    return NextResponse.json(
      { error: 'Authentication service returned an unusable response.' },
      { status: 502 },
    );
  }

  // --- 3. Accept. No body: the capability carries both identifiers. -----
  const accepted = await callBackendAuth(
    'team/invitations/accept-pre-session',
    { method: 'POST', body: {}, bearerToken: capabilityToken },
  );
  if (accepted.status >= 400 || !accepted.data) {
    return NextResponse.json(
      { error: safeBackendError(accepted) },
      { status: accepted.status >= 400 ? accepted.status : 502 },
    );
  }

  const outcome = accepted.data.outcome ?? null;
  const hasAccess = accepted.data.hasAccess === true;
  const workspaceId = accepted.data.workspaceId;

  // Acceptance answers 200 for a link that was already consumed, and reports
  // hasAccess:false when the account was since removed. Establishing a session
  // for that workspace would drop somebody into a workspace they cannot open,
  // so the chain stops here and says so plainly.
  if (!hasAccess || typeof workspaceId !== 'string') {
    return NextResponse.json(
      { outcome, hasAccess: false, role: null, access_token: null, user: null },
      { status: 200 },
    );
  }

  // --- 4. Turn it into a real session. ----------------------------------
  const session = await callBackendAuth('api/auth/select-workspace', {
    method: 'POST',
    body: { workspaceId },
    bearerToken: preAuthToken,
  });
  if (session.status >= 400 || !session.data) {
    return NextResponse.json(
      { error: safeBackendError(session) },
      { status: session.status >= 400 ? session.status : 502 },
    );
  }

  const refreshToken = session.data.refresh_token;
  if (typeof refreshToken !== 'string' || refreshToken === '') {
    return NextResponse.json(
      { error: 'Authentication service returned an unusable session.' },
      { status: 502 },
    );
  }

  // Everything EXCEPT the refresh token, the pre-session token and the
  // capability is returned to the browser.
  const response = NextResponse.json(
    {
      outcome,
      hasAccess: true,
      role: accepted.data.role ?? null,
      access_token: session.data.access_token ?? null,
      token_type: session.data.token_type ?? 'Bearer',
      expires_in: session.data.expires_in ?? null,
      user: session.data.user ?? null,
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
