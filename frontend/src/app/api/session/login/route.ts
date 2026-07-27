import { NextResponse, type NextRequest } from 'next/server';
import { guardStateChangingRequest } from '../_lib/config';
import { callBackendAuth, safeBackendError } from '../_lib/backend';

/**
 * Step ONE of the two-step login.
 *
 * Forwards credentials to the backend server-side and returns the short-lived
 * `preAuthToken` plus the workspace list. NO refresh-token cookie is set here:
 * a pre-auth token cannot create a session on its own -- it only authorizes
 * workspace selection, which is where the real session begins.
 *
 * Credentials are never logged.
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

  const { email, passwordPlain } = (body ?? {}) as Record<string, unknown>;
  if (typeof email !== 'string' || typeof passwordPlain !== 'string') {
    return NextResponse.json(
      { error: 'email and passwordPlain are required.' },
      { status: 400 },
    );
  }

  // Only the two fields the backend DTO accepts are forwarded, so an unknown
  // extra property from the browser can never reach the backend and trip its
  // forbidNonWhitelisted validation (or worse, be honoured).
  const result = await callBackendAuth('api/auth/login', {
    method: 'POST',
    body: { email, passwordPlain },
  });

  if (result.status >= 400 || !result.data) {
    return NextResponse.json(
      { error: safeBackendError(result) },
      { status: result.status >= 400 ? result.status : 502 },
    );
  }

  return NextResponse.json(
    {
      preAuthToken: result.data.preAuthToken ?? null,
      user: result.data.user ?? null,
      workspaces: result.data.workspaces ?? [],
    },
    { status: 200 },
  );
}
