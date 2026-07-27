// T8 — automated tests for browser session orchestration logic.
//
// Scope note, stated plainly: this file runs in ONE Node process, so it proves
// the SAME-TAB guarantees only -- single flight, the one-retry limit, and
// session clearing. Cross-tab behaviour (BroadcastChannel, Web Locks, logout
// propagation, reload restoration) is NOT provable here and is verified
// separately in a real browser with real tabs; see the T8 report.
import * as sessionClient from './src/lib/session/client';

let pass = 0;
let fail = 0;
function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`✅ [PASS] ${label}`);
    pass++;
  } else {
    console.log(`❌ [FAIL] ${label}`);
    fail++;
  }
}

interface FetchCall {
  url: string;
  headers: Record<string, string>;
}
let calls: FetchCall[] = [];
let refreshResponder: () => { status: number; body: unknown } = () => ({
  status: 200,
  body: {
    access_token: 'ACCESS_NEW',
    expires_in: 900,
    user: { id: 'u1', workspaceId: 'ws1' },
  },
});
let protectedResponder: (headers: Record<string, string>) => number = () => 200;

function installFetchStub() {
  calls = [];
  (globalThis as unknown as { fetch: unknown }).fetch = async (
    input: string,
    init?: { headers?: Record<string, string> },
  ) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, headers });

    if (url.includes('/api/session/refresh')) {
      // Small delay so genuinely concurrent callers overlap.
      await new Promise((r) => setTimeout(r, 25));
      const { status, body } = refreshResponder();
      return {
        status,
        ok: status < 400,
        json: async () => body,
      } as unknown as Response;
    }

    if (url.includes('/api/session/logout')) {
      return { status: 200, ok: true, json: async () => ({}) } as Response;
    }

    const status = protectedResponder(headers);
    return {
      status,
      ok: status < 400,
      json: async () => ({ message: status === 401 ? 'Unauthorized' : 'ok' }),
    } as unknown as Response;
  };
}

async function main() {
  console.log('🧪 T8 SESSION ORCHESTRATION SUITE (same-tab guarantees)');
  console.log('=======================================================');
  installFetchStub();

  // --- 1. Same-tab single flight -------------------------------------------
  const results = await Promise.all([
    sessionClient.refreshSession(),
    sessionClient.refreshSession(),
    sessionClient.refreshSession(),
    sessionClient.refreshSession(),
    sessionClient.refreshSession(),
  ]);
  const refreshCalls = calls.filter((c) =>
    c.url.includes('/api/session/refresh'),
  ).length;
  check(
    `1. Five concurrent refreshes issue exactly ONE network refresh (observed ${refreshCalls})`,
    refreshCalls === 1,
  );
  check(
    '2. All concurrent callers receive the same successful result',
    results.every((r) => r === true),
  );
  check(
    '3. The access token is held in memory after refresh',
    sessionClient.getAccessToken() === 'ACCESS_NEW',
  );
  check(
    '4. No refresh remains in flight once settled',
    sessionClient.isRefreshInFlight() === false,
  );

  // --- 2. Sequential refreshes are not collapsed ---------------------------
  calls = [];
  await sessionClient.refreshSession();
  check(
    '5. A later, separate refresh does issue its own network call',
    calls.filter((c) => c.url.includes('/api/session/refresh')).length === 1,
  );

  // --- 3. Failed refresh clears the session exactly once -------------------
  refreshResponder = () => ({ status: 401, body: { error: 'expired' } });
  calls = [];
  const failed = await Promise.all([
    sessionClient.refreshSession(),
    sessionClient.refreshSession(),
  ]);
  check(
    '6. A failed refresh returns false to every waiting caller',
    failed.every((r) => r === false),
  );
  check(
    '7. A failed refresh clears the in-memory access token',
    sessionClient.getAccessToken() === null,
  );
  check(
    '8. Concurrent failing refreshes still make only one network call',
    calls.filter((c) => c.url.includes('/api/session/refresh')).length === 1,
  );
  check(
    '9. Session state is UNAUTHENTICATED after refresh failure',
    sessionClient.getSessionSnapshot().state === 'UNAUTHENTICATED',
  );

  // --- 4. One-retry limit on protected requests ----------------------------
  // Re-arm a working refresh, then make the protected endpoint always 401 so a
  // buggy implementation would loop forever.
  refreshResponder = () => ({
    status: 200,
    body: {
      access_token: 'ACCESS_RETRY',
      expires_in: 900,
      user: { id: 'u1', workspaceId: 'ws1' },
    },
  });
  await sessionClient.refreshSession();

  const { api } = await import('./src/lib/api');
  calls = [];
  protectedResponder = () => 401;
  let threw = false;
  try {
    await api.getContacts();
  } catch {
    threw = true;
  }
  const protectedCalls = calls.filter((c) => c.url.includes('/contacts'));
  const retryRefreshes = calls.filter((c) =>
    c.url.includes('/api/session/refresh'),
  );
  check(
    '10. A persistently 401 endpoint surfaces an error rather than looping',
    threw,
  );
  check(
    `11. The original request is attempted exactly twice -- one retry only (observed ${protectedCalls.length})`,
    protectedCalls.length === 2,
  );
  check(
    `12. Exactly one refresh is triggered by the 401 (observed ${retryRefreshes.length})`,
    retryRefreshes.length === 1,
  );
  check(
    '13. The retry carries the refreshed access token',
    protectedCalls.length === 2 &&
      protectedCalls[1].headers['Authorization'] === 'Bearer ACCESS_RETRY',
  );

  // --- 5. Auth routes are never intercepted --------------------------------
  calls = [];
  protectedResponder = () => 401;
  try {
    await api.register({
      email: 'x@example.com',
      passwordPlain: 'p',
      firstName: 'a',
      lastName: 'b',
      workspaceName: 'w',
      subdomain: 's',
    });
  } catch {
    /* expected */
  }
  check(
    '14. A 401 from an auth route triggers no refresh and no retry',
    calls.filter((c) => c.url.includes('/api/session/refresh')).length === 0 &&
      calls.filter((c) => c.url.includes('api/auth/register')).length === 1,
  );

  // --- 6. Logout clears memory --------------------------------------------
  await sessionClient.logout();
  check(
    '15. Logout clears the in-memory access token and user',
    sessionClient.getAccessToken() === null &&
      sessionClient.getSessionUser() === null,
  );

  sessionClient.teardownSession();

  console.log('=======================================================');
  console.log(`📊 T8 SESSION ORCHESTRATION SUITE: ${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
