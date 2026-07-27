// T9 -- automated tests for workspace selection and switching.
//
// SCOPE NOTE, stated plainly: this file runs in ONE Node process. It proves the
// SINGLE-TAB guarantees -- which network calls are made, which workspace becomes
// active, that no credential is persisted, and which cross-tab message the
// switching tab EMITS. It does NOT and cannot prove that another tab RECEIVES
// that message, that the httpOnly cookie is rotated by the browser, or that a
// reload restores the session. Those are verified separately in a real browser
// with real tabs; see the T9 report.
import * as fs from 'fs';
import * as path from 'path';

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

// ---------------------------------------------------------------------------
// Browser-ish globals, installed BEFORE the session modules are imported.
// localStorage/sessionStorage are real (in-memory) so the "nothing is
// persisted" assertions test something instead of silently skipping.
// ---------------------------------------------------------------------------
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  get length() {
    return this.map.size;
  }
  keys() {
    return [...this.map.keys()];
  }
  entries() {
    return [...this.map.entries()];
  }
}

const localStorageStub = new MemoryStorage();
const sessionStorageStub = new MemoryStorage();

/** Records what THIS tab broadcasts. Receipt by another tab is browser-verified. */
const broadcasts: Array<Record<string, unknown>> = [];
class BroadcastChannelStub {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  constructor(public name: string) {}
  postMessage(message: Record<string, unknown>) {
    broadcasts.push(message);
  }
  close() {}
}

interface FetchCall {
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}
let calls: FetchCall[] = [];

function urlsOf(fragment: string) {
  return calls.filter((c) => c.url.includes(fragment));
}

let workspacesForLogin: Array<Record<string, unknown>> = [];
let loginStatus = 200;
let issuedTokenCounter = 0;

function installGlobals() {
  const win = {
    localStorage: localStorageStub,
    sessionStorage: sessionStorageStub,
    BroadcastChannel: BroadcastChannelStub,
    location: { reload: () => undefined, href: '/' },
  };
  // Node exposes `navigator` as a getter-only global and it has no Web Locks,
  // which is what we want here: no refresh happens in these flows, so the lock
  // is never taken and browser storage must stay completely empty.
  Object.assign(globalThis as Record<string, unknown>, {
    window: win,
    localStorage: localStorageStub,
    sessionStorage: sessionStorageStub,
    BroadcastChannel: BroadcastChannelStub,
  });

  (globalThis as unknown as { fetch: unknown }).fetch = async (
    input: string,
    init?: { headers?: Record<string, string>; body?: string },
  ) => {
    const url = String(input);
    let body: Record<string, unknown> = {};
    try {
      body = init?.body ? JSON.parse(init.body) : {};
    } catch {
      body = {};
    }
    calls.push({
      url,
      body,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });

    const json = (status: number, payload: unknown) =>
      ({
        status,
        ok: status < 400,
        json: async () => payload,
      }) as unknown as Response;

    if (url.includes('/api/session/login')) {
      if (loginStatus !== 200) {
        return json(loginStatus, { error: 'Invalid email or password' });
      }
      return json(200, {
        preAuthToken: `PRE_AUTH_${++issuedTokenCounter}`,
        user: { id: 'u1', email: 'demo@example.com' },
        workspaces: workspacesForLogin,
      });
    }

    if (url.includes('/api/session/select-workspace')) {
      const workspaceId = String(body.workspaceId);
      const chosen = workspacesForLogin.find(
        (w) => w.workspaceId === workspaceId,
      );
      if (!chosen) return json(403, { error: 'Not a member' });
      return json(200, {
        access_token: `ACCESS_${workspaceId}_${++issuedTokenCounter}`,
        token_type: 'Bearer',
        expires_in: 900,
        user: {
          id: 'u1',
          email: 'demo@example.com',
          firstName: 'Demo',
          lastName: 'User',
          role: chosen.role ?? 'ORG_OWNER',
          workspaceId,
        },
      });
    }

    // Phase 2: switching no longer re-logs-in. It reads the account's
    // memberships with the live access token, then spends the refresh cookie
    // through the BFF switch route.
    if (url.includes('api/auth/memberships')) {
      return json(200, { memberships: workspacesForLogin });
    }

    if (url.includes('/api/session/switch-workspace')) {
      const workspaceId = String(body.workspaceId);
      const chosen = workspacesForLogin.find(
        (w) => w.workspaceId === workspaceId,
      );
      if (!chosen) return json(401, { error: 'Session expired.' });
      return json(200, {
        access_token: `ACCESS_${workspaceId}_${++issuedTokenCounter}`,
        token_type: 'Bearer',
        expires_in: 900,
        user: {
          id: 'u1',
          email: 'demo@example.com',
          firstName: 'Demo',
          lastName: 'User',
          role: chosen.role ?? 'ORG_OWNER',
          workspaceId,
          workspaceName: chosen.workspaceName ?? '',
        },
      });
    }

    if (url.includes('/api/session/refresh')) {
      return json(401, { error: 'no cookie in this harness' });
    }

    if (url.includes('/api/session/logout')) return json(200, {});

    // Any protected backend call.
    return json(200, { ok: true });
  };
}

installGlobals();

const WS = {
  alpha: {
    workspaceId: 'ws-alpha',
    workspaceName: 'Alpha Studio',
    organizationId: 'org-1',
    organizationName: 'Alpha Holdings',
    role: 'ORG_OWNER',
  },
  bravo: {
    workspaceId: 'ws-bravo',
    workspaceName: 'Bravo Media',
    organizationId: 'org-1',
    organizationName: 'Alpha Holdings',
    role: 'WORKSPACE_ADMIN',
  },
  charlie: {
    workspaceId: 'ws-charlie',
    workspaceName: 'Charlie Agency',
    organizationId: 'org-2',
    organizationName: 'Charlie Group',
    role: 'MEMBER',
  },
};

async function main() {
  console.log('🧪 T9 WORKSPACE SELECTION & SWITCHING SUITE (single-tab scope)');
  console.log('==============================================================');

  const sessionClient = await import('./src/lib/session/client');
  const { api } = await import('./src/lib/api');

  // === 1. ONE workspace: enter automatically ===============================
  calls = [];
  workspacesForLogin = [WS.alpha];
  const oneResult = await sessionClient.beginLogin('demo@example.com', 'pw');
  check(
    `1. One-workspace login reports it entered the workspace (got "${oneResult.outcome}")`,
    oneResult.outcome === 'ENTERED',
  );
  check(
    '2. One-workspace login establishes the session without asking',
    urlsOf('/api/session/select-workspace').length === 1 &&
      sessionClient.getSessionSnapshot().state === 'AUTHENTICATED',
  );
  check(
    '3. The single workspace is the active one',
    sessionClient.getSessionUser()?.workspaceId === 'ws-alpha',
  );
  check(
    '4. No workspace choice is left pending after an automatic entry',
    sessionClient.getPendingWorkspaceChoices() === null,
  );

  await sessionClient.logout();

  // === 2. MULTIPLE workspaces: picker, no silent selection =================
  calls = [];
  workspacesForLogin = [WS.alpha, WS.bravo, WS.charlie];
  const manyResult = await sessionClient.beginLogin('demo@example.com', 'pw');
  check(
    `5. Multi-workspace login requires a choice (got "${manyResult.outcome}")`,
    manyResult.outcome === 'SELECTION_REQUIRED',
  );
  check(
    '6. Session state is WORKSPACE_SELECTION_REQUIRED',
    sessionClient.getSessionSnapshot().state === 'WORKSPACE_SELECTION_REQUIRED',
  );
  check(
    `7. select-workspace is NOT called before the user chooses (observed ${urlsOf('/api/session/select-workspace').length})`,
    urlsOf('/api/session/select-workspace').length === 0,
  );
  check(
    '8. No access token exists while a choice is pending',
    sessionClient.getAccessToken() === null,
  );

  const pending = sessionClient.getPendingWorkspaceChoices();
  check(
    '9. Every available workspace is offered, in the order the backend returned',
    !!pending &&
      pending.choices.length === 3 &&
      pending.choices[0].workspaceId === 'ws-alpha' &&
      pending.choices[2].workspaceId === 'ws-charlie',
  );
  check(
    '10. Each choice carries human-readable identifying information',
    !!pending &&
      pending.choices[1].workspaceName === 'Bravo Media' &&
      pending.choices[1].organizationName === 'Alpha Holdings' &&
      pending.choices[1].role === 'WORKSPACE_ADMIN',
  );
  check(
    '11. The pre-auth token is NOT exposed to the UI layer',
    !!pending && !('preAuthToken' in (pending as Record<string, unknown>)),
  );

  // === 3. The CHOSEN workspace wins, not workspaces[0] =====================
  calls = [];
  await sessionClient.switchWorkspace('ws-charlie');
  const selectCalls = urlsOf('/api/session/select-workspace');
  check(
    '12. Choosing calls select-workspace exactly once',
    selectCalls.length === 1,
  );
  check(
    `13. The chosen workspace id is sent, not the first array item (sent "${selectCalls[0]?.body.workspaceId}")`,
    selectCalls[0]?.body.workspaceId === 'ws-charlie',
  );
  check(
    '14. A pre-auth token is presented with the choice',
    typeof selectCalls[0]?.body.preAuthToken === 'string' &&
      String(selectCalls[0]?.body.preAuthToken).startsWith('PRE_AUTH_'),
  );
  check(
    '15. The THIRD workspace becomes active -- not the first',
    sessionClient.getSessionUser()?.workspaceId === 'ws-charlie',
  );
  check(
    '16. The session is authenticated after choosing',
    sessionClient.getSessionSnapshot().state === 'AUTHENTICATED' &&
      typeof sessionClient.getAccessToken() === 'string',
  );
  check(
    '17. The pending choice is cleared once it has been used',
    sessionClient.getPendingWorkspaceChoices() === null,
  );

  // === 4. A spent pre-auth token cannot be replayed into another switch ====
  calls = [];
  let reusedRejected = false;
  try {
    await sessionClient.switchWorkspace('ws-bravo');
  } catch {
    reusedRejected = true;
  }
  check(
    '18. Switching with no fresh authorization is refused, not silently retried',
    reusedRejected && urlsOf('/api/session/select-workspace').length === 0,
  );
  check(
    '19. The refused switch leaves the current workspace intact',
    sessionClient.getSessionUser()?.workspaceId === 'ws-charlie',
  );

  // === 5. SWITCHING, without a password ====================================
  //
  // CONTRACT CHANGED IN PHASE 2. This block used to assert that starting a
  // switch called /api/session/login -- because re-authenticating was the only
  // way to obtain both a workspace list and the authority to enter one. The
  // backend now exposes `GET api/auth/memberships` and `switch-workspace`, so
  // the password prompt is gone and these assertions describe the new contract.
  // See test-password-free-switch.ts for the full proof.
  const tokenBeforeSwitch = sessionClient.getAccessToken();
  calls = [];
  broadcasts.length = 0;
  const switchChoices = await sessionClient.beginWorkspaceSwitch(
    'http://backend.test',
  );
  check(
    '20. Starting a switch does NOT re-authenticate',
    urlsOf('/api/session/login').length === 0 &&
      urlsOf('api/auth/memberships').length === 1,
  );
  check(
    '21. The switch workspace list comes from the memberships endpoint',
    switchChoices.length === 3 &&
      switchChoices.some(
        (c: { workspaceId: string }) => c.workspaceId === 'ws-bravo',
      ),
  );
  check(
    '22. The live session is untouched while the switch is being decided',
    sessionClient.getAccessToken() === tokenBeforeSwitch &&
      sessionClient.getSessionUser()?.workspaceId === 'ws-charlie',
  );

  calls = [];
  await sessionClient.switchWorkspace('ws-bravo');
  check(
    '23. Switching obtains a NEW access token',
    typeof sessionClient.getAccessToken() === 'string' &&
      sessionClient.getAccessToken() !== tokenBeforeSwitch,
  );
  check(
    '24. The new workspace is active',
    sessionClient.getSessionUser()?.workspaceId === 'ws-bravo',
  );
  check(
    '25. The role for the NEW workspace replaces the old one',
    sessionClient.getSessionUser()?.role === 'WORKSPACE_ADMIN',
  );
  check(
    '26. The switch goes through the BFF switch-workspace route (the only place the refresh cookie is read and rotated)',
    urlsOf('/api/session/switch-workspace').length === 1 &&
      urlsOf('/api/session/switch-workspace')[0].url.startsWith('/api/session/'),
  );
  check(
    `27. Switching triggers NO refresh call, so rotation replay cannot be provoked (observed ${urlsOf('/api/session/refresh').length})`,
    urlsOf('/api/session/refresh').length === 0,
  );

  // === 6. Requests after the switch use the new workspace session ==========
  calls = [];
  await api.getContacts();
  const contactCall = urlsOf('/contacts')[0];
  check(
    '28. API requests after switching carry the new access token',
    contactCall?.headers['Authorization'] ===
      `Bearer ${sessionClient.getAccessToken()}`,
  );
  check(
    '29. API requests after switching carry the new workspace id',
    contactCall?.headers['x-workspace-id'] === 'ws-bravo',
  );
  check(
    '30. No request carries the OLD workspace token after the switch',
    !calls.some((c) => c.headers['Authorization'] === `Bearer ${tokenBeforeSwitch}`),
  );

  // === 7. Cross-tab message EMITTED by the switching tab ===================
  const switched = broadcasts.filter((m) => m.type === 'WORKSPACE_SWITCHED');
  check(
    `31. The switching tab broadcasts WORKSPACE_SWITCHED (observed ${switched.length})`,
    switched.length === 1,
  );
  check(
    '32. That broadcast carries the new workspace so other tabs cannot stay on the old one',
    (switched[0]?.user as Record<string, unknown> | undefined)?.workspaceId ===
      'ws-bravo',
  );
  check(
    '33. No broadcast ever carries a pre-auth token or a refresh token',
    !broadcasts.some((m) =>
      JSON.stringify(m).includes('PRE_AUTH'),
    ) &&
      !broadcasts.some((m) => JSON.stringify(m).toLowerCase().includes('refresh_token')),
  );

  // === 8. ZERO workspaces: honest empty state ==============================
  await sessionClient.logout();
  calls = [];
  workspacesForLogin = [];
  const noneResult = await sessionClient.beginLogin('demo@example.com', 'pw');
  check(
    `34. Zero-workspace login reports NO_WORKSPACE (got "${noneResult.outcome}")`,
    noneResult.outcome === 'NO_WORKSPACE',
  );
  check(
    '35. Zero-workspace login never calls select-workspace',
    urlsOf('/api/session/select-workspace').length === 0,
  );
  check(
    '36. Zero-workspace login leaves the user unauthenticated with no token',
    sessionClient.getSessionSnapshot().state === 'UNAUTHENTICATED' &&
      sessionClient.getAccessToken() === null,
  );
  check(
    '37. Zero-workspace login fabricates no workspace choice',
    sessionClient.getPendingWorkspaceChoices() === null,
  );

  // === 9. Failed login surfaces an error, changes nothing =================
  loginStatus = 401;
  calls = [];
  let loginThrew = false;
  try {
    await sessionClient.beginLogin('demo@example.com', 'wrong');
  } catch {
    loginThrew = true;
  }
  check(
    '38. A rejected password throws and establishes no session',
    loginThrew &&
      sessionClient.getAccessToken() === null &&
      urlsOf('/api/session/select-workspace').length === 0,
  );
  loginStatus = 200;

  // === 10. Nothing is persisted anywhere =================================
  check(
    `39. Nothing was written to localStorage (found ${JSON.stringify(localStorageStub.keys())})`,
    localStorageStub.length === 0,
  );
  check(
    `40. Nothing was written to sessionStorage (found ${JSON.stringify(sessionStorageStub.keys())})`,
    sessionStorageStub.length === 0,
  );
  const allPersisted = JSON.stringify([
    localStorageStub.entries(),
    sessionStorageStub.entries(),
  ]);
  check(
    '41. No pre-auth token, access token, or workspace list appears in browser storage',
    !allPersisted.includes('PRE_AUTH') &&
      !allPersisted.includes('ACCESS_') &&
      !allPersisted.includes('ws-'),
  );

  // === 11. The temporary bridge is gone ==================================
  const apiSource = fs.readFileSync(
    path.join(__dirname, 'src/lib/api.ts'),
    'utf8',
  );
  check(
    '42. The temporary workspaces[0] bridge no longer exists in api.ts',
    !apiSource.includes('workspaces[0]'),
  );
  check(
    '43. No "REMOVE IN T9" marker is left behind',
    !apiSource.includes('REMOVE IN T9'),
  );
  const clientSource = fs.readFileSync(
    path.join(__dirname, 'src/lib/session/client.ts'),
    'utf8',
  );
  check(
    '44. The session client contains no first-workspace bridge either',
    !clientSource.includes('workspaces[0]'),
  );

  console.log('==============================================================');
  console.log(`📊 T9 WORKSPACE SELECTION SUITE: ${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exitCode = 1;
}

// teardownSession() cancels the scheduled access-token refresh. It MUST run in
// a finally: it used to sit at the end of main(), so any throw skipped it, the
// pending setTimeout kept the event loop alive, and the suite hung instead of
// failing. A test that hangs on error reports nothing at all.
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    const sessionClient = await import('./src/lib/session/client');
    sessionClient.teardownSession();
  });
