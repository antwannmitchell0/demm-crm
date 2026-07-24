import 'dotenv/config';
import { createHmac } from 'crypto';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './src/app.module';
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

// Builds the same signature the real Twilio infrastructure sends -- HMAC-
// SHA1 of the request URL followed by each form field's key+value,
// sorted, base64-encoded. Identical construction to twilio-adapter.spec.ts
// (Task 9) so the TwilioAdapter under test verifies it the same way.
function buildTwilioSignature(
  url: string,
  params: Record<string, string>,
  authToken: string,
): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac('sha1', authToken)
    .update(Buffer.from(data, 'utf-8'))
    .digest('base64');
}

async function runApiTests() {
  console.log('🧪 STARTING COMMUNICATIONS SMS API SUITE');
  console.log('=========================================');

  // Force deterministic Twilio credentials for this script's own process
  // so CommunicationsModule's SMS_PROVIDER factory binds a real
  // TwilioAdapter (not NullSmsProvider, which always rejects signature
  // verification) -- this is a TEST value shaped like Task 9's
  // twilio-adapter.spec.ts fixture, never a real production secret, and
  // it deliberately overrides whatever may already be in .env so this
  // suite's signatures are always verifiable regardless of environment.
  const TEST_TWILIO_AUTH_TOKEN = 'test_auth_token_1234567890';
  process.env.TWILIO_ACCOUNT_SID = 'ACtest00000000000000000000000000';
  process.env.TWILIO_AUTH_TOKEN = TEST_TWILIO_AUTH_TOKEN;
  process.env.TWILIO_FROM_NUMBER = '+15555550100';

  const suffix = Date.now();
  const businessNumber = '+15555550100'; // the Business Unit's connected Twilio number
  const contactPhone = '+15555550199'; // the client's phone number

  // --- Fixtures: org/BU/workspace/user/pipeline/stage/offer/contact,
  // converted to a real ClientAccount via the real HTTP convert flow --
  // same established pattern as test-stripe-billing-api.ts. ---
  const org = await prisma.organization.create({
    data: { name: `SMS Test Org ${suffix}` },
  });
  const bu = await prisma.businessUnit.create({
    data: { organizationId: org.id, key: 'MARKETING', name: 'DEMM Marketing' },
  });
  const ws = await prisma.workspace.create({
    data: {
      organizationId: org.id,
      businessUnitId: bu.id,
      name: 'WS',
      subdomain: `sms-${suffix}`,
    },
  });
  const bcrypt = await import('bcrypt');
  const passwordHash = await bcrypt.hash('SmsTest123!', 10);
  const user = await prisma.user.create({
    data: {
      email: `sms-${suffix}@example.com`,
      passwordHash,
      firstName: 'S',
      lastName: 'T',
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
    data: { name: 'P', workspaceId: ws.id },
  });
  const stage = await prisma.stage.create({
    data: { name: 'New', order: 1, pipelineId: pipeline.id },
  });
  const offer = await prisma.offer.create({
    data: {
      businessUnitId: bu.id,
      key: `sms-offer-${suffix}`,
      version: 1,
      name: 'SMS Test Offer',
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
      firstName: 'Sms',
      lastName: 'Client',
      emails: [`sms-client-${suffix}@example.com`],
      phones: [contactPhone],
      status: 'LEAD',
    },
  });
  await prisma.opportunity.create({
    data: {
      workspaceId: ws.id,
      contactId: contact.id,
      pipelineId: pipeline.id,
      stageId: stage.id,
      name: 'Sms Deal',
      value: 99,
      status: 'OPEN',
    },
  });

  // --- Boot the main app (default JSON body parser) for auth + convert +
  // outbound-SMS endpoint testing. ---
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

  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, passwordPlain: 'SmsTest123!' }),
  }).then((r) => r.json());
  const selectRes = await fetch(`${base}/api/auth/select-workspace`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${loginRes.preAuthToken}`,
    },
    body: JSON.stringify({ workspaceId: ws.id }),
  }).then((r) => r.json());
  const token = selectRes.access_token;

  const convertRes = await fetch(`${base}/marketing/leads/${contact.id}/convert`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'x-workspace-id': ws.id,
      'Idempotency-Key': `sms-idem-${suffix}`,
    },
    body: JSON.stringify({ offerId: offer.id, contractState: 'SIGNED_MANUAL' }),
  }).then((r) => r.json());
  const clientAccountId = convertRes.id;
  check('Lead converted to a ClientAccount', typeof clientAccountId === 'string');

  // --- Scenario 1: outbound SMS with no ACTIVE ChannelConnection yet --
  // must fail closed with 503, never a fabricated success. ---
  const noConnRes = await fetch(
    `${base}/marketing/clients/${clientAccountId}/communications/sms`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'x-workspace-id': ws.id,
      },
      body: JSON.stringify({ body: 'Hello from DEMM' }),
    },
  );
  check(
    'Outbound SMS with no ACTIVE ChannelConnection returns 503',
    noConnRes.status === 503,
  );

  await app.close();

  // Now connect the SMS channel for this Business Unit.
  const connection = await prisma.channelConnection.create({
    data: {
      workspaceId: ws.id,
      businessUnitId: bu.id,
      type: 'SMS',
      provider: 'TWILIO',
      status: 'ACTIVE',
      externalAddress: businessNumber,
      lastVerifiedAt: new Date(),
    },
  });

  // --- Boot a second app instance with the raw-body middleware Task 4.5
  // mounts on /webhooks/twilio -- same reasoning/pattern as
  // test-stripe-billing-api.ts's webhookApp for /webhooks/stripe. ---
  const express = await import('express');
  const webhookApp = await NestFactory.create(AppModule, { logger: false });
  webhookApp.use(
    '/webhooks/twilio',
    express.raw({ type: 'application/x-www-form-urlencoded' }),
  );
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
  // The controller builds its verification URL as
  // `${BACKEND_PUBLIC_URL}${req.originalUrl}` -- must match exactly what
  // we sign against below.
  process.env.BACKEND_PUBLIC_URL = webhookBase;

  const smsWebhookUrl = `${webhookBase}/webhooks/twilio/sms`;
  const smsStatusWebhookUrl = `${webhookBase}/webhooks/twilio/sms-status`;

  // --- Scenario 2: inbound webhook with a garbage signature -> 401, and
  // zero Message rows created for it. ---
  const badSigParams = {
    MessageSid: `SM_badsig_${suffix}`,
    From: contactPhone,
    To: businessNumber,
    Body: 'Hello',
  };
  const badSigRes = await fetch(smsWebhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': 'not-a-real-signature==',
    },
    body: new URLSearchParams(badSigParams).toString(),
  });
  check('Inbound webhook with garbage signature returns 401', badSigRes.status === 401);
  const badSigMessage = await prisma.message.findUnique({
    where: { providerMessageId: badSigParams.MessageSid },
  });
  check(
    'No Message row created for the garbage-signature delivery',
    badSigMessage === null,
  );

  // --- Scenario 3: validly-signed inbound webhook containing STOP ->
  // CommunicationConsent row created with optedOut: true. ---
  const stopParams = {
    MessageSid: `SM_stop_${suffix}`,
    From: contactPhone,
    To: businessNumber,
    Body: 'STOP',
  };
  const stopSignature = buildTwilioSignature(
    smsWebhookUrl,
    stopParams,
    TEST_TWILIO_AUTH_TOKEN,
  );
  const stopRes = await fetch(smsWebhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': stopSignature,
    },
    body: new URLSearchParams(stopParams).toString(),
  });
  check('Validly-signed STOP webhook returns 200', stopRes.status === 200);

  const consentRow = await prisma.communicationConsent.findUnique({
    where: { contactId_channel: { contactId: contact.id, channel: 'SMS' } },
  });
  check(
    'CommunicationConsent row created with optedOut: true after STOP',
    consentRow?.optedOut === true,
  );

  const stopMessage = await prisma.message.findUnique({
    where: { providerMessageId: stopParams.MessageSid },
  });
  check(
    'Inbound STOP message recorded as an INBOUND/RECEIVED Message row',
    stopMessage?.direction === 'INBOUND' && stopMessage?.status === 'RECEIVED',
  );

  // --- Scenario 4: redeliver the exact same signed inbound webhook a
  // second time -> no duplicate Message row (providerMessageId unique
  // constraint honored, same idempotency discipline as
  // BillingPaymentRecord.stripeInvoiceId in the Stripe sub-project). ---
  const redeliverRes = await fetch(smsWebhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': stopSignature,
    },
    body: new URLSearchParams(stopParams).toString(),
  });
  check(
    'Redelivered inbound webhook still returns 200 (idempotent ack)',
    redeliverRes.status === 200,
  );
  const stopMessagesAfterRedelivery = await prisma.message.findMany({
    where: { providerMessageId: stopParams.MessageSid },
  });
  check(
    'Redelivering the same inbound webhook does not create a duplicate Message row',
    stopMessagesAfterRedelivery.length === 1,
  );

  // --- Scenario 5/6 fixture: a prior OUTBOUND Message this suite records
  // directly (standing in for a message a real send would have created --
  // this suite never calls the live Twilio API), so the sms-status
  // callback below has a real providerMessageId to resolve against. ---
  const conversation = await prisma.conversation.findUniqueOrThrow({
    where: {
      channelConnectionId_counterpartyAddress: {
        channelConnectionId: connection.id,
        counterpartyAddress: contactPhone,
      },
    },
  });
  const outboundSid = `SM_outbound_${suffix}`;
  const outboundMessage = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: 'OUTBOUND',
      status: 'SENT',
      body: 'Test outbound message',
      providerMessageId: outboundSid,
      sentByUserId: user.id,
    },
  });

  // --- Scenario 5: signed sms-status callback with
  // MessageStatus=delivered for a known providerMessageId -> a new
  // DeliveryAttempt(outcome:SUCCEEDED) row and Message.status flips to
  // DELIVERED. ---
  const deliveredParams = { MessageSid: outboundSid, MessageStatus: 'delivered' };
  const deliveredSignature = buildTwilioSignature(
    smsStatusWebhookUrl,
    deliveredParams,
    TEST_TWILIO_AUTH_TOKEN,
  );
  const deliveredRes = await fetch(smsStatusWebhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': deliveredSignature,
    },
    body: new URLSearchParams(deliveredParams).toString(),
  });
  check('Signed sms-status "delivered" callback returns 200', deliveredRes.status === 200);

  const deliveryAttemptsAfterFirst = await prisma.deliveryAttempt.findMany({
    where: { messageId: outboundMessage.id },
  });
  check(
    'A DeliveryAttempt(outcome: SUCCEEDED) row is created for the delivered callback',
    deliveryAttemptsAfterFirst.length === 1 &&
      deliveryAttemptsAfterFirst[0].outcome === 'SUCCEEDED',
  );
  const messageAfterDelivered = await prisma.message.findUnique({
    where: { id: outboundMessage.id },
  });
  check(
    'Message.status flips to DELIVERED after the delivered callback',
    messageAfterDelivered?.status === 'DELIVERED',
  );

  // --- Scenario 6: the same signed sms-status callback redelivered -> a
  // SECOND DeliveryAttempt row is created (append-only log, not deduped --
  // unlike Message, DeliveryAttempt intentionally has no uniqueness
  // constraint). ---
  const redeliveredStatusRes = await fetch(smsStatusWebhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': deliveredSignature,
    },
    body: new URLSearchParams(deliveredParams).toString(),
  });
  check(
    'Redelivered sms-status callback still returns 200',
    redeliveredStatusRes.status === 200,
  );
  const deliveryAttemptsAfterRedelivery = await prisma.deliveryAttempt.findMany({
    where: { messageId: outboundMessage.id },
  });
  check(
    'Redelivering the same sms-status callback appends a SECOND DeliveryAttempt row (not deduped)',
    deliveryAttemptsAfterRedelivery.length === 2,
  );

  await webhookApp.close();

  // --- Cleanup: respect RESTRICT/Cascade FKs -- delete children before
  // parents, same teardown discipline as test-stripe-billing-api.ts,
  // extended with this task's new Communications rows. ---
  console.log('\n🧹 Cleaning up SMS API test records...');
  await prisma.deliveryAttempt.deleteMany({
    where: { message: { conversation: { businessUnitId: bu.id } } },
  });
  await prisma.message.deleteMany({
    where: { conversation: { businessUnitId: bu.id } },
  });
  await prisma.communicationConsent.deleteMany({ where: { workspaceId: ws.id } });
  await prisma.conversation.deleteMany({ where: { businessUnitId: bu.id } });
  await prisma.channelConnection.deleteMany({ where: { businessUnitId: bu.id } });

  await prisma.launchGateOverride.deleteMany({
    where: { plan: { clientAccount: { businessUnitId: bu.id } } },
  });
  await prisma.onboardingChecklistItemHistory.deleteMany({
    where: { item: { plan: { clientAccount: { businessUnitId: bu.id } } } },
  });
  await prisma.onboardingChecklistItem.deleteMany({
    where: { plan: { clientAccount: { businessUnitId: bu.id } } },
  });
  await prisma.onboardingPlan.deleteMany({
    where: { clientAccount: { businessUnitId: bu.id } },
  });
  await prisma.serviceDeliverableHistory.deleteMany({
    where: { deliverable: { clientAccount: { businessUnitId: bu.id } } },
  });
  await prisma.serviceDeliverable.deleteMany({
    where: { clientAccount: { businessUnitId: bu.id } },
  });

  await prisma.memoryAuditEvent.deleteMany({ where: { businessUnitId: bu.id } });
  await prisma.briefEvidence.deleteMany({
    where: { brief: { profile: { businessUnitId: bu.id } } },
  });
  await prisma.relationshipBrief.deleteMany({
    where: { profile: { businessUnitId: bu.id } },
  });
  const candidateEvidenceRows = await prisma.candidateEvidence.findMany({
    where: { candidate: { profile: { businessUnitId: bu.id } } },
    select: { sourceId: true },
  });
  const engramEvidenceRows = await prisma.engramEvidence.findMany({
    where: { engram: { businessUnitId: bu.id } },
    select: { sourceId: true },
  });
  const ownedSourceIds = [
    ...new Set([
      ...candidateEvidenceRows.map((r) => r.sourceId),
      ...engramEvidenceRows.map((r) => r.sourceId),
    ]),
  ];
  await prisma.candidateEvidence.deleteMany({
    where: { candidate: { profile: { businessUnitId: bu.id } } },
  });
  await prisma.memoryApproval.deleteMany({
    where: { candidate: { profile: { businessUnitId: bu.id } } },
  });
  await prisma.memoryCandidate.deleteMany({
    where: { profile: { businessUnitId: bu.id } },
  });
  await prisma.engramEvidence.deleteMany({
    where: { engram: { businessUnitId: bu.id } },
  });
  await prisma.engram.deleteMany({ where: { businessUnitId: bu.id } });
  await prisma.engramSource.deleteMany({ where: { id: { in: ownedSourceIds } } });
  await prisma.relationshipProfile.deleteMany({ where: { businessUnitId: bu.id } });
  await prisma.relationshipSubject.deleteMany({
    where: {
      OR: [
        { contact: { workspaceId: ws.id } },
        { company: { workspaceId: ws.id } },
      ],
    },
  });
  await prisma.clientCommercialStateChange.deleteMany({
    where: { clientAccount: { businessUnitId: bu.id } },
  });
  await prisma.conversionIdempotencyKey.deleteMany({
    where: { clientAccount: { businessUnitId: bu.id } },
  });
  await prisma.clientAccount.deleteMany({ where: { businessUnitId: bu.id } });
  await prisma.offerSnapshot.deleteMany({ where: { offer: { businessUnitId: bu.id } } });
  await prisma.stripePriceMapping.deleteMany({ where: { offerId: offer.id } });
  await prisma.offer.deleteMany({ where: { businessUnitId: bu.id } });
  await prisma.auditLog.deleteMany({ where: { workspaceId: ws.id } });
  await prisma.task.deleteMany({ where: { workspaceId: ws.id } });
  await prisma.opportunity.deleteMany({ where: { workspaceId: ws.id } });
  await prisma.stage.deleteMany({ where: { pipelineId: pipeline.id } });
  await prisma.pipeline.deleteMany({ where: { id: pipeline.id } });
  await prisma.contact.deleteMany({ where: { workspaceId: ws.id } });
  await prisma.membership.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.workspace.delete({ where: { id: ws.id } });
  await prisma.businessUnit.delete({ where: { id: bu.id } });
  await prisma.organization.delete({ where: { id: org.id } });
  console.log('✅ Cleanup complete.');

  console.log('=========================================');
  console.log(`📊 COMMUNICATIONS SMS API SUITE: ${pass} passed, ${fail} failed.`);
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
