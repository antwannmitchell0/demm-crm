import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './src/app.module';
import { PrismaClient, Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as jwt from 'jsonwebtoken';

dotenv.config();

const connectionString = process.env.DATABASE_URL || 'postgresql://antwannmitchellsr@localhost:5432/demm_crm';
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

function signToken(sub: string, email: string, workspaceId?: string) {
  const payload: any = { sub, email };
  if (workspaceId !== undefined) payload.workspaceId = workspaceId;
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '15m' });
}

async function runTests() {
  console.log('🧪 STARTING WORKSPACECONTROLLER SECURITY TEST SUITE');
  console.log('=====================================================');

  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0);
  const server = app.getHttpServer();
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const suffix = Date.now();
  const org = await prisma.organization.create({ data: { name: `WS Ctrl Sec Org ${suffix}` } });
  const otherOrg = await prisma.organization.create({ data: { name: `WS Ctrl Sec Other Org ${suffix}` } });

  const ws = await prisma.workspace.create({ data: { organizationId: org.id, name: 'WS', subdomain: `ws-ctrl-sec-${suffix}` } });

  const orgAdmin = await prisma.user.create({ data: { email: `ws-ctrl-admin-${suffix}@example.com`, passwordHash: 'x', firstName: 'Org', lastName: 'Admin' } });
  await prisma.membership.create({ data: { userId: orgAdmin.id, organizationId: org.id, workspaceId: null, role: Role.ORG_ADMIN, permissions: ['*'] } });

  const memberUser = await prisma.user.create({ data: { email: `ws-ctrl-member-${suffix}@example.com`, passwordHash: 'x', firstName: 'Member', lastName: 'User' } });
  await prisma.membership.create({ data: { userId: memberUser.id, organizationId: org.id, workspaceId: ws.id, role: Role.USER, permissions: [] } });

  const outsiderUser = await prisma.user.create({ data: { email: `ws-ctrl-outsider-${suffix}@example.com`, passwordHash: 'x', firstName: 'Out', lastName: 'Sider' } });
  await prisma.membership.create({ data: { userId: outsiderUser.id, organizationId: otherOrg.id, workspaceId: null, role: Role.ORG_ADMIN, permissions: ['*'] } });

  // --- POST /workspaces: no auth at all ---
  const createNoAuth = await fetch(`${base}/workspaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'X', subdomain: `x-${suffix}`, organizationId: org.id }),
  });
  check('POST /workspaces with no auth is rejected (401)', createNoAuth.status === 401);

  // --- POST /workspaces: authenticated but no org-wide role in target org ---
  const createWrongOrg = await fetch(`${base}/workspaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken(outsiderUser.id, outsiderUser.email)}` },
    body: JSON.stringify({ name: 'Y', subdomain: `y-${suffix}`, organizationId: org.id }),
  });
  check("Authenticated user with no org-wide role in the target organization cannot create a workspace there (403)", createWrongOrg.status === 403);

  // --- POST /workspaces: authenticated org-wide role, correct org ---
  const createOk = await fetch(`${base}/workspaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken(orgAdmin.id, orgAdmin.email)}` },
    body: JSON.stringify({ name: 'New WS', subdomain: `new-ws-${suffix}`, organizationId: org.id }),
  });
  const createdWs = await createOk.json();
  check('ORG_ADMIN can create a workspace inside their own organization (200/201)', createOk.status < 300 && !!createdWs.id);

  // --- GET /workspaces/:id: no auth ---
  const getNoAuth = await fetch(`${base}/workspaces/${ws.id}`);
  check('GET /workspaces/:id with no auth is rejected (401)', getNoAuth.status === 401);

  // --- GET /workspaces/:id: THE core IDOR fix -- authenticated but no relationship to this workspace ---
  const getUnauthorized = await fetch(`${base}/workspaces/${ws.id}`, {
    headers: { Authorization: `Bearer ${signToken(outsiderUser.id, outsiderUser.email)}` },
  });
  check(
    'GET /workspaces/:id by an authenticated user with no membership/org-wide role for it is rejected (403) -- previously this was a full IDOR with zero check',
    getUnauthorized.status === 403,
  );

  // --- GET /workspaces/:id: legitimate direct member ---
  const getMember = await fetch(`${base}/workspaces/${ws.id}`, {
    headers: { Authorization: `Bearer ${signToken(memberUser.id, memberUser.email)}` },
  });
  check('GET /workspaces/:id by a legitimate direct member succeeds (200)', getMember.status === 200);

  // --- GET /workspaces/:id: legitimate org-wide role, no direct membership row ---
  const getOrgWide = await fetch(`${base}/workspaces/${ws.id}`, {
    headers: { Authorization: `Bearer ${signToken(orgAdmin.id, orgAdmin.email)}` },
  });
  check('GET /workspaces/:id by an org-wide ORG_ADMIN with no direct membership row still succeeds (200)', getOrgWide.status === 200);

  // --- GET /workspaces (list): non-SUPERADMIN rejected ---
  const listNonAdmin = await fetch(`${base}/workspaces`, {
    headers: { Authorization: `Bearer ${signToken(orgAdmin.id, orgAdmin.email)}` },
  });
  check('GET /workspaces (list) rejects a non-SUPERADMIN caller (403)', listNonAdmin.status === 403);

  // --- register(): audit log written with password redacted ---
  const registerRes = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `ws-ctrl-register-${suffix}@example.com`,
      passwordPlain: 'SuperSecretPassword1!',
      firstName: 'Reg',
      lastName: 'Ister',
      workspaceName: 'Reg WS',
      subdomain: `reg-ws-${suffix}`,
    }),
  });
  const registered = await registerRes.json();
  check('register() succeeds', registerRes.status < 300 && !!registered.id);

  const auditRow = await prisma.auditLog.findFirst({ where: { userId: registered.id, action: 'register' } });
  check('register() writes an AuditLog row', !!auditRow);
  check(
    'AuditLog payload has the password redacted, not stored in plaintext',
    !!auditRow && JSON.stringify(auditRow.payload).includes('[REDACTED]') && !JSON.stringify(auditRow.payload).includes('SuperSecretPassword1!'),
  );

  // --- register(): rate limit kicks in on rapid repeated calls ---
  let sawRateLimited = false;
  for (let i = 0; i < 8; i++) {
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `ws-ctrl-burst-${suffix}-${i}@example.com`,
        passwordPlain: 'SuperSecretPassword1!',
        firstName: 'Burst',
        lastName: `${i}`,
        workspaceName: `Burst WS ${i}`,
        subdomain: `burst-ws-${suffix}-${i}`,
      }),
    });
    if (res.status === 429) {
      sawRateLimited = true;
      break;
    }
  }
  check('register() rate-limits rapid repeated calls (429 within 8 attempts)', sawRateLimited);

  await app.close();

  console.log('\n🧹 Cleaning up test database records...');
  const cleanupUserIds = [orgAdmin.id, memberUser.id, outsiderUser.id, registered.id];
  await prisma.auditLog.deleteMany({ where: { userId: { in: cleanupUserIds } } });
  await prisma.membership.deleteMany({ where: { userId: { in: cleanupUserIds } } });
  await prisma.workspace.deleteMany({ where: { organizationId: { in: [org.id, otherOrg.id, registered.organizationId] } } });
  await prisma.user.deleteMany({ where: { id: { in: cleanupUserIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: [org.id, otherOrg.id, registered.organizationId] } } });
  // Burst-created orgs/workspaces/users (best-effort cleanup by email prefix)
  const burstUsers = await prisma.user.findMany({ where: { email: { contains: `ws-ctrl-burst-${suffix}` } } });
  if (burstUsers.length) {
    const burstIds = burstUsers.map((u) => u.id);
    const burstMemberships = await prisma.membership.findMany({ where: { userId: { in: burstIds } } });
    const burstWsIds = [...new Set(burstMemberships.map((m) => m.workspaceId).filter((id): id is string => !!id))];
    const burstOrgIds = [...new Set(burstMemberships.map((m) => m.organizationId))];
    await prisma.auditLog.deleteMany({ where: { userId: { in: burstIds } } });
    await prisma.membership.deleteMany({ where: { userId: { in: burstIds } } });
    await prisma.workspace.deleteMany({ where: { id: { in: burstWsIds } } });
    await prisma.user.deleteMany({ where: { id: { in: burstIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: burstOrgIds } } });
  }
  console.log('✅ Cleanup complete.');

  console.log('=====================================================');
  console.log(`📊 WORKSPACECONTROLLER SECURITY SUITE: ${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exit(1);
}

runTests()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
