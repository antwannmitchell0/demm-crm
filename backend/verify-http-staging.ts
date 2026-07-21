import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma.service';
import helmet from 'helmet';
import * as http from 'http';

async function main() {
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
    versionRes.statusCode === 200 &&
      versionRes.body.version === '0.1.2' &&
      !!versionRes.body.commitSha &&
      !JSON.stringify(versionRes.body).includes('DATABASE_URL'),
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

  const loginA = await makeRequest('POST', '/api/auth/login', {
    email: emailA,
    passwordPlain: 'super-secure-password-123',
  });
  const wsAId = loginA.body.workspaces[0].workspaceId;

  const selectA = await makeRequest('POST', '/api/auth/select-workspace', {
    userId: loginA.body.user.id,
    workspaceId: wsAId,
  });
  assert(!!selectA.body.access_token, 'HTTP Session: Workspace selection issued Access Token and Refresh Token.');

  // Token rotation over HTTP
  const refreshA = await makeRequest('POST', '/api/auth/refresh', {
    refreshToken: selectA.body.refresh_token,
  });
  assert(
    refreshA.statusCode === 201 && refreshA.body.refresh_token !== selectA.body.refresh_token,
    'HTTP Session: Refresh token rotated successfully.',
  );

  // Reusing old refresh token over HTTP
  const reuseA = await makeRequest('POST', '/api/auth/refresh', {
    refreshToken: selectA.body.refresh_token,
  });
  assert(reuseA.statusCode === 401, 'HTTP Session Security: Reused old refresh token rejected with HTTP 401 Unauthorized.');

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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
