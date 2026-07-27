// Constants only -- deliberately no imports.
//
// playwright.config.ts loads this at config-parse time, before any dependency
// is guaranteed installed or generated. Anything heavier here (a Prisma client,
// a database driver) fails the whole run before a single test is collected.
export const UAT_DB = 'demm_crm_uat_verify';
export const PG_USER = process.env.PGUSER || process.env.USER || 'postgres';
export const UAT_DATABASE_URL = `postgresql://${PG_USER}@localhost:5432/${UAT_DB}?schema=public`;

/** One password for every synthetic account. Never a real one. */
export const UAT_PASSWORD = 'Synthetic-UAT-Password-1!';
