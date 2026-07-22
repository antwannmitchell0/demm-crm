import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './src/app.module';
import { PrismaClient, Role, SubjectType, MemoryForm, MemoryTopic, TruthClassification, SensitivityClassification, SourceType } from '@prisma/client';
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

async function runGuardTests() {
  console.log('🧪 STARTING WORKSPACEGUARD HARDENING HTTP TEST SUITE');
  console.log('=====================================================');

  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0);
  const server = app.getHttpServer();
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const suffix = Date.now();

  // --- Fixture: two Organizations, each with a Business Unit + Workspace ---
  const orgA = await prisma.organization.create({ data: { name: `Guard Test Org A ${suffix}` } });
  const orgB = await prisma.organization.create({ data: { name: `Guard Test Org B ${suffix}` } });

  const buMktg = await prisma.businessUnit.create({ data: { organizationId: orgA.id, key: 'MARKETING', name: 'DEMM Marketing' } });
  const buPhoto = await prisma.businessUnit.create({ data: { organizationId: orgA.id, key: 'PHOTO_BOOTHS', name: 'DEMM Photo Booths' } });

  const wsA1 = await prisma.workspace.create({ data: { organizationId: orgA.id, businessUnitId: buMktg.id, name: 'Org A / Marketing', subdomain: `guard-a1-${suffix}` } });
  const wsA2 = await prisma.workspace.create({ data: { organizationId: orgA.id, businessUnitId: buPhoto.id, name: 'Org A / Photo Booths', subdomain: `guard-a2-${suffix}` } });
  const wsB1 = await prisma.workspace.create({ data: { organizationId: orgB.id, name: 'Org B / Only', subdomain: `guard-b1-${suffix}` } });

  // userScoped: direct membership in wsA1 only.
  const userScoped = await prisma.user.create({ data: { email: `guard-scoped-${suffix}@example.com`, passwordHash: 'x', firstName: 'Scoped', lastName: 'User' } });
  await prisma.membership.create({ data: { userId: userScoped.id, organizationId: orgA.id, workspaceId: wsA1.id, role: Role.USER, permissions: [] } });

  // userNoMembership: exists, but has zero Membership rows at all ("inactive membership" case).
  const userNoMembership = await prisma.user.create({ data: { email: `guard-nomember-${suffix}@example.com`, passwordHash: 'x', firstName: 'No', lastName: 'Member' } });

  // userMultiBU: membership in both wsA1 (Marketing) and wsA2 (Photo Booths).
  const userMultiBU = await prisma.user.create({ data: { email: `guard-multibu-${suffix}@example.com`, passwordHash: 'x', firstName: 'Multi', lastName: 'BU' } });
  await prisma.membership.create({ data: { userId: userMultiBU.id, organizationId: orgA.id, workspaceId: wsA1.id, role: Role.USER, permissions: [] } });
  await prisma.membership.create({ data: { userId: userMultiBU.id, organizationId: orgA.id, workspaceId: wsA2.id, role: Role.USER, permissions: [] } });

  // userExec: org-wide ORG_ADMIN membership (workspaceId null) for orgA only.
  const userExec = await prisma.user.create({ data: { email: `guard-exec-${suffix}@example.com`, passwordHash: 'x', firstName: 'Exec', lastName: 'Admin' } });
  await prisma.membership.create({ data: { userId: userExec.id, organizationId: orgA.id, workspaceId: null, role: Role.ORG_ADMIN, permissions: ['*'] } });

  // userCorrupt: membership row whose organizationId does NOT match wsA1's real org
  // (simulates a data-integrity bug) -- proves the guard's defense-in-depth check.
  const userCorrupt = await prisma.user.create({ data: { email: `guard-corrupt-${suffix}@example.com`, passwordHash: 'x', firstName: 'Corrupt', lastName: 'Row' } });
  await prisma.membership.create({ data: { userId: userCorrupt.id, organizationId: orgB.id, workspaceId: wsA1.id, role: Role.USER, permissions: [] } });

  const contact = await prisma.contact.create({ data: { firstName: 'Bob', lastName: 'Miller', emails: ['bob@example.com'], workspaceId: wsA1.id } });

  const withWorkspaceHeader = (token: string, workspaceId?: string) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    if (workspaceId !== undefined) headers['x-workspace-id'] = workspaceId;
    return headers;
  };

  // 1. Missing header + no token workspace claim -> denied.
  {
    const token = signToken(userScoped.id, userScoped.email); // no workspaceId in payload
    const res = await fetch(`${base}/contacts`, { headers: withWorkspaceHeader(token) });
    check('1. Missing header + no token workspace claim -> 403', res.status === 403);
  }

  // 1b. Missing header BUT valid token workspace claim -> allowed (legitimate token-based fallback).
  {
    const token = signToken(userScoped.id, userScoped.email, wsA1.id);
    const res = await fetch(`${base}/contacts`, { headers: withWorkspaceHeader(token) });
    check('1b. Missing header + valid token workspace claim -> 200', res.status === 200);
  }

  // 2. Invalid / malformed workspace ID -> rejected, not silently ignored.
  {
    const token = signToken(userScoped.id, userScoped.email, wsA1.id);
    const res = await fetch(`${base}/contacts`, { headers: withWorkspaceHeader(token, 'not-a-real-uuid') });
    check('2. Malformed workspace header -> 400', res.status === 400);
  }

  // 3. Cross-Business-Unit workspace with no membership there -> rejected.
  {
    const token = signToken(userScoped.id, userScoped.email, wsA1.id);
    const res = await fetch(`${base}/contacts`, { headers: withWorkspaceHeader(token, wsA2.id) });
    check('3. Cross-BU workspace, no membership -> 403', res.status === 403);
  }

  // 3b. Cross-Business-Unit workspace WITH legitimate membership in both -> switching succeeds
  //     and downstream BusinessUnitGuard resolves the NEW workspace's real BU, not the old one.
  {
    const token = signToken(userMultiBU.id, userMultiBU.email, wsA1.id);
    const contactA2 = await prisma.contact.create({ data: { firstName: 'Photo', lastName: 'Only', workspaceId: wsA2.id } });
    const subjectA2 = await prisma.relationshipSubject.create({ data: { type: SubjectType.CONTACT, contactId: contactA2.id } });
    const profileA2 = await prisma.relationshipProfile.create({ data: { subjectId: subjectA2.id, businessUnitId: buPhoto.id } });
    const engramInA2 = await prisma.engram.create({
      data: {
        profileId: profileA2.id,
        organizationId: orgA.id,
        businessUnitId: buPhoto.id,
        workspaceId: wsA2.id,
        form: MemoryForm.SEMANTIC,
        topic: MemoryTopic.PREFERENCE,
        truthClassification: TruthClassification.CONFIRMED,
        summary: 'Photo Booths BU memory.',
      },
    });
    const resA1 = await fetch(`${base}/dom26r/engrams`, { headers: withWorkspaceHeader(token, wsA1.id) });
    const listA1 = await resA1.json();
    const resA2 = await fetch(`${base}/dom26r/engrams`, { headers: withWorkspaceHeader(token, wsA2.id) });
    const listA2 = await resA2.json();
    check(
      '3b. Header switch to a second legitimate membership resolves the NEW workspace BU correctly',
      resA1.status === 200 &&
        resA2.status === 200 &&
        !listA1.some((e: any) => e.id === engramInA2.id) &&
        listA2.some((e: any) => e.id === engramInA2.id),
    );
  }

  // 4. Cross-Organization workspace, zero membership in that org -> rejected.
  {
    const token = signToken(userScoped.id, userScoped.email, wsA1.id);
    const res = await fetch(`${base}/contacts`, { headers: withWorkspaceHeader(token, wsB1.id) });
    check('4. Cross-Organization workspace, no membership -> 403', res.status === 403);
  }

  // 4b. Defense-in-depth: a Membership row whose organizationId doesn't match the
  //     target workspace's real organizationId must NOT grant access.
  {
    const token = signToken(userCorrupt.id, userCorrupt.email, wsA1.id);
    const res = await fetch(`${base}/contacts`, { headers: withWorkspaceHeader(token, wsA1.id) });
    check('4b. Membership/workspace organization mismatch -> 403 (defense in depth)', res.status === 403);
  }

  // 5 & 6. User without any membership at all ("inactive membership") -> rejected,
  //         even with a workspace id supplied via header.
  {
    const token = signToken(userNoMembership.id, userNoMembership.email);
    const res = await fetch(`${base}/contacts`, { headers: withWorkspaceHeader(token, wsA1.id) });
    check('5/6. User with zero memberships -> 403', res.status === 403);
  }

  // 7. Executive / org-wide role reaches a workspace with no direct membership row,
  //    but only inside its own Organization.
  {
    const tokenNoWs = signToken(userExec.id, userExec.email);
    const resAllowed = await fetch(`${base}/contacts`, { headers: withWorkspaceHeader(tokenNoWs, wsA1.id) });
    const resDenied = await fetch(`${base}/contacts`, { headers: withWorkspaceHeader(tokenNoWs, wsB1.id) });
    check(
      '7. Org-wide ORG_ADMIN reaches in-org workspace without direct membership -> 200, but cross-org -> 403',
      resAllowed.status === 200 && resDenied.status === 403,
    );
  }

  // 8. Header manipulation cannot override authenticated scope: token issued for wsA1,
  //    header claims a real, existing, but non-member workspace (wsB1) -> still rejected.
  {
    const token = signToken(userScoped.id, userScoped.email, wsA1.id);
    const res = await fetch(`${base}/contacts`, { headers: withWorkspaceHeader(token, wsB1.id) });
    check('8. Header cannot escalate to a real workspace the user is not a member of -> 403', res.status === 403);
  }

  // 9. Truly public routes need no auth at all. GET /workspaces/:id is NOT
  // unscoped -- it requires resolveAuthorizedWorkspace() (see
  // workspace-access.util.ts / test-workspace-controller-security.ts for
  // that check in isolation). This just confirms it doesn't need a
  // WorkspaceGuard-style header/token workspace claim on top of that --
  // userScoped's real membership in wsA1 is what makes this call succeed.
  {
    const healthRes = await fetch(`${base}/health`);
    const readyRes = await fetch(`${base}/ready`);
    const token = signToken(userScoped.id, userScoped.email); // no workspace claim at all
    const wsLookupRes = await fetch(`${base}/workspaces/${wsA1.id}`, { headers: { Authorization: `Bearer ${token}` } });
    check(
      '9. /health and /ready need no auth; GET /workspaces/:id needs no workspace-header/token claim (real membership auth still applies separately)',
      healthRes.status === 200 && readyRes.status === 200 && wsLookupRes.status === 200,
    );
  }

  // 10. Valid scoped membership succeeds end-to-end, and DOM26-R stays isolated on top of the new guard.
  {
    const token = signToken(userScoped.id, userScoped.email, wsA1.id);
    const createRes = await fetch(`${base}/dom26r/engrams`, {
      method: 'POST',
      headers: withWorkspaceHeader(token, wsA1.id),
      body: JSON.stringify({
        subjectType: SubjectType.CONTACT,
        subjectRefId: contact.id,
        form: MemoryForm.SEMANTIC,
        topic: MemoryTopic.PREFERENCE,
        truthClassification: TruthClassification.CONFIRMED,
        sensitivity: SensitivityClassification.INTERNAL,
        summary: 'Valid scoped write.',
        sources: [{ type: SourceType.MANUAL }],
      }),
    });
    const created = await createRes.json();
    const crossRes = await fetch(`${base}/dom26r/engrams`, { headers: withWorkspaceHeader(signToken(userMultiBU.id, userMultiBU.email, wsA2.id), wsA2.id) });
    const crossList = await crossRes.json();
    check(
      '10. Valid scoped membership succeeds and DOM26-R remains cross-BU isolated',
      createRes.status < 300 && !!created.id && !crossList.some((e: any) => e.id === created.id),
    );
  }

  await app.close();

  console.log('\n🧹 Cleaning up test database records...');
  await prisma.consentDirective.deleteMany({ where: { originatingBusinessId: { in: [buMktg.id, buPhoto.id] } } });
  await prisma.organization.delete({ where: { id: orgA.id } });
  await prisma.organization.delete({ where: { id: orgB.id } });
  console.log('✅ Cleanup complete.');

  console.log('=====================================================');
  console.log(`📊 WORKSPACEGUARD HARDENING SUITE: ${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exit(1);
}

runGuardTests()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
