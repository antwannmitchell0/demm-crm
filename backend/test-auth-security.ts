import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './src/app.module';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as crypto from 'crypto';

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

  // --- 7. T6: refresh-token replay detection and user-scoped family revocation ---
  const selectWorkspace = async (preAuthToken: string, workspaceId: string) =>
    fetch(`${base}/api/auth/select-workspace`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${preAuthToken}`,
      },
      body: JSON.stringify({ workspaceId }),
    });
  const doRefresh = (refreshToken: string) =>
    fetch(`${base}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
  const activeTokens = (userId: string) =>
    prisma.refreshToken.count({ where: { userId, revoked: false } });
  const sha256 = (t: string) =>
    crypto.createHash('sha256').update(t).digest('hex');

  // Fresh sessions for both users (earlier sections revoked User A's).
  const freshLoginA = await login(base, userA.email);
  const sessA = await (
    await selectWorkspace(freshLoginA.preAuthToken, userA.workspaceId)
  ).json();
  const freshLoginB = await login(base, userB.email);
  const sessB = await (
    await selectWorkspace(freshLoginB.preAuthToken, userB.workspaceId)
  ).json();
  check(
    'T6: login + workspace selection issue a usable refresh token for both users',
    !!sessA.refresh_token && !!sessB.refresh_token,
  );

  // Rotate A1 -> A2.
  const rotateRes = await doRefresh(sessA.refresh_token);
  const rotated = await rotateRes.json();
  check(
    'T6: refresh rotates token A into a different token B',
    rotateRes.status < 300 &&
      !!rotated.refresh_token &&
      rotated.refresh_token !== sessA.refresh_token,
  );

  const reuseAuditsBefore = await prisma.auditLog.count({
    where: { action: 'REFRESH_TOKEN_REUSE_DETECTED', userId: userA.id },
  });

  // Replay the already-rotated token A1.
  const replayRes = await doRefresh(sessA.refresh_token);
  check(
    'T6: replaying the already-rotated token A is rejected with 401',
    replayRes.status === 401,
  );

  // The newest token B must now be dead too -- this is the T6 behaviour change.
  const useBAfterReplay = await doRefresh(rotated.refresh_token);
  check(
    'T6: replaying token A revokes token B, so token B is rejected with 401',
    useBAfterReplay.status === 401,
  );
  check(
    'T6: no active refresh tokens remain for the affected user after replay detection',
    (await activeTokens(userA.id)) === 0,
  );

  // Blast radius must stop at the affected account.
  const useBUserAfterReplay = await doRefresh(sessB.refresh_token);
  check(
    "T6: a second user's active refresh token is unaffected by the first user's replay event",
    useBUserAfterReplay.status < 300,
  );
  const sessB2 = await useBUserAfterReplay.json();

  // Re-authentication must still work for the affected account.
  const reLoginA = await login(base, userA.email);
  const sessA2 = await (
    await selectWorkspace(reLoginA.preAuthToken, userA.workspaceId)
  ).json();
  check(
    'T6: the affected user can establish a brand-new session by logging in again',
    !!sessA2.access_token && !!sessA2.refresh_token,
  );

  // An UNKNOWN token has no identifiable owner, so it must revoke nothing --
  // otherwise anyone could log a victim out by posting random strings.
  const activeABeforeUnknown = await activeTokens(userA.id);
  const activeBBeforeUnknown = await activeTokens(userB.id);
  const unknownRes = await doRefresh(crypto.randomBytes(40).toString('hex'));
  check(
    'T6: an unknown random token returns 401 and revokes nobody',
    unknownRes.status === 401 &&
      (await activeTokens(userA.id)) === activeABeforeUnknown &&
      (await activeTokens(userB.id)) === activeBBeforeUnknown,
  );

  // An EXPIRED but never-revoked token is ordinary lifecycle end, NOT theft:
  // it must 401 without triggering family revocation. Seeded directly because
  // the API cannot mint a pre-expired token.
  const rawExpired = crypto.randomBytes(40).toString('hex');
  await prisma.refreshToken.create({
    data: {
      hashedToken: sha256(rawExpired),
      userId: userA.id,
      workspaceId: userA.workspaceId,
      expiresAt: new Date(Date.now() - 60_000),
      revoked: false,
    },
  });
  const activeABeforeExpired = await activeTokens(userA.id);
  const expiredRes = await doRefresh(rawExpired);
  check(
    'T6: an expired (never-revoked) token returns 401 and does NOT revoke the session family',
    expiredRes.status === 401 &&
      // the expired row itself is still counted as unrevoked; the live session
      // token minted above must also survive
      (await activeTokens(userA.id)) === activeABeforeExpired,
  );

  // Audit evidence.
  const reuseAudits = await prisma.auditLog.findMany({
    where: { action: 'REFRESH_TOKEN_REUSE_DETECTED', userId: userA.id },
    orderBy: { createdAt: 'asc' },
  });
  // TWO events are expected here, and that is correct rather than a
  // double-count: EVERY presentation of a known-revoked token is a replay
  // signal. This section presents two of them -- the deliberate replay of
  // token A, and the check above that token B is now dead (token B having just
  // been revoked by that first event). Only unknown and expired tokens are
  // silent.
  const reuseAuditDelta = reuseAudits.length - reuseAuditsBefore;
  const latestReuseAudit = reuseAudits[reuseAudits.length - 1];
  check(
    `T6: each presentation of a revoked token writes a REFRESH_TOKEN_REUSE_DETECTED record (delta=${reuseAuditDelta}, expected 2)`,
    reuseAuditDelta === 2 &&
      latestReuseAudit.actorType === 'SYSTEM' &&
      latestReuseAudit.actorId === userA.id &&
      (latestReuseAudit.payload as any)?.outcome ===
        'ALL_ACTIVE_SESSIONS_REVOKED' &&
      (latestReuseAudit.payload as any)?.reason ===
        'ROTATED_REFRESH_TOKEN_REPLAYED',
  );
  const auditJson = JSON.stringify(reuseAudits.map((r) => r.payload));
  check(
    'T6: no refresh token or token hash appears in any reuse audit payload',
    !auditJson.includes(sessA.refresh_token) &&
      !auditJson.includes(rotated.refresh_token) &&
      !auditJson.includes(sha256(sessA.refresh_token)) &&
      !auditJson.includes(sha256(rotated.refresh_token)) &&
      !auditJson.includes(sessB.refresh_token),
  );

  // Keep User B's newest token usable for nothing further; recorded only so the
  // variable is meaningful to a reader of the cleanup below.
  void sessB2;

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
