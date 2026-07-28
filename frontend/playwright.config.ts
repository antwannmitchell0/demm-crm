import { defineConfig } from '@playwright/test';
import { UAT_DATABASE_URL } from './e2e/uat-db';

/**
 * Browser UAT against a locally built production stack.
 *
 * WHY THE PRODUCTION BUILD AND NOT `next dev`. The release guards
 * (verify-production-config, verify-no-localhost-in-bundle) only run on a
 * production build, and the dev server tolerates configuration the deployed app
 * would reject. Testing `next dev` would prove the app works in a mode nobody
 * ships.
 *
 * WHY THE COMPILED BACKEND AND NOT `nest start --watch`. The compiled entry
 * point is what the Dockerfile runs, so it is what staging actually serves.
 *
 * Both servers point at `demm_crm_uat_verify` -- a disposable database whose
 * name carries the suffix the backend guard recognises as throwaway. Nothing
 * here can reach the development database.
 */
const JWT_SECRET =
  process.env.JWT_SECRET ??
  'demm_crm_production_secure_jwt_secret_key_32chars_minimum';

const BACKEND_PORT = 3101;
const FRONTEND_PORT = 3100;
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const FRONTEND_URL = `http://127.0.0.1:${FRONTEND_PORT}`;

export default defineConfig({
  testDir: './e2e',
  // Serial. Every journey mutates the same workspace -- roles, memberships,
  // approvals -- so parallel workers would race each other rather than the
  // application, and failures would be unattributable.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    // Machine-readable, and the source of the button inventory.
    ['json', { outputFile: 'e2e-results/results.json' }],
  ],
  use: {
    baseURL: FRONTEND_URL,
    // Evidence for every failure, not just a stack trace.
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  webServer: [
    {
      command: `node ../backend/dist/src/main`,
      port: BACKEND_PORT,
      reuseExistingServer: false,
      timeout: 90_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        DATABASE_URL: UAT_DATABASE_URL,
        JWT_SECRET,
        PORT: String(BACKEND_PORT),
        NODE_ENV: 'production',
        // The BFF calls the backend from the Next server and the browser calls
        // it directly; both origins must be allowed.
        ALLOWED_ORIGINS: `${FRONTEND_URL},http://localhost:${FRONTEND_PORT}`,
      },
    },
    {
      command: `npm run start -- --port ${FRONTEND_PORT}`,
      port: FRONTEND_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        NODE_ENV: 'production',
        BACKEND_API_URL: BACKEND_URL,
        // The BFF refuses to serve registration in production mode without
        // this: it could not carry a per-client rate-limit identity, and the
        // limit would silently become a product-wide cap. Synthetic and
        // test-only -- the real value comes from deployment configuration.
        BFF_RATE_LIMIT_SIGNING_SECRET:
          'synthetic-playwright-rate-limit-secret-32chars+',
        // 0: these journeys drive the app through a browser with no edge in
        // front, so no client identity is claimed. Identity propagation has its
        // own suite (test-bff-rate-limit.ts) which runs the real topology.
        FRONTEND_TRUSTED_PROXY_HOPS: '0',
        // Runtime only: the BFF reads this on the server, where reaching
        // 127.0.0.1 is correct. The BROWSER bundle is built against
        // UAT_PUBLIC_API_ORIGIN and rerouted by Playwright -- see helpers.ts.
        NEXT_PUBLIC_API_URL: 'https://backend.uat.invalid',
        ALLOWED_FRONTEND_ORIGINS: `${FRONTEND_URL},http://localhost:${FRONTEND_PORT}`,
        PORT: String(FRONTEND_PORT),
      },
    },
  ],
});
