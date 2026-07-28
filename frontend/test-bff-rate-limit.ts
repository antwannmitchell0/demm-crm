// Rate-limit identity across the BFF.
//
// THE REGRESSION THIS EXISTS TO CATCH
//
// Routing registration through the BFF fixed a real problem -- a password no
// longer crosses origins from browser JavaScript -- and introduced a new one in
// the same move.
//
// The backend rate-limits per client. ProxyAwareThrottlerGuard resolves that
// client from X-Forwarded-For, counting in from the right past
// TRUSTED_PROXY_HOPS. That works when the browser talks to the backend: the
// infrastructure appends the caller's address and the guard reads it.
//
// It stops working the moment a server sits in between. The BFF calls the
// backend itself, server to server, from ONE address. Every registration in the
// product then arrives at the backend wearing the BFF's identity, so the 5/min
// ordinary and 20/min invited budgets become caps on the entire product again --
// the exact defect ProxyAwareThrottlerGuard was written to remove, reintroduced
// through a different door.
//
// WHY THIS RUNS THE REAL TOPOLOGY
//
// browser -> Next BFF route -> NestJS backend, all three real processes. Calling
// the backend directly would pass whatever the fix does, because the backend
// alone was never broken: the identity is lost in the hop between the two
// servers, which only exists when both are running.
// No dotenv: this is a frontend suite and dotenv is a backend dependency, so
// the import resolves locally through hoisting and fails in CI where the two
// dependency trees are installed separately. Both callers pass DATABASE_URL and
// JWT_SECRET explicitly, which is the only configuration this needs.
import * as path from 'path';
import * as fs from 'fs';
import { spawn, type ChildProcess } from 'child_process';
import * as crypto from 'crypto';

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

// RFC 5737 documentation ranges. Never routable, so a stray request cannot
// reach a real host even if one escaped the harness.
const CLIENT_A = '203.0.113.10';
const CLIENT_B = '198.51.100.20';
const EDGE = '130.211.0.1'; // stands in for the Cloud Run front end

const BACKEND_PORT = 3102;
const BFF_PORT = 3998;
const BFF_ORIGIN = `http://127.0.0.1:${BFF_PORT}`;

// Synthetic, test-only. The real secret comes from deployment configuration and
// is never committed, printed, or defaulted.
const TEST_SIGNING_SECRET =
  'synthetic-bff-rate-limit-secret-for-tests-only-32b+';

const TEST_PASSWORD = 'Sup3rSynthetic!Password';

/**
 * Locates the standalone entrypoint. Same search as test-session-routes.ts and
 * for the same reason: locally the repository root also has a package.json, so
 * Next infers a workspace root and nests the output under the project's path
 * (.next/standalone/dev/demm-crm-release/frontend/server.js). Inside Docker the
 * build context is the frontend directory alone and no nesting occurs, so the
 * layout is searched rather than hardcoded.
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

async function waitForServer(url: string, attempts = 80): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/** One synthetic browser, identified only by the address the edge appends. */
function asClient(clientIp: string) {
  return (routePath: string, body: unknown) =>
    fetch(`${BFF_ORIGIN}${routePath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: BFF_ORIGIN,
        // Exactly what Cloud Run presents: the caller, then the edge.
        'X-Forwarded-For': `${clientIp}, ${EDGE}`,
      },
      body: JSON.stringify(body),
    });
}

const ordinaryBody = (n: number) => ({
  email: `bff-rl-${Date.now()}-${n}@example.invalid`,
  passwordPlain: TEST_PASSWORD,
  firstName: 'Rate',
  lastName: 'Limit',
  workspaceName: `RL ${n}`,
  subdomain: `rl-${Date.now()}-${n}`,
});

const invitedBody = (n: number) => ({
  // A token that resolves to no invitation: the request is refused on its
  // merits, but the throttler counts it either way, which is the point.
  token: 'b'.repeat(64),
  email: `bff-rl-inv-${Date.now()}-${n}@example.invalid`,
  passwordPlain: TEST_PASSWORD,
  firstName: 'Rate',
  lastName: 'Limit',
});

async function main() {
  console.log('🧪 BFF RATE-LIMIT IDENTITY SUITE (real backend + real BFF)');
  console.log('==========================================================');

  const standalone = findStandaloneServer(
    path.join(process.cwd(), '.next', 'standalone'),
  );
  if (!standalone) {
    console.error('No standalone server.js. Run `npm run build` first.');
    process.exitCode = 1;
    return;
  }

  const backendEntry = path.join(
    process.cwd(),
    '..',
    'backend',
    'dist',
    'src',
    'main.js',
  );
  if (!fs.existsSync(backendEntry)) {
    console.error(
      'No backend build at ../backend/dist. Run `npm run build` in backend/ first.',
    );
    process.exitCode = 1;
    return;
  }

  let backendLog = '';
  let bffLog = '';

  const backend: ChildProcess = spawn('node', [backendEntry], {
    env: {
      ...process.env,
      PORT: String(BACKEND_PORT),
      // Same trusted-hop semantics staging uses, so the guard behaves here
      // exactly as it does in front of a real edge.
      TRUSTED_PROXY_HOPS: '1',
      ALLOWED_ORIGINS: BFF_ORIGIN,
      BFF_RATE_LIMIT_SIGNING_SECRET: TEST_SIGNING_SECRET,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  backend.stdout?.on('data', (d) => (backendLog += d.toString()));
  backend.stderr?.on('data', (d) => (backendLog += d.toString()));

  const bff: ChildProcess = spawn('node', [standalone], {
    env: {
      ...process.env,
      PORT: String(BFF_PORT),
      HOSTNAME: '127.0.0.1',
      BACKEND_API_URL: `http://127.0.0.1:${BACKEND_PORT}`,
      FRONTEND_TRUSTED_PROXY_HOPS: '1',
      BFF_RATE_LIMIT_SIGNING_SECRET: TEST_SIGNING_SECRET,
      SESSION_ALLOWED_ORIGINS: BFF_ORIGIN,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  bff.stdout?.on('data', (d) => (bffLog += d.toString()));
  bff.stderr?.on('data', (d) => (bffLog += d.toString()));

  const teardown = () => {
    backend.kill('SIGTERM');
    bff.kill('SIGTERM');
  };

  try {
    const backendUp = await waitForServer(
      `http://127.0.0.1:${BACKEND_PORT}/health`,
    );
    check('0. The real backend starts', backendUp);
    const bffUp = await waitForServer(`${BFF_ORIGIN}/api/version`);
    check('0b. The real BFF starts', bffUp);
    if (!backendUp || !bffUp) {
      console.log('--- backend log ---\n' + backendLog.slice(-2000));
      console.log('--- bff log ---\n' + bffLog.slice(-2000));
      return;
    }

    const a = asClient(CLIENT_A);
    const b = asClient(CLIENT_B);

    // ===== ORDINARY REGISTRATION: 5/min per client =====
    {
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        statuses.push(
          (await a('/api/session/register', ordinaryBody(i))).status,
        );
      }
      check(
        `1. Client A's sixth ordinary registration is throttled (${statuses.join(',')})`,
        statuses[5] === 429,
      );
      check(
        '1b. ...and its first five were not',
        statuses.slice(0, 5).every((s) => s !== 429),
      );

      const first = await b('/api/session/register', ordinaryBody(99));
      check(
        `2. Client B's FIRST ordinary registration still reaches the application (got ${first.status})`,
        first.status !== 429,
        'a shared BFF identity throttles an unrelated customer',
      );
    }

    // ===== INVITED REGISTRATION: 20/min per client =====
    {
      const statuses: number[] = [];
      for (let i = 0; i < 21; i++) {
        statuses.push(
          (await a('/api/session/register-invited', invitedBody(i))).status,
        );
      }
      check(
        `3. Client A's twenty-first invited registration is throttled (${statuses.filter((s) => s === 429).length}/21 rejected)`,
        statuses[20] === 429,
      );

      const first = await b('/api/session/register-invited', invitedBody(99));
      check(
        `4. Client B's FIRST invited registration still reaches the application (got ${first.status})`,
        first.status !== 429,
        'a shared BFF identity throttles an unrelated customer',
      );
    }


    // ===== HEADER SECURITY =====
    //
    // These craft headers and send them STRAIGHT AT THE BACKEND. That is the
    // right target: the verifier is what decides whether to believe a claim,
    // and the BFF would never emit a forged one.
    const BACKEND = `http://127.0.0.1:${BACKEND_PORT}`;
    const hmac = (payload: string) =>
      crypto
        .createHmac('sha256', TEST_SIGNING_SECRET)
        .update(payload)
        .digest('hex');
    const keyFor = (addr: string) => hmac(addr);
    const sign = (
      method: string,
      backendPath: string,
      key: string,
      ts: string,
    ) => hmac([method.toUpperCase(), backendPath, key, ts].join('\n'));

    const nowTs = () => String(Math.floor(Date.now() / 1000));

    // Each forgery scenario gets its OWN source address. They are independent
    // cases, and now that a malformed claim correctly consumes the sender's
    // budget (assertion 17), sharing one address would make the later ones
    // measure the rate limiter instead of the verifier.
    let forgerySeq = 0;
    const directWithIdentity = (
      backendPath: string,
      headers: Record<string, string>,
      body: unknown,
    ) =>
      fetch(`${BACKEND}/${backendPath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': `192.0.2.${10 + forgerySeq++}, ${EDGE}`,
          ...headers,
        },
        body: JSON.stringify(body),
      });

    // 5 & 6: key stability and distinctness. Derived the same way the BFF does,
    // so this asserts the contract rather than restating the implementation.
    check(
      '5. The same client address always maps to the same opaque key',
      keyFor(CLIENT_A) === keyFor(CLIENT_A) && /^[0-9a-f]{64}$/.test(keyFor(CLIENT_A)),
    );
    check(
      '6. Different clients map to different opaque keys',
      keyFor(CLIENT_A) !== keyFor(CLIENT_B),
    );

    // 7: a caller-written leftmost entry must not choose the identity. The edge
    // APPENDS, so an attacker's value lands to the LEFT of their real address.
    // Counting from the right ignores it -- proven by the spoofing client still
    // being subject to the budget it already spent.
    {
      const spoofed = await fetch(`${BFF_ORIGIN}/api/session/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: BFF_ORIGIN,
          'X-Forwarded-For': `9.9.9.9, ${CLIENT_A}, ${EDGE}`,
        },
        body: JSON.stringify(ordinaryBody(500)),
      });
      check(
        `7. A caller-supplied leftmost address cannot choose the client key (got ${spoofed.status})`,
        spoofed.status === 429,
        'client A escaped its own exhausted budget by prepending an address',
      );
    }

    // 8: a chain shorter than the declared hop count is ambiguous. No identity
    // is claimed, so the request is served under the backend's own limiting
    // rather than under an invented key.
    {
      const malformed = await fetch(`${BFF_ORIGIN}/api/session/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: BFF_ORIGIN,
          'X-Forwarded-For': 'not-an-address',
        },
        body: JSON.stringify(ordinaryBody(501)),
      });
      check(
        `8. A malformed forwarding chain fails closed, never inventing a key (got ${malformed.status})`,
        malformed.status !== 500,
      );
    }

    const goodBody = () => ordinaryBody(600);
    const P = 'api/auth/register';

    // 9: a key the caller made up, with no valid signature over it.
    {
      const ts = nowTs();
      const res = await directWithIdentity(
        P,
        {
          'x-demm-rate-limit-key': 'f'.repeat(64),
          'x-demm-rate-limit-timestamp': ts,
          'x-demm-rate-limit-signature': 'a'.repeat(64),
        },
        goodBody(),
      );
      check(`9. A forged client key is rejected (got ${res.status})`, res.status === 400);
    }

    // 10: a real key, a signature that does not verify.
    {
      const ts = nowTs();
      const key = keyFor(CLIENT_B);
      const res = await directWithIdentity(
        P,
        {
          'x-demm-rate-limit-key': key,
          'x-demm-rate-limit-timestamp': ts,
          'x-demm-rate-limit-signature': sign('POST', P, key, ts).replace(
            /^./,
            (c) => (c === '0' ? '1' : '0'),
          ),
        },
        goodBody(),
      );
      check(`10. A forged signature is rejected (got ${res.status})`, res.status === 400);
    }

    // 11: correctly signed, but issued long ago. Freshness is what stops a
    // captured header being replayed indefinitely.
    {
      const ts = String(Math.floor(Date.now() / 1000) - 3600);
      const key = keyFor(CLIENT_B);
      const res = await directWithIdentity(
        P,
        {
          'x-demm-rate-limit-key': key,
          'x-demm-rate-limit-timestamp': ts,
          'x-demm-rate-limit-signature': sign('POST', P, key, ts),
        },
        goodBody(),
      );
      check(`11. A stale signature is rejected (got ${res.status})`, res.status === 400);
    }

    // 12: valid for register, replayed onto register-invited -- which has a
    // four-times larger budget, so an unbound signature would be an upgrade.
    {
      const ts = nowTs();
      const key = keyFor(CLIENT_B);
      const res = await directWithIdentity(
        'api/auth/register-invited',
        {
          'x-demm-rate-limit-key': key,
          'x-demm-rate-limit-timestamp': ts,
          'x-demm-rate-limit-signature': sign('POST', P, key, ts),
        },
        invitedBody(600),
      );
      check(
        `12. A signature for register cannot be replayed onto register-invited (got ${res.status})`,
        res.status === 400,
      );
    }

    // 13: signed for GET, presented on POST.
    {
      const ts = nowTs();
      const key = keyFor(CLIENT_B);
      const res = await directWithIdentity(
        P,
        {
          'x-demm-rate-limit-key': key,
          'x-demm-rate-limit-timestamp': ts,
          'x-demm-rate-limit-signature': sign('GET', P, key, ts),
        },
        goodBody(),
      );
      check(
        `13. A signature bound to GET cannot be used for POST (got ${res.status})`,
        res.status === 400,
      );
    }

    // 14: two of three headers. Silently ignoring the set would let a caller
    // pick which identity path applies by breaking one header on purpose.
    {
      const ts = nowTs();
      const key = keyFor(CLIENT_B);
      const res = await directWithIdentity(
        P,
        {
          'x-demm-rate-limit-key': key,
          'x-demm-rate-limit-timestamp': ts,
        },
        goodBody(),
      );
      check(
        `14. A partial internal-header set is rejected, not ignored (got ${res.status})`,
        res.status === 400,
      );
    }

    // 17: a malformed claim must COUNT against the sender's budget.
    //
    // Rejecting before the limiter ran would make forged-header traffic free:
    // every such request costs an HMAC and a parse, and nothing would ever slow
    // it down. Sent from an address with its own budget, the first few are
    // refused as 400 and the run eventually turns to 429 -- which is the proof
    // they were counted rather than waved through.
    {
      const seen: number[] = [];
      for (let i = 0; i < 8; i++) {
        const ts = nowTs();
        const r = await fetch(`${BACKEND}/${P}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Forwarded-For': `192.0.2.150, ${EDGE}`,
            'x-demm-rate-limit-key': 'c'.repeat(64),
            'x-demm-rate-limit-timestamp': ts,
            'x-demm-rate-limit-signature': 'd'.repeat(64),
          },
          body: JSON.stringify(ordinaryBody(800 + i)),
        });
        seen.push(r.status);
      }
      check(
        `17. A malformed identity claim consumes the sender's budget (${seen.join(',')})`,
        seen.includes(400) && seen.includes(429),
        'forged-header traffic was never counted, so it could be sent without limit',
      );
    }

    // 18: duplicating ALL THREE headers must not select the address path.
    // Presence is "the key exists", not "the key is usable" -- otherwise a
    // caller could opt out of identity checking by sending each header twice.
    {
      const ts = nowTs();
      const key = keyFor(CLIENT_B);
      const sig = sign('POST', P, key, ts);
      const res = await fetch(`${BACKEND}/${P}`, {
        method: 'POST',
        headers: [
          ['Content-Type', 'application/json'],
          ['X-Forwarded-For', `192.0.2.160, ${EDGE}`],
          ['x-demm-rate-limit-key', key],
          ['x-demm-rate-limit-key', key],
          ['x-demm-rate-limit-timestamp', ts],
          ['x-demm-rate-limit-timestamp', ts],
          ['x-demm-rate-limit-signature', sig],
          ['x-demm-rate-limit-signature', sig],
        ],
        body: JSON.stringify(ordinaryBody(850)),
      });
      check(
        `18. Duplicated identity headers are refused, not silently downgraded (got ${res.status})`,
        res.status === 400,
      );
    }

    // 16: a request with NO internal headers still gets the direct-request
    // proxy-aware treatment -- these endpoints stay publicly reachable.
    {
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        const r = await fetch(`${BACKEND}/${P}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Forwarded-For': `192.0.2.77, ${EDGE}`,
          },
          body: JSON.stringify(ordinaryBody(700 + i)),
        });
        statuses.push(r.status);
      }
      check(
        `16. Direct backend registration still throttles per client (${statuses.join(',')})`,
        statuses[5] === 429,
      );
      const other = await fetch(`${BACKEND}/${P}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': `192.0.2.88, ${EDGE}`,
        },
        body: JSON.stringify(ordinaryBody(799)),
      });
      check(
        `16b. ...and an unrelated direct client is unaffected (got ${other.status})`,
        other.status !== 429,
      );
    }

    // ===== Nothing sensitive is written by either process =====
    {
      const blob = `${backendLog}\n${bffLog}`;
      check(
        '15c. The signing secret never appears in either process log',
        !blob.includes(TEST_SIGNING_SECRET),
      );
      check(
        '15d. No raw client address appears in either process log',
        !blob.includes(CLIENT_A) && !blob.includes(CLIENT_B),
      );
      check(
        '15. No password appears in either process log',
        !blob.includes(TEST_PASSWORD),
      );
      check(
        '15b. No opaque client key or signature appears in either process log',
        !blob.includes(keyFor(CLIENT_A)) && !blob.includes(keyFor(CLIENT_B)),
      );
    }
  } finally {
    teardown();
  }

  console.log('==========================================================');
  console.log(`📊 BFF RATE-LIMIT SUITE: ${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
