import { test, expect, type Page } from '@playwright/test';
import { fixtures, signIn, record, installBackendRouting } from './helpers';
import { UAT_PASSWORD } from './uat-db';

/**
 * Accepting an invitation while already signed in somewhere else.
 *
 * THE DEFECT THIS EXISTS FOR. The authenticated path called acceptInvitation()
 * and redirected straight to /dashboard. The membership row was created, so
 * every API-layer assertion passed -- but the access and refresh session stayed
 * bound to whatever workspace was active before. Somebody who belonged to
 * workspace B and accepted an invitation to workspace A was told they had
 * joined A and then shown B.
 *
 * That is the worst shape a bug can take here: the database is right, the
 * screen is wrong, and nothing errors. Only a browser holding a real session in
 * a DIFFERENT workspace can observe it, which is why no existing journey did --
 * every other persona had exactly one workspace, so "switch to the invited one"
 * and "stay where you are" produced identical screens.
 */
test.describe.configure({ mode: 'serial' });

const F = fixtures();

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => undefined);
});

async function issueInvitationFor(page: Page, email: string) {
  await page.goto('/team');
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

test('accepting while signed in elsewhere moves the session, not just the row', async ({
  page,
}) => {
  // The owner of workspace A issues the invitation.
  await signIn(page, F.owner.email, { chooseWorkspace: F.workspaceA.name });
  const link = await issueInvitationFor(page, F.crossWorkspace.email);
  record({
    route: '/team',
    kind: 'form',
    label: 'Invite someone who already belongs to another workspace',
    role: 'ORG_OWNER',
    expected: 'one-time link shown exactly once',
    actual: 'link shown',
    network: 'POST /team/invitations',
    pass: true,
  });

  // A genuinely separate person, holding a live session in workspace B.
  const ctx = await page.context().browser()!.newContext();
  try {
    const invitee = await ctx.newPage();
    await installBackendRouting(invitee);
    // NOT signIn(..., { chooseWorkspace }). This persona belongs to exactly one
    // workspace, and the picker only appears when there is a choice to make --
    // waiting for a button that will never render just burns the timeout.
    // Written to tolerate both shapes, because after accepting they WILL have
    // two, and a later maintainer moving this line would otherwise be puzzled.
    await installBackendRouting(invitee);
    await invitee.goto('/');
    await invitee.getByPlaceholder('Email address').fill(F.crossWorkspace.email);
    await invitee.getByPlaceholder('Password').fill(UAT_PASSWORD);
    await invitee.getByRole('button', { name: /sign in/i }).click();
    const pick = invitee.getByRole('button', {
      name: new RegExp(F.workspaceB.name, 'i'),
    });
    if (await pick.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await pick.click();
    }
    await invitee.waitForURL(/\/dashboard/, { timeout: 25_000 });
    await expect(invitee.getByText(F.workspaceB.name).first()).toBeVisible({
      timeout: 20_000,
    });
    record({
      route: '/dashboard',
      kind: 'nav',
      label: 'Signed in to the OTHER workspace first',
      role: 'invitee',
      expected: `"${F.workspaceB.name}" is the active workspace`,
      actual: 'visible',
      pass: true,
    });

    // A second tab on the same session, open across the switch. It must follow
    // rather than keep rendering the old workspace against a session that no
    // longer belongs to it.
    const secondTab = await ctx.newPage();
    await installBackendRouting(secondTab);
    await secondTab.goto('/dashboard');
    await expect(secondTab.getByText(F.workspaceB.name).first()).toBeVisible({
      timeout: 20_000,
    });

    // --- hasAccess:false must NEVER move the session -------------------
    //
    // Checked before the real acceptance, while the session is still known to
    // be in B. If the client switched on status alone, this is where it would
    // show.
    await invitee.route('**/api/session/accept-invitation', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          outcome: 'ALREADY_ACCEPTED',
          hasAccess: false,
          role: null,
          access_token: null,
          user: null,
        }),
      });
    });
    await invitee.goto(pathOf(link));
    const denied = invitee.getByRole('button', { name: /accept invitation/i });
    if (await denied.isVisible().catch(() => false)) {
      await denied.click();
    }
    await invitee.waitForTimeout(1500);
    await invitee.goto('/dashboard');
    await expect(invitee.getByText(F.workspaceB.name).first()).toBeVisible({
      timeout: 20_000,
    });
    record({
      route: '/invite',
      kind: 'status-action',
      label: 'hasAccess:false does not move the session',
      role: 'invitee',
      expected: `still in "${F.workspaceB.name}"`,
      actual: 'unchanged',
      pass: true,
    });
    await invitee.unroute('**/api/session/accept-invitation');

    // --- The real acceptance -------------------------------------------
    await invitee.goto(pathOf(link));
    const accept = invitee.getByRole('button', { name: /accept invitation/i });
    await expect(accept).toBeVisible({ timeout: 15_000 });

    // Signed in already: the page must not ask for a password again.
    const passwordFields = await invitee.getByLabel(/password/i).count();
    record({
      route: '/invite',
      kind: 'form',
      label: 'No password prompt for an authenticated invitee',
      role: 'invitee',
      expected: 'zero password fields',
      actual: `${passwordFields}`,
      pass: passwordFields === 0,
    });
    expect(
      passwordFields,
      'an already-authenticated person must not be asked to re-enter a password',
    ).toBe(0);

    await accept.click();
    await invitee.waitForURL(/\/dashboard/, { timeout: 30_000 });

    // THE ASSERTION THE OLD CODE FAILED. Not "a membership row exists" -- that
    // was already true when the bug shipped -- but "the session is now bound to
    // the invited workspace".
    await expect(invitee.getByText(F.workspaceA.name).first()).toBeVisible({
      timeout: 20_000,
    });
    record({
      route: '/dashboard',
      kind: 'nav',
      label: 'Active session moved to the invited workspace',
      role: 'invitee',
      expected: `"${F.workspaceA.name}" is active after accepting`,
      actual: 'visible',
      network: 'POST /api/session/switch-workspace',
      pass: true,
    });

    // ...and the previous workspace is not still on screen beside it.
    const shell = await invitee.locator('body').innerText();
    const stillShowsB = shell.includes(F.workspaceB.name);
    record({
      route: '/dashboard',
      kind: 'nav',
      label: 'Previous workspace no longer presented as active',
      role: 'invitee',
      expected: `"${F.workspaceB.name}" not shown as the current context`,
      actual: stillShowsB ? 'STILL VISIBLE' : 'gone',
      pass: !stillShowsB,
    });
    expect(
      stillShowsB,
      'the workspace the session left must not still be displayed',
    ).toBe(false);

    // Not logged out, and the credential is still not readable.
    expect(
      new URL(invitee.url()).pathname,
      'accepting must not drop the session and bounce to sign-in',
    ).toBe('/dashboard');
    const leaked = await invitee.evaluate(() =>
      /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(
        [
          JSON.stringify(window.localStorage),
          JSON.stringify(window.sessionStorage),
          document.cookie,
          window.location.href,
        ].join('|'),
      ),
    );
    record({
      route: '/dashboard',
      kind: 'status-action',
      label: 'Credentials after a switch-on-accept',
      role: 'invitee',
      expected: 'no JWT in storage, cookies or the URL',
      actual: leaked ? 'A JWT WAS READABLE' : 'none readable',
      pass: !leaked,
    });
    expect(leaked, 'no token may be readable by the page').toBe(false);

    // --- The other tab follows -----------------------------------------
    //
    // The whole browser shares ONE refresh cookie, so after the switch the
    // second tab's session belongs to workspace A whether it knows it or not.
    // Rendering B's data against A's session is the cross-tab form of the same
    // defect.
    await secondTab.reload();
    await expect(secondTab.getByText(F.workspaceA.name).first()).toBeVisible({
      timeout: 25_000,
    });
    expect(
      new URL(secondTab.url()).pathname,
      'the other tab must not be logged out by the switch',
    ).toBe('/dashboard');
    record({
      route: '/dashboard',
      kind: 'nav',
      label: 'Second tab follows the workspace switch',
      role: 'invitee',
      expected: `the other tab shows "${F.workspaceA.name}", still signed in`,
      actual: 'followed',
      pass: true,
    });

    // --- Re-opening the consumed link stays safe ------------------------
    await invitee.goto(pathOf(link));
    const retry = invitee.getByRole('button', { name: /accept invitation/i });
    if (await retry.isVisible().catch(() => false)) {
      await retry.click();
      await invitee.waitForTimeout(2000);
    }
    const retryBody = await invitee.locator('body').innerText();
    const errored = /could not be accepted|no longer valid/i.test(retryBody);
    record({
      route: '/invite',
      kind: 'button',
      label: 'Re-open the consumed link while a member',
      role: 'invitee',
      expected: 'idempotent -- no error shown',
      actual: errored ? 'SHOWED AN ERROR' : 'no error',
      pass: !errored,
    });
    expect(errored, 'retrying a consumed link must not error').toBe(false);
  } finally {
    await ctx.close().catch(() => undefined);
  }
});
