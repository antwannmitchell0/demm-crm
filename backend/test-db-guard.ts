/**
 * Fail-closed database guard for destructive backend suites (T13).
 *
 * WHY THIS EXISTS
 *
 * Two backend suites can destroy or pollute whatever database they are pointed
 * at, and neither asked permission first:
 *
 *  - `verify-comprehensive.ts` opens with 21 unscoped `deleteMany()` calls
 *    across the whole schema. Pointed at the development database it wipes it.
 *  - `verify-http-staging.ts` registers users and workspaces over real HTTP and
 *    has no teardown at all, so every run leaves fixtures behind.
 *
 * `verify-scenarios.ts` (19 unscoped deletes) and `test-isolation.ts` (17) are
 * in the same category. The T3.3 incident is what this prevents: real converted
 * client records were lost from a development database, and no recovery source
 * existed.
 *
 * THE CONTROL
 *
 * Two independent conditions, BOTH required:
 *   1. The LIVE database -- from `SELECT current_database()`, not from parsing a
 *      URL -- must match a strict DEMM-CRM disposable naming policy.
 *   2. `ALLOW_DESTRUCTIVE_TESTS=true` must be set explicitly.
 *
 * Plus a deny list that overrides everything, and a live-vs-URL consistency
 * check so a safe-looking URL cannot mask a connection to something real.
 *
 * WHY NOT `prisma migrate status`: it reports whether the migrations this
 * repository knows about have been applied. It does NOT detect extra migrations
 * that were applied from elsewhere (verified during T3.1: a database carrying
 * two unmerged branch migrations still reported "up to date"), and it says
 * nothing whatsoever about whether the target is safe to destroy. It is a
 * deployment check, not a safety check. The live name comparison below is the
 * safety control.
 *
 * WHY NOT `NODE_ENV=test`: it is a process-local string with no relationship to
 * the database actually connected. It can be exported in a shell that is still
 * pointed at development. It is deliberately not accepted as a bypass.
 *
 * NOTHING here logs a connection string, a password, or `DATABASE_URL`.
 */
import 'dotenv/config';
import { Client } from 'pg';

/**
 * Names that may never be used for a destructive suite, whatever else matches.
 *
 * `demm_crm_restoration_test` is here deliberately: it ends in `_test` and would
 * otherwise satisfy the suffix rule, but it holds the restored contents of the
 * archive T12 removed and the Product Manager ruled it must not be touched.
 */
export const DENIED_DATABASE_NAMES: string[] = [
  'demm_crm', // development
  'demm_crm_restoration_test', // T12 restoration copy -- do not touch
  'postgres', // maintenance database
  ...['STAGING_DATABASE_NAME', 'PRODUCTION_DATABASE_NAME', 'PROD_DATABASE_NAME']
    .map((k) => process.env[k])
    .filter((v): v is string => typeof v === 'string' && v.trim() !== ''),
];

/**
 * A disposable database must be recognisably ours AND recognisably throwaway.
 *
 * The prefix requirement is not cosmetic: this PostgreSQL server also hosts
 * `buckets_test` and `wtae_test`, which belong to other projects and end in
 * `_test`. A suffix-only policy would happily wipe them.
 */
const REQUIRED_PREFIX = 'demm_crm_';
const DISPOSABLE_SUFFIXES = ['_test', '_verify', '_ci'];
const DISPOSABLE_INFIXES = ['_verify_', '_ci_', '_test_'];

export const OPT_IN_ENV_VAR = 'ALLOW_DESTRUCTIVE_TESTS';

export type RefusalReason =
  | 'DENIED_DATABASE'
  | 'NAME_NOT_DISPOSABLE'
  | 'MISSING_OPT_IN'
  | 'LIVE_URL_MISMATCH'
  | 'UNKNOWN_LIVE_DATABASE';

export interface PolicyInput {
  /** From `SELECT current_database()`. The authority. */
  liveDatabase: string;
  /** Parsed from the configured URL, for consistency checking only. */
  urlDatabase?: string;
  /** Raw value of ALLOW_DESTRUCTIVE_TESTS. */
  optIn: string | undefined;
  /** Accepted only to prove it grants nothing. */
  nodeEnv?: string;
}

export interface PolicyResult {
  allowed: boolean;
  liveDatabase: string;
  reason?: RefusalReason;
}

function looksDisposable(name: string): boolean {
  if (!name.startsWith(REQUIRED_PREFIX)) return false;
  if (DISPOSABLE_SUFFIXES.some((s) => name.endsWith(s))) return true;
  return DISPOSABLE_INFIXES.some((i) => name.includes(i));
}

/**
 * Pure policy decision. No database, no environment mutation, no credentials --
 * which is what makes it testable in full without a server.
 *
 * Evaluation order is deliberate: the deny list is consulted first so that no
 * later rule, and no future naming convention, can re-admit a protected
 * database.
 */
export function evaluateDatabasePolicy(input: PolicyInput): PolicyResult {
  const live = (input.liveDatabase ?? '').trim();

  if (live === '') {
    return {
      allowed: false,
      liveDatabase: live,
      reason: 'UNKNOWN_LIVE_DATABASE',
    };
  }

  // 1. Deny list wins over everything, including the opt-in.
  if (DENIED_DATABASE_NAMES.includes(live)) {
    return { allowed: false, liveDatabase: live, reason: 'DENIED_DATABASE' };
  }

  // 2. The URL must describe the database we are actually on. A mismatch means
  //    the configuration cannot be trusted to say where writes will land.
  if (
    typeof input.urlDatabase === 'string' &&
    input.urlDatabase.trim() !== '' &&
    input.urlDatabase.trim() !== live
  ) {
    return { allowed: false, liveDatabase: live, reason: 'LIVE_URL_MISMATCH' };
  }

  // 3. Naming policy, applied to the LIVE name.
  if (!looksDisposable(live)) {
    return {
      allowed: false,
      liveDatabase: live,
      reason: 'NAME_NOT_DISPOSABLE',
    };
  }

  // 4. Explicit, exact opt-in. `NODE_ENV` is intentionally never consulted.
  if (input.optIn !== 'true') {
    return { allowed: false, liveDatabase: live, reason: 'MISSING_OPT_IN' };
  }

  return { allowed: true, liveDatabase: live };
}

const REASON_TEXT: Record<RefusalReason, string> = {
  DENIED_DATABASE:
    'this database is on the protected deny list and may never be used for destructive tests',
  NAME_NOT_DISPOSABLE: `this name is not a recognised DEMM CRM disposable database (needs the "${REQUIRED_PREFIX}" prefix plus one of ${DISPOSABLE_SUFFIXES.join(', ')})`,
  MISSING_OPT_IN: `${OPT_IN_ENV_VAR}=true was not set, so destructive tests are not authorised`,
  LIVE_URL_MISMATCH:
    'the configured database name does not match the database actually connected, so the target cannot be trusted',
  UNKNOWN_LIVE_DATABASE:
    'the live database name could not be determined, so safety cannot be established',
};

/**
 * Human-readable refusal. Prints the database NAME only -- never the host, the
 * port, the user, the password, or the URL.
 */
export function formatRefusal(result: PolicyResult): string {
  const reason = result.reason
    ? REASON_TEXT[result.reason]
    : 'the safety policy was not satisfied';
  return [
    '',
    '=========================================================================',
    ' REFUSING TO RUN: destructive test blocked before any data was touched.',
    '=========================================================================',
    `  connected database : ${result.liveDatabase || '(unknown)'}`,
    `  refusal reason     : ${result.reason ?? 'POLICY'}`,
    `  explanation        : ${reason}`,
    '',
    '  To run this suite, create a throwaway database whose name starts with',
    `  "${REQUIRED_PREFIX}" and ends with ${DISPOSABLE_SUFFIXES.join(' / ')}, point this process at`,
    `  it, and set ${OPT_IN_ENV_VAR}=true.`,
    '=========================================================================',
    '',
  ].join('\n');
}

/** Extracts just the database name from the configured URL. Never logged. */
function urlDatabaseName(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    const name = parsed.pathname.replace(/^\//, '');
    return name === '' ? undefined : name;
  } catch {
    return undefined;
  }
}

/**
 * THE ENTRY POINT for destructive suites. Call this first -- before Nest
 * bootstrap, before Prisma client construction, before any fixture write.
 *
 * Opens its own short-lived connection so the decision cannot be affected by
 * application state, asks the server what database it is on, applies the
 * policy, and calls `process.exit(1)` on refusal. It returns only when the
 * target is provably a disposable DEMM CRM database and the operator has opted
 * in explicitly.
 */
export async function assertDisposableTestDatabase(
  suiteName: string,
): Promise<string> {
  if (!process.env.DATABASE_URL) {
    console.error(
      formatRefusal({
        allowed: false,
        liveDatabase: '',
        reason: 'UNKNOWN_LIVE_DATABASE',
      }),
    );
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  let live = '';
  try {
    await client.connect();
    const result = await client.query<{ d: string }>(
      'SELECT current_database() AS d',
    );
    live = result.rows[0]?.d ?? '';
  } catch (error: unknown) {
    // Only the message, and only after stripping anything URL-shaped: a pg
    // connection error can echo host and user details.
    const message =
      error instanceof Error ? error.message : 'connection failed';
    console.error(
      formatRefusal({
        allowed: false,
        liveDatabase: '',
        reason: 'UNKNOWN_LIVE_DATABASE',
      }),
    );
    console.error(
      `  (could not query the database: ${message.replace(/postgres(ql)?:\/\/\S+/gi, '[redacted]')})`,
    );
    process.exit(1);
  } finally {
    await client.end().catch(() => undefined);
  }

  const decision = evaluateDatabasePolicy({
    liveDatabase: live,
    urlDatabase: urlDatabaseName(),
    optIn: process.env[OPT_IN_ENV_VAR],
  });

  if (!decision.allowed) {
    console.error(formatRefusal(decision));
    console.error(`  suite refused: ${suiteName}`);
    process.exit(1);
  }

  console.log(
    `[db-guard] ${suiteName}: destructive run authorised against disposable database "${live}".`,
  );
  return live;
}
