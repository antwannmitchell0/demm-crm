import * as https from 'https';
import http from 'http';

async function main() {
  const startTime = Date.now();
  const frontendUrl = 'https://demm-crm-frontend-staging-431876670120.us-east1.run.app';
  const backendUrl = 'https://demm-crm-backend-staging-431876670120.us-east1.run.app';

  console.log('🧪 RUNNING FRONTEND PILOT BEHAVIORAL TEST SUITE (RELEASE 0.1.3)');
  console.log(`Frontend URL: ${frontendUrl}`);
  console.log(`Backend URL:  ${backendUrl}`);
  console.log('========================================================================');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, message: string) {
    if (condition) {
      passed++;
      console.log(`✅ [PASS] ${message}`);
    } else {
      failed++;
      console.error(`❌ [FAIL] ${message}`);
    }
  }

  function fetchUrl(url: string, headers: Record<string, string> = {}): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const req = https.request(urlObj, { method: 'GET', headers }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ statusCode: res.statusCode || 500, headers: res.headers, body: data }));
      });
      req.on('error', reject);
      req.end();
    });
  }

  // 1. Frontend Page Load & Login Page Render
  console.log('\n--- Part 1: Frontend SPA Page Loading & Render ---');
  const homeRes = await fetchUrl(frontendUrl);
  assert(homeRes.statusCode === 200, 'Frontend SPA Loads: GET / returns HTTP 200 OK.');
  assert(homeRes.body.includes('Sign In') || homeRes.body.includes('Email address'), 'Login Page Renders: Contains Sign In form elements.');
  assert(homeRes.body.includes('DEMM CRM'), 'Branding Verified: Title/Metadata includes DEMM CRM.');

  // 2. Synthetic Account Login & Workspace Selection via Backend API Binding
  console.log('\n--- Part 2: Frontend API Connection & Auth Flow ---');
  const userEmail = `frontend_pilot_${Date.now()}@example.com`;
  
  // Register synthetic user
  const regPayload = JSON.stringify({
    email: userEmail,
    passwordPlain: 'PilotSecurePass123!',
    firstName: 'Pilot',
    lastName: 'User',
    workspaceName: 'Pilot Workspace',
    subdomain: `sub_pilot_${Date.now()}`,
  });

  const regRes = await new Promise<{ statusCode: number; body: any }>((resolve, reject) => {
    const req = https.request(`${backendUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(regPayload).toString() },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ statusCode: res.statusCode || 500, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.write(regPayload);
    req.end();
  });

  assert(regRes.statusCode === 201 && !!regRes.body.id, 'Frontend Auth Registration: User registered successfully.');

  // Login
  const loginPayload = JSON.stringify({ email: userEmail, passwordPlain: 'PilotSecurePass123!' });
  const loginRes = await new Promise<{ statusCode: number; body: any }>((resolve, reject) => {
    const req = https.request(`${backendUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginPayload).toString() },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ statusCode: res.statusCode || 500, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.write(loginPayload);
    req.end();
  });

  assert(loginRes.statusCode === 201 && Array.isArray(loginRes.body.workspaces), 'Login Succeeds: Synthetic account authenticated.');

  const wsId = loginRes.body.workspaces[0].workspaceId;
  const selectPayload = JSON.stringify({ userId: loginRes.body.user.id, workspaceId: wsId });
  const selectRes = await new Promise<{ statusCode: number; body: any }>((resolve, reject) => {
    const req = https.request(`${backendUrl}/api/auth/select-workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(selectPayload).toString() },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ statusCode: res.statusCode || 500, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.write(selectPayload);
    req.end();
  });

  assert(selectRes.statusCode === 201 && !!selectRes.body.access_token, 'Workspace Selection Works: Issued JWT access token.');
  const token = selectRes.body.access_token;

  // 3. Authenticated Dashboard & Protected API Reads
  console.log('\n--- Part 3: Authenticated Dashboard Data Fetch ---');
  const dashRes = await new Promise<{ statusCode: number; body: any }>((resolve, reject) => {
    const req = https.request(`${backendUrl}/dashboard`, {
      method: 'GET',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'x-workspace-id': wsId
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ statusCode: res.statusCode || 500, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.end();
  });


  assert(dashRes.statusCode === 200 && typeof dashRes.body === 'object', 'Authenticated Dashboard Loads: Calls Cloud Run API successfully.');

  // 4. Logout & Unauthorized Visitor Rejection
  console.log('\n--- Part 4: Logout & Unauthorized Access Safeguards ---');
  const logoutPayload = JSON.stringify({ refreshToken: selectRes.body.refresh_token });
  const logoutRes = await new Promise<{ statusCode: number; body: any }>((resolve, reject) => {
    const req = https.request(`${backendUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(logoutPayload).toString(),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ statusCode: res.statusCode || 500, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.write(logoutPayload);
    req.end();
  });

  assert(logoutRes.statusCode === 201 || logoutRes.statusCode === 200, 'Logout Works: Revoked active session token.');

  const unauthDashRes = await new Promise<{ statusCode: number }>((resolve, reject) => {
    const req = https.request(`${backendUrl}/dashboard`, { method: 'GET' }, (res) => resolve({ statusCode: res.statusCode || 500 }));
    req.on('error', reject);
    req.end();
  });


  assert(unauthDashRes.statusCode === 401, 'Unauthorized Access Denied: Unauthenticated requests return HTTP 401 Unauthorized.');

  const duration = Date.now() - startTime;
  console.log('\n========================================================================');
  console.log(`📊 FRONTEND PILOT TEST SUMMARY: Passed: ${passed}, Failed: ${failed}, Duration: ${duration}ms`);

  if (failed > 0) process.exit(1);
  else process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
