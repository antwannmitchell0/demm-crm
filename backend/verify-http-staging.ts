import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from './src/app.module';
import helmet from 'helmet';
import * as http from 'http';

async function main() {
  const startTime = Date.now();
  console.log('🧪 RUNNING STAGING REAL HTTP TEST SUITE (RELEASE 0.1.2)');
  console.log('========================================================');

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

  // Initialize testing app instance
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

  await app.listen(0);
  const address: any = app.getHttpServer().address();
  const port = address.port;
  const baseUrl = `http://127.0.0.1:${port}`;

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

  // 1. Operational Health, Ready, and Version Endpoints
  console.log('\n--- Part 1: Real HTTP Operational Endpoints ---');
  const healthRes = await makeRequest('GET', '/health');
  assert(
    healthRes.statusCode === 200 && healthRes.body.status === 'ok' && healthRes.body.database === 'up',
    'HTTP GET /health: Reported 200 OK with database up.',
  );

  const readyRes = await makeRequest('GET', '/ready');
  assert(readyRes.statusCode === 200 && readyRes.body.status === 'ready', 'HTTP GET /ready: Reported 200 OK ready status.');

  const versionRes = await makeRequest('GET', '/version');
  assert(
    versionRes.statusCode === 200 &&
      versionRes.body.version === '0.1.2' &&
      versionRes.body.commitSha === '50af85e6ef1a83ee10ffbc0cb9d7d42cfbc1bfd7' &&
      !JSON.stringify(versionRes.body).includes('DATABASE_URL'),
    'HTTP GET /version: Reported 200 OK exposing commit SHA without leaking secrets.',
  );

  // Correlation ID Header check
  assert(!!versionRes.headers['x-correlation-id'], 'HTTP Observability: Response header includes x-correlation-id.');

  // 2. Real HTTP Auth & Session Operations
  console.log('\n--- Part 2: Real HTTP Authentication & Workspace Session ---');
  const uniqueEmail = `staging_${Date.now()}@example.com`;
  const regRes = await makeRequest('POST', '/api/auth/register', {
    email: uniqueEmail,
    passwordPlain: 'super-secure-password-123',
    firstName: 'Staging',
    lastName: 'User',
    workspaceName: 'Staging Workspace',
    subdomain: `sub_${Date.now()}`,
  });
  assert(regRes.statusCode === 201 && !!regRes.body.id, 'HTTP POST /api/auth/register: User registered successfully.');

  const loginRes = await makeRequest('POST', '/api/auth/login', {
    email: uniqueEmail,
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
    'HTTP POST /api/auth/select-workspace: Workspace selected and tokens issued.',
  );

  // Refresh Token Rotation over HTTP
  const refreshRes = await makeRequest('POST', '/api/auth/refresh', {
    refreshToken: selectRes.body.refresh_token,
  });
  assert(
    refreshRes.statusCode === 201 && refreshRes.body.refresh_token !== selectRes.body.refresh_token,
    'HTTP POST /api/auth/refresh: Rotated refresh token successfully.',
  );

  // Reusing old refresh token over HTTP (must return 401 Unauthorized)
  const reuseRes = await makeRequest('POST', '/api/auth/refresh', {
    refreshToken: selectRes.body.refresh_token,
  });
  assert(reuseRes.statusCode === 401, 'HTTP Security: Reused old refresh token rejected with 401 Unauthorized.');

  // Clean up app instance
  await app.close();

  const duration = Date.now() - startTime;
  console.log('\n========================================================');
  console.log(`📊 STAGING HTTP RUN SUMMARY: Passed: ${passedTests}, Failed: ${failedTests}, Duration: ${duration}ms`);

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
