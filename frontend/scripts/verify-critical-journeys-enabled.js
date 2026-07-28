#!/usr/bin/env node
/**
 * Fails the build if a critical browser journey has been disabled.
 *
 * WHY THIS EXISTS. The invitation journeys shipped once as `test.fixme`, which
 * reports as "expected to fail" -- Playwright exits 0 and the summary line says
 * `2 skipped`. CI was green for a run in which the single most important user
 * journey in the product, a new teammate joining a workspace, was never
 * executed. The suite passing said nothing about whether the feature worked.
 *
 * `fixme` was the honest marker at the time; the dishonest part was that
 * nothing downstream could tell the difference between "green" and "green
 * because we turned the test off". This closes that gap: disabling a journey is
 * now a build failure rather than a quiet subtraction from coverage.
 *
 * `.only` is included for a different reason -- it does not disable one test,
 * it disables every OTHER test, which is the same failure wearing the opposite
 * mask.
 */
const fs = require('fs');
const path = require('path');

const E2E_DIR = path.join(__dirname, '..', 'e2e');

// Matches test.fixme / test.skip / test.only and the describe.* equivalents,
// including `test.describe.skip`. Deliberately NOT matching a bare `skip(` --
// `test.step` and unrelated identifiers would collide.
const DISABLERS = /\b(test|describe)(\.describe)?\.(fixme|skip|only)\s*\(/g;

const files = fs
  .readdirSync(E2E_DIR)
  .filter((f) => f.endsWith('.spec.ts'))
  .sort();

if (files.length === 0) {
  console.error(
    '❌ verify-critical-journeys: no *.spec.ts found in e2e/. The browser ' +
      'suite cannot be green by virtue of being empty.',
  );
  process.exit(1);
}

const findings = [];

for (const file of files) {
  const full = path.join(E2E_DIR, file);
  const lines = fs.readFileSync(full, 'utf8').split('\n');

  lines.forEach((line, i) => {
    // A commented-out line is documentation, not a disabled test.
    const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
    DISABLERS.lastIndex = 0;
    const match = DISABLERS.exec(code);
    if (match) {
      findings.push({
        file,
        line: i + 1,
        marker: match[0].replace(/\s*\($/, ''),
        text: line.trim().slice(0, 100),
      });
    }
  });
}

if (findings.length > 0) {
  console.error('❌ verify-critical-journeys: disabled browser journeys found.');
  console.error('');
  for (const f of findings) {
    console.error(`   e2e/${f.file}:${f.line}  ${f.marker}`);
    console.error(`     ${f.text}`);
  }
  console.error('');
  console.error(
    '   A browser journey may not be disabled on a branch that claims the',
  );
  console.error(
    '   feature works. Fix the journey, or delete it and say so in the PR --',
  );
  console.error('   do not leave it marked and counted as coverage.');
  process.exit(1);
}

console.log(
  `✅ verify-critical-journeys: ${files.length} spec file(s), no disabled journeys.`,
);
