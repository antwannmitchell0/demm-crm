#!/usr/bin/env node
// Defense-in-depth companion to verify-production-config.js. That script
// only catches a missing/bad NEXT_PUBLIC_API_URL; it can't catch someone
// hardcoding a fresh "http://localhost:..." string somewhere else in
// source later. This scans the actual compiled output after `next build`
// for that exact regression, so it fails the build regardless of *how*
// localhost ended up embedded.
//
// Runs as an npm `postbuild` lifecycle script. Only enforced when
// NODE_ENV=production, matching verify-production-config.js.

const fs = require('fs');
const path = require('path');

const UNSAFE_URL_RE = /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?/gi;
const SCAN_DIRS = ['.next/standalone', '.next/static'];
const SCAN_EXTENSIONS = new Set(['.js', '.mjs', '.html']);

function fail(matches) {
  console.error('\n❌ PRODUCTION BUNDLE GUARD FAILED');
  console.error(
    '   Found a localhost/loopback URL embedded in the compiled production bundle:\n',
  );
  for (const m of matches.slice(0, 10)) {
    console.error(`   ${m.file}: ${m.match}`);
  }
  if (matches.length > 10) {
    console.error(`   ...and ${matches.length - 10} more.`);
  }
  console.error(
    '\n   This means a request from the deployed app would be silently sent to its own container instead of the real backend.\n',
  );
  process.exit(1);
}

function walk(dir, matches) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue; // vendor code may legitimately mention localhost in comments/docs
      walk(full, matches);
    } else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      const content = fs.readFileSync(full, 'utf8');
      const found = content.match(UNSAFE_URL_RE);
      if (found) {
        for (const match of found) {
          matches.push({ file: full, match });
        }
      }
    }
  }
}

function main() {
  if (process.env.NODE_ENV !== 'production') {
    console.log(
      'ℹ️  verify-no-localhost-in-bundle: not a production build -- skipping.',
    );
    return;
  }

  const matches = [];
  for (const dir of SCAN_DIRS) {
    walk(path.join(process.cwd(), dir), matches);
  }

  if (matches.length > 0) {
    fail(matches);
  }

  console.log(
    '✅ verify-no-localhost-in-bundle: no localhost/loopback URLs found in the compiled bundle.',
  );
}

main();
