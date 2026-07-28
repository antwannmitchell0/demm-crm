import { test, expect, type Page, type BrowserContext } from '@playwright/test';
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
 *
 * WHAT THESE COVER THAT THE API SUITES CANNOT. Every backend invitation test
 * signs a JWT directly. That bypasses login, which is exactly where the real
 * defect lived: a person invited to their FIRST workspace holds no membership,
 * so no access token can be minted for them and the accept endpoint was
 * unreachable. 53 API assertions passed while the feature was unusable by the
 * only person it was for. These journeys start from a browser with no session,
 * which is the only place that fact is observable.
 */
test.describe.configure({ mode: 'serial' });

const F = fixtures();

/**
 * The link `invitee` accepts in the first journey, reopened in the second after
 * they are removed. Shared deliberately: the suite is `mode: 'serial'`, and the
 * second journey is not a separate scenario but the CONTINUATION of the first
 * one -- you cannot be removed from a workspace you never joined.
 *
 * The obvious self-contained alternative -- invite somebody who is already a
 * member -- is impossible by design: the product refuses it with "That person
 * is already a member of this workspace" (team.service.ts). Measured, not
 * assumed: that refusal is what failed the first draft of this file.
 */
let acceptedLink = '';

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => undefined);
});

/** The one-time link is shown once, at creation, and never again. */
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

/**
 * A second real person: a separate browser context, NOT clearCookies() on the
 * same page. Clearing cookies mid-test leaves the running application holding
 * in-memory session state for the previous account and the login form never
 * re-renders -- measured, the whole 60s budget is consumed waiting for it.
 */
async function asNewPerson(
  page: Page,
  body: (p: Page) => Promise<void>,
): Promise<void> {
  const context: BrowserContext = await page.context().browser()!.newContext();
  try {
    const fresh = await context.newPage();
    await installBackendRouting(fresh);
    await body(fresh);
  } finally {
    // Always, even when an assertion inside threw: a leaked context keeps a
    // browser process alive and the run never exits.
    await context.close().catch(() => undefined);
  }
}

/** Accepts from the /invite page using the credential form, with no session. */
async function acceptWithPassword(p: Page, link: string, email: string) {
  await p.goto(pathOf(link));
  await p.getByLabel(/email address/i).fill(email);
  await p.getByLabel(/^password$/i).fill(UAT_PASSWORD);
  await p.getByRole('button', { name: /accept invitation/i }).click();
}

test('a person invited to their first workspace can accept and get in', async ({
  page,
}) => {
  // THE JOURNEY THE FEATURE EXISTS FOR. `invitee` has an account and belongs to
  // nothing, so they cannot obtain a session by signing in -- the /invite page
  // has to authenticate them itself.
  await signIn(page, F.owner.email, { chooseWorkspace: F.workspaceA.name });
  const link = await issueInvitationFor(page, F.invitee.email);
  acceptedLink = link;
  record({
    route: '/team',
    kind: 'form',
    label: 'Create invitation for a workspace-less account',
    role: 'ORG_OWNER',
    expected: 'one-time link shown exactly once',
    actual: 'link shown',
    network: 'POST /team/invitations',
    pass: true,
  });

  await expect(page.getByText(F.invitee.email).first()).toBeVisible({
    timeout: 15_000,
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

  await asNewPerson(page, async (invitee) => {
    // Straight to the link with NO session. Before the fix this redirected to
    // "/" because the page required an access token the account could not have.
    await invitee.goto(pathOf(link));
    await expect(
      invitee.getByRole('button', { name: /accept invitation/i }),
    ).toBeVisible({ timeout: 15_000 });
    expect(
      new URL(invitee.url()).pathname,
      '/invite must be reachable without a session',
    ).toBe('/invite');
    record({
      route: '/invite',
      kind: 'nav',
      label: 'Open an invitation with no session',
      role: 'invitee',
      expected: 'the page renders instead of bouncing to sign-in',
      actual: 'rendered',
      pass: true,
    });

    await acceptWithPassword(invitee, link, F.invitee.email);
    await invitee.waitForURL(/\/dashboard/, { timeout: 30_000 });
    record({
      route: '/invite',
      kind: 'form',
      label: 'Accept invitation with a password',
      role: 'invitee',
      expected: 'membership created, then enter the workspace',
      actual: 'entered /dashboard',
      network: 'POST /api/session/accept-invitation',
      pass: true,
    });

    await expect(invitee.getByText(F.workspaceA.name).first()).toBeVisible({
      timeout: 15_000,
    });
    record({
      route: '/dashboard',
      kind: 'nav',
      label: 'Workspace availability after accepting',
      role: 'invitee',
      expected: `"${F.workspaceA.name}" is the active workspace`,
      actual: 'visible',
      pass: true,
    });

    // Neither pre-session credential may survive anywhere the page can read.
    const leaked = await invitee.evaluate(() => {
      const blob = [
        JSON.stringify(window.localStorage),
        JSON.stringify(window.sessionStorage),
        document.cookie,
        window.location.href,
      ].join('|');
      // Three dot-separated base64url segments: the shape of a JWT.
      return /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(blob);
    });
    record({
      route: '/invite',
      kind: 'status-action',
      label: 'Pre-session credentials after acceptance',
      role: 'invitee',
      expected: 'no JWT in storage, cookies or the URL',
      actual: leaked ? 'A JWT WAS READABLE' : 'none readable',
      pass: !leaked,
    });
    expect(
      leaked,
      'no capability or pre-session token may be readable by the page',
    ).toBe(false);
  });

  // Retrying the SAME consumed link must be idempotent, not an error.
  await asNewPerson(page, async (retry) => {
    await acceptWithPassword(retry, link, F.invitee.email);
    await retry.waitForLoadState('networkidle').catch(() => undefined);
    const body = await retry.locator('body').innerText();
    const errored = /could not be accepted|no longer valid/i.test(body);
    record({
      route: '/invite',
      kind: 'form',
      label: 'Re-use a consumed link while still a member',
      role: 'invitee',
      expected: 'idempotent -- no error shown',
      actual: errored ? 'SHOWED AN ERROR' : 'no error',
      pass: !errored,
    });
    expect(errored, 'retrying a consumed link must not error').toBe(false);
  });
});

test('a removed member reopening their link is told the truth', async ({
  page,
}) => {
  // THE REGRESSION THIS EXISTS FOR. Acceptance answers 200 for an already-used
  // link and reports hasAccess:false when the person was since removed. The
  // page previously ignored the body, announced "You are in", and redirected
  // into a workspace the account cannot open.
  //
  // Continues from the journey above: `invitee` joined with this link, so they
  // are a member who can now be removed.
  expect(
    acceptedLink,
    'this journey continues the one above and needs its link',
  ).toContain('/invite?token=');

  await signIn(page, F.owner.email, { chooseWorkspace: F.workspaceA.name });
  await page.goto('/team');

  // The exact accessible name the Team page assigns each row's control, rather
  // than filtering ancestors by text -- one member's address can appear inside
  // another row's markup, and `.last()` then removes the wrong person.
  const removeButton = page.getByRole('button', {
    name: `Remove ${F.invitee.email}`,
  });
  await expect(removeButton).toBeVisible({ timeout: 15_000 });
  await removeButton.click();
  await expect(removeButton).toHaveCount(0, { timeout: 15_000 });
  record({
    route: '/team',
    kind: 'table-action',
    label: 'Remove member',
    role: 'ORG_OWNER',
    expected: 'DELETE membership, the row disappears',
    actual: 'removed',
    network: 'DELETE /team/members/{id}',
    pass: true,
  });

  // The removed person reopens their old link. They now belong to nothing, so
  // this is the no-session path again.
  await asNewPerson(page, async (removed) => {
    await acceptWithPassword(removed, acceptedLink, F.invitee.email);
    await removed.waitForLoadState('networkidle').catch(() => undefined);

    const body = await removed.locator('body').innerText();
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
      pass: !claimsSuccess && tellsTruth,
    });

    expect(
      claimsSuccess,
      'the page must never announce success to somebody who has no access',
    ).toBe(false);
    expect(tellsTruth, 'the page must say plainly that access was lost').toBe(
      true,
    );
    expect(
      new URL(removed.url()).pathname,
      'a person with no access must not be sent into the dashboard',
    ).toBe('/invite');
  });
});
