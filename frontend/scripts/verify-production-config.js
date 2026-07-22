#!/usr/bin/env node
// Build Spec Phase 0, requirement #7: "Add a safe production guard that
// fails the build if localhost is embedded." This was the one Phase 0
// acceptance criterion that shipped with nothing enforcing it -- Next.js
// inlines NEXT_PUBLIC_* vars at build time, so a missing/wrong value here
// becomes permanently baked into the deployed bundle with no runtime
// signal that anything is wrong (see frontend/Dockerfile and the
// 2026-07-21 reconciliation memo for the exact defect this closes).
//
// Runs as an npm `prebuild` lifecycle script -- npm runs it automatically
// before `next build` on every `npm run build`. Only enforces anything
// when NODE_ENV=production (set explicitly in frontend/Dockerfile's
// builder stage); local `next dev` and non-production CI checks are
// unaffected.

const UNSAFE_HOST_PATTERNS = [/localhost/i, /127\.0\.0\.1/, /0\.0\.0\.0/];

function fail(message) {
  console.error(`\n❌ PRODUCTION CONFIG GUARD FAILED\n   ${message}\n`);
  process.exit(1);
}

function main() {
  const nodeEnv = process.env.NODE_ENV;

  if (nodeEnv !== 'production') {
    console.log(
      `ℹ️  verify-production-config: NODE_ENV=${nodeEnv || '(unset)'}, not production -- skipping strict checks.`,
    );
    return;
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL;

  if (!apiUrl || apiUrl.trim() === '') {
    fail(
      'NEXT_PUBLIC_API_URL is required for a production build and was not set. ' +
        'Without it, Next.js would silently inline the localhost development fallback ' +
        'from frontend/src/lib/api.ts into the deployed bundle.',
    );
  }

  const matchedPattern = UNSAFE_HOST_PATTERNS.find((re) => re.test(apiUrl));
  if (matchedPattern) {
    fail(
      `NEXT_PUBLIC_API_URL="${apiUrl}" points at a development host (matched ${matchedPattern}). ` +
        'A production build must point at a real deployed backend URL.',
    );
  }

  if (!/^https:\/\//.test(apiUrl)) {
    fail(
      `NEXT_PUBLIC_API_URL="${apiUrl}" must use https:// in a production build.`,
    );
  }

  console.log(
    `✅ verify-production-config: NEXT_PUBLIC_API_URL="${apiUrl}" is a valid production API URL.`,
  );
}

main();
