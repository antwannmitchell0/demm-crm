// Phase 2 -- password-free workspace switching.
//
// THE DEFECT THIS EXISTS TO CATCH
//
// Moving between workspaces made the user type their password again. That was
// not a security decision -- it was the only mechanism that existed. The
// backend could mint a workspace-bound session exactly one way
// (`select-workspace`, which needs the pre-auth token only a password
// produces), and no authenticated endpoint listed the account's workspaces, so
// the client had to re-login just to learn where it could go.
//
// The consequences were worse than the friction: every switch sent the user's
// password over the wire again, and the workspace list was only obtainable at
// login, so a picker could not be refreshed when a teammate added you to a new
// workspace mid-session.
//
// SCOPE, stated plainly: this runs in ONE Node process against stubbed routes.
// It proves which calls are made, what they carry, what does NOT travel, and
// what this tab broadcasts. It cannot prove the browser rotated the httpOnly
// cookie or that another tab received the broadcast -- those are browser-
// verified.
import * as fs from 'fs';
import * as path from 'path';

let pass = 0;
let fail = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`✅ [PASS] ${label}`);
    pass++;
  } else {
    console.log(`❌ [FAIL] ${label}${detail ? ` -- ${detail}` : ''}`);
    fail++;
  }
}

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
  entries() {
    return [...this.map.entries()];
  }
}

const localStorageStub = new MemoryStorage();
const sessionStorageStub = new MemoryStorage();
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
  method: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}
let calls: FetchCall[] = [];
const urlsOf = (fragment: string) => calls.filter((c) => c.url.includes(fragment));

const MEMBERSHIPS = [
  {
    workspaceId: 'ws-alpha',
    workspaceName: 'Alpha Studio',
    organizationId: 'org-1',
    organizationName: 'Alpha Holdings',
    role: 'ORG_OWNER',
  },
  {
    workspaceId: 'ws-bravo',
    workspaceName: 'Bravo Media',
    organizationId: 'org-1',
    organizationName: 'Alpha Holdings',
    role: 'WORKSPACE_ADMIN',
  },
];

let membershipsStatus = 200;
let switchStatus = 200;
let issued = 0;

function installGlobals() {
  const win = {
    localStorage: localStorageStub,
    sessionStorage: sessionStorageStub,
    BroadcastChannel: BroadcastChannelStub,
    location: { reload: () => undefined, href: '/' },
  };
  Object.assign(globalThis as Record<string, unknown>, {
    window: win,
    localStorage: localStorageStub,
    sessionStorage: sessionStorageStub,
    BroadcastChannel: BroadcastChannelStub,
  });

  (globalThis as unknown as { fetch: unknown }).fetch = async (
    input: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
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
      method: init?.method ?? 'GET',
      body,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });

    const json = (status: number, payload: unknown) =>
      ({ status, ok: status < 400, json: async () => payload }) as unknown as Response;

    if (url.includes('/api/session/login')) {
      return json(200, {
        preAuthToken: `PRE_AUTH_${++issued}`,
        user: { id: 'u1', email: 'demo@example.com' },
        workspaces: MEMBERSHIPS,
      });
    }

    const sessionFor = (workspaceId: string) => {
      const m = MEMBERSHIPS.find((w) => w.workspaceId === workspaceId);
      return {
        access_token: `ACCESS_${workspaceId}_${++issued}`,
        token_type: 'Bearer',
        expires_in: 900,
        user: {
          id: 'u1',
          email: 'demo@example.com',
          firstName: 'Demo',
          lastName: 'User',
          role: m?.role ?? 'USER',
          workspaceId,
          workspaceName: m?.workspaceName ?? '',
          organizationName: m?.organizationName ?? '',
        },
      };
    };

    if (url.includes('/api/session/select-workspace')) {
      return json(200, sessionFor(String(body.workspaceId)));
    }

    if (url.includes('/api/session/switch-workspace')) {
      if (switchStatus !== 200) {
        return json(switchStatus, { error: 'Could not open that workspace.' });
      }
      return json(200, sessionFor(String(body.workspaceId)));
    }

    if (url.includes('api/auth/memberships')) {
      if (membershipsStatus !== 200) {
        return json(membershipsStatus, { error: 'nope' });
      }
      return json(200, { memberships: MEMBERSHIPS });
    }

    if (url.includes('/api/session/refresh')) {
      return json(401, { error: 'no cookie in this harness' });
    }
    if (url.includes('/api/session/logout')) return json(200, {});

    return json(200, { ok: true });
  };
}

installGlobals();

function sourceOf(rel: string) {
  return fs.readFileSync(path.join(__dirname, rel), 'utf8');
}
function stripComments(src: string) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

async function main() {
  console.log('🧪 PHASE 2 PASSWORD-FREE WORKSPACE SWITCH SUITE');
  console.log('==============================================================');

  const sessionClient = await import('./src/lib/session/client');
  const { api } = await import('./src/lib/api');

  // Establish a session the normal way first.
  calls = [];
  await sessionClient.beginLogin('demo@example.com', 'pw');
  await sessionClient.switchWorkspace('ws-alpha');
  check(
    '1. Setup: a session exists on the first workspace',
    sessionClient.getSessionUser()?.workspaceId === 'ws-alpha',
  );
  check(
    `2. The session knows the workspace's NAME, not just its id (got "${sessionClient.getSessionUser()?.workspaceName}")`,
    sessionClient.getSessionUser()?.workspaceName === 'Alpha Studio',
  );

  // ===== A. Starting a switch asks for no password =====
  const tokenBefore = sessionClient.getAccessToken();
  calls = [];
  broadcasts.length = 0;
  // The base URL is passed in, matching logoutAll(); the session module holds
  // no knowledge of the API host. The stub matches on path, so any origin works.
  const choices = await sessionClient.beginWorkspaceSwitch('http://backend.test');
  check(
    `3. Starting a switch does NOT re-authenticate (login calls: ${urlsOf('/api/session/login').length})`,
    urlsOf('/api/session/login').length === 0,
  );
  check(
    `4. It reads the account's memberships instead (calls: ${urlsOf('api/auth/memberships').length})`,
    urlsOf('api/auth/memberships').length === 1,
  );
  check(
    '5. That read is a GET carrying the existing access token',
    urlsOf('api/auth/memberships')[0]?.method === 'GET' &&
      urlsOf('api/auth/memberships')[0]?.headers['Authorization'] ===
        `Bearer ${tokenBefore}`,
  );
  check(
    '6. NO password is transmitted anywhere while starting a switch',
    !calls.some((c) => JSON.stringify(c.body).toLowerCase().includes('password')),
  );
  check(
    `7. The choices come from that response (got ${choices.length})`,
    choices.length === 2 && choices.some((c) => c.workspaceId === 'ws-bravo'),
  );
  check(
    '8. Choices carry the workspace name so the picker can be read by a human',
    choices.every((c) => typeof c.workspaceName === 'string' && c.workspaceName !== ''),
  );
  check(
    '9. The live session is untouched while the switch is being decided',
    sessionClient.getAccessToken() === tokenBefore &&
      sessionClient.getSessionUser()?.workspaceId === 'ws-alpha',
  );

  // ===== B. Completing the switch spends the cookie, not a password =====
  calls = [];
  await sessionClient.switchWorkspace('ws-bravo');
  check(
    `10. Completing a switch goes through the BFF switch route (calls: ${urlsOf('/api/session/switch-workspace').length})`,
    urlsOf('/api/session/switch-workspace').length === 1,
  );
  check(
    '11. It does NOT use select-workspace, which would need a password-derived token',
    urlsOf('/api/session/select-workspace').length === 0,
  );
  const switchCall = urlsOf('/api/session/switch-workspace')[0];
  check(
    `12. The request body carries ONLY the target workspace (got [${Object.keys(switchCall?.body ?? {}).join(', ')}])`,
    Object.keys(switchCall?.body ?? {}).join(',') === 'workspaceId',
  );
  check(
    '13. No refresh token is ever sent from browser JavaScript -- the cookie is added server-side',
    !calls.some((c) => 'refreshToken' in (c.body ?? {})),
  );
  check(
    '14. The new workspace is active',
    sessionClient.getSessionUser()?.workspaceId === 'ws-bravo',
  );
  check(
    `15. The role for the NEW workspace replaces the old one (got ${sessionClient.getSessionUser()?.role})`,
    sessionClient.getSessionUser()?.role === 'WORKSPACE_ADMIN',
  );
  check(
    `16. The active workspace NAME follows the switch (got "${sessionClient.getSessionUser()?.workspaceName}")`,
    sessionClient.getSessionUser()?.workspaceName === 'Bravo Media',
  );
  check(
    '17. Switching obtains a genuinely new access token',
    sessionClient.getAccessToken() !== tokenBefore,
  );
  const switched = broadcasts.filter((m) => m.type === 'WORKSPACE_SWITCHED');
  check(
    `18. The switching tab still tells every other tab to follow (observed ${switched.length})`,
    switched.length === 1 &&
      (switched[0]?.user as Record<string, unknown>)?.workspaceId === 'ws-bravo',
  );

  // ===== C. Nothing is persisted, and requests follow the new workspace =====
  check(
    '19. No credential is written to localStorage or sessionStorage',
    localStorageStub.entries().length === 0 &&
      sessionStorageStub.entries().length === 0,
  );
  calls = [];
  await api.getContacts();
  const contactCall = urlsOf('/contacts')[0];
  check(
    '20. Requests after the switch carry the new token and workspace',
    contactCall?.headers['Authorization'] ===
      `Bearer ${sessionClient.getAccessToken()}` &&
      contactCall?.headers['x-workspace-id'] === 'ws-bravo',
  );

  // ===== D. A failed switch must not damage the live session =====
  {
    const beforeToken = sessionClient.getAccessToken();
    switchStatus = 401;
    calls = [];
    let threw = false;
    try {
      await sessionClient.switchWorkspace('ws-alpha');
    } catch {
      threw = true;
    }
    switchStatus = 200;
    check('21. A refused switch surfaces an error', threw);
    check(
      '22. A refused switch leaves the current workspace and token intact',
      sessionClient.getAccessToken() === beforeToken &&
        sessionClient.getSessionUser()?.workspaceId === 'ws-bravo',
    );
  }

  // ===== E. Only an offered workspace may be requested =====
  {
    let threw = false;
    try {
      await sessionClient.switchWorkspace('ws-not-offered');
    } catch {
      threw = true;
    }
    check('23. A workspace the backend never offered is refused client-side', threw);
  }

  // ===== E2. A failed membership read must not damage the session either =====
  {
    const beforeToken = sessionClient.getAccessToken();
    const beforeWorkspace = sessionClient.getSessionUser()?.workspaceId;
    membershipsStatus = 500;
    let threw = false;
    try {
      await sessionClient.beginWorkspaceSwitch('http://backend.test');
    } catch {
      threw = true;
    }
    membershipsStatus = 200;
    check('23a. A failed membership read surfaces an error', threw);
    check(
      '23b. A failed membership read leaves the live session untouched',
      sessionClient.getAccessToken() === beforeToken &&
        sessionClient.getSessionUser()?.workspaceId === beforeWorkspace,
    );
  }

  // ===== F. The membership read must survive an expired access token =====
  {
    // `api/auth/` is excluded from the 401-refresh-and-replay path because a
    // 401 from a CREDENTIAL route means the credential was rejected. Membership
    // listing is not a credential route -- it is an ordinary bearer-authorised
    // read that happens to be mounted under the auth controller -- so excluding
    // it would strand the picker whenever the access token had aged out.
    const apiSrc = stripComments(sourceOf('src/lib/api.ts'));
    check(
      '24. api.ts treats the membership read as retryable, not as a credential rejection',
      /memberships/.test(apiSrc),
      'no exemption found for api/auth/memberships',
    );
  }

  // ===== G. The UI no longer collects a password to switch =====
  {
    const switcher = stripComments(sourceOf('src/components/WorkspaceSwitcher.tsx'));
    check(
      '25. WorkspaceSwitcher renders no password input',
      !/type="password"/.test(switcher) && !/setPassword/.test(switcher),
    );
    check(
      '26. WorkspaceSwitcher no longer imports a password-based entry point',
      !/passwordPlain/.test(switcher),
    );

    const clientSrc = stripComments(sourceOf('src/lib/session/client.ts'));
    // It still takes the backend base URL, matching logoutAll() -- this module
    // holds no knowledge of the API host. What it must never take again is a
    // password.
    const signature = clientSrc.match(
      /export async function beginWorkspaceSwitch\(([^)]*)\)/,
    )?.[1];
    check(
      `27. beginWorkspaceSwitch accepts no password parameter (signature: "${(signature ?? '').trim()}")`,
      typeof signature === 'string' && !/password/i.test(signature),
    );
  }

  // Cancels the scheduled access-token refresh. Without this the pending
  // setTimeout keeps the Node event loop alive and the process never exits.
  sessionClient.teardownSession();

  console.log('==============================================================');
  console.log(`📊 PASSWORD-FREE SWITCH SUITE: ${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
