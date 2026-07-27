import { test, expect, Page } from '@playwright/test';
import {
  fixtures,
  signIn,
  record,
  flushInventory,
  assertNoCredentialInStorage,
} from './helpers';

/**
 * Phase 2 browser acceptance.
 *
 * Every control these journeys touch is recorded into the inventory with what
 * was expected and what actually happened, because "the page rendered" is not
 * the same as "the button did something". Serial by design: the journeys share
 * one workspace and mutate roles, memberships and approvals in sequence.
 */
test.describe.configure({ mode: 'serial' });

const F = fixtures();

/** Captures the request a click causes, so a dead button cannot pass. */
async function clickAndCapture(
  page: Page,
  action: () => Promise<void>,
  urlFragment: string,
) {
  const waiter = page
    .waitForRequest((r) => r.url().includes(urlFragment), { timeout: 8_000 })
    .catch(() => null);
  await action();
  const req = await waiter;
  return req ? `${req.method()} ${new URL(req.url()).pathname}` : 'NO REQUEST';
}

test.afterAll(() => flushInventory());

// ===========================================================================
test('dashboard states are truthful', async ({ page }) => {
  await signIn(page, F.owner.email, { chooseWorkspace: F.workspaceA.name });

  const body = await page.locator('body').innerText();

  expect(
    body,
    'the fabricated automation claim must not appear anywhere on the dashboard',
  ).not.toMatch(/no automations failed/i);
  record({
    route: '/dashboard',
    kind: 'status-action',
    label: 'Executive brief text',
    role: 'ORG_OWNER',
    expected: 'no "No automations failed today." claim',
    actual: 'absent',
    pass: true,
  });

  expect(body, 'no invented workflow/automation metric').not.toMatch(
    /workflows? (run|executed|completed)|automation(s)? (ran|succeeded)/i,
  );
  record({
    route: '/dashboard',
    kind: 'status-action',
    label: 'Workflow/automation metrics',
    role: 'ORG_OWNER',
    expected: 'no invented workflow or automation metric',
    actual: 'none present',
    pass: true,
  });

  // The sidebar must name the active workspace -- the Phase 2 session payload
  // change. Before it, only an id existed and nothing could be displayed.
  await expect(page.getByText(F.workspaceA.name).first()).toBeVisible();
  record({
    route: '/dashboard',
    kind: 'nav',
    label: 'Active workspace name in sidebar',
    role: 'ORG_OWNER',
    expected: `shows "${F.workspaceA.name}"`,
    actual: 'visible',
    pass: true,
  });

  await assertNoCredentialInStorage(page);
  record({
    route: '/dashboard',
    kind: 'status-action',
    label: 'Browser storage',
    role: 'ORG_OWNER',
    expected: 'no readable token in localStorage/sessionStorage',
    actual: 'clean',
    pass: true,
  });
});

// ===========================================================================
test('agent console exposes no fabricated planner', async ({ page }) => {
  await signIn(page, F.owner.email, { chooseWorkspace: F.workspaceA.name });
  await page.goto('/agent');

  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(/preview the steps|plan preview/i);
  record({
    route: '/agent',
    kind: 'button',
    label: 'Plan-preview control',
    role: 'ORG_OWNER',
    expected: 'control absent',
    actual: 'absent',
    pass: true,
  });

  // The tool list is a <select>, so its <option> text is never "visible" in
  // Playwright's sense -- assert on the option VALUES the backend supplied.
  const toolSelect = page.locator('select').first();
  await expect(toolSelect).toBeVisible({ timeout: 15_000 });
  const tools = await toolSelect.locator('option').evaluateAll((els) =>
    els.map((e) => (e as HTMLOptionElement).value).filter(Boolean),
  );
  const hasRealTools =
    tools.includes('createContact') && tools.includes('createOpportunity');
  record({
    route: '/agent',
    kind: 'select',
    label: 'Tool list',
    role: 'ORG_OWNER',
    expected: 'tools populated from GET agent/tools',
    actual: hasRealTools ? `${tools.length} tools: ${tools.join(', ')}` : 'EMPTY',
    network: 'GET /agent/tools',
    pass: hasRealTools,
  });
  expect(hasRealTools, `tool list was: ${tools.join(', ')}`).toBe(true);

  // Selecting a tool must reveal the parameter fields the backend publishes.
  // Before Phase 2 the registry published no schemas at all, so the console
  // could not tell anyone which fields an action needed.
  await toolSelect.selectOption('createOpportunity');
  const afterSelect = await page.locator('body').innerText();
  const showsParams = /pipelineId|stageId|value/i.test(afterSelect);
  record({
    route: '/agent',
    kind: 'form',
    label: 'Parameter fields for createOpportunity',
    role: 'ORG_OWNER',
    expected: 'named parameters shown from the published schema',
    actual: showsParams ? 'parameters shown' : 'NO PARAMETERS RENDERED',
    pass: showsParams,
  });

  // A high-risk tool must warn that submitting stages an approval rather than
  // running -- otherwise "nothing happened" looks like a failure.
  const warnsApproval = /approval/i.test(afterSelect);
  record({
    route: '/agent',
    kind: 'status-action',
    label: 'High-risk approval warning',
    role: 'ORG_OWNER',
    expected: 'console indicates this action may need approval',
    actual: warnsApproval ? 'warning shown' : 'no warning',
    pass: warnsApproval,
  });
});

// ===========================================================================
test('approval inbox: list, states, approve', async ({ page }) => {
  await signIn(page, F.owner.email, { chooseWorkspace: F.workspaceA.name });
  await page.goto('/approvals');

  await expect(page.getByText('createOpportunity').first()).toBeVisible({
    timeout: 15_000,
  });
  record({
    route: '/approvals',
    kind: 'nav',
    label: 'Approvals page load',
    role: 'ORG_OWNER',
    expected: 'pending requests listed',
    actual: 'listed',
    network: 'GET /agent/approvals',
    pass: true,
  });

  // The arguments must be shown verbatim so an approver can judge the request.
  await expect(page.getByText(/UAT High Value Deal/).first()).toBeVisible();
  record({
    route: '/approvals',
    kind: 'status-action',
    label: 'Request arguments',
    role: 'ORG_OWNER',
    expected: 'arguments shown verbatim',
    actual: 'visible',
    pass: true,
  });

  // A rejected request must remain visibly distinct from a cancelled one.
  await expect(page.getByText(/Rejected by an approver/i).first()).toBeVisible();
  record({
    route: '/approvals',
    kind: 'status-action',
    label: 'REJECTED status label',
    role: 'ORG_OWNER',
    expected: 'distinct from cancelled',
    actual: '"Rejected by an approver"',
    pass: true,
  });

  // The owner did not request this one, so they may approve it.
  const approveBtn = page
    .getByRole('button', { name: /approve and run/i })
    .first();
  await expect(approveBtn).toBeVisible();
  const net = await clickAndCapture(
    page,
    () => approveBtn.click(),
    '/agent/approvals/',
  );
  record({
    route: '/approvals',
    kind: 'button',
    label: 'Approve and run',
    role: 'ORG_OWNER',
    expected: 'POST resolve, row leaves pending',
    actual: net === 'NO REQUEST' ? 'DEAD BUTTON' : 'resolve requested',
    network: net,
    pass: net !== 'NO REQUEST',
  });
  expect(net, 'approve must issue a resolve request').not.toBe('NO REQUEST');
});

// ===========================================================================
test('a requester cannot self-approve', async ({ page }) => {
  // The admin REQUESTED the seeded approval, so approval controls for it must
  // not be offered to them -- only withdrawal.
  await signIn(page, F.admin.email);
  await page.goto('/approvals');
  await page.waitForLoadState('networkidle');

  const body = await page.locator('body').innerText();
  const selfApprovalOffered = /approve and run/i.test(body);
  record({
    route: '/approvals',
    kind: 'button',
    label: 'Approve control for own request',
    role: 'WORKSPACE_ADMIN (requester)',
    expected: 'not offered to the requester',
    actual: selfApprovalOffered ? 'OFFERED' : 'not offered',
    pass: !selfApprovalOffered,
  });
  expect(
    selfApprovalOffered,
    'a requester must not be able to self-approve',
  ).toBe(false);
});

// ===========================================================================
test('team management: list, invite, validate, revoke', async ({ page }) => {
  await signIn(page, F.owner.email, { chooseWorkspace: F.workspaceA.name });
  await page.goto('/team');

  await expect(page.getByText(F.admin.email).first()).toBeVisible({
    timeout: 15_000,
  });
  record({
    route: '/team',
    kind: 'nav',
    label: 'Team page load',
    role: 'ORG_OWNER',
    expected: 'members listed',
    actual: 'listed',
    network: 'GET /team/members',
    pass: true,
  });

  // No password hash may ever reach the browser.
  const teamBody = await page.locator('body').innerText();
  expect(teamBody).not.toMatch(/\$2[aby]\$\d{2}\$/);
  record({
    route: '/team',
    kind: 'status-action',
    label: 'Member payload',
    role: 'ORG_OWNER',
    expected: 'no password hash exposed',
    actual: 'none present',
    pass: true,
  });

  const emailInput = page.getByLabel(/email address to invite/i);
  const createBtn = page.getByRole('button', { name: /create link/i });

  // Blank email: the browser's own required-field validation must stop it, so
  // no request is made at all.
  await emailInput.fill('');
  const blankNet = await clickAndCapture(
    page,
    () => createBtn.click(),
    '/team/invitations',
  );
  record({
    route: '/team',
    kind: 'form',
    label: 'Invite form, blank email',
    role: 'ORG_OWNER',
    expected: 'refused before any request',
    actual: blankNet === 'NO REQUEST' ? 'no request made' : `requested: ${blankNet}`,
    network: blankNet,
    pass: blankNet === 'NO REQUEST',
  });

  // Invalid email: likewise refused client-side.
  await emailInput.fill('not-an-email');
  const badNet = await clickAndCapture(
    page,
    () => createBtn.click(),
    '/team/invitations',
  );
  record({
    route: '/team',
    kind: 'form',
    label: 'Invite form, invalid email',
    role: 'ORG_OWNER',
    expected: 'refused before any request',
    actual: badNet === 'NO REQUEST' ? 'no request made' : `requested: ${badNet}`,
    network: badNet,
    pass: badNet === 'NO REQUEST',
  });

  // A role select offering SUPERADMIN or AGENT would be an escalation surface.
  const roleSelect = page.getByLabel(/role for the invited person/i);
  const options = await roleSelect.locator('option').allTextContents();
  const offersForbidden = options.some((o) => /SUPERADMIN|AGENT/i.test(o));
  record({
    route: '/team',
    kind: 'select',
    label: 'Invite role select',
    role: 'ORG_OWNER',
    expected: 'SUPERADMIN and AGENT absent',
    actual: offersForbidden
      ? `OFFERS ${options.join(',')}`
      : 'only grantable roles',
    pass: !offersForbidden,
  });
  expect(offersForbidden, 'SUPERADMIN/AGENT must not be invitable').toBe(false);

  // A real invitation.
  const inviteEmail = `uat-newhire-${F.runId}@example.invalid`;
  await emailInput.fill(inviteEmail);
  const inviteNet = await clickAndCapture(
    page,
    () => createBtn.click(),
    '/team/invitations',
  );
  await expect(
    page.getByText(/shown once and cannot be retrieved/i),
  ).toBeVisible({ timeout: 15_000 });
  record({
    route: '/team',
    kind: 'button',
    label: 'Create link',
    role: 'ORG_OWNER',
    expected: 'POST invitation, one-time link shown with a warning',
    actual: 'link shown with retrieval warning',
    network: inviteNet,
    pass: inviteNet !== 'NO REQUEST',
  });

  // The pending invitation must appear in the outstanding list.
  await expect(page.getByText(inviteEmail).first()).toBeVisible({
    timeout: 15_000,
  });
  record({
    route: '/team',
    kind: 'table-action',
    label: 'Pending invitation row',
    role: 'ORG_OWNER',
    expected: 'new invitation appears as pending',
    actual: 'visible',
    pass: true,
  });

  // Revoke the invitation seeded for exactly this purpose.
  const revokeBtn = page
    .getByRole('button', { name: /^revoke$/i })
    .first();
  const revokeNet = await clickAndCapture(
    page,
    () => revokeBtn.click(),
    '/team/invitations/',
  );
  record({
    route: '/team',
    kind: 'table-action',
    label: 'Revoke invitation',
    role: 'ORG_OWNER',
    expected: 'DELETE invitation, row disappears',
    actual: revokeNet === 'NO REQUEST' ? 'DEAD BUTTON' : 'delete requested',
    network: revokeNet,
    pass: revokeNet !== 'NO REQUEST',
  });
  expect(revokeNet).not.toBe('NO REQUEST');
});

// ===========================================================================
test('workspace switching needs no password and carries names', async ({
  page,
}) => {
  await signIn(page, F.owner.email, { chooseWorkspace: F.workspaceA.name });

  const switcher = page.getByRole('button', { name: /switch workspace/i });
  await expect(switcher).toBeVisible();

  const membershipsNet = await clickAndCapture(
    page,
    () => switcher.click(),
    'api/auth/memberships',
  );
  record({
    route: '/dashboard',
    kind: 'modal',
    label: 'Switch workspace',
    role: 'ORG_OWNER',
    expected: 'opens picker by READING memberships, no password prompt',
    actual:
      membershipsNet === 'NO REQUEST' ? 'no memberships read' : 'memberships read',
    network: membershipsNet,
    pass: membershipsNet !== 'NO REQUEST',
  });

  // The defining assertion: no password field anywhere in the switch flow.
  const passwordFields = await page.locator('input[type="password"]').count();
  record({
    route: '/dashboard',
    kind: 'modal',
    label: 'Switch dialog password field',
    role: 'ORG_OWNER',
    expected: 'no password input',
    actual: passwordFields === 0 ? 'none' : `${passwordFields} PRESENT`,
    pass: passwordFields === 0,
  });
  expect(passwordFields, 'switching must not ask for a password').toBe(0);

  // Workspaces must be named, not shown as ids.
  const target = page.getByRole('button', {
    name: new RegExp(F.workspaceB.name, 'i'),
  });
  await expect(target).toBeVisible({ timeout: 15_000 });
  record({
    route: '/dashboard',
    kind: 'modal',
    label: 'Workspace choice list',
    role: 'ORG_OWNER',
    expected: 'workspaces shown by name',
    actual: `"${F.workspaceB.name}" visible`,
    pass: true,
  });

  const switchNet = await clickAndCapture(
    page,
    () => target.click(),
    '/api/session/switch-workspace',
  );
  await page.waitForURL(/\/dashboard/, { timeout: 20_000 });
  record({
    route: '/dashboard',
    kind: 'button',
    label: `Open workspace "${F.workspaceB.name}"`,
    role: 'ORG_OWNER',
    expected: 'POST switch-workspace, reload into the new workspace',
    actual: switchNet === 'NO REQUEST' ? 'DEAD BUTTON' : 'switch requested',
    network: switchNet,
    pass: switchNet !== 'NO REQUEST',
  });

  // The new workspace must actually be active.
  await expect(page.getByText(F.workspaceB.name).first()).toBeVisible({
    timeout: 15_000,
  });
  const after = await page.locator('body').innerText();
  record({
    route: '/dashboard',
    kind: 'status-action',
    label: 'Post-switch workspace context',
    role: 'ORG_OWNER',
    expected: 'new workspace named and active',
    actual: after.includes(F.workspaceB.name) ? 'new workspace active' : 'STALE',
    pass: after.includes(F.workspaceB.name),
  });

  await assertNoCredentialInStorage(page);
});
