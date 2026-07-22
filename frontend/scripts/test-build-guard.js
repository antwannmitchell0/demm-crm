#!/usr/bin/env node
// Standalone test runner for the two production build guards (this repo
// has no test framework installed for the frontend -- consistent with the
// backend's own pattern of plain Node/ts-node test scripts rather than
// Jest). Run with: npm run test:build-guard

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

let pass = 0;
let fail = 0;
function check(label, condition) {
  if (condition) {
    console.log(`✅ [PASS] ${label}`);
    pass++;
  } else {
    console.log(`❌ [FAIL] ${label}`);
    fail++;
  }
}

function runGuard(env) {
  return spawnSync(
    process.execPath,
    [path.join(__dirname, 'verify-production-config.js')],
    { env: { ...process.env, ...env }, encoding: 'utf8' },
  );
}

console.log('🧪 STARTING PRODUCTION BUILD GUARD TEST SUITE');
console.log('===============================================');

// --- verify-production-config.js ---

{
  const res = runGuard({ NODE_ENV: 'development', NEXT_PUBLIC_API_URL: '' });
  check('Non-production NODE_ENV skips checks entirely (exit 0)', res.status === 0);
}

{
  const res = runGuard({ NODE_ENV: 'production', NEXT_PUBLIC_API_URL: '' });
  check('Production build with MISSING NEXT_PUBLIC_API_URL fails (exit 1)', res.status === 1);
}

{
  const res = runGuard({ NODE_ENV: 'production', NEXT_PUBLIC_API_URL: 'http://localhost:3001/api' });
  check('Production build with a localhost URL fails (exit 1)', res.status === 1);
}

{
  const res = runGuard({ NODE_ENV: 'production', NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3001/api' });
  check('Production build with a 127.0.0.1 URL fails (exit 1)', res.status === 1);
}

{
  const res = runGuard({ NODE_ENV: 'production', NEXT_PUBLIC_API_URL: 'http://demm-crm-backend-staging-431876670120.us-east1.run.app/api' });
  check('Production build with a real but non-https URL fails (exit 1)', res.status === 1);
}

{
  const res = runGuard({ NODE_ENV: 'production', NEXT_PUBLIC_API_URL: 'https://demm-crm-backend-staging-431876670120.us-east1.run.app/api' });
  check('Production build with a valid https, non-localhost URL succeeds (exit 0)', res.status === 0);
}

// --- verify-no-localhost-in-bundle.js ---

function withTempBundle(files, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'build-guard-test-'));
  const standaloneDir = path.join(tmp, '.next', 'standalone');
  fs.mkdirSync(standaloneDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(standaloneDir, name), content);
  }
  try {
    return fn(tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

{
  const res = withTempBundle(
    { 'server.js': 'const apiUrl = "http://localhost:3001/api"; module.exports = apiUrl;' },
    (cwd) =>
      spawnSync(process.execPath, [path.join(__dirname, 'verify-no-localhost-in-bundle.js')], {
        cwd,
        env: { ...process.env, NODE_ENV: 'production' },
        encoding: 'utf8',
      }),
  );
  check('Bundle scan fails when compiled output contains a localhost URL (exit 1)', res.status === 1);
}

{
  const res = withTempBundle(
    { 'server.js': 'const apiUrl = "https://demm-crm-backend-staging-431876670120.us-east1.run.app/api"; module.exports = apiUrl;' },
    (cwd) =>
      spawnSync(process.execPath, [path.join(__dirname, 'verify-no-localhost-in-bundle.js')], {
        cwd,
        env: { ...process.env, NODE_ENV: 'production' },
        encoding: 'utf8',
      }),
  );
  check('Bundle scan succeeds when compiled output has no localhost URL (exit 0)', res.status === 0);
}

{
  const res = withTempBundle(
    { 'server.js': 'const apiUrl = "http://localhost:3001/api";' },
    (cwd) =>
      spawnSync(process.execPath, [path.join(__dirname, 'verify-no-localhost-in-bundle.js')], {
        cwd,
        env: { ...process.env, NODE_ENV: 'development' },
        encoding: 'utf8',
      }),
  );
  check('Bundle scan skips entirely outside production (exit 0 even with localhost present)', res.status === 0);
}

console.log('===============================================');
console.log(`📊 PRODUCTION BUILD GUARD SUITE: ${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
