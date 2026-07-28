// Phase 0C-R -- atomic refresh-token rotation.
//
// THE DEFECT THIS EXISTS TO CATCH
//
// refreshToken() read the row, checked `revoked`, then wrote `revoked = true`
// as a separate unconditional UPDATE keyed only on `id`. Two requests carrying
// the SAME valid token could both pass the read (both saw revoked=false), both
// "succeed" at the write, and both go on to mint a session. That produces two
// live refresh tokens from one, and neither request trips replay detection
// because neither ever observed a revoked row.
//
// The fix is a conditional claim -- UPDATE ... WHERE id = ? AND revoked = false
// -- so exactly one caller can win. This suite proves the invariant against a
// real PostgreSQL instance with genuinely concurrent calls; a mock cannot
// exhibit the race.
import 'dotenv/config';
import { Role } from '@prisma/client';
import { PrismaService } from './src/prisma.service';
import { AuthService } from './src/modules/auth/auth.service';
import { JwtService } from '@nestjs/jwt';
import { assertDisposableTestDatabase } from './test-db-guard';
import * as crypto from 'crypto';

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

const prisma = new PrismaService();
const jwtService = new JwtService({ secret: process.env.JWT_SECRET! });
const authService = new AuthService(prisma, jwtService);

const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

// Fixtures were originally keyed on the block name alone (`conc-race`), and
// nothing was ever deleted. That is invisible on CI, where the database is
// created and destroyed with the job, but it meant a second local run collided
// on Workspace.subdomain and the suite could only ever be run once against a
// given database. Every fixture is now run-scoped and removed in teardown.
const RUN = `${process.pid}-${Math.floor(process.uptime() * 1e6)}`;
const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

/** Creates an isolated org/workspace/user/membership and returns the ids. */
async function seedAccount(tag: string) {
  const org = await prisma.organization.create({
    data: { name: `Concurrency Org ${tag} ${RUN}` },
  });
  createdOrgIds.push(org.id);
  const workspace = await prisma.workspace.create({
    data: {
      name: `Concurrency WS ${tag}`,
      subdomain: `conc-${tag}-${RUN}`,
      organizationId: org.id,
    },
  });
  const user = await prisma.user.create({
    data: {
      email: `conc-${tag}-${RUN}@example.invalid`,
      passwordHash: 'not-a-real-hash',
      firstName: 'Conc',
      lastName: tag,
    },
  });
  createdUserIds.push(user.id);
  await prisma.membership.create({
    data: {
      userId: user.id,
      organizationId: org.id,
      workspaceId: workspace.id,
      role: Role.ORG_OWNER,
      permissions: ['*'],
    },
  });
  return { orgId: org.id, workspaceId: workspace.id, userId: user.id };
}

/** Issues one live refresh token row and returns the RAW token. */
async function issueRawToken(
  userId: string,
  workspaceId: string,
  opts: { expiresAt?: Date; revoked?: boolean } = {},
) {
  const raw = crypto.randomBytes(40).toString('hex');
  await prisma.refreshToken.create({
    data: {
      hashedToken: hash(raw),
      userId,
      workspaceId,
      expiresAt: opts.expiresAt ?? new Date(Date.now() + 7 * 24 * 3600 * 1000),
      revoked: opts.revoked ?? false,
    },
  });
  return raw;
}

async function settle<T>(p: Promise<T>) {
  try {
    return { ok: true as const, value: await p };
  } catch (e: any) {
    return { ok: false as const, message: e?.message ?? String(e) };
  }
}

async function main() {
  // Guard FIRST -- this suite writes fixtures.
  await assertDisposableTestDatabase('test-refresh-concurrency.ts');

  console.log('🧪 PHASE 0C-R ATOMIC REFRESH ROTATION SUITE');
  console.log('==========================================================');

  const CONCURRENCY = 8;

  // ===== 1. THE RACE: N concurrent refreshes of one valid token =====
  {
    const acct = await seedAccount('race');
    const raw = await issueRawToken(acct.userId, acct.workspaceId);

    const before = await prisma.refreshToken.count({
      where: { userId: acct.userId },
    });

    // Genuinely concurrent -- all dispatched before any awaits resolve.
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        settle(authService.refreshToken(raw)),
      ),
    );

    const winners = results.filter((r) => r.ok);
    const losers = results.filter((r) => !r.ok);

    check(
      `1. Exactly ONE of ${CONCURRENCY} concurrent refreshes succeeds (observed ${winners.length})`,
      winners.length === 1,
    );
    check(
      `2. Every other concurrent caller is refused (observed ${losers.length}/${CONCURRENCY - 1})`,
      losers.length === CONCURRENCY - 1,
    );

    const after = await prisma.refreshToken.count({
      where: { userId: acct.userId },
    });
    check(
      `3. Exactly ONE replacement token row is created (before=${before}, after=${after})`,
      after - before === 1,
    );

    const live = await prisma.refreshToken.count({
      where: { userId: acct.userId, revoked: false },
    });
    check(
      `4. Exactly one UNREVOKED token remains for the account (observed ${live})`,
      live === 1,
    );

    // The winner's token must be the surviving one.
    const winnerToken = (winners[0] as any)?.value?.refresh_token as
      | string
      | undefined;
    const survivor = await prisma.refreshToken.findFirst({
      where: { userId: acct.userId, revoked: false },
    });
    check(
      '5. The surviving unrevoked token belongs to the winning request',
      !!winnerToken && !!survivor && survivor.hashedToken === hash(winnerToken),
    );

    check(
      '6. Losing requests leak no oracle -- identical generic message',
      losers.every((l) => l.message === 'Invalid or expired refresh token'),
    );
  }

  // ===== 2. Unknown token revokes nobody =====
  {
    const acct = await seedAccount('unknown');
    await issueRawToken(acct.userId, acct.workspaceId);
    const liveBefore = await prisma.refreshToken.count({
      where: { userId: acct.userId, revoked: false },
    });

    const r = await settle(
      authService.refreshToken(crypto.randomBytes(40).toString('hex')),
    );
    const liveAfter = await prisma.refreshToken.count({
      where: { userId: acct.userId, revoked: false },
    });

    check('7. An unknown token is refused', !r.ok);
    check(
      `8. An unknown token revokes NOBODY (live ${liveBefore} -> ${liveAfter})`,
      liveBefore === liveAfter,
    );
  }

  // ===== 3. Expired token is lifecycle, not theft =====
  {
    const acct = await seedAccount('expired');
    const expired = await issueRawToken(acct.userId, acct.workspaceId, {
      expiresAt: new Date(Date.now() - 1000),
    });
    await issueRawToken(acct.userId, acct.workspaceId); // a healthy sibling

    const r = await settle(authService.refreshToken(expired));
    const liveAfter = await prisma.refreshToken.count({
      where: { userId: acct.userId, revoked: false },
    });

    check('9. An expired token is refused', !r.ok);
    // Both rows are still `revoked = false` -- one is merely past its expiry.
    // The point is that NOTHING was revoked: an ordinary lifecycle end must not
    // be treated as evidence of theft.
    check(
      `10. An expired token does NOT trigger the theft response -- nothing is revoked (unrevoked=${liveAfter}, expected 2)`,
      liveAfter === 2,
    );
  }

  // ===== 4. Genuine replay (already-revoked) still revokes the family =====
  {
    const acct = await seedAccount('replay');
    const replayed = await issueRawToken(acct.userId, acct.workspaceId, {
      revoked: true,
    });
    await issueRawToken(acct.userId, acct.workspaceId);
    await issueRawToken(acct.userId, acct.workspaceId);

    const r = await settle(authService.refreshToken(replayed));
    const liveAfter = await prisma.refreshToken.count({
      where: { userId: acct.userId, revoked: false },
    });

    check('11. A replayed rotated token is refused', !r.ok);
    check(
      `12. A genuine replay still revokes the whole family (live after = ${liveAfter})`,
      liveAfter === 0,
    );
  }

  // ===== 5. Blast radius: other users are never affected =====
  {
    const victim = await seedAccount('victim');
    await issueRawToken(victim.userId, victim.workspaceId);
    await issueRawToken(victim.userId, victim.workspaceId);

    const attacker = await seedAccount('attacker');
    const stolen = await issueRawToken(
      attacker.userId,
      attacker.workspaceId,
      { revoked: true },
    );
    await settle(authService.refreshToken(stolen)); // triggers family revocation

    const victimLive = await prisma.refreshToken.count({
      where: { userId: victim.userId, revoked: false },
    });
    check(
      `13. Revocation is user-scoped -- an unrelated account keeps both tokens (live=${victimLive})`,
      victimLive === 2,
    );
  }

  // ===== 6. Membership is re-verified at refresh time =====
  {
    const acct = await seedAccount('membership');
    const raw = await issueRawToken(acct.userId, acct.workspaceId);

    // Access revoked after the token was issued.
    await prisma.membership.deleteMany({ where: { userId: acct.userId } });

    const r = await settle(authService.refreshToken(raw));
    check('14. A removed membership prevents refresh issuance', !r.ok);
    check(
      `15. That refusal is non-oracular -- same generic message as any other failure (got "${!r.ok ? r.message : ''}")`,
      !r.ok && r.message === 'Invalid or expired refresh token',
    );
  }

  // ===== 7. Sequential rotation still works (no regression) =====
  {
    const acct = await seedAccount('sequential');
    let raw = await issueRawToken(acct.userId, acct.workspaceId);
    let ok = true;
    for (let i = 0; i < 3; i++) {
      const r = await settle(authService.refreshToken(raw));
      if (!r.ok) {
        ok = false;
        break;
      }
      raw = (r.value as any).refresh_token;
    }
    const live = await prisma.refreshToken.count({
      where: { userId: acct.userId, revoked: false },
    });
    check('16. Normal sequential rotation still succeeds three times', ok);
    check(
      `17. Sequential rotation leaves exactly one live token (observed ${live})`,
      live === 1,
    );
  }

  // ===== 8. No secret material in what we log =====
  {
    const acct = await seedAccount('logging');
    const raw = await issueRawToken(acct.userId, acct.workspaceId);
    const captured: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...a: unknown[]) => captured.push(a.join(' '));
    console.error = (...a: unknown[]) => captured.push(a.join(' '));
    try {
      await settle(authService.refreshToken(raw));
      await settle(authService.refreshToken(raw)); // force the replay path too
    } finally {
      console.log = origLog;
      console.error = origErr;
    }
    const blob = captured.join('\n');
    check(
      '18. Neither the raw token nor its hash is ever logged',
      !blob.includes(raw) && !blob.includes(hash(raw)),
    );
  }

  console.log('==========================================================');
  console.log(`📊 ATOMIC REFRESH SUITE: ${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exitCode = 1;
}

/**
 * Removes every fixture this run created, so the suite is re-runnable against
 * the same database. RefreshToken and Membership are deleted explicitly:
 * Organization cascades to Workspace, but these rows hang off User.
 */
async function teardown() {
  try {
    await prisma.refreshToken.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await prisma.membership.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.organization.deleteMany({
      where: { id: { in: createdOrgIds } },
    });
  } catch {
    // Teardown must never mask a real result.
  }
  await prisma.$disconnect().catch(() => undefined);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(teardown);
