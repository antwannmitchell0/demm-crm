import { Page, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import type { SeedResult } from './seed';
import { UAT_PASSWORD } from './uat-db';

export function fixtures(): SeedResult {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, '../e2e-results/fixtures.json'), 'utf8'),
  );
}

/**
 * One row of the control inventory.
 *
 * Recording ACTUAL alongside EXPECTED matters because a control that renders,
 * accepts a click, and then does nothing is the failure a screenshot cannot
 * catch. Every row is written by a journey that really clicked the thing, so an
 * untested control simply has no row -- absence is the signal.
 */
export interface ControlRecord {
  route: string;
  kind:
    | 'button'
    | 'link'
    | 'menu'
    | 'select'
    | 'form'
    | 'modal'
    | 'table-action'
    | 'nav'
    | 'filter'
    | 'status-action';
  label: string;
  role: string;
  expected: string;
  actual: string;
  network?: string;
  keyboard?: string;
  pass: boolean;
}

const INVENTORY: ControlRecord[] = [];

export function record(r: ControlRecord) {
  INVENTORY.push(r);
}

export function flushInventory() {
  const dir = path.join(__dirname, '../e2e-results');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'button-inventory.json'),
    JSON.stringify(INVENTORY, null, 2),
  );

  const header =
    '| Route | Kind | Label | Role | Expected | Actual | Network | Keyboard | Result |';
  const sep = '|---|---|---|---|---|---|---|---|---|';
  const rows = INVENTORY.map(
    (r) =>
      `| \`${r.route}\` | ${r.kind} | ${r.label} | ${r.role} | ${r.expected} | ${r.actual} | ${r.network ?? '—'} | ${r.keyboard ?? '—'} | ${r.pass ? 'PASS' : 'FAIL'} |`,
  );
  fs.writeFileSync(
    path.join(dir, 'button-inventory.md'),
    [
      '# Phase 2 control inventory',
      '',
      `Generated from a real browser run. ${INVENTORY.length} controls exercised, ` +
        `${INVENTORY.filter((r) => r.pass).length} passing.`,
      '',
      'A control with no row here was never clicked. Absence is the signal.',
      '',
      header,
      sep,
      ...rows,
      '',
    ].join('\n'),
  );
}

/**
 * Signs in through the real UI, not by injecting a token.
 *
 * The two-step login (password -> workspace choice) is itself part of what is
 * being verified, so it is driven rather than bypassed. An account belonging to
 * exactly one workspace enters it automatically and shows no picker; an account
 * in several must use the picker.
 */
/**
 * The origin the production bundle is built against, and where it is actually
 * sent.
 *
 * WHY NOT JUST BUILD AGAINST localhost. verify-production-config.js refuses a
 * build whose NEXT_PUBLIC_API_URL matches /localhost/, /127\.0\.0\.1/ or
 * /0\.0\.0\.0/, and requires https. That guard is the reason a loopback URL has
 * never shipped, and weakening it for a test would remove the protection on
 * every real build too.
 *
 * So the bundle is built against a real-looking https origin -- which satisfies
 * both the config guard and the no-localhost-in-bundle guard honestly -- and
 * the browser's requests to it are rewritten onto the local backend at the
 * network layer. That is what a reverse proxy does in front of the deployed
 * app, so the code under test behaves exactly as it does in production.
 */
export const UAT_PUBLIC_API_ORIGIN = 'https://backend.uat.invalid';
export const UAT_LOCAL_BACKEND = 'http://127.0.0.1:3101';

export async function installBackendRouting(page: Page) {
  await page.route(`${UAT_PUBLIC_API_ORIGIN}/**`, async (route) => {
    // route.fetch() rather than page.request.fetch(): it preserves the original
    // method, headers and body automatically, and the APIResponse it returns
    // stays alive long enough to hand straight to fulfill(). Fetching through
    // page.request instead disposes the response before fulfill() can read the
    // body ("Response has been disposed").
    const target = route
      .request()
      .url()
      .replace(UAT_PUBLIC_API_ORIGIN, UAT_LOCAL_BACKEND);
    const response = await route.fetch({ url: target });
    await route.fulfill({ response });
  });
}

export async function signIn(
  page: Page,
  email: string,
  opts: { chooseWorkspace?: string } = {},
) {
  await installBackendRouting(page);
  await page.goto('/');
  await page.getByPlaceholder('Email address').fill(email);
  await page.getByPlaceholder('Password').fill(UAT_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();

  if (opts.chooseWorkspace) {
    const choice = page.getByRole('button', {
      name: new RegExp(opts.chooseWorkspace, 'i'),
    });
    await choice.waitFor({ state: 'visible', timeout: 15_000 });
    await choice.click();
  }

  await page.waitForURL(/\/dashboard/, { timeout: 20_000 });
}

/** Fails the test if anything token-shaped reached browser-readable storage. */
export async function assertNoCredentialInStorage(page: Page) {
  // Settle first. Callers reach here right after a workspace switch, which is a
  // FULL navigation -- entering a workspace replaces the shared refresh cookie,
  // so the app reloads rather than re-rendering. Evaluating into a context that
  // is already tearing down fails with "Execution context was destroyed",
  // which is a race in the assertion, not a finding about storage. Observed
  // intermittently in CI; the same test passes 4/4 in isolation.
  //
  // Waiting on load state rather than a timeout: the condition is "the document
  // this evaluate will run in is the one that will still be here afterwards".
  await page.waitForLoadState('domcontentloaded');

  const dump = await page.evaluate(() => ({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage),
  }));
  const blob = JSON.stringify(dump);
  expect(
    blob,
    'no token-shaped value may reach localStorage/sessionStorage',
  ).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}|refresh_token|access_token/);
}
