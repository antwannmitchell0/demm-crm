// Phase 0 / Tasks T1 + T2/T3/T5 — High-risk agent approval regression suite.
//
// T1 (RED) established checks 1-7 against the then-broken code: approving a
// staged high-risk action re-entered the public execution path, re-ran the
// risk check, and staged a SECOND pending approval instead of executing.
//
// T2/T3/T5 (GREEN) repaired it. Checks 1-7 are preserved verbatim and must now
// pass. Checks 8-18 cover the rest of the repaired contract: staged requester
// role, separate approver metadata, lifecycle audit events, replay conflict,
// reject, expiry, legacy fail-closed, and cross-workspace isolation.
//
// Expired and legacy-null-role approvals cannot be produced through the public
// API (staging always records a role and a 7-day window), so those two
// fixtures are created directly in the database. Everything else is driven
// over HTTP.
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './src/app.module';
import {
  APPROVAL_AUDIT_ACTIONS,
  APPROVAL_REFUSAL_REASONS,
} from './src/modules/agent/agent.service';
import { PrismaClient, Role, ApprovalStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as jwt from 'jsonwebtoken';

dotenv.config();

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://antwannmitchellsr@localhost:5432/demm_crm';
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Teardown state, held outside the suite body so cleanup can run from the
// top-level `finally` even when a check throws mid-suite. Without this, a
// mid-suite failure leaked an Organization, two Workspaces, two Users and any
// AgentApproval rows (which have no FK cascade to Workspace).
let activeApp: { close: () => Promise<void> } | null = null;
let cleanupCtx: {
  orgId: string;
  workspaceIds: string[];
  userIds: string[];
} | null = null;

async function teardown() {
  if (activeApp) {
    await activeApp.close().catch(() => undefined);
    activeApp = null;
  }
  if (!cleanupCtx) return;
  console.log('\n🧹 Cleaning up test database records...');
  try {
    // AgentApproval.workspaceId is a plain string column (no FK/cascade in
    // schema.prisma), so deleting the Organization does NOT remove these rows.
    await prisma.agentApproval.deleteMany({
      where: { workspaceId: { in: cleanupCtx.workspaceIds } },
    });
    await prisma.organization.delete({ where: { id: cleanupCtx.orgId } });
    await prisma.user.deleteMany({ where: { id: { in: cleanupCtx.userIds } } });
    console.log('✅ Cleanup complete.');
  } catch (e) {
    console.error('⚠️  Cleanup failed:', (e as Error).message);
  }
  cleanupCtx = null;
}

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

async function runApprovalTests() {
  console.log('🧪 STARTING HIGH-RISK AGENT APPROVAL REGRESSION SUITE (Phase 0 T1 + T2/T3/T5)');
  console.log('==============================================================================');

  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.listen(0);
  activeApp = app;
  const server = app.getHttpServer();
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const suffix = Date.now();

  // --- Fixtures: one org, two workspaces (the second only to prove
  // cross-workspace isolation), a requester and a DISTINCT approver. ---
  const org = await prisma.organization.create({
    data: { name: `Approval Test Org ${suffix}` },
  });
  const ws = await prisma.workspace.create({
    data: { organizationId: org.id, name: 'Approval Test WS', subdomain: `approval-${suffix}` },
  });
  const wsOther = await prisma.workspace.create({
    data: { organizationId: org.id, name: 'Approval Other WS', subdomain: `approval-other-${suffix}` },
  });

  const requester = await prisma.user.create({
    data: {
      email: `approval-requester-${suffix}@example.com`,
      passwordHash: 'x',
      firstName: 'Rita',
      lastName: 'Requester',
    },
  });
  await prisma.membership.create({
    data: {
      userId: requester.id,
      organizationId: org.id,
      workspaceId: ws.id,
      role: Role.WORKSPACE_ADMIN,
      permissions: [],
    },
  });

  const approver = await prisma.user.create({
    data: {
      email: `approval-approver-${suffix}@example.com`,
      passwordHash: 'x',
      firstName: 'Alan',
      lastName: 'Approver',
    },
  });
  await prisma.membership.create({
    data: {
      userId: approver.id,
      organizationId: org.id,
      workspaceId: ws.id,
      role: Role.WORKSPACE_ADMIN,
      permissions: [],
    },
  });
  // Also a member of the second workspace, so the cross-workspace attempt is
  // rejected by approval ownership rather than incidentally by WorkspaceGuard.
  await prisma.membership.create({
    data: {
      userId: approver.id,
      organizationId: org.id,
      workspaceId: wsOther.id,
      role: Role.WORKSPACE_ADMIN,
      permissions: [],
    },
  });

  // Role fixtures for the T4 authority gate. Each is a REAL Membership in ws
  // carrying the role under test -- no organization or workspace membership
  // requirement is relaxed to manufacture them.
  const makeMember = async (label: string, role: Role) => {
    const u = await prisma.user.create({
      data: {
        email: `approval-${label}-${suffix}@example.com`,
        passwordHash: 'x',
        firstName: label,
        lastName: 'Member',
      },
    });
    await prisma.membership.create({
      data: {
        userId: u.id,
        organizationId: org.id,
        workspaceId: ws.id,
        role,
        permissions: [],
      },
    });
    return { user: u, token: signToken(u.id, u.email, ws.id) };
  };

  const plainUser = await makeMember('plainuser', Role.USER);
  const orgAdmin = await makeMember('orgadmin', Role.ORG_ADMIN);
  const orgOwner = await makeMember('orgowner', Role.ORG_OWNER);
  const superAdmin = await makeMember('superadmin', Role.SUPERADMIN);

  // Register teardown as soon as the destructible fixtures exist.
  cleanupCtx = {
    orgId: org.id,
    workspaceIds: [ws.id, wsOther.id],
    userIds: [
      requester.id,
      approver.id,
      plainUser.user.id,
      orgAdmin.user.id,
      orgOwner.user.id,
      superAdmin.user.id,
    ],
  };

  const pipeline = await prisma.pipeline.create({
    data: { name: 'Approval Test Pipeline', workspaceId: ws.id },
  });
  const stage = await prisma.stage.create({
    data: { name: 'New', order: 1, pipelineId: pipeline.id },
  });

  const headers = (token: string, workspaceId: string) => ({
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'x-workspace-id': workspaceId,
  });
  const requesterToken = signToken(requester.id, requester.email, ws.id);
  const approverToken = signToken(approver.id, approver.email, ws.id);
  const approverTokenOther = signToken(approver.id, approver.email, wsOther.id);

  const highRiskArgs = (name: string) => ({
    name,
    value: 9999,
    pipelineId: pipeline.id,
    stageId: stage.id,
  });

  const OPPORTUNITY_NAME = `High Risk Deal ${suffix}`;
  const REJECT_NAME = `Rejected Deal ${suffix}`;
  const EXPIRED_NAME = `Expired Deal ${suffix}`;
  const LEGACY_NAME = `Legacy Deal ${suffix}`;

  // ============================================================
  // SCENARIO A — the original T1 path: stage, then approve.
  // ============================================================
  const execRes = await fetch(`${base}/agent/execute`, {
    method: 'POST',
    headers: headers(requesterToken, ws.id),
    body: JSON.stringify({
      toolName: 'createOpportunity',
      arguments: highRiskArgs(OPPORTUNITY_NAME),
    }),
  });
  const execBody = await execRes.json();
  check(
    '1. High-risk action returns PENDING_APPROVAL with an approvalId (no immediate execution)',
    execRes.status === 201 &&
      execBody.status === 'PENDING_APPROVAL' &&
      typeof execBody.approvalId === 'string',
  );

  const approvalsAfterStage = await prisma.agentApproval.findMany({
    where: { workspaceId: ws.id },
  });
  const oppsAfterStage = await prisma.opportunity.count({
    where: { workspaceId: ws.id },
  });
  check(
    '2. Exactly one PENDING approval record exists after staging',
    approvalsAfterStage.length === 1 &&
      approvalsAfterStage[0].status === ApprovalStatus.PENDING &&
      approvalsAfterStage[0].requestedById === requester.id,
  );
  check('3. The opportunity was NOT created while approval is pending', oppsAfterStage === 0);

  // T2 coverage: staging captures the requester's role and an expiry window.
  check(
    '8. Staging records the requester role (WORKSPACE_ADMIN) and a future expiry',
    approvalsAfterStage[0].requesterRole === Role.WORKSPACE_ADMIN &&
      approvalsAfterStage[0].expiresAt !== null &&
      approvalsAfterStage[0].expiresAt!.getTime() > Date.now(),
  );

  const stagedAudit = await prisma.auditLog.findFirst({
    where: { workspaceId: ws.id, action: APPROVAL_AUDIT_ACTIONS.STAGED },
  });
  check(
    '9. An APPROVAL_STAGED audit row is written, actored by the requester',
    !!stagedAudit &&
      stagedAudit.actorType === 'USER' &&
      stagedAudit.actorId === requester.id &&
      (stagedAudit.payload as any)?.approvalId === execBody.approvalId,
  );

  const resolveRes = await fetch(
    `${base}/agent/approvals/${execBody.approvalId}/resolve`,
    {
      method: 'POST',
      headers: headers(approverToken, ws.id),
      body: JSON.stringify({ action: 'APPROVE' }),
    },
  );
  const resolveBody = await resolveRes.json();

  const approvalsAfterResolve = await prisma.agentApproval.findMany({
    where: { workspaceId: ws.id },
    orderBy: { createdAt: 'asc' },
  });
  const oppsAfterResolve = await prisma.opportunity.findMany({
    where: { workspaceId: ws.id },
  });
  const agentAuditRows = await prisma.auditLog.findMany({
    where: { workspaceId: ws.id, actorType: 'AGENT' },
    orderBy: { createdAt: 'asc' },
  });

  check(
    '4. Approving executes the requested action exactly once (opportunity exists)',
    oppsAfterResolve.length === 1 && oppsAfterResolve[0].name === OPPORTUNITY_NAME,
  );
  check(
    '5. No PENDING approval remains after the approval is resolved',
    approvalsAfterResolve.every((a) => a.status !== ApprovalStatus.PENDING),
  );
  check(
    '6. Exactly one approval record exists in total (approving must not spawn duplicates)',
    approvalsAfterResolve.length === 1,
  );
  check(
    '7. An AGENT audit row records the executed tool with the ORIGINAL requester as actor',
    agentAuditRows.some(
      (row) =>
        row.action === 'createOpportunity' &&
        row.actorId === requester.id &&
        row.response !== null &&
        !('error' in ((row.response as Record<string, unknown>) ?? {})),
    ),
  );

  const execAuditRow = agentAuditRows.find((r) => r.action === 'createOpportunity');
  check(
    '10. The execution audit carries the approver as SEPARATE metadata, not as the actor',
    !!execAuditRow &&
      execAuditRow.actorId === requester.id &&
      (execAuditRow.payload as any)?.approvedById === approver.id &&
      (execAuditRow.payload as any)?.requestedById === requester.id &&
      (execAuditRow.payload as any)?.approvalId === execBody.approvalId,
  );

  const approvedAudit = await prisma.auditLog.findFirst({
    where: { workspaceId: ws.id, action: APPROVAL_AUDIT_ACTIONS.APPROVED },
  });
  check(
    '11. An APPROVAL_APPROVED audit row records the approver as decision actor',
    !!approvedAudit &&
      approvedAudit.actorId === approver.id &&
      (approvedAudit.payload as any)?.requestedById === requester.id &&
      (approvedAudit.payload as any)?.approvedById === approver.id,
  );

  check(
    '12. The resolved approval stores requester and approver distinctly',
    approvalsAfterResolve[0].requestedById === requester.id &&
      approvalsAfterResolve[0].resolvedById === approver.id &&
      approvalsAfterResolve[0].status === ApprovalStatus.APPROVED,
  );

  // ============================================================
  // SCENARIO B — replayed APPROVE must conflict and not re-execute.
  // ============================================================
  const replayRes = await fetch(
    `${base}/agent/approvals/${execBody.approvalId}/resolve`,
    {
      method: 'POST',
      headers: headers(approverToken, ws.id),
      body: JSON.stringify({ action: 'APPROVE' }),
    },
  );
  const replayBody = await replayRes.json();
  const oppsAfterReplay = await prisma.opportunity.count({
    where: { workspaceId: ws.id, name: OPPORTUNITY_NAME },
  });
  check(
    '13. Replaying APPROVE returns 409 NOT_PENDING and does not execute a second time',
    replayRes.status === 409 &&
      replayBody.reason === APPROVAL_REFUSAL_REASONS.NOT_PENDING &&
      oppsAfterReplay === 1,
  );

  // ============================================================
  // SCENARIO C — REJECT executes nothing and audits the decision.
  // ============================================================
  const stageRejectRes = await fetch(`${base}/agent/execute`, {
    method: 'POST',
    headers: headers(requesterToken, ws.id),
    body: JSON.stringify({
      toolName: 'createOpportunity',
      arguments: highRiskArgs(REJECT_NAME),
    }),
  });
  const stageRejectBody = await stageRejectRes.json();

  const rejectRes = await fetch(
    `${base}/agent/approvals/${stageRejectBody.approvalId}/resolve`,
    {
      method: 'POST',
      headers: headers(approverToken, ws.id),
      body: JSON.stringify({ action: 'REJECT' }),
    },
  );
  const rejectBody = await rejectRes.json();
  const rejectedRow = await prisma.agentApproval.findUnique({
    where: { id: stageRejectBody.approvalId },
  });
  const rejectedOpps = await prisma.opportunity.count({
    where: { workspaceId: ws.id, name: REJECT_NAME },
  });
  const rejectedAudit = await prisma.auditLog.findFirst({
    where: { workspaceId: ws.id, action: APPROVAL_AUDIT_ACTIONS.REJECTED },
  });
  check(
    '14. REJECT marks the approval REJECTED, executes nothing, and writes APPROVAL_REJECTED',
    rejectRes.status === 201 &&
      rejectBody.status === 'REJECTED' &&
      rejectedRow?.status === ApprovalStatus.REJECTED &&
      rejectedRow?.resolvedById === approver.id &&
      rejectedOpps === 0 &&
      !!rejectedAudit &&
      rejectedAudit.actorId === approver.id,
  );

  // ============================================================
  // SCENARIO D — an expired approval cannot execute (DB fixture: the public
  // API always stages a 7-day window, so a lapsed one must be seeded).
  // ============================================================
  const expiredApproval = await prisma.agentApproval.create({
    data: {
      toolName: 'createOpportunity',
      arguments: highRiskArgs(EXPIRED_NAME),
      status: ApprovalStatus.PENDING,
      workspaceId: ws.id,
      requestedById: requester.id,
      requesterRole: Role.WORKSPACE_ADMIN,
      expiresAt: new Date(Date.now() - 60_000),
    },
  });
  const expiredRes = await fetch(
    `${base}/agent/approvals/${expiredApproval.id}/resolve`,
    {
      method: 'POST',
      headers: headers(approverToken, ws.id),
      body: JSON.stringify({ action: 'APPROVE' }),
    },
  );
  const expiredBody = await expiredRes.json();
  const expiredRow = await prisma.agentApproval.findUnique({
    where: { id: expiredApproval.id },
  });
  const expiredOpps = await prisma.opportunity.count({
    where: { workspaceId: ws.id, name: EXPIRED_NAME },
  });
  const expiredAudit = await prisma.auditLog.findFirst({
    where: { workspaceId: ws.id, action: APPROVAL_AUDIT_ACTIONS.EXPIRED },
  });
  check(
    '15. An expired approval is refused (409 EXPIRED), flipped to EXPIRED, and executes nothing',
    expiredRes.status === 409 &&
      expiredBody.reason === APPROVAL_REFUSAL_REASONS.EXPIRED &&
      expiredRow?.status === ApprovalStatus.EXPIRED &&
      expiredOpps === 0,
  );
  check(
    '16. An APPROVAL_EXPIRED audit row is written as a SYSTEM actor',
    !!expiredAudit &&
      expiredAudit.actorType === 'SYSTEM' &&
      expiredAudit.actorId === null &&
      (expiredAudit.payload as any)?.approvalId === expiredApproval.id,
  );

  // ============================================================
  // SCENARIO E — legacy PENDING row with no requesterRole fails closed.
  // ============================================================
  const legacyApproval = await prisma.agentApproval.create({
    data: {
      toolName: 'createOpportunity',
      arguments: highRiskArgs(LEGACY_NAME),
      status: ApprovalStatus.PENDING,
      workspaceId: ws.id,
      requestedById: requester.id,
      requesterRole: null,
      expiresAt: null,
    },
  });
  const legacyRes = await fetch(
    `${base}/agent/approvals/${legacyApproval.id}/resolve`,
    {
      method: 'POST',
      headers: headers(approverToken, ws.id),
      body: JSON.stringify({ action: 'APPROVE' }),
    },
  );
  const legacyBody = await legacyRes.json();
  const legacyRow = await prisma.agentApproval.findUnique({
    where: { id: legacyApproval.id },
  });
  const legacyOpps = await prisma.opportunity.count({
    where: { workspaceId: ws.id, name: LEGACY_NAME },
  });
  check(
    '17. A legacy PENDING approval with no requesterRole fails closed and executes nothing',
    legacyRes.status === 409 &&
      legacyBody.reason === APPROVAL_REFUSAL_REASONS.MISSING_REQUESTER_ROLE &&
      legacyOpps === 0 &&
      legacyRow?.status === ApprovalStatus.PENDING,
  );

  // ============================================================
  // SCENARIO F — cross-workspace resolution stays impossible.
  // ============================================================
  const foreignApproval = await prisma.agentApproval.create({
    data: {
      toolName: 'createOpportunity',
      arguments: highRiskArgs(`Foreign Deal ${suffix}`),
      status: ApprovalStatus.PENDING,
      workspaceId: ws.id,
      requestedById: requester.id,
      requesterRole: Role.WORKSPACE_ADMIN,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const crossRes = await fetch(
    `${base}/agent/approvals/${foreignApproval.id}/resolve`,
    {
      method: 'POST',
      // Same approver, but acting inside the OTHER workspace they belong to.
      headers: headers(approverTokenOther, wsOther.id),
      body: JSON.stringify({ action: 'APPROVE' }),
    },
  );
  const crossRow = await prisma.agentApproval.findUnique({
    where: { id: foreignApproval.id },
  });
  check(
    '18. Cross-workspace resolution is denied (404) and leaves the approval untouched',
    crossRes.status === 404 &&
      crossRow?.status === ApprovalStatus.PENDING &&
      crossRow?.resolvedById === null,
  );

  // ============================================================
  // SCENARIO G — the ordinary (non-high-risk) path still executes inline.
  // Guards the T3 extraction of the execution core into runTool(): this is the
  // path production uses most, and it must NOT stage an approval. Uses
  // createContact so it cannot perturb the opportunity counts asserted above.
  // ============================================================
  const lowRiskRes = await fetch(`${base}/agent/execute`, {
    method: 'POST',
    headers: headers(requesterToken, ws.id),
    body: JSON.stringify({
      toolName: 'createContact',
      arguments: {
        firstName: 'Lowrisk',
        lastName: `Contact${suffix}`,
        emails: [`lowrisk-${suffix}@example.com`],
      },
    }),
  });
  const lowRiskBody = await lowRiskRes.json();
  const lowRiskContact = await prisma.contact.findFirst({
    where: { workspaceId: ws.id, lastName: `Contact${suffix}` },
  });
  const lowRiskApprovals = await prisma.agentApproval.count({
    where: { workspaceId: ws.id, toolName: 'createContact' },
  });
  const lowRiskAudit = await prisma.auditLog.findFirst({
    where: { workspaceId: ws.id, action: 'createContact', actorType: 'AGENT' },
  });
  check(
    '19. A non-high-risk action executes inline with SUCCESS, stages no approval, and audits the caller',
    lowRiskRes.status === 201 &&
      lowRiskBody.status === 'SUCCESS' &&
      !!lowRiskContact &&
      lowRiskApprovals === 0 &&
      !!lowRiskAudit &&
      lowRiskAudit.actorId === requester.id &&
      lowRiskAudit.response !== null &&
      !('error' in ((lowRiskAudit.response as Record<string, unknown>) ?? {})),
  );

  // ============================================================
  // SCENARIO H — R2: GENUINE CONCURRENCY. Two APPROVE requests fired
  // simultaneously at one approval via Promise.all. This is what actually
  // exercises the atomic conditional UPDATE; check 13's replay is sequential
  // and cannot prove the claim serializes competing callers.
  // ============================================================
  const CONCURRENT_NAME = `Concurrent Deal ${suffix}`;
  const stageConcRes = await fetch(`${base}/agent/execute`, {
    method: 'POST',
    headers: headers(requesterToken, ws.id),
    body: JSON.stringify({
      toolName: 'createOpportunity',
      arguments: highRiskArgs(CONCURRENT_NAME),
    }),
  });
  const stageConcBody = await stageConcRes.json();
  const approvalsBeforeRace = await prisma.agentApproval.count({
    where: { workspaceId: ws.id },
  });

  const resolveConcurrently = () =>
    fetch(`${base}/agent/approvals/${stageConcBody.approvalId}/resolve`, {
      method: 'POST',
      headers: headers(approverToken, ws.id),
      body: JSON.stringify({ action: 'APPROVE' }),
    });
  const [raceA, raceB] = await Promise.all([
    resolveConcurrently(),
    resolveConcurrently(),
  ]);
  const raceStatuses = [raceA.status, raceB.status].sort((a, b) => a - b);
  const raceBodies = await Promise.all([raceA.json(), raceB.json()]);
  const raceConflict = raceBodies.find((b: any) => b?.reason);

  const raceOpps = await prisma.opportunity.count({
    where: { workspaceId: ws.id, name: CONCURRENT_NAME },
  });
  const approvalsAfterRace = await prisma.agentApproval.count({
    where: { workspaceId: ws.id },
  });
  const raceRow = await prisma.agentApproval.findUnique({
    where: { id: stageConcBody.approvalId },
  });
  const raceExecAudits = (
    await prisma.auditLog.findMany({
      where: {
        workspaceId: ws.id,
        actorType: 'AGENT',
        action: 'createOpportunity',
      },
    })
  ).filter((r) => (r.payload as any)?.approvalId === stageConcBody.approvalId);

  check(
    '20. Concurrent APPROVE: exactly one 201 and one 409 with reason APPROVAL_NOT_PENDING',
    raceStatuses[0] === 201 &&
      raceStatuses[1] === 409 &&
      raceConflict?.reason === APPROVAL_REFUSAL_REASONS.NOT_PENDING,
  );
  check(
    '21. Concurrent APPROVE executes the action exactly once',
    raceOpps === 1,
  );
  check(
    '22. Concurrent APPROVE adds no approval row and leaves nothing PENDING',
    approvalsAfterRace === approvalsBeforeRace &&
      raceRow?.status === ApprovalStatus.APPROVED &&
      raceRow?.resolvedById === approver.id,
  );
  check(
    '23. Exactly one approved-execution audit row exists for the contested approval',
    raceExecAudits.length === 1,
  );

  const lateRes = await resolveConcurrently();
  const lateOpps = await prisma.opportunity.count({
    where: { workspaceId: ws.id, name: CONCURRENT_NAME },
  });
  check(
    '24. A later repeated APPROVE still executes nothing',
    lateRes.status === 409 && lateOpps === 1,
  );

  // ============================================================
  // SCENARIO I — R3: staging is refused when redaction would alter the
  // arguments that would later be executed. Uses the REAL createOpportunity
  // tool (high-risk at value > 5000) with one extra secret-bearing field, so
  // no test-only tool is registered into the production registry.
  // ============================================================
  const SECRET_VALUE = `sk-live-must-never-appear-${suffix}`;
  const DIVERGENT_NAME = `Divergent Deal ${suffix}`;
  const approvalsBeforeGuard = await prisma.agentApproval.count({
    where: { workspaceId: ws.id },
  });
  const guardRes = await fetch(`${base}/agent/execute`, {
    method: 'POST',
    headers: headers(requesterToken, ws.id),
    body: JSON.stringify({
      toolName: 'createOpportunity',
      arguments: { ...highRiskArgs(DIVERGENT_NAME), apiKey: SECRET_VALUE },
    }),
  });
  const guardRaw = await guardRes.text();
  const guardBody = JSON.parse(guardRaw);
  const approvalsAfterGuard = await prisma.agentApproval.count({
    where: { workspaceId: ws.id },
  });
  const guardOpps = await prisma.opportunity.count({
    where: { workspaceId: ws.id, name: DIVERGENT_NAME },
  });
  const guardAudit = await prisma.auditLog.findFirst({
    where: {
      workspaceId: ws.id,
      action: APPROVAL_AUDIT_ACTIONS.STAGING_REFUSED,
    },
  });
  const guardAuditJson = JSON.stringify(guardAudit?.payload ?? {});

  check(
    '25. Redaction-diverging arguments are refused at staging (400 ARGUMENTS_NOT_STORABLE)',
    guardRes.status === 400 &&
      guardBody.reason === APPROVAL_REFUSAL_REASONS.ARGUMENTS_NOT_STORABLE,
  );
  check(
    '26. The refusal stored no approval row and executed no tool',
    approvalsAfterGuard === approvalsBeforeGuard && guardOpps === 0,
  );
  check(
    '27. The refusal names the offending field but never echoes the secret value',
    Array.isArray(guardBody.unstorableFields) &&
      guardBody.unstorableFields.includes('apiKey') &&
      !guardRaw.includes(SECRET_VALUE),
  );
  check(
    '28. An APPROVAL_STAGING_REFUSED audit row exists, names the field, and holds no secret',
    !!guardAudit &&
      guardAuditJson.includes('apiKey') &&
      !guardAuditJson.includes(SECRET_VALUE),
  );

  // ============================================================
  // T4 helpers. Compact wrappers over the same HTTP surface the scenarios
  // above use -- no new privilege path, no direct service access.
  // ============================================================
  const stageHighRisk = async (name: string): Promise<string> => {
    const res = await fetch(`${base}/agent/execute`, {
      method: 'POST',
      headers: headers(requesterToken, ws.id),
      body: JSON.stringify({
        toolName: 'createOpportunity',
        arguments: highRiskArgs(name),
      }),
    });
    return (await res.json()).approvalId as string;
  };
  const resolveAs = (
    approvalId: string,
    action: 'APPROVE' | 'REJECT',
    token: string,
  ) =>
    fetch(`${base}/agent/approvals/${approvalId}/resolve`, {
      method: 'POST',
      headers: headers(token, ws.id),
      body: JSON.stringify({ action }),
    });
  const oppCount = (name: string) =>
    prisma.opportunity.count({ where: { workspaceId: ws.id, name } });
  const approvalRow = (id: string) =>
    prisma.agentApproval.findUnique({ where: { id } });

  // ============================================================
  // SCENARIO J — T4.1: administrative role gate on approval resolution.
  // ============================================================
  const GATE_NAME = `Role Gate Deal ${suffix}`;
  const gateId = await stageHighRisk(GATE_NAME);
  const approvalsBeforeGate = await prisma.agentApproval.count({
    where: { workspaceId: ws.id },
  });

  const userApprove = await resolveAs(gateId, 'APPROVE', plainUser.token);
  const userReject = await resolveAs(gateId, 'REJECT', plainUser.token);
  const gateRowAfterUser = await approvalRow(gateId);
  check(
    '29. A USER role cannot APPROVE or REJECT (403 each); the approval stays PENDING and nothing executes',
    userApprove.status === 403 &&
      userReject.status === 403 &&
      gateRowAfterUser?.status === ApprovalStatus.PENDING &&
      gateRowAfterUser?.resolvedById === null &&
      (await oppCount(GATE_NAME)) === 0 &&
      (await prisma.agentApproval.count({ where: { workspaceId: ws.id } })) ===
        approvalsBeforeGate,
  );

  // WORKSPACE_ADMIN resolves this one (also re-proves guard ORDER: if
  // RolesGuard ran before WorkspaceGuard, user.role would be undefined and
  // every role below would 403, not just USER).
  const wsAdminResolve = await resolveAs(gateId, 'APPROVE', approverToken);
  check(
    '30. WORKSPACE_ADMIN can resolve an approval and the action executes once',
    wsAdminResolve.status === 201 && (await oppCount(GATE_NAME)) === 1,
  );

  const ORG_ADMIN_NAME = `OrgAdmin Deal ${suffix}`;
  const orgAdminRes = await resolveAs(
    await stageHighRisk(ORG_ADMIN_NAME),
    'APPROVE',
    orgAdmin.token,
  );
  check(
    '31. ORG_ADMIN can resolve an approval and the action executes once',
    orgAdminRes.status === 201 && (await oppCount(ORG_ADMIN_NAME)) === 1,
  );

  const ORG_OWNER_NAME = `OrgOwner Deal ${suffix}`;
  const orgOwnerRes = await resolveAs(
    await stageHighRisk(ORG_OWNER_NAME),
    'APPROVE',
    orgOwner.token,
  );
  check(
    '32. ORG_OWNER can resolve an approval and the action executes once',
    orgOwnerRes.status === 201 && (await oppCount(ORG_OWNER_NAME)) === 1,
  );

  const SUPERADMIN_NAME = `SuperAdmin Deal ${suffix}`;
  const superAdminRes = await resolveAs(
    await stageHighRisk(SUPERADMIN_NAME),
    'APPROVE',
    superAdmin.token,
  );
  check(
    '33. SUPERADMIN can resolve an approval and the action executes once',
    superAdminRes.status === 201 && (await oppCount(SUPERADMIN_NAME)) === 1,
  );

  // ============================================================
  // SCENARIO K — T4.2: self-approval prevention (separation of duties).
  // The requester holds WORKSPACE_ADMIN, so they PASS the role gate and are
  // stopped specifically by the separation-of-duties rule.
  // ============================================================
  const SELF_NAME = `Self Approval Deal ${suffix}`;
  const selfId = await stageHighRisk(SELF_NAME);
  const approvalsBeforeSelf = await prisma.agentApproval.count({
    where: { workspaceId: ws.id },
  });

  const selfAttempt = await resolveAs(selfId, 'APPROVE', requesterToken);
  const selfBody = await selfAttempt.json();
  const selfRow = await approvalRow(selfId);
  const approvalsAfterSelf = await prisma.agentApproval.count({
    where: { workspaceId: ws.id },
  });
  const selfRefusalAudit = await prisma.auditLog.findFirst({
    where: {
      workspaceId: ws.id,
      action: APPROVAL_AUDIT_ACTIONS.SELF_APPROVAL_REFUSED,
    },
  });

  check(
    '34. A requester approving their own request is refused (403 SELF_APPROVAL_FORBIDDEN)',
    selfAttempt.status === 403 &&
      selfBody.reason === APPROVAL_REFUSAL_REASONS.SELF_APPROVAL_FORBIDDEN,
  );
  check(
    '35. The refused self-approval leaves the approval PENDING, executes nothing, and creates no duplicate',
    selfRow?.status === ApprovalStatus.PENDING &&
      selfRow?.resolvedById === null &&
      selfRow?.requestedById === requester.id &&
      (await oppCount(SELF_NAME)) === 0 &&
      approvalsAfterSelf === approvalsBeforeSelf,
  );
  check(
    '36. A SELF_APPROVAL_REFUSED audit row is written and is NOT recorded as a rejection',
    !!selfRefusalAudit &&
      selfRefusalAudit.actorId === requester.id &&
      (selfRefusalAudit.payload as any)?.outcome === 'REFUSED_SELF_APPROVAL' &&
      (selfRefusalAudit.payload as any)?.approvalId === selfId &&
      selfRefusalAudit.action !== APPROVAL_AUDIT_ACTIONS.REJECTED,
  );

  const otherAdminApprove = await resolveAs(selfId, 'APPROVE', approverToken);
  const selfRowAfter = await approvalRow(selfId);
  check(
    '37. A different authorized administrator can still approve it afterwards, executing exactly once',
    otherAdminApprove.status === 201 &&
      (await oppCount(SELF_NAME)) === 1 &&
      selfRowAfter?.status === ApprovalStatus.APPROVED &&
      selfRowAfter?.resolvedById === approver.id,
  );

  const selfLifecycleRows = await prisma.auditLog.findMany({
    where: { workspaceId: ws.id },
  });
  const selfScoped = selfLifecycleRows.filter(
    (r) => (r.payload as any)?.approvalId === selfId,
  );
  check(
    '38. The audit trail distinguishes the refused self-approval from the later valid approval',
    selfScoped.filter(
      (r) => r.action === APPROVAL_AUDIT_ACTIONS.SELF_APPROVAL_REFUSED,
    ).length === 1 &&
      selfScoped.filter((r) => r.action === APPROVAL_AUDIT_ACTIONS.APPROVED)
        .length === 1,
  );

  // ============================================================
  // SCENARIO L — T4.3: self-rejection permitted as cancellation.
  // ============================================================
  const SELFREJ_NAME = `Self Reject Deal ${suffix}`;
  const selfRejId = await stageHighRisk(SELFREJ_NAME);
  const selfRejRes = await resolveAs(selfRejId, 'REJECT', requesterToken);
  const selfRejBody = await selfRejRes.json();
  const selfRejRow = await approvalRow(selfRejId);
  check(
    '39. A requester may reject (cancel) their own request; it executes nothing and records them as resolver',
    selfRejRes.status === 201 &&
      selfRejBody.status === 'REJECTED' &&
      selfRejRow?.status === ApprovalStatus.REJECTED &&
      selfRejRow?.resolvedById === requester.id &&
      (await oppCount(SELFREJ_NAME)) === 0,
  );

  const reverseAttempt = await resolveAs(selfRejId, 'APPROVE', approverToken);
  const reverseBody = await reverseAttempt.json();
  const selfRejRowAfter = await approvalRow(selfRejId);
  check(
    '40. A later APPROVE cannot reverse the rejection: conflict, nothing executed, resolver unchanged',
    reverseAttempt.status === 409 &&
      reverseBody.reason === APPROVAL_REFUSAL_REASONS.NOT_PENDING &&
      (await oppCount(SELFREJ_NAME)) === 0 &&
      selfRejRowAfter?.status === ApprovalStatus.REJECTED &&
      selfRejRowAfter?.resolvedById === requester.id,
  );

  // ============================================================
  // SCENARIO M — T4.1: resolution-action input validation.
  //
  // The controller previously read `@Body('action')` typed as a TypeScript
  // union, which is erased at runtime. The service treats REJECT as one branch
  // and routes EVERYTHING ELSE through the APPROVE path, so any unrecognised
  // runtime value silently approved a high-risk action. Every case below must
  // be rejected with 400 and must leave the approval untouched.
  // ============================================================
  const resolveRaw = (approvalId: string, rawBody: unknown, token: string) =>
    fetch(`${base}/agent/approvals/${approvalId}/resolve`, {
      method: 'POST',
      headers: headers(token, ws.id),
      body: JSON.stringify(rawBody),
    });

  const INVALID_NAME = `Invalid Action Deal ${suffix}`;
  const invalidId = await stageHighRisk(INVALID_NAME);
  const approvalsBeforeInvalid = await prisma.agentApproval.count({
    where: { workspaceId: ws.id },
  });

  const invalidCases: Array<{ label: string; body: unknown }> = [
    { label: "misspelling 'APROVE'", body: { action: 'APROVE' } },
    { label: "lowercase 'approve'", body: { action: 'approve' } },
    { label: "unknown 'DELETE'", body: { action: 'DELETE' } },
    { label: 'empty string', body: { action: '' } },
    { label: 'missing action', body: {} },
    { label: 'null action', body: { action: null } },
    { label: 'number action', body: { action: 5 } },
    { label: 'boolean action', body: { action: true } },
    { label: 'object action', body: { action: { APPROVE: true } } },
    { label: 'array action', body: { action: ['APPROVE'] } },
    { label: 'whitespace-padded APPROVE', body: { action: ' APPROVE ' } },
    {
      label: 'valid APPROVE plus unknown extra field',
      body: { action: 'APPROVE', unexpectedField: 'x' },
    },
  ];

  const invalidResults: Array<{ label: string; status: number }> = [];
  for (const c of invalidCases) {
    const res = await resolveRaw(invalidId, c.body, approverToken);
    invalidResults.push({ label: c.label, status: res.status });
  }
  const allRejected = invalidResults.every((r) => r.status === 400);

  const invalidRow = await approvalRow(invalidId);
  const invalidOpps = await oppCount(INVALID_NAME);
  const approvalsAfterInvalid = await prisma.agentApproval.count({
    where: { workspaceId: ws.id },
  });
  const invalidScopedAudit = (
    await prisma.auditLog.findMany({ where: { workspaceId: ws.id } })
  ).filter((r) => (r.payload as any)?.approvalId === invalidId);
  const invalidDecisionAudits = invalidScopedAudit.filter(
    (r) =>
      r.action === APPROVAL_AUDIT_ACTIONS.APPROVED ||
      r.action === APPROVAL_AUDIT_ACTIONS.REJECTED,
  );

  check(
    `41. Every malformed resolution action is rejected with HTTP 400 (${invalidResults.filter((r) => r.status === 400).length}/${invalidCases.length})`,
    allRejected,
  );
  check(
    '42. After every malformed attempt the approval is still PENDING with no resolver',
    invalidRow?.status === ApprovalStatus.PENDING &&
      invalidRow?.resolvedById === null,
  );
  check(
    '43. No malformed attempt executed a tool or created a duplicate approval',
    invalidOpps === 0 && approvalsAfterInvalid === approvalsBeforeInvalid,
  );
  check(
    '44. No APPROVED or REJECTED audit event was written for the malformed attempts',
    invalidDecisionAudits.length === 0,
  );

  // The endpoint still works for the two legitimate values.
  const validApproveAfterInvalid = await resolveAs(
    invalidId,
    'APPROVE',
    approverToken,
  );
  check(
    '45. A valid APPROVE still succeeds after the malformed attempts and executes once',
    validApproveAfterInvalid.status === 201 &&
      (await oppCount(INVALID_NAME)) === 1,
  );

  const VALID_REJECT_NAME = `Valid Reject Deal ${suffix}`;
  const validRejectId = await stageHighRisk(VALID_REJECT_NAME);
  const validRejectRes = await resolveAs(validRejectId, 'REJECT', approverToken);
  const validRejectRow = await approvalRow(validRejectId);
  check(
    '46. A valid REJECT still succeeds and executes nothing',
    validRejectRes.status === 201 &&
      validRejectRow?.status === ApprovalStatus.REJECTED &&
      (await oppCount(VALID_REJECT_NAME)) === 0,
  );

  // --- EVIDENCE DUMP (informational) ---
  console.log('\n🔎 APPROVAL LIFECYCLE EVIDENCE');
  console.log(`   Scenario A resolve status: ${resolveRes.status}`);
  console.log(`   Scenario A resolve body: ${JSON.stringify(resolveBody)}`);
  console.log(`   Replay status/body: ${replayRes.status} ${JSON.stringify(replayBody)}`);
  console.log(`   Expired status/body: ${expiredRes.status} ${JSON.stringify(expiredBody)}`);
  console.log(`   Legacy status/body: ${legacyRes.status} ${JSON.stringify(legacyBody)}`);
  console.log(`   Cross-workspace status: ${crossRes.status}`);
  console.log(
    `   Concurrent APPROVE statuses: [${raceStatuses.join(', ')}] conflictReason=${raceConflict?.reason ?? 'none'} opportunities=${raceOpps} execAuditRows=${raceExecAudits.length}`,
  );
  console.log(`   Later repeated APPROVE status: ${lateRes.status}`);
  console.log('   Malformed resolution-action attempts (expect 400 for every case):');
  for (const r of invalidResults) {
    console.log(`     - ${r.label}: HTTP ${r.status}`);
  }
  console.log(
    `   Redaction-guard status=${guardRes.status} reason=${guardBody.reason} unstorableFields=${JSON.stringify(guardBody.unstorableFields)} secretLeakedInResponse=${guardRaw.includes(SECRET_VALUE)} secretLeakedInAudit=${guardAuditJson.includes(SECRET_VALUE)}`,
  );
  const allApprovals = await prisma.agentApproval.findMany({
    where: { workspaceId: { in: [ws.id, wsOther.id] } },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`   AgentApproval rows (${allApprovals.length}):`);
  for (const a of allApprovals) {
    const who = (id: string | null) =>
      id === requester.id ? 'REQUESTER' : id === approver.id ? 'APPROVER' : id;
    console.log(
      `     - status=${a.status} tool=${a.toolName} requestedBy=${who(a.requestedById)} requesterRole=${a.requesterRole} resolvedBy=${who(a.resolvedById)}`,
    );
  }
  const lifecycleRows = await prisma.auditLog.findMany({
    where: {
      workspaceId: ws.id,
      action: { in: Object.values(APPROVAL_AUDIT_ACTIONS) as string[] },
    },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`   Approval lifecycle audit rows (${lifecycleRows.length}):`);
  for (const r of lifecycleRows) {
    console.log(
      `     - ${r.action} actorType=${r.actorType} outcome=${(r.payload as any)?.outcome}`,
    );
  }
  const opps = await prisma.opportunity.findMany({ where: { workspaceId: ws.id } });
  console.log(`   Opportunities created (${opps.length}): ${opps.map((o) => o.name).join(', ')}`);

  console.log('==============================================================================');
  console.log(`📊 AGENT APPROVAL REGRESSION SUITE: ${pass} passed, ${fail} failed.`);
  // process.exitCode (not process.exit) so the top-level finally below still
  // runs teardown -- process.exit would abandon it and leak fixtures.
  if (fail > 0) process.exitCode = 1;
}

runApprovalTests()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await teardown();
    await prisma.$disconnect();
    await pool.end();
  });
