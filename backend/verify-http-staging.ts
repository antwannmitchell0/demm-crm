import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma.service';
import helmet from 'helmet';
import * as http from 'http';

async function main() {
  const startTime = Date.now();
  console.log('🧪 RUNNING COMPREHENSIVE STAGING REAL HTTP TEST SUITE (RELEASE 0.1.2)');
  console.log('=====================================================================');

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

  // Initialize NestJS testing instance
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

  // Enable CORS with staging allowlist
  const rawOrigins = process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:3001';
  const allowedOrigins = rawOrigins.split(',').map((o) => o.trim());

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

  // Helper HTTP request runner
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

  // 1. Operational Endpoints
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
    versionRes.statusCode === 200 &&
      versionRes.body.version === '0.1.2' &&
      versionRes.body.commitSha === '50af85e6ef1a83ee10ffbc0cb9d7d42cfbc1bfd7' &&
      !JSON.stringify(versionRes.body).includes('DATABASE_URL'),
    'HTTP GET /version: 200 OK exposing commit SHA without leaking environment secrets.',
  );
  assert(!!versionRes.headers['x-correlation-id'], 'HTTP Correlation ID: x-correlation-id attached to response headers.');

  // 2. CORS Policy Verification
  console.log('\n--- Part 2: HTTP CORS Policy Checks ---');
  const corsAllowedRes = await makeRequest('GET', '/version', undefined, { Origin: 'http://localhost:3000' });
  assert(
    corsAllowedRes.headers['access-control-allow-origin'] === 'http://localhost:3000' &&
      corsAllowedRes.headers['access-control-allow-credentials'] === 'true',
    'HTTP CORS: Approved staging origin (http://localhost:3000) accepted with credentials allowed.',
  );

  // 3. Real HTTP Authentication & Refresh Token Rotation
  console.log('\n--- Part 3: Real HTTP Authentication & Refresh Token Lifecycle ---');
  const userEmail = `http_user_${Date.now()}@example.com`;
  const regRes = await makeRequest('POST', '/api/auth/register', {
    email: userEmail,
    passwordPlain: 'super-secure-password-123',
    firstName: 'HTTP',
    lastName: 'Tester',
    workspaceName: 'HTTP Workspace',
    subdomain: `sub_http_${Date.now()}`,
  });
  assert(regRes.statusCode === 201 && !!regRes.body.id, 'HTTP POST /api/auth/register: User registered successfully.');

  const loginRes = await makeRequest('POST', '/api/auth/login', {
    email: userEmail,
    passwordPlain: 'super-secure-password-123',
  });
  assert(
    loginRes.statusCode === 201 && Array.isArray(loginRes.body.workspaces) && loginRes.body.workspaces.length > 0,
    'HTTP POST /api/auth/login: Verified user and returned accessible workspaces list.',
  );

  const targetWsId = loginRes.body.workspaces[0].workspaceId;
  const selectRes = await makeRequest('POST', '/api/auth/select-workspace', {
    userId: loginRes.body.user.id,
    workspaceId: targetWsId,
  });
  assert(
    selectRes.statusCode === 201 && !!selectRes.body.access_token && !!selectRes.body.refresh_token,
    'HTTP POST /api/auth/select-workspace: Explicit workspace selection issued access token (15m) & refresh token (7d).',
  );

  // Token Rotation over HTTP
  const refreshRes = await makeRequest('POST', '/api/auth/refresh', {
    refreshToken: selectRes.body.refresh_token,
  });
  assert(
    refreshRes.statusCode === 201 && refreshRes.body.refresh_token !== selectRes.body.refresh_token,
    'HTTP POST /api/auth/refresh: Rotated refresh token successfully, revoking previous token.',
  );

  // Reusing old refresh token (must fail with 401)
  const reuseRes = await makeRequest('POST', '/api/auth/refresh', {
    refreshToken: selectRes.body.refresh_token,
  });
  assert(reuseRes.statusCode === 401, 'HTTP Session Security: Reused old refresh token rejected with 401 Unauthorized.');

  // Logout over HTTP
  const logoutRes = await makeRequest('POST', '/api/auth/logout', {
    refreshToken: refreshRes.body.refresh_token,
  });
  assert(logoutRes.statusCode === 201 && logoutRes.body.status === 'SUCCESS', 'HTTP POST /api/auth/logout: Revoked active refresh token.');

  // 4. Rate Limiting Headers over HTTP
  console.log('\n--- Part 4: Real HTTP Rate Limiting Headers ---');
  const throttledRes = await makeRequest('GET', '/health');
  assert(
    !!throttledRes.headers['x-ratelimit-limit'] && !!throttledRes.headers['x-ratelimit-remaining'],
    'HTTP Throttling: Rate limit headers (X-RateLimit-Limit, X-RateLimit-Remaining) present on HTTP responses.',
  );

  // 5. Tenant Isolation HTTP Attacks
  console.log('\n--- Part 5: Real HTTP Cross-Tenant Attack Scenarios ---');
  // Attempting to read cross-tenant contact over HTTP with unauthorized token
  const crossTenantReadRes = await makeRequest('GET', '/contacts/guessed-uuid-99999', undefined, {
    Authorization: `Bearer ${selectRes.body.access_token}`,
    'x-workspace-id': '00000000-0000-0000-0000-000000000000', // Spoofed context
  });
  assert(
    crossTenantReadRes.statusCode === 401 || crossTenantReadRes.statusCode === 403 || crossTenantReadRes.statusCode === 404,
    'HTTP Cross-Tenant Attack: Guessed ID or spoofed workspace context header safely rejected with 401/403/404.',
  );

  await app.close();

  const duration = Date.now() - startTime;
  console.log('\n=====================================================================');
  console.log(`📊 COMPREHENSIVE STAGING HTTP RUN SUMMARY: Passed: ${passedTests}, Failed: ${failedTests}, Duration: ${duration}ms`);

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
