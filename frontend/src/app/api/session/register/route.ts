import { NextResponse, type NextRequest } from 'next/server';
import { guardStateChangingRequest } from '../_lib/config';
import { callBackendAuth, safeBackendError } from '../_lib/backend';

/**
 * Creating an account and founding a workspace.
 *
 * WHY THIS ROUTE EXISTS. Registration used to POST straight from browser
 * JavaScript to the backend origin, while login, refresh, logout, workspace
 * selection and invitation acceptance all went through this tier. So the one
 * request that carries a plaintext password AND creates a tenant was the one
 * request not covered by the origin guard, and part of the reason the backend
 * had to accept credential-bearing cross-origin POSTs from a browser at all.
 *
 * The inconsistency was the bug. A credential should reach the backend from the
 * server tier, over one origin, behind the same guard as every other
 * credential.
 *
 * NO COOKIE IS SET HERE. Registering is not signing in -- the caller still has
 * to log in and select a workspace, which is where a session actually begins.
 * Issuing one here would mean an account came into existence already
 * authenticated, with no second proof of the password.
 *
 * The body is never logged. It contains a password.
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
  const {
    email,
    passwordPlain,
    firstName,
    lastName,
    workspaceName,
    subdomain,
  } = record;

  if (
    typeof email !== 'string' ||
    typeof passwordPlain !== 'string' ||
    typeof firstName !== 'string' ||
    typeof lastName !== 'string' ||
    typeof workspaceName !== 'string' ||
    typeof subdomain !== 'string'
  ) {
    return NextResponse.json(
      {
        error:
          'email, passwordPlain, firstName, lastName, workspaceName and subdomain are required.',
      },
      { status: 400 },
    );
  }

  // Reject unknown properties rather than dropping them, mirroring the backend
  // ValidationPipe's forbidNonWhitelisted posture. An attempt to smuggle an
  // extra field -- a role, an organizationId -- is then a visible 400 here
  // instead of something quietly discarded one tier further in.
  const allowedKeys = new Set([
    'email',
    'passwordPlain',
    'firstName',
    'lastName',
    'workspaceName',
    'subdomain',
  ]);
  const unexpected = Object.keys(record).filter((k) => !allowedKeys.has(k));
  if (unexpected.length > 0) {
    return NextResponse.json(
      { error: `Unexpected field(s): ${unexpected.join(', ')}.` },
      { status: 400 },
    );
  }

  // Only the six fields RegisterDto accepts are forwarded, reconstructed
  // explicitly rather than spread, so nothing that arrived can ride along.
  const result = await callBackendAuth('api/auth/register', {
    method: 'POST',
    // Carries the CUSTOMER's opaque, signed rate-limit identity. Without it the
    // backend sees only this server's address and the per-client budget becomes
    // a product-wide cap -- measured: an unrelated client's FIRST registration
    // returned 429.
    forwardClientIdentityFrom: request,
    body: {
      email,
      passwordPlain,
      firstName,
      lastName,
      workspaceName,
      subdomain,
    },
  });

  if (result.status >= 400 || !result.data) {
    return NextResponse.json(
      { error: safeBackendError(result) },
      { status: result.status >= 400 ? result.status : 502 },
    );
  }

  return NextResponse.json(result.data, { status: 201 });
}
