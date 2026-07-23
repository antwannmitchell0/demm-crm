import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './src/app.module';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { StripeEnvironmentGuard } from './src/modules/marketing/stripe-environment.guard';

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
  console.log('🧪 STARTING STRIPE BILLING API SUITE');
  console.log('=====================================');

  // --- StripeEnvironmentGuard unit-level checks (no HTTP needed) ---
  const guard = new StripeEnvironmentGuard();

  process.env.STRIPE_SECRET_KEY = 'sk_test_abc123';
  process.env.APP_ENVIRONMENT = 'local';
  try {
    guard.assertConsistent({ environment: 'local', livemode: false });
    check('Guard allows test key + local + livemode:false', true);
  } catch (e) {
    check('Guard allows test key + local + livemode:false', false);
  }

  try {
    guard.assertConsistent({ environment: 'local', livemode: true });
    check('Guard REJECTS test key used with livemode:true mapping', false);
  } catch (e) {
    check('Guard REJECTS test key used with livemode:true mapping', true);
  }

  process.env.STRIPE_SECRET_KEY = 'sk_live_realkey';
  try {
    guard.assertConsistent({ environment: 'local', livemode: false });
    check(
      'Guard REJECTS a live key configured while environment=local (higher-risk direction)',
      false,
    );
  } catch (e) {
    check(
      'Guard REJECTS a live key configured while environment=local (higher-risk direction)',
      true,
    );
  }
  process.env.STRIPE_SECRET_KEY = 'sk_test_abc123'; // restore for later tasks' tests

  // --- OfferSnapshot trial/price-mapping binding ---
  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.listen(0);
  const server = app.getHttpServer();
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;

  const suffix2 = Date.now() + '-snap';
  const org2 = await prisma.organization.create({ data: { name: `Snapshot Test Org ${suffix2}` } });
  const bu2 = await prisma.businessUnit.create({
    data: { organizationId: org2.id, key: 'MARKETING', name: 'DEMM Marketing' },
  });
  const ws2 = await prisma.workspace.create({
    data: { organizationId: org2.id, businessUnitId: bu2.id, name: 'WS', subdomain: `snap-${suffix2}` },
  });
  const bcrypt = await import('bcrypt');
  const passwordHash2 = await bcrypt.hash('SnapTest123!', 10);
  const user2 = await prisma.user.create({
    data: { email: `snap-${suffix2}@example.com`, passwordHash: passwordHash2, firstName: 'S', lastName: 'T' },
  });
  await prisma.membership.create({
    data: { userId: user2.id, organizationId: org2.id, workspaceId: ws2.id, role: 'ORG_ADMIN' },
  });
  const pipeline2 = await prisma.pipeline.create({ data: { name: 'P', workspaceId: ws2.id } });
  const stage2 = await prisma.stage.create({ data: { name: 'New', order: 1, pipelineId: pipeline2.id } });

  // A local test Offer at v1 with SURVIVOR-style trial terms, provisioned
  // with a StripePriceMapping so the snapshot has one to bind to.
  const offer2 = await prisma.offer.create({
    data: {
      businessUnitId: bu2.id,
      key: `snap-survivor-${suffix2}`,
      version: 1,
      name: 'Snap Survivor',
      price: 99,
      trialEligible: true,
      trialDays: 7,
      includedServices: [],
      excludedServices: [],
      onboardingRequirements: [],
      lifecycleState: 'ACTIVE',
    },
  });
  const mapping2 = await prisma.stripePriceMapping.create({
    data: {
      offerId: offer2.id,
      offerVersion: 1,
      amount: 99,
      currency: 'usd',
      billingInterval: 'month',
      environment: 'local',
      livemode: false,
      stripeProductId: 'prod_fake_for_test',
      stripePriceId: 'price_fake_for_test',
    },
  });

  const contact2 = await prisma.contact.create({
    data: { workspaceId: ws2.id, firstName: 'Snap', lastName: 'Client', emails: [`snap-client-${suffix2}@example.com`], phones: [], status: 'LEAD' },
  });
  await prisma.opportunity.create({
    data: { workspaceId: ws2.id, contactId: contact2.id, pipelineId: pipeline2.id, stageId: stage2.id, name: 'Snap Deal', value: 99, status: 'OPEN' },
  });

  const loginRes2 = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user2.email, passwordPlain: 'SnapTest123!' }),
  }).then((r) => r.json());
  const selectRes2 = await fetch(`${base}/api/auth/select-workspace`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${loginRes2.preAuthToken}` },
    body: JSON.stringify({ workspaceId: ws2.id }),
  }).then((r) => r.json());
  const token2 = selectRes2.access_token;

  const convertRes2 = await fetch(`${base}/marketing/leads/${contact2.id}/convert`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token2}`,
      'x-workspace-id': ws2.id,
      'Idempotency-Key': `snap-idem-${suffix2}`,
    },
    body: JSON.stringify({ offerId: offer2.id, contractState: 'SIGNED_MANUAL' }),
  }).then((r) => r.json());

  const snapshot2 = await prisma.offerSnapshot.findUnique({ where: { id: convertRes2.offerSnapshotId } });
  check(
    'OfferSnapshot copies trialEligible/trialDays from Offer at conversion time',
    snapshot2?.trialEligible === true && snapshot2?.trialDays === 7,
  );
  check(
    'OfferSnapshot binds to the StripePriceMapping that existed at conversion time',
    snapshot2?.stripePriceMappingId === mapping2.id,
  );

  // Immutability: change the Offer's trial terms AFTER conversion, confirm
  // the existing snapshot is untouched.
  await prisma.offer.update({ where: { id: offer2.id }, data: { trialDays: 30 } });
  const snapshot2Again = await prisma.offerSnapshot.findUnique({ where: { id: convertRes2.offerSnapshotId } });
  check(
    'Changing Offer.trialDays after conversion does not change the existing snapshot',
    snapshot2Again?.trialDays === 7,
  );

  await app.close();

  console.log('\n🧹 Cleaning up snapshot-binding test records...');
  // Respect RESTRICT FKs (Offer <- StripePriceMapping, ClientAccount <-
  // OfferSnapshot, OfferSnapshot <- StripePriceMapping) and the DOM26-R
  // evidence chain -- delete children before parents, mirroring the
  // teardown pattern in test-marketing-lead-to-client-api.ts /
  // test-onboarding-service-delivery-api.ts, extended with the one new
  // StripePriceMapping row this test creates.
  await prisma.launchGateOverride.deleteMany({
    where: { plan: { clientAccount: { businessUnitId: bu2.id } } },
  });
  await prisma.onboardingChecklistItemHistory.deleteMany({
    where: { item: { plan: { clientAccount: { businessUnitId: bu2.id } } } },
  });
  await prisma.onboardingChecklistItem.deleteMany({
    where: { plan: { clientAccount: { businessUnitId: bu2.id } } },
  });
  await prisma.onboardingPlan.deleteMany({
    where: { clientAccount: { businessUnitId: bu2.id } },
  });
  await prisma.serviceDeliverableHistory.deleteMany({
    where: { deliverable: { clientAccount: { businessUnitId: bu2.id } } },
  });
  await prisma.serviceDeliverable.deleteMany({
    where: { clientAccount: { businessUnitId: bu2.id } },
  });

  await prisma.memoryAuditEvent.deleteMany({
    where: { businessUnitId: bu2.id },
  });
  await prisma.briefEvidence.deleteMany({
    where: { brief: { profile: { businessUnitId: bu2.id } } },
  });
  await prisma.relationshipBrief.deleteMany({
    where: { profile: { businessUnitId: bu2.id } },
  });
  const candidateEvidenceRows2 = await prisma.candidateEvidence.findMany({
    where: { candidate: { profile: { businessUnitId: bu2.id } } },
    select: { sourceId: true },
  });
  const engramEvidenceRows2 = await prisma.engramEvidence.findMany({
    where: { engram: { businessUnitId: bu2.id } },
    select: { sourceId: true },
  });
  const ownedSourceIds2 = [
    ...new Set([
      ...candidateEvidenceRows2.map((r) => r.sourceId),
      ...engramEvidenceRows2.map((r) => r.sourceId),
    ]),
  ];
  await prisma.candidateEvidence.deleteMany({
    where: { candidate: { profile: { businessUnitId: bu2.id } } },
  });
  await prisma.memoryApproval.deleteMany({
    where: { candidate: { profile: { businessUnitId: bu2.id } } },
  });
  await prisma.memoryCandidate.deleteMany({
    where: { profile: { businessUnitId: bu2.id } },
  });
  await prisma.engramEvidence.deleteMany({
    where: { engram: { businessUnitId: bu2.id } },
  });
  await prisma.engram.deleteMany({ where: { businessUnitId: bu2.id } });
  await prisma.engramSource.deleteMany({
    where: { id: { in: ownedSourceIds2 } },
  });
  await prisma.relationshipProfile.deleteMany({
    where: { businessUnitId: bu2.id },
  });
  await prisma.relationshipSubject.deleteMany({
    where: {
      OR: [
        { contact: { workspaceId: ws2.id } },
        { company: { workspaceId: ws2.id } },
      ],
    },
  });
  await prisma.clientCommercialStateChange.deleteMany({
    where: { clientAccount: { businessUnitId: bu2.id } },
  });
  await prisma.conversionIdempotencyKey.deleteMany({
    where: { clientAccount: { businessUnitId: bu2.id } },
  });
  await prisma.clientAccount.deleteMany({
    where: { businessUnitId: bu2.id },
  });
  await prisma.offerSnapshot.deleteMany({
    where: { offer: { businessUnitId: bu2.id } },
  });
  await prisma.stripePriceMapping.deleteMany({
    where: { offerId: offer2.id },
  });
  await prisma.offer.deleteMany({ where: { businessUnitId: bu2.id } });
  await prisma.auditLog.deleteMany({ where: { workspaceId: ws2.id } });
  await prisma.task.deleteMany({ where: { workspaceId: ws2.id } });
  await prisma.opportunity.deleteMany({ where: { workspaceId: ws2.id } });
  await prisma.stage.deleteMany({ where: { pipelineId: pipeline2.id } });
  await prisma.pipeline.deleteMany({ where: { id: pipeline2.id } });
  await prisma.contact.deleteMany({ where: { workspaceId: ws2.id } });
  await prisma.membership.deleteMany({ where: { userId: user2.id } });
  await prisma.user.delete({ where: { id: user2.id } });
  await prisma.workspace.delete({ where: { id: ws2.id } });
  await prisma.businessUnit.delete({ where: { id: bu2.id } });
  await prisma.organization.delete({ where: { id: org2.id } });
  console.log('✅ Cleanup complete.');

  console.log('=====================================');
  console.log(`📊 STRIPE BILLING API SUITE: ${pass} passed, ${fail} failed.`);
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

runApiTests().catch(async (err) => {
  console.error('FATAL:', err);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
