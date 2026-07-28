// Creates the disposable UAT database, migrates it, and seeds it.
//
// Runs BEFORE Playwright starts the web servers, so both boot against a
// database that already has the right shape and fixtures.
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { seed, UAT_DB, UAT_DATABASE_URL } from './seed';

const BACKEND = path.join(__dirname, '../../backend');

export default async function globalSetup() {
  // Refuse loudly rather than quietly reusing a database with the wrong name.
  // The `_verify` suffix is what backend/test-db-guard.ts recognises as
  // disposable; anything else must never be touched by this harness.
  if (!UAT_DB.startsWith('demm_crm') || !UAT_DB.endsWith('_verify')) {
    throw new Error(`Refusing: "${UAT_DB}" is not a recognised disposable database name.`);
  }

  const run = (cmd: string, args: string[], env: Record<string, string> = {}) =>
    execFileSync(cmd, args, {
      cwd: BACKEND,
      env: { ...process.env, ...env },
      encoding: 'utf8',
      // stdin closed on purpose -- nothing here may be interactive. The TIMEOUT
      // is what makes that safe: without it a client that decides to prompt
      // blocks until the CI job's own limit instead of failing in seconds.
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    });

  try {
    run('dropdb', ['--if-exists', UAT_DB]);
  } catch {
    /* nothing to drop */
  }
  run('createdb', [UAT_DB]);
  run('npx', ['prisma', 'migrate', 'deploy'], { DATABASE_URL: UAT_DATABASE_URL });

  const fixtures = await seed();

  // Handed to the specs through a file rather than an env var, because the
  // web servers are started by Playwright after this returns and inherit the
  // parent environment as it was.
  fs.mkdirSync(path.join(__dirname, '../e2e-results'), { recursive: true });
  fs.writeFileSync(
    path.join(__dirname, '../e2e-results/fixtures.json'),
    JSON.stringify(fixtures, null, 2),
  );
  console.log(`[uat] seeded run ${fixtures.runId} into ${UAT_DB}`);
}
