import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './src/app.module';
import { PrismaClient, EngramState } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as jwt from 'jsonwebtoken';

dotenv.config();

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://antwannmitchellsr@localhost:5432/demm_crm';
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

let pass = 0;
let fail = 0;
function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`✅ [PASS] ${label}`);
    pass++;
  } else {
    console.log(`❌ [FAIL] ${label}`);
    fail++;
  }
}

async function runApiTests() {
  console.log(
    '🧪 STARTING ONBOARDING + SERVICE DELIVERY API SUITE (real HTTP, real guards)',
  );
  console.log(
    '=========================================================================',
  );

  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(0);
  const server = app.getHttpServer();
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const suffix = Date.now();
  const org = await prisma.organization.create({
    data: { name: `Onboarding Test Org ${suffix}` },
  });
  const buMktg = await prisma.businessUnit.create({
    data: { organizationId: org.id, key: 'MARKETING', name: 'DEMM Marketing' },
  });
  const buPhoto = await prisma.businessUnit.create({
    data: {
      organizationId: org.id,
      key: 'PHOTO_BOOTHS',
      name: 'DEMM Photo Booths',
    },
  });

  const wsMktg = await prisma.workspace.create({
    data: {
      organizationId: org.id,
      businessUnitId: buMktg.id,
      name: 'Marketing WS',
      subdomain: `onb-test-mktg-${suffix}`,
    },
  });
  const wsPhoto = await prisma.workspace.create({
    data: {
      organizationId: org.id,
      businessUnitId: buPhoto.id,
      name: 'Photo WS',
      subdomain: `onb-test-photo-${suffix}`,
    },
  });

  // Privileged user (ORG_ADMIN -- qualifies for launch-gate override).
  const adminUser = await prisma.user.create({
    data: {
      email: `onb-admin-${suffix}@example.com`,
      passwordHash: 'unused-in-this-test',
      firstName: 'Admin',
      lastName: 'Tester',
    },
  });
  await prisma.membership.create({
    data: {
      userId: adminUser.id,
      organizationId: org.id,
      workspaceId: wsMktg.id,
      role: 'ORG_ADMIN',
    },
  });
  await prisma.membership.create({
    data: {
      userId: adminUser.id,
      organizationId: org.id,
      workspaceId: wsPhoto.id,
      role: 'ORG_ADMIN',
    },
  });

  // Unprivileged user (USER role -- must be rejected on override attempts).
  const plainUser = await prisma.user.create({
    data: {
      email: `onb-plain-${suffix}@example.com`,
      passwordHash: 'unused-in-this-test',
      firstName: 'Plain',
      lastName: 'Tester',
    },
  });
  await prisma.membership.create({
    data: {
      userId: plainUser.id,
      organizationId: org.id,
      workspaceId: wsMktg.id,
      role: 'USER',
    },
  });

  const pipeline = await prisma.pipeline.create({
    data: { name: 'Onboarding Pipeline', workspaceId: wsMktg.id },
  });
  const stage = await prisma.stage.create({
    data: { name: 'New', order: 1, pipelineId: pipeline.id },
  });

  const adminToken = jwt.sign(
    { sub: adminUser.id, email: adminUser.email, workspaceId: wsMktg.id },
    process.env.JWT_SECRET!,
    { expiresIn: '15m' },
  );
  const plainToken = jwt.sign(
    { sub: plainUser.id, email: plainUser.email, workspaceId: wsMktg.id },
    process.env.JWT_SECRET!,
    { expiresIn: '15m' },
  );

  const adminHeaders = (workspaceId: string) => ({
    Authorization: `Bearer ${adminToken}`,
    'Content-Type': 'application/json',
    'x-workspace-id': workspaceId,
  });
  const plainHeaders = (workspaceId: string) => ({
    Authorization: `Bearer ${plainToken}`,
    'Content-Type': 'application/json',
    'x-workspace-id': workspaceId,
  });

  // =========================================================================
  // Setup: one ACTIVE Offer, matching real Commercial Truth Lock shape --
  // two includedServices, one onboardingRequirement, and (deliberately) NO
  // supportBoundaries/reportingCadence/cancellationTerms/expectedLaunchTime,
  // so this suite also covers check #14 (null commercial fields never get
  // fabricated) without a second Offer.
  // =========================================================================
  const createOfferRes = await fetch(`${base}/marketing/offers`, {
    method: 'POST',
    headers: adminHeaders(wsMktg.id),
    body: JSON.stringify({
      key: `onboarding-test-tier-${suffix}`,
      name: 'Onboarding Test Tier',
      price: 299,
      includedServices: ['Mirror microsite', 'Missed-call text-back'],
      excludedServices: [],
      onboardingRequirements: ['GHL sub-account provisioned by ALEXIS'],
    }),
  });
  const draftOffer = await createOfferRes.json();
  await fetch(`${base}/marketing/offers/${draftOffer.id}/lifecycle`, {
    method: 'POST',
    headers: adminHeaders(wsMktg.id),
    body: JSON.stringify({ state: 'ACTIVE' }),
  });
  const offer = draftOffer;

  async function createAndConvertLead(label: string) {
    const leadRes = await fetch(`${base}/marketing/leads`, {
      method: 'POST',
      headers: adminHeaders(wsMktg.id),
      body: JSON.stringify({
        firstName: label,
        lastName: 'Client',
        emails: [`${label.toLowerCase()}-${suffix}@example.com`],
        phones: [],
        pipelineId: pipeline.id,
        stageId: stage.id,
        expectedValue: 1000,
      }),
    });
    const lead = await leadRes.json();
    const convertRes = await fetch(
      `${base}/marketing/leads/${lead.contact.id}/convert`,
      {
        method: 'POST',
        headers: adminHeaders(wsMktg.id),
        body: JSON.stringify({ offerId: offer.id }),
      },
    );
    const clientAccount = await convertRes.json();
    return { lead, clientAccount };
  }

  // =========================================================================
  // Check 16 (run first, sets up the primary client): full conversion flow
  // still works and attaches an onboarding plan.
  // =========================================================================
  const { clientAccount: client1 } = await createAndConvertLead('Primary');
  const detail1Res = await fetch(`${base}/marketing/clients/${client1.id}`, {
    headers: adminHeaders(wsMktg.id),
  });
  const detail1 = await detail1Res.json();
  check(
    'Lead -> Client conversion still produces a ClientAccount with an attached onboarding plan',
    detail1.serviceStatus === 'PENDING_ONBOARDING' &&
      !!detail1.onboarding &&
      Array.isArray(detail1.onboarding.items),
  );

  // =========================================================================
  // Check 1: generated plan matches OfferSnapshot exactly.
  // =========================================================================
  const planRes = await fetch(
    `${base}/marketing/clients/${client1.id}/onboarding`,
    { headers: adminHeaders(wsMktg.id) },
  );
  const plan = await planRes.json();
  const demmItems = plan.items.filter((i: any) => i.responsibility === 'DEMM');
  const clientItems = plan.items.filter(
    (i: any) => i.responsibility === 'CLIENT',
  );
  check(
    'Generated checklist matches onboardingRequirements (+1 client item)',
    demmItems.length === 1 &&
      demmItems[0].sourceCapability === 'GHL sub-account provisioned by ALEXIS' &&
      clientItems.length === 1,
  );

  const deliverablesRes = await fetch(
    `${base}/marketing/clients/${client1.id}/deliverables`,
    { headers: adminHeaders(wsMktg.id) },
  );
  const deliverables = await deliverablesRes.json();
  check(
    'Generated deliverables match includedServices 1:1',
    deliverables.length === 2 &&
      deliverables.every((d: any) => !d.outsideScope && d.sourceCapability),
  );

  // =========================================================================
  // Check 10: deliverable shape.
  // =========================================================================
  check(
    'Every generated deliverable has a non-empty sourceCapability and outsideScope=false',
    deliverables.every(
      (d: any) => typeof d.sourceCapability === 'string' && d.sourceCapability.length > 0,
    ),
  );

  // =========================================================================
  // Check 14: null commercial fields never get fabricated.
  // =========================================================================
  check(
    'OfferSnapshot.expectedLaunchTime and plan.targetLaunchDate are null, not fabricated',
    detail1.offerSnapshot.expectedLaunchTime === null &&
      plan.targetLaunchDate === null,
  );

  // =========================================================================
  // Check 2: editing the canonical Offer does not change existing
  // deliverables/checklist (already frozen from the OfferSnapshot).
  // =========================================================================
  await fetch(`${base}/marketing/offers/${offer.id}`, {
    method: 'PUT',
    headers: adminHeaders(wsMktg.id),
    body: JSON.stringify({
      includedServices: ['A completely different capability'],
    }),
  });
  const deliverablesAfterEditRes = await fetch(
    `${base}/marketing/clients/${client1.id}/deliverables`,
    { headers: adminHeaders(wsMktg.id) },
  );
  const deliverablesAfterEdit = await deliverablesAfterEditRes.json();
  check(
    "Editing the canonical Offer does not retroactively change the client's deliverables",
    deliverablesAfterEdit.length === 2 &&
      deliverablesAfterEdit.some(
        (d: any) => d.sourceCapability === 'Mirror microsite',
      ),
  );

  // =========================================================================
  // Check 3: idempotent generation.
  // =========================================================================
  const beforeItemCount = await prisma.onboardingChecklistItem.count({
    where: { plan: { clientAccountId: client1.id } },
  });
  const beforeDeliverableCount = await prisma.serviceDeliverable.count({
    where: { clientAccountId: client1.id },
  });
  const regenRes = await fetch(
    `${base}/marketing/clients/${client1.id}/onboarding/generate`,
    { method: 'POST', headers: adminHeaders(wsMktg.id) },
  );
  const regenPlan = await regenRes.json();
  const afterItemCount = await prisma.onboardingChecklistItem.count({
    where: { plan: { clientAccountId: client1.id } },
  });
  const afterDeliverableCount = await prisma.serviceDeliverable.count({
    where: { clientAccountId: client1.id },
  });
  check(
    'Calling generate twice is idempotent -- same plan id, no duplicate rows',
    regenPlan.id === plan.id &&
      beforeItemCount === afterItemCount &&
      beforeDeliverableCount === afterDeliverableCount,
  );

  // =========================================================================
  // Check 15: generation against a nonexistent client creates nothing.
  // =========================================================================
  const bogusId = '00000000-0000-0000-0000-000000000000';
  const bogusGenRes = await fetch(
    `${base}/marketing/clients/${bogusId}/onboarding/generate`,
    { method: 'POST', headers: adminHeaders(wsMktg.id) },
  );
  const bogusPlanCount = await prisma.onboardingPlan.count({
    where: { clientAccountId: bogusId },
  });
  check(
    'Generation against a nonexistent client fails cleanly and creates zero rows',
    bogusGenRes.status === 404 && bogusPlanCount === 0,
  );

  // =========================================================================
  // Check 4: activation blocked while a required item is incomplete.
  // =========================================================================
  const blockedActivateRes = await fetch(
    `${base}/marketing/clients/${client1.id}/onboarding/activate`,
    { method: 'POST', headers: adminHeaders(wsMktg.id), body: JSON.stringify({}) },
  );
  const blockedActivateBody = await blockedActivateRes.json();
  check(
    'Activation is rejected (409) while a required item is incomplete',
    blockedActivateRes.status === 409 &&
      Array.isArray(blockedActivateBody.message?.blockingItems ?? blockedActivateBody.blockingItems),
  );

  // =========================================================================
  // Check 9: WAITING_ON_CLIENT / BLOCKED round-trip + blockers list.
  // =========================================================================
  const demmItemId = demmItems[0].id;
  await fetch(
    `${base}/marketing/clients/${client1.id}/onboarding/items/${demmItemId}`,
    {
      method: 'PATCH',
      headers: adminHeaders(wsMktg.id),
      body: JSON.stringify({ status: 'WAITING_ON_CLIENT' }),
    },
  );
  await fetch(
    `${base}/marketing/clients/${client1.id}/onboarding/items/${demmItemId}`,
    {
      method: 'PATCH',
      headers: adminHeaders(wsMktg.id),
      body: JSON.stringify({
        status: 'BLOCKED',
        blockerReason: 'Waiting on client GHL access',
      }),
    },
  );
  const planWithBlockerRes = await fetch(
    `${base}/marketing/clients/${client1.id}/onboarding`,
    { headers: adminHeaders(wsMktg.id) },
  );
  const planWithBlocker = await planWithBlockerRes.json();
  check(
    'BLOCKED item with a blockerReason appears in the computed blockers list',
    planWithBlocker.blockers.some(
      (b: any) => b.id === demmItemId && b.blockerReason === 'Waiting on client GHL access',
    ),
  );

  // =========================================================================
  // Check 5: complete every required item, then activate succeeds.
  // =========================================================================
  await fetch(
    `${base}/marketing/clients/${client1.id}/onboarding/items/${demmItemId}`,
    {
      method: 'PATCH',
      headers: adminHeaders(wsMktg.id),
      body: JSON.stringify({ status: 'COMPLETE' }),
    },
  );
  const clientItemId = clientItems[0].id;
  await fetch(
    `${base}/marketing/clients/${client1.id}/onboarding/items/${clientItemId}`,
    {
      method: 'PATCH',
      headers: adminHeaders(wsMktg.id),
      body: JSON.stringify({ status: 'COMPLETE' }),
    },
  );
  const activateRes = await fetch(
    `${base}/marketing/clients/${client1.id}/onboarding/activate`,
    { method: 'POST', headers: adminHeaders(wsMktg.id), body: JSON.stringify({}) },
  );
  const activated = await activateRes.json();
  check(
    'Activation succeeds once all required items are COMPLETE',
    activateRes.status < 300 && activated.serviceStatus === 'ACTIVE',
  );

  // =========================================================================
  // Check 8: cross-BU isolation -- Photo Booths workspace cannot see this
  // Marketing client's onboarding/deliverables at all.
  // =========================================================================
  const crossBuOnboardingRes = await fetch(
    `${base}/marketing/clients/${client1.id}/onboarding`,
    { headers: adminHeaders(wsPhoto.id) },
  );
  const crossBuDeliverablesRes = await fetch(
    `${base}/marketing/clients/${client1.id}/deliverables`,
    { headers: adminHeaders(wsPhoto.id) },
  );
  check(
    'A different Business Unit cannot see this client onboarding/deliverables (404/403 on both)',
    crossBuOnboardingRes.status >= 400 && crossBuDeliverablesRes.status >= 400,
  );

  // =========================================================================
  // Checks 6 + 7: override authorization.
  // =========================================================================
  const { clientAccount: client2 } = await createAndConvertLead('Override');

  const unauthorizedOverrideRes = await fetch(
    `${base}/marketing/clients/${client2.id}/onboarding/activate`,
    {
      method: 'POST',
      headers: plainHeaders(wsMktg.id),
      body: JSON.stringify({ override: { reason: 'I want to skip it' } }),
    },
  );
  const overridesBeforeCount = await prisma.launchGateOverride.count({
    where: { plan: { clientAccountId: client2.id } },
  });
  check(
    'Override attempt by a USER-role caller is rejected (403), no override row created',
    unauthorizedOverrideRes.status === 403 && overridesBeforeCount === 0,
  );

  const client2PlanRes = await fetch(
    `${base}/marketing/clients/${client2.id}/onboarding`,
    { headers: adminHeaders(wsMktg.id) },
  );
  const client2Plan = await client2PlanRes.json();
  const client2RequiredIncomplete = client2Plan.items.filter(
    (i: any) => i.required && i.status !== 'COMPLETE' && i.status !== 'WAIVED',
  );

  const authorizedOverrideRes = await fetch(
    `${base}/marketing/clients/${client2.id}/onboarding/activate`,
    {
      method: 'POST',
      headers: adminHeaders(wsMktg.id),
      body: JSON.stringify({ override: { reason: 'Antwann approved early launch' } }),
    },
  );
  const authorizedOverride = await authorizedOverrideRes.json();
  const overrideRow = await prisma.launchGateOverride.findFirst({
    where: { plan: { clientAccountId: client2.id } },
  });
  const expectedGateIds = client2RequiredIncomplete.map((i: any) => i.id).sort();
  const actualGateIds = (overrideRow?.affectedGates ?? []).slice().sort();
  check(
    'Override by a qualifying role succeeds and records the exact blocked item ids',
    authorizedOverrideRes.status < 300 &&
      authorizedOverride.serviceStatus === 'ACTIVE' &&
      JSON.stringify(expectedGateIds) === JSON.stringify(actualGateIds) &&
      expectedGateIds.length > 0,
  );

  // =========================================================================
  // Check 11: outside-scope deliverable always outsideScope=true.
  // =========================================================================
  const outsideScopeRes = await fetch(
    `${base}/marketing/clients/${client1.id}/deliverables`,
    {
      method: 'POST',
      headers: adminHeaders(wsMktg.id),
      body: JSON.stringify({
        name: 'Custom landing page build',
        cadence: 'ONE_TIME',
      }),
    },
  );
  const outsideScopeDeliverable = await outsideScopeRes.json();
  check(
    'POST outside-scope deliverable always has outsideScope=true (DTO has no client-settable field for it)',
    outsideScopeDeliverable.outsideScope === true,
  );

  // =========================================================================
  // Check 12: DOM26-R onboarding milestones are ACTIVE, observed Engrams
  // with provenance referencing the clientAccountId, matching the
  // conversion-milestone pattern from Sub-project 1.
  // =========================================================================
  const client1Contact = await prisma.clientAccount.findUnique({
    where: { id: client1.id },
    select: { primaryContactId: true },
  });
  const client1Profile = await prisma.relationshipProfile.findFirst({
    where: {
      businessUnitId: buMktg.id,
      subject: { contactId: client1Contact!.primaryContactId },
    },
  });
  const onboardingEngrams = await prisma.engram.findMany({
    where: {
      profileId: client1Profile?.id,
      summary: { contains: 'Onboarding plan generated' },
    },
    include: { evidence: { include: { source: true } } },
  });
  check(
    'Onboarding-plan-generated milestone is an ACTIVE, observed Engram with clientAccountId provenance',
    onboardingEngrams.length === 1 &&
      onboardingEngrams[0].state === EngramState.ACTIVE &&
      onboardingEngrams[0].truthClassification === 'OBSERVED' &&
      onboardingEngrams[0].evidence.some(
        (e) => e.source.referenceId === client1.id,
      ),
  );

  const activationEngrams = await prisma.engram.findMany({
    where: {
      profileId: client1Profile?.id,
      summary: { contains: 'Client activated' },
    },
  });
  check(
    'Client-activated milestone recorded as an Engram (not a pending candidate)',
    activationEngrams.length === 1,
  );

  // =========================================================================
  // Check 13: Relationship Brief CUSTOMER_VISIBLE tier still strips internal
  // fields even when onboarding content exists (reuses the existing DOM26-R
  // brief endpoint from Sub-project 1 -- no new backend surface here).
  // =========================================================================
  const briefRes = await fetch(`${base}/dom26r/relationship-briefs`, {
    method: 'POST',
    headers: adminHeaders(wsMktg.id),
    body: JSON.stringify({
      profileId: client1Profile!.id,
      briefText: 'Client onboarded and activated on the Onboarding Test Tier offer.',
      generator: 'test-suite',
      version: 'v1',
      sensitivity: 'PUBLIC',
      engramIds: [onboardingEngrams[0].id],
    }),
  });
  const brief = await briefRes.json();
  const customerBriefRes = await fetch(
    `${base}/dom26r/relationship-briefs/${brief.id}?view=CUSTOMER_VISIBLE`,
    { headers: adminHeaders(wsMktg.id) },
  );
  const customerBrief = await customerBriefRes.json();
  check(
    'CUSTOMER_VISIBLE brief view strips internal fields even with onboarding content present',
    customerBrief.briefText === brief.briefText &&
      customerBrief.generator === undefined &&
      customerBrief.evidence === undefined,
  );

  await app.close();

  console.log('\n🧹 Cleaning up test database records...');
  await prisma.launchGateOverride.deleteMany({
    where: { plan: { clientAccount: { businessUnitId: buMktg.id } } },
  });
  await prisma.onboardingChecklistItemHistory.deleteMany({
    where: { item: { plan: { clientAccount: { businessUnitId: buMktg.id } } } },
  });
  await prisma.onboardingChecklistItem.deleteMany({
    where: { plan: { clientAccount: { businessUnitId: buMktg.id } } },
  });
  await prisma.onboardingPlan.deleteMany({
    where: { clientAccount: { businessUnitId: buMktg.id } },
  });
  await prisma.serviceDeliverableHistory.deleteMany({
    where: { deliverable: { clientAccount: { businessUnitId: buMktg.id } } },
  });
  await prisma.serviceDeliverable.deleteMany({
    where: { clientAccount: { businessUnitId: buMktg.id } },
  });

  await prisma.memoryAuditEvent.deleteMany({
    where: { businessUnitId: buMktg.id },
  });
  await prisma.briefEvidence.deleteMany({
    where: { brief: { profile: { businessUnitId: buMktg.id } } },
  });
  await prisma.relationshipBrief.deleteMany({
    where: { profile: { businessUnitId: buMktg.id } },
  });
  const candidateEvidenceRows = await prisma.candidateEvidence.findMany({
    where: { candidate: { profile: { businessUnitId: buMktg.id } } },
    select: { sourceId: true },
  });
  const engramEvidenceRows = await prisma.engramEvidence.findMany({
    where: { engram: { businessUnitId: buMktg.id } },
    select: { sourceId: true },
  });
  const ownedSourceIds = [
    ...new Set([
      ...candidateEvidenceRows.map((r) => r.sourceId),
      ...engramEvidenceRows.map((r) => r.sourceId),
    ]),
  ];
  await prisma.candidateEvidence.deleteMany({
    where: { candidate: { profile: { businessUnitId: buMktg.id } } },
  });
  await prisma.memoryApproval.deleteMany({
    where: { candidate: { profile: { businessUnitId: buMktg.id } } },
  });
  await prisma.memoryCandidate.deleteMany({
    where: { profile: { businessUnitId: buMktg.id } },
  });
  await prisma.engramEvidence.deleteMany({
    where: { engram: { businessUnitId: buMktg.id } },
  });
  await prisma.engram.deleteMany({ where: { businessUnitId: buMktg.id } });
  await prisma.engramSource.deleteMany({
    where: { id: { in: ownedSourceIds } },
  });
  await prisma.relationshipProfile.deleteMany({
    where: { businessUnitId: buMktg.id },
  });
  await prisma.relationshipSubject.deleteMany({
    where: {
      OR: [
        { contact: { workspaceId: wsMktg.id } },
        { company: { workspaceId: wsMktg.id } },
      ],
    },
  });
  await prisma.clientCommercialStateChange.deleteMany({
    where: { clientAccount: { businessUnitId: buMktg.id } },
  });
  await prisma.conversionIdempotencyKey.deleteMany({
    where: { clientAccount: { businessUnitId: buMktg.id } },
  });
  await prisma.clientAccount.deleteMany({
    where: { businessUnitId: buMktg.id },
  });
  await prisma.offerSnapshot.deleteMany({
    where: { offer: { businessUnitId: buMktg.id } },
  });
  await prisma.offer.deleteMany({ where: { businessUnitId: buMktg.id } });
  await prisma.auditLog.deleteMany({
    where: { workspaceId: { in: [wsMktg.id, wsPhoto.id] } },
  });
  await prisma.task.deleteMany({
    where: { workspaceId: { in: [wsMktg.id, wsPhoto.id] } },
  });
  await prisma.opportunity.deleteMany({
    where: { workspaceId: { in: [wsMktg.id, wsPhoto.id] } },
  });
  await prisma.stage.deleteMany({ where: { pipelineId: pipeline.id } });
  await prisma.pipeline.deleteMany({ where: { id: pipeline.id } });
  await prisma.contact.deleteMany({
    where: { workspaceId: { in: [wsMktg.id, wsPhoto.id] } },
  });
  await prisma.company.deleteMany({
    where: { workspaceId: { in: [wsMktg.id, wsPhoto.id] } },
  });
  await prisma.membership.deleteMany({
    where: { userId: { in: [adminUser.id, plainUser.id] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [adminUser.id, plainUser.id] } },
  });
  await prisma.workspace.deleteMany({
    where: { id: { in: [wsMktg.id, wsPhoto.id] } },
  });
  await prisma.businessUnit.deleteMany({
    where: { id: { in: [buMktg.id, buPhoto.id] } },
  });
  await prisma.organization.delete({ where: { id: org.id } });
  console.log('✅ Cleanup complete.');

  console.log(
    '=========================================================================',
  );
  console.log(
    `📊 ONBOARDING + SERVICE DELIVERY API SUITE: ${pass} passed, ${fail} failed.`,
  );
  if (fail > 0) process.exit(1);
}

runApiTests()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
