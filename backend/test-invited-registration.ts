// Invited registration: atomicity, recovery and concurrency.
//
// WHAT THE FIRST VERSION GOT WRONG
//
// registerInvited() did four sequential round-trips with no transaction:
// read invitation, read user, create user, create audit. Every seam between
// them is a way to leave the database in a state the product cannot explain:
//
//   * the user commits and the audit insert fails  -> an account exists that
//     no administrator can see the origin of
//   * the user commits and the HTTP response is lost -> the recipient retries
//     and is told "User with this email already exists", which is true,
//     useless, and a dead end -- their account exists but they cannot proceed
//   * two submissions race -> a raw Prisma P2002 escapes as a 500
//
// It also validated almost nothing: an invitation that had been REVOKED by an
// administrator, or already ACCEPTED by somebody else, still created an
// account. Revocation that does not actually stop the thing it revokes is
// worse than no revocation, because it is believed.
//
// The recipient of an invitation cannot be expected to understand partial
// server state. Every one of these paths has to resolve by them pressing the
// button again.
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
const WRONG_PASSWORD = 'Wr0ngSynthetic!Password';
const hashToken = (t: string) =>
  crypto.createHash('sha256').update(t).digest('hex');

let activeApp: { close: () => Promise<void> } | null = null;
let ctx: { orgIds: string[]; emails: string[] } | null = null;

async function dropAuditTrigger() {
  await prisma
    .$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS demm_test_fail_audit ON "AuditLog"`,
    )
    .catch(() => undefined);
  await prisma
    .$executeRawUnsafe(`DROP FUNCTION IF EXISTS demm_test_fail_audit()`)
    .catch(() => undefined);
}

async function teardown() {
  await dropAuditTrigger();
  if (activeApp) {
    await activeApp.close().catch(() => undefined);
    activeApp = null;
  }
  if (ctx) {
    const users = await prisma.user
      .findMany({ where: { email: { in: ctx.emails } }, select: { id: true } })
      .catch(() => [] as { id: string }[]);
    const ids = users.map((u) => u.id);
    if (ids.length) {
      await prisma.auditLog
        .deleteMany({ where: { userId: { in: ids } } })
        .catch(() => undefined);
      await prisma.refreshToken
        .deleteMany({ where: { userId: { in: ids } } })
        .catch(() => undefined);
      await prisma.membership
        .deleteMany({ where: { userId: { in: ids } } })
        .catch(() => undefined);
    }
    await prisma.invitation
      .deleteMany({ where: { organizationId: { in: ctx.orgIds } } })
      .catch(() => undefined);
    if (ids.length) {
      await prisma.user
        .deleteMany({ where: { id: { in: ids } } })
        .catch(() => undefined);
    }
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
  await assertDisposableTestDatabase('test-invited-registration.ts');
  await dropAuditTrigger();

  console.log('🧪 INVITED REGISTRATION SUITE');
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
  const org = await prisma.organization.create({
    data: { name: `Reg Org ${s}` },
  });
  const ws = await prisma.workspace.create({
    data: { organizationId: org.id, name: 'Reg WS', subdomain: `reg-${s}` },
  });
  const ownerEmail = `reg-owner-${s}@example.invalid`;
  const owner = await prisma.user.create({
    data: {
      email: ownerEmail,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      firstName: 'Ola',
      lastName: 'Owner',
    },
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
  ctx = { orgIds: [org.id], emails: [ownerEmail] };

  const track = (email: string) => {
    ctx!.emails.push(email);
    return email;
  };

  const makeInvitation = async (
    email: string,
    status: InvitationStatus = InvitationStatus.PENDING,
    expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000),
  ) => {
    const raw = crypto.randomBytes(32).toString('hex');
    const inv = await prisma.invitation.create({
      data: {
        email,
        tokenHash: hashToken(raw),
        role: Role.USER,
        organizationId: org.id,
        workspaceId: ws.id,
        invitedById: owner.id,
        status,
        expiresAt,
      },
    });
    return { raw, inv };
  };

  const REG = '/api/auth/register-invited';

  // Each logical person gets their own source address. The suite runs far more
  // than the 5/min-per-client registration budget in total, and collapsing
  // everybody onto 127.0.0.1 would measure the rate limiter rather than the
  // behaviour under test. TRUSTED_PROXY_HOPS=1 is set by the npm script, which
  // is the same shape the deployment uses.
  let clientSeq = 0;
  const newClient = () => `203.0.113.${(clientSeq++ % 250) + 1}`;

  const register = async (body: Record<string, unknown>, client: string) => {
    const r = await fetch(`${base}${REG}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': `${client}, 130.211.0.1`,
      },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const attempt = (
    token: string,
    email: string,
    passwordPlain = PASSWORD,
    firstName = 'Ida',
    lastName = 'Invited',
    client = newClient(),
  ) => register({ token, email, passwordPlain, firstName, lastName }, client);

  const userCount = (email: string) => prisma.user.count({ where: { email } });
  const auditCount = async (email: string) => {
    const u = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!u) return 0;
    return prisma.auditLog.count({
      where: { userId: u.id, action: 'register-invited' },
    });
  };

  // ===== A. Invitations that must not create an account =====
  {
    const email = track(`revoked-${s}@example.invalid`);
    const { raw } = await makeInvitation(email, InvitationStatus.REVOKED);
    const r = await attempt(raw, email);
    check(
      `1. A REVOKED invitation cannot create a user (got ${r.status})`,
      r.status >= 400,
    );
    check('1b. ...and no account was created', (await userCount(email)) === 0);
  }
  {
    const email = track(`expired-${s}@example.invalid`);
    const { raw } = await makeInvitation(
      email,
      InvitationStatus.PENDING,
      new Date(Date.now() - 1000),
    );
    const r = await attempt(raw, email);
    check(
      `2. An EXPIRED invitation cannot create a user (got ${r.status})`,
      r.status >= 400,
    );
    check('2b. ...and no account was created', (await userCount(email)) === 0);
  }
  {
    const email = track(`accepted-${s}@example.invalid`);
    const { raw } = await makeInvitation(email, InvitationStatus.ACCEPTED);
    const r = await attempt(raw, email);
    check(
      `2c. An invitation already ACCEPTED cannot create a user (got ${r.status})`,
      r.status >= 400,
    );
    check('2d. ...and no account was created', (await userCount(email)) === 0);
  }
  {
    const email = track(`mismatch-${s}@example.invalid`);
    const { raw } = await makeInvitation(email);
    const other = track(`mismatch-other-${s}@example.invalid`);
    const r = await attempt(raw, other);
    check(
      `3. A mismatched email cannot create a user (got ${r.status})`,
      r.status >= 400,
    );
    check('3b. ...and no account was created', (await userCount(other)) === 0);
  }
  {
    const email = track(`badtoken-${s}@example.invalid`);
    await makeInvitation(email);
    const r = await attempt(crypto.randomBytes(32).toString('hex'), email);
    check(
      `4. An invalid token cannot create a user (got ${r.status})`,
      r.status === 404,
    );
    check('4b. ...and no account was created', (await userCount(email)) === 0);
  }

  // ===== B. The happy path, and its atomicity =====
  {
    const email = track(`created-${s}@example.invalid`);
    const { raw } = await makeInvitation(email);
    const r = await attempt(raw, email);
    check(
      `5. A valid request creates one user (got ${r.status})`,
      r.status < 300,
    );
    check(
      `5b. ...reported as CREATED (${r.body?.outcome})`,
      r.body?.outcome === 'CREATED',
    );
    check('5c. ...exactly one user row', (await userCount(email)) === 1);
    check(
      '6. The user and its audit record committed together',
      (await auditCount(email)) === 1,
    );
  }
  {
    // FORCED AUDIT FAILURE. A trigger makes the audit insert raise. If the two
    // writes share a transaction the user must not survive; if they do not, an
    // orphan account is left behind and this fails.
    const email = track(`atomic-${s}@example.invalid`);
    const { raw } = await makeInvitation(email);
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION demm_test_fail_audit() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'forced audit failure'; END;
      $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER demm_test_fail_audit BEFORE INSERT ON "AuditLog"
      FOR EACH ROW WHEN (NEW.action = 'register-invited')
      EXECUTE FUNCTION demm_test_fail_audit()`);

    const r = await attempt(raw, email);
    check(
      `7. A forced audit failure refuses the request (got ${r.status})`,
      r.status >= 400,
    );
    check(
      '7b. ...and leaves NO user behind -- the writes are one transaction',
      (await userCount(email)) === 0,
    );
    check(
      '7c. ...and does not leak the database error to the caller',
      !/forced audit failure|plpgsql|P200[0-9]/i.test(JSON.stringify(r.body)),
      JSON.stringify(r.body).slice(0, 120),
    );
    await dropAuditTrigger();

    // And the SAME request now succeeds: the failure left nothing to collide.
    const retry = await attempt(raw, email);
    check(
      `7d. ...and retrying after the fault succeeds (${retry.body?.outcome})`,
      retry.status < 300 && retry.body?.outcome === 'CREATED',
    );
  }

  // ===== C. The lost response =====
  {
    const email = track(`retry-${s}@example.invalid`);
    const { raw } = await makeInvitation(email);
    const first = await attempt(raw, email);
    check(
      `8. First submission creates the account (${first.body?.outcome})`,
      first.status < 300 && first.body?.outcome === 'CREATED',
    );

    // The recipient never saw the response and pressed the button again.
    const second = await attempt(raw, email);
    check(
      `8b. A repeat submission answers 2xx, not "already exists" (got ${second.status})`,
      second.status < 300,
    );
    check(
      `9. ...reported truthfully as ALREADY_REGISTERED (${second.body?.outcome})`,
      second.body?.outcome === 'ALREADY_REGISTERED',
    );
    check(
      '9b. ...identifying the same account',
      Boolean(second.body?.userId) && second.body?.email === email,
    );
    check('9c. ...and still exactly one user', (await userCount(email)) === 1);
    check(
      '9d. ...and still exactly one audit record',
      (await auditCount(email)) === 1,
    );

    // The retry must not rewrite anything about the existing account.
    const before = await prisma.user.findUnique({ where: { email } });
    await attempt(raw, email, PASSWORD, 'Overwritten', 'Name');
    const after = await prisma.user.findUnique({ where: { email } });
    check(
      '9e. A retry does not overwrite the name',
      after?.firstName === before?.firstName &&
        after?.lastName === before?.lastName,
      `${after?.firstName} ${after?.lastName}`,
    );
    check(
      '9f. A retry does not overwrite the password hash',
      after?.passwordHash === before?.passwordHash,
    );

    // Wrong password on retry: a generic refusal, never a hint.
    const wrong = await attempt(raw, email, WRONG_PASSWORD);
    check(
      `10. A retry with the wrong password is refused (got ${wrong.status})`,
      wrong.status === 401,
    );
    check(
      '10b. ...with a generic message that does not confirm the account exists',
      !/already exists|already registered/i.test(
        JSON.stringify(wrong.body ?? {}),
      ),
      JSON.stringify(wrong.body).slice(0, 120),
    );
  }

  // ===== D. Concurrency =====
  {
    const email = track(`concurrent-${s}@example.invalid`);
    const { raw } = await makeInvitation(email);
    const orgsBefore = await prisma.organization.count();
    const wsBefore = await prisma.workspace.count();

    // ONE person, one browser, six simultaneous submits -- so one source
    // address, not six. That is what a double-click storm or a retry loop
    // actually looks like, and it is the case the database race lives in.
    const oneClient = newClient();
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        attempt(raw, email, PASSWORD, 'Ida', 'Invited', oneClient),
      ),
    );
    const statuses = results.map((r) => r.status);
    const outcomes = results.map((r) => r.body?.outcome);

    check(
      `11. Six concurrent submissions create exactly one user (${await userCount(email)})`,
      (await userCount(email)) === 1,
    );
    check(
      `12. No request returned 500 (${statuses.join(',')})`,
      statuses.every((c) => c !== 500),
    );
    check(
      `12b. Every request answered 2xx (${statuses.join(',')})`,
      statuses.every((c) => c < 300),
    );
    check(
      `12c. Exactly one CREATED, the rest ALREADY_REGISTERED (${outcomes.join(',')})`,
      outcomes.filter((o) => o === 'CREATED').length === 1 &&
        outcomes.filter((o) => o === 'ALREADY_REGISTERED').length === 5,
    );
    check(
      '12d. No Prisma error code escaped to any caller',
      !/P2002|Unique constraint|prisma/i.test(
        JSON.stringify(results.map((r) => r.body)),
      ),
    );
    check(
      `13. Exactly one audit record exists (${await auditCount(email)})`,
      (await auditCount(email)) === 1,
    );
    const orgsAfter = await prisma.organization.count();
    const wsAfter = await prisma.workspace.count();
    check(
      `14. Organization count is unchanged (${orgsBefore} -> ${orgsAfter})`,
      orgsAfter === orgsBefore,
    );
    check(
      `15. Workspace count is unchanged (${wsBefore} -> ${wsAfter})`,
      wsAfter === wsBefore,
    );
    const created = await prisma.user.findUnique({ where: { email } });
    const memberships = created
      ? await prisma.membership.count({ where: { userId: created.id } })
      : -1;
    check(
      `16. Membership count is zero until acceptance (${memberships})`,
      memberships === 0,
    );
    check(
      '16b. No refresh-token row was created by registering',
      created
        ? (await prisma.refreshToken.count({ where: { userId: created.id } })) ===
            0
        : false,
    );
  }

  // ===== E. Recovery through the rest of the chain =====
  {
    // 17. Registration succeeded, acceptance then failed transiently. The
    // recipient must be able to press the button again and complete, without
    // being told their account already exists.
    const email = track(`resume-${s}@example.invalid`);
    const { raw } = await makeInvitation(email);
    const reg = await attempt(raw, email);
    check(
      `17. Registration succeeds, leaving acceptance still to do (${reg.body?.outcome})`,
      reg.status < 300 && reg.body?.outcome === 'CREATED',
    );

    const loginFor = async () => {
      const l = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, passwordPlain: PASSWORD }),
      });
      return (await l.json().catch(() => ({}))) as any;
    };
    const mint = async (preAuth: string) => {
      const m = await fetch(
        `${base}/api/auth/pre-session/invitation-capability`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${preAuth}`,
          },
          body: JSON.stringify({ token: raw }),
        },
      );
      return {
        status: m.status,
        token: ((await m.json().catch(() => ({}))) as any)?.capabilityToken,
      };
    };
    const acceptWith = async (cap: string) => {
      const a = await fetch(`${base}/team/invitations/accept-pre-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cap}`,
        },
        body: JSON.stringify({}),
      });
      return {
        status: a.status,
        body: (await a.json().catch(() => ({}))) as any,
      };
    };

    // Simulated transient acceptance failure: a capability minted and never
    // spent. Nothing is consumed, so the invitation must still be usable.
    const abandoned = await mint((await loginFor())?.preAuthToken);
    check(
      `17b. A capability can be minted and abandoned (got ${abandoned.status})`,
      abandoned.status < 300,
    );

    const retryReg = await attempt(raw, email);
    check(
      `17c. Re-submitting registration after that is safe (${retryReg.body?.outcome})`,
      retryReg.status < 300 && retryReg.body?.outcome === 'ALREADY_REGISTERED',
    );

    // 18. Now complete it for real, then retry the tail as if session
    // establishment had failed.
    const fresh = await loginFor();
    const firstAccept = await acceptWith((await mint(fresh?.preAuthToken)).token);
    check(
      `18. Acceptance completes (${firstAccept.body?.outcome})`,
      firstAccept.status === 200 && firstAccept.body?.outcome === 'JOINED',
    );

    const second = await mint(fresh?.preAuthToken);
    check(
      `18b. A capability can still be minted for an accepted invitation, for retry (got ${second.status})`,
      second.status < 300 && typeof second.token === 'string',
    );
    const secondAccept = await acceptWith(second.token);
    check(
      `18c. The retry is idempotent, not an error (${secondAccept.body?.outcome})`,
      secondAccept.status === 200 &&
        secondAccept.body?.outcome === 'ALREADY_ACCEPTED' &&
        secondAccept.body?.hasAccess === true,
    );
  }

  // ===== F. Nothing sensitive is recorded =====
  {
    const email = track(`redact-${s}@example.invalid`);
    const { raw } = await makeInvitation(email);
    const captured: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...a: unknown[]) => captured.push(a.join(' '));
    console.error = (...a: unknown[]) => captured.push(a.join(' '));
    try {
      await attempt(raw, email);
    } finally {
      console.log = origLog;
      console.error = origErr;
    }

    const user = await prisma.user.findUnique({ where: { email } });
    const audits = await prisma.auditLog.findMany({
      where: { userId: user?.id ?? '', action: 'register-invited' },
    });
    const auditBlob = JSON.stringify(audits);
    const logBlob = captured.join('\n');

    check(
      '19. The password never reaches the audit record',
      !auditBlob.includes(PASSWORD),
    );
    check(
      '19b. The raw invitation token never reaches the audit record',
      !auditBlob.includes(raw),
    );
    check(
      '19c. The token hash never reaches the audit record',
      !auditBlob.includes(hashToken(raw)),
    );
    check(
      '19d. The password hash never reaches the audit record',
      user ? !auditBlob.includes(user.passwordHash) : false,
    );
    check(
      '19e. No JWT-shaped value reaches the audit record',
      !/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(auditBlob),
    );
    check(
      '19f. Neither the password nor the raw token reaches the logs',
      !logBlob.includes(PASSWORD) && !logBlob.includes(raw),
    );
  }

  // ===== G. The rate limit identifies a CLIENT, not the load balancer =====
  //
  // ThrottlerGuard keys on req.ip. Behind Cloud Run that is the front end's
  // address, identical for everybody. Measured before ProxyAwareThrottlerGuard
  // existed: after one client sent five registrations, an unrelated client
  // received HTTP 429 -- the 5/min limit was a cap on the entire product, and
  // any single actor could stop every real customer from signing up.
  {
    const noisy = newClient();
    const burn: number[] = [];
    // 21 attempts against a 20/min per-client budget: the last must be
    // rejected, proving the limit is enforced at all before the next assertion
    // proves it is scoped to one client.
    for (let i = 0; i < 21; i++) {
      const r = await register(
        {
          token: 'f'.repeat(64),
          email: `noise-${s}@example.invalid`,
          passwordPlain: PASSWORD,
          firstName: 'N',
          lastName: 'O',
        },
        noisy,
      );
      burn.push(r.status);
    }
    check(
      `20. A single client can exhaust its own budget (${burn.filter((c) => c === 429).length}/21 rejected)`,
      burn.includes(429),
    );

    const bystander = await register(
      {
        token: 'e'.repeat(64),
        email: `bystander-${s}@example.invalid`,
        passwordPlain: PASSWORD,
        firstName: 'B',
        lastName: 'Y',
      },
      newClient(),
    );
    check(
      `21. ...without locking out an unrelated client (got ${bystander.status})`,
      bystander.status !== 429,
    );
  }

  console.log('==========================================================');
  console.log(`📊 INVITED REGISTRATION SUITE: ${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(teardown);
