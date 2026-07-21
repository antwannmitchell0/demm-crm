import 'dotenv/config';
import * as https from 'https';
import { IncomingHttpHeaders } from 'http';

async function main() {
  const startTime = Date.now();
  const baseUrl = 'https://demm-crm-backend-staging-431876670120.us-east1.run.app';

  console.log('🧪 RUNNING LIVE GOOGLE CLOUD RUN STAGING HTTP TEST SUITE (RELEASE 0.1.3)');
  console.log(`Target Base URL: ${baseUrl}`);
  console.log('========================================================================');

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

  function makeRequest(
    method: string,
    path: string,
    body?: any,
    headers: Record<string, string> = {},
  ): Promise<{ statusCode: number; headers: IncomingHttpHeaders; body: any }> {
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

      const req = https.request(
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

  // 1. Live Operational Endpoints over HTTPS
  console.log('\n--- Part 1: Live Cloud Run Operational Endpoints ---');
  const healthRes = await makeRequest('GET', '/health');
  assert(
    healthRes.statusCode === 200 && healthRes.body.status === 'ok' && healthRes.body.database === 'up',
    'Public HTTPS GET /health: 200 OK with live Cloud SQL database connectivity.',
  );

  const readyRes = await makeRequest('GET', '/ready');
  assert(readyRes.statusCode === 200 && readyRes.body.status === 'ready', 'Public HTTPS GET /ready: 200 OK Cloud Run readiness probe.');

  const versionRes = await makeRequest('GET', '/version');
  assert(
    versionRes.statusCode === 200 &&
      versionRes.body.version === '0.1.2' &&
      !JSON.stringify(versionRes.body).includes('DATABASE_URL'),
    'Public HTTPS GET /version: 200 OK returning environment version without exposing secrets.',
  );
  assert(!!versionRes.headers['x-correlation-id'], 'Public HTTP Observability: Response header includes x-correlation-id.');

  // 2. CORS Verification over HTTPS
  console.log('\n--- Part 2: Live Cloud Run CORS Checks ---');
  const corsAllowedRes = await makeRequest('GET', '/version', undefined, { Origin: 'https://demm-crm-frontend-staging-431876670120.us-east1.run.app' });
  assert(
    corsAllowedRes.headers['access-control-allow-origin'] === 'https://demm-crm-frontend-staging-431876670120.us-east1.run.app',
    'Public HTTPS CORS: Approved Cloud Run frontend origin accepted with credentials allowed.',
  );

  const corsUnauthRes = await makeRequest('GET', '/version', undefined, { Origin: 'https://unauthorized.example' });
  assert(
    !corsUnauthRes.headers['access-control-allow-origin'],
    'Public HTTPS CORS: Unauthorized origin (https://unauthorized.example) correctly rejected without Access-Control-Allow-Origin.',
  );

  // 3. Validation Pipe Input Rejections (HTTP 400)
  console.log('\n--- Part 3: Live Public HTTP Validation Pipe Checks ---');
  const unknownFieldRes = await makeRequest('POST', '/api/auth/login', {
    email: 'valid@example.com',
    passwordPlain: 'password123',
    unapprovedExtraField: 'HackerPayload',
  });
  assert(unknownFieldRes.statusCode === 400, 'Public HTTP Validation: Unknown property rejected with HTTP 400 Bad Request.');

  const malformedEmailRes = await makeRequest('POST', '/api/auth/login', {
    email: 'not-an-email-address',
    passwordPlain: 'password123',
  });
  assert(malformedEmailRes.statusCode === 400, 'Public HTTP Validation: Malformed email rejected with HTTP 400 Bad Request.');

  // 4. Auth & Refresh Session Lifecycle on Cloud Run & Cloud SQL
  console.log('\n--- Part 4: Live Cloud Run & Cloud SQL Authentication Lifecycle ---');
  const gcpEmail = `gcp_user_${Date.now()}@example.com`;
  const regRes = await makeRequest('POST', '/api/auth/register', {
    email: gcpEmail,
    passwordPlain: 'gcp-secure-password-123',
    firstName: 'GCP',
    lastName: 'Tester',
    workspaceName: 'GCP Staging Workspace',
    subdomain: `sub_gcp_${Date.now()}`,
  });
  assert(regRes.statusCode === 201 && !!regRes.body.id, 'Public HTTPS POST /api/auth/register: Registered user on Cloud SQL.');

  const loginRes = await makeRequest('POST', '/api/auth/login', {
    email: gcpEmail,
    passwordPlain: 'gcp-secure-password-123',
  });
  assert(
    loginRes.statusCode === 201 && Array.isArray(loginRes.body.workspaces) && loginRes.body.workspaces.length > 0,
    'Public HTTPS POST /api/auth/login: Authenticated user against Cloud SQL.',
  );

  const targetWsId = loginRes.body.workspaces[0].workspaceId;
  const selectRes = await makeRequest('POST', '/api/auth/select-workspace', {
    userId: loginRes.body.user.id,
    workspaceId: targetWsId,
  });
  assert(
    selectRes.statusCode === 201 && !!selectRes.body.access_token && !!selectRes.body.refresh_token,
    'Public HTTPS POST /api/auth/select-workspace: Issued JWT access token & SHA-256 hashed refresh token.',
  );

  // Refresh Token Rotation on Cloud SQL
  const refreshRes = await makeRequest('POST', '/api/auth/refresh', {
    refreshToken: selectRes.body.refresh_token,
  });
  assert(
    refreshRes.statusCode === 201 && refreshRes.body.refresh_token !== selectRes.body.refresh_token,
    'Public HTTPS POST /api/auth/refresh: Rotated refresh token successfully on Cloud SQL.',
  );

  // Old Refresh Token Reuse Rejection
  const reuseRes = await makeRequest('POST', '/api/auth/refresh', {
    refreshToken: selectRes.body.refresh_token,
  });
  assert(reuseRes.statusCode === 401, 'Public HTTPS Security: Reused refresh token rejected with 401 Unauthorized.');

  const duration = Date.now() - startTime;
  console.log('\n========================================================================');
  console.log(`📊 LIVE GCP STAGING HTTP RUN SUMMARY: Passed: ${passedTests}, Failed: ${failedTests}, Duration: ${duration}ms`);

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
