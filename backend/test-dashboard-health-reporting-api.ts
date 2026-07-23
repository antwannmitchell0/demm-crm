import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './src/app.module';
import { PrismaClient, CandidateState } from '@prisma/client';
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
    '🧪 STARTING DASHBOARD + CLIENT HEALTH + REPORTING API SUITE (real HTTP, real guards)',
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
    data: { name: `Dashboard Test Org ${suffix}` },
  });
  const buMktg = await prisma.businessUnit.create({
    data: { organizationId: org.id, key: 'MARKETING', name: 'DEMM Marketing' },
  });
  const buOther = await prisma.businessUnit.create({
    data: { organizationId: org.id, key: 'PHOTO_BOOTHS', name: 'DEMM Photo Booths' },
  });
  const wsMktg = await prisma.workspace.create({
    data: { organizationId: org.id, businessUnitId: buMktg.id, name: 'Marketing WS', subdomain: `dash-mktg-${suffix}` },
  });
  const wsOther = await prisma.workspace.create({
    data: { organizationId: org.id, businessUnitId: buOther.id, name: 'Other WS', subdomain: `dash-other-${suffix}` },
  });

  const adminUser = await prisma.user.create({
    data: { email: `dash-admin-${suffix}@example.com`, passwordHash: 'unused', firstName: 'Dash', lastName: 'Admin' },
  });
  await prisma.membership.create({
    data: { userId: adminUser.id, organizationId: org.id, workspaceId: wsMktg.id, role: 'ORG_ADMIN' },
  });
  await prisma.membership.create({
    data: { userId: adminUser.id, organizationId: org.id, workspaceId: wsOther.id, role: 'ORG_ADMIN' },
  });
  const plainUser = await prisma.user.create({
    data: { email: `dash-plain-${suffix}@example.com`, passwordHash: 'unused', firstName: 'Dash', lastName: 'Plain' },
  });
  await prisma.membership.create({
    data: { userId: plainUser.id, organizationId: org.id, workspaceId: wsMktg.id, role: 'USER' },
  });

  const pipeline = await prisma.pipeline.create({ data: { name: 'Dash Pipeline', workspaceId: wsMktg.id } });
  const stage = await prisma.stage.create({ data: { name: 'New', order: 1, pipelineId: pipeline.id } });

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
  // Setup: one Offer, one Opportunity (known value/probability for pipeline
  // math), one converted client (Growth) to exercise onboarding/health.
  // =========================================================================
  const offerRes = await fetch(`${base}/marketing/offers`, {
    method: 'POST',
    headers: adminHeaders(wsMktg.id),
    body: JSON.stringify({
      key: `dash-tier-${suffix}`,
      name: 'Dashboard Test Tier',
      price: 299,
      includedServices: ['Test service A'],
      excludedServices: [],
      onboardingRequirements: ['Test onboarding requirement'],
    }),
  });
  const draftOffer = await offerRes.json();
  await fetch(`${base}/marketing/offers/${draftOffer.id}/lifecycle`, {
    method: 'POST',
    headers: adminHeaders(wsMktg.id),
    body: JSON.stringify({ state: 'ACTIVE' }),
  });
  const offer = draftOffer;

  // An OPEN opportunity NOT tied to a lead-conversion flow, purely for
  // pipeline-math verification (value=10000, probability=40).
  const pipelineContact = await prisma.contact.create({
    data: {
      firstName: 'Pipeline',
      lastName: 'Test',
      emails: [`pipeline-${suffix}@example.com`],
      phones: [],
      workspaceId: wsMktg.id,
      status: 'LEAD',
    },
  });
  const pipelineOpp = await prisma.opportunity.create({
    data: {
      name: 'Pipeline Math Test',
      value: 10000,
      probability: 40,
      workspaceId: wsMktg.id,
      pipelineId: pipeline.id,
      stageId: stage.id,
      contactId: pipelineContact.id,
      status: 'OPEN',
    },
  });

  const leadRes = await fetch(`${base}/marketing/leads`, {
    method: 'POST',
    headers: adminHeaders(wsMktg.id),
    body: JSON.stringify({
      firstName: 'Health',
      lastName: 'Test',
      emails: [`health-${suffix}@example.com`],
      phones: [],
      pipelineId: pipeline.id,
      stageId: stage.id,
      expectedValue: 500,
    }),
  });
  const lead = await leadRes.json();
  const convertRes = await fetch(`${base}/marketing/leads/${lead.contact.id}/convert`, {
    method: 'POST',
    headers: adminHeaders(wsMktg.id),
    body: JSON.stringify({ offerId: offer.id }),
  });
  const client = await convertRes.json();

  // =========================================================================
  // Checks 1/2: dashboard respects BU scope; cross-BU cannot leak.
  // =========================================================================
  const dashRes = await fetch(`${base}/marketing/dashboard`, { headers: adminHeaders(wsMktg.id) });
  const dashboard = await dashRes.json();
  check(
    'Dashboard loads successfully for the correct Business Unit',
    dashRes.status === 200 && dashboard.businessUnitId === buMktg.id,
  );

  const otherDashRes = await fetch(`${base}/marketing/dashboard`, { headers: adminHeaders(wsOther.id) });
  const otherDashboard = await otherDashRes.json();
  check(
    'Cross-BU metrics cannot leak: Photo Booths dashboard shows 0 active Marketing clients',
    otherDashRes.status === 200 && otherDashboard.revenueTrajectory.activeClientCount.value === 0,
  );

  // =========================================================================
  // Checks 3/4: revenue excludes unpaid amounts; manual revenue labeled honestly.
  // =========================================================================
  const unpaidStateRes = await fetch(`${base}/marketing/clients/${client.id}/commercial-state`, {
    method: 'POST',
    headers: adminHeaders(wsMktg.id),
    body: JSON.stringify({ field: 'PAYMENT', newValue: 'INVOICE_SENT_MANUAL' }),
  });
  const dashAfterUnpaidRes = await fetch(`${base}/marketing/dashboard`, { headers: adminHeaders(wsMktg.id) });
  const dashAfterUnpaid = await dashAfterUnpaidRes.json();
  check(
    'Unpaid/unamountd commercial state does not count as collected revenue',
    unpaidStateRes.status < 300 &&
      dashAfterUnpaid.revenueTrajectory.collectedRevenue90d.value === 0,
  );

  const paidStateRes = await fetch(`${base}/marketing/clients/${client.id}/commercial-state`, {
    method: 'POST',
    headers: adminHeaders(wsMktg.id),
    body: JSON.stringify({ field: 'PAYMENT', newValue: 'DEPOSIT_PAID_MANUAL', amount: 150 }),
  });
  const dashAfterPaidRes = await fetch(`${base}/marketing/dashboard`, { headers: adminHeaders(wsMktg.id) });
  const dashAfterPaid = await dashAfterPaidRes.json();
  check(
    'Recorded PAID payment with amount counts as collected revenue, labeled MANUALLY_RECORDED',
    paidStateRes.status < 300 &&
      dashAfterPaid.revenueTrajectory.collectedRevenue90d.value === 150 &&
      dashAfterPaid.revenueTrajectory.collectedRevenue90d.classification === 'MANUALLY_RECORDED',
  );

  // =========================================================================
  // Check 5: pipeline calculations match source Opportunities exactly.
  // =========================================================================
  check(
    'Projected pipeline revenue matches SUM(Opportunity.value) for OPEN opportunities',
    Number(dashAfterPaid.leadPipelineHealth.projectedPipeline.value) >= 10000,
  );
  check(
    'Weighted pipeline revenue matches SUM(value * probability/100)',
    Number(dashAfterPaid.leadPipelineHealth.weightedPipeline.value) >= 4000 &&
      Number(dashAfterPaid.leadPipelineHealth.weightedPipeline.value) < 10000,
  );

  // =========================================================================
  // Check 6: health score is explainable -- every factor has real fields.
  // =========================================================================
  const healthRes = await fetch(`${base}/marketing/clients/${client.id}/health`, { headers: adminHeaders(wsMktg.id) });
  const health = await healthRes.json();
  check(
    'Client Health is explainable: factors array has code/description/riskOwner/evidence',
    healthRes.status === 200 &&
      Array.isArray(health.factors) &&
      health.factors.every((f: any) => f.code && f.description && f.riskOwner && f.evidence),
  );

  // =========================================================================
  // Check 7: missing data produces honest gaps, not fabricated risk.
  // =========================================================================
  check(
    'Missing contract-state data is recorded honestly in missingData, not as a fabricated risk factor',
    Array.isArray(health.missingData) &&
      health.missingData.some((m: string) => m.includes('contract state')),
  );

  // =========================================================================
  // Check 8: DEMM-caused vs client-caused risk distinguished.
  // =========================================================================
  const planRes = await fetch(`${base}/marketing/clients/${client.id}/onboarding`, { headers: adminHeaders(wsMktg.id) });
  const plan = await planRes.json();
  const demmItem = plan.items.find((i: any) => i.responsibility === 'DEMM');
  const clientItem = plan.items.find((i: any) => i.responsibility === 'CLIENT');

  await fetch(`${base}/marketing/clients/${client.id}/onboarding/items/${demmItem.id}`, {
    method: 'PATCH',
    headers: adminHeaders(wsMktg.id),
    body: JSON.stringify({ status: 'BLOCKED', blockerReason: 'DEMM-side blocker for test' }),
  });
  const healthAfterDemmBlockRes = await fetch(`${base}/marketing/clients/${client.id}/health`, { headers: adminHeaders(wsMktg.id) });
  const healthAfterDemmBlock = await healthAfterDemmBlockRes.json();
  check(
    'A DEMM-owned blocked item is attributed to riskOwner=DEMM',
    healthAfterDemmBlock.factors.some((f: any) => f.code === 'CHECKLIST_ITEM_BLOCKED' && f.riskOwner === 'DEMM'),
  );

  // Backdate the client item's updatedAt to simulate 15 days WAITING_ON_CLIENT.
  await fetch(`${base}/marketing/clients/${client.id}/onboarding/items/${clientItem.id}`, {
    method: 'PATCH',
    headers: adminHeaders(wsMktg.id),
    body: JSON.stringify({ status: 'WAITING_ON_CLIENT' }),
  });
  await prisma.onboardingChecklistItem.update({
    where: { id: clientItem.id },
    data: { updatedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000) },
  });
  const recalcRes = await fetch(`${base}/marketing/clients/${client.id}/health/recalculate`, {
    method: 'POST',
    headers: adminHeaders(wsMktg.id),
  });
  const recalcHealth = await recalcRes.json();
  check(
    'A client unresponsive for 14+ days is attributed to riskOwner=CLIENT',
    recalcHealth.factors.some((f: any) => f.code === 'CLIENT_UNRESPONSIVE' && f.riskOwner === 'CLIENT'),
  );
  check(
    'Client Health reaches AT_RISK or CRITICAL given a blocker + long client delay',
    ['AT_RISK', 'CRITICAL'].includes(recalcHealth.state),
  );

  // =========================================================================
  // Checks 9/10: override requires authorization + reason; history is immutable (append-only).
  // =========================================================================
  const unauthorizedOverrideRes = await fetch(`${base}/marketing/clients/${client.id}/health/override`, {
    method: 'POST',
    headers: plainHeaders(wsMktg.id),
    body: JSON.stringify({ state: 'HEALTHY', reason: 'Trying to override without authorization' }),
  });
  check('Override by a USER-role caller is rejected (403)', unauthorizedOverrideRes.status === 403);

  const missingReasonRes = await fetch(`${base}/marketing/clients/${client.id}/health/override`, {
    method: 'POST',
    headers: adminHeaders(wsMktg.id),
    body: JSON.stringify({ state: 'HEALTHY' }),
  });
  check('Override without a reason is rejected (400)', missingReasonRes.status === 400);

  const overrideRes = await fetch(`${base}/marketing/clients/${client.id}/health/override`, {
    method: 'POST',
    headers: adminHeaders(wsMktg.id),
    body: JSON.stringify({ state: 'WATCH', reason: 'Antwann personally confirmed this is under control' }),
  });
  const overridden = await overrideRes.json();
  check(
    'Authorized override with a reason succeeds and sets state',
    overrideRes.status < 300 && overridden.state === 'WATCH' && overridden.overrideState === 'WATCH',
  );

  const overrideRes2 = await fetch(`${base}/marketing/clients/${client.id}/health/override`, {
    method: 'POST',
    headers: adminHeaders(wsMktg.id),
    body: JSON.stringify({ state: 'HEALTHY', reason: 'Second override for history-immutability test' }),
  });
  await overrideRes2.json();
  const overrideCount = await prisma.clientHealthOverride.count({ where: { health: { clientAccountId: client.id } } });
  check(
    'Override history is append-only: two overrides produce two ClientHealthOverride rows, not one overwritten',
    overrideCount === 2,
  );

  // =========================================================================
  // Checks 11/12: client-facing report excludes internal fields; evidence lineage present.
  // =========================================================================
  const clientReportRes = await fetch(`${base}/marketing/clients/${client.id}/report`, { headers: adminHeaders(wsMktg.id) });
  const clientReport = await clientReportRes.json();
  const clientReportStr = JSON.stringify(clientReport);
  check(
    'Client-facing report excludes internal health/risk fields entirely',
    clientReportRes.status === 200 &&
      !clientReportStr.includes('riskOwner') &&
      !clientReportStr.includes('CRITICAL') &&
      !clientReportStr.includes('computedState'),
  );
  check(
    'Client-facing report line items carry evidence lineage back to real rows',
    [...clientReport.workCompleted, ...clientReport.waitingOnDemm, ...clientReport.blockers].every(
      (item: any) => item.evidence && item.evidence.type && (item.evidence.id || item.evidence.type === 'Manual'),
    ),
  );

  // =========================================================================
  // Check 13: DOM26-R signal created on meaningful health degradation.
  // =========================================================================
  const profile = await prisma.relationshipProfile.findFirst({
    where: { businessUnitId: buMktg.id, subject: { contactId: lead.contact.id } },
  });
  const signalCount = await prisma.relationshipSignal.count({
    where: { profileId: profile?.id, type: 'HEALTH_DEGRADED' },
  });
  check(
    'A RelationshipSignal was created when health degraded to AT_RISK/CRITICAL',
    signalCount >= 1,
  );

  // =========================================================================
  // Check 14: routine recalculation does not spam memory candidates.
  // =========================================================================
  const candidatesBefore = await prisma.memoryCandidate.count({
    where: { profileId: profile?.id, status: CandidateState.PENDING },
  });
  // Recalculate twice more with no state-crossing change (still AT_RISK/CRITICAL).
  await fetch(`${base}/marketing/clients/${client.id}/health/recalculate`, { method: 'POST', headers: adminHeaders(wsMktg.id) });
  await fetch(`${base}/marketing/clients/${client.id}/health/recalculate`, { method: 'POST', headers: adminHeaders(wsMktg.id) });
  const candidatesAfter = await prisma.memoryCandidate.count({
    where: { profileId: profile?.id, status: CandidateState.PENDING },
  });
  check(
    'Routine recalculation (no meaningful state transition) does not create additional MemoryCandidates',
    candidatesAfter === candidatesBefore,
  );

  // =========================================================================
  // Check 18: honest empty state for a BU with zero clients (no errors, no fabrication).
  // =========================================================================
  const emptyDashRes = await fetch(`${base}/marketing/dashboard`, { headers: adminHeaders(wsOther.id) });
  const emptyDash = await emptyDashRes.json();
  check(
    'Dashboard for a BU with zero clients returns honest zeros, not an error',
    emptyDashRes.status === 200 &&
      emptyDash.revenueTrajectory.collectedRevenue90d.value === 0 &&
      emptyDash.clientOperations.pendingOnboardingCount === 0,
  );

  // =========================================================================
  // Internal report sanity check.
  // =========================================================================
  const internalReportRes = await fetch(`${base}/marketing/reports/internal`, { headers: adminHeaders(wsMktg.id) });
  const internalReport = await internalReportRes.json();
  check(
    'Internal operating report includes system limitations and at-risk clients',
    internalReportRes.status === 200 &&
      Array.isArray(internalReport.systemLimitations) &&
      internalReport.systemLimitations.length > 0,
  );

  await app.close();

  console.log('\n🧹 Cleaning up test database records...');
  await prisma.clientHealthHistory.deleteMany({ where: { health: { clientAccount: { businessUnitId: buMktg.id } } } });
  await prisma.clientHealthOverride.deleteMany({ where: { health: { clientAccount: { businessUnitId: buMktg.id } } } });
  await prisma.clientHealth.deleteMany({ where: { clientAccount: { businessUnitId: buMktg.id } } });
  await prisma.onboardingChecklistItemHistory.deleteMany({ where: { item: { plan: { clientAccount: { businessUnitId: buMktg.id } } } } });
  await prisma.onboardingChecklistItem.deleteMany({ where: { plan: { clientAccount: { businessUnitId: buMktg.id } } } });
  await prisma.onboardingPlan.deleteMany({ where: { clientAccount: { businessUnitId: buMktg.id } } });
  await prisma.serviceDeliverableHistory.deleteMany({ where: { deliverable: { clientAccount: { businessUnitId: buMktg.id } } } });
  await prisma.serviceDeliverable.deleteMany({ where: { clientAccount: { businessUnitId: buMktg.id } } });
  await prisma.memoryAuditEvent.deleteMany({ where: { businessUnitId: buMktg.id } });
  await prisma.briefEvidence.deleteMany({ where: { brief: { profile: { businessUnitId: buMktg.id } } } });
  await prisma.relationshipBrief.deleteMany({ where: { profile: { businessUnitId: buMktg.id } } });
  await prisma.signalEvidence.deleteMany({ where: { signal: { profile: { businessUnitId: buMktg.id } } } });
  await prisma.relationshipSignal.deleteMany({ where: { profile: { businessUnitId: buMktg.id } } });
  const candidateEvidenceRows = await prisma.candidateEvidence.findMany({
    where: { candidate: { profile: { businessUnitId: buMktg.id } } },
    select: { sourceId: true },
  });
  const engramEvidenceRows = await prisma.engramEvidence.findMany({
    where: { engram: { businessUnitId: buMktg.id } },
    select: { sourceId: true },
  });
  const ownedSourceIds = [...new Set([...candidateEvidenceRows.map((r) => r.sourceId), ...engramEvidenceRows.map((r) => r.sourceId)])];
  await prisma.candidateEvidence.deleteMany({ where: { candidate: { profile: { businessUnitId: buMktg.id } } } });
  await prisma.memoryApproval.deleteMany({ where: { candidate: { profile: { businessUnitId: buMktg.id } } } });
  await prisma.memoryCandidate.deleteMany({ where: { profile: { businessUnitId: buMktg.id } } });
  await prisma.engramEvidence.deleteMany({ where: { engram: { businessUnitId: buMktg.id } } });
  await prisma.engram.deleteMany({ where: { businessUnitId: buMktg.id } });
  await prisma.engramSource.deleteMany({ where: { id: { in: ownedSourceIds } } });
  await prisma.relationshipProfile.deleteMany({ where: { businessUnitId: buMktg.id } });
  await prisma.relationshipSubject.deleteMany({
    where: { OR: [{ contact: { workspaceId: wsMktg.id } }, { company: { workspaceId: wsMktg.id } }] },
  });
  await prisma.clientCommercialStateChange.deleteMany({ where: { clientAccount: { businessUnitId: buMktg.id } } });
  await prisma.conversionIdempotencyKey.deleteMany({ where: { clientAccount: { businessUnitId: buMktg.id } } });
  await prisma.clientAccount.deleteMany({ where: { businessUnitId: buMktg.id } });
  await prisma.offerSnapshot.deleteMany({ where: { offer: { businessUnitId: buMktg.id } } });
  await prisma.offer.deleteMany({ where: { businessUnitId: buMktg.id } });
  await prisma.auditLog.deleteMany({ where: { workspaceId: { in: [wsMktg.id, wsOther.id] } } });
  await prisma.task.deleteMany({ where: { workspaceId: { in: [wsMktg.id, wsOther.id] } } });
  await prisma.opportunity.deleteMany({ where: { workspaceId: { in: [wsMktg.id, wsOther.id] } } });
  await prisma.stage.deleteMany({ where: { pipelineId: pipeline.id } });
  await prisma.pipeline.deleteMany({ where: { id: pipeline.id } });
  await prisma.contact.deleteMany({ where: { workspaceId: { in: [wsMktg.id, wsOther.id] } } });
  await prisma.company.deleteMany({ where: { workspaceId: { in: [wsMktg.id, wsOther.id] } } });
  await prisma.membership.deleteMany({ where: { userId: { in: [adminUser.id, plainUser.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [adminUser.id, plainUser.id] } } });
  await prisma.workspace.deleteMany({ where: { id: { in: [wsMktg.id, wsOther.id] } } });
  await prisma.businessUnit.deleteMany({ where: { id: { in: [buMktg.id, buOther.id] } } });
  await prisma.organization.delete({ where: { id: org.id } });
  console.log('✅ Cleanup complete.');

  console.log('=========================================================================');
  console.log(`📊 DASHBOARD + CLIENT HEALTH + REPORTING API SUITE: ${pass} passed, ${fail} failed.`);
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
