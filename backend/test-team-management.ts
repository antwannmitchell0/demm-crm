// Phase 2 -- invitations and team management.
//
// THE DEFECT THIS EXISTS TO CATCH
//
// A teammate could not be added. At all. The `Invitation` model existed in
// schema.prisma and NOTHING in src/ referenced it -- no controller, no service,
// no route. There was no way to list who was in a workspace, change someone's
// role, or remove them. The only path to a second person in a workspace was
// inserting a Membership row by hand.
//
// The token is a bearer credential: whoever holds it joins the workspace with
// the role the invitation names. It is therefore treated like a refresh token
// -- returned once at creation, stored only as a SHA-256 hash, never readable
// back.
//
// LAST-OWNER PROTECTION is the other half. Without it a workspace can be
// orphaned: demote or remove the final ORG_OWNER and nobody can ever administer
// it again, including the person who just did it.
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

let activeApp: { close: () => Promise<void> } | null = null;
let cleanupCtx: { orgIds: string[]; userIds: string[] } | null = null;

async function teardown() {
  if (activeApp) {
    await activeApp.close().catch(() => undefined);
    activeApp = null;
  }
  if (cleanupCtx) {
    const u = { in: cleanupCtx.userIds };
    await prisma.invitation
      .deleteMany({ where: { organizationId: { in: cleanupCtx.orgIds } } })
      .catch(() => undefined);
    await prisma.auditLog
      .deleteMany({ where: { userId: u } })
      .catch(() => undefined);
    await prisma.refreshToken.deleteMany({ where: { userId: u } }).catch(() => undefined);
    await prisma.membership.deleteMany({ where: { userId: u } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: u } }).catch(() => undefined);
    await prisma.organization
      .deleteMany({ where: { id: { in: cleanupCtx.orgIds } } })
      .catch(() => undefined);
  }
  await prisma.$disconnect().catch(() => undefined);
}

const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

async function main() {
  await assertDisposableTestDatabase('test-team-management.ts');

  console.log('🧪 PHASE 2 TEAM MANAGEMENT SUITE');
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
    data: { name: `Team Org ${suffix}` },
  });
  const ws = await prisma.workspace.create({
    data: {
      organizationId: org.id,
      name: 'Team WS',
      subdomain: `team-${suffix}`,
    },
  });
  const otherWs = await prisma.workspace.create({
    data: {
      organizationId: org.id,
      name: 'Other WS',
      subdomain: `team-other-${suffix}`,
    },
  });

  const userIds: string[] = [];
  const makeUser = async (label: string, workspaceId: string | null, role: Role) => {
    const u = await prisma.user.create({
      data: {
        email: `team-${label}-${suffix}@example.invalid`,
        passwordHash: 'x',
        firstName: label,
        lastName: 'Person',
      },
    });
    userIds.push(u.id);
    if (workspaceId) {
      await prisma.membership.create({
        data: {
          userId: u.id,
          organizationId: org.id,
          workspaceId,
          role,
          permissions: [],
        },
      });
    }
    const token = jwt.sign(
      { sub: u.id, email: u.email, workspaceId: workspaceId ?? undefined },
      process.env.JWT_SECRET!,
      { expiresIn: '15m' },
    );
    return { user: u, token };
  };

  const owner = await makeUser('owner', ws.id, Role.ORG_OWNER);
  const admin = await makeUser('admin', ws.id, Role.WORKSPACE_ADMIN);
  const plain = await makeUser('plain', ws.id, Role.USER);
  const outsider = await makeUser('outsider', otherWs.id, Role.ORG_OWNER);
  // Someone with an account but no membership anywhere -- the invitee.
  const invitee = await makeUser('invitee', null, Role.USER);
  const wrongPerson = await makeUser('wrong', otherWs.id, Role.USER);

  cleanupCtx = { orgIds: [org.id], userIds };

  const call = (
    method: string,
    url: string,
    token: string,
    body?: unknown,
    workspaceId?: string,
  ) =>
    fetch(`${base}${url}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(workspaceId ? { 'x-workspace-id': workspaceId } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  // ===== A. Who is in this workspace =====
  {
    const anon = await fetch(`${base}/team/members`);
    check(`1. GET /team/members requires authentication (got ${anon.status})`, anon.status === 401);

    const asUser = await call('GET', '/team/members', plain.token);
    check(
      `2. An ordinary member cannot list the team (got ${asUser.status})`,
      asUser.status === 403,
    );

    const res = await call('GET', '/team/members', admin.token);
    check(`3. An administrator can list the team (got ${res.status})`, res.status === 200);

    const body: any = await res.json();
    const members: any[] = Array.isArray(body?.members) ? body.members : [];
    check(
      `4. Every member of this workspace is listed (got ${members.length}, expected 3)`,
      members.length === 3,
    );
    check(
      '5. Each member carries id, email, name, role and when they joined',
      members.every(
        (m) =>
          typeof m.userId === 'string' &&
          typeof m.email === 'string' &&
          typeof m.firstName === 'string' &&
          typeof m.role === 'string' &&
          typeof m.joinedAt === 'string',
      ),
    );
    check(
      '6. No password hash is ever exposed',
      !JSON.stringify(body).toLowerCase().includes('passwordhash'),
    );
    check(
      '7. A member of a different workspace never appears',
      !members.some((m) => m.userId === outsider.user.id),
    );

    const cross = await call('GET', '/team/members', outsider.token, undefined, ws.id);
    check(
      `8. Someone from another workspace cannot list this team (got ${cross.status})`,
      cross.status === 403,
    );
  }

  // ===== B. Issuing an invitation =====
  let rawToken = '';
  {
    const asUser = await call('POST', '/team/invitations', plain.token, {
      email: invitee.user.email,
      role: Role.USER,
    });
    check(
      `9. An ordinary member cannot invite anyone (got ${asUser.status})`,
      asUser.status === 403,
    );

    const res = await call('POST', '/team/invitations', admin.token, {
      email: invitee.user.email,
      role: Role.USER,
    });
    check(`10. An administrator can invite (got ${res.status})`, res.status === 201);

    const body: any = await res.json();
    rawToken = body?.token ?? '';
    check(
      '11. The invitation token is returned to the inviter exactly once',
      typeof rawToken === 'string' && rawToken.length >= 32,
    );

    const row = await prisma.invitation.findFirst({
      where: { email: invitee.user.email, workspaceId: ws.id },
    });
    check('12. The invitation is recorded', !!row);
    check(
      '13. Only the HASH of the token is stored -- never the token itself',
      row?.tokenHash === sha256(rawToken),
    );
    check(
      '14. The stored row contains no field equal to the raw token',
      !JSON.stringify(row).includes(rawToken),
    );
    check('15. The invitation records who issued it', row?.invitedById === admin.user.id);
    check(
      '16. The invitation expires',
      !!row?.expiresAt && row.expiresAt.getTime() > Date.now(),
    );

    const list = await call('GET', '/team/invitations', admin.token);
    const listBody: any = await list.json();
    check(
      `17. Pending invitations can be listed (got ${list.status})`,
      list.status === 200 && Array.isArray(listBody?.invitations),
    );
    check(
      '18. Listing invitations NEVER returns the token or its hash',
      !JSON.stringify(listBody).includes(rawToken) &&
        !JSON.stringify(listBody).includes(sha256(rawToken)),
    );

    // Someone already in the workspace cannot be invited again.
    const dupe = await call('POST', '/team/invitations', admin.token, {
      email: plain.user.email,
      role: Role.USER,
    });
    check(
      `19. Inviting an existing member is refused (got ${dupe.status})`,
      dupe.status === 400,
    );

    // Privilege escalation: a WORKSPACE_ADMIN must not mint an ORG_OWNER.
    const escalate = await call('POST', '/team/invitations', admin.token, {
      email: `escalate-${suffix}@example.invalid`,
      role: Role.ORG_OWNER,
    });
    check(
      `20. An administrator cannot invite someone at a HIGHER role than their own (got ${escalate.status})`,
      escalate.status === 403,
    );

    const superadmin = await call('POST', '/team/invitations', admin.token, {
      email: `sa-${suffix}@example.invalid`,
      role: Role.SUPERADMIN,
    });
    check(
      `21. SUPERADMIN can never be granted by invitation (got ${superadmin.status})`,
      superadmin.status === 403 || superadmin.status === 400,
    );
  }

  // ===== C. Accepting =====
  {
    const wrong = await call('POST', '/team/invitations/accept', wrongPerson.token, {
      token: rawToken,
    });
    check(
      `22. A different account cannot consume someone else's invitation (got ${wrong.status})`,
      wrong.status === 403,
    );
    const leaked = await prisma.membership.count({
      where: { userId: wrongPerson.user.id, workspaceId: ws.id },
    });
    check('23. That refusal creates NO membership', leaked === 0);

    const unknown = await call('POST', '/team/invitations/accept', invitee.token, {
      token: 'z'.repeat(64),
    });
    check(
      `24. An unknown token is refused (got ${unknown.status})`,
      unknown.status === 404 || unknown.status === 403,
    );

    const res = await call('POST', '/team/invitations/accept', invitee.token, {
      token: rawToken,
    });
    check(`25. The invited person can accept (got ${res.status})`, res.status === 201);

    const membership = await prisma.membership.findFirst({
      where: { userId: invitee.user.id, workspaceId: ws.id },
    });
    check('26. Accepting creates the membership', !!membership);
    check(
      `27. The membership carries the role the invitation named (got ${membership?.role})`,
      membership?.role === Role.USER,
    );

    const row = await prisma.invitation.findFirst({
      where: { email: invitee.user.email, workspaceId: ws.id },
    });
    check('28. The invitation is marked ACCEPTED', row?.status === InvitationStatus.ACCEPTED);
    check(
      '29. Acceptance records who accepted and when',
      row?.acceptedById === invitee.user.id && !!row?.acceptedAt,
    );

    const replay = await call('POST', '/team/invitations/accept', invitee.token, {
      token: rawToken,
    });
    check(
      `30. The same invitation cannot be used twice (got ${replay.status})`,
      replay.status >= 400,
    );
    const count = await prisma.membership.count({
      where: { userId: invitee.user.id, workspaceId: ws.id },
    });
    check(`31. Replaying does not duplicate the membership (got ${count})`, count === 1);
  }

  // ===== D. Revoked and expired invitations are dead =====
  {
    const revokeRes = await call('POST', '/team/invitations', admin.token, {
      email: `revoked-${suffix}@example.invalid`,
      role: Role.USER,
    });
    const revokeBody: any = await revokeRes.json();
    // Defaulted so a missing route reports as failed checks instead of aborting
    // the suite before the last-owner block -- the most important part -- runs.
    const del = await call(
      'DELETE',
      `/team/invitations/${revokeBody?.id ?? '00000000-0000-4000-8000-000000000000'}`,
      admin.token,
    );
    check(`32. An administrator can revoke an invitation (got ${del.status})`, del.status === 200);
    const revoked = revokeBody?.id
      ? await prisma.invitation.findUnique({ where: { id: revokeBody.id } })
      : null;
    check(
      '33. Revocation is recorded as REVOKED, distinct from EXPIRED',
      revoked?.status === InvitationStatus.REVOKED,
    );

    // An expired invitation, created directly: the API always issues a future
    // expiry, so this state is unreachable through it.
    const expiredRaw = crypto.randomBytes(32).toString('hex');
    await prisma.invitation.create({
      data: {
        email: invitee.user.email,
        role: Role.USER,
        workspaceId: otherWs.id,
        organizationId: org.id,
        tokenHash: sha256(expiredRaw),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const expiredRes = await call('POST', '/team/invitations/accept', invitee.token, {
      token: expiredRaw,
    });
    check(
      `34. An expired invitation cannot be accepted (got ${expiredRes.status})`,
      expiredRes.status >= 400,
    );
    const noMembership = await prisma.membership.count({
      where: { userId: invitee.user.id, workspaceId: otherWs.id },
    });
    check('35. An expired invitation creates no membership', noMembership === 0);
  }

  // ===== E. Roles, removal, and the last owner =====
  {
    const asUser = await call('PATCH', `/team/members/${invitee.user.id}`, plain.token, {
      role: Role.WORKSPACE_ADMIN,
    });
    check(
      `36. An ordinary member cannot change roles (got ${asUser.status})`,
      asUser.status === 403,
    );

    const promote = await call('PATCH', `/team/members/${invitee.user.id}`, owner.token, {
      role: Role.WORKSPACE_ADMIN,
    });
    check(`37. An owner can change a member's role (got ${promote.status})`, promote.status === 200);
    const promoted = await prisma.membership.findFirst({
      where: { userId: invitee.user.id, workspaceId: ws.id },
    });
    check('38. The role change is persisted', promoted?.role === Role.WORKSPACE_ADMIN);

    // A WORKSPACE_ADMIN must not be able to make anyone an ORG_OWNER.
    const escalate = await call('PATCH', `/team/members/${plain.user.id}`, admin.token, {
      role: Role.ORG_OWNER,
    });
    check(
      `39. An administrator cannot promote anyone above their own role (got ${escalate.status})`,
      escalate.status === 403,
    );

    // ---- last-owner protection ----
    const owners = await prisma.membership.count({
      where: { workspaceId: ws.id, role: Role.ORG_OWNER },
    });
    check(`40. Precondition: exactly one owner remains (got ${owners})`, owners === 1);

    const demote = await call('PATCH', `/team/members/${owner.user.id}`, owner.token, {
      role: Role.USER,
    });
    check(
      `41. The LAST owner cannot be demoted -- it would orphan the workspace (got ${demote.status})`,
      demote.status === 400 || demote.status === 409,
    );
    const stillOwner = await prisma.membership.findFirst({
      where: { userId: owner.user.id, workspaceId: ws.id },
    });
    check('42. The last owner keeps their role after that refusal', stillOwner?.role === Role.ORG_OWNER);

    const removeOwner = await call('DELETE', `/team/members/${owner.user.id}`, owner.token);
    check(
      `43. The LAST owner cannot be removed either (got ${removeOwner.status})`,
      removeOwner.status === 400 || removeOwner.status === 409,
    );
    const stillThere = await prisma.membership.count({
      where: { userId: owner.user.id, workspaceId: ws.id },
    });
    check('44. The last owner is still a member after that refusal', stillThere === 1);

    // With a second owner in place, the first may leave.
    await call('PATCH', `/team/members/${invitee.user.id}`, owner.token, {
      role: Role.ORG_OWNER,
    });
    const nowTwo = await prisma.membership.count({
      where: { workspaceId: ws.id, role: Role.ORG_OWNER },
    });
    check(`45. A second owner can be appointed (got ${nowTwo})`, nowTwo === 2);

    const removeNow = await call('DELETE', `/team/members/${owner.user.id}`, owner.token);
    check(
      `46. An owner CAN be removed once another owner exists (got ${removeNow.status})`,
      removeNow.status === 200,
    );
  }

  // ===== F. Removal takes effect immediately =====
  {
    // A live session for the person about to be removed.
    const live = await prisma.refreshToken.create({
      data: {
        hashedToken: sha256(`live-${suffix}`),
        userId: plain.user.id,
        workspaceId: ws.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    });
    // And one for a DIFFERENT workspace, which must survive.
    const unrelated = await prisma.refreshToken.create({
      data: {
        hashedToken: sha256(`unrelated-${suffix}`),
        userId: plain.user.id,
        workspaceId: otherWs.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    });

    // The workspace is named explicitly: this token was minted before the
    // invitee had any membership, so it carries no workspaceId claim for
    // WorkspaceGuard to fall back on. A real client would hold a token issued
    // after acceptance.
    const res = await call(
      'DELETE',
      `/team/members/${plain.user.id}`,
      invitee.token,
      undefined,
      ws.id,
    );
    check(`47. A member can be removed (got ${res.status})`, res.status === 200);
    check(
      '48. Their membership is gone',
      (await prisma.membership.count({
        where: { userId: plain.user.id, workspaceId: ws.id },
      })) === 0,
    );

    const liveAfter = await prisma.refreshToken.findUnique({ where: { id: live.id } });
    check(
      '49. Their session for THIS workspace is revoked immediately, not left to expire',
      liveAfter?.revoked === true,
    );
    const unrelatedAfter = await prisma.refreshToken.findUnique({
      where: { id: unrelated.id },
    });
    check(
      '50. Their session for a DIFFERENT workspace is untouched',
      unrelatedAfter?.revoked === false,
    );

    const gone = await call('GET', '/team/members', plain.token, undefined, ws.id);
    check(
      `51. A removed member can no longer reach the workspace (got ${gone.status})`,
      gone.status === 403,
    );
  }

  // ===== G. The last-owner rule survives concurrency =====
  //
  // The rule is a check-then-act: count the owners, then remove one. Under READ
  // COMMITTED, two transactions each removing a DIFFERENT owner both see the
  // other's row still present, both count two, both commit -- and the workspace
  // is left with nobody who can administer it. Exactly the shape of the
  // refresh-token amplification fixed in Phase 0C-R. A SELECT ... FOR UPDATE on
  // the Workspace row is what serialises them.
  {
    const raceWs = await prisma.workspace.create({
      data: {
        organizationId: org.id,
        name: 'Race WS',
        subdomain: `team-race-${suffix}`,
      },
    });
    const ownerA = await makeUser('racea', raceWs.id, Role.ORG_OWNER);
    const ownerB = await makeUser('raceb', raceWs.id, Role.ORG_OWNER);
    const ownerC = await makeUser('racec', raceWs.id, Role.ORG_OWNER);

    // Three owners, three simultaneous removals -- one per owner. Without
    // serialisation all three can succeed.
    const results = await Promise.all([
      call('DELETE', `/team/members/${ownerA.user.id}`, ownerA.token, undefined, raceWs.id),
      call('DELETE', `/team/members/${ownerB.user.id}`, ownerB.token, undefined, raceWs.id),
      call('DELETE', `/team/members/${ownerC.user.id}`, ownerC.token, undefined, raceWs.id),
    ]);
    const succeeded = results.filter((r) => r.status === 200).length;

    const ownersLeft = await prisma.membership.count({
      where: { workspaceId: raceWs.id, role: Role.ORG_OWNER },
    });
    check(
      `52. Concurrent removals never orphan a workspace -- an owner always remains (left ${ownersLeft})`,
      ownersLeft >= 1,
    );
    check(
      `53. At most two of three concurrent owner removals succeed (observed ${succeeded})`,
      succeeded <= 2,
    );

    // Same race through role changes rather than removals.
    const demoters = await prisma.membership.findMany({
      where: { workspaceId: raceWs.id, role: Role.ORG_OWNER },
      include: { user: true },
    });
    if (demoters.length >= 1) {
      const survivor = demoters[0];
      const survivorToken = jwt.sign(
        { sub: survivor.userId, email: survivor.user.email, workspaceId: raceWs.id },
        process.env.JWT_SECRET!,
        { expiresIn: '15m' },
      );
      await Promise.all(
        demoters.map((m) =>
          call('PATCH', `/team/members/${m.userId}`, survivorToken, { role: Role.USER }, raceWs.id),
        ),
      );
      const afterDemotions = await prisma.membership.count({
        where: { workspaceId: raceWs.id, role: Role.ORG_OWNER },
      });
      check(
        `54. Concurrent demotions cannot demote every owner either (left ${afterDemotions})`,
        afterDemotions >= 1,
      );
    }
  }

  console.log('==========================================================');
  console.log(`📊 TEAM MANAGEMENT SUITE: ${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(teardown);
