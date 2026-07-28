import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma.service';
import helmet from 'helmet';
import * as http from 'http';
import { assertDisposableTestDatabase } from './test-db-guard';

/**
 * T13 cleanup discipline.
 *
 * This suite previously had NO teardown: every run permanently added two users,
 * two organizations, two workspaces, and their refresh tokens to the target
 * database. Ids of everything it creates are now collected here and removed
 * afterwards, scoped to those ids only -- never a global `deleteMany()`.
 *
 * Module scope so both the normal exit path and the exception path can reach it.
 */
const createdFixtures = {
  userIds: [] as string[],
  workspaceIds: [] as string[],
  organizationIds: [] as string[],
};
let prismaForTeardown: { [key: string]: any } | null = null;

async function teardownFixtures(): Promise<void> {
  const prisma = prismaForTeardown;
  if (!prisma) return;
  const { userIds, workspaceIds, organizationIds } = createdFixtures;
  if (userIds.length === 0 && organizationIds.length === 0) return;
  try {
    // Dependency order. Deleting the Organization cascades to its Workspaces
    // and Memberships; Users are not organization-scoped, so they are removed
    // explicitly. Every filter is bounded by ids this run created.
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.membership.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await prisma.organization.deleteMany({
      where: { id: { in: organizationIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    console.log(
      `[cleanup] removed ${userIds.length} test user(s) and ${organizationIds.length} test organization(s) created by this run.`,
    );
  } catch (error: unknown) {
    // Never let cleanup failure mask the suite's own result.
    console.error(
      '[cleanup] fixture teardown failed; records may remain:',
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function main() {
  // T13 GUARD -- FIRST STATEMENT, before the Nest application is even built.
  //
  // This suite registers real users and workspaces over HTTP and has no
  // teardown, so every run permanently adds rows to whatever database it is
  // pointed at. Bootstrapping the app first would open a Prisma connection to
  // that database before anything had checked which database it is, so the
  // guard runs ahead of `createTestingModule`.
  await assertDisposableTestDatabase('verify-http-staging.ts');

  const startTime = Date.now();
  console.log('🧪 RUNNING RIGOROUS STAGING REAL HTTP TEST SUITE (RELEASE 0.1.2)');
  console.log('=================================================================');

  let passedTests = 0;
  let failedTests = 0;

  function assert(condition: boolean, message: string) {
    if (condition) {
      passedTests++;
      console.log(`✅ [PASS] ${message}`);
    } else {
      failedTests++;
      console.error(`❌ [FAIL] ${message}`);
    }
  }

  // Initialize testing NestJS app instance
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app: INestApplication = moduleFixture.createNestApplication();
  app.use(helmet());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Staging CORS allowlist configuration
  const allowedOrigins = [
    'https://staging-crm.demmmarketing.com',
    'http://localhost:3000',
    'http://localhost:3001',
  ];

  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS Violation: Origin '${origin}' is not allowed.`));
      }
    },
    credentials: true,
  });

  await app.listen(0);
  const address: any = app.getHttpServer().address();
  const port = address.port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const prisma = app.get(PrismaService);
  prismaForTeardown = prisma as unknown as { [key: string]: any };

  // Helper HTTP request function
  function makeRequest(
    method: string,
    path: string,
    body?: any,
    headers: Record<string, string> = {},
  ): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: any }> {
    return new Promise((resolve, reject) => {
      const payloadStr = body ? JSON.stringify(body) : '';
      const reqHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        ...headers,
      };

      if (body) {
        reqHeaders['Content-Length'] = Buffer.byteLength(payloadStr).toString();
      }

      const urlObj = new URL(`${baseUrl}${path}`);

      const req = http.request(
        urlObj,
        {
          method,
          headers: reqHeaders,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            let parsedBody = data;
            try {
              parsedBody = JSON.parse(data);
            } catch (e) {}
            resolve({ statusCode: res.statusCode || 500, headers: res.headers, body: parsedBody });
          });
        },
      );

      req.on('error', reject);
      if (body) req.write(payloadStr);
      req.end();
    });
  }

  // 1. Operational Endpoints & Observability
  console.log('\n--- Part 1: Operational Endpoints & Observability ---');
  const healthRes = await makeRequest('GET', '/health');
  assert(
    healthRes.statusCode === 200 && healthRes.body.status === 'ok' && healthRes.body.database === 'up',
    'HTTP GET /health: 200 OK with database connectivity.',
  );

  const readyRes = await makeRequest('GET', '/ready');
  assert(readyRes.statusCode === 200 && readyRes.body.status === 'ready', 'HTTP GET /ready: 200 OK readiness probe.');

  const versionRes = await makeRequest('GET', '/version');
  assert(
    versionRes.statusCode === 200 && versionRes.body.version === '0.1.3' && !!versionRes.body.commitSha,
    'HTTP GET /version: 200 OK returning dynamic Git commit SHA without leaking secrets.',
  );
  assert(!!versionRes.headers['x-correlation-id'], 'HTTP Correlation ID: x-correlation-id attached to response headers.');

  // 2. Strict CORS Verification
  console.log('\n--- Part 2: Rigorous HTTP CORS Policy Verification ---');
  // Approved staging origin
  const stagingCorsRes = await makeRequest('GET', '/version', undefined, { Origin: 'https://staging-crm.demmmarketing.com' });
  assert(
    stagingCorsRes.headers['access-control-allow-origin'] === 'https://staging-crm.demmmarketing.com' &&
      stagingCorsRes.headers['access-control-allow-credentials'] === 'true',
    'HTTP CORS: Approved staging origin (https://staging-crm.demmmarketing.com) accepted.',
  );

  // Localhost origin (development convenience)
  const localCorsRes = await makeRequest('GET', '/version', undefined, { Origin: 'http://localhost:3000' });
  assert(
    localCorsRes.headers['access-control-allow-origin'] === 'http://localhost:3000',
    'HTTP CORS: Localhost origin (http://localhost:3000) allowed for local dev/staging access.',
  );

  // Unauthorized origin
  const unauthCorsRes = await makeRequest('GET', '/version', undefined, { Origin: 'https://unauthorized.example' });
  assert(
    !unauthCorsRes.headers['access-control-allow-origin'],
    'HTTP CORS: Unauthorized origin (https://unauthorized.example) correctly rejected without Access-Control-Allow-Origin header.',
  );

  // 3. Validation Pipe Rejections (HTTP 400)
  console.log('\n--- Part 3: HTTP ValidationPipe Input Rejections (HTTP 400) ---');
  const unknownFieldRes = await makeRequest('POST', '/api/auth/login', {
    email: 'valid@example.com',
    passwordPlain: 'password123',
    unapprovedExtraField: 'HackerPayload',
  });
  assert(unknownFieldRes.statusCode === 400, 'HTTP Validation: Unknown non-whitelisted property rejected with HTTP 400 Bad Request.');

  const malformedEmailRes = await makeRequest('POST', '/api/auth/login', {
    email: 'not-an-email-address',
    passwordPlain: 'password123',
  });
  assert(malformedEmailRes.statusCode === 400, 'HTTP Validation: Malformed email rejected with HTTP 400 Bad Request.');

  const missingFieldRes = await makeRequest('POST', '/api/auth/login', {
    passwordPlain: 'password123',
  });
  assert(missingFieldRes.statusCode === 400, 'HTTP Validation: Missing required email field rejected with HTTP 400 Bad Request.');

  // 4. Real HTTP Auth & Token Lifecycle
  console.log('\n--- Part 4: Real HTTP Authentication & Refresh Session ---');
  const emailA = `user_a_${Date.now()}@example.com`;
  const regA = await makeRequest('POST', '/api/auth/register', {
    email: emailA,
    passwordPlain: 'super-secure-password-123',
    firstName: 'UserA',
    lastName: 'Tester',
    workspaceName: 'Workspace A',
    subdomain: `sub_a_${Date.now()}`,
  });
  assert(regA.statusCode === 201 && !!regA.body.id, 'HTTP POST /api/auth/register: Registered User A successfully.');
  if (regA.body?.id) createdFixtures.userIds.push(regA.body.id);
  if (regA.body?.workspaceId) createdFixtures.workspaceIds.push(regA.body.workspaceId);
  if (regA.body?.organizationId) createdFixtures.organizationIds.push(regA.body.organizationId);

  // A second, unrelated account. Used in Part 4b to prove that the caller's
  // identity is derived from the pre-auth token and never from a body field.
  const emailB = `user_b_${Date.now()}@example.com`;
  const regB = await makeRequest('POST', '/api/auth/register', {
    email: emailB,
    passwordPlain: 'super-secure-password-456',
    firstName: 'UserB',
    lastName: 'Tester',
    workspaceName: 'Workspace B',
    subdomain: `sub_b_${Date.now()}`,
  });
  assert(regB.statusCode === 201 && !!regB.body.id, 'HTTP POST /api/auth/register: Registered User B successfully.');
  if (regB.body?.id) createdFixtures.userIds.push(regB.body.id);
  if (regB.body?.workspaceId) createdFixtures.workspaceIds.push(regB.body.workspaceId);
  if (regB.body?.organizationId) createdFixtures.organizationIds.push(regB.body.organizationId);

  // Login is step ONE of two. It proves the password and returns a short-lived,
  // single-purpose preAuthToken plus the accessible workspace list. It must NOT
  // hand out a usable access token by itself.
  const loginA = await makeRequest('POST', '/api/auth/login', {
    email: emailA,
    passwordPlain: 'super-secure-password-123',
  });
  assert(
    loginA.statusCode === 201 && !!loginA.body.preAuthToken && !loginA.body.access_token,
    'HTTP Session: Login issues a preAuthToken and no access token (two-step contract).',
  );
  const wsAId = loginA.body.workspaces[0].workspaceId;

  // Step TWO: workspace selection. Identity comes from the preAuthToken in the
  // Authorization header; the body carries ONLY the workspaceId that
  // SelectWorkspaceDto accepts. Sending a userId here is the obsolete,
  // insecure contract and is asserted dead in Part 4b below.
  const selectA = await makeRequest(
    'POST',
    '/api/auth/select-workspace',
    { workspaceId: wsAId },
    { Authorization: `Bearer ${loginA.body.preAuthToken}` },
  );
  assert(
    selectA.statusCode === 201 && !!selectA.body.access_token && !!selectA.body.refresh_token,
    'HTTP Session: Workspace selection issued Access Token and Refresh Token.',
  );

  // Token rotation over HTTP
  const refreshA = await makeRequest('POST', '/api/auth/refresh', {
    refreshToken: selectA.body.refresh_token,
  });
  assert(
    refreshA.statusCode === 201 &&
      !!refreshA.body.refresh_token &&
      refreshA.body.refresh_token !== selectA.body.refresh_token,
    'HTTP Session: Refresh token rotated successfully.',
  );

  // Reusing old refresh token over HTTP
  const reuseA = await makeRequest('POST', '/api/auth/refresh', {
    refreshToken: selectA.body.refresh_token,
  });
  assert(reuseA.statusCode === 401, 'HTTP Session Security: Reused old refresh token rejected with HTTP 401 Unauthorized.');

  // T6 DELIBERATELY INVERTED THIS ASSERTION. Until T6, replaying a rotated
  // token rejected only the presented token and the newest token stayed valid;
  // this suite recorded that as the live contract. T6 treats a replayed rotated
  // token as suspected theft and revokes every active refresh token for that
  // user, so the newest token must now be dead too.
  // MEASURED LIMIT, made deterministic. A replay arriving inside the tolerance
  // is indistinguishable from a concurrent second tab and is refused WITHOUT
  // family revocation -- the documented residual detection window (see
  // AuthService.CLOCK_SKEW_ALLOWANCE_MS). This suite replays immediately, so
  // the revocation is backdated past that window to exercise the theft path.
  await prisma.refreshToken.updateMany({
    where: {
      hashedToken: require('crypto')
        .createHash('sha256')
        .update(selectA.body.refresh_token)
        .digest('hex'),
    },
    data: { revokedAt: new Date(Date.now() - 60_000) },
  });
  await makeRequest('POST', '/api/auth/refresh', {
    refreshToken: selectA.body.refresh_token,
  });

  const refreshAfterReuse = await makeRequest('POST', '/api/auth/refresh', {
    refreshToken: refreshA.body.refresh_token,
  });
  assert(
    refreshAfterReuse.statusCode === 401 &&
      !refreshAfterReuse.body.access_token &&
      !refreshAfterReuse.body.refresh_token,
    'HTTP Session Security: Replaying a rotated token revokes the session family, so the newest token is now rejected with 401.',
  );

  // Detection must not lock the account out permanently -- re-authentication
  // still establishes a clean session.
  const reLoginA = await makeRequest('POST', '/api/auth/login', {
    email: emailA,
    passwordPlain: 'super-secure-password-123',
  });
  const reSelectA = await makeRequest(
    'POST',
    '/api/auth/select-workspace',
    { workspaceId: wsAId },
    { Authorization: `Bearer ${reLoginA.body.preAuthToken}` },
  );
  assert(
    reSelectA.statusCode === 201 &&
      !!reSelectA.body.access_token &&
      !!reSelectA.body.refresh_token,
    'HTTP Session: A fresh login establishes a new working session after replay detection.',
  );

  // 4b. Security regression: the obsolete insecure contract must stay dead.
  console.log('\n--- Part 4b: Obsolete Insecure Workspace-Selection Contract Rejected ---');
  const loginB = await makeRequest('POST', '/api/auth/login', {
    email: emailB,
    passwordPlain: 'super-secure-password-456',
  });
  const wsBId = loginB.body.workspaces[0].workspaceId;

  // The original exploit shape: no pre-auth header, identity asserted by a
  // client-supplied userId. `userId` is not a member of SelectWorkspaceDto, so
  // the global ValidationPipe whitelist rejects the request (400) before the
  // handler ever runs. This is the hole that allowed account takeover for
  // anyone who learned another user's id.
  const legacyExploit = await makeRequest('POST', '/api/auth/select-workspace', {
    userId: regB.body.id,
    workspaceId: wsBId,
  });
  assert(
    legacyExploit.statusCode === 400 &&
      !legacyExploit.body.access_token &&
      !legacyExploit.body.refresh_token,
    'HTTP Session Security: Obsolete userId-in-body workspace selection rejected (400) and issued no tokens.',
  );

  // The same request without the illegal field: now the missing pre-auth token
  // is what stops it.
  const noPreAuth = await makeRequest('POST', '/api/auth/select-workspace', {
    workspaceId: wsBId,
  });
  assert(
    noPreAuth.statusCode === 401 &&
      !noPreAuth.body.access_token &&
      !noPreAuth.body.refresh_token,
    'HTTP Session Security: Workspace selection without a pre-auth token rejected (401) and issued no tokens.',
  );

  // Identity comes from the token, never the body: User A's own valid
  // preAuthToken still cannot select User B's workspace.
  const crossUser = await makeRequest(
    'POST',
    '/api/auth/select-workspace',
    { workspaceId: wsBId },
    { Authorization: `Bearer ${loginA.body.preAuthToken}` },
  );
  assert(
    (crossUser.statusCode === 403 || crossUser.statusCode === 401) &&
      !crossUser.body.access_token &&
      !crossUser.body.refresh_token,
    "HTTP Session Security: A valid pre-auth token cannot select another user's workspace.",
  );

  // 5. Tenant Isolation Attacks over HTTP
  console.log('\n--- Part 5: Real HTTP Cross-Tenant Isolation Attacks ---');
  const crossTenantRes = await makeRequest('GET', '/contacts/non-existent-uuid', undefined, {
    Authorization: `Bearer ${selectA.body.access_token}`,
    'x-workspace-id': '00000000-0000-0000-0000-000000000000',
  });
  assert(
    crossTenantRes.statusCode === 401 || crossTenantRes.statusCode === 403 || crossTenantRes.statusCode === 404,
    'HTTP Tenant Isolation: Cross-workspace resource read rejected with HTTP 401/403/404.',
  );

  // Teardown BEFORE the app closes -- this covers both the all-passed exit and
  // the failed-assertion exit below, since both fall through here.
  await teardownFixtures();
  await app.close();

  const duration = Date.now() - startTime;
  console.log('\n=================================================================');
  console.log(`📊 COMPREHENSIVE STAGING HTTP RUN SUMMARY: Passed: ${passedTests}, Failed: ${failedTests}, Duration: ${duration}ms`);

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

// The exception path. Together with the call before `app.close()`, this gives
// the same coverage a `finally` would: fixtures are removed whether the suite
// passes, fails an assertion, or throws. A real `finally` is not usable here
// because `main()` exits the process itself.
main().catch(async (e) => {
  console.error(e);
  await teardownFixtures();
  process.exit(1);
});
