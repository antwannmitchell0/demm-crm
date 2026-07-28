import { NextResponse, type NextRequest } from 'next/server';
import { guardStateChangingRequest } from '../_lib/config';
import { callBackendAuth, safeBackendError } from '../_lib/backend';

/**
 * Creating an account for somebody holding an invitation link.
 *
 * Same reason as ../register/route.ts: this carries a plaintext password, and a
 * credential should reach the backend from the server tier, behind the origin
 * guard, rather than cross-origin from browser JavaScript.
 *
 * It additionally carries the RAW INVITATION TOKEN, which is a bearer secret in
 * its own right -- possession of it plus a matching address is what authorizes
 * joining a workspace. Keeping it on one origin means it is not exposed to
 * whatever CORS posture the backend has to maintain for other callers.
 *
 * NO workspaceName, NO subdomain, unlike ../register. Those two fields are what
 * make ordinary registration found an Organization and a Workspace, and this
 * person is joining an existing one. Their absence is the contract, so they are
 * rejected here rather than forwarded and ignored.
 *
 * NO COOKIE IS SET. Registering is not joining: the invitation still has to be
 * accepted, which is a separate, auditable act handled by
 * ../accept-invitation/route.ts.
 *
 * The body is never logged. It contains a password and an invitation token.
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
  const { token, email, passwordPlain, firstName, lastName } = record;

  if (
    typeof token !== 'string' ||
    typeof email !== 'string' ||
    typeof passwordPlain !== 'string' ||
    typeof firstName !== 'string' ||
    typeof lastName !== 'string'
  ) {
    return NextResponse.json(
      {
        error:
          'token, email, passwordPlain, firstName and lastName are required.',
      },
      { status: 400 },
    );
  }

  // Reject unknown properties rather than dropping them, mirroring the backend
  // ValidationPipe's forbidNonWhitelisted posture. This is the tier where an
  // attempt to supply a userId, invitationId, role or workspaceId becomes a
  // visible 400 instead of something silently discarded further in.
  const allowedKeys = new Set([
    'token',
    'email',
    'passwordPlain',
    'firstName',
    'lastName',
  ]);
  const unexpected = Object.keys(record).filter((k) => !allowedKeys.has(k));
  if (unexpected.length > 0) {
    return NextResponse.json(
      { error: `Unexpected field(s): ${unexpected.join(', ')}.` },
      { status: 400 },
    );
  }

  // Only the five fields RegisterInvitedDto accepts are forwarded,
  // reconstructed explicitly rather than spread, so nothing that arrived can
  // ride along.
  const result = await callBackendAuth('api/auth/register-invited', {
    method: 'POST',
    body: { token, email, passwordPlain, firstName, lastName },
  });

  if (result.status >= 400 || !result.data) {
    return NextResponse.json(
      { error: safeBackendError(result) },
      { status: result.status >= 400 ? result.status : 502 },
    );
  }

  // Both CREATED and ALREADY_REGISTERED are successes and the `outcome` field
  // carries the distinction, so the backend's own 2xx is passed through rather
  // than reinvented here.
  return NextResponse.json(result.data, {
    status: result.status >= 200 && result.status < 300 ? result.status : 200,
  });
}
