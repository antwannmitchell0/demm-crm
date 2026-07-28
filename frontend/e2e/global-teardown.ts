// Removes the run's fixtures and drops the disposable database.
//
// Best effort by design: a teardown failure must never mask a real test result,
// and the database is recreated from scratch by global-setup on the next run.
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { teardown, UAT_DB } from './seed';

export default async function globalTeardown() {
  const fixturesPath = path.join(__dirname, '../e2e-results/fixtures.json');
  if (fs.existsSync(fixturesPath)) {
    try {
      const { runId } = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
      await teardown(runId);
    } catch {
      /* the drop below is the real cleanup */
    }
  }
  if (process.env.UAT_KEEP_DB === '1') {
    console.log(`[uat] keeping ${UAT_DB} for inspection (UAT_KEEP_DB=1)`);
    return;
  }
  try {
    execFileSync('dropdb', ['--if-exists', UAT_DB], { stdio: 'ignore' });
  } catch {
    /* best effort */
  }
}
