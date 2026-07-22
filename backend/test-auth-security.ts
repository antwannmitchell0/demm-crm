import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './src/app.module';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://antwannmitchellsr@localhost:5432/demm_crm';
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

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

async function registerUser(base: string, suffix: string) {
  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `auth-sec-${suffix}@example.com`,
      passwordPlain: 'CorrectHorseBatteryStaple1!',
      firstName: 'Auth',
      lastName: 'Sec',
      workspaceName: `WS ${suffix}`,
      subdomain: `auth-sec-${suffix}`,
    }),
  });
  return res.json();
}

async function login(base: string, email: string) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      passwordPlain: 'CorrectHorseBatteryStaple1!',
    }),
  });
  return res.json();
}

async function runAuthSecurityTests() {
  console.log(
    '🧪 STARTING AUTH SECURITY TEST SUITE (select-workspace bypass + logout-all)',
  );
  console.log(
    '=============================================================================',
  );

  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(0);
  const server = app.getHttpServer();
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const suffix = Date.now();
  const userA = await registerUser(base, `a-${suffix}`);
  const userB = await registerUser(base, `b-${suffix}`);

  // --- 1. Legitimate flow works end-to-end ---
  const loginA = await login(base, userA.email);
  check(
    'login() returns a preAuthToken, not a usable access_token',
    !!loginA.preAuthToken && !loginA.access_token,
  );

  const selectA = await fetch(`${base}/api/auth/select-workspace`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${loginA.preAuthToken}`,
    },
    body: JSON.stringify({ workspaceId: userA.workspaceId }),
  });
  const tokensA = await selectA.json();
  check(
    'select-workspace with a valid preAuthToken issues real tokens',
    selectA.status < 300 && !!tokensA.access_token,
  );

  // --- 2. The actual bypass: no pre-auth token at all is rejected, regardless of what workspaceId is claimed ---
  const bypassAttempt = await fetch(`${base}/api/auth/select-workspace`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId: userB.workspaceId }),
  });
  check(
    'select-workspace with NO pre-auth token is rejected (401)',
    bypassAttempt.status === 401,
  );

  // --- 2b. The old exploit shape itself: a userId field in the body is no longer even an
  // accepted parameter -- SelectWorkspaceDto dropped it, and the global ValidationPipe's
  // whitelist rejects unknown properties before the handler ever runs.
  const oldExploitShapeAttempt = await fetch(
    `${base}/api/auth/select-workspace`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userB.id,
        workspaceId: userB.workspaceId,
      }),
    },
  );
  check(
    'The old exploit shape (userId + workspaceId, no token) is rejected at the validation layer (400)',
    oldExploitShapeAttempt.status === 400,
  );

  // --- 3. A garbage/forged bearer token is rejected ---
  const forgedTokenAttempt = await fetch(`${base}/api/auth/select-workspace`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer not-a-real-token',
    },
    body: JSON.stringify({ workspaceId: userB.workspaceId }),
  });
  check(
    'select-workspace with a garbage bearer token is rejected (401)',
    forgedTokenAttempt.status === 401,
  );

  // --- 4. A valid preAuthToken for User A cannot be used to select User B's workspace (identity now comes from the token, not the body) ---
  const loginA2 = await login(base, userA.email);
  const crossUserAttempt = await fetch(`${base}/api/auth/select-workspace`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${loginA2.preAuthToken}`,
    },
    body: JSON.stringify({ workspaceId: userB.workspaceId }),
  });
  check(
    "User A's preAuthToken cannot select User B's workspace (403)",
    crossUserAttempt.status === 403,
  );

  // --- 5. An ordinary (non-pre-auth) access token cannot be reused as a pre-auth token ---
  const reuseAccessTokenAttempt = await fetch(
    `${base}/api/auth/select-workspace`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokensA.access_token}`,
      },
      body: JSON.stringify({ workspaceId: userA.workspaceId }),
    },
  );
  check(
    "A real access token (missing purpose:'workspace-selection') is rejected as a pre-auth token (401)",
    reuseAccessTokenAttempt.status === 401,
  );

  // --- 6. logout-all only revokes the CALLER's own sessions, not every user's ---
  const loginB = await login(base, userB.email);
  const selectB = await fetch(`${base}/api/auth/select-workspace`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${loginB.preAuthToken}`,
    },
    body: JSON.stringify({ workspaceId: userB.workspaceId }),
  });
  const tokensB = await selectB.json();

  const logoutAllA = await fetch(`${base}/api/auth/logout-all`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokensA.access_token}` },
  });
  check('logout-all succeeds for the caller', logoutAllA.status < 300);

  const refreshBAfterALogoutAll = await fetch(`${base}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: tokensB.refresh_token }),
  });
  check(
    "User B's refresh token still works after User A calls logout-all (no system-wide session wipe)",
    refreshBAfterALogoutAll.status < 300,
  );

  const refreshAAfterOwnLogoutAll = await fetch(`${base}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: tokensA.refresh_token }),
  });
  check(
    "User A's own refresh token IS revoked after their own logout-all",
    refreshAAfterOwnLogoutAll.status === 401,
  );

  await app.close();

  console.log('\n🧹 Cleaning up test database records...');
  await prisma.refreshToken.deleteMany({
    where: { userId: { in: [userA.id, userB.id] } },
  });
  await prisma.membership.deleteMany({
    where: { userId: { in: [userA.id, userB.id] } },
  });
  await prisma.workspace.deleteMany({
    where: { id: { in: [userA.workspaceId, userB.workspaceId] } },
  });
  await prisma.organization.deleteMany({
    where: { id: { in: [userA.organizationId, userB.organizationId] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  console.log('✅ Cleanup complete.');

  console.log(
    '=============================================================================',
  );
  console.log(`📊 AUTH SECURITY SUITE: ${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exit(1);
}

runAuthSecurityTests()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
