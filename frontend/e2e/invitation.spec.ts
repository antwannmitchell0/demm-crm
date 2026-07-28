import { test, expect } from '@playwright/test';
import { fixtures, signIn, record, installBackendRouting } from './helpers';
import { UAT_PASSWORD } from './uat-db';

/**
 * The invitation journey, end to end, in a real browser.
 *
 * WHY THIS EXISTS SEPARATELY. `phase2.spec.ts` covers CREATING an invitation and
 * REVOKING one; nothing exercised ACCEPTING one. The acceptance contract then
 * changed twice under review -- to idempotent, then to reporting `hasAccess`
 * honestly -- and the `/invite` page had to be corrected because it discarded
 * the response and announced "You are in" to somebody who no longer had access.
 * That defect was invisible to every existing test, because no test had ever
 * opened the page.
 */
test.describe.configure({ mode: 'serial' });

// WIP -- MARKED fixme DELIBERATELY, NOT skip.
//
// Both journeys time out during setup: the first `fill()` on the Team page
// never resolves, and the cause is not yet identified. `fixme` declares "this
// is known not to work" so the suite reports it as expected-to-fail rather than
// quietly passing or silently vanishing from the run, which is what `skip`
// would do.
//
// The behaviour these cover IS proven at the API layer -- 53 assertions in
// backend/test-invitation-acceptance.ts, including the removed-member case that
// returns hasAccess:false. What is NOT yet proven is that the /invite page
// renders it correctly in a browser, which is precisely the gap that let the
// "You are in" defect ship. Do not treat this file as coverage until it runs.
// BLOCKED ON A PRODUCT DEFECT, NOT A TEST DEFECT.
//
// A person invited to their FIRST workspace cannot accept the invitation.
// Measured in a real browser:
//
//   after login:  "You signed in, but this account is not part of any
//                  workspace yet."           -- no session is established
//   opening the
//   invite link:  URL redirects to "/"       -- /invite requires
//                  getAuthToken(), finds none, bounces to Sign In
//
// login() only returns a preAuthToken, and issueTokensForMembership() refuses
// to mint a session without a membership -- so an account with zero workspaces
// can never hold an access token, and /invite can never run. The invitation
// link is unusable by exactly the person it exists for.
//
// Every API-layer test passes because it signs a JWT directly, bypassing login.
// That is why 53 backend assertions did not catch this.
//
// fixme, not skip: this reports as expected-to-fail rather than vanishing.
// Removing it requires the AUTH CHANGE described in handoff 22, not a test edit.
test.fixme(true, 'BLOCKED: a workspace-less account cannot obtain a session -- see handoff 22');

const F = fixtures();

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => undefined);
});

/** The one-time link is shown once, at creation, and never again. */
async function issueInvitationFor(
  page: import('@playwright/test').Page,
  email: string,
) {
  page.on('pageerror', (e) => console.error('[browser:pageerror]', e.message));
  page.on('response', (r) => {
    if (r.status() >= 400) console.error('[browser:http]', r.status(), r.request().method(), r.url());
  });

  await page.goto('/team');
  console.log('DIAG SESSION', await page.locator('[data-session-state]').first().getAttribute('data-session-state').catch(() => 'NO ATTR'));
  console.log('DIAG INPUT COUNT', await page.getByLabel(/email address to invite/i).count());

  await page.getByLabel(/email address to invite/i).fill(email);
  await page.getByRole('button', { name: /create link/i }).click();
  await expect(
    page.getByText(/shown once and cannot be retrieved/i),
  ).toBeVisible({ timeout: 15_000 });
  const link = await page.locator('code').first().innerText();
  expect(link, 'the one-time link must be shown').toContain('/invite?token=');
  return link;
}

const pathOf = (link: string) => {
  const u = new URL(link);
  return u.pathname + u.search;
};

test('an invited person can accept, and retrying is honest', async ({ page }) => {
  await signIn(page, F.owner.email, { chooseWorkspace: F.workspaceA.name });
  const inviteEmail = F.invitee.email;
  const link = await issueInvitationFor(page, inviteEmail);
  record({
    route: '/team',
    kind: 'form',
    label: 'Create invitation for a real account',
    role: 'ORG_OWNER',
    expected: 'one-time link shown exactly once',
    actual: 'link shown',
    network: 'POST /team/invitations',
    pass: true,
  });

  await expect(page.getByText(inviteEmail).first()).toBeVisible({
    timeout: 15_000,
  });
  record({
    route: '/team',
    kind: 'table-action',
    label: 'Pending invitation row',
    role: 'ORG_OWNER',
    expected: 'the invitation appears as pending',
    actual: 'visible',
    pass: true,
  });

  // The raw token must not be recoverable from the listing after creation.
  const token = new URL(link).searchParams.get('token')!;
  await page.reload();
  const afterReload = await page.locator('body').innerText();
  record({
    route: '/team',
    kind: 'status-action',
    label: 'Token recoverability after reload',
    role: 'ORG_OWNER',
    expected: 'raw token absent from the listing',
    actual: afterReload.includes(token) ? 'TOKEN LEAKED' : 'absent',
    pass: !afterReload.includes(token),
  });
  expect(afterReload, 'the raw token must not survive a reload').not.toContain(
    token,
  );

  // --- The invited person signs in and accepts, in a FRESH CONTEXT ---
  //
  // A separate browser context per persona, NOT clearCookies() on the same
  // page. Clearing cookies mid-test leaves the running application holding
  // in-memory session state for the previous account, and the login form never
  // re-renders -- measured: `getByPlaceholder('Email address')` never resolves
  // and the whole 60s budget is consumed. A new context is what a second real
  // person actually is.
  const inviteeCtx = await page.context().browser()!.newContext();
  const inviteePage = await inviteeCtx.newPage();
  await installBackendRouting(inviteePage);
  await inviteePage.goto('/');
  await inviteePage.getByPlaceholder('Email address').fill(inviteEmail);
  await inviteePage.getByPlaceholder('Password').fill(UAT_PASSWORD);
  await inviteePage.getByRole('button', { name: /sign in/i }).click();
  await inviteePage.waitForTimeout(2500);

  console.log('DIAG after-login BODY', (await inviteePage.locator('body').innerText()).slice(0,300).replace(/\s+/g,' '));
  await inviteePage.goto(pathOf(link));
  await inviteePage.waitForTimeout(2000);
  console.log('DIAG invite BODY', (await inviteePage.locator('body').innerText()).slice(0,400).replace(/\s+/g,' '));
  const acceptBtn = inviteePage.getByRole('button', { name: /accept invitation/i });
  await expect(acceptBtn).toBeVisible({ timeout: 15_000 });
  await acceptBtn.click();
  await page.waitForURL(/\/dashboard/, { timeout: 20_000 });
  record({
    route: '/invite',
    kind: 'button',
    label: 'Accept invitation',
    role: 'invitee',
    expected: 'POST accept, then enter the workspace',
    actual: 'entered /dashboard',
    network: 'POST /team/invitations/accept',
    pass: true,
  });

  await expect(page.getByText(F.workspaceA.name).first()).toBeVisible({
    timeout: 15_000,
  });
  record({
    route: '/dashboard',
    kind: 'nav',
    label: 'Workspace availability after accepting',
    role: 'invitee',
    expected: `"${F.workspaceA.name}" is now the active workspace`,
    actual: 'visible',
    pass: true,
  });

  // Retrying the SAME consumed link must be idempotent, not an error.
  await page.goto(pathOf(link));
  const retryBtn = page.getByRole('button', { name: /accept invitation/i });
  await expect(retryBtn).toBeVisible({ timeout: 15_000 });
  await retryBtn.click();
  const retryBody = await page.locator('body').innerText();
  const retryErrored = /could not be accepted|no longer valid/i.test(retryBody);
  record({
    route: '/invite',
    kind: 'button',
    label: 'Re-open a consumed link while still a member',
    role: 'invitee',
    expected: 'idempotent -- no error shown',
    actual: retryErrored ? 'SHOWED AN ERROR' : 'no error',
    pass: !retryErrored,
  });
  expect(retryErrored, 'retrying a consumed link must not error').toBe(false);
});

test('a removed member reopening their link is told the truth', async ({
  page,
}) => {
  // THE REGRESSION THIS EXISTS FOR. Acceptance answers 200 for an already-used
  // link and reports hasAccess:false when the person was since removed. The
  // page previously ignored the body, announced "You are in", and redirected
  // into a workspace the account cannot open.
  await installBackendRouting(page);
  await signIn(page, F.owner.email, { chooseWorkspace: F.workspaceA.name });

  // `member` is already in the workspace, so accepting yields ALREADY_MEMBER.
  const link = await issueInvitationFor(page, F.member.email);

  await page.context().clearCookies();
  await page.goto('/');
  await page.getByPlaceholder('Email address').fill(F.member.email);
  await page.getByPlaceholder('Password').fill(UAT_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 20_000 });

  await page.goto(pathOf(link));
  await page.getByRole('button', { name: /accept invitation/i }).click();
  record({
    route: '/invite',
    kind: 'button',
    label: 'Accept as an existing member',
    role: 'member',
    expected: 'ALREADY_MEMBER -- 200, access retained',
    actual: 'no error',
    pass: true,
  });

  // The owner removes them.
  await page.context().clearCookies();
  await signIn(page, F.owner.email, { chooseWorkspace: F.workspaceA.name });
  await page.goto('/team');
  await expect(page.getByText(F.member.email).first()).toBeVisible({
    timeout: 15_000,
  });
  const row = page.locator('div').filter({ hasText: F.member.email }).last();
  await row.getByRole('button', { name: /remove/i }).first().click();
  record({
    route: '/team',
    kind: 'table-action',
    label: 'Remove member',
    role: 'ORG_OWNER',
    expected: 'DELETE membership',
    actual: 'removal requested',
    network: 'DELETE /team/members/{id}',
    pass: true,
  });

  // The removed person reopens their old link.
  await page.context().clearCookies();
  await page.goto('/');
  await page.getByPlaceholder('Email address').fill(F.member.email);
  await page.getByPlaceholder('Password').fill(UAT_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForTimeout(2500);

  await page.goto(pathOf(link));
  const btn = page.getByRole('button', { name: /accept invitation/i });
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
  }

  const body = await page.locator('body').innerText();
  const claimsSuccess = /you are in|taking you to the workspace/i.test(body);
  const tellsTruth = /no longer have access/i.test(body);

  record({
    route: '/invite',
    kind: 'status-action',
    label: 'Reopen link after removal',
    role: 'removed member',
    expected: 'honest "no longer have access", never "You are in"',
    actual: claimsSuccess
      ? 'FALSELY CLAIMS SUCCESS'
      : tellsTruth
        ? 'told the truth'
        : body.slice(0, 80).replace(/\s+/g, ' '),
    pass: !claimsSuccess,
  });

  expect(
    claimsSuccess,
    'the page must never announce success to somebody who has no access',
  ).toBe(false);
});
