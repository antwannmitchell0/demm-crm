import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './src/app.module';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { StripeEnvironmentGuard } from './src/modules/marketing/stripe-environment.guard';
import { createStripeClient } from './src/modules/marketing/stripe-config';
import { StripeWebhookHandlerService } from './src/modules/marketing/stripe-webhook-handler.service';
import { StripeWebhookDedupService } from './src/modules/marketing/stripe-webhook-dedup.service';
import { StripeProvisioningService } from './src/modules/marketing/stripe-provisioning.service';
import { StripeCheckoutService } from './src/modules/marketing/stripe-checkout.service';
import { BillingRelationshipSignalService } from './src/modules/marketing/billing-relationship-signal.service';
import Stripe from 'stripe';

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

  // Capture the REAL key dotenv loaded from .env before this block starts
  // mutating process.env.STRIPE_SECRET_KEY for test purposes -- restoring
  // to a hardcoded literal (as an earlier version of this file did) would
  // silently clobber a real key for every task that runs after this one
  // in the same process.
  const realStripeSecretKey = process.env.STRIPE_SECRET_KEY;

  process.env.STRIPE_SECRET_KEY = 'sk_test_abc123';
  process.env.APP_ENVIRONMENT = 'local';
  try {
    guard.assertConsistent({ environment: 'local', livemode: false });
    check('Guard allows test key + local + livemode:false', true);
  } catch {
    check('Guard allows test key + local + livemode:false', false);
  }

  try {
    guard.assertConsistent({ environment: 'local', livemode: true });
    check('Guard REJECTS test key used with livemode:true mapping', false);
  } catch {
    check('Guard REJECTS test key used with livemode:true mapping', true);
  }

  process.env.STRIPE_SECRET_KEY = 'sk_live_realkey';
  try {
    guard.assertConsistent({ environment: 'local', livemode: false });
    check(
      'Guard REJECTS a live key configured while environment=local (higher-risk direction)',
      false,
    );
  } catch {
    check(
      'Guard REJECTS a live key configured while environment=local (higher-risk direction)',
      true,
    );
  }
  process.env.STRIPE_SECRET_KEY = realStripeSecretKey; // restore the REAL key for later tasks' tests

  // --- OfferSnapshot trial/price-mapping binding ---
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

  const suffix2 = Date.now() + '-snap';
  const org2 = await prisma.organization.create({
    data: { name: `Snapshot Test Org ${suffix2}` },
  });
  const bu2 = await prisma.businessUnit.create({
    data: { organizationId: org2.id, key: 'MARKETING', name: 'DEMM Marketing' },
  });
  const ws2 = await prisma.workspace.create({
    data: {
      organizationId: org2.id,
      businessUnitId: bu2.id,
      name: 'WS',
      subdomain: `snap-${suffix2}`,
    },
  });
  const bcrypt = await import('bcrypt');
  const passwordHash2 = await bcrypt.hash('SnapTest123!', 10);
  const user2 = await prisma.user.create({
    data: {
      email: `snap-${suffix2}@example.com`,
      passwordHash: passwordHash2,
      firstName: 'S',
      lastName: 'T',
    },
  });
  await prisma.membership.create({
    data: {
      userId: user2.id,
      organizationId: org2.id,
      workspaceId: ws2.id,
      role: 'ORG_ADMIN',
    },
  });
  const pipeline2 = await prisma.pipeline.create({
    data: { name: 'P', workspaceId: ws2.id },
  });
  const stage2 = await prisma.stage.create({
    data: { name: 'New', order: 1, pipelineId: pipeline2.id },
  });

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
    data: {
      workspaceId: ws2.id,
      firstName: 'Snap',
      lastName: 'Client',
      emails: [`snap-client-${suffix2}@example.com`],
      phones: [],
      status: 'LEAD',
    },
  });
  await prisma.opportunity.create({
    data: {
      workspaceId: ws2.id,
      contactId: contact2.id,
      pipelineId: pipeline2.id,
      stageId: stage2.id,
      name: 'Snap Deal',
      value: 99,
      status: 'OPEN',
    },
  });

  const loginRes2 = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user2.email, passwordPlain: 'SnapTest123!' }),
  }).then((r) => r.json());
  const selectRes2 = await fetch(`${base}/api/auth/select-workspace`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${loginRes2.preAuthToken}`,
    },
    body: JSON.stringify({ workspaceId: ws2.id }),
  }).then((r) => r.json());
  const token2 = selectRes2.access_token;

  const convertRes2 = await fetch(
    `${base}/marketing/leads/${contact2.id}/convert`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token2}`,
        'x-workspace-id': ws2.id,
        'Idempotency-Key': `snap-idem-${suffix2}`,
      },
      body: JSON.stringify({
        offerId: offer2.id,
        contractState: 'SIGNED_MANUAL',
      }),
    },
  ).then((r) => r.json());

  const snapshot2 = await prisma.offerSnapshot.findUnique({
    where: { id: convertRes2.offerSnapshotId },
  });
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
  await prisma.offer.update({
    where: { id: offer2.id },
    data: { trialDays: 30 },
  });
  const snapshot2Again = await prisma.offerSnapshot.findUnique({
    where: { id: convertRes2.offerSnapshotId },
  });
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

  // --- Webhook signature verification (own app instance with raw-body middleware) ---
  const express = await import('express');
  const webhookApp = await NestFactory.create(AppModule, { logger: false });
  webhookApp.use('/webhooks/stripe', express.raw({ type: 'application/json' }));
  webhookApp.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await webhookApp.listen(0);
  const webhookServer = webhookApp.getHttpServer();
  const webhookPort = webhookServer.address().port;
  const webhookBase = `http://127.0.0.1:${webhookPort}`;

  // Missing-secret fail-closed test
  const savedSecret = process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  const noSecretRes = await fetch(`${webhookBase}/webhooks/stripe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': 'fake' },
    body: JSON.stringify({ fake: 'payload' }),
  });
  check(
    'Missing STRIPE_WEBHOOK_SECRET fails closed with 400',
    noSecretRes.status === 400,
  );
  process.env.STRIPE_WEBHOOK_SECRET = savedSecret;

  // Bad signature test
  const badSigRes = await fetch(`${webhookBase}/webhooks/stripe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': 't=1,v1=deadbeef',
    },
    body: JSON.stringify({ id: 'evt_fake', type: 'invoice.paid' }),
  });
  check('Bad Stripe-Signature fails closed with 400', badSigRes.status === 400);

  // Real, correctly-signed synthetic event (local HMAC only -- no real
  // Stripe network call, works fine with the local placeholder secret)
  const webhookTestSuffix = Date.now();
  // subscription: null (not a fake id) -- as of Task 11,
  // onCheckoutCompleted() genuinely calls stripe.subscriptions.retrieve()
  // when session.subscription is truthy, which would hit Stripe's real
  // API and fail against the local placeholder STRIPE_SECRET_KEY. This
  // block only exercises signature verification / dedup plumbing, not
  // checkout business logic, so we keep it on the metadata-present /
  // no-subscription no-op branch (a real, testable code path).
  const fakeEventPayload = JSON.stringify({
    id: `evt_test_${webhookTestSuffix}`,
    object: 'event',
    api_version: '2025-08-27.basil',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_fake',
        metadata: { clientAccountId: 'placeholder-not-real' },
        subscription: null,
      },
    },
  });
  const testHeader = (Stripe as any).webhooks.generateTestHeaderString({
    payload: fakeEventPayload,
    secret: process.env.STRIPE_WEBHOOK_SECRET!,
  });
  const validRes = await fetch(`${webhookBase}/webhooks/stripe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': testHeader,
    },
    body: fakeEventPayload,
  });
  check('Correctly-signed event is accepted with 200', validRes.status === 200);

  const eventRow = await prisma.stripeWebhookEvent.findUnique({
    where: { stripeEventId: `evt_test_${webhookTestSuffix}` },
  });
  check(
    'StripeWebhookEvent row reaches PROCESSED',
    eventRow?.processingState === 'PROCESSED',
  );

  // Duplicate delivery (sequential)
  const dupRes = await fetch(`${webhookBase}/webhooks/stripe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': testHeader,
    },
    body: fakeEventPayload,
  });
  check(
    'Duplicate delivery of an already-PROCESSED event returns 200 and is skipped',
    dupRes.status === 200,
  );

  // --- TRUE concurrency: two genuinely parallel deliveries of the SAME
  // event must produce exactly ONE handler execution, not two. This is
  // precisely the race the advisory lock's transaction-spanning scope (see
  // StripeWebhookDedupService.claimAndProcess) exists to close -- proven by
  // monkey-patching the live StripeWebhookHandlerService instance to count
  // invocations and hold each one open briefly (widening the race window
  // well past normal request latency), then firing two fetch() calls via
  // Promise.all so they are genuinely in flight at the same time.
  const handlerInstance = webhookApp.get(StripeWebhookHandlerService);
  const originalHandleEvent = handlerInstance.handleEvent.bind(handlerInstance);
  let handlerInvocationCount = 0;
  let concurrentInFlight = 0;
  let maxConcurrentInFlight = 0;
  (handlerInstance as any).handleEvent = async (ev: Stripe.Event) => {
    handlerInvocationCount++;
    concurrentInFlight++;
    maxConcurrentInFlight = Math.max(maxConcurrentInFlight, concurrentInFlight);
    await new Promise((resolve) => setTimeout(resolve, 500));
    concurrentInFlight--;
    return originalHandleEvent(ev);
  };

  const concurrentSuffix = Date.now() + '-concurrent';
  // subscription: null -- same reasoning as fakeEventPayload above: this
  // block (via originalHandleEvent) runs the real onCheckoutCompleted(),
  // and a truthy subscription id would trigger a real
  // stripe.subscriptions.retrieve() call against the placeholder key.
  const concurrentPayload = JSON.stringify({
    id: `evt_test_${concurrentSuffix}`,
    object: 'event',
    api_version: '2025-08-27.basil',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_fake_concurrent',
        metadata: { clientAccountId: 'placeholder-not-real' },
        subscription: null,
      },
    },
  });
  const concurrentHeader = (Stripe as any).webhooks.generateTestHeaderString({
    payload: concurrentPayload,
    secret: process.env.STRIPE_WEBHOOK_SECRET!,
  });
  const fireConcurrentDelivery = () =>
    fetch(`${webhookBase}/webhooks/stripe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': concurrentHeader,
      },
      body: concurrentPayload,
    });
  const [concurrentResA, concurrentResB] = await Promise.all([
    fireConcurrentDelivery(),
    fireConcurrentDelivery(),
  ]);
  check(
    'Two genuinely concurrent deliveries of the same event both return 200',
    concurrentResA.status === 200 && concurrentResB.status === 200,
  );
  check(
    'Handler is invoked exactly ONCE for two truly concurrent duplicate deliveries (no double business effects)',
    handlerInvocationCount === 1,
  );
  check(
    'Handler is never running for more than one concurrent duplicate at a time',
    maxConcurrentInFlight === 1,
  );
  const concurrentEventRow = await prisma.stripeWebhookEvent.findUnique({
    where: { stripeEventId: `evt_test_${concurrentSuffix}` },
  });
  check(
    'Concurrent-delivery StripeWebhookEvent row reaches PROCESSED with attemptCount 1 (only the winner ever claimed it)',
    concurrentEventRow?.processingState === 'PROCESSED' &&
      concurrentEventRow?.attemptCount === 1,
  );
  (handlerInstance as any).handleEvent = originalHandleEvent;

  // Teardown: delete the StripeWebhookEvent rows this test created
  await prisma.stripeWebhookEvent.deleteMany({
    where: {
      stripeEventId: {
        in: [`evt_test_${webhookTestSuffix}`, `evt_test_${concurrentSuffix}`],
      },
    },
  });

  // --- Subscription status synchronization walk ---
  // Exercises customer.subscription.created/updated/deleted end-to-end
  // through the real handler with a FULL synthetic Subscription object
  // (metadata included) on every event, which never triggers
  // stripe.subscriptions.retrieve() -- fully testable against the local
  // placeholder key. (Use a distinct suffix/IDs from any earlier test
  // block to avoid collisions.)
  const subForWalkSuffix = Date.now() + '-walk';
  const subForWalk = 'sub_test_walk_' + subForWalkSuffix;
  const custForWalk = 'cus_test_walk_' + subForWalkSuffix;

  const orgWalk = await prisma.organization.create({
    data: { name: `Walk Test Org ${subForWalkSuffix}` },
  });
  const buWalk = await prisma.businessUnit.create({
    data: {
      organizationId: orgWalk.id,
      key: 'MARKETING',
      name: 'DEMM Marketing',
    },
  });
  const wsWalk = await prisma.workspace.create({
    data: {
      organizationId: orgWalk.id,
      businessUnitId: buWalk.id,
      name: 'WS',
      subdomain: `walk-${subForWalkSuffix}`,
    },
  });
  const passwordHashWalk = await bcrypt.hash('WalkTest123!', 10);
  const userWalk = await prisma.user.create({
    data: {
      email: `walk-${subForWalkSuffix}@example.com`,
      passwordHash: passwordHashWalk,
      firstName: 'W',
      lastName: 'T',
    },
  });
  await prisma.membership.create({
    data: {
      userId: userWalk.id,
      organizationId: orgWalk.id,
      workspaceId: wsWalk.id,
      role: 'ORG_ADMIN',
    },
  });
  const pipelineWalk = await prisma.pipeline.create({
    data: { name: 'P', workspaceId: wsWalk.id },
  });
  const stageWalk = await prisma.stage.create({
    data: { name: 'New', order: 1, pipelineId: pipelineWalk.id },
  });

  // A local test Offer with a StripePriceMapping so the OfferSnapshot
  // produced by conversion has a stripePriceMappingId -- required by
  // upsertBillingSubscription's guard.
  const offerWalk = await prisma.offer.create({
    data: {
      businessUnitId: buWalk.id,
      key: `walk-survivor-${subForWalkSuffix}`,
      version: 1,
      name: 'Walk Survivor',
      price: 99,
      trialEligible: true,
      trialDays: 7,
      includedServices: [],
      excludedServices: [],
      onboardingRequirements: [],
      lifecycleState: 'ACTIVE',
    },
  });
  const mappingWalk = await prisma.stripePriceMapping.create({
    data: {
      offerId: offerWalk.id,
      offerVersion: 1,
      amount: 99,
      currency: 'usd',
      billingInterval: 'month',
      environment: 'local',
      livemode: false,
      stripeProductId: 'prod_fake_for_walk_test',
      stripePriceId: 'price_fake_for_walk_test',
    },
  });

  const contactWalk = await prisma.contact.create({
    data: {
      workspaceId: wsWalk.id,
      firstName: 'Walk',
      lastName: 'Client',
      emails: [`walk-client-${subForWalkSuffix}@example.com`],
      phones: [],
      status: 'LEAD',
    },
  });
  await prisma.opportunity.create({
    data: {
      workspaceId: wsWalk.id,
      contactId: contactWalk.id,
      pipelineId: pipelineWalk.id,
      stageId: stageWalk.id,
      name: 'Walk Deal',
      value: 99,
      status: 'OPEN',
    },
  });

  const loginResWalk = await fetch(`${webhookBase}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: userWalk.email,
      passwordPlain: 'WalkTest123!',
    }),
  }).then((r) => r.json());
  const selectResWalk = await fetch(
    `${webhookBase}/api/auth/select-workspace`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginResWalk.preAuthToken}`,
      },
      body: JSON.stringify({ workspaceId: wsWalk.id }),
    },
  ).then((r) => r.json());
  const tokenWalk = selectResWalk.access_token;

  const convertResWalk = await fetch(
    `${webhookBase}/marketing/leads/${contactWalk.id}/convert`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenWalk}`,
        'x-workspace-id': wsWalk.id,
        'Idempotency-Key': `walk-idem-${subForWalkSuffix}`,
      },
      body: JSON.stringify({
        offerId: offerWalk.id,
        contractState: 'SIGNED_MANUAL',
      }),
    },
  ).then((r) => r.json());

  const clientAccountIdWalk: string = convertResWalk.id;
  await prisma.clientAccount.update({
    where: { id: clientAccountIdWalk },
    data: { stripeCustomerId: custForWalk },
  });

  const offerSnapshotWalk = await prisma.offerSnapshot.findUnique({
    where: { id: convertResWalk.offerSnapshotId },
  });
  check(
    'Walk-test ClientAccount OfferSnapshot has a non-null stripePriceMappingId (required by upsertBillingSubscription guard)',
    offerSnapshotWalk?.stripePriceMappingId === mappingWalk.id,
  );

  function synthesizeSubscriptionEvent(
    eventType: string,
    status: string,
    clientAccountId: string,
    // Every delivery -- even repeat statuses in the walk below (e.g. the
    // second 'active' after PAST_DUE) -- must carry a genuinely distinct
    // Stripe event id. The dedup layer keys strictly on event.id, so an
    // id derived from status alone would make the second 'active'
    // delivery collide with the first and get silently skipped as
    // SKIPPED_ALREADY_PROCESSED, never reaching the handler.
    index: number | string,
    overrides: Record<string, any> = {},
  ) {
    return JSON.stringify({
      id: `evt_walk_${index}_${status}_${subForWalkSuffix}`,
      object: 'event',
      api_version: '2025-08-27.basil',
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      type: eventType,
      data: {
        object: {
          id: subForWalk,
          object: 'subscription',
          customer: custForWalk,
          status,
          metadata: { clientAccountId },
          items: {
            data: [
              {
                current_period_start: Math.floor(Date.now() / 1000),
                current_period_end: Math.floor(Date.now() / 1000) + 2592000,
              },
            ],
          },
          cancel_at_period_end: false,
          canceled_at: null,
          trial_start: null,
          trial_end: null,
          ...overrides,
        },
      },
    });
  }

  async function deliverWebhook(payload: string) {
    const header = (Stripe as any).webhooks.generateTestHeaderString({
      payload,
      secret: process.env.STRIPE_WEBHOOK_SECRET!,
    });
    return fetch(`${webhookBase}/webhooks/stripe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': header,
      },
      body: payload,
    });
  }

  // Note: 'active' deliberately appears twice (PAST_DUE -> ACTIVE
  // recovery is a real Stripe lifecycle transition worth proving, not
  // just terminal CANCELED). Each iteration gets its own event id via
  // `index`, so the two 'active' deliveries are genuinely distinct
  // events and both reach the handler.
  const walkStatuses = [
    'incomplete',
    'trialing',
    'active',
    'past_due',
    'active',
    'canceled',
  ];
  const expectedBillingStatus: Record<string, string> = {
    incomplete: 'INCOMPLETE',
    trialing: 'TRIALING',
    active: 'ACTIVE',
    past_due: 'PAST_DUE',
    canceled: 'CANCELED',
  };
  const walkDeliveryResults: number[] = [];
  for (const [idx, status] of walkStatuses.entries()) {
    const walkRes = await deliverWebhook(
      synthesizeSubscriptionEvent(
        'customer.subscription.updated',
        status,
        clientAccountIdWalk,
        idx,
      ),
    );
    walkDeliveryResults.push(walkRes.status);
    // Confirm THIS delivery's status landed before moving to the next
    // step. This is what actually proves each of the 6 deliveries reached
    // the handler individually -- in particular, it catches the case
    // where the second 'active' delivery (index 4, right after
    // 'past_due') gets silently deduped and never invokes the handler:
    // if that happened, the status here would still read PAST_DUE instead
    // of ACTIVE.
    await new Promise((r) => setTimeout(r, 200));
    const stepSub = await prisma.billingSubscription.findUnique({
      where: { stripeSubscriptionId: subForWalk },
    });
    check(
      `Status walk step ${idx} ('${status}') is reflected in BillingSubscription immediately after its delivery`,
      stepSub?.status === expectedBillingStatus[status],
    );
  }
  check(
    'All subscription-status-walk webhook deliveries return 200',
    walkDeliveryResults.every((s) => s === 200),
  );
  const finalSub = await prisma.billingSubscription.findUnique({
    where: { stripeSubscriptionId: subForWalk },
  });
  check(
    'Subscription status walk ends at CANCELED after INCOMPLETE→TRIALING→ACTIVE→PAST_DUE→ACTIVE→CANCELED',
    finalSub?.status === 'CANCELED',
  );
  check(
    'Subscription status walk resolved via metadata.clientAccountId (no stripe.subscriptions.retrieve() call needed)',
    finalSub?.clientAccountId === clientAccountIdWalk,
  );
  const walkEventRowCount = await prisma.stripeWebhookEvent.count({
    where: {
      stripeEventId: {
        in: walkStatuses.map(
          (s, idx) => `evt_walk_${idx}_${s}_${subForWalkSuffix}`,
        ),
      },
    },
  });
  check(
    'All 6 status-walk deliveries created 6 DISTINCT StripeWebhookEvent rows (none deduped against each other)',
    walkEventRowCount === 6,
  );

  // Also prove customer.subscription.deleted independently sets CANCELED
  // + canceledAt even when delivered as its own event type (not just via
  // the .updated walk above).
  await prisma.billingSubscription.update({
    where: { stripeSubscriptionId: subForWalk },
    data: { status: 'ACTIVE', canceledAt: null },
  });
  const deletedPayload = synthesizeSubscriptionEvent(
    'customer.subscription.deleted',
    'canceled',
    clientAccountIdWalk,
    'deleted',
    {
      canceled_at: Math.floor(Date.now() / 1000),
    },
  );
  const deletedRes = await deliverWebhook(
    JSON.stringify({
      ...JSON.parse(deletedPayload),
      id: `evt_walk_deleted_${subForWalkSuffix}`,
    }),
  );
  check(
    'customer.subscription.deleted delivery returns 200',
    deletedRes.status === 200,
  );
  await new Promise((r) => setTimeout(r, 300));
  const afterDeleteSub = await prisma.billingSubscription.findUnique({
    where: { stripeSubscriptionId: subForWalk },
  });
  check(
    'customer.subscription.deleted sets status CANCELED and canceledAt',
    afterDeleteSub?.status === 'CANCELED' &&
      afterDeleteSub?.canceledAt !== null,
  );

  // Teardown: reverse creation order, respecting FKs.
  await prisma.stripeWebhookEvent.deleteMany({
    where: {
      stripeEventId: {
        in: [
          ...walkStatuses.map(
            (s, idx) => `evt_walk_${idx}_${s}_${subForWalkSuffix}`,
          ),
          `evt_walk_deleted_${subForWalkSuffix}`,
        ],
      },
    },
  });
  await prisma.billingSubscription.deleteMany({
    where: { stripeSubscriptionId: subForWalk },
  });
  await prisma.clientCommercialStateChange.deleteMany({
    where: { clientAccount: { businessUnitId: buWalk.id } },
  });
  await prisma.conversionIdempotencyKey.deleteMany({
    where: { clientAccount: { businessUnitId: buWalk.id } },
  });
  await prisma.launchGateOverride.deleteMany({
    where: { plan: { clientAccount: { businessUnitId: buWalk.id } } },
  });
  await prisma.onboardingChecklistItemHistory.deleteMany({
    where: { item: { plan: { clientAccount: { businessUnitId: buWalk.id } } } },
  });
  await prisma.onboardingChecklistItem.deleteMany({
    where: { plan: { clientAccount: { businessUnitId: buWalk.id } } },
  });
  await prisma.onboardingPlan.deleteMany({
    where: { clientAccount: { businessUnitId: buWalk.id } },
  });
  await prisma.serviceDeliverableHistory.deleteMany({
    where: { deliverable: { clientAccount: { businessUnitId: buWalk.id } } },
  });
  await prisma.serviceDeliverable.deleteMany({
    where: { clientAccount: { businessUnitId: buWalk.id } },
  });
  await prisma.memoryAuditEvent.deleteMany({
    where: { businessUnitId: buWalk.id },
  });
  await prisma.briefEvidence.deleteMany({
    where: { brief: { profile: { businessUnitId: buWalk.id } } },
  });
  await prisma.relationshipBrief.deleteMany({
    where: { profile: { businessUnitId: buWalk.id } },
  });
  const candidateEvidenceRowsWalk = await prisma.candidateEvidence.findMany({
    where: { candidate: { profile: { businessUnitId: buWalk.id } } },
    select: { sourceId: true },
  });
  const engramEvidenceRowsWalk = await prisma.engramEvidence.findMany({
    where: { engram: { businessUnitId: buWalk.id } },
    select: { sourceId: true },
  });
  const ownedSourceIdsWalk = [
    ...new Set([
      ...candidateEvidenceRowsWalk.map((r) => r.sourceId),
      ...engramEvidenceRowsWalk.map((r) => r.sourceId),
    ]),
  ];
  await prisma.candidateEvidence.deleteMany({
    where: { candidate: { profile: { businessUnitId: buWalk.id } } },
  });
  await prisma.memoryApproval.deleteMany({
    where: { candidate: { profile: { businessUnitId: buWalk.id } } },
  });
  await prisma.memoryCandidate.deleteMany({
    where: { profile: { businessUnitId: buWalk.id } },
  });
  await prisma.engramEvidence.deleteMany({
    where: { engram: { businessUnitId: buWalk.id } },
  });
  await prisma.engram.deleteMany({ where: { businessUnitId: buWalk.id } });
  await prisma.engramSource.deleteMany({
    where: { id: { in: ownedSourceIdsWalk } },
  });
  await prisma.relationshipProfile.deleteMany({
    where: { businessUnitId: buWalk.id },
  });
  await prisma.relationshipSubject.deleteMany({
    where: {
      OR: [
        { contact: { workspaceId: wsWalk.id } },
        { company: { workspaceId: wsWalk.id } },
      ],
    },
  });
  await prisma.clientAccount.deleteMany({
    where: { businessUnitId: buWalk.id },
  });
  await prisma.offerSnapshot.deleteMany({
    where: { offer: { businessUnitId: buWalk.id } },
  });
  await prisma.stripePriceMapping.deleteMany({
    where: { offerId: offerWalk.id },
  });
  await prisma.offer.deleteMany({ where: { businessUnitId: buWalk.id } });
  await prisma.auditLog.deleteMany({ where: { workspaceId: wsWalk.id } });
  await prisma.task.deleteMany({ where: { workspaceId: wsWalk.id } });
  await prisma.opportunity.deleteMany({ where: { workspaceId: wsWalk.id } });
  await prisma.stage.deleteMany({ where: { pipelineId: pipelineWalk.id } });
  await prisma.pipeline.deleteMany({ where: { id: pipelineWalk.id } });
  await prisma.contact.deleteMany({ where: { workspaceId: wsWalk.id } });
  await prisma.membership.deleteMany({ where: { userId: userWalk.id } });
  await prisma.user.delete({ where: { id: userWalk.id } });
  await prisma.workspace.delete({ where: { id: wsWalk.id } });
  await prisma.businessUnit.delete({ where: { id: buWalk.id } });
  await prisma.organization.delete({ where: { id: orgWalk.id } });

  // --- Payment / refund webhook handlers (Task 12) ---
  // The subForWalk/custForWalk/clientAccountIdWalk fixtures above are torn
  // down by the time we get here, so this block seeds its OWN fresh
  // ClientAccount + BillingSubscription, following the exact same
  // establishing pattern used elsewhere in this file.
  console.log('\n💳 Testing payment/refund webhook handlers...');

  const paySuffix = Date.now() + '-pay';
  const orgPay = await prisma.organization.create({
    data: { name: `Pay Test Org ${paySuffix}` },
  });
  const buPay = await prisma.businessUnit.create({
    data: {
      organizationId: orgPay.id,
      key: 'MARKETING',
      name: 'DEMM Marketing',
    },
  });
  const wsPay = await prisma.workspace.create({
    data: {
      organizationId: orgPay.id,
      businessUnitId: buPay.id,
      name: 'WS',
      subdomain: `pay-${paySuffix}`,
    },
  });
  const passwordHashPay = await bcrypt.hash('PayTest123!', 10);
  const userPay = await prisma.user.create({
    data: {
      email: `pay-${paySuffix}@example.com`,
      passwordHash: passwordHashPay,
      firstName: 'P',
      lastName: 'T',
    },
  });
  await prisma.membership.create({
    data: {
      userId: userPay.id,
      organizationId: orgPay.id,
      workspaceId: wsPay.id,
      role: 'ORG_ADMIN',
    },
  });
  const pipelinePay = await prisma.pipeline.create({
    data: { name: 'P', workspaceId: wsPay.id },
  });
  const stagePay = await prisma.stage.create({
    data: { name: 'New', order: 1, pipelineId: pipelinePay.id },
  });

  const offerPay = await prisma.offer.create({
    data: {
      businessUnitId: buPay.id,
      key: `pay-survivor-${paySuffix}`,
      version: 1,
      name: 'Pay Survivor',
      price: 99,
      trialEligible: true,
      trialDays: 7,
      includedServices: [],
      excludedServices: [],
      onboardingRequirements: [],
      lifecycleState: 'ACTIVE',
    },
  });
  const mappingPay = await prisma.stripePriceMapping.create({
    data: {
      offerId: offerPay.id,
      offerVersion: 1,
      amount: 99,
      currency: 'usd',
      billingInterval: 'month',
      environment: 'local',
      livemode: false,
      stripeProductId: 'prod_fake_for_pay_test',
      stripePriceId: 'price_fake_for_pay_test',
    },
  });

  const contactPay = await prisma.contact.create({
    data: {
      workspaceId: wsPay.id,
      firstName: 'Pay',
      lastName: 'Client',
      emails: [`pay-client-${paySuffix}@example.com`],
      phones: [],
      status: 'LEAD',
    },
  });
  await prisma.opportunity.create({
    data: {
      workspaceId: wsPay.id,
      contactId: contactPay.id,
      pipelineId: pipelinePay.id,
      stageId: stagePay.id,
      name: 'Pay Deal',
      value: 99,
      status: 'OPEN',
    },
  });

  const loginResPay = await fetch(`${webhookBase}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: userPay.email,
      passwordPlain: 'PayTest123!',
    }),
  }).then((r) => r.json());
  const selectResPay = await fetch(`${webhookBase}/api/auth/select-workspace`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${loginResPay.preAuthToken}`,
    },
    body: JSON.stringify({ workspaceId: wsPay.id }),
  }).then((r) => r.json());
  const tokenPay = selectResPay.access_token;

  const convertResPay = await fetch(
    `${webhookBase}/marketing/leads/${contactPay.id}/convert`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenPay}`,
        'x-workspace-id': wsPay.id,
        'Idempotency-Key': `pay-idem-${paySuffix}`,
      },
      body: JSON.stringify({
        offerId: offerPay.id,
        contractState: 'SIGNED_MANUAL',
      }),
    },
  ).then((r) => r.json());

  const clientAccountIdPay: string = convertResPay.id;
  const custForPay = `cus_test_pay_${paySuffix}`;
  await prisma.clientAccount.update({
    where: { id: clientAccountIdPay },
    data: { stripeCustomerId: custForPay },
  });

  const subForPay = `sub_test_pay_${paySuffix}`;
  // status starts at PAST_DUE (not ACTIVE) so invoice.paid's status-recovery
  // write below is provably exercised, not a no-op.
  const billingSubscriptionPay = await prisma.billingSubscription.create({
    data: {
      clientAccountId: clientAccountIdPay,
      stripePriceMappingId: mappingPay.id,
      stripeSubscriptionId: subForPay,
      stripeCustomerId: custForPay,
      status: 'PAST_DUE',
    },
  });

  // -- Payment success: invoice.paid -> BillingPaymentRecord +
  // ClientCommercialStateChange dual-write, and BillingSubscription
  // recovers to ACTIVE. --
  const invSuccessSuffix = paySuffix + '-success';
  const invIdSuccess = `in_test_${invSuccessSuffix}`;
  const piIdSuccess = `pi_test_${invSuccessSuffix}`;
  const invoicePaidPayload = JSON.stringify({
    id: `evt_invpaid_${invSuccessSuffix}`,
    object: 'event',
    api_version: '2025-08-27.basil',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type: 'invoice.paid',
    data: {
      object: {
        id: invIdSuccess,
        object: 'invoice',
        customer: custForPay,
        subscription: subForPay,
        amount_paid: 9900,
        currency: 'usd',
        tax: null,
        period_start: Math.floor(Date.now() / 1000),
        period_end: Math.floor(Date.now() / 1000) + 2592000,
        payment_intent: piIdSuccess,
      },
    },
  });
  const invoicePaidRes = await deliverWebhook(invoicePaidPayload);
  check('invoice.paid delivery returns 200', invoicePaidRes.status === 200);
  await new Promise((r) => setTimeout(r, 300));

  const paymentRecordSuccess = await prisma.billingPaymentRecord.findUnique({
    where: { stripeInvoiceId: invIdSuccess },
  });
  check(
    'invoice.paid creates a BillingPaymentRecord with correct amount/clientAccountId/subscription link',
    paymentRecordSuccess?.clientAccountId === clientAccountIdPay &&
      Number(paymentRecordSuccess?.amountPaid) === 99 &&
      paymentRecordSuccess?.billingSubscriptionId ===
        billingSubscriptionPay.id &&
      paymentRecordSuccess?.stripePaymentIntentId === piIdSuccess,
  );

  const commercialChangeSuccess =
    await prisma.clientCommercialStateChange.findFirst({
      where: {
        clientAccountId: clientAccountIdPay,
        field: 'PAYMENT',
        newValue: 'PAID',
      },
      orderBy: { createdAt: 'desc' },
    });
  check(
    'invoice.paid dual-writes a ClientCommercialStateChange (PAYMENT/PAID) with matching amount and STRIPE_WEBHOOK source',
    Number(commercialChangeSuccess?.amount) === 99 &&
      commercialChangeSuccess?.source === 'STRIPE_WEBHOOK',
  );

  const subAfterInvoicePaid = await prisma.billingSubscription.findUnique({
    where: { id: billingSubscriptionPay.id },
  });
  check(
    'invoice.paid flips a PAST_DUE BillingSubscription back to ACTIVE',
    subAfterInvoicePaid?.status === 'ACTIVE',
  );

  // -- Out-of-order: invoice.paid for a subscription ID we have never
  // recorded a BillingSubscription for. resolveClientAccountId (Task 11,
  // already reviewed/approved) has no try/catch around
  // stripe.subscriptions.retrieve() -- against the local placeholder
  // STRIPE_SECRET_KEY this genuinely fails (401-style error from Stripe's
  // real servers), and that exception propagates up through onInvoicePaid
  // -> handleEvent -> is caught by claimAndProcess's outer try/catch,
  // landing the event in FAILED (durably recorded + retryable), not
  // PROCESSED. This is a deliberate deviation from the plan's stale
  // expectation -- see Task 12 report. --
  const oooSuffix = paySuffix + '-ooo';
  const oooEventId = `evt_ooo_${oooSuffix}`;
  const oooInvoicePayload = JSON.stringify({
    id: oooEventId,
    object: 'event',
    api_version: '2025-08-27.basil',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type: 'invoice.paid',
    data: {
      object: {
        id: `in_test_${oooSuffix}`,
        object: 'invoice',
        customer: `cus_test_${oooSuffix}`,
        subscription: `sub_test_${oooSuffix}`,
        amount_paid: 9900,
        currency: 'usd',
        tax: null,
        period_start: Math.floor(Date.now() / 1000),
        period_end: Math.floor(Date.now() / 1000) + 2592000,
        payment_intent: `pi_test_${oooSuffix}`,
      },
    },
  });
  const oooRes = await deliverWebhook(oooInvoicePayload);
  check(
    'Out-of-order invoice.paid delivery still returns 200 (failure handled internally, not surfaced as 5xx)',
    oooRes.status === 200,
  );
  await new Promise((r) => setTimeout(r, 300));
  const oooEventRow = await prisma.stripeWebhookEvent.findUnique({
    where: { stripeEventId: oooEventId },
  });
  check(
    'Out-of-order invoice.paid for a genuinely unresolvable subscription is durably recorded as FAILED (retryable), not silently lost',
    oooEventRow?.processingState === 'FAILED' && !!oooEventRow?.lastError,
  );

  // -- Concurrent duplicate: fire the SAME signed payload twice in
  // parallel; the dedup advisory lock must ensure only ONE
  // BillingPaymentRecord is ever created. --
  const concurPaySuffix = paySuffix + '-concur';
  const concurInvId = `in_test_${concurPaySuffix}`;
  const concurInvoicePayload = JSON.stringify({
    id: `evt_invpaid_${concurPaySuffix}`,
    object: 'event',
    api_version: '2025-08-27.basil',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type: 'invoice.paid',
    data: {
      object: {
        id: concurInvId,
        object: 'invoice',
        customer: custForPay,
        subscription: subForPay,
        amount_paid: 9900,
        currency: 'usd',
        tax: null,
        period_start: Math.floor(Date.now() / 1000),
        period_end: Math.floor(Date.now() / 1000) + 2592000,
        payment_intent: `pi_test_${concurPaySuffix}`,
      },
    },
  });
  const [concurInvResA, concurInvResB] = await Promise.all([
    deliverWebhook(concurInvoicePayload),
    deliverWebhook(concurInvoicePayload),
  ]);
  check(
    'Two concurrent deliveries of the same invoice.paid event both return 200',
    concurInvResA.status === 200 && concurInvResB.status === 200,
  );
  await new Promise((r) => setTimeout(r, 300));
  const concurPaymentRecordCount = await prisma.billingPaymentRecord.count({
    where: { stripeInvoiceId: concurInvId },
  });
  check(
    'Concurrent duplicate invoice.paid deliveries create exactly ONE BillingPaymentRecord',
    concurPaymentRecordCount === 1,
  );

  // -- Failed-event retry: dedupService.claimAndProcess consolidates the
  // old claimForProcessing/markFailed pair into one method. Prove a FAILED
  // event stays retryable and succeeds on its next attempt. --
  console.log('\n🔁 Testing failed-event retry via claimAndProcess...');
  const dedupService = new StripeWebhookDedupService(prisma as any);
  let retryAttemptCount = 0;
  const flakyHandler = () => {
    retryAttemptCount++;
    if (retryAttemptCount === 1) throw new Error('simulated failure');
    return Promise.resolve();
  };
  const retrySuffix = paySuffix + '-retry';
  const fakeFailEvent = {
    id: `evt_retry_${retrySuffix}`,
    type: 'invoice.paid',
    created: Math.floor(Date.now() / 1000),
    api_version: '2025-08-27.basil',
    livemode: false,
  } as any;
  const firstRetryOutcome = await dedupService.claimAndProcess(
    fakeFailEvent,
    'hash1',
    flakyHandler,
  );
  check(
    'First attempt with a throwing handler results in FAILED',
    firstRetryOutcome.action === 'FAILED',
  );
  const secondRetryOutcome = await dedupService.claimAndProcess(
    fakeFailEvent,
    'hash1',
    flakyHandler,
  );
  check(
    'A FAILED event remains retryable and now succeeds',
    secondRetryOutcome.action === 'PROCESSED' && retryAttemptCount === 2,
  );
  await prisma.stripeWebhookEvent.deleteMany({
    where: { stripeEventId: `evt_retry_${retrySuffix}` },
  });

  // -- Refund: charge.refunded marks FULL_REFUND, writes a
  // negative-amount ClientCommercialStateChange. --
  console.log('\n💸 Testing charge.refunded...');
  const refundSuffix = paySuffix + '-refund';
  const refundEventId = `evt_refund_${refundSuffix}`;
  const chargeRefundedPayload = JSON.stringify({
    id: refundEventId,
    object: 'event',
    api_version: '2025-08-27.basil',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type: 'charge.refunded',
    data: {
      object: {
        id: `ch_test_${refundSuffix}`,
        object: 'charge',
        payment_intent: piIdSuccess, // reuse the payment intent from the earlier successful invoice.paid test
        amount: 9900,
        amount_refunded: 9900,
      },
    },
  });
  const chargeRefundedRes = await deliverWebhook(chargeRefundedPayload);
  check(
    'charge.refunded delivery returns 200',
    chargeRefundedRes.status === 200,
  );
  await new Promise((r) => setTimeout(r, 300));

  const paymentRecordAfterRefund = await prisma.billingPaymentRecord.findUnique(
    { where: { stripeInvoiceId: invIdSuccess } },
  );
  check(
    'charge.refunded marks the BillingPaymentRecord FULL_REFUND with matching refundedAmount',
    paymentRecordAfterRefund?.reversalState === 'FULL_REFUND' &&
      Number(paymentRecordAfterRefund?.refundedAmount) === 99,
  );

  const commercialChangeRefund =
    await prisma.clientCommercialStateChange.findFirst({
      where: {
        clientAccountId: clientAccountIdPay,
        field: 'PAYMENT',
        newValue: 'REFUNDED',
      },
      orderBy: { createdAt: 'desc' },
    });
  check(
    'charge.refunded dual-writes a negative-amount ClientCommercialStateChange (PAYMENT/REFUNDED)',
    Number(commercialChangeRefund?.amount) === -99 &&
      commercialChangeRefund?.source === 'STRIPE_WEBHOOK',
  );

  // Teardown: reverse creation order, respecting FKs, mirroring the
  // buWalk teardown block above, extended with the BillingPaymentRecord
  // rows and StripeWebhookEvent rows this block additionally creates.
  await prisma.stripeWebhookEvent.deleteMany({
    where: {
      stripeEventId: {
        in: [
          `evt_invpaid_${invSuccessSuffix}`,
          oooEventId,
          `evt_invpaid_${concurPaySuffix}`,
          refundEventId,
        ],
      },
    },
  });
  await prisma.billingPaymentRecord.deleteMany({
    where: { clientAccountId: clientAccountIdPay },
  });
  await prisma.billingSubscription.deleteMany({
    where: { stripeSubscriptionId: subForPay },
  });
  await prisma.clientCommercialStateChange.deleteMany({
    where: { clientAccount: { businessUnitId: buPay.id } },
  });
  await prisma.conversionIdempotencyKey.deleteMany({
    where: { clientAccount: { businessUnitId: buPay.id } },
  });
  await prisma.launchGateOverride.deleteMany({
    where: { plan: { clientAccount: { businessUnitId: buPay.id } } },
  });
  await prisma.onboardingChecklistItemHistory.deleteMany({
    where: { item: { plan: { clientAccount: { businessUnitId: buPay.id } } } },
  });
  await prisma.onboardingChecklistItem.deleteMany({
    where: { plan: { clientAccount: { businessUnitId: buPay.id } } },
  });
  await prisma.onboardingPlan.deleteMany({
    where: { clientAccount: { businessUnitId: buPay.id } },
  });
  await prisma.serviceDeliverableHistory.deleteMany({
    where: { deliverable: { clientAccount: { businessUnitId: buPay.id } } },
  });
  await prisma.serviceDeliverable.deleteMany({
    where: { clientAccount: { businessUnitId: buPay.id } },
  });
  await prisma.memoryAuditEvent.deleteMany({
    where: { businessUnitId: buPay.id },
  });
  await prisma.briefEvidence.deleteMany({
    where: { brief: { profile: { businessUnitId: buPay.id } } },
  });
  await prisma.relationshipBrief.deleteMany({
    where: { profile: { businessUnitId: buPay.id } },
  });
  const candidateEvidenceRowsPay = await prisma.candidateEvidence.findMany({
    where: { candidate: { profile: { businessUnitId: buPay.id } } },
    select: { sourceId: true },
  });
  const engramEvidenceRowsPay = await prisma.engramEvidence.findMany({
    where: { engram: { businessUnitId: buPay.id } },
    select: { sourceId: true },
  });
  const ownedSourceIdsPay = [
    ...new Set([
      ...candidateEvidenceRowsPay.map((r) => r.sourceId),
      ...engramEvidenceRowsPay.map((r) => r.sourceId),
    ]),
  ];
  await prisma.candidateEvidence.deleteMany({
    where: { candidate: { profile: { businessUnitId: buPay.id } } },
  });
  await prisma.memoryApproval.deleteMany({
    where: { candidate: { profile: { businessUnitId: buPay.id } } },
  });
  await prisma.memoryCandidate.deleteMany({
    where: { profile: { businessUnitId: buPay.id } },
  });
  await prisma.engramEvidence.deleteMany({
    where: { engram: { businessUnitId: buPay.id } },
  });
  await prisma.engram.deleteMany({ where: { businessUnitId: buPay.id } });
  await prisma.engramSource.deleteMany({
    where: { id: { in: ownedSourceIdsPay } },
  });
  await prisma.relationshipProfile.deleteMany({
    where: { businessUnitId: buPay.id },
  });
  await prisma.relationshipSubject.deleteMany({
    where: {
      OR: [
        { contact: { workspaceId: wsPay.id } },
        { company: { workspaceId: wsPay.id } },
      ],
    },
  });
  await prisma.clientAccount.deleteMany({
    where: { businessUnitId: buPay.id },
  });
  await prisma.offerSnapshot.deleteMany({
    where: { offer: { businessUnitId: buPay.id } },
  });
  await prisma.stripePriceMapping.deleteMany({
    where: { offerId: offerPay.id },
  });
  await prisma.offer.deleteMany({ where: { businessUnitId: buPay.id } });
  await prisma.auditLog.deleteMany({ where: { workspaceId: wsPay.id } });
  await prisma.task.deleteMany({ where: { workspaceId: wsPay.id } });
  await prisma.opportunity.deleteMany({ where: { workspaceId: wsPay.id } });
  await prisma.stage.deleteMany({ where: { pipelineId: pipelinePay.id } });
  await prisma.pipeline.deleteMany({ where: { id: pipelinePay.id } });
  await prisma.contact.deleteMany({ where: { workspaceId: wsPay.id } });
  await prisma.membership.deleteMany({ where: { userId: userPay.id } });
  await prisma.user.delete({ where: { id: userPay.id } });
  await prisma.workspace.delete({ where: { id: wsPay.id } });
  await prisma.businessUnit.delete({ where: { id: buPay.id } });
  await prisma.organization.delete({ where: { id: orgPay.id } });

  // --- KPI classification (MIXED_SOURCES) + double-counting guard (Task 13) ---
  // Fresh fixture again -- the Pay block's fixture above is already torn
  // down by this point.
  console.log('\n📈 Testing KPI classification + double-counting guard...');

  const kpiSuffix = Date.now() + '-kpi';
  const orgKpi = await prisma.organization.create({
    data: { name: `Kpi Test Org ${kpiSuffix}` },
  });
  const buKpi = await prisma.businessUnit.create({
    data: {
      organizationId: orgKpi.id,
      key: 'MARKETING',
      name: 'DEMM Marketing',
    },
  });
  const wsKpi = await prisma.workspace.create({
    data: {
      organizationId: orgKpi.id,
      businessUnitId: buKpi.id,
      name: 'WS',
      subdomain: `kpi-${kpiSuffix}`,
    },
  });
  const passwordHashKpi = await bcrypt.hash('KpiTest123!', 10);
  const userKpi = await prisma.user.create({
    data: {
      email: `kpi-${kpiSuffix}@example.com`,
      passwordHash: passwordHashKpi,
      firstName: 'K',
      lastName: 'T',
    },
  });
  await prisma.membership.create({
    data: {
      userId: userKpi.id,
      organizationId: orgKpi.id,
      workspaceId: wsKpi.id,
      role: 'ORG_ADMIN',
    },
  });
  const pipelineKpi = await prisma.pipeline.create({
    data: { name: 'P', workspaceId: wsKpi.id },
  });
  const stageKpi = await prisma.stage.create({
    data: { name: 'New', order: 1, pipelineId: pipelineKpi.id },
  });

  const offerKpi = await prisma.offer.create({
    data: {
      businessUnitId: buKpi.id,
      key: `kpi-survivor-${kpiSuffix}`,
      version: 1,
      name: 'Kpi Survivor',
      price: 99,
      trialEligible: true,
      trialDays: 7,
      includedServices: [],
      excludedServices: [],
      onboardingRequirements: [],
      lifecycleState: 'ACTIVE',
    },
  });
  const mappingKpi = await prisma.stripePriceMapping.create({
    data: {
      offerId: offerKpi.id,
      offerVersion: 1,
      amount: 99,
      currency: 'usd',
      billingInterval: 'month',
      environment: 'local',
      livemode: false,
      stripeProductId: 'prod_fake_for_kpi_test',
      stripePriceId: 'price_fake_for_kpi_test',
    },
  });

  const contactKpi = await prisma.contact.create({
    data: {
      workspaceId: wsKpi.id,
      firstName: 'Kpi',
      lastName: 'Client',
      emails: [`kpi-client-${kpiSuffix}@example.com`],
      phones: [],
      status: 'LEAD',
    },
  });
  await prisma.opportunity.create({
    data: {
      workspaceId: wsKpi.id,
      contactId: contactKpi.id,
      pipelineId: pipelineKpi.id,
      stageId: stageKpi.id,
      name: 'Kpi Deal',
      value: 99,
      status: 'OPEN',
    },
  });

  const loginResKpi = await fetch(`${webhookBase}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: userKpi.email,
      passwordPlain: 'KpiTest123!',
    }),
  }).then((r) => r.json());
  const selectResKpi = await fetch(`${webhookBase}/api/auth/select-workspace`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${loginResKpi.preAuthToken}`,
    },
    body: JSON.stringify({ workspaceId: wsKpi.id }),
  }).then((r) => r.json());
  const tokenKpi = selectResKpi.access_token;
  const authHeadersKpi = {
    Authorization: `Bearer ${tokenKpi}`,
    'x-workspace-id': wsKpi.id,
  };

  const convertResKpi = await fetch(
    `${webhookBase}/marketing/leads/${contactKpi.id}/convert`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeadersKpi,
        'Idempotency-Key': `kpi-idem-${kpiSuffix}`,
      },
      body: JSON.stringify({
        offerId: offerKpi.id,
        contractState: 'SIGNED_MANUAL',
      }),
    },
  ).then((r) => r.json());

  const clientAccountIdKpi: string = convertResKpi.id;
  // Mark ACTIVE (not just PENDING_ONBOARDING) so computeMrr's
  // serviceStatus: ACTIVE filter picks this client up.
  await prisma.clientAccount.update({
    where: { id: clientAccountIdKpi },
    data: { serviceStatus: 'ACTIVE' },
  });
  const custForKpi = `cus_test_kpi_${kpiSuffix}`;
  await prisma.clientAccount.update({
    where: { id: clientAccountIdKpi },
    data: { stripeCustomerId: custForKpi },
  });

  const subForKpi = `sub_test_kpi_${kpiSuffix}`;
  await prisma.billingSubscription.create({
    data: {
      clientAccountId: clientAccountIdKpi,
      stripePriceMappingId: mappingKpi.id,
      stripeSubscriptionId: subForKpi,
      stripeCustomerId: custForKpi,
      status: 'ACTIVE',
    },
  });

  // A Stripe-sourced payment via webhook -- source: STRIPE_WEBHOOK.
  const kpiInvoicePayload = JSON.stringify({
    id: `evt_kpi_invpaid_${kpiSuffix}`,
    object: 'event',
    api_version: '2025-08-27.basil',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type: 'invoice.paid',
    data: {
      object: {
        id: `in_kpi_${kpiSuffix}`,
        object: 'invoice',
        customer: custForKpi,
        subscription: subForKpi,
        amount_paid: 9900,
        currency: 'usd',
        payment_intent: `pi_kpi_${kpiSuffix}`,
      },
    },
  });
  await deliverWebhook(kpiInvoicePayload);
  await new Promise((r) => setTimeout(r, 300));

  const dashboardResKpi1 = await fetch(`${webhookBase}/marketing/dashboard`, {
    headers: authHeadersKpi,
  }).then((r) => r.json());
  check(
    'Dashboard collectedRevenue90d is ACTUAL_VERIFIED when all payments are Stripe-sourced',
    dashboardResKpi1.revenueTrajectory.collectedRevenue90d.classification ===
      'ACTUAL_VERIFIED',
  );
  check(
    'Dashboard mrr is ACTUAL_VERIFIED when the only ACTIVE client has a Stripe-backed ACTIVE subscription',
    dashboardResKpi1.revenueTrajectory.mrr.classification ===
      'ACTUAL_VERIFIED' &&
      Number(dashboardResKpi1.revenueTrajectory.mrr.value) === 99,
  );

  // Manual PAYMENT entry blocked while a BillingSubscription is ACTIVE.
  const blockedResKpi = await fetch(
    `${webhookBase}/marketing/clients/${clientAccountIdKpi}/commercial-state`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeadersKpi },
      body: JSON.stringify({
        field: 'PAYMENT',
        newValue: 'PAID_IN_FULL_MANUAL',
        amount: 50,
      }),
    },
  );
  check(
    'Manual PAYMENT entry is rejected (409) while a Stripe subscription is ACTIVE',
    blockedResKpi.status === 409,
  );

  const overrideResKpi = await fetch(
    `${webhookBase}/marketing/clients/${clientAccountIdKpi}/commercial-state`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeadersKpi },
      body: JSON.stringify({
        field: 'PAYMENT',
        newValue: 'PAID_IN_FULL_MANUAL',
        amount: 50,
        allowManualAlongsideStripe: true,
      }),
    },
  );
  check(
    'Manual PAYMENT entry succeeds with allowManualAlongsideStripe: true (status 201)',
    overrideResKpi.status === 201,
  );

  const dashboardResKpi2 = await fetch(`${webhookBase}/marketing/dashboard`, {
    headers: authHeadersKpi,
  }).then((r) => r.json());
  check(
    'Dashboard collectedRevenue90d becomes MIXED_SOURCES once both a MANUAL and a STRIPE_WEBHOOK row exist',
    dashboardResKpi2.revenueTrajectory.collectedRevenue90d.classification ===
      'MIXED_SOURCES',
  );

  // --- Client Health COMMERCIAL factor from PAST_DUE subscription (Task 14) ---
  await prisma.billingSubscription.updateMany({
    where: { stripeSubscriptionId: subForKpi },
    data: { status: 'PAST_DUE' },
  });
  const healthRecalcResKpi = await fetch(
    `${webhookBase}/marketing/clients/${clientAccountIdKpi}/health/recalculate`,
    {
      method: 'POST',
      headers: authHeadersKpi,
    },
  ).then((r) => r.json());
  const hasCommercialFactorKpi = healthRecalcResKpi.factors?.some(
    (f: any) =>
      f.riskOwner === 'COMMERCIAL' && f.evidence?.includes('PAST_DUE'),
  );
  check(
    'Client Health surfaces a COMMERCIAL factor when the subscription is PAST_DUE',
    hasCommercialFactorKpi,
  );

  // --- DOM26-R RelationshipSignal lifecycle (Task 15) ---
  // Task 14's raw prisma.billingSubscription.updateMany above bypassed
  // signal emission entirely (it's a direct DB write, not a webhook) --
  // reset to ACTIVE and drive the rest of this section through real
  // webhook deliveries so every signal transition is genuinely exercised.
  await prisma.billingSubscription.updateMany({
    where: { stripeSubscriptionId: subForKpi },
    data: { status: 'ACTIVE' },
  });

  const profileForSignalsKpi = await prisma.relationshipSubject
    .findFirst({
      where: { contactId: contactKpi.id },
    })
    .then((subject) =>
      subject
        ? prisma.relationshipProfile.findFirst({
            where: { subjectId: subject.id, businessUnitId: buKpi.id },
          })
        : null,
    );
  const profileIdSignalsKpi = profileForSignalsKpi!.id;

  const signalsAfterEarlierPayment = await prisma.relationshipSignal.findMany({
    where: { profileId: profileIdSignalsKpi },
  });
  check(
    'PAYMENT_SUCCESS signal was created (and self-resolved) from the earlier invoice.paid delivery',
    signalsAfterEarlierPayment.some(
      (s) => s.type === 'PAYMENT_SUCCESS' && s.state === 'RESOLVED',
    ),
  );

  function synthesizeKpiSubscriptionEvent(
    eventType: string,
    id: string,
    overrides: Record<string, any> = {},
  ) {
    return JSON.stringify({
      id,
      object: 'event',
      api_version: '2025-08-27.basil',
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      type: eventType,
      data: {
        object: {
          id: subForKpi,
          object: 'subscription',
          customer: custForKpi,
          status: 'active',
          metadata: { clientAccountId: clientAccountIdKpi },
          items: {
            data: [
              {
                current_period_start: Math.floor(Date.now() / 1000),
                current_period_end: Math.floor(Date.now() / 1000) + 2592000,
              },
            ],
          },
          cancel_at_period_end: false,
          canceled_at: null,
          trial_start: null,
          trial_end: null,
          ...overrides,
        },
      },
    });
  }

  // 1. invoice.payment_failed -> PAYMENT_FAILURE signal (ACTIVE).
  await deliverWebhook(
    JSON.stringify({
      id: `evt_kpi_payfail_${kpiSuffix}`,
      object: 'event',
      api_version: '2025-08-27.basil',
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: `in_kpi_fail_${kpiSuffix}`,
          object: 'invoice',
          customer: custForKpi,
          subscription: subForKpi,
        },
      },
    }),
  );
  await new Promise((r) => setTimeout(r, 300));
  const signalsAfterFailure = await prisma.relationshipSignal.findMany({
    where: { profileId: profileIdSignalsKpi },
  });
  check(
    'invoice.payment_failed creates an ACTIVE PAYMENT_FAILURE signal',
    signalsAfterFailure.some(
      (s) => s.type === 'PAYMENT_FAILURE' && s.state === 'ACTIVE',
    ),
  );

  // 2. invoice.paid while a PAYMENT_FAILURE is active -> PAYMENT_RECOVERY
  // (self-resolved) + PAYMENT_FAILURE/PAST_DUE resolved, not another
  // plain PAYMENT_SUCCESS.
  await deliverWebhook(
    JSON.stringify({
      id: `evt_kpi_recover_${kpiSuffix}`,
      object: 'event',
      api_version: '2025-08-27.basil',
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      type: 'invoice.paid',
      data: {
        object: {
          id: `in_kpi_recover_${kpiSuffix}`,
          object: 'invoice',
          customer: custForKpi,
          subscription: subForKpi,
          amount_paid: 9900,
          currency: 'usd',
          payment_intent: `pi_kpi_recover_${kpiSuffix}`,
        },
      },
    }),
  );
  await new Promise((r) => setTimeout(r, 300));
  const signalsAfterRecovery = await prisma.relationshipSignal.findMany({
    where: { profileId: profileIdSignalsKpi },
  });
  check(
    'Recovery invoice.paid creates a RESOLVED PAYMENT_RECOVERY signal',
    signalsAfterRecovery.some(
      (s) => s.type === 'PAYMENT_RECOVERY' && s.state === 'RESOLVED',
    ),
  );
  const failureSignalAfterRecovery = signalsAfterRecovery.find(
    (s) => s.type === 'PAYMENT_FAILURE',
  );
  check(
    'The earlier PAYMENT_FAILURE signal is resolved by the recovery',
    failureSignalAfterRecovery?.state === 'RESOLVED',
  );

  // 3. customer.subscription.updated with cancel_at_period_end: true ->
  // CANCELLATION_SCHEDULED (ACTIVE).
  await deliverWebhook(
    synthesizeKpiSubscriptionEvent(
      'customer.subscription.updated',
      `evt_kpi_cancelsched_${kpiSuffix}`,
      { cancel_at_period_end: true },
    ),
  );
  await new Promise((r) => setTimeout(r, 300));
  const signalsAfterCancelScheduled = await prisma.relationshipSignal.findMany({
    where: { profileId: profileIdSignalsKpi },
  });
  check(
    'cancel_at_period_end: true creates an ACTIVE CANCELLATION_SCHEDULED signal',
    signalsAfterCancelScheduled.some(
      (s) => s.type === 'CANCELLATION_SCHEDULED' && s.state === 'ACTIVE',
    ),
  );

  // 4. Un-scheduling (cancel_at_period_end back to false) resolves it.
  await deliverWebhook(
    synthesizeKpiSubscriptionEvent(
      'customer.subscription.updated',
      `evt_kpi_cancelunsched_${kpiSuffix}`,
      { cancel_at_period_end: false },
    ),
  );
  await new Promise((r) => setTimeout(r, 300));
  const signalsAfterUnscheduled = await prisma.relationshipSignal.findMany({
    where: { profileId: profileIdSignalsKpi },
  });
  const cancelScheduledAfterUnschedule = signalsAfterUnscheduled.find(
    (s) => s.type === 'CANCELLATION_SCHEDULED',
  );
  check(
    'Un-scheduling cancellation resolves the CANCELLATION_SCHEDULED signal',
    cancelScheduledAfterUnschedule?.state === 'RESOLVED',
  );

  // 5. customer.subscription.deleted -> CANCELLATION_COMPLETED, stays
  // ACTIVE (needs human follow-up, never auto-resolved).
  await deliverWebhook(
    synthesizeKpiSubscriptionEvent(
      'customer.subscription.deleted',
      `evt_kpi_canceled_${kpiSuffix}`,
      { status: 'canceled' },
    ),
  );
  await new Promise((r) => setTimeout(r, 300));
  const signalsAfterDeleted = await prisma.relationshipSignal.findMany({
    where: { profileId: profileIdSignalsKpi },
  });
  check(
    'customer.subscription.deleted creates a CANCELLATION_COMPLETED signal that remains ACTIVE',
    signalsAfterDeleted.some(
      (s) => s.type === 'CANCELLATION_COMPLETED' && s.state === 'ACTIVE',
    ),
  );

  // Teardown.
  await prisma.billingSubscription.deleteMany({
    where: { clientAccountId: clientAccountIdKpi },
  });
  await prisma.clientCommercialStateChange.deleteMany({
    where: { clientAccountId: clientAccountIdKpi },
  });
  await prisma.billingPaymentRecord.deleteMany({
    where: { clientAccountId: clientAccountIdKpi },
  });
  await prisma.onboardingChecklistItem.deleteMany({
    where: { plan: { clientAccount: { businessUnitId: buKpi.id } } },
  });
  await prisma.onboardingChecklistItemHistory.deleteMany({
    where: { item: { plan: { clientAccount: { businessUnitId: buKpi.id } } } },
  });
  await prisma.onboardingPlan.deleteMany({
    where: { clientAccount: { businessUnitId: buKpi.id } },
  });
  await prisma.serviceDeliverable.deleteMany({
    where: { clientAccount: { businessUnitId: buKpi.id } },
  });
  await prisma.clientHealthOverride.deleteMany({
    where: { health: { clientAccount: { businessUnitId: buKpi.id } } },
  });
  await prisma.clientHealthHistory.deleteMany({
    where: { health: { clientAccount: { businessUnitId: buKpi.id } } },
  });
  await prisma.clientHealth.deleteMany({
    where: { clientAccount: { businessUnitId: buKpi.id } },
  });
  await prisma.memoryAuditEvent.deleteMany({
    where: { businessUnitId: buKpi.id },
  });
  const profilesKpi = await prisma.relationshipProfile.findMany({
    where: { businessUnitId: buKpi.id },
    select: { id: true },
  });
  const profileIdsKpi = profilesKpi.map((p) => p.id);
  await prisma.briefEvidence.deleteMany({
    where: { brief: { profileId: { in: profileIdsKpi } } },
  });
  await prisma.relationshipBrief.deleteMany({
    where: { profileId: { in: profileIdsKpi } },
  });
  await prisma.candidateEvidence.deleteMany({
    where: { candidate: { profileId: { in: profileIdsKpi } } },
  });
  await prisma.memoryApproval.deleteMany({
    where: { candidate: { profileId: { in: profileIdsKpi } } },
  });
  await prisma.memoryCandidate.deleteMany({
    where: { profileId: { in: profileIdsKpi } },
  });
  const engramEvidenceRowsKpi = await prisma.engramEvidence.findMany({
    where: { engram: { businessUnitId: buKpi.id } },
    select: { sourceId: true },
  });
  const ownedSourceIdsKpi = [
    ...new Set(engramEvidenceRowsKpi.map((r) => r.sourceId)),
  ];
  await prisma.engramEvidence.deleteMany({
    where: { engram: { businessUnitId: buKpi.id } },
  });
  await prisma.engram.deleteMany({ where: { businessUnitId: buKpi.id } });
  await prisma.engramSource.deleteMany({
    where: { id: { in: ownedSourceIdsKpi } },
  });
  await prisma.relationshipProfile.deleteMany({
    where: { businessUnitId: buKpi.id },
  });
  await prisma.relationshipSubject.deleteMany({
    where: {
      OR: [
        { contact: { workspaceId: wsKpi.id } },
        { company: { workspaceId: wsKpi.id } },
      ],
    },
  });
  await prisma.clientAccount.deleteMany({
    where: { businessUnitId: buKpi.id },
  });
  await prisma.offerSnapshot.deleteMany({
    where: { offer: { businessUnitId: buKpi.id } },
  });
  await prisma.stripePriceMapping.deleteMany({
    where: { offerId: offerKpi.id },
  });
  await prisma.offer.deleteMany({ where: { businessUnitId: buKpi.id } });
  await prisma.auditLog.deleteMany({ where: { workspaceId: wsKpi.id } });
  await prisma.task.deleteMany({ where: { workspaceId: wsKpi.id } });
  await prisma.opportunity.deleteMany({ where: { workspaceId: wsKpi.id } });
  await prisma.stage.deleteMany({ where: { pipelineId: pipelineKpi.id } });
  await prisma.pipeline.deleteMany({ where: { id: pipelineKpi.id } });
  await prisma.contact.deleteMany({ where: { workspaceId: wsKpi.id } });
  await prisma.membership.deleteMany({ where: { userId: userKpi.id } });
  await prisma.user.delete({ where: { id: userKpi.id } });
  await prisma.workspace.delete({ where: { id: wsKpi.id } });
  await prisma.businessUnit.delete({ where: { id: buKpi.id } });
  await prisma.organization.delete({ where: { id: orgKpi.id } });

  // --- StripeProvisioningService (real Stripe test-mode API calls) ---
  console.log(
    '\n🏭 Testing StripeProvisioningService (real Stripe test-mode API)...',
  );
  const provisioning = new StripeProvisioningService(
    prisma as any,
    new StripeEnvironmentGuard(),
  );

  process.env.APP_ENVIRONMENT = 'local';
  const firstRun = await provisioning.syncOfferPrices();
  const survivorResult = firstRun.find((r) => r.key === 'SURVIVOR');
  check(
    'syncOfferPrices provisions a StripePriceMapping for SURVIVOR',
    !!survivorResult,
  );

  const secondRun = await provisioning.syncOfferPrices();
  const survivorSecond = secondRun.find((r) => r.key === 'SURVIVOR');
  check(
    'Re-running syncOfferPrices is a no-op for SURVIVOR (created: false, same mapping)',
    survivorSecond?.created === false &&
      survivorSecond?.mappingId === survivorResult?.mappingId,
  );

  const survivorMapping = await prisma.stripePriceMapping.findUnique({
    where: { id: survivorResult!.mappingId },
  });
  check(
    'StripePriceMapping has correct amount/environment/livemode for SURVIVOR',
    Number(survivorMapping?.amount) === 99 &&
      survivorMapping?.environment === 'local' &&
      survivorMapping?.livemode === false,
  );

  const growthResult = firstRun.find((r) => r.key === 'GROWTH');
  const empireResult = firstRun.find((r) => r.key === 'EMPIRE');
  check(
    'syncOfferPrices also provisions GROWTH and EMPIRE',
    !!growthResult && !!empireResult,
  );

  // --- StripeCheckoutService (real Stripe test-mode API calls) ---
  console.log(
    '\n🛒 Testing StripeCheckoutService (real Stripe test-mode API)...',
  );

  const checkoutSuffix = Date.now() + '-checkout';
  const orgCheckout = await prisma.organization.create({
    data: { name: `Checkout Test Org ${checkoutSuffix}` },
  });
  const buCheckout = await prisma.businessUnit.create({
    data: {
      organizationId: orgCheckout.id,
      key: 'MARKETING',
      name: 'DEMM Marketing',
    },
  });
  const wsCheckout = await prisma.workspace.create({
    data: {
      organizationId: orgCheckout.id,
      businessUnitId: buCheckout.id,
      name: 'WS',
      subdomain: `checkout-${checkoutSuffix}`,
    },
  });
  const passwordHashCheckout = await bcrypt.hash('CheckoutTest123!', 10);
  const userCheckout = await prisma.user.create({
    data: {
      email: `checkout-${checkoutSuffix}@example.com`,
      passwordHash: passwordHashCheckout,
      firstName: 'C',
      lastName: 'T',
    },
  });
  await prisma.membership.create({
    data: {
      userId: userCheckout.id,
      organizationId: orgCheckout.id,
      workspaceId: wsCheckout.id,
      role: 'ORG_ADMIN',
    },
  });
  const pipelineCheckout = await prisma.pipeline.create({
    data: { name: 'P', workspaceId: wsCheckout.id },
  });
  const stageCheckout = await prisma.stage.create({
    data: { name: 'New', order: 1, pipelineId: pipelineCheckout.id },
  });

  // A throwaway ACTIVE Offer, provisioned for real through
  // StripeProvisioningService so its OfferSnapshot binds to a REAL
  // stripePriceId -- Stripe's actual checkout.sessions.create call would
  // reject a fake/nonexistent price id, so this can't use a placeholder
  // mapping the way earlier, non-checkout tests could.
  const offerCheckout = await prisma.offer.create({
    data: {
      businessUnitId: buCheckout.id,
      key: `checkout-survivor-${checkoutSuffix}`,
      version: 1,
      name: 'Checkout Survivor',
      price: 99,
      trialEligible: true,
      trialDays: 7,
      includedServices: [],
      excludedServices: [],
      onboardingRequirements: [],
      lifecycleState: 'ACTIVE',
    },
  });
  await provisioning.syncOfferPrices();
  const checkoutMapping = await prisma.stripePriceMapping.findUnique({
    where: {
      offerId_offerVersion_environment_livemode: {
        offerId: offerCheckout.id,
        offerVersion: 1,
        environment: 'local',
        livemode: false,
      },
    },
  });
  check(
    'Throwaway checkout-test Offer got a real StripePriceMapping provisioned',
    !!checkoutMapping,
  );

  const contactCheckout = await prisma.contact.create({
    data: {
      workspaceId: wsCheckout.id,
      firstName: 'Checkout',
      lastName: 'Client',
      emails: [`checkout-client-${checkoutSuffix}@example.com`],
      phones: [],
      status: 'LEAD',
    },
  });
  await prisma.opportunity.create({
    data: {
      workspaceId: wsCheckout.id,
      contactId: contactCheckout.id,
      pipelineId: pipelineCheckout.id,
      stageId: stageCheckout.id,
      name: 'Checkout Deal',
      value: 99,
      status: 'OPEN',
    },
  });

  const loginResCheckout = await fetch(`${webhookBase}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: userCheckout.email,
      passwordPlain: 'CheckoutTest123!',
    }),
  }).then((r) => r.json());
  const selectResCheckout = await fetch(
    `${webhookBase}/api/auth/select-workspace`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginResCheckout.preAuthToken}`,
      },
      body: JSON.stringify({ workspaceId: wsCheckout.id }),
    },
  ).then((r) => r.json());
  const tokenCheckout = selectResCheckout.access_token;

  const convertResCheckout = await fetch(
    `${webhookBase}/marketing/leads/${contactCheckout.id}/convert`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenCheckout}`,
        'x-workspace-id': wsCheckout.id,
        'Idempotency-Key': `checkout-idem-${checkoutSuffix}`,
      },
      body: JSON.stringify({
        offerId: offerCheckout.id,
        contractState: 'SIGNED_MANUAL',
      }),
    },
  ).then((r) => r.json());
  const clientAccountIdCheckout: string = convertResCheckout.id;

  const checkoutService = new StripeCheckoutService(
    prisma as any,
    new StripeEnvironmentGuard(),
    new BillingRelationshipSignalService(prisma as any),
  );

  const checkoutResult = await checkoutService.createSubscriptionCheckout(
    clientAccountIdCheckout,
    1,
  );
  check(
    'createSubscriptionCheckout returns a Stripe-hosted checkout URL',
    checkoutResult.checkoutUrl.startsWith('https://checkout.stripe.com/'),
  );

  const clientAfterCheckout = await prisma.clientAccount.findUnique({
    where: { id: clientAccountIdCheckout },
  });
  check(
    'ClientAccount.stripeCustomerId is populated',
    !!clientAfterCheckout?.stripeCustomerId,
  );

  const checkoutRow = await prisma.billingCheckoutSession.findFirst({
    where: { clientAccountId: clientAccountIdCheckout },
    orderBy: { createdAt: 'desc' },
  });
  check(
    'BillingCheckoutSession row persisted with status CREATED and a checkoutUrl',
    checkoutRow?.status === 'CREATED' && !!checkoutRow?.checkoutUrl,
  );

  // SURVIVOR-style trial: confirm the Checkout Session actually has trial days set.
  const stripeForVerify = createStripeClient();
  const liveSession = await stripeForVerify.checkout.sessions.retrieve(
    checkoutResult.sessionId,
  );
  check(
    'Checkout Session carries clientAccountId in metadata',
    liveSession.metadata?.clientAccountId === clientAccountIdCheckout,
  );

  // Regeneration.
  const regenerated = await checkoutService.regenerateCheckout(
    clientAccountIdCheckout,
  );
  const regeneratedRow = await prisma.billingCheckoutSession.findFirst({
    where: { clientAccountId: clientAccountIdCheckout },
    orderBy: { createdAt: 'desc' },
  });
  check(
    'Regeneration creates attemptNumber: 2 with a fresh idempotency key',
    regeneratedRow?.attemptNumber === 2 &&
      regeneratedRow?.idempotencyKey !== checkoutRow?.idempotencyKey,
  );

  // Stripe-side idempotency: calling createSubscriptionCheckout again with
  // the SAME attemptNumber (simulating a retry after local persistence
  // failed, before this row existed) must not create a second Stripe
  // object -- Stripe replays the original response for the same key.
  const idempotentRetryResult =
    await checkoutService.createSubscriptionCheckout(
      clientAccountIdCheckout,
      2,
    );
  check(
    'Retrying with the same attemptNumber/idempotency key returns the SAME Stripe session (no duplicate)',
    idempotentRetryResult.sessionId === regenerated.sessionId,
  );

  // --- Task 8: conversion auto-generates checkout, HTTP endpoints ---
  check(
    'convert() response includes an auto-generated checkoutUrl (wired into the controller, not just the service)',
    typeof convertResCheckout.checkoutUrl === 'string' &&
      convertResCheckout.checkoutUrl.startsWith('https://checkout.stripe.com/'),
  );

  const getCheckoutRes = await fetch(
    `${webhookBase}/marketing/clients/${clientAccountIdCheckout}/billing/checkout`,
    {
      headers: {
        Authorization: `Bearer ${tokenCheckout}`,
        'x-workspace-id': wsCheckout.id,
      },
    },
  ).then((r) => r.json());
  check(
    'GET .../billing/checkout returns the latest persisted checkout session with subscriptionStatus',
    getCheckoutRes.status === 'CREATED' &&
      'subscriptionStatus' in getCheckoutRes,
  );

  const regenHttpRes = await fetch(
    `${webhookBase}/marketing/clients/${clientAccountIdCheckout}/billing/checkout/regenerate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenCheckout}`,
        'x-workspace-id': wsCheckout.id,
      },
    },
  );
  check(
    'POST .../billing/checkout/regenerate succeeds for an authorized role (ORG_ADMIN)',
    regenHttpRes.status === 201 || regenHttpRes.status === 200,
  );
  const regenHttpBody = await regenHttpRes.json();
  check(
    'Regeneration via HTTP returns a checkout URL',
    typeof regenHttpBody.checkoutUrl === 'string',
  );

  // DOM26-R: CHECKOUT_PENDING signal exists after successful checkout generation.
  const subjectCheckout = await prisma.relationshipSubject.findFirst({
    where: { contactId: contactCheckout.id },
  });
  const profileCheckout = subjectCheckout
    ? await prisma.relationshipProfile.findFirst({
        where: { subjectId: subjectCheckout.id, businessUnitId: buCheckout.id },
      })
    : null;
  const signalsCheckout = profileCheckout
    ? await prisma.relationshipSignal.findMany({
        where: { profileId: profileCheckout.id },
      })
    : [];
  check(
    'Successful checkout generation creates a CHECKOUT_PENDING signal',
    signalsCheckout.some((s) => s.type === 'CHECKOUT_PENDING'),
  );

  // --- Task 9: checkout failure visibility (Task, RelationshipSignal, audit event) ---
  // A second Offer, deliberately never Stripe-provisioned, so conversion
  // against it triggers createSubscriptionCheckout's BadRequestException
  // path -- exercising the full failure-handling chain end-to-end.
  const offerNoMapping = await prisma.offer.create({
    data: {
      businessUnitId: buCheckout.id,
      key: `checkout-no-mapping-${checkoutSuffix}`,
      version: 1,
      name: 'No Mapping Offer',
      price: 50,
      includedServices: [],
      excludedServices: [],
      onboardingRequirements: [],
      lifecycleState: 'ACTIVE',
    },
  });
  const contactFail = await prisma.contact.create({
    data: {
      workspaceId: wsCheckout.id,
      firstName: 'Fail',
      lastName: 'Client',
      emails: [`checkout-fail-${checkoutSuffix}@example.com`],
      phones: [],
      status: 'LEAD',
    },
  });
  await prisma.opportunity.create({
    data: {
      workspaceId: wsCheckout.id,
      contactId: contactFail.id,
      pipelineId: pipelineCheckout.id,
      stageId: stageCheckout.id,
      name: 'Fail Deal',
      value: 50,
      status: 'OPEN',
    },
  });
  const convertFailRes = await fetch(
    `${webhookBase}/marketing/leads/${contactFail.id}/convert`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenCheckout}`,
        'x-workspace-id': wsCheckout.id,
        'Idempotency-Key': `checkout-fail-idem-${checkoutSuffix}`,
      },
      body: JSON.stringify({ offerId: offerNoMapping.id }),
    },
  ).then((r) => r.json());
  await new Promise((r) => setTimeout(r, 500)); // let the .catch()'d async failure handler finish

  check(
    'Conversion against an unprovisioned Offer still succeeds (checkout failure never fails conversion)',
    !!convertFailRes.id && convertFailRes.checkoutUrl === null,
  );

  // No BillingCheckoutSession row is expected here: the missing-mapping
  // check in createSubscriptionCheckout throws BEFORE any row is created
  // (there's no Stripe Price to attempt a session against yet). Failure
  // visibility instead comes from the Task/signal/audit-event checks below.
  const failedCheckoutRow = await prisma.billingCheckoutSession.findFirst({
    where: { clientAccountId: convertFailRes.id },
    orderBy: { createdAt: 'desc' },
  });
  check(
    'Missing-mapping failure creates no orphaned BillingCheckoutSession row',
    failedCheckoutRow === null,
  );

  const failureTask = await prisma.task.findFirst({
    where: {
      contactId: contactFail.id,
      title: { contains: 'Billing setup failed' },
    },
  });
  check('Checkout failure creates an operator Task', !!failureTask);

  const subjectFail = await prisma.relationshipSubject.findFirst({
    where: { contactId: contactFail.id },
  });
  const profileFail = subjectFail
    ? await prisma.relationshipProfile.findFirst({
        where: { subjectId: subjectFail.id, businessUnitId: buCheckout.id },
      })
    : null;
  const signalsFail = profileFail
    ? await prisma.relationshipSignal.findMany({
        where: { profileId: profileFail.id },
      })
    : [];
  check(
    'Checkout failure creates an ACTIVE BILLING_SETUP_FAILED signal',
    signalsFail.some(
      (s) => s.type === 'BILLING_SETUP_FAILED' && s.state === 'ACTIVE',
    ),
  );

  const failureAuditEvent = await prisma.memoryAuditEvent.findFirst({
    where: { businessUnitId: buCheckout.id, action: 'BILLING_CHECKOUT_FAILED' },
  });
  check(
    'Checkout failure writes a MemoryAuditEvent audit trail entry',
    !!failureAuditEvent,
  );

  // Teardown.
  await prisma.billingCheckoutSession.deleteMany({
    where: { clientAccountId: clientAccountIdCheckout },
  });
  await prisma.onboardingChecklistItem.deleteMany({
    where: { plan: { clientAccount: { businessUnitId: buCheckout.id } } },
  });
  await prisma.onboardingChecklistItemHistory.deleteMany({
    where: {
      item: { plan: { clientAccount: { businessUnitId: buCheckout.id } } },
    },
  });
  await prisma.onboardingPlan.deleteMany({
    where: { clientAccount: { businessUnitId: buCheckout.id } },
  });
  await prisma.serviceDeliverable.deleteMany({
    where: { clientAccount: { businessUnitId: buCheckout.id } },
  });
  await prisma.clientHealthOverride.deleteMany({
    where: { health: { clientAccount: { businessUnitId: buCheckout.id } } },
  });
  await prisma.clientHealthHistory.deleteMany({
    where: { health: { clientAccount: { businessUnitId: buCheckout.id } } },
  });
  await prisma.clientHealth.deleteMany({
    where: { clientAccount: { businessUnitId: buCheckout.id } },
  });
  await prisma.memoryAuditEvent.deleteMany({
    where: { businessUnitId: buCheckout.id },
  });
  const profilesCheckout = await prisma.relationshipProfile.findMany({
    where: { businessUnitId: buCheckout.id },
    select: { id: true },
  });
  const profileIdsCheckout = profilesCheckout.map((p) => p.id);
  await prisma.briefEvidence.deleteMany({
    where: { brief: { profileId: { in: profileIdsCheckout } } },
  });
  await prisma.relationshipBrief.deleteMany({
    where: { profileId: { in: profileIdsCheckout } },
  });
  await prisma.candidateEvidence.deleteMany({
    where: { candidate: { profileId: { in: profileIdsCheckout } } },
  });
  await prisma.memoryApproval.deleteMany({
    where: { candidate: { profileId: { in: profileIdsCheckout } } },
  });
  await prisma.memoryCandidate.deleteMany({
    where: { profileId: { in: profileIdsCheckout } },
  });
  const engramEvidenceRowsCheckout = await prisma.engramEvidence.findMany({
    where: { engram: { businessUnitId: buCheckout.id } },
    select: { sourceId: true },
  });
  const ownedSourceIdsCheckout = [
    ...new Set(engramEvidenceRowsCheckout.map((r) => r.sourceId)),
  ];
  await prisma.engramEvidence.deleteMany({
    where: { engram: { businessUnitId: buCheckout.id } },
  });
  await prisma.engram.deleteMany({ where: { businessUnitId: buCheckout.id } });
  await prisma.engramSource.deleteMany({
    where: { id: { in: ownedSourceIdsCheckout } },
  });
  await prisma.relationshipProfile.deleteMany({
    where: { businessUnitId: buCheckout.id },
  });
  await prisma.relationshipSubject.deleteMany({
    where: {
      OR: [
        { contact: { workspaceId: wsCheckout.id } },
        { company: { workspaceId: wsCheckout.id } },
      ],
    },
  });
  await prisma.clientAccount.deleteMany({
    where: { businessUnitId: buCheckout.id },
  });
  await prisma.offerSnapshot.deleteMany({
    where: { offer: { businessUnitId: buCheckout.id } },
  });
  await prisma.stripePriceMapping.deleteMany({
    where: { offerId: offerCheckout.id },
  });
  await prisma.offer.deleteMany({ where: { businessUnitId: buCheckout.id } });
  await prisma.auditLog.deleteMany({ where: { workspaceId: wsCheckout.id } });
  await prisma.task.deleteMany({ where: { workspaceId: wsCheckout.id } });
  await prisma.opportunity.deleteMany({
    where: { workspaceId: wsCheckout.id },
  });
  await prisma.stage.deleteMany({ where: { pipelineId: pipelineCheckout.id } });
  await prisma.pipeline.deleteMany({ where: { id: pipelineCheckout.id } });
  await prisma.contact.deleteMany({ where: { workspaceId: wsCheckout.id } });
  await prisma.membership.deleteMany({ where: { userId: userCheckout.id } });
  await prisma.user.delete({ where: { id: userCheckout.id } });
  await prisma.workspace.delete({ where: { id: wsCheckout.id } });
  await prisma.businessUnit.delete({ where: { id: buCheckout.id } });
  await prisma.organization.delete({ where: { id: orgCheckout.id } });

  await webhookApp.close();

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
