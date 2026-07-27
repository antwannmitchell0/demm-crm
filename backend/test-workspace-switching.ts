// Phase 2 -- membership listing and password-free workspace switching.
//
// THE DEFECT THIS EXISTS TO CATCH
//
// A user who belonged to two workspaces could not move between them without
// typing their password again. The only path to a second workspace was
// login() -> preAuthToken -> selectWorkspace(), so switching required a full
// re-authentication. Worse, no authenticated endpoint listed a user's
// memberships at all: GET /workspaces is SUPERADMIN-only, and the membership
// list loaded in jwt.strategy.ts was exposed by nothing. The client learned the
// available workspaces exactly once -- in the login response -- and had no way
// to ask again, so a picker could only be rendered immediately after a
// password.
//
// The session payload was also missing the active workspace's NAME. It carried
// workspaceId and role only, so after a refresh the sidebar could not say which
// workspace the user was looking at.
//
// The switch is built on the same atomic claim as rotation (Phase 0C-R): the
// presented refresh token is claimed with a conditional UPDATE, so switching
// cannot amplify one token into several live sessions, and a genuine replay is
// still treated as theft.
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './src/app.module';
import { AuthService } from './src/modules/auth/auth.service';
import { assertDisposableTestDatabase } from './test-db-guard';
import { PrismaClient, Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';
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
    await prisma.refreshToken
      .deleteMany({ where: { userId: { in: cleanupCtx.userIds } } })
      .catch(() => undefined);
    await prisma.membership
      .deleteMany({ where: { userId: { in: cleanupCtx.userIds } } })
      .catch(() => undefined);
    await prisma.user
      .deleteMany({ where: { id: { in: cleanupCtx.userIds } } })
      .catch(() => undefined);
    await prisma.organization
      .deleteMany({ where: { id: { in: cleanupCtx.orgIds } } })
      .catch(() => undefined);
  }
  await prisma.$disconnect().catch(() => undefined);
}

const PASSWORD = 'Correct-Horse-Battery-9!';

/** Mirrors AuthService.hashToken -- lookups are keyed on the hash, never the raw token. */
const hash = (t: string) =>
  crypto.createHash('sha256').update(t).digest('hex');

/**
 * Tolerates either a bare array or a `{ memberships: [...] }` envelope, and
 * yields [] for an error body. Without the last part the RED run dies on
 * `.map` of a 404 payload before it can report the remaining checks.
 */
function asList(body: any): any[] {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.memberships)) return body.memberships;
  return [];
}

async function main() {
  await assertDisposableTestDatabase('test-workspace-switching.ts');

  console.log('🧪 PHASE 2 WORKSPACE SWITCHING SUITE');
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
  const authService = app.get(AuthService);

  const suffix = Date.now();

  // --- Fixtures: one user in TWO workspaces, plus an outsider who is in
  // neither and must never see them. ---
  const org = await prisma.organization.create({
    data: { name: `Switch Org ${suffix}` },
  });
  const wsA = await prisma.workspace.create({
    data: {
      organizationId: org.id,
      name: 'Downtown Studio',
      subdomain: `switch-a-${suffix}`,
    },
  });
  const wsB = await prisma.workspace.create({
    data: {
      organizationId: org.id,
      name: 'Airport Location',
      subdomain: `switch-b-${suffix}`,
    },
  });
  const otherOrg = await prisma.organization.create({
    data: { name: `Outsider Org ${suffix}` },
  });
  const wsC = await prisma.workspace.create({
    data: {
      organizationId: otherOrg.id,
      name: 'Not Yours',
      subdomain: `switch-c-${suffix}`,
    },
  });

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await prisma.user.create({
    data: {
      email: `switch-${suffix}@example.invalid`,
      passwordHash,
      firstName: 'Mo',
      lastName: 'Multi',
    },
  });
  await prisma.membership.create({
    data: {
      userId: user.id,
      organizationId: org.id,
      workspaceId: wsA.id,
      role: Role.ORG_OWNER,
      permissions: [],
    },
  });
  await prisma.membership.create({
    data: {
      userId: user.id,
      organizationId: org.id,
      workspaceId: wsB.id,
      role: Role.USER,
      permissions: [],
    },
  });

  const outsider = await prisma.user.create({
    data: {
      email: `outsider-${suffix}@example.invalid`,
      passwordHash,
      firstName: 'Otto',
      lastName: 'Outsider',
    },
  });
  await prisma.membership.create({
    data: {
      userId: outsider.id,
      organizationId: otherOrg.id,
      workspaceId: wsC.id,
      role: Role.ORG_OWNER,
      permissions: [],
    },
  });

  cleanupCtx = {
    orgIds: [org.id, otherOrg.id],
    userIds: [user.id, outsider.id],
  };

  const accessFor = (userId: string, email: string, workspaceId: string) =>
    jwt.sign({ sub: userId, email, workspaceId }, process.env.JWT_SECRET!, {
      expiresIn: '15m',
    });

  const post = (url: string, body: unknown, token?: string) =>
    fetch(`${base}${url}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });

  // ===== A. An authenticated user can list their own memberships =====
  {
    const anon = await fetch(`${base}/api/auth/memberships`);
    check(
      `1. GET /api/auth/memberships requires authentication (got ${anon.status})`,
      anon.status === 401,
    );

    const token = accessFor(user.id, user.email, wsA.id);
    const res = await fetch(`${base}/api/auth/memberships`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    check(`2. An authenticated caller gets 200 (got ${res.status})`, res.status === 200);

    const body: any = await res.json();
    const list: any[] = asList(body);
    check(
      `3. Both of this user's workspaces are listed (got ${Array.isArray(list) ? list.length : 'not an array'})`,
      Array.isArray(list) && list.length === 2,
    );

    const names = (list ?? []).map((m: any) => m.workspaceName).sort();
    check(
      `4. Each entry names its workspace (got [${names.join(', ')}])`,
      names.join(',') === 'Airport Location,Downtown Studio',
    );

    const shapeOk = (list ?? []).every(
      (m: any) =>
        typeof m.workspaceId === 'string' &&
        typeof m.workspaceName === 'string' &&
        typeof m.organizationId === 'string' &&
        typeof m.organizationName === 'string' &&
        typeof m.role === 'string',
    );
    check(
      '5. Each entry carries workspaceId, workspaceName, organizationId, organizationName and role',
      shapeOk,
    );

    const roleForA = (list ?? []).find((m: any) => m.workspaceId === wsA.id)?.role;
    const roleForB = (list ?? []).find((m: any) => m.workspaceId === wsB.id)?.role;
    check(
      `6. The role reported is the per-workspace role, not one global role (A=${roleForA}, B=${roleForB})`,
      roleForA === Role.ORG_OWNER && roleForB === Role.USER,
    );

    // The list must come from the TOKEN's subject, never from a parameter.
    const outsiderToken = accessFor(outsider.id, outsider.email, wsC.id);
    const outsiderRes = await fetch(`${base}/api/auth/memberships`, {
      headers: { Authorization: `Bearer ${outsiderToken}` },
    });
    const outsiderBody: any = await outsiderRes.json();
    const outsiderList: any[] = asList(outsiderBody);
    const leaked = (outsiderList ?? []).filter((m: any) =>
      [wsA.id, wsB.id].includes(m.workspaceId),
    );
    check(
      '7. A different user never sees this user\'s workspaces',
      leaked.length === 0,
      `leaked ${leaked.map((m: any) => m.workspaceName).join(', ')}`,
    );
  }

  // ===== B. Switching workspace needs no password =====
  {
    const session = await authService.selectWorkspace(
      jwt.sign(
        { sub: user.id, purpose: 'workspace-selection' },
        process.env.JWT_SECRET!,
        { expiresIn: '5m' },
      ),
      wsA.id,
    );

    check(
      `8. The session payload names the active workspace (got "${(session as any).user?.workspaceName}")`,
      (session as any).user?.workspaceName === 'Downtown Studio',
    );
    check(
      `9. The session payload names the organization (got "${(session as any).user?.organizationName}")`,
      typeof (session as any).user?.organizationName === 'string' &&
        (session as any).user.organizationName.startsWith('Switch Org'),
    );

    const res = await post('/api/auth/switch-workspace', {
      refreshToken: session.refresh_token,
      workspaceId: wsB.id,
    });
    check(
      `10. Switching workspace succeeds with no password (got ${res.status})`,
      res.status === 200 || res.status === 201,
    );

    const switched: any = await res.json();
    // Decoded defensively so a missing route reports as failed checks rather
    // than aborting the suite before the later blocks run.
    let claims: any = {};
    try {
      claims = jwt.verify(switched.access_token, process.env.JWT_SECRET!);
    } catch {
      /* leaves claims empty; checks 11-12 fail and say so */
    }
    check(
      '11. The new access token is scoped to the TARGET workspace',
      claims.workspaceId === wsB.id,
    );
    check(
      `12. The new token carries the target workspace's role, not the old one (got ${claims.role})`,
      claims.role === Role.USER,
    );
    check(
      `13. The response names the workspace switched into (got "${switched.user?.workspaceName}")`,
      switched.user?.workspaceName === 'Airport Location',
    );

    // The old refresh token must be spent, exactly like a rotation.
    const oldRow = await prisma.refreshToken.findUnique({
      where: { hashedToken: hash(session.refresh_token) },
    });
    check('14. The refresh token used to switch is revoked', oldRow?.revoked === true);

    const live = await prisma.refreshToken.count({
      where: { userId: user.id, revoked: false },
    });
    check(
      `15. Switching leaves exactly one live refresh token (observed ${live})`,
      live === 1,
    );
    check(
      '16. The surviving token is bound to the target workspace',
      (
        await prisma.refreshToken.findFirst({
          where: { userId: user.id, revoked: false },
        })
      )?.workspaceId === wsB.id,
    );
  }

  // ===== C. The switch cannot be used to reach a workspace you are not in ===
  {
    const session = await authService.selectWorkspace(
      jwt.sign(
        { sub: user.id, purpose: 'workspace-selection' },
        process.env.JWT_SECRET!,
        { expiresIn: '5m' },
      ),
      wsA.id,
    );

    const res = await post('/api/auth/switch-workspace', {
      refreshToken: session.refresh_token,
      workspaceId: wsC.id, // belongs to another organization entirely
    });
    check(
      `17. Switching into a workspace you are not a member of is refused (got ${res.status})`,
      res.status === 401,
    );

    const body: any = await res.json();
    check(
      `18. That refusal is non-oracular -- it does not confirm the workspace exists (got "${body.message}")`,
      !/member|exist|found|workspace/i.test(String(body.message ?? '')),
    );

    const unknown = await post('/api/auth/switch-workspace', {
      refreshToken: 'a'.repeat(80),
      workspaceId: wsB.id,
    });
    const unknownBody: any = await unknown.json();
    check(
      `19. An unknown refresh token is refused identically (got ${unknown.status})`,
      unknown.status === 401 && unknownBody.message === body.message,
    );

    // Cleanup for the next block: this session's token is still live.
    await prisma.refreshToken.updateMany({
      where: { userId: user.id, revoked: false },
      data: { revoked: true },
    });
  }

  // ===== D. The switch inherits rotation's safety properties =====
  {
    const session = await authService.selectWorkspace(
      jwt.sign(
        { sub: user.id, purpose: 'workspace-selection' },
        process.env.JWT_SECRET!,
        { expiresIn: '5m' },
      ),
      wsA.id,
    );

    // Eight simultaneous switches of ONE token. Without an atomic claim every
    // one of them mints a session, exactly as rotation did before Phase 0C-R.
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        post('/api/auth/switch-workspace', {
          refreshToken: session.refresh_token,
          workspaceId: wsB.id,
        }).then(async (r) => ({ status: r.status })),
      ),
    );
    const winners = results.filter((r) => r.status < 400);
    check(
      `20. Exactly ONE of 8 concurrent switches succeeds (observed ${winners.length})`,
      winners.length === 1,
    );

    const live = await prisma.refreshToken.count({
      where: { userId: user.id, revoked: false },
    });
    check(
      `21. Concurrent switching cannot amplify one token into many (live=${live})`,
      live === 1,
    );

    // Replaying the spent token IMMEDIATELY is indistinguishable from the
    // racing tab above -- same token, same instant -- so it is refused without
    // being treated as theft. Revoking the family here is exactly what used to
    // sign a real user out for the crime of having two tabs open.
    const replay = await post('/api/auth/switch-workspace', {
      refreshToken: session.refresh_token,
      workspaceId: wsA.id,
    });
    const liveAfterReplay = await prisma.refreshToken.count({
      where: { userId: user.id, revoked: false },
    });
    check(`22. Replaying a spent token is refused (got ${replay.status})`, replay.status === 401);
    check(
      `23. An IMMEDIATE replay does not revoke the family -- concurrency, not theft (live=${liveAfterReplay})`,
      liveAfterReplay === 1,
    );

    // Push the revocation outside the grace window and present it again. Now
    // there is no innocent explanation and the whole family must go. Backdated
    // rather than slept through, so the suite stays fast and deterministic.
    await prisma.refreshToken.updateMany({
      where: { hashedToken: hash(session.refresh_token) },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });
    const lateReplay = await post('/api/auth/switch-workspace', {
      refreshToken: session.refresh_token,
      workspaceId: wsA.id,
    });
    const liveAfterLateReplay = await prisma.refreshToken.count({
      where: { userId: user.id, revoked: false },
    });
    check(
      `23a. A replay OUTSIDE the grace window is refused (got ${lateReplay.status})`,
      lateReplay.status === 401,
    );
    check(
      `23b. A replay outside the window still revokes the whole family (live=${liveAfterLateReplay})`,
      liveAfterLateReplay === 0,
    );

    // A token revoked before `revokedAt` existed carries no timestamp at all.
    // That must fail CLOSED -- treated as theft, the pre-existing behaviour.
    const legacySession = await authService.selectWorkspace(
      jwt.sign(
        { sub: user.id, purpose: 'workspace-selection' },
        process.env.JWT_SECRET!,
        { expiresIn: '5m' },
      ),
      wsA.id,
    );
    await prisma.refreshToken.updateMany({
      where: { hashedToken: hash(legacySession.refresh_token) },
      data: { revoked: true, revokedAt: null },
    });
    await post('/api/auth/switch-workspace', {
      refreshToken: legacySession.refresh_token,
      workspaceId: wsB.id,
    });
    const liveAfterLegacy = await prisma.refreshToken.count({
      where: { userId: user.id, revoked: false },
    });
    check(
      `23c. A revoked token with NO revokedAt fails closed -- still theft (live=${liveAfterLegacy})`,
      liveAfterLegacy === 0,
    );

    const outsiderLive = await prisma.refreshToken.count({
      where: { userId: outsider.id, revoked: false },
    });
    const outsiderSession = await authService.selectWorkspace(
      jwt.sign(
        { sub: outsider.id, purpose: 'workspace-selection' },
        process.env.JWT_SECRET!,
        { expiresIn: '5m' },
      ),
      wsC.id,
    );
    check(
      '24. Another account is untouched by that revocation',
      outsiderLive === 0 && typeof outsiderSession.access_token === 'string',
    );
  }

  // ===== E. Validation at the boundary =====
  {
    const cases: Array<[string, unknown]> = [
      ['25. A missing workspaceId is refused', { refreshToken: 'x'.repeat(80) }],
      ['26. A missing refreshToken is refused', { workspaceId: wsB.id }],
      [
        '27. A non-string workspaceId is refused',
        { refreshToken: 'x'.repeat(80), workspaceId: 42 },
      ],
      [
        '28. An unknown extra body property is refused',
        { refreshToken: 'x'.repeat(80), workspaceId: wsB.id, asRole: 'ORG_OWNER' },
      ],
    ];
    for (const [label, body] of cases) {
      const res = await post('/api/auth/switch-workspace', body);
      check(`${label} (got ${res.status})`, res.status === 400);
    }
  }

  console.log('==========================================================');
  console.log(`📊 WORKSPACE SWITCHING SUITE: ${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(teardown);
