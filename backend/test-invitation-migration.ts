// Phase 2 correction -- proof that the invitation migration preserves data.
//
// WHAT THIS EXISTS TO PROVE, AND WHY IT WAS WRITTEN
//
// The first draft of 20260727180000 ran `DELETE FROM "Invitation"`, justified by
// "no application code has ever created one" plus a claim that a plaintext token
// could not become a hash and stay verifiable.
//
// Both halves were wrong. "No application code creates them" does not exclude
// manual rows, seeds, staging fixtures, support-created records, or rows from a
// prior branch. And the verifiability claim ignored that the RECIPIENT holds the
// raw token: the server hashes whatever is presented at acceptance and compares
// it against the stored hash, so hashing the existing column in place preserves
// the invitation perfectly.
//
// This suite builds a database at the PRE-migration schema, puts real rows in
// it, migrates forward, and then accepts one of those rows over HTTP using the
// token issued before the migration existed. If the migration ever becomes
// destructive again, this fails.
//
// It also proves migrate-from-zero, so the same migration is correct on an
// empty database.
import 'dotenv/config';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { Client, Pool } from 'pg';
// Imported statically, not with `await import(...)`: under ts-node's nodenext
// resolution a dynamic import of an extensionless relative path is not hooked
// by the compiler and fails at runtime. Importing is inert -- nothing connects
// to a database until NestFactory.create() runs, which happens only after
// DATABASE_URL has been pointed at the disposable database below.
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './src/app.module';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

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

const sha256 = (v: string) =>
  crypto.createHash('sha256').update(v).digest('hex');

// Named with the `_verify` suffix the database guard recognises as disposable,
// so this can never be pointed at a real database even by accident.
const DB_MIGRATE = 'demm_crm_invitation_verify';
const DB_ZERO = 'demm_crm_zero_verify';
const USER = process.env.PGUSER || process.env.USER || 'postgres';
const HOST = process.env.PGHOST || 'localhost';
const PORT = process.env.PGPORT || '5432';

/**
 * Includes the password when one is configured.
 *
 * WHY THIS EXISTS. The first CI run of this suite HUNG -- not failed, hung --
 * for over twenty minutes until it was cancelled. A local developer's Postgres
 * trusts the socket, so no password is needed and the URL worked. CI's service
 * container requires one. `createdb` is an interactive libpq client: given no
 * password it prompts on stdin, and `sh()` below sets stdin to 'ignore', so
 * libpq waited forever for input that could never arrive.
 *
 * A missing password must produce a fast, readable failure -- never a hang.
 */
const AUTH = process.env.PGPASSWORD
  ? `${encodeURIComponent(USER)}:${encodeURIComponent(process.env.PGPASSWORD)}`
  : encodeURIComponent(USER);
const urlFor = (db: string) =>
  `postgresql://${AUTH}@${HOST}:${PORT}/${db}?schema=public`;

const MIGRATIONS_DIR = path.join(__dirname, 'prisma/migrations');
// Everything from this migration onward is held back while the "old world"
// database is seeded, then restored so it can be applied over real rows.
const HELD_BACK = [
  '20260727180000_invitation_token_hash_and_provenance',
  '20260727190000_approval_cancelled_status',
];
const PARKING = path.join(__dirname, '.migration-verify-parking');

function sh(cmd: string, args: string[], env: Record<string, string> = {}) {
  return execFileSync(cmd, args, {
    cwd: __dirname,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    // stdin stays closed on purpose: nothing here may be interactive. The
    // TIMEOUT is what makes that safe -- without it, a client that decides to
    // prompt blocks until the CI job's own limit, which is how this suite once
    // hung for twenty minutes instead of failing in seconds.
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
  });
}

function resetDb(db: string) {
  try {
    sh('dropdb', ['--if-exists', db]);
  } catch {
    /* nothing to drop */
  }
  sh('createdb', [db]);
}

function restoreHeldBackMigrations() {
  if (!fs.existsSync(PARKING)) return;
  for (const name of HELD_BACK) {
    const parked = path.join(PARKING, name);
    const home = path.join(MIGRATIONS_DIR, name);
    if (fs.existsSync(parked) && !fs.existsSync(home)) {
      fs.renameSync(parked, home);
    }
  }
  fs.rmSync(PARKING, { recursive: true, force: true });
}

async function main() {
  console.log('🧪 PHASE 2 INVITATION MIGRATION SUITE');
  console.log('==========================================================');

  // ===== PART 1: migrate-from-zero =====
  {
    resetDb(DB_ZERO);
    let ok = true;
    let detail = '';
    try {
      sh('npx', ['prisma', 'migrate', 'deploy'], {
        DATABASE_URL: urlFor(DB_ZERO),
      });
    } catch (e: any) {
      ok = false;
      detail = String(e?.stderr ?? e?.message ?? e).slice(0, 300);
    }
    check('1. Migration-from-zero succeeds on an empty database', ok, detail);

    const c = new Client({ connectionString: urlFor(DB_ZERO) });
    await c.connect();
    const cols = await c.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='Invitation'`,
    );
    const names = cols.rows.map((r) => r.column_name);
    check(
      `2. From zero, Invitation has tokenHash and NOT token (got ${names.sort().join(',')})`,
      names.includes('tokenHash') && !names.includes('token'),
    );
    const applied = await c.query(
      `SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`,
    );
    // Counted from the directory rather than hardcoded. The literal 13 here
    // broke the moment a migration was added -- a test that has to be edited
    // every time the schema evolves trains people to edit tests instead of
    // reading them.
    const onDisk = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory()).length;
    check(
      `3. Every migration on disk is recorded as applied (applied=${applied.rows[0].n}, on disk=${onDisk})`,
      applied.rows[0].n === onDisk,
    );
    await c.end();
  }

  // ===== PART 2: migrate-from-existing-data =====
  resetDb(DB_MIGRATE);

  // Hold back the two new migrations so the database lands at the OLD schema --
  // the one that still has a plaintext `token` column.
  fs.mkdirSync(PARKING, { recursive: true });
  for (const name of HELD_BACK) {
    fs.renameSync(path.join(MIGRATIONS_DIR, name), path.join(PARKING, name));
  }

  let rawPending = '';
  let rawExpired = '';
  let rawAccepted = '';
  let inviteeEmail = '';
  let orgId = '';
  let wsId = '';

  try {
    sh('npx', ['prisma', 'migrate', 'deploy'], {
      DATABASE_URL: urlFor(DB_MIGRATE),
    });

    const c = new Client({ connectionString: urlFor(DB_MIGRATE) });
    await c.connect();

    const oldCols = await c.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='Invitation'`,
    );
    const oldNames = oldCols.rows.map((r) => r.column_name);
    check(
      `4. Precondition: the database is at the OLD schema with a plaintext token column (got ${oldNames.sort().join(',')})`,
      oldNames.includes('token') && !oldNames.includes('tokenHash'),
    );

    // Fixtures written with raw SQL, because the Prisma client here is generated
    // from the NEW schema and cannot address the old `token` column at all.
    const suffix = Date.now();
    orgId = crypto.randomUUID();
    wsId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    inviteeEmail = `preexisting-${suffix}@example.invalid`;

    await c.query(
      `INSERT INTO "Organization" (id, name, "createdAt", "updatedAt") VALUES ($1,$2,now(),now())`,
      [orgId, `Migration Org ${suffix}`],
    );
    await c.query(
      `INSERT INTO "Workspace" (id, name, subdomain, "organizationId", "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,now(),now())`,
      [wsId, 'Migration WS', `migrate-${suffix}`, orgId],
    );
    await c.query(
      `INSERT INTO "User" (id, email, "passwordHash", "firstName", "lastName", "createdAt", "updatedAt")
       VALUES ($1,$2,'x','Pre','Existing',now(),now())`,
      [userId, inviteeEmail],
    );

    // Three rows in three lifecycle states. The old enum has PENDING /
    // ACCEPTED / EXPIRED and no REVOKED.
    rawPending = crypto.randomBytes(32).toString('hex');
    rawExpired = crypto.randomBytes(32).toString('hex');
    rawAccepted = crypto.randomBytes(32).toString('hex');

    const insertOld = (
      id: string,
      email: string,
      token: string,
      status: string,
      expires: string,
    ) =>
      c.query(
        `INSERT INTO "Invitation" (id, email, role, "workspaceId", "organizationId", token, status, "expiresAt", "createdAt")
         VALUES ($1,$2,'USER',$3,$4,$5,$6::"InvitationStatus",$7,now())`,
        [id, email, wsId, orgId, token, status, expires],
      );

    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const past = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    await insertOld(
      crypto.randomUUID(),
      inviteeEmail,
      rawPending,
      'PENDING',
      future,
    );
    await insertOld(
      crypto.randomUUID(),
      `exp-${suffix}@example.invalid`,
      rawExpired,
      'EXPIRED',
      past,
    );
    await insertOld(
      crypto.randomUUID(),
      `acc-${suffix}@example.invalid`,
      rawAccepted,
      'ACCEPTED',
      future,
    );

    const before = await c.query(`SELECT count(*)::int AS n FROM "Invitation"`);
    check(
      `5. Three pre-migration invitations exist (got ${before.rows[0].n})`,
      before.rows[0].n === 3,
    );
    await c.end();
  } finally {
    restoreHeldBackMigrations();
  }

  // Apply the migrations under test OVER the existing rows.
  let migrateOk = true;
  let migrateDetail = '';
  try {
    sh('npx', ['prisma', 'migrate', 'deploy'], {
      DATABASE_URL: urlFor(DB_MIGRATE),
    });
  } catch (e: any) {
    migrateOk = false;
    migrateDetail = String(e?.stderr ?? e?.message ?? e).slice(0, 400);
  }
  check(
    '6. The migration applies cleanly over existing data',
    migrateOk,
    migrateDetail,
  );

  {
    const c = new Client({ connectionString: urlFor(DB_MIGRATE) });
    await c.connect();

    const after = await c.query(`SELECT count(*)::int AS n FROM "Invitation"`);
    check(
      `7. ALL THREE ROWS SURVIVE the migration (got ${after.rows[0].n}, expected 3)`,
      after.rows[0].n === 3,
    );

    const cols = await c.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='Invitation'`,
    );
    const names = cols.rows.map((r) => r.column_name);
    check('8. The plaintext token column is gone', !names.includes('token'));
    check('9. tokenHash exists', names.includes('tokenHash'));
    check(
      '10. Provenance columns exist',
      ['invitedById', 'acceptedById', 'acceptedAt'].every((n) =>
        names.includes(n),
      ),
    );

    const notNull = await c.query(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_name='Invitation' AND column_name='tokenHash'`,
    );
    check('11. tokenHash is NOT NULL', notNull.rows[0]?.is_nullable === 'NO');

    // The point of the whole exercise: the stored hash must equal the hash the
    // APPLICATION computes from the token the recipient already holds.
    const hashes = await c.query(
      `SELECT "tokenHash", status::text AS status FROM "Invitation" ORDER BY "createdAt"`,
    );
    const stored = hashes.rows.map((r) => r.tokenHash);
    check(
      '12. The backfilled hash of the PENDING row matches the application hash of its original token',
      stored.includes(sha256(rawPending)),
    );
    check(
      '13. The EXPIRED row was hashed too -- no row is skipped',
      stored.includes(sha256(rawExpired)),
    );
    check(
      '14. The ACCEPTED row was hashed too',
      stored.includes(sha256(rawAccepted)),
    );
    check(
      '15. No stored value is a raw token',
      !stored.some((h: string) =>
        [rawPending, rawExpired, rawAccepted].includes(h),
      ),
    );
    check(
      '16. Every hash is 64 hex characters',
      stored.every((h: string) => /^[0-9a-f]{64}$/.test(h)),
    );

    const uniq = await c.query(
      `SELECT indexname FROM pg_indexes WHERE tablename='Invitation'`,
    );
    const idx = uniq.rows.map((r) => r.indexname);
    check(
      `17. The unique constraint on tokenHash exists (got ${idx.join(', ')})`,
      idx.includes('Invitation_tokenHash_key'),
    );

    // Uniqueness must actually be enforced, not merely declared.
    let rejected = false;
    try {
      await c.query(
        `INSERT INTO "Invitation" (id, email, role, "workspaceId", "organizationId", "tokenHash", status, "expiresAt", "createdAt")
         VALUES ($1,'dupe@example.invalid','USER',$2,$3,$4,'PENDING',now(),now())`,
        [crypto.randomUUID(), wsId, orgId, sha256(rawPending)],
      );
    } catch {
      rejected = true;
    }
    check('18. A duplicate tokenHash is rejected by the database', rejected);

    const revokedOk = await c
      .query(`SELECT 'REVOKED'::"InvitationStatus" AS v`)
      .then(() => true)
      .catch(() => false);
    check('19. The REVOKED status value exists after migration', revokedOk);

    await c.end();
  }

  // ===== PART 3: an invitation issued BEFORE the migration still works =====
  //
  // The decisive test. Boot the real application against the migrated database
  // and accept the PENDING invitation using the token generated under the old
  // schema. If the migration were destructive, or the hash did not match, this
  // is the assertion that fails.
  {
    // Set BEFORE the application is constructed. PrismaService reads
    // DATABASE_URL when it is instantiated, which happens inside
    // NestFactory.create -- not at import time.
    process.env.DATABASE_URL = urlFor(DB_MIGRATE);

    const app = await NestFactory.create(AppModule, { logger: false });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.listen(0);
    check('20. The application boots against the migrated database', true);

    const base = `http://127.0.0.1:${(app.getHttpServer().address() as any).port}`;
    const prisma = new PrismaClient({
      adapter: new PrismaPg(new Pool({ connectionString: urlFor(DB_MIGRATE) })),
    });

    const invitee = await prisma.user.findUnique({
      where: { email: inviteeEmail },
    });
    const token = jwt.sign(
      { sub: invitee!.id, email: invitee!.email },
      process.env.JWT_SECRET!,
      { expiresIn: '15m' },
    );

    const res = await fetch(`${base}/team/invitations/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ token: rawPending }),
    });
    check(
      `21. AN INVITATION ISSUED BEFORE THE MIGRATION IS STILL ACCEPTABLE AFTER IT (got ${res.status})`,
      res.status === 201,
    );

    const membership = await prisma.membership.findFirst({
      where: { userId: invitee!.id, workspaceId: wsId },
    });
    check('22. Accepting it created the membership', !!membership);

    const row = await prisma.invitation.findFirst({
      where: { email: inviteeEmail },
    });
    check(
      '23. The pre-existing invitation is now ACCEPTED',
      row?.status === 'ACCEPTED',
    );
    check(
      '24. Acceptance recorded who accepted and when',
      row?.acceptedById === invitee!.id && !!row?.acceptedAt,
    );

    await prisma.$disconnect().catch(() => undefined);
    await app.close().catch(() => undefined);
  }

  console.log('==========================================================');
  console.log(`📊 INVITATION MIGRATION SUITE: ${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    // The parking directory must never be left behind: a missing migration
    // folder would silently change what `migrate deploy` does everywhere else.
    restoreHeldBackMigrations();
    for (const db of [DB_MIGRATE, DB_ZERO]) {
      try {
        sh('dropdb', ['--if-exists', db]);
      } catch {
        /* best effort */
      }
    }
  });
