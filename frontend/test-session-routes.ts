// T7 — focused tests for the first-party BFF session routes.
//
// Exercises the REAL route handlers as served by the production standalone
// build (`node .next/standalone/server.js`), which simultaneously proves that
// `output: 'standalone'` includes and serves them.
//
// The backend is replaced with a local stub so cookie handling, Origin
// rejection, 401-clearing and token-leak behaviour are deterministic and need
// no database. Backend behaviour itself is covered by the backend suites.
import * as http from 'http';
import * as fs from 'fs';
import { spawn, type ChildProcess } from 'child_process';
import * as path from 'path';

/**
 * Locates the standalone entrypoint.
 *
 * `next build` normally emits `.next/standalone/server.js`, which is what
 * frontend/Dockerfile copies and runs. Locally, however, the repository root
 * also has a package.json, so Next infers a workspace root and nests the output
 * under the project's path inside `.next/standalone`. Inside Docker the build
 * context is the frontend directory alone, so no nesting occurs. Search for the
 * entrypoint rather than hardcoding either layout.
 */
function findStandaloneServer(root: string): string | null {
  const direct = path.join(root, 'server.js');
  if (fs.existsSync(direct)) return direct;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === 'server.js') return full;
      if (entry.isDirectory()) stack.push(full);
    }
  }
  return null;
}

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

const PRE_AUTH = 'STUB_PRE_AUTH_TOKEN';
const REFRESH_1 = 'STUB_REFRESH_TOKEN_ONE';
const REFRESH_2 = 'STUB_REFRESH_TOKEN_TWO';
const ACCESS_1 = 'STUB_ACCESS_TOKEN_ONE';
const ACCESS_2 = 'STUB_ACCESS_TOKEN_TWO';

interface BackendCall {
  path: string;
  body: Record<string, unknown>;
  authorization: string | null;
}
const backendCalls: BackendCall[] = [];
/** Refresh tokens the stub backend has already rotated away. */
const consumedRefreshTokens = new Set<string>();

function startStubBackend(): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body: Record<string, unknown> = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        body = {};
      }
      backendCalls.push({
        path: req.url ?? '',
        body,
        authorization: req.headers.authorization ?? null,
      });

      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      if (req.url === '/api/auth/login') {
        if (body.email === 'valid@example.com') {
          return send(201, {
            message: 'Login successful. Please select a workspace context.',
            preAuthToken: PRE_AUTH,
            user: { id: 'user-1', email: 'valid@example.com' },
            workspaces: [{ workspaceId: 'ws-1', workspaceName: 'WS One' }],
          });
        }
        return send(401, { message: 'Invalid email or password' });
      }

      if (req.url === '/api/auth/select-workspace') {
        if (req.headers.authorization !== `Bearer ${PRE_AUTH}`) {
          return send(401, { message: 'Invalid or expired pre-auth token' });
        }
        return send(201, {
          access_token: ACCESS_1,
          refresh_token: REFRESH_1,
          token_type: 'Bearer',
          expires_in: 900,
          user: { id: 'user-1', email: 'valid@example.com' },
        });
      }

      if (req.url === '/api/auth/refresh') {
        // Model the real post-T6 backend: rotation CONSUMES the presented
        // token, so replaying it later is rejected exactly like a revoked or
        // unknown token -- one indistinguishable 401.
        if (body.refreshToken === REFRESH_1 && !consumedRefreshTokens.has(REFRESH_1)) {
          consumedRefreshTokens.add(REFRESH_1);
          return send(201, {
            access_token: ACCESS_2,
            refresh_token: REFRESH_2,
            token_type: 'Bearer',
            expires_in: 900,
            user: { id: 'user-1', email: 'valid@example.com' },
          });
        }
        // Anything else models the post-T6 backend response for an unknown,
        // expired, or replayed-and-revoked token: one indistinguishable 401.
        return send(401, { message: 'Invalid or expired refresh token' });
      }

      if (req.url === '/api/auth/logout') {
        return send(200, { status: 'SUCCESS' });
      }

      return send(404, { message: 'Not found' });
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as { port: number };
      resolve({ server, port: address.port });
    });
  });
}

async function waitForServer(url: string, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

function setCookieHeaders(res: Response): string[] {
  const getAll = (
    res.headers as unknown as { getSetCookie?: () => string[] }
  ).getSetCookie;
  if (typeof getAll === 'function') return getAll.call(res.headers);
  const single = res.headers.get('set-cookie');
  return single ? [single] : [];
}
function refreshCookie(res: Response): string | undefined {
  return setCookieHeaders(res).find((c) => c.startsWith('demm_crm_refresh='));
}
function cookieValue(header: string): string {
  return header.split(';')[0].split('=').slice(1).join('=');
}

async function main() {
  console.log('🧪 T7 SESSION-ROUTE SUITE (real standalone build + stub backend)');
  console.log('================================================================');

  const stub = await startStubBackend();
  const standaloneServer = findStandaloneServer(
    path.join(process.cwd(), '.next', 'standalone'),
  );
  if (!standaloneServer) {
    console.error(
      'No standalone server.js found. Run `npm run build` before this suite.',
    );
    process.exitCode = 1;
    stub.server.close();
    return;
  }
  const port = 3999;
  const base = `http://127.0.0.1:${port}`;

  const child: ChildProcess = spawn('node', [standaloneServer], {
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      // Server-only runtime override, so no rebuild is needed to retarget.
      BACKEND_API_URL: `http://127.0.0.1:${stub.port}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  child.stdout?.on('data', (d) => (serverLog += d.toString()));
  child.stderr?.on('data', (d) => (serverLog += d.toString()));

  const teardown = () => {
    child.kill('SIGTERM');
    stub.server.close();
  };

  try {
    const ready = await waitForServer(`${base}/api/version`);
    check('0. Standalone build starts and serves route handlers', ready);
    if (!ready) {
      console.log('--- server log ---\n' + serverLog);
      return;
    }

    const jsonPost = (
      p: string,
      body: unknown,
      opts: { origin?: string | null; cookie?: string } = {},
    ) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (opts.origin !== null) headers.Origin = opts.origin ?? base;
      if (opts.cookie) headers.Cookie = opts.cookie;
      return fetch(`${base}${p}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        redirect: 'manual',
      });
    };

    // ---------------- LOGIN ----------------
    const loginRes = await jsonPost('/api/session/login', {
      email: 'valid@example.com',
      passwordPlain: 'pw',
    });
    const loginBody = await loginRes.json();
    if (loginRes.status !== 200) {
      console.log(
        `   [diagnostic] login -> HTTP ${loginRes.status} body=${JSON.stringify(loginBody)} (Origin sent: ${base})`,
      );
    }
    check(
      '1. Valid login returns preAuthToken, user and workspaces',
      loginRes.status === 200 &&
        loginBody.preAuthToken === PRE_AUTH &&
        !!loginBody.user &&
        Array.isArray(loginBody.workspaces) &&
        loginBody.workspaces.length === 1,
    );
    check(
      '2. Login sets NO refresh-token cookie',
      refreshCookie(loginRes) === undefined,
    );

    const badLogin = await jsonPost('/api/session/login', {
      email: 'wrong@example.com',
      passwordPlain: 'pw',
    });
    const badLoginBody = await badLogin.json();
    check(
      '3. Invalid login returns a safe error and no cookie',
      badLogin.status === 401 &&
        typeof badLoginBody.error === 'string' &&
        refreshCookie(badLogin) === undefined,
    );

    const crossLogin = await jsonPost(
      '/api/session/login',
      { email: 'valid@example.com', passwordPlain: 'pw' },
      { origin: 'https://evil.example' },
    );
    check('4. Cross-origin login is rejected (403)', crossLogin.status === 403);

    // ---------------- SELECT WORKSPACE ----------------
    const selectRes = await jsonPost('/api/session/select-workspace', {
      preAuthToken: PRE_AUTH,
      workspaceId: 'ws-1',
    });
    const selectBody = await selectRes.json();
    const setCookie = refreshCookie(selectRes);
    check(
      '5. Valid workspace selection sets the refresh cookie',
      !!setCookie && cookieValue(setCookie) === REFRESH_1,
    );
    check(
      '6. Cookie is HttpOnly, SameSite=Lax, Path=/api/session, with a bounded Max-Age',
      !!setCookie &&
        /HttpOnly/i.test(setCookie) &&
        /SameSite=Lax/i.test(setCookie) &&
        /Path=\/api\/session/i.test(setCookie) &&
        /Max-Age=604800/i.test(setCookie),
    );
    check(
      '7. Response contains the access token',
      selectBody.access_token === ACCESS_1 &&
        selectBody.token_type === 'Bearer',
    );
    check(
      '8. Response body does NOT contain the refresh token',
      !JSON.stringify(selectBody).includes(REFRESH_1),
    );

    const badSelect = await jsonPost('/api/session/select-workspace', {
      preAuthToken: 'not-a-real-token',
      workspaceId: 'ws-1',
    });
    check(
      '9. Invalid pre-auth token sets no cookie and fails safely',
      badSelect.status === 401 && refreshCookie(badSelect) === undefined,
    );

    const extraFieldSelect = await jsonPost('/api/session/select-workspace', {
      preAuthToken: PRE_AUTH,
      workspaceId: 'ws-1',
      userId: 'attacker-supplied',
    });
    check(
      '10. Unknown extra field (the removed userId contract) is rejected with 400 and no cookie',
      extraFieldSelect.status === 400 &&
        refreshCookie(extraFieldSelect) === undefined,
    );

    const crossSelect = await jsonPost(
      '/api/session/select-workspace',
      { preAuthToken: PRE_AUTH, workspaceId: 'ws-1' },
      { origin: 'https://evil.example' },
    );
    check(
      '11. Cross-origin workspace selection is rejected (403) with no cookie',
      crossSelect.status === 403 && refreshCookie(crossSelect) === undefined,
    );

    // ---------------- REFRESH ----------------
    const noCookieRefresh = await jsonPost('/api/session/refresh', {});
    check(
      '12. Refresh with no cookie returns 401',
      noCookieRefresh.status === 401,
    );

    const callsBeforeRefresh = backendCalls.length;
    const refreshRes = await jsonPost(
      '/api/session/refresh',
      {},
      { cookie: `demm_crm_refresh=${REFRESH_1}` },
    );
    const refreshBody = await refreshRes.json();
    const rotatedCookie = refreshCookie(refreshRes);
    check(
      '13. Valid cookie rotates the refresh token and replaces the cookie',
      refreshRes.status === 200 &&
        !!rotatedCookie &&
        cookieValue(rotatedCookie) === REFRESH_2,
    );
    check(
      '14. Refresh returns the new access token but not the refresh token',
      refreshBody.access_token === ACCESS_2 &&
        !JSON.stringify(refreshBody).includes(REFRESH_1) &&
        !JSON.stringify(refreshBody).includes(REFRESH_2),
    );

    const replayRes = await jsonPost(
      '/api/session/refresh',
      {},
      { cookie: `demm_crm_refresh=${REFRESH_1}` },
    );
    const replayCookie = refreshCookie(replayRes);
    check(
      '15. Backend 401 (replay/revoked) clears the cookie and returns a generic 401',
      replayRes.status === 401 &&
        !!replayCookie &&
        cookieValue(replayCookie) === '' &&
        /Max-Age=0/i.test(replayCookie),
    );
    const callsForReplay = backendCalls.length - callsBeforeRefresh;
    check(
      '16. Refresh does not retry automatically (one backend call per request)',
      callsForReplay === 2,
    );

    const crossRefresh = await jsonPost(
      '/api/session/refresh',
      {},
      { origin: 'https://evil.example', cookie: `demm_crm_refresh=${REFRESH_1}` },
    );
    check(
      '17. Cross-origin refresh is rejected (403)',
      crossRefresh.status === 403,
    );

    // ---------------- LOGOUT ----------------
    const callsBeforeLogout = backendCalls.length;
    const logoutRes = await jsonPost(
      '/api/session/logout',
      {},
      { cookie: `demm_crm_refresh=${REFRESH_2}` },
    );
    const logoutCall = backendCalls
      .slice(callsBeforeLogout)
      .find((c) => c.path === '/api/auth/logout');
    check(
      '18. Logout forwards the current refresh token to the backend server-side',
      !!logoutCall && logoutCall.body.refreshToken === REFRESH_2,
    );
    const logoutCookie = refreshCookie(logoutRes);
    check(
      '19. Logout clears the cookie',
      logoutRes.status === 200 &&
        !!logoutCookie &&
        cookieValue(logoutCookie) === '' &&
        /Max-Age=0/i.test(logoutCookie),
    );

    const emptyLogout = await jsonPost('/api/session/logout', {});
    const emptyLogoutCookie = refreshCookie(emptyLogout);
    check(
      '20. Logout is safe and idempotent with no cookie present',
      emptyLogout.status === 200 &&
        !!emptyLogoutCookie &&
        cookieValue(emptyLogoutCookie) === '',
    );

    const crossLogout = await jsonPost(
      '/api/session/logout',
      {},
      { origin: 'https://evil.example', cookie: `demm_crm_refresh=${REFRESH_2}` },
    );
    check(
      '21. Cross-origin logout is rejected (403)',
      crossLogout.status === 403,
    );

    // ---------------- LEAKAGE ----------------
    const allBodies = [
      JSON.stringify(loginBody),
      JSON.stringify(badLoginBody),
      JSON.stringify(selectBody),
      JSON.stringify(refreshBody),
      await replayRes.clone().text(),
      await logoutRes.clone().text(),
    ].join('|');
    const clientReadableHeaders = [selectRes, refreshRes, logoutRes]
      .flatMap((r) =>
        [...r.headers.entries()]
          .filter(([k]) => k.toLowerCase() !== 'set-cookie')
          .map(([k, v]) => `${k}:${v}`),
      )
      .join('|');
    check(
      '22. No refresh token appears in any response body or client-readable header',
      !allBodies.includes(REFRESH_1) &&
        !allBodies.includes(REFRESH_2) &&
        !clientReadableHeaders.includes(REFRESH_1) &&
        !clientReadableHeaders.includes(REFRESH_2),
    );
    const allSetCookies = [selectRes, refreshRes, logoutRes]
      .flatMap((r) => setCookieHeaders(r))
      .join('|');
    check(
      '23. Access tokens are never persisted into a cookie by these routes',
      !allSetCookies.includes(ACCESS_1) && !allSetCookies.includes(ACCESS_2),
    );
    check(
      '24. No refresh token was written to the server log',
      !serverLog.includes(REFRESH_1) && !serverLog.includes(REFRESH_2),
    );
  } finally {
    teardown();
  }

  console.log('================================================================');
  console.log(`📊 T7 SESSION-ROUTE SUITE: ${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
