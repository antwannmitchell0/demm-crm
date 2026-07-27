// Constants only -- deliberately no imports.
//
// playwright.config.ts loads this at config-parse time, before any dependency
// is guaranteed installed or generated. Anything heavier here (a Prisma client,
// a database driver) fails the whole run before a single test is collected.
export const UAT_DB = 'demm_crm_uat_verify';
export const PG_USER = process.env.PGUSER || process.env.USER || 'postgres';
const PG_HOST = process.env.PGHOST || 'localhost';
const PG_PORT = process.env.PGPORT || '5432';

/**
 * Carries the password when one is configured.
 *
 * A developer's local Postgres trusts the socket, so a password-less URL works
 * and this harness passed locally. CI's service container requires one, and
 * `createdb` is an interactive libpq client: with no password it prompts on
 * stdin, which global-setup closes -- so it would hang rather than fail. That
 * exact mistake cost a twenty-minute CI job in the backend migration suite; it
 * is not repeated here.
 */
const PG_AUTH = process.env.PGPASSWORD
  ? `${encodeURIComponent(PG_USER)}:${encodeURIComponent(process.env.PGPASSWORD)}`
  : encodeURIComponent(PG_USER);

export const UAT_DATABASE_URL = `postgresql://${PG_AUTH}@${PG_HOST}:${PG_PORT}/${UAT_DB}?schema=public`;

/** One password for every synthetic account. Never a real one. */
export const UAT_PASSWORD = 'Synthetic-UAT-Password-1!';
