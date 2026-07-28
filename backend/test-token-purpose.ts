// Token-purpose separation.
//
// THE DEFECT THIS EXISTS TO CATCH
//
// JwtStrategy.validate() checks three things: the signature (via passport), the
// expiry, and that the subject exists. It never looks at `purpose`.
//
// login() mints a pre-auth token signed with the SAME secret:
//
//   { sub: user.id, purpose: 'workspace-selection' }
//
// It carries a valid `sub`, so it satisfies every check the strategy performs
// and passes JwtAuthGuard on ordinary routes. A credential issued to do exactly
// one thing -- pick a workspace, before any password-verified session exists --
// is accepted as a general bearer token.
//
// test-auth-security.ts already proves the OPPOSITE direction (a normal access
// token refused as a pre-auth token). This direction, the dangerous one, was
// never tested.
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
  await assertDisposableTestDatabase('test-token-purpose.ts');

  console.log('🧪 TOKEN PURPOSE SEPARATION SUITE');
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
    data: { name: `Purpose Org ${suffix}` },
  });
  const ws = await prisma.workspace.create({
    data: {
      organizationId: org.id,
      name: 'Purpose WS',
      subdomain: `purpose-${suffix}`,
    },
  });
  const user = await prisma.user.create({
    data: {
      email: `purpose-${suffix}@example.invalid`,
      passwordHash: 'x',
      firstName: 'Pat',
      lastName: 'Purpose',
    },
  });
  await prisma.membership.create({
    data: {
      userId: user.id,
      organizationId: org.id,
      workspaceId: ws.id,
      role: Role.ORG_OWNER,
      permissions: [],
    },
  });
  ctx = { orgIds: [org.id], userIds: [user.id] };

  const sign = (payload: object, expiresIn = '15m') =>
    jwt.sign(payload as any, process.env.JWT_SECRET!, { expiresIn } as any);

  const accessToken = sign({
    sub: user.id,
    email: user.email,
    workspaceId: ws.id,
    role: Role.ORG_OWNER,
    tokenType: 'access',
  });
  const preSessionToken = sign(
    { sub: user.id, tokenType: 'pre-session', purpose: 'workspace-selection' },
    '5m',
  );
  const capabilityToken = sign(
    {
      sub: user.id,
      tokenType: 'pre-session',
      purpose: 'invitation-acceptance',
      invitationId: '00000000-0000-4000-8000-000000000123',
    },
    '5m',
  );

  const get = (path: string, token: string, wsId?: string) =>
    fetch(`${base}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(wsId ? { 'x-workspace-id': wsId } : {}),
      },
    });
  const postSelect = (token: string) =>
    fetch(`${base}/api/auth/select-workspace`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ workspaceId: ws.id }),
    });

  // ===== A. A normal access token still works =====
  {
    const res = await get('/api/auth/memberships', accessToken);
    check(
      `1. A normal access token passes JwtAuthGuard (got ${res.status})`,
      res.status === 200,
    );
  }

  // ===== B. NO pre-session token may pass an ordinary guarded route =====
  {
    const routes = [
      '/api/auth/memberships',
      '/team/members',
      '/team/invitations',
      '/agent/tools',
      '/agent/approvals',
      '/contacts',
    ];

    let n = 2;
    for (const route of routes) {
      const res = await get(route, preSessionToken, ws.id);
      check(
        `${n}. A workspace-selection token is REFUSED on ${route} (got ${res.status})`,
        res.status === 401,
      );
      n++;
    }
    for (const route of routes) {
      const res = await get(route, capabilityToken, ws.id);
      check(
        `${n}. An invitation capability is REFUSED on ${route} (got ${res.status})`,
        res.status === 401,
      );
      n++;
    }
  }

  // ===== C. Each purpose works only on its own endpoint =====
  {
    const sel = await postSelect(preSessionToken);
    check(
      `14. A workspace-selection token still works on select-workspace (got ${sel.status})`,
      sel.status < 300,
    );

    const crossed = await postSelect(capabilityToken);
    check(
      `15. An invitation capability CANNOT select a workspace (got ${crossed.status})`,
      crossed.status === 401,
    );

    const reused = await postSelect(accessToken);
    check(
      `16. A normal access token cannot be used as a pre-auth token (got ${reused.status})`,
      reused.status === 401,
    );
  }

  // ===== D. Tampering and expiry =====
  {
    const expired = sign(
      {
        sub: user.id,
        tokenType: 'pre-session',
        purpose: 'workspace-selection',
      },
      '-1s',
    );
    check(
      `17. An expired pre-session token is refused (got ${(await postSelect(expired)).status})`,
      (await postSelect(expired)).status === 401,
    );

    // Re-signing with a different purpose produces a NEW valid signature, so
    // protection cannot come from signature checking -- only from the server
    // requiring the right purpose for the right route.
    const swapped = sign(
      {
        sub: user.id,
        tokenType: 'pre-session',
        purpose: 'invitation-acceptance',
      },
      '5m',
    );
    check(
      `18. A validly-signed token with the WRONG purpose is refused (got ${(await postSelect(swapped)).status})`,
      (await postSelect(swapped)).status === 401,
    );

    const forged = jwt.sign(
      { sub: user.id, tokenType: 'access', workspaceId: ws.id },
      'not-the-real-secret-not-the-real-secret',
      { expiresIn: '15m' },
    );
    check(
      `19. A foreign-signed token is refused (got ${(await get('/api/auth/memberships', forged)).status})`,
      (await get('/api/auth/memberships', forged)).status === 401,
    );
  }

  // ===== D2. The deploy window =====
  //
  // A pre-session token minted by the PREVIOUS build carries `purpose` but no
  // `tokenType`, and stays valid for five minutes after the new code ships.
  // `tokenType` alone would let those through for the whole window, so the
  // `purpose` check has to stand on its own.
  {
    const legacyPreSession = sign({ sub: user.id, purpose: 'workspace-selection' }, '5m');
    const res = await get('/team/members', legacyPreSession, ws.id);
    check(
      `19b. A legacy pre-session token (purpose, no tokenType) is REFUSED (got ${res.status})`,
      res.status === 401,
    );

    // And the converse: a legacy ACCESS token, minted before `tokenType`
    // existed, must keep working -- otherwise shipping this logs everyone out.
    const legacyAccess = sign({
      sub: user.id,
      email: user.email,
      workspaceId: ws.id,
      role: Role.ORG_OWNER,
    });
    const ok = await get('/api/auth/memberships', legacyAccess);
    check(
      `19c. A legacy access token (no tokenType, no purpose) still works (got ${ok.status})`,
      ok.status === 200,
    );
  }

  // ===== E. Nothing token-shaped reaches the logs =====
  {
    const captured: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...a: unknown[]) => captured.push(a.join(' '));
    console.error = (...a: unknown[]) => captured.push(a.join(' '));
    try {
      await get('/team/members', preSessionToken, ws.id);
      await get('/agent/tools', capabilityToken, ws.id);
    } finally {
      console.log = origLog;
      console.error = origErr;
    }
    const blob = captured.join('\n');
    check(
      '20. No JWT reaches the logs when a purpose token is refused',
      !blob.includes(preSessionToken) && !blob.includes(capabilityToken),
    );
  }

  console.log('==========================================================');
  console.log(`📊 TOKEN PURPOSE SUITE: ${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(teardown);
