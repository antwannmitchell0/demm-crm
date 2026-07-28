// Phase 2 -- approval inbox and requester cancellation.
//
// THE DEFECT THIS EXISTS TO CATCH
//
// High-risk actions were staged for approval correctly, audited correctly, and
// then became invisible. There was NO endpoint that listed them. An approval
// could be created from the UI and resolved only by someone constructing
// `POST /agent/approvals/:id/resolve` by hand with an id they had no way to
// obtain. In practice that meant a staged action sat until it expired.
//
// The requester had no way out either. Having staged something by mistake, they
// could not withdraw it -- only an administrator could reject it, and only if
// they somehow learned it existed. Cancellation is deliberately a distinct
// terminal state from REJECTED: a requester withdrawing their own request and
// an approver declining it are different governance facts, exactly as EXPIRED
// is kept distinct from REJECTED.
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './src/app.module';
import { assertDisposableTestDatabase } from './test-db-guard';
import { PrismaClient, Role, ApprovalStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as jwt from 'jsonwebtoken';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

let pass = 0;
let fail = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`✅ [PASS] ${label}`);
    pass++;
  } else {
    console.log(`❌ [FAIL] ${label}${detail ? ` -- ${detail}` : ''}`);
    fail++;
  }
}

let activeApp: { close: () => Promise<void> } | null = null;
let cleanupCtx: { orgIds: string[]; userIds: string[]; workspaceIds: string[] } | null =
  null;

async function teardown() {
  if (activeApp) {
    await activeApp.close().catch(() => undefined);
    activeApp = null;
  }
  if (cleanupCtx) {
    const u = { in: cleanupCtx.userIds };
    // AgentApproval.workspaceId is a plain column with no FK cascade, so
    // deleting the Organization does NOT remove these rows.
    await prisma.agentApproval
      .deleteMany({ where: { workspaceId: { in: cleanupCtx.workspaceIds } } })
      .catch(() => undefined);
    await prisma.auditLog.deleteMany({ where: { userId: u } }).catch(() => undefined);
    await prisma.refreshToken.deleteMany({ where: { userId: u } }).catch(() => undefined);
    await prisma.membership.deleteMany({ where: { userId: u } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: u } }).catch(() => undefined);
    await prisma.organization
      .deleteMany({ where: { id: { in: cleanupCtx.orgIds } } })
      .catch(() => undefined);
  }
  await prisma.$disconnect().catch(() => undefined);
}

async function main() {
  await assertDisposableTestDatabase('test-approval-inbox.ts');

  console.log('🧪 PHASE 2 APPROVAL INBOX SUITE');
  console.log('==========================================================');

  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(0);
  activeApp = app;
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as any).port}`;

  const suffix = Date.now();
  const org = await prisma.organization.create({
    data: { name: `Inbox Org ${suffix}` },
  });
  const ws = await prisma.workspace.create({
    data: { organizationId: org.id, name: 'Inbox WS', subdomain: `inbox-${suffix}` },
  });
  const otherWs = await prisma.workspace.create({
    data: {
      organizationId: org.id,
      name: 'Inbox Other',
      subdomain: `inbox-other-${suffix}`,
    },
  });

  const userIds: string[] = [];
  const makeUser = async (label: string, workspaceId: string, role: Role) => {
    const u = await prisma.user.create({
      data: {
        email: `inbox-${label}-${suffix}@example.invalid`,
        passwordHash: 'x',
        firstName: label,
        lastName: 'Person',
      },
    });
    userIds.push(u.id);
    await prisma.membership.create({
      data: {
        userId: u.id,
        organizationId: org.id,
        workspaceId,
        role,
        permissions: [],
      },
    });
    return {
      user: u,
      token: jwt.sign({ sub: u.id, email: u.email, workspaceId }, process.env.JWT_SECRET!, {
        expiresIn: '15m',
      }),
    };
  };

  const requester = await makeUser('requester', ws.id, Role.WORKSPACE_ADMIN);
  const approver = await makeUser('approver', ws.id, Role.ORG_OWNER);
  const bystander = await makeUser('bystander', ws.id, Role.USER);
  const outsider = await makeUser('outsider', otherWs.id, Role.ORG_OWNER);

  cleanupCtx = {
    orgIds: [org.id],
    userIds,
    workspaceIds: [ws.id, otherWs.id],
  };

  const call = (method: string, url: string, token: string, body?: unknown, wsId?: string) =>
    fetch(`${base}${url}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(wsId ? { 'x-workspace-id': wsId } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  // Stage a real high-risk approval through the public path: createOpportunity
  // above 5000 is the only tool whose isHighRisk predicate returns true.
  const stage = async (token: string, name: string) => {
    const res = await call('POST', '/agent/execute', token, {
      toolName: 'createOpportunity',
      arguments: {
        name,
        value: 9000,
        pipelineId: '00000000-0000-4000-8000-000000000001',
        stageId: '00000000-0000-4000-8000-000000000002',
      },
    });
    return res.json();
  };

  const staged: any = await stage(requester.token, `Inbox Deal ${suffix}`);
  const approvalId = staged?.approvalId ?? staged?.id;

  // ===== A. The inbox exists and is scoped =====
  {
    const anon = await fetch(`${base}/agent/approvals`);
    check(`1. GET /agent/approvals requires authentication (got ${anon.status})`, anon.status === 401);

    const res = await call('GET', '/agent/approvals', approver.token);
    check(`2. An approver can list pending approvals (got ${res.status})`, res.status === 200);

    const body: any = await res.json();
    const list: any[] = Array.isArray(body?.approvals) ? body.approvals : [];
    check(
      `3. The staged approval appears in the inbox (got ${list.length})`,
      list.length >= 1 && list.some((a) => a.id === approvalId),
    );

    const entry = list.find((a) => a.id === approvalId);
    check(
      '4. Each entry says what action is waiting, who asked, and when it expires',
      typeof entry?.toolName === 'string' &&
        typeof entry?.requestedByEmail === 'string' &&
        typeof entry?.createdAt === 'string' &&
        entry?.expiresAt !== undefined,
    );
    check(
      `5. The entry names the tool that was staged (got "${entry?.toolName}")`,
      entry?.toolName === 'createOpportunity',
    );
    check(
      '6. The entry shows the arguments so an approver can judge the request',
      !!entry?.arguments && (entry.arguments as any).value === 9000,
    );
    check(
      '7. The requester\'s staging-time role is shown, not the approver\'s',
      entry?.requesterRole === Role.WORKSPACE_ADMIN,
    );

    // Scope: an approval staged in this workspace must not be visible from
    // another one, even to an owner.
    const cross = await call('GET', '/agent/approvals', outsider.token, undefined, otherWs.id);
    const crossBody: any = await cross.json();
    const crossList: any[] = Array.isArray(crossBody?.approvals) ? crossBody.approvals : [];
    check(
      '8. Approvals never leak across workspaces',
      !crossList.some((a) => a.id === approvalId),
    );
  }

  // ===== B. A requester can see and withdraw their own request =====
  {
    const mine = await call('GET', '/agent/approvals', requester.token);
    const body: any = await mine.json();
    const list: any[] = Array.isArray(body?.approvals) ? body.approvals : [];
    check(
      `9. The requester can see their own pending request (got ${mine.status})`,
      mine.status === 200 && list.some((a) => a.id === approvalId),
    );

    const byOther = await call('POST', `/agent/approvals/${approvalId}/cancel`, bystander.token);
    check(
      `10. Someone else's request cannot be cancelled (got ${byOther.status})`,
      byOther.status === 403,
    );
    const stillPending = await prisma.agentApproval.findUnique({ where: { id: approvalId } });
    check(
      '11. That refusal leaves the approval pending',
      stillPending?.status === ApprovalStatus.PENDING,
    );

    const res = await call('POST', `/agent/approvals/${approvalId}/cancel`, requester.token);
    check(`12. The requester can cancel their own request (got ${res.status})`, res.status === 200 || res.status === 201);

    const cancelled = await prisma.agentApproval.findUnique({ where: { id: approvalId } });
    check(
      `13. Cancellation is a DISTINCT terminal state, not REJECTED (got ${cancelled?.status})`,
      cancelled?.status === 'CANCELLED',
    );

    const audit = await prisma.auditLog.findMany({
      where: { workspaceId: ws.id, action: 'APPROVAL_CANCELLED' },
    });
    check(
      `14. Cancellation is audited under its own action (found ${audit.length})`,
      audit.length === 1,
    );

    const twice = await call('POST', `/agent/approvals/${approvalId}/cancel`, requester.token);
    check(
      `15. A cancelled request cannot be cancelled again (got ${twice.status})`,
      twice.status === 409 || twice.status === 400,
    );

    // And it must be genuinely dead: approving it now must not execute.
    const resolveAfter = await call(
      'POST',
      `/agent/approvals/${approvalId}/resolve`,
      approver.token,
      { action: 'APPROVE' },
    );
    check(
      `16. A cancelled request cannot afterwards be approved (got ${resolveAfter.status})`,
      resolveAfter.status === 409,
    );
    const final = await prisma.agentApproval.findUnique({ where: { id: approvalId } });
    check(
      '17. It stays CANCELLED after that attempt',
      final?.status === 'CANCELLED',
    );
  }

  // ===== C. Filtering and resolved history =====
  {
    const second: any = await stage(requester.token, `Second Deal ${suffix}`);
    const secondId = second?.approvalId ?? second?.id;

    const pendingOnly = await call('GET', '/agent/approvals?status=PENDING', approver.token);
    const pendingBody: any = await pendingOnly.json();
    const pendingList: any[] = Array.isArray(pendingBody?.approvals)
      ? pendingBody.approvals
      : [];
    check(
      `18. The inbox can be filtered to PENDING (got ${pendingList.length})`,
      pendingOnly.status === 200 &&
        pendingList.some((a) => a.id === secondId) &&
        !pendingList.some((a) => a.id === approvalId),
    );

    const cancelledOnly = await call('GET', '/agent/approvals?status=CANCELLED', approver.token);
    const cancelledBody: any = await cancelledOnly.json();
    const cancelledList: any[] = Array.isArray(cancelledBody?.approvals)
      ? cancelledBody.approvals
      : [];
    check(
      '19. Resolved history is retrievable, not just the pending queue',
      cancelledList.some((a) => a.id === approvalId),
    );

    const bogus = await call('GET', '/agent/approvals?status=BANANA', approver.token);
    check(
      `20. An unknown status filter is refused rather than silently ignored (got ${bogus.status})`,
      bogus.status === 400,
    );

    // A default listing must not quietly hide everything that is not pending.
    const all = await call('GET', '/agent/approvals', approver.token);
    const allBody: any = await all.json();
    const allList: any[] = Array.isArray(allBody?.approvals) ? allBody.approvals : [];
    check(
      `21. The unfiltered inbox returns pending first but hides nothing (got ${allList.length})`,
      allList.length >= 2 && allList[0]?.status === ApprovalStatus.PENDING,
    );
  }

  // ===== D. Cancellation cannot be used to escape an approval decision =====
  {
    const third: any = await stage(requester.token, `Third Deal ${suffix}`);
    const thirdId = third?.approvalId ?? third?.id;

    await call('POST', `/agent/approvals/${thirdId}/resolve`, approver.token, {
      action: 'REJECT',
    });
    const afterReject = await call('POST', `/agent/approvals/${thirdId}/cancel`, requester.token);
    check(
      `22. A rejected request cannot be re-labelled as cancelled (got ${afterReject.status})`,
      afterReject.status === 409 || afterReject.status === 400,
    );
    const row = await prisma.agentApproval.findUnique({ where: { id: thirdId } });
    check(
      `23. It stays REJECTED -- the approver's decision is not erasable (got ${row?.status})`,
      row?.status === ApprovalStatus.REJECTED,
    );
  }

  console.log('==========================================================');
  console.log(`📊 APPROVAL INBOX SUITE: ${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(teardown);
