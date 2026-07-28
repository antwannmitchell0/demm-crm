// Phase 2 correction -- invitation acceptance must be IDEMPOTENT and TERMINAL.
//
// THE DEFECT THIS EXISTS TO CATCH
//
// The first fix turned an HTTP 500 into a 400 but left the business state
// wrong. `throw new BadRequestException('You are already a member')` sat INSIDE
// the transaction, so throwing rolled back the status claim with it. The
// invitation returned to PENDING, every retry failed identically, and an
// administrator could not tell a redundant invitation from an unused one. The
// process never reached a terminal state.
//
// A second, separate race survived that fix entirely: two DIFFERENT pending
// invitations addressed to the same person for the same workspace. Each accept
// claims its OWN row -- different ids, so both claims succeed -- then both read
// "no membership", and both insert. One hits
// @@unique([userId, organizationId, workspaceId]) and returns 500.
//
// The contract proven here:
//   JOINED           -- the invitation created a new membership
//   ALREADY_MEMBER   -- the account already had access; role NOT changed
//   ALREADY_ACCEPTED -- the same account safely retried a consumed link
//
// and in every case the invitation ends TERMINAL, never back at PENDING.
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './src/app.module';
import { assertDisposableTestDatabase } from './test-db-guard';
import { PrismaClient, Role, InvitationStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';

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

const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

let activeApp: { close: () => Promise<void> } | null = null;
let ctx: { orgIds: string[]; userIds: string[] } | null = null;

async function teardown() {
  if (activeApp) {
    await activeApp.close().catch(() => undefined);
    activeApp = null;
  }
  if (ctx) {
    const u = { in: ctx.userIds };
    await prisma.invitation
      .deleteMany({ where: { organizationId: { in: ctx.orgIds } } })
      .catch(() => undefined);
    await prisma.auditLog.deleteMany({ where: { userId: u } }).catch(() => undefined);
    await prisma.membership.deleteMany({ where: { userId: u } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: u } }).catch(() => undefined);
    await prisma.organization
      .deleteMany({ where: { id: { in: ctx.orgIds } } })
      .catch(() => undefined);
  }
  await prisma.$disconnect().catch(() => undefined);
}

const TERMINAL: InvitationStatus[] = [
  InvitationStatus.ACCEPTED,
  InvitationStatus.REVOKED,
  InvitationStatus.EXPIRED,
];

async function main() {
  await assertDisposableTestDatabase('test-invitation-acceptance.ts');

  console.log('🧪 PHASE 2 INVITATION ACCEPTANCE SUITE');
  console.log('==========================================================');

  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.listen(0);
  activeApp = app;
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as any).port}`;

  const suffix = Date.now();
  const org = await prisma.organization.create({ data: { name: `Accept Org ${suffix}` } });
  const otherOrg = await prisma.organization.create({
    data: { name: `Accept Other ${suffix}` },
  });
  const ws = await prisma.workspace.create({
    data: { organizationId: org.id, name: 'Accept WS', subdomain: `accept-${suffix}` },
  });
  const foreignWs = await prisma.workspace.create({
    data: {
      organizationId: otherOrg.id,
      name: 'Foreign WS',
      subdomain: `accept-foreign-${suffix}`,
    },
  });

  const userIds: string[] = [];
  const mkUser = async (label: string) => {
    const u = await prisma.user.create({
      data: {
        email: `accept-${label}-${suffix}@example.invalid`,
        passwordHash: 'x',
        firstName: label,
        lastName: 'P',
      },
    });
    userIds.push(u.id);
    return {
      user: u,
      token: jwt.sign({ sub: u.id, email: u.email }, process.env.JWT_SECRET!, {
        expiresIn: '15m',
      }),
    };
  };

  const newcomer = await mkUser('newcomer');
  const member = await mkUser('member');
  const stranger = await mkUser('stranger');
  const racer = await mkUser('racer');
  const dualRacer = await mkUser('dualracer');
  const downgrade = await mkUser('downgrade');
  const upgrade = await mkUser('upgrade');
  const crossTenant = await mkUser('crosstenant');

  ctx = { orgIds: [org.id, otherOrg.id], userIds };

  const mkMembership = (userId: string, workspaceId: string, role: Role, orgId = org.id) =>
    prisma.membership.create({
      data: { userId, organizationId: orgId, workspaceId, role, permissions: [] },
    });

  /** Creates an invitation and returns the RAW token alongside the row. */
  const mkInvite = async (
    email: string,
    role: Role = Role.USER,
    opts: { workspaceId?: string; expiresAt?: Date; status?: InvitationStatus } = {},
  ) => {
    const raw = crypto.randomBytes(32).toString('hex');
    const workspaceId = opts.workspaceId ?? ws.id;
    const row = await prisma.invitation.create({
      data: {
        email: email.toLowerCase(),
        role,
        workspaceId,
        organizationId: workspaceId === foreignWs.id ? otherOrg.id : org.id,
        tokenHash: sha256(raw),
        status: opts.status ?? InvitationStatus.PENDING,
        expiresAt: opts.expiresAt ?? new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    });
    return { raw, row };
  };

  const accept = (token: string, raw: string) =>
    fetch(`${base}/team/invitations/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ token: raw }),
    });

  const statusOf = async (id: string) =>
    (await prisma.invitation.findUnique({ where: { id } }))?.status ?? null;
  const roleOf = async (userId: string, workspaceId = ws.id) =>
    (await prisma.membership.findFirst({ where: { userId, workspaceId } }))?.role ?? null;
  const memberCount = async (userId: string, workspaceId = ws.id) =>
    prisma.membership.count({ where: { userId, workspaceId } });

  // ===== A. A newcomer joins =====
  {
    const { raw, row } = await mkInvite(newcomer.user.email, Role.USER);
    const res = await accept(newcomer.token, raw);
    const body: any = await res.json().catch(() => ({}));

    check(`1. A nonmember accepting gets 200 (got ${res.status})`, res.status === 200);
    check(`2. The outcome is JOINED (got "${body.outcome}")`, body.outcome === 'JOINED');
    check(
      `3. Exactly one membership is created (got ${await memberCount(newcomer.user.id)})`,
      (await memberCount(newcomer.user.id)) === 1,
    );
    check(
      `4. The invitation is terminal (got ${await statusOf(row.id)})`,
      TERMINAL.includes((await statusOf(row.id))!),
    );
    const after = await prisma.invitation.findUnique({ where: { id: row.id } });
    check(
      '5. Acceptance records who used it and when',
      after?.acceptedById === newcomer.user.id && !!after?.acceptedAt,
    );

    // Retrying the SAME consumed link from the SAME account is idempotent.
    const retry = await accept(newcomer.token, raw);
    const retryBody: any = await retry.json().catch(() => ({}));
    check(
      `6. Retrying a consumed link is idempotent, not an error (got ${retry.status})`,
      retry.status === 200,
    );
    check(
      `7. The retry outcome is ALREADY_ACCEPTED (got "${retryBody.outcome}")`,
      retryBody.outcome === 'ALREADY_ACCEPTED',
    );
    check(
      `8. The retry creates no second membership (got ${await memberCount(newcomer.user.id)})`,
      (await memberCount(newcomer.user.id)) === 1,
    );
  }

  // ===== B. An existing member -- the defect that started this =====
  {
    await mkMembership(member.user.id, ws.id, Role.WORKSPACE_ADMIN);
    const { raw, row } = await mkInvite(member.user.email, Role.USER);

    const res = await accept(member.token, raw);
    const body: any = await res.json().catch(() => ({}));

    check(`9. An existing member accepting gets 200 (got ${res.status})`, res.status === 200);
    check(
      `10. The outcome is ALREADY_MEMBER (got "${body.outcome}")`,
      body.outcome === 'ALREADY_MEMBER',
    );
    check(
      `11. THE INVITATION LEAVES PENDING -- terminal, not stuck (got ${await statusOf(row.id)})`,
      TERMINAL.includes((await statusOf(row.id))!),
    );
    const after = await prisma.invitation.findUnique({ where: { id: row.id } });
    check(
      '12. It records who used it and when',
      after?.acceptedById === member.user.id && !!after?.acceptedAt,
    );
    check(
      `13. The existing role is NOT changed by the invitation's role (got ${await roleOf(member.user.id)})`,
      (await roleOf(member.user.id)) === Role.WORKSPACE_ADMIN,
    );
    check(
      `14. No duplicate membership (got ${await memberCount(member.user.id)})`,
      (await memberCount(member.user.id)) === 1,
    );
  }

  // ===== C. Role preservation in both directions =====
  {
    await mkMembership(downgrade.user.id, ws.id, Role.ORG_OWNER);
    const { raw: rawDown } = await mkInvite(downgrade.user.email, Role.USER);
    await accept(downgrade.token, rawDown);
    check(
      `15. An older LOWER-role invitation cannot downgrade an existing higher role (got ${await roleOf(downgrade.user.id)})`,
      (await roleOf(downgrade.user.id)) === Role.ORG_OWNER,
    );

    await mkMembership(upgrade.user.id, ws.id, Role.USER);
    const { raw: rawUp } = await mkInvite(upgrade.user.email, Role.ORG_OWNER);
    await accept(upgrade.token, rawUp);
    check(
      `16. An older HIGHER-role invitation cannot upgrade an existing lower role (got ${await roleOf(upgrade.user.id)})`,
      (await roleOf(upgrade.user.id)) === Role.USER,
    );
  }

  // ===== D. Wrong account, revoked, expired =====
  {
    const { raw, row } = await mkInvite(newcomer.user.email, Role.USER);
    const wrong = await accept(stranger.token, raw);
    check(`17. A different account cannot use it (got ${wrong.status})`, wrong.status === 403);
    check(
      `18. That refusal leaves it PENDING, not consumed (got ${await statusOf(row.id)})`,
      (await statusOf(row.id)) === InvitationStatus.PENDING,
    );
    check(
      '19. It creates no membership for the wrong account',
      (await memberCount(stranger.user.id)) === 0,
    );

    const { raw: rawRevoked } = await mkInvite(stranger.user.email, Role.USER, {
      status: InvitationStatus.REVOKED,
    });
    const revoked = await accept(stranger.token, rawRevoked);
    check(`20. A revoked invitation is unusable (got ${revoked.status})`, revoked.status >= 400);

    const { raw: rawExpired, row: expiredRow } = await mkInvite(
      stranger.user.email,
      Role.USER,
      { expiresAt: new Date(Date.now() - 1000) },
    );
    const expired = await accept(stranger.token, rawExpired);
    check(`21. An expired invitation is unusable (got ${expired.status})`, expired.status >= 400);
    check(
      `22. Expiry is recorded, not merely rejected (got ${await statusOf(expiredRow.id)})`,
      (await statusOf(expiredRow.id)) === InvitationStatus.EXPIRED,
    );
    check('23. Neither creates a membership', (await memberCount(stranger.user.id)) === 0);
  }

  // ===== E. Cross-tenant =====
  {
    await mkMembership(crossTenant.user.id, foreignWs.id, Role.ORG_OWNER, otherOrg.id);
    const { raw } = await mkInvite(crossTenant.user.email, Role.USER);
    const res = await accept(crossTenant.token, raw);
    const body: any = await res.json().catch(() => ({}));
    check(
      `24. Membership in ANOTHER workspace does not satisfy this invitation (got "${body.outcome}")`,
      res.status === 200 && body.outcome === 'JOINED',
    );
    check(
      '25. The foreign membership is untouched',
      (await roleOf(crossTenant.user.id, foreignWs.id)) === Role.ORG_OWNER,
    );
  }

  // ===== F. SAME invitation, concurrent =====
  {
    const { raw, row } = await mkInvite(racer.user.email, Role.USER);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => accept(racer.token, raw).then((r) => r.status)),
    );
    const errors = results.filter((s) => s >= 500);
    check(
      `26. Six concurrent accepts of ONE invitation produce no 500 (statuses ${results.join(',')})`,
      errors.length === 0,
    );
    check(
      `27. Exactly one membership results (got ${await memberCount(racer.user.id)})`,
      (await memberCount(racer.user.id)) === 1,
    );
    check(
      `28. The invitation ends terminal (got ${await statusOf(row.id)})`,
      TERMINAL.includes((await statusOf(row.id))!),
    );
  }

  // ===== G. TWO DIFFERENT invitations, same user + workspace, concurrent =====
  //
  // The race the first fix did not address. Each accept claims its OWN row, so
  // both claims succeed; both then read "no membership" and both insert.
  {
    const a = await mkInvite(dualRacer.user.email, Role.USER);
    const b = await mkInvite(dualRacer.user.email, Role.WORKSPACE_ADMIN);

    const results = await Promise.all([
      accept(dualRacer.token, a.raw).then((r) => r.status),
      accept(dualRacer.token, b.raw).then((r) => r.status),
    ]);
    const errors = results.filter((s) => s >= 500);
    check(
      `29. Two DIFFERENT invitations accepted simultaneously produce no 500 (statuses ${results.join(',')})`,
      errors.length === 0,
    );
    check(
      `30. Exactly one membership results (got ${await memberCount(dualRacer.user.id)})`,
      (await memberCount(dualRacer.user.id)) === 1,
    );

    const sa = await statusOf(a.row.id);
    const sb = await statusOf(b.row.id);
    check(
      `31. BOTH invitation rows end in a truthful terminal state (a=${sa}, b=${sb})`,
      TERMINAL.includes(sa!) && TERMINAL.includes(sb!),
    );
  }

  // ===== H. No token or hash escapes =====
  {
    const { raw, row } = await mkInvite(stranger.user.email, Role.USER);
    const captured: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...a: unknown[]) => captured.push(a.join(' '));
    console.error = (...a: unknown[]) => captured.push(a.join(' '));
    let bodyText = '';
    try {
      const res = await accept(stranger.token, raw);
      bodyText = await res.text();
    } finally {
      console.log = origLog;
      console.error = origErr;
    }
    const blob = captured.join('\n') + bodyText;
    check(
      '32. Neither the raw token nor its hash appears in logs or the response',
      !blob.includes(raw) && !blob.includes(sha256(raw)),
    );

    const audits = await prisma.auditLog.findMany({
      where: { workspaceId: ws.id, action: 'team.invitation.accepted' },
    });
    const auditBlob = JSON.stringify(audits);
    check(
      '33. No audit payload contains a token or hash',
      !auditBlob.includes(raw) && !auditBlob.includes(sha256(raw)),
    );
    await prisma.invitation.delete({ where: { id: row.id } }).catch(() => undefined);
  }

  console.log('==========================================================');
  console.log(`📊 INVITATION ACCEPTANCE SUITE: ${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(teardown);
