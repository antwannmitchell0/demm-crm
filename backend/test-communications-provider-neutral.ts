import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './src/app.module';
import { SMS_PROVIDER } from './src/modules/communications/interfaces/sms-provider.interface';
import { EMAIL_PROVIDER } from './src/modules/communications/interfaces/email-provider.interface';
import { FakeSmsProvider } from './src/modules/communications/testing/fake-sms-provider';
import { FakeEmailProvider } from './src/modules/communications/testing/fake-email-provider';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

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

// This suite's central fake instances -- shared across every app instance
// booted below so `sentMessages`/`sentEmails` accumulate consistently
// across the whole run and never touch a real network (Stage 1's
// provider-neutral requirement).
const fakeSms = new FakeSmsProvider();
const fakeEmail = new FakeEmailProvider();

// Boots a real Nest HTTP server backed by AppModule with SMS_PROVIDER/
// EMAIL_PROVIDER overridden to the shared fakes via Nest's overrideProvider
// -- the mechanism the Task 16 brief calls for, applied to the exact same
// NestFactory.create(AppModule)-equivalent boot pattern
// test-communications-sms-api.ts / test-communications-email-api.ts /
// test-stripe-billing-api.ts already establish (TestingModule.
// createNestApplication() produces the same INestApplication type NestFactory
// .create() does; the only difference is provider overriding is only
// possible via the Test.createTestingModule(...).overrideProvider(...) path,
// not via NestFactory.create() directly). `mountTwilioRawBody` mirrors the
// established two-app-instance split (Task 4.5's raw-body middleware on
// /webhooks/twilio must be registered before Nest's default JSON body
// parser has a chance to consume the request stream for that path, so
// webhook-testing apps are always separate instances from the auth/JSON
// app, exactly as both reference suites already do).
async function buildApp(mountTwilioRawBody: boolean) {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(SMS_PROVIDER)
    .useValue(fakeSms)
    .overrideProvider(EMAIL_PROVIDER)
    .useValue(fakeEmail)
    .compile();

  const app = moduleRef.createNestApplication();

  if (mountTwilioRawBody) {
    const express = await import('express');
    app.use(
      '/webhooks/twilio',
      express.raw({ type: 'application/x-www-form-urlencoded' }),
    );
  }

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
  return { app, base: `http://127.0.0.1:${port}` };
}

async function runApiTests() {
  console.log('🧪 STARTING COMMUNICATIONS PROVIDER-NEUTRAL SUITE (Stage 1)');
  console.log('=============================================================');

  const suffix = Date.now();
  // Deliberately shared across BU1 and BU2 -- see the "Business Unit
  // isolation" section below. A contact in one Business Unit coincidentally
  // sharing a phone number with a contact in a completely different
  // Business Unit is the exact real-world collision that would expose a
  // scoping bug if inbound resolution weren't correctly workspace-scoped
  // (the single most common real bug found across Tasks 10/13/14/15).
  const sharedPhone = `+1555${String(suffix).slice(-7)}`;
  // Suffixed (never a bare literal) so a prior run that crashed before its
  // own cleanup ran can never leave a stale ChannelConnection row with the
  // SAME externalAddress lying around for this run's `findFirst` webhook
  // lookups to accidentally resolve to -- exactly the kind of cross-run
  // collision that produced a false "Business Unit isolation" failure
  // while developing this suite (a leftover row from an earlier crashed
  // run, not a real product bug).
  const bu1Number = `+1556${String(suffix).slice(-7)}`; // BU1's connected Twilio number
  const bu2Number = `+1557${String(suffix).slice(-7)}`; // BU2's connected Twilio number
  const unknownNumber = `+1558${String(suffix).slice(-7)}`; // never connected to any Business Unit

  // ---------------------------------------------------------------------
  // Fixtures: one Organization, two independent Business Units (BU1/BU2),
  // each with its own Workspace/User/Pipeline/Stage/Offer/Contact,
  // converted to a real ClientAccount via the real HTTP convert flow --
  // same established pattern as test-communications-sms-api.ts, doubled so
  // Business-Unit-isolation scenarios have two genuinely separate tenants
  // to cross.
  // ---------------------------------------------------------------------
  const org = await prisma.organization.create({
    data: { name: `Provider Neutral Test Org ${suffix}` },
  });

  async function createBuFixture(label: 'BU1' | 'BU2', phone: string) {
    const bu = await prisma.businessUnit.create({
      data: { organizationId: org.id, key: `PN_${label}_${suffix}`, name: `PN ${label}` },
    });
    const ws = await prisma.workspace.create({
      data: {
        organizationId: org.id,
        businessUnitId: bu.id,
        name: `WS ${label}`,
        subdomain: `pn-${label.toLowerCase()}-${suffix}`,
      },
    });
    const bcrypt = await import('bcrypt');
    const passwordHash = await bcrypt.hash('PnTest123!', 10);
    const user = await prisma.user.create({
      data: {
        email: `pn-${label.toLowerCase()}-${suffix}@example.com`,
        passwordHash,
        firstName: label,
        lastName: 'User',
      },
    });
    await prisma.membership.create({
      data: {
        userId: user.id,
        organizationId: org.id,
        workspaceId: ws.id,
        role: 'ORG_ADMIN',
      },
    });
    const pipeline = await prisma.pipeline.create({
      data: { name: `P ${label}`, workspaceId: ws.id },
    });
    const stage = await prisma.stage.create({
      data: { name: 'New', order: 1, pipelineId: pipeline.id },
    });
    const offer = await prisma.offer.create({
      data: {
        businessUnitId: bu.id,
        key: `pn-offer-${label.toLowerCase()}-${suffix}`,
        version: 1,
        name: `${label} Test Offer`,
        price: 99,
        trialEligible: false,
        trialDays: 0,
        includedServices: [],
        excludedServices: [],
        onboardingRequirements: [],
        lifecycleState: 'ACTIVE',
      },
    });
    const contact = await prisma.contact.create({
      data: {
        workspaceId: ws.id,
        firstName: label,
        lastName: 'Client',
        emails: [`pn-${label.toLowerCase()}-contact-${suffix}@example.com`],
        phones: [phone],
        status: 'LEAD',
      },
    });
    await prisma.opportunity.create({
      data: {
        workspaceId: ws.id,
        contactId: contact.id,
        pipelineId: pipeline.id,
        stageId: stage.id,
        name: `${label} Deal`,
        value: 99,
        status: 'OPEN',
      },
    });
    return { bu, ws, user, pipeline, stage, offer, contact };
  }

  // Declared here (function scope, not inside the try block below) so the
  // `finally` block can see whatever got created even if a throw happens
  // partway through fixture setup or the test body -- e.g. bu1 succeeds
  // but bu2's createBuFixture call throws, or a findUniqueOrThrow/non-null
  // assertion/fetch failure happens deep in the test body.
  let bu1: Awaited<ReturnType<typeof createBuFixture>> | undefined;
  let bu2: Awaited<ReturnType<typeof createBuFixture>> | undefined;

  // Fixture teardown for a single Business Unit's full fixture graph.
  // Defined here (before the try block) rather than at the bottom of the
  // function so it is reachable from the `finally` block below regardless
  // of where in the try body a throw happens. Respects RESTRICT/Cascade
  // FKs -- delete children before parents, same teardown discipline as
  // test-communications-sms-api.ts / test-communications-email-api.ts.
  async function cleanupBu(bu: {
    bu: { id: string };
    ws: { id: string };
    user: { id: string };
    pipeline: { id: string };
    offer: { id: string };
    contact: { id: string };
  }) {
    await prisma.deliveryAttempt.deleteMany({
      where: { message: { conversation: { businessUnitId: bu.bu.id } } },
    });
    await prisma.message.deleteMany({
      where: { conversation: { businessUnitId: bu.bu.id } },
    });
    await prisma.communicationConsent.deleteMany({ where: { workspaceId: bu.ws.id } });
    await prisma.conversation.deleteMany({ where: { businessUnitId: bu.bu.id } });
    await prisma.channelConnection.deleteMany({ where: { businessUnitId: bu.bu.id } });

    await prisma.launchGateOverride.deleteMany({
      where: { plan: { clientAccount: { businessUnitId: bu.bu.id } } },
    });
    await prisma.onboardingChecklistItemHistory.deleteMany({
      where: { item: { plan: { clientAccount: { businessUnitId: bu.bu.id } } } },
    });
    await prisma.onboardingChecklistItem.deleteMany({
      where: { plan: { clientAccount: { businessUnitId: bu.bu.id } } },
    });
    await prisma.onboardingPlan.deleteMany({
      where: { clientAccount: { businessUnitId: bu.bu.id } },
    });
    await prisma.serviceDeliverableHistory.deleteMany({
      where: { deliverable: { clientAccount: { businessUnitId: bu.bu.id } } },
    });
    await prisma.serviceDeliverable.deleteMany({
      where: { clientAccount: { businessUnitId: bu.bu.id } },
    });

    await prisma.memoryAuditEvent.deleteMany({ where: { businessUnitId: bu.bu.id } });
    await prisma.briefEvidence.deleteMany({
      where: { brief: { profile: { businessUnitId: bu.bu.id } } },
    });
    await prisma.relationshipBrief.deleteMany({
      where: { profile: { businessUnitId: bu.bu.id } },
    });
    const candidateEvidenceRows = await prisma.candidateEvidence.findMany({
      where: { candidate: { profile: { businessUnitId: bu.bu.id } } },
      select: { sourceId: true },
    });
    const engramEvidenceRows = await prisma.engramEvidence.findMany({
      where: { engram: { businessUnitId: bu.bu.id } },
      select: { sourceId: true },
    });
    const ownedSourceIds = [
      ...new Set([
        ...candidateEvidenceRows.map((r) => r.sourceId),
        ...engramEvidenceRows.map((r) => r.sourceId),
      ]),
    ];
    await prisma.candidateEvidence.deleteMany({
      where: { candidate: { profile: { businessUnitId: bu.bu.id } } },
    });
    await prisma.memoryApproval.deleteMany({
      where: { candidate: { profile: { businessUnitId: bu.bu.id } } },
    });
    await prisma.memoryCandidate.deleteMany({
      where: { profile: { businessUnitId: bu.bu.id } },
    });
    await prisma.engramEvidence.deleteMany({
      where: { engram: { businessUnitId: bu.bu.id } },
    });
    await prisma.engram.deleteMany({ where: { businessUnitId: bu.bu.id } });
    await prisma.engramSource.deleteMany({ where: { id: { in: ownedSourceIds } } });
    await prisma.relationshipProfile.deleteMany({ where: { businessUnitId: bu.bu.id } });
    await prisma.relationshipSubject.deleteMany({
      where: {
        OR: [
          { contact: { workspaceId: bu.ws.id } },
          { company: { workspaceId: bu.ws.id } },
        ],
      },
    });
    await prisma.clientCommercialStateChange.deleteMany({
      where: { clientAccount: { businessUnitId: bu.bu.id } },
    });
    await prisma.conversionIdempotencyKey.deleteMany({
      where: { clientAccount: { businessUnitId: bu.bu.id } },
    });
    await prisma.clientAccount.deleteMany({ where: { businessUnitId: bu.bu.id } });
    await prisma.offerSnapshot.deleteMany({ where: { offer: { businessUnitId: bu.bu.id } } });
    await prisma.stripePriceMapping.deleteMany({ where: { offerId: bu.offer.id } });
    await prisma.offer.deleteMany({ where: { businessUnitId: bu.bu.id } });
    await prisma.auditLog.deleteMany({ where: { workspaceId: bu.ws.id } });
    await prisma.task.deleteMany({ where: { workspaceId: bu.ws.id } });
    await prisma.opportunity.deleteMany({ where: { workspaceId: bu.ws.id } });
    await prisma.stage.deleteMany({ where: { pipelineId: bu.pipeline.id } });
    await prisma.pipeline.deleteMany({ where: { id: bu.pipeline.id } });
    await prisma.contact.deleteMany({ where: { workspaceId: bu.ws.id } });
    await prisma.membership.deleteMany({ where: { userId: bu.user.id } });
    await prisma.user.delete({ where: { id: bu.user.id } });
    await prisma.workspace.delete({ where: { id: bu.ws.id } });
    await prisma.businessUnit.delete({ where: { id: bu.bu.id } });
  }

  // Everything below that touches the fixtures created above runs inside
  // this try block. If ANY operation throws before reaching the normal
  // end-of-suite cleanup call (a findUniqueOrThrow failing, a non-null
  // assertion failing, a fetch error, an assertion helper throwing, etc.),
  // the `finally` block still tears down whatever fixtures got created --
  // otherwise the entire fixture graph (org/2 BusinessUnits/workspaces/
  // users/contacts/channelConnections/conversations/messages/signals) is
  // orphaned in the shared dev database, exactly the "stale leftover row
  // from a prior crashed run" failure mode this suite's own
  // sharedPhone/bu1Number/bu2Number suffixing comments document having
  // been hit in practice.
  try {
    bu1 = await createBuFixture('BU1', sharedPhone);
    bu2 = await createBuFixture('BU2', sharedPhone); // same phone number as BU1's contact -- deliberate collision

  // --- Boot the main JSON app (auth + convert + outbound-send endpoint
  // testing) with SMS_PROVIDER/EMAIL_PROVIDER overridden to the fakes. ---
  const { app, base } = await buildApp(false);

  async function login(email: string, workspaceId: string) {
    const loginRes = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, passwordPlain: 'PnTest123!' }),
    }).then((r) => r.json());
    const selectRes = await fetch(`${base}/api/auth/select-workspace`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginRes.preAuthToken}`,
      },
      body: JSON.stringify({ workspaceId }),
    }).then((r) => r.json());
    return selectRes.access_token as string;
  }

  const token1 = await login(bu1.user.email, bu1.ws.id);
  const token2 = await login(bu2.user.email, bu2.ws.id);

  async function convert(
    token: string,
    wsId: string,
    contactId: string,
    offerId: string,
    idemSuffix: string,
  ) {
    const res = await fetch(`${base}/marketing/leads/${contactId}/convert`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'x-workspace-id': wsId,
        'Idempotency-Key': `pn-idem-${idemSuffix}`,
      },
      body: JSON.stringify({ offerId, contractState: 'SIGNED_MANUAL' }),
    }).then((r) => r.json());
    return res.id as string;
  }

  const clientAccount1Id = await convert(
    token1,
    bu1.ws.id,
    bu1.contact.id,
    bu1.offer.id,
    `bu1-${suffix}`,
  );
  const clientAccount2Id = await convert(
    token2,
    bu2.ws.id,
    bu2.contact.id,
    bu2.offer.id,
    `bu2-${suffix}`,
  );
  check(
    'BU1 lead converted to a ClientAccount',
    typeof clientAccount1Id === 'string',
  );
  check(
    'BU2 lead converted to a ClientAccount',
    typeof clientAccount2Id === 'string',
  );

  // --- Fail-closed sanity check: with fakes bound but NO ChannelConnection
  // yet, outbound SMS must still fail with 503, never a fabricated success
  // -- proves overriding the provider didn't accidentally bypass the
  // channel-connection gate. ---
  const noConnRes = await fetch(
    `${base}/marketing/clients/${clientAccount1Id}/communications/sms`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token1}`,
        'x-workspace-id': bu1.ws.id,
      },
      body: JSON.stringify({ body: 'too early' }),
    },
  );
  check(
    'Outbound SMS with no ACTIVE ChannelConnection returns 503 (fake bound, gate still enforced)',
    noConnRes.status === 503,
  );

  // --- Connect channels for both Business Units. ---
  const connSms1 = await prisma.channelConnection.create({
    data: {
      workspaceId: bu1.ws.id,
      businessUnitId: bu1.bu.id,
      type: 'SMS',
      provider: 'TWILIO',
      status: 'ACTIVE',
      externalAddress: bu1Number,
      lastVerifiedAt: new Date(),
    },
  });
  const connEmail1 = await prisma.channelConnection.create({
    data: {
      workspaceId: bu1.ws.id,
      businessUnitId: bu1.bu.id,
      type: 'EMAIL',
      provider: 'RESEND',
      status: 'ACTIVE',
      externalAddress: `bu1-${suffix}@reply.demmmarketing.com`,
      lastVerifiedAt: new Date(),
    },
  });
  const connSms2 = await prisma.channelConnection.create({
    data: {
      workspaceId: bu2.ws.id,
      businessUnitId: bu2.bu.id,
      type: 'SMS',
      provider: 'TWILIO',
      status: 'ACTIVE',
      externalAddress: bu2Number,
      lastVerifiedAt: new Date(),
    },
  });

  // --- DOM26-R fixtures: the lead-to-client convert flow above
  // (ClientAccountService.convert -> RelationshipProfileService
  // .getOrCreateProfile) already creates a RelationshipSubject +
  // RelationshipProfile for each converted contact, scoped to its own
  // Business Unit -- same chain
  // communication-relationship-signal.service.spec.ts sets up directly.
  // Fetch (not create) those existing rows; CommunicationRelationshipSignalService
  // .createSignal needs a profile to already exist to attach a
  // RelationshipSignal to (rather than no-op with a warning). ---
  const subject1 = await prisma.relationshipSubject.findUniqueOrThrow({
    where: { contactId: bu1.contact.id },
  });
  const profile1 = await prisma.relationshipProfile.findUniqueOrThrow({
    where: {
      subjectId_businessUnitId: { subjectId: subject1.id, businessUnitId: bu1.bu.id },
    },
  });
  const subject2 = await prisma.relationshipSubject.findUniqueOrThrow({
    where: { contactId: bu2.contact.id },
  });
  const profile2 = await prisma.relationshipProfile.findUniqueOrThrow({
    where: {
      subjectId_businessUnitId: { subjectId: subject2.id, businessUnitId: bu2.bu.id },
    },
  });

  // =====================================================================
  // MESSAGE CREATION + OUTBOUND SEND STATE
  // =====================================================================
  const sendSms1Res = await fetch(
    `${base}/marketing/clients/${clientAccount1Id}/communications/sms`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token1}`,
        'x-workspace-id': bu1.ws.id,
      },
      body: JSON.stringify({ body: 'Hello from DEMM (fake provider)' }),
    },
  );
  const sendSms1Body = await sendSms1Res.json();
  check('Outbound SMS via fake provider returns 201', sendSms1Res.status === 201);
  check(
    'Outbound SMS Message row has providerMessageId FAKE_SM_1 and status SENT',
    sendSms1Body.providerMessageId === 'FAKE_SM_1' &&
      sendSms1Body.status === 'SENT' &&
      sendSms1Body.direction === 'OUTBOUND',
  );
  check(
    'FakeSmsProvider.sendSms was actually invoked (never a real network call) with the right to/from/body',
    fakeSms.sentMessages.length === 1 &&
      fakeSms.sentMessages[0].to === sharedPhone &&
      fakeSms.sentMessages[0].from === bu1Number &&
      fakeSms.sentMessages[0].body === 'Hello from DEMM (fake provider)',
  );

  const sendEmail1Res = await fetch(
    `${base}/marketing/clients/${clientAccount1Id}/communications/email`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token1}`,
        'x-workspace-id': bu1.ws.id,
      },
      body: JSON.stringify({
        subject: 'Hello',
        html: '<p>Hello from DEMM (fake provider)</p>',
      }),
    },
  );
  const sendEmail1Body = await sendEmail1Res.json();
  check('Outbound email via fake provider returns 201', sendEmail1Res.status === 201);
  check(
    'Outbound email Message row has providerMessageId FAKE_EM_1 and status SENT',
    sendEmail1Body.providerMessageId === 'FAKE_EM_1' &&
      sendEmail1Body.status === 'SENT' &&
      sendEmail1Body.direction === 'OUTBOUND',
  );
  check(
    'FakeEmailProvider.sendEmail was actually invoked (never a real network call)',
    fakeEmail.sentEmails.length === 1 &&
      fakeEmail.sentEmails[0].subject === 'Hello',
  );

  // =====================================================================
  // CONVERSATION THREADING
  // =====================================================================
  const sendSms2Res = await fetch(
    `${base}/marketing/clients/${clientAccount1Id}/communications/sms`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token1}`,
        'x-workspace-id': bu1.ws.id,
      },
      body: JSON.stringify({ body: 'Second outbound message' }),
    },
  );
  check('Second outbound SMS to the same client returns 201', sendSms2Res.status === 201);
  check(
    'Second outbound SMS gets the NEXT deterministic providerMessageId (FAKE_SM_2)',
    (await sendSms2Res.clone().json()).providerMessageId === 'FAKE_SM_2',
  );

  const bu1ConversationsAfterTwoOutbound = await prisma.conversation.findMany({
    where: { channelConnectionId: connSms1.id, counterpartyAddress: sharedPhone },
  });
  check(
    'Two outbound sends to the same client thread into exactly ONE Conversation row',
    bu1ConversationsAfterTwoOutbound.length === 1,
  );
  const bu1Conversation = bu1ConversationsAfterTwoOutbound[0];

  await app.close();

  // --- Boot the raw-body Twilio webhook app for inbound/status testing. ---
  const { app: webhookApp, base: webhookBase } = await buildApp(true);
  const smsWebhookUrl = `${webhookBase}/webhooks/twilio/sms`;
  const smsStatusWebhookUrl = `${webhookBase}/webhooks/twilio/sms-status`;

  // Note: FakeSmsProvider.parseInboundSms reads providerMessageId/from/to/
  // body directly off the parsed form (see the brief's Step 1 fake) -- NOT
  // Twilio's MessageSid/From/To/Body field names. The sms-status endpoint,
  // by contrast, reads MessageSid/MessageStatus directly in
  // TwilioSmsWebhookController.handleSmsStatus without going through any
  // provider method at all, so THAT endpoint's form fields below are
  // deliberately Twilio-shaped. This asymmetry is the real, current
  // behavior of the two handlers, not a suite inconsistency.
  const inbound1Params = {
    providerMessageId: `IN_1_${suffix}`,
    from: sharedPhone,
    to: bu1Number,
    body: 'Hi there',
  };
  const inbound1Res = await fetch(smsWebhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': 'irrelevant-for-a-fake-provider',
    },
    body: new URLSearchParams(inbound1Params).toString(),
  });
  check('Inbound SMS webhook (fake provider, sig always valid) returns 200', inbound1Res.status === 200);

  const inbound1Message = await prisma.message.findUnique({
    where: { providerMessageId: inbound1Params.providerMessageId },
  });
  check(
    'Inbound SMS recorded as an INBOUND/RECEIVED Message row',
    inbound1Message?.direction === 'INBOUND' && inbound1Message?.status === 'RECEIVED',
  );
  check(
    'Inbound SMS threads into the SAME Conversation the outbound sends used (not a new one)',
    inbound1Message?.conversationId === bu1Conversation.id,
  );

  const bu1ConversationAfterInbound = await prisma.conversation.findUniqueOrThrow({
    where: { id: bu1Conversation.id },
  });
  check(
    'Conversation.lastMessageAt updated after the inbound reply',
    bu1ConversationAfterInbound.lastMessageAt?.getTime() ===
      inbound1Message?.createdAt.getTime(),
  );

  // =====================================================================
  // INBOUND INGESTION -- idempotent redelivery (a provider retry of the
  // exact same inbound delivery must never create a duplicate Message).
  // =====================================================================
  const redeliverInbound1Res = await fetch(smsWebhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': 'irrelevant-for-a-fake-provider',
    },
    body: new URLSearchParams(inbound1Params).toString(),
  });
  check('Redelivered inbound webhook still returns 200 (idempotent ack)', redeliverInbound1Res.status === 200);
  const inbound1MessagesAfterRedelivery = await prisma.message.findMany({
    where: { providerMessageId: inbound1Params.providerMessageId },
  });
  check(
    'Redelivering the same inbound webhook does not create a duplicate Message row',
    inbound1MessagesAfterRedelivery.length === 1,
  );

  // =====================================================================
  // RETRIES + FAILURES -- a transient failure followed by a successful
  // retry on the SAME outbound Message: DeliveryAttempt is append-only
  // (both attempts recorded), Message.status reflects the latest terminal
  // outcome.
  // =====================================================================
  const failedStatusParams = { MessageSid: 'FAKE_SM_1', MessageStatus: 'failed' };
  const failedStatusRes = await fetch(smsStatusWebhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': 'irrelevant-for-a-fake-provider',
    },
    body: new URLSearchParams(failedStatusParams).toString(),
  });
  check('Signed sms-status "failed" callback returns 200', failedStatusRes.status === 200);

  const messageAfterFailed = await prisma.message.findUnique({
    where: { providerMessageId: 'FAKE_SM_1' },
  });
  check('Message.status flips to FAILED after the failed callback', messageAfterFailed?.status === 'FAILED');

  const deliveredStatusParams = { MessageSid: 'FAKE_SM_1', MessageStatus: 'delivered' };
  const deliveredStatusRes = await fetch(smsStatusWebhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': 'irrelevant-for-a-fake-provider',
    },
    body: new URLSearchParams(deliveredStatusParams).toString(),
  });
  check(
    'Signed sms-status "delivered" retry callback returns 200',
    deliveredStatusRes.status === 200,
  );

  const messageAfterRetrySucceeded = await prisma.message.findUnique({
    where: { providerMessageId: 'FAKE_SM_1' },
  });
  check(
    'Message.status flips to DELIVERED once the retry succeeds',
    messageAfterRetrySucceeded?.status === 'DELIVERED',
  );

  const deliveryAttemptsForMessage1 = await prisma.deliveryAttempt.findMany({
    where: { message: { providerMessageId: 'FAKE_SM_1' } },
    orderBy: { occurredAt: 'asc' },
  });
  check(
    'Both delivery attempts (FAILED then SUCCEEDED) are preserved append-only, not overwritten',
    deliveryAttemptsForMessage1.length === 2 &&
      deliveryAttemptsForMessage1[0].outcome === 'FAILED' &&
      deliveryAttemptsForMessage1[1].outcome === 'SUCCEEDED',
  );

  // =====================================================================
  // CONSENT + AUTOMATION STOPPING (BU1)
  // =====================================================================
  const sentCountBeforeStop = fakeSms.sentMessages.length;
  const stopParams = {
    providerMessageId: `STOP_1_${suffix}`,
    from: sharedPhone,
    to: bu1Number,
    body: 'STOP',
  };
  const stopRes = await fetch(smsWebhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': 'irrelevant-for-a-fake-provider',
    },
    body: new URLSearchParams(stopParams).toString(),
  });
  check('Inbound STOP webhook returns 200', stopRes.status === 200);

  const consentAfterStop = await prisma.communicationConsent.findUnique({
    where: { contactId_channel: { contactId: bu1.contact.id, channel: 'SMS' } },
  });
  check(
    'CommunicationConsent row created with optedOut: true after STOP',
    consentAfterStop?.optedOut === true,
  );

  const signalAfterStop = await prisma.relationshipSignal.findFirst({
    where: { profileId: profile1.id, type: 'CONSENT_STOP' },
  });
  check(
    'DOM26-R: a CONSENT_STOP RelationshipSignal was created for BU1\'s profile after the STOP',
    signalAfterStop !== null && signalAfterStop.state === 'ACTIVE',
  );

  await webhookApp.close();

  // Reboot the JSON app (fresh instance -- same overridden providers) to
  // attempt an outbound send AFTER the opt-out was recorded.
  const { app: app2, base: base2 } = await buildApp(false);
  const blockedSendRes = await fetch(
    `${base2}/marketing/clients/${clientAccount1Id}/communications/sms`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token1}`,
        'x-workspace-id': bu1.ws.id,
      },
      body: JSON.stringify({ body: 'Should never send -- contact opted out' }),
    },
  );
  check(
    'Automation stopping: outbound SMS to an opted-out contact is blocked with 403',
    blockedSendRes.status === 403,
  );
  check(
    'Automation stopping: FakeSmsProvider.sendSms was NEVER invoked for the blocked attempt (send genuinely halted before reaching the provider)',
    fakeSms.sentMessages.length === sentCountBeforeStop,
  );
  const messagesAfterBlockedAttempt = await prisma.message.findMany({
    where: { conversationId: bu1Conversation.id },
  });
  const bodiesAfterBlockedAttempt = messagesAfterBlockedAttempt.map((m) => m.body);
  check(
    'Automation stopping: no Message row was created for the blocked send attempt',
    !bodiesAfterBlockedAttempt.includes('Should never send -- contact opted out'),
  );

  // =====================================================================
  // BUSINESS UNIT ISOLATION
  // =====================================================================

  // --- (a) Cross-BU IDOR on the outbound-send controller: an authenticated
  // BU2 user must never be able to send as/to a BU1 ClientAccount by
  // supplying its id, and vice versa. Mirrors the exact bug class the
  // email.controller.ts comment documents was found and fixed in Task 10.
  const buAToBIdorRes = await fetch(
    `${base2}/marketing/clients/${clientAccount1Id}/communications/sms`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token2}`, // BU2's own token/workspace
        'x-workspace-id': bu2.ws.id,
      },
      body: JSON.stringify({ body: 'cross-BU attempt' }),
    },
  );
  check(
    'BU isolation: BU2 user cannot target BU1\'s clientAccountId (404, not a cross-tenant send)',
    buAToBIdorRes.status === 404,
  );
  const buBToAIdorRes = await fetch(
    `${base2}/marketing/clients/${clientAccount2Id}/communications/sms`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token1}`, // BU1's own token/workspace
        'x-workspace-id': bu1.ws.id,
      },
      body: JSON.stringify({ body: 'cross-BU attempt' }),
    },
  );
  check(
    'BU isolation: BU1 user cannot target BU2\'s clientAccountId (404, not a cross-tenant send)',
    buBToAIdorRes.status === 404,
  );
  await app2.close();

  // --- (b)/(c)/(d)/(e) Inbound webhook isolation, including the deliberate
  // shared-phone-number collision set up above. ---
  const { app: webhookApp2, base: webhookBase2 } = await buildApp(true);
  const smsWebhookUrl2 = `${webhookBase2}/webhooks/twilio/sms`;

  const bu1ConversationCountBeforeCollision = await prisma.message.count({
    where: { conversationId: bu1Conversation.id },
  });

  // (b) The SAME phone number, now texting BU2's connected number, must
  // resolve to BU2's own contact -- never BU1's, and must never touch BU1's
  // existing Conversation/Message rows for that number at all.
  const collisionToBu2Params = {
    providerMessageId: `IN_2_${suffix}`,
    from: sharedPhone,
    to: bu2Number,
    body: 'Message to BU2 using the shared phone number',
  };
  const collisionToBu2Res = await fetch(smsWebhookUrl2, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': 'irrelevant-for-a-fake-provider',
    },
    body: new URLSearchParams(collisionToBu2Params).toString(),
  });
  check('Collision-number inbound webhook to BU2 returns 200', collisionToBu2Res.status === 200);

  const collisionMessage = await prisma.message.findUnique({
    where: { providerMessageId: collisionToBu2Params.providerMessageId },
    include: { conversation: true },
  });
  check(
    'BU isolation: the shared-phone-number message sent to BU2\'s number resolves to BU2\'s own contact, never BU1\'s',
    collisionMessage?.conversation.contactId === bu2.contact.id,
  );
  check(
    'BU isolation: the shared-phone-number message threads into a DIFFERENT Conversation than BU1\'s',
    collisionMessage?.conversation.id !== bu1Conversation.id &&
      collisionMessage?.conversation.businessUnitId === bu2.bu.id,
  );

  const bu1ConversationCountAfterCollision = await prisma.message.count({
    where: { conversationId: bu1Conversation.id },
  });
  check(
    'BU isolation: BU1\'s existing Conversation is completely untouched by BU2\'s inbound message from the same phone number',
    bu1ConversationCountAfterCollision === bu1ConversationCountBeforeCollision,
  );

  const bu2Conversation = collisionMessage!.conversation;

  // (c) Reverse direction: the same shared phone number texting back to
  // BU1's number must resolve to BU1's own existing contact/conversation,
  // never BU2's, even though a contact with that phone number now exists in
  // BOTH Business Units.
  const collisionToBu1Params = {
    providerMessageId: `IN_3_${suffix}`,
    from: sharedPhone,
    to: bu1Number,
    body: 'Message back to BU1 using the shared phone number',
  };
  const collisionToBu1Res = await fetch(smsWebhookUrl2, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': 'irrelevant-for-a-fake-provider',
    },
    body: new URLSearchParams(collisionToBu1Params).toString(),
  });
  check('Collision-number inbound webhook to BU1 returns 200', collisionToBu1Res.status === 200);
  const collisionBackMessage = await prisma.message.findUnique({
    where: { providerMessageId: collisionToBu1Params.providerMessageId },
    include: { conversation: true },
  });
  check(
    'BU isolation: the shared-phone-number message sent to BU1\'s number resolves to BU1\'s own contact, never BU2\'s',
    collisionBackMessage?.conversation.contactId === bu1.contact.id,
  );
  check(
    'BU isolation: the shared-phone-number reply to BU1 threads into BU1\'s EXISTING Conversation, not BU2\'s',
    collisionBackMessage?.conversation.id === bu1Conversation.id,
  );

  // (d) DOM26-R signal isolation: a STOP event on BU2's (colliding-number)
  // contact must create a signal on BU2's profile ONLY -- BU1's profile and
  // signal count for the same signal type must be completely unaffected.
  const bu1StopSignalCountBefore = await prisma.relationshipSignal.count({
    where: { profileId: profile1.id, type: 'CONSENT_STOP' },
  });
  const stopBu2Params = {
    providerMessageId: `STOP_2_${suffix}`,
    from: sharedPhone,
    to: bu2Number,
    body: 'STOP',
  };
  const stopBu2Res = await fetch(smsWebhookUrl2, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': 'irrelevant-for-a-fake-provider',
    },
    body: new URLSearchParams(stopBu2Params).toString(),
  });
  check('Inbound STOP webhook to BU2 (colliding number) returns 200', stopBu2Res.status === 200);

  const consentBu2AfterStop = await prisma.communicationConsent.findUnique({
    where: { contactId_channel: { contactId: bu2.contact.id, channel: 'SMS' } },
  });
  check(
    'BU2\'s own CommunicationConsent row is created with optedOut: true',
    consentBu2AfterStop?.optedOut === true,
  );

  const signalBu2AfterStop = await prisma.relationshipSignal.findFirst({
    where: { profileId: profile2.id, type: 'CONSENT_STOP' },
  });
  check(
    'DOM26-R: a CONSENT_STOP RelationshipSignal was created for BU2\'s profile, scoped correctly',
    signalBu2AfterStop !== null && signalBu2AfterStop.state === 'ACTIVE',
  );
  check(
    'DOM26-R: the BU2 signal is attached to BU2\'s profile, never BU1\'s',
    signalBu2AfterStop?.profileId === profile2.id &&
      signalBu2AfterStop?.profileId !== profile1.id,
  );

  const bu1StopSignalCountAfter = await prisma.relationshipSignal.count({
    where: { profileId: profile1.id, type: 'CONSENT_STOP' },
  });
  check(
    'DOM26-R isolation: BU1\'s CONSENT_STOP signal count is unaffected by BU2\'s STOP event',
    bu1StopSignalCountAfter === bu1StopSignalCountBefore,
  );

  // (e) An inbound webhook targeting a phone number connected to NEITHER
  // Business Unit must be rejected outright and create nothing.
  const unknownNumberParams = {
    providerMessageId: `IN_UNKNOWN_${suffix}`,
    from: sharedPhone,
    to: unknownNumber,
    body: 'Nobody owns this number',
  };
  const unknownNumberRes = await fetch(smsWebhookUrl2, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': 'irrelevant-for-a-fake-provider',
    },
    body: new URLSearchParams(unknownNumberParams).toString(),
  });
  check(
    'Inbound webhook to an unconnected destination number returns 401',
    unknownNumberRes.status === 401,
  );
  const unknownNumberMessage = await prisma.message.findUnique({
    where: { providerMessageId: unknownNumberParams.providerMessageId },
  });
  check(
    'No Message row created for a delivery to an unconnected destination number',
    unknownNumberMessage === null,
  );

  await webhookApp2.close();
  } finally {
    // Safety net: this ALWAYS runs, whether the try block above completed
    // successfully or threw partway through. Cleanup is intentionally
    // guarded per-fixture (bu1/bu2 may be undefined if createBuFixture
    // itself threw) and each delete sequence is wrapped so a cleanup
    // failure is logged, never thrown -- throwing from `finally` would
    // replace/mask whatever error (or successful completion) got us here,
    // and could also stomp the exit code the outer .catch sets.
    console.log('\n🧹 Cleaning up provider-neutral suite records...');
    const cleanupErrors: unknown[] = [];
    if (bu1) {
      try {
        await cleanupBu(bu1);
      } catch (cleanupErr) {
        cleanupErrors.push(cleanupErr);
      }
    }
    if (bu2) {
      try {
        await cleanupBu(bu2);
      } catch (cleanupErr) {
        cleanupErrors.push(cleanupErr);
      }
    }
    try {
      await prisma.organization.delete({ where: { id: org.id } });
    } catch (cleanupErr) {
      cleanupErrors.push(cleanupErr);
    }
    if (cleanupErrors.length > 0) {
      console.error(
        '⚠️  Cleanup encountered error(s) -- fixtures may be partially orphaned:',
        cleanupErrors,
      );
    } else {
      console.log('✅ Cleanup complete.');
    }
  }

  console.log('=============================================================');
  console.log(
    `📊 COMMUNICATIONS PROVIDER-NEUTRAL SUITE: ${pass} passed, ${fail} failed.`,
  );
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
