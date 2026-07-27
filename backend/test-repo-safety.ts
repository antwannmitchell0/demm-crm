// T13 -- repository and destructive-test safety guarantees.
//
// This suite proves the fail-closed database guard, plus the T12R/T14R
// repository-hygiene outcomes so neither can silently regress.
//
// It deliberately runs NO destructive query. The policy engine is pure and is
// tested without a database or a credential; only the last group touches Git,
// read-only.
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  evaluateDatabasePolicy,
  DENIED_DATABASE_NAMES,
  formatRefusal,
} from './test-db-guard';

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

const REPO_ROOT = path.resolve(__dirname, '..');

function git(args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync('git', args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (e: any) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

async function main() {
  console.log('🧪 T13 REPOSITORY & DESTRUCTIVE-TEST SAFETY SUITE');
  console.log('==================================================');

  const OPT_IN = 'true';

  // ===== 1. The development database is refused, always =====
  const dev = evaluateDatabasePolicy({
    liveDatabase: 'demm_crm',
    urlDatabase: 'demm_crm',
    optIn: OPT_IN,
  });
  check(
    `1. The development database "demm_crm" is refused even WITH the opt-in (reason: ${dev.reason})`,
    dev.allowed === false,
  );
  check(
    '1b. "demm_crm" is on the explicit deny list, not merely unmatched',
    DENIED_DATABASE_NAMES.includes('demm_crm'),
  );

  // The restoration database from the T12 investigation ends in `_test` and
  // would otherwise pass the suffix rule. The PM ruled it must not be touched.
  const restoration = evaluateDatabasePolicy({
    liveDatabase: 'demm_crm_restoration_test',
    urlDatabase: 'demm_crm_restoration_test',
    optIn: OPT_IN,
  });
  check(
    '1c. "demm_crm_restoration_test" is refused despite ending in _test (explicitly denied)',
    restoration.allowed === false,
  );

  // ===== 2. Unknown names are refused =====
  for (const name of ['some_random_db', 'postgres', 'demm_os', 'demm_marketing']) {
    const r = evaluateDatabasePolicy({
      liveDatabase: name,
      urlDatabase: name,
      optIn: OPT_IN,
    });
    check(`2. Unrecognised database "${name}" is refused`, r.allowed === false);
  }

  // Other projects' databases on the same server end in _test but are NOT ours.
  for (const name of ['buckets_test', 'wtae_test']) {
    const r = evaluateDatabasePolicy({
      liveDatabase: name,
      urlDatabase: name,
      optIn: OPT_IN,
    });
    check(
      `2b. Foreign database "${name}" is refused despite the _test suffix (no demm_crm_ prefix)`,
      r.allowed === false,
    );
  }

  // ===== 3. A valid disposable name WITHOUT the opt-in is refused =====
  const noOptIn = evaluateDatabasePolicy({
    liveDatabase: 'demm_crm_ci',
    urlDatabase: 'demm_crm_ci',
    optIn: undefined,
  });
  check(
    `3. A valid disposable name is refused without ALLOW_DESTRUCTIVE_TESTS (reason: ${noOptIn.reason})`,
    noOptIn.allowed === false,
  );
  for (const bad of ['1', 'yes', 'TRUE', '', 'false']) {
    const r = evaluateDatabasePolicy({
      liveDatabase: 'demm_crm_ci',
      urlDatabase: 'demm_crm_ci',
      optIn: bad,
    });
    check(
      `3b. Opt-in value ${JSON.stringify(bad)} is not accepted (exact "true" required)`,
      r.allowed === false,
    );
  }
  // NODE_ENV must never be a substitute for verifying the database.
  const nodeEnvOnly = evaluateDatabasePolicy({
    liveDatabase: 'demm_crm',
    urlDatabase: 'demm_crm',
    optIn: undefined,
    nodeEnv: 'test',
  });
  check(
    '3c. NODE_ENV=test does NOT bypass the database check',
    nodeEnvOnly.allowed === false,
  );

  // ===== 4. Explicit opt-in + a valid disposable name is accepted =====
  for (const name of [
    'demm_crm_ci',
    'demm_crm_test',
    'demm_crm_verify',
    'demm_crm_verify_phase0_1785094249',
  ]) {
    const r = evaluateDatabasePolicy({
      liveDatabase: name,
      urlDatabase: name,
      optIn: OPT_IN,
    });
    check(
      `4. "${name}" is accepted with the explicit opt-in`,
      r.allowed === true,
    );
  }

  // ===== 5. URL name and live name cannot disagree =====
  const spoof = evaluateDatabasePolicy({
    liveDatabase: 'demm_crm', // what we are ACTUALLY connected to
    urlDatabase: 'demm_crm_ci', // what the URL claims
    optIn: OPT_IN,
  });
  check(
    `5. A URL claiming a safe name while connected to the dev database is refused (reason: ${spoof.reason})`,
    spoof.allowed === false,
  );
  const spoofReverse = evaluateDatabasePolicy({
    liveDatabase: 'demm_crm_ci',
    urlDatabase: 'demm_crm',
    optIn: OPT_IN,
  });
  check(
    '5b. Any live/URL database-name mismatch is refused, in either direction',
    spoofReverse.allowed === false,
  );
  check(
    '5c. The decision is driven by the LIVE name -- a matching pair on the dev database is still refused',
    evaluateDatabasePolicy({
      liveDatabase: 'demm_crm',
      urlDatabase: 'demm_crm',
      optIn: OPT_IN,
    }).allowed === false,
  );

  // ===== 6. The guard runs before any mutation, in every protected suite =====
  const GUARDED = [
    'verify-comprehensive.ts',
    'verify-http-staging.ts',
    'verify-scenarios.ts',
    'test-isolation.ts',
  ];
  /**
   * Reads a suite and returns the lines of its ENTRY FUNCTION body only, with
   * comments stripped.
   *
   * Both narrowings are necessary for the measurement to mean anything:
   *  - comments must go, or a comment that merely NAMES `createTestingModule`
   *    counts as a bootstrap;
   *  - helper functions declared above the entry point must go, or
   *    verify-http-staging's `teardownFixtures()` -- which by definition runs
   *    after the guard -- registers as a mutation occurring before it.
   * What we actually care about is the order of statements that execute when the
   * suite starts.
   */
  function entryBody(file: string): { lines: string[]; offset: number } {
    const stripped = fs
      .readFileSync(path.join(__dirname, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(?<!:)\/\/.*$/gm, '')
      .split('\n');
    const entry = stripped.findIndex((l) =>
      /^\s*async function (main|runScenarios)\s*\(/.test(l),
    );
    return { lines: stripped.slice(entry + 1), offset: entry + 1 };
  }

  for (const file of GUARDED) {
    const { lines } = entryBody(file);
    const guardLine = lines.findIndex((l) =>
      /assertDisposableTestDatabase\s*\(/.test(l),
    );
    const firstMutation = lines.findIndex((l) =>
      /\.(deleteMany|create|createMany|update|updateMany|upsert)\s*\(/.test(l),
    );
    check(
      `6. ${file}: the guard is the first thing the entry function does, ahead of any mutation (guard@${guardLine}, first mutation@${firstMutation})`,
      guardLine >= 0 && (firstMutation === -1 || guardLine < firstMutation),
    );
  }

  // verify-http-staging mutates through HTTP, so the guard must also precede
  // application bootstrap -- a Nest app opens a Prisma connection to whatever
  // database is configured before any test line runs.
  {
    const { lines } = entryBody('verify-http-staging.ts');
    const guardLine = lines.findIndex((l) =>
      /assertDisposableTestDatabase\s*\(/.test(l),
    );
    const bootstrap = lines.findIndex((l) =>
      /createTestingModule|createNestApplication/.test(l),
    );
    check(
      `6b. verify-http-staging.ts: guard@${guardLine} precedes app bootstrap@${bootstrap}`,
      guardLine >= 0 && bootstrap >= 0 && guardLine < bootstrap,
    );
  }

  // ===== 7. Refusal output carries the database name and NO credential =====
  const refusal = formatRefusal({
    allowed: false,
    liveDatabase: 'demm_crm',
    reason: 'DENIED_DATABASE',
  });
  check(
    '7. The refusal names the database it refused',
    refusal.includes('demm_crm'),
  );
  const CREDENTIAL_MARKERS = [
    'postgresql://',
    'postgres://',
    '@localhost',
    'password',
    'DATABASE_URL',
    ':5432',
  ];
  check(
    `7b. The refusal contains no connection string or credential marker`,
    CREDENTIAL_MARKERS.every(
      (m) => !refusal.toLowerCase().includes(m.toLowerCase()),
    ),
  );
  const guardSource = fs.readFileSync(
    path.join(__dirname, 'test-db-guard.ts'),
    'utf8',
  );
  check(
    '7c. The guard never prints DATABASE_URL itself',
    !/console\.[a-z]+\([^)]*DATABASE_URL/.test(guardSource) &&
      !/console\.[a-z]+\([^)]*connectionString/.test(guardSource),
  );

  // ===== 8. T12R: database archives are ignored =====
  for (const rel of ['backend/probe.dump', 'probe.pgdump', 'backend/x.backup']) {
    const abs = path.join(REPO_ROOT, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, '');
    const r = git(['check-ignore', '-q', rel]);
    fs.unlinkSync(abs);
    check(`8. ${rel} is ignored by Git`, r.code === 0);
  }
  check(
    '8b. The removed dump is absent from the working tree',
    !fs.existsSync(path.join(REPO_ROOT, 'backend/test_backup.dump')),
  );

  // ===== 9. Prisma migration SQL is still trackable =====
  const migrationsDir = path.join(REPO_ROOT, 'backend/prisma/migrations');
  const firstMigration = fs
    .readdirSync(migrationsDir)
    .filter((d) => fs.existsSync(path.join(migrationsDir, d, 'migration.sql')))
    .sort()[0];
  const migRel = `backend/prisma/migrations/${firstMigration}/migration.sql`;
  check(
    `9. ${migRel} is NOT ignored (no broad *.sql rule)`,
    git(['check-ignore', '-q', migRel]).code !== 0,
  );
  check(
    '9b. Migration SQL files are still tracked by Git',
    git(['ls-files', 'backend/prisma/migrations/*/migration.sql']).out.trim()
      .length > 0,
  );

  // ===== 10. T14R: Git health is clean =====
  const showRef = git(['show-ref']);
  check(
    '10. git show-ref reports no malformed ref',
    showRef.code === 0 && !/bad ref|fatal/i.test(showRef.out),
  );
  const forEach = git(['for-each-ref']);
  check(
    '10b. git for-each-ref emits no broken-name warning',
    !/broken name/i.test(forEach.out),
  );
  const logAll = git(['log', '--oneline', '--all', '-n', '1']);
  check(`10c. git log --all exits 0 (was 128)`, logAll.code === 0);
  const fsck = git(['fsck', '--full']);
  check(
    '10d. git fsck --full reports no bad-ref error',
    !/bad ref|invalid sha1 pointer/i.test(fsck.out),
  );
  check(
    '10e. Both malformed stash artifacts are gone',
    !fs.existsSync(path.join(REPO_ROOT, '.git/refs/stash 2')) &&
      !fs.existsSync(path.join(REPO_ROOT, '.git/logs/refs/stash 2')),
  );
  // The seven inert duplicates were explicitly out of scope.
  const dupes = git([
    'rev-parse',
    '--git-dir',
  ]).out.trim();
  const inert = [
    'index 2',
    'index 3',
    'index 4',
    'worktrees/phase-2-lead-to-client-core/AUTO_MERGE 2',
    'worktrees/phase-2-lead-to-client-core/AUTO_MERGE 3',
    'worktrees/phase-2-lead-to-client-core/index 2',
    'worktrees/phase-2-lead-to-client-core/index 3',
  ].filter((f) => fs.existsSync(path.join(REPO_ROOT, dupes, f)));
  check(
    `10f. The seven inert duplicate .git artifacts were retained (found ${inert.length})`,
    inert.length === 7,
  );

  console.log('==================================================');
  console.log(`📊 T13 SAFETY SUITE: ${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
