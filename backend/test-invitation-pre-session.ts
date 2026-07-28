// Pre-session invitation acceptance.
//
// THE PRODUCT DEFECT THIS EXISTS TO CLOSE
//
// A person invited to their FIRST workspace could not accept the invitation.
// login() returns only a pre-session token, and issueTokensForMembership()
// refuses to mint a session without a membership -- so an account with zero
// workspaces could never hold an access token, and POST /team/invitations/accept
// (behind JwtAuthGuard) could never be called. The invitation link was unusable
// by exactly the person it exists for.
//
// Every API-layer test passed because each one signs a JWT directly, bypassing
// login entirely. 53 assertions in test-invitation-acceptance.ts did not catch
// it.
//
// THE FIX, AND WHAT IT MUST NOT BECOME
//
// Not a general-purpose workspace-less access token. Acceptance is authorized
// by a narrowly scoped capability that names ONE invitation, expires in
// minutes, creates no refresh-token row, and is refused by the ordinary access
// strategy. The capability is minted for and consumed by the server-side BFF;
// the browser never receives it.
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './src/app.module';
import { assertDisposableTestDatabase } from './test-db-guard';
import { PrismaClient, Role, InvitationStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
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

const PASSWORD = 'Sup3rSynthetic!Password';
const hashToken = (t: string) =>
  crypto.createHash('sha256').update(t).digest('hex');

let activeApp: { close: () => Promise<void> } | null = null;
let ctx: { orgIds: string[]; userIds: string[] } | null = null;

async function teardown() {
  if (activeApp) {
    await activeApp.close().catch(() => undefined);
    activeApp = null;
  }
  if (ctx) {
    const u = { in: ctx.userIds };
    await prisma.auditLog.deleteMany({ where: { userId: u } }).catch(() => undefined);
    await prisma.refreshToken.deleteMany({ where: { userId: u } }).catch(() => undefined);
    await prisma.invitation
      .deleteMany({ where: { organizationId: { in: ctx.orgIds } } })
      .catch(() => undefined);
    await prisma.membership.deleteMany({ where: { userId: u } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: u } }).catch(() => undefined);
    await prisma.workspace
      .deleteMany({ where: { organizationId: { in: ctx.orgIds } } })
      .catch(() => undefined);
    await prisma.organization
      .deleteMany({ where: { id: { in: ctx.orgIds } } })
      .catch(() => undefined);
  }
  await prisma.$disconnect().catch(() => undefined);
}

async function main() {
  await assertDisposableTestDatabase('test-invitation-pre-session.ts');

  console.log('🧪 PRE-SESSION INVITATION ACCEPTANCE SUITE');
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

  const s = Date.now();
  const org = await prisma.organization.create({ data: { name: `PreSess Org ${s}` } });
  const ws = await prisma.workspace.create({
    data: { organizationId: org.id, name: 'PreSess WS', subdomain: `presess-${s}` },
  });
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const owner = await prisma.user.create({
    data: { email: `owner-${s}@example.invalid`, passwordHash, firstName: 'Ola', lastName: 'Owner' },
  });
  await prisma.membership.create({
    data: {
      userId: owner.id,
      organizationId: org.id,
      workspaceId: ws.id,
      role: Role.ORG_OWNER,
      permissions: ['*'],
    },
  });

  // THE PERSON THIS WHOLE FEATURE IS FOR: a real account with a password and
  // ZERO memberships. Nothing else in the suite has this shape.
  const newcomer = await prisma.user.create({
    data: { email: `newcomer-${s}@example.invalid`, passwordHash, firstName: 'Nia', lastName: 'Newcomer' },
  });
  const stranger = await prisma.user.create({
    data: { email: `stranger-${s}@example.invalid`, passwordHash, firstName: 'Sam', lastName: 'Stranger' },
  });
  ctx = { orgIds: [org.id], userIds: [owner.id, newcomer.id, stranger.id] };

  const makeInvitation = async (email: string, role: Role = Role.USER) => {
    const raw = crypto.randomBytes(32).toString('hex');
    const inv = await prisma.invitation.create({
      data: {
        email,
        tokenHash: hashToken(raw),
        role,
        organizationId: org.id,
        workspaceId: ws.id,
        invitedById: owner.id,
        status: InvitationStatus.PENDING,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    });
    return { raw, inv };
  };

  // A rotating source address per call. This suite makes far more capability
  // mints than one client's 20/min budget allows, and collapsing them onto
  // 127.0.0.1 would measure the rate limiter rather than the behaviour under
  // test. TRUSTED_PROXY_HOPS=1 is set by the npm script, matching the shape the
  // deployment uses. The limiter itself is covered in test-invited-registration.
  let clientSeq = 0;
  const post = (path: string, body: unknown, bearer?: string) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': `203.0.113.${(clientSeq++ % 250) + 1}, 130.211.0.1`,
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(body ?? {}),
    });

  const login = async (email: string) => {
    const r = await post('/api/auth/login', { email, passwordPlain: PASSWORD });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };

  const MINT = '/api/auth/pre-session/invitation-capability';
  const ACCEPT = '/team/invitations/accept-pre-session';

  // ===== A. The premise: a workspace-less account CAN log in =====
  const newcomerLogin = await login(newcomer.email);
  check(
    `1. A workspace-less account can log in (got ${newcomerLogin.status})`,
    newcomerLogin.status < 300,
  );
  check(
    '2. ...and receives a pre-session token with an empty workspace list',
    typeof newcomerLogin.body?.preAuthToken === 'string' &&
      Array.isArray(newcomerLogin.body?.workspaces) &&
      newcomerLogin.body.workspaces.length === 0,
    JSON.stringify(newcomerLogin.body?.workspaces),
  );
  const newcomerPreAuth: string = newcomerLogin.body?.preAuthToken;

  // ===== B. Minting the capability =====
  const { raw: rawToken, inv } = await makeInvitation(newcomer.email);

  {
    const r = await post(MINT, { token: rawToken });
    check(`3. Minting without a pre-session token is refused (got ${r.status})`, r.status === 401);
  }
  {
    const r = await post(MINT, { token: rawToken }, 'not-a-jwt');
    check(`4. Minting with a garbage pre-session token is refused (got ${r.status})`, r.status === 401);
  }
  {
    const r = await post(MINT, { token: crypto.randomBytes(32).toString('hex') }, newcomerPreAuth);
    check(
      `5. Minting without possession of the raw invitation token is refused (got ${r.status})`,
      r.status === 404,
    );
  }

  let capability = '';
  {
    const r = await post(MINT, { token: rawToken }, newcomerPreAuth);
    const body = (await r.json().catch(() => ({}))) as any;
    check(`6. A valid pre-session token + raw token mints a capability (got ${r.status})`, r.status < 300);
    capability = body?.capabilityToken ?? '';
    check('7. ...and the response carries the capability', typeof capability === 'string' && capability.length > 0);

    const claims = capability
      ? JSON.parse(Buffer.from(capability.split('.')[1], 'base64url').toString())
      : {};
    check(
      '8. The capability names exactly one invitation',
      claims.invitationId === inv.id,
      `invitationId=${claims.invitationId}`,
    );
    check(
      '9. The capability is bound to the user from the PRE-SESSION TOKEN, not the body',
      claims.sub === newcomer.id,
    );
    check(
      '10. The capability declares purpose invitation-acceptance',
      claims.purpose === 'invitation-acceptance' && claims.tokenType === 'pre-session',
    );
    const ttl = (claims.exp ?? 0) - (claims.iat ?? 0);
    check(`11. The capability expires in at most five minutes (${ttl}s)`, ttl > 0 && ttl <= 300);
    check(
      '12. The capability carries no role, workspace or email claim',
      claims.role === undefined && claims.workspaceId === undefined && claims.email === undefined,
    );
  }

  // ===== C. A browser-supplied identity is never trusted =====
  {
    const r = await post(
      MINT,
      { token: rawToken, userId: owner.id, invitationId: inv.id, role: 'ORG_OWNER' },
      newcomerPreAuth,
    );
    check(
      `13. Extra identity fields in the body are rejected outright (got ${r.status})`,
      r.status === 400,
    );
  }
  {
    // The strongest form: a DIFFERENT person's pre-session token with this
    // person's raw invitation token. The capability must not be issued -- the
    // invitation was not sent to them.
    const strangerLogin = await login(stranger.email);
    const r = await post(MINT, { token: rawToken }, strangerLogin.body?.preAuthToken);
    check(
      `14. A different account cannot mint a capability for someone else's invitation (got ${r.status})`,
      r.status === 403 || r.status === 404,
    );
  }

  // ===== D. The capability is not a session =====
  {
    const routes = ['/api/auth/memberships', '/team/members', '/contacts'];
    let n = 15;
    for (const route of routes) {
      const r = await fetch(`${base}${route}`, {
        headers: { Authorization: `Bearer ${capability}`, 'x-workspace-id': ws.id },
      });
      check(`${n}. The capability is refused on ${route} (got ${r.status})`, r.status === 401);
      n++;
    }
  }
  {
    const r = await post('/api/auth/select-workspace', { workspaceId: ws.id }, capability);
    check(`18. The capability cannot select a workspace (got ${r.status})`, r.status === 401);
  }
  {
    const rows = await prisma.refreshToken.count({ where: { userId: newcomer.id } });
    check(`19. Minting a capability creates no refresh-token row (${rows})`, rows === 0);
  }

  // ===== E. Accepting with the capability =====
  {
    const r = await post(ACCEPT, {}, newcomerPreAuth);
    check(
      `20. A workspace-selection token cannot accept an invitation (got ${r.status})`,
      r.status === 401,
    );
  }
  let escalationCap = '';
  {
    // A capability is bound to ONE invitation. Because the accept route reads
    // NO body, the invitation it acts on is structurally the one named in the
    // capability -- there is no input through which to redirect it.
    const { raw: otherRaw } = await makeInvitation(newcomer.email, Role.WORKSPACE_ADMIN);
    const other = await post(MINT, { token: otherRaw }, newcomerPreAuth);
    escalationCap = ((await other.json().catch(() => ({}))) as any)?.capabilityToken ?? '';
    const claims = escalationCap
      ? JSON.parse(Buffer.from(escalationCap.split('.')[1], 'base64url').toString())
      : {};
    check(
      '21. A second invitation mints a capability naming that OTHER invitation',
      Boolean(claims.invitationId) && claims.invitationId !== inv.id,
    );
  }

  let acceptBody: any = {};
  {
    const r = await post(ACCEPT, {}, capability);
    acceptBody = (await r.json().catch(() => ({}))) as any;
    check(`22. The capability accepts its own invitation (got ${r.status})`, r.status === 200);
    check(
      `23. ...reporting JOINED with access (${acceptBody?.outcome}/${acceptBody?.hasAccess})`,
      acceptBody?.outcome === 'JOINED' && acceptBody?.hasAccess === true,
    );
    check(
      '24. ...and the role comes from the membership',
      acceptBody?.role === Role.USER,
      String(acceptBody?.role),
    );
  }
  {
    const membership = await prisma.membership.findFirst({
      where: { userId: newcomer.id, workspaceId: ws.id },
    });
    check('25. The membership now exists in the database', Boolean(membership));
    check(
      '26. Exactly one organization existed throughout -- no spare was created',
      (await prisma.organization.count({ where: { id: { in: ctx!.orgIds } } })) === 1,
    );
    check(
      '27. Exactly one workspace existed throughout -- no spare was created',
      (await prisma.workspace.count({ where: { organizationId: org.id } })) === 1,
    );
  }
  {
    // Re-presenting the SAME capability must be idempotent, not an error.
    const r = await post(ACCEPT, {}, capability);
    const body = (await r.json().catch(() => ({}))) as any;
    check(`28. Re-presenting the capability answers 200 (got ${r.status})`, r.status === 200);
    check(
      `29. ...with ALREADY_ACCEPTED, not an error (${body?.outcome})`,
      body?.outcome === 'ALREADY_ACCEPTED' && body?.hasAccess === true,
    );
  }

  // ===== E1b. Moving the class guard to the routes did not unguard one =====
  //
  // InvitationController carried @UseGuards(JwtAuthGuard) at class level; it is
  // now applied per-route so that widening one route cannot silently widen the
  // other. That refactor is exactly the kind that leaves a route bare, so both
  // are re-checked here rather than assumed.
  {
    const bare = await post('/team/invitations/accept', { token: rawToken });
    check(
      `29e. The session accept route still refuses an unauthenticated caller (got ${bare.status})`,
      bare.status === 401,
    );
    const withCap = await post('/team/invitations/accept', { token: rawToken }, capability);
    check(
      `29f. ...and refuses a capability (got ${withCap.status})`,
      withCap.status === 401,
    );
    const bareCap = await post(ACCEPT, {});
    check(
      `29g. The capability accept route refuses an unauthenticated caller (got ${bareCap.status})`,
      bareCap.status === 401,
    );
  }

  // ===== E2. An invitation cannot escalate an existing member =====
  //
  // The second invitation above offers WORKSPACE_ADMIN to somebody who is now
  // an ordinary USER. Accepting it must NOT re-role them: the insert is
  // ON CONFLICT DO NOTHING, and the reported role is read back from the
  // membership rather than echoed from the invitation. Otherwise anyone who
  // could get themselves invited at a higher role -- including by an
  // administrator who did not realise they were already a member -- would be
  // promoted by opening a link.
  {
    const r = await post(ACCEPT, {}, escalationCap);
    const body = (await r.json().catch(() => ({}))) as any;
    check(
      `29b. A higher-role invitation for an existing member answers 200 (got ${r.status})`,
      r.status === 200,
    );
    check(
      `29c. ...reporting ALREADY_MEMBER, not a promotion (${body?.outcome}/${body?.role})`,
      body?.outcome === 'ALREADY_MEMBER' && body?.role === Role.USER,
    );
    const membership = await prisma.membership.findFirst({
      where: { userId: newcomer.id, workspaceId: ws.id },
    });
    check(
      `29d. The stored role is unchanged -- no privilege escalation (${membership?.role})`,
      membership?.role === Role.USER,
    );
  }

  // ===== F. The account can now hold a real session =====
  {
    const relogin = await login(newcomer.email);
    check(
      '30. After accepting, login lists the workspace',
      relogin.body?.workspaces?.length === 1 &&
        relogin.body.workspaces[0].workspaceId === ws.id,
    );
    const r = await post(
      '/api/auth/select-workspace',
      { workspaceId: ws.id },
      relogin.body?.preAuthToken,
    );
    const body = (await r.json().catch(() => ({}))) as any;
    check(`31. ...and select-workspace mints a real session (got ${r.status})`, r.status < 300);
    check(
      '32. The session token is a real access token, usable on a guarded route',
      typeof body?.access_token === 'string' &&
        (
          await fetch(`${base}/api/auth/memberships`, {
            headers: { Authorization: `Bearer ${body.access_token}` },
          })
        ).status === 200,
    );
  }

  // ===== G. Registering BECAUSE you were invited =====
  //
  // Ordinary register() creates an Organization, a Workspace and an ORG_OWNER
  // membership -- correct for somebody starting their own company, wrong for
  // somebody joining an existing one. It would leave every invited person
  // owning an empty organization they never asked for and can never be rid of.
  {
    const orgsBefore = await prisma.organization.count();
    const wsBefore = await prisma.workspace.count();
    const invitedEmail = `invited-${s}@example.invalid`;
    const { raw: invitedRaw } = await makeInvitation(invitedEmail);
    const REG = '/api/auth/register-invited';

    const bad = await post(REG, {
      token: crypto.randomBytes(32).toString('hex'),
      email: invitedEmail,
      passwordPlain: PASSWORD,
      firstName: 'Ida',
      lastName: 'Invited',
    });
    check(
      `33. Registering without a real invitation is refused (got ${bad.status})`,
      bad.status === 404,
    );

    const mismatch = await post(REG, {
      token: invitedRaw,
      email: `someone-else-${s}@example.invalid`,
      passwordPlain: PASSWORD,
      firstName: 'Ida',
      lastName: 'Invited',
    });
    check(
      `34. Registering under a different address than the invitation is refused (got ${mismatch.status})`,
      mismatch.status === 403 || mismatch.status === 404,
    );

    const reg = await post(REG, {
      token: invitedRaw,
      email: invitedEmail,
      passwordPlain: PASSWORD,
      firstName: 'Ida',
      lastName: 'Invited',
    });
    check(
      `35. An invited person can register (got ${reg.status})`,
      reg.status < 300,
    );

    const created = await prisma.user.findUnique({
      where: { email: invitedEmail },
    });
    if (created) ctx!.userIds.push(created.id);
    check('36. The account exists', Boolean(created));

    const orgsAfter = await prisma.organization.count();
    const wsAfter = await prisma.workspace.count();
    check(
      `37. NO spare organization was created (${orgsBefore} -> ${orgsAfter})`,
      orgsAfter === orgsBefore,
    );
    check(
      `38. NO spare workspace was created (${wsBefore} -> ${wsAfter})`,
      wsAfter === wsBefore,
    );
    check(
      '39. NO membership is granted by registering -- the invitation still has to be accepted',
      created
        ? (await prisma.membership.count({ where: { userId: created.id } })) === 0
        : false,
    );

    // And the account works: it can complete the whole chain.
    const fresh = await login(invitedEmail);
    const cap = await post(MINT, { token: invitedRaw }, fresh.body?.preAuthToken);
    const capTok = ((await cap.json().catch(() => ({}))) as any)?.capabilityToken;
    const acc = await post(ACCEPT, {}, capTok);
    const accBody = (await acc.json().catch(() => ({}))) as any;
    check(
      `40. ...and can then accept the invitation that brought them (${accBody?.outcome})`,
      acc.status === 200 &&
        accBody?.outcome === 'JOINED' &&
        accBody?.hasAccess === true,
    );
  }
  // ===== H. Which invitation states may mint a capability =====
  //
  // Minting is a capability grant, so the state policy belongs here as well as
  // at acceptance -- refusing only at the last hop would mean a withdrawn
  // invitation still produced a live credential naming it.
  {
    const revokedEmail = `revoked-cap-${s}@example.invalid`;
    const revokedUser = await prisma.user.create({
      data: {
        email: revokedEmail,
        passwordHash,
        firstName: 'Rae',
        lastName: 'Revoked',
      },
    });
    ctx!.userIds.push(revokedUser.id);
    const revLogin = await login(revokedEmail);

    const { raw: revRaw, inv: revInv } = await makeInvitation(revokedEmail);
    await prisma.invitation.update({
      where: { id: revInv.id },
      data: { status: InvitationStatus.REVOKED },
    });
    const revoked = await post(MINT, { token: revRaw }, revLogin.body?.preAuthToken);
    check(
      `41. A REVOKED invitation cannot mint a capability (got ${revoked.status})`,
      revoked.status === 404,
    );

    const { raw: expRaw, inv: expInv } = await makeInvitation(revokedEmail);
    await prisma.invitation.update({
      where: { id: expInv.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await post(MINT, { token: expRaw }, revLogin.body?.preAuthToken);
    check(
      `42. An EXPIRED invitation cannot mint a capability (got ${expired.status})`,
      expired.status >= 400,
    );

    // Accepted by SOMEBODY ELSE. The retry allowance is for the accepting
    // account only; for anyone else the link is spent.
    const { raw: othRaw, inv: othInv } = await makeInvitation(revokedEmail);
    await prisma.invitation.update({
      where: { id: othInv.id },
      data: {
        status: InvitationStatus.ACCEPTED,
        acceptedById: owner.id,
        acceptedAt: new Date(),
      },
    });
    const foreign = await post(MINT, { token: othRaw }, revLogin.body?.preAuthToken);
    check(
      `43. An invitation accepted by a DIFFERENT account cannot mint (got ${foreign.status})`,
      foreign.status === 404,
    );
  }
  console.log('==========================================================');
  console.log(`📊 PRE-SESSION INVITATION SUITE: ${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(teardown);
