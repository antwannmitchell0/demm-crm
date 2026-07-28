// Phase 2 correction -- the team-management authorization boundary.
//
// THE DEFECT THIS EXISTS TO CATCH
//
// `changeRole` asked exactly one question: canGrant(actorRole, newRole) -- "may
// this actor hand out the role being proposed?" It never asked whether the
// actor may act on the TARGET at all. `removeMember` asked neither; its only
// guard was the last-owner rule.
//
// So a WORKSPACE_ADMIN (rank 40) could PATCH an ORG_OWNER (rank 80) to USER
// (rank 20): canGrant(WORKSPACE_ADMIN, USER) is true, because 20 <= 40. The
// check passed on the role being GRANTED while the role being DESTROYED went
// unexamined. Demoting downward is always "granting a lower role", so the whole
// hierarchy could be dismantled from below one member at a time -- and removal
// needed no rank at all, so a workspace admin could delete an owner outright.
//
// Three questions must be asked separately, because none implies the others:
//   canGrant(actor, proposedRole)       -- may I hand out this role?
//   canManage(actor, targetCurrentRole) -- may I touch this person at all?
//   canRemove(actor, targetCurrentRole) -- may I delete this membership?
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './src/app.module';
import { assertDisposableTestDatabase } from './test-db-guard';
import { PrismaClient, Role } from '@prisma/client';
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
    await prisma.auditLog
      .deleteMany({ where: { userId: u } })
      .catch(() => undefined);
    await prisma.refreshToken
      .deleteMany({ where: { userId: u } })
      .catch(() => undefined);
    await prisma.membership
      .deleteMany({ where: { userId: u } })
      .catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: u } }).catch(() => undefined);
    await prisma.organization
      .deleteMany({ where: { id: { in: ctx.orgIds } } })
      .catch(() => undefined);
  }
  await prisma.$disconnect().catch(() => undefined);
}

async function main() {
  await assertDisposableTestDatabase('test-team-authorization.ts');

  console.log('🧪 PHASE 2 TEAM AUTHORIZATION BOUNDARY SUITE');
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
    data: { name: `AuthZ Org ${suffix}` },
  });
  const otherOrg = await prisma.organization.create({
    data: { name: `AuthZ Other Org ${suffix}` },
  });
  const ws = await prisma.workspace.create({
    data: {
      organizationId: org.id,
      name: 'AuthZ WS',
      subdomain: `authz-${suffix}`,
    },
  });
  const foreignWs = await prisma.workspace.create({
    data: {
      organizationId: otherOrg.id,
      name: 'Foreign WS',
      subdomain: `authz-foreign-${suffix}`,
    },
  });

  const userIds: string[] = [];
  const make = async (
    label: string,
    workspaceId: string,
    role: Role,
    orgId = org.id,
  ) => {
    const u = await prisma.user.create({
      data: {
        email: `authz-${label}-${suffix}@example.invalid`,
        passwordHash: 'x',
        firstName: label,
        lastName: 'P',
      },
    });
    userIds.push(u.id);
    await prisma.membership.create({
      data: {
        userId: u.id,
        organizationId: orgId,
        workspaceId,
        role,
        permissions: [],
      },
    });
    return {
      user: u,
      token: jwt.sign(
        { sub: u.id, email: u.email, workspaceId },
        process.env.JWT_SECRET!,
        {
          expiresIn: '15m',
        },
      ),
    };
  };

  // The full ladder, all in one workspace.
  const owner1 = await make('owner1', ws.id, Role.ORG_OWNER);
  const owner2 = await make('owner2', ws.id, Role.ORG_OWNER);
  const orgAdmin = await make('orgadmin', ws.id, Role.ORG_ADMIN);
  const wsAdmin = await make('wsadmin', ws.id, Role.WORKSPACE_ADMIN);
  const wsAdmin2 = await make('wsadmin2', ws.id, Role.WORKSPACE_ADMIN);
  const plain = await make('plain', ws.id, Role.USER);
  const superadmin = await make('superadmin', ws.id, Role.SUPERADMIN);
  const foreigner = await make(
    'foreigner',
    foreignWs.id,
    Role.ORG_OWNER,
    otherOrg.id,
  );

  ctx = { orgIds: [org.id, otherOrg.id], userIds };

  const call = (
    method: string,
    url: string,
    token: string,
    body?: unknown,
    wsId?: string,
  ) =>
    fetch(`${base}${url}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(wsId ? { 'x-workspace-id': wsId } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const roleOf = async (userId: string, workspaceId = ws.id) =>
    (await prisma.membership.findFirst({ where: { userId, workspaceId } }))
      ?.role ?? null;
  const isMember = async (userId: string, workspaceId = ws.id) =>
    (await prisma.membership.count({ where: { userId, workspaceId } })) > 0;

  // ===== A. A lower rank cannot DEMOTE a higher rank =====
  // The core defect: demoting IS "granting a lower role", which the old
  // canGrant check waved through every time.
  {
    const res = await call(
      'PATCH',
      `/team/members/${owner1.user.id}`,
      wsAdmin.token,
      {
        role: Role.USER,
      },
    );
    check(
      `1. WORKSPACE_ADMIN cannot demote an ORG_OWNER (got ${res.status})`,
      res.status === 403,
    );
    check(
      `2. That owner keeps ORG_OWNER after the attempt (got ${await roleOf(owner1.user.id)})`,
      (await roleOf(owner1.user.id)) === Role.ORG_OWNER,
    );

    const res2 = await call(
      'PATCH',
      `/team/members/${owner1.user.id}`,
      orgAdmin.token,
      {
        role: Role.WORKSPACE_ADMIN,
      },
    );
    check(
      `3. ORG_ADMIN cannot demote an ORG_OWNER (got ${res2.status})`,
      res2.status === 403,
    );
    check(
      '4. That owner still holds ORG_OWNER',
      (await roleOf(owner1.user.id)) === Role.ORG_OWNER,
    );

    const res3 = await call(
      'PATCH',
      `/team/members/${orgAdmin.user.id}`,
      wsAdmin.token,
      {
        role: Role.USER,
      },
    );
    check(
      `5. WORKSPACE_ADMIN cannot demote an ORG_ADMIN (got ${res3.status})`,
      res3.status === 403,
    );
    check(
      '6. That org admin keeps ORG_ADMIN',
      (await roleOf(orgAdmin.user.id)) === Role.ORG_ADMIN,
    );
  }

  // ===== B. A lower rank cannot REMOVE a higher rank =====
  // removeMember had NO rank check whatsoever -- only the last-owner rule. With
  // two owners present that rule is satisfied, so nothing stopped it.
  {
    const res = await call(
      'DELETE',
      `/team/members/${owner1.user.id}`,
      wsAdmin.token,
    );
    check(
      `7. WORKSPACE_ADMIN cannot remove an ORG_OWNER (got ${res.status})`,
      res.status === 403,
    );
    check('8. That owner is still a member', await isMember(owner1.user.id));

    const res2 = await call(
      'DELETE',
      `/team/members/${owner2.user.id}`,
      orgAdmin.token,
    );
    check(
      `9. ORG_ADMIN cannot remove an ORG_OWNER (got ${res2.status})`,
      res2.status === 403,
    );
    check('10. That owner is still a member', await isMember(owner2.user.id));

    const res3 = await call(
      'DELETE',
      `/team/members/${orgAdmin.user.id}`,
      wsAdmin.token,
    );
    check(
      `11. WORKSPACE_ADMIN cannot remove an ORG_ADMIN (got ${res3.status})`,
      res3.status === 403,
    );
    check(
      '12. That org admin is still a member',
      await isMember(orgAdmin.user.id),
    );
  }

  // ===== C. SUPERADMIN is not manageable through a workspace endpoint =====
  // It is a platform-wide role crossing organization boundaries. An ORG_OWNER
  // is the highest authority INSIDE a workspace, which is not authority over
  // the platform.
  {
    const demote = await call(
      'PATCH',
      `/team/members/${superadmin.user.id}`,
      owner1.token,
      {
        role: Role.USER,
      },
    );
    check(
      `13. An ORG_OWNER cannot demote a SUPERADMIN through a workspace endpoint (got ${demote.status})`,
      demote.status === 403,
    );
    check(
      '14. The SUPERADMIN keeps their role',
      (await roleOf(superadmin.user.id)) === Role.SUPERADMIN,
    );

    const remove = await call(
      'DELETE',
      `/team/members/${superadmin.user.id}`,
      owner1.token,
    );
    check(
      `15. An ORG_OWNER cannot remove a SUPERADMIN through a workspace endpoint (got ${remove.status})`,
      remove.status === 403,
    );
    check(
      '16. The SUPERADMIN is still a member',
      await isMember(superadmin.user.id),
    );
  }

  // ===== D. What IS permitted still works =====
  {
    const res = await call(
      'PATCH',
      `/team/members/${plain.user.id}`,
      wsAdmin.token,
      {
        role: Role.WORKSPACE_ADMIN,
      },
    );
    check(
      `17. WORKSPACE_ADMIN can manage a USER (got ${res.status})`,
      res.status === 200,
    );
    check(
      '18. That promotion took effect',
      (await roleOf(plain.user.id)) === Role.WORKSPACE_ADMIN,
    );

    // Equal-rank management is deliberately ALLOWED. Without it an owner could
    // never remove another owner, and the last-owner rule would become a trap:
    // the only person able to replace the final owner would be that owner.
    const equal = await call(
      'PATCH',
      `/team/members/${wsAdmin2.user.id}`,
      wsAdmin.token,
      {
        role: Role.USER,
      },
    );
    check(
      `19. WORKSPACE_ADMIN can manage another WORKSPACE_ADMIN -- equal rank is permitted (got ${equal.status})`,
      equal.status === 200,
    );

    const appoint = await call(
      'PATCH',
      `/team/members/${orgAdmin.user.id}`,
      owner1.token,
      {
        role: Role.ORG_OWNER,
      },
    );
    check(
      `20. ORG_OWNER can appoint another ORG_OWNER (got ${appoint.status})`,
      appoint.status === 200,
    );
    const owners = await prisma.membership.count({
      where: { workspaceId: ws.id, role: Role.ORG_OWNER },
    });
    check(`21. There are now three owners (got ${owners})`, owners === 3);

    const removeOwner = await call(
      'DELETE',
      `/team/members/${owner2.user.id}`,
      owner1.token,
    );
    check(
      `22. ORG_OWNER can remove another ORG_OWNER while owners remain (got ${removeOwner.status})`,
      removeOwner.status === 200,
    );
  }

  // ===== E. Identifiers cannot be used to cross a boundary =====
  {
    const crossHeader = await call(
      'DELETE',
      `/team/members/${owner1.user.id}`,
      foreigner.token,
      undefined,
      ws.id,
    );
    check(
      `23. A foreign ORG_OWNER cannot reach this workspace by header (got ${crossHeader.status})`,
      crossHeader.status === 403,
    );
    check('24. The target is untouched', await isMember(owner1.user.id));

    const foreignTarget = await call(
      'PATCH',
      `/team/members/${foreigner.user.id}`,
      owner1.token,
      { role: Role.USER },
    );
    check(
      `25. A member of another workspace cannot be modified by id (got ${foreignTarget.status})`,
      foreignTarget.status === 404,
    );
    check(
      '26. The foreign membership is unchanged',
      (await roleOf(foreigner.user.id, foreignWs.id)) === Role.ORG_OWNER,
    );

    // `plain` was promoted to WORKSPACE_ADMIN in block D, then demote them back
    // and confirm the demoted account has no team authority left.
    await call('PATCH', `/team/members/${plain.user.id}`, owner1.token, {
      role: Role.USER,
    });
    const byUser = await call(
      'DELETE',
      `/team/members/${wsAdmin.user.id}`,
      plain.token,
    );
    check(
      `27. A demoted member has no team authority (got ${byUser.status})`,
      byUser.status === 403,
    );
  }

  // ===== F. Self-management cannot be used to escape the rule =====
  {
    const selfPromote = await call(
      'PATCH',
      `/team/members/${wsAdmin.user.id}`,
      wsAdmin.token,
      {
        role: Role.ORG_OWNER,
      },
    );
    check(
      `28. A WORKSPACE_ADMIN cannot promote THEMSELVES to ORG_OWNER (got ${selfPromote.status})`,
      selfPromote.status === 403,
    );
    check(
      '29. They keep their original role',
      (await roleOf(wsAdmin.user.id)) === Role.WORKSPACE_ADMIN,
    );

    // Self-removal is management of an equal-rank target, so it is allowed --
    // subject to the last-owner rule, which is tested separately.
    const selfRemove = await call(
      'DELETE',
      `/team/members/${wsAdmin.user.id}`,
      wsAdmin.token,
    );
    check(
      `30. A member may remove themselves when the last-owner rule allows (got ${selfRemove.status})`,
      selfRemove.status === 200,
    );
  }

  // ===== G. Invitations obey the same ceiling =====
  {
    const escalate = await call('POST', '/team/invitations', orgAdmin.token, {
      email: `authz-invite-${suffix}@example.invalid`,
      role: Role.ORG_OWNER,
    });
    // orgAdmin was promoted to ORG_OWNER in block D, so this must now SUCCEED --
    // proving the ceiling tracks the CURRENT role, not the one held at login.
    check(
      `31. The invite ceiling follows the actor's current role, not their token (got ${escalate.status})`,
      escalate.status === 201,
    );
  }

  // ===== H. The last-owner rule still holds under concurrency =====
  {
    const raceWs = await prisma.workspace.create({
      data: {
        organizationId: org.id,
        name: 'AuthZ Race',
        subdomain: `authz-race-${suffix}`,
      },
    });
    const a = await make('racea', raceWs.id, Role.ORG_OWNER);
    const b = await make('raceb', raceWs.id, Role.ORG_OWNER);
    const c = await make('racec', raceWs.id, Role.ORG_OWNER);

    await Promise.all([
      call(
        'DELETE',
        `/team/members/${a.user.id}`,
        a.token,
        undefined,
        raceWs.id,
      ),
      call(
        'DELETE',
        `/team/members/${b.user.id}`,
        b.token,
        undefined,
        raceWs.id,
      ),
      call(
        'PATCH',
        `/team/members/${c.user.id}`,
        c.token,
        { role: Role.USER },
        raceWs.id,
      ),
    ]);

    const left = await prisma.membership.count({
      where: { workspaceId: raceWs.id, role: Role.ORG_OWNER },
    });
    check(
      `32. Concurrent removals AND demotions still leave an owner (left ${left})`,
      left >= 1,
    );
  }

  console.log('==========================================================');
  console.log(`📊 TEAM AUTHORIZATION SUITE: ${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(teardown);
