import 'dotenv/config';
import { Webhook } from 'svix';
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

// Signs a payload the same way real Resend/Svix infrastructure does --
// identical construction to resend-adapter.spec.ts (Task 12) so the
// ResendAdapter under test verifies it the same way.
function signResendPayload(payload: string, webhookSecret: string) {
  const wh = new Webhook(webhookSecret);
  const id = `msg_${Math.random().toString(36).slice(2)}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = wh.sign(id, new Date(Number(timestamp) * 1000), payload);
  return {
    'svix-id': id,
    'svix-timestamp': timestamp,
    'svix-signature': signature,
  };
}

async function runApiTests() {
  console.log('🧪 STARTING COMMUNICATIONS EMAIL API SUITE');
  console.log('===========================================');

  // Force deterministic Resend credentials for this script's own process so
  // CommunicationsModule's EMAIL_PROVIDER/INBOUND_EMAIL_PROVIDER/
  // DELIVERY_STATUS_PROVIDER factories bind a real ResendAdapter (not
  // NullEmailProvider/NullInboundEmailProvider, which always reject
  // signature verification) -- shaped like Task 12's resend-adapter.spec.ts
  // fixture, never a real production secret.
  const TEST_WEBHOOK_SECRET =
    'whsec_test1234567890abcdef1234567890abcdef1234==';
  process.env.RESEND_API_KEY = 're_test_key';
  process.env.RESEND_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
  process.env.RESEND_INBOUND_DOMAIN = 'reply.demmmarketing.com';

  const suffix = Date.now();
  const businessEmail = `bu-${suffix}@reply.demmmarketing.com`; // the Business Unit's connected Resend address
  const contactEmail = `client-${suffix}@example.com`; // the client's email address

  // --- Fixtures: org/BU/workspace/user/pipeline/stage/offer/contact,
  // converted to a real ClientAccount via the real HTTP convert flow --
  // same established pattern as test-communications-sms-api.ts. ---
  const org = await prisma.organization.create({
    data: { name: `Email Test Org ${suffix}` },
  });
  const bu = await prisma.businessUnit.create({
    data: { organizationId: org.id, key: 'MARKETING', name: 'DEMM Marketing' },
  });
  const ws = await prisma.workspace.create({
    data: {
      organizationId: org.id,
      businessUnitId: bu.id,
      name: 'WS',
      subdomain: `email-${suffix}`,
    },
  });
  const bcrypt = await import('bcrypt');
  const passwordHash = await bcrypt.hash('EmailTest123!', 10);
  const user = await prisma.user.create({
    data: {
      email: `email-user-${suffix}@example.com`,
      passwordHash,
      firstName: 'E',
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
      key: `email-offer-${suffix}`,
      version: 1,
      name: 'Email Test Offer',
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
      firstName: 'Email',
      lastName: 'Client',
      emails: [contactEmail],
      phones: [],
      status: 'LEAD',
    },
  });
  await prisma.opportunity.create({
    data: {
      workspaceId: ws.id,
      contactId: contact.id,
      pipelineId: pipeline.id,
      stageId: stage.id,
      name: 'Email Deal',
      value: 99,
      status: 'OPEN',
    },
  });

  // --- Boot the main app (default JSON body parser) for auth + convert +
  // outbound-email endpoint testing. ---
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
    body: JSON.stringify({ email: user.email, passwordPlain: 'EmailTest123!' }),
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

  const convertRes = await fetch(
    `${base}/marketing/leads/${contact.id}/convert`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'x-workspace-id': ws.id,
        'Idempotency-Key': `email-idem-${suffix}`,
      },
      body: JSON.stringify({
        offerId: offer.id,
        contractState: 'SIGNED_MANUAL',
      }),
    },
  ).then((r) => r.json());
  const clientAccountId = convertRes.id;
  check(
    'Lead converted to a ClientAccount',
    typeof clientAccountId === 'string',
  );

  // --- Scenario 1: outbound email with no ACTIVE ChannelConnection yet --
  // must fail closed with 503, never a fabricated success. ---
  const noConnRes = await fetch(
    `${base}/marketing/clients/${clientAccountId}/communications/email`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'x-workspace-id': ws.id,
      },
      body: JSON.stringify({
        subject: 'Hello',
        html: '<p>Hello from DEMM</p>',
      }),
    },
  );
  check(
    'Outbound email with no ACTIVE ChannelConnection returns 503',
    noConnRes.status === 503,
  );

  await app.close();

  // Now connect the EMAIL channel for this Business Unit.
  const connection = await prisma.channelConnection.create({
    data: {
      workspaceId: ws.id,
      businessUnitId: bu.id,
      type: 'EMAIL',
      provider: 'RESEND',
      status: 'ACTIVE',
      externalAddress: businessEmail,
      lastVerifiedAt: new Date(),
    },
  });

  // A real send would go through MessageService.sendEmail -> ResendAdapter,
  // which hits the live Resend API -- this suite never calls that (same
  // discipline as test-communications-sms-api.ts, which never calls the
  // live Twilio API either). Instead we set up the Conversation + a prior
  // OUTBOUND Message directly, exactly the shape a real send would have
  // produced, so the inbound/webhook handlers under test have something
  // real to resolve against.
  const replyToken = `replytok${suffix}`;
  const conversation = await prisma.conversation.create({
    data: {
      workspaceId: ws.id,
      businessUnitId: bu.id,
      channelConnectionId: connection.id,
      channel: 'EMAIL',
      counterpartyAddress: contactEmail,
      contactId: contact.id,
      clientAccountId,
      replyToken,
    },
  });

  // --- Boot a second app instance with the raw-body middleware Task 4.5
  // mounts on /webhooks/resend -- same reasoning/pattern as
  // test-communications-sms-api.ts's webhookApp for /webhooks/twilio. ---
  const express = await import('express');
  const webhookApp = await NestFactory.create(AppModule, { logger: false });
  webhookApp.use('/webhooks/resend', express.raw({ type: 'application/json' }));
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

  const inboundWebhookUrl = `${webhookBase}/webhooks/resend/inbound`;
  const eventsWebhookUrl = `${webhookBase}/webhooks/resend/events`;

  // --- Scenario 2: inbound webhook to a reply+{token}@... address matching
  // a real Conversation's replyToken -> Message created, direction INBOUND,
  // conversation.lastMessageAt updated. Payload shape matches the real
  // Resend `email.received` envelope (nested `data`, `to` as an array) --
  // same shape ResendAdapter.parseInboundEmail's own spec (Task 12)
  // verifies it handles. ---
  const inboundEmailId = `em_inbound_${suffix}`;
  const inboundPayload = JSON.stringify({
    type: 'email.received',
    created_at: new Date().toISOString(),
    data: {
      email_id: inboundEmailId,
      from: contactEmail,
      to: [`reply+${replyToken}@reply.demmmarketing.com`],
      subject: 'Re: Hello',
      html: '<p>reply body</p>',
      text: 'reply body',
    },
  });
  const inboundHeaders = signResendPayload(inboundPayload, TEST_WEBHOOK_SECRET);
  const inboundRes = await fetch(inboundWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...inboundHeaders },
    body: inboundPayload,
  });
  check(
    'Inbound webhook with a known replyToken returns 200',
    inboundRes.status === 200,
  );

  const inboundMessage = await prisma.message.findUnique({
    where: { providerMessageId: inboundEmailId },
  });
  check(
    'Inbound reply-threaded email recorded as an INBOUND/RECEIVED Message row',
    inboundMessage?.direction === 'INBOUND' &&
      inboundMessage?.status === 'RECEIVED',
  );

  const conversationAfterInbound = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversation.id },
  });
  check(
    'Conversation.lastMessageAt updated after the inbound reply',
    conversationAfterInbound.lastMessageAt !== null,
  );

  // --- Scenario 3: inbound webhook to reply+{unknown-token}@... -> 200
  // (webhook ack, Resend shouldn't retry) but zero Message rows created
  // for it -- the replyToken doesn't resolve to any Conversation. ---
  const unknownEmailId = `em_unknown_${suffix}`;
  const unknownPayload = JSON.stringify({
    type: 'email.received',
    created_at: new Date().toISOString(),
    data: {
      email_id: unknownEmailId,
      from: contactEmail,
      to: [`reply+doesnotexist${suffix}@reply.demmmarketing.com`],
      subject: 'Re: Hello',
      html: '<p>orphan reply</p>',
      text: 'orphan reply',
    },
  });
  const unknownHeaders = signResendPayload(unknownPayload, TEST_WEBHOOK_SECRET);
  const unknownRes = await fetch(inboundWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...unknownHeaders },
    body: unknownPayload,
  });
  check(
    'Inbound webhook with an unresolvable replyToken still returns 200 (ack, no retry)',
    unknownRes.status === 200,
  );
  const unknownMessage = await prisma.message.findUnique({
    where: { providerMessageId: unknownEmailId },
  });
  check(
    'No Message row created for an unresolvable replyToken delivery',
    unknownMessage === null,
  );

  // --- Scenario 4: redeliver the exact same signed inbound payload a
  // second time -> no duplicate Message (providerMessageId unique
  // constraint honored, same idempotency discipline as the SMS suite). ---
  const redeliverRes = await fetch(inboundWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...inboundHeaders },
    body: inboundPayload,
  });
  check(
    'Redelivered inbound webhook still returns 200 (idempotent ack)',
    redeliverRes.status === 200,
  );
  const inboundMessagesAfterRedelivery = await prisma.message.findMany({
    where: { providerMessageId: inboundEmailId },
  });
  check(
    'Redelivering the same inbound webhook does not create a duplicate Message row',
    inboundMessagesAfterRedelivery.length === 1,
  );

  // --- Scenario 5 fixture: a prior OUTBOUND Message this suite records
  // directly (standing in for a message a real send would have created --
  // this suite never calls the live Resend API), so the events callback
  // below has a real providerMessageId to resolve against. ---
  const outboundEmailId = `em_outbound_${suffix}`;
  const outboundMessage = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: 'OUTBOUND',
      status: 'SENT',
      body: '<p>Test outbound message</p>',
      providerMessageId: outboundEmailId,
      sentByUserId: user.id,
    },
  });

  // --- Scenario 5: a signed "email.complained" event for a Message's
  // providerMessageId -> CommunicationConsent(channel: EMAIL, optedOut:
  // true) written for that message's conversation's contact, plus a
  // DeliveryAttempt(outcome: COMPLAINED) row appended. ---
  const complaintPayload = JSON.stringify({
    type: 'email.complained',
    created_at: new Date().toISOString(),
    data: { email_id: outboundEmailId, to: [contactEmail] },
  });
  const complaintHeaders = signResendPayload(
    complaintPayload,
    TEST_WEBHOOK_SECRET,
  );
  const complaintRes = await fetch(eventsWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...complaintHeaders },
    body: complaintPayload,
  });
  check(
    'Signed "email.complained" event returns 200',
    complaintRes.status === 200,
  );

  const consentRow = await prisma.communicationConsent.findUnique({
    where: { contactId_channel: { contactId: contact.id, channel: 'EMAIL' } },
  });
  check(
    'CommunicationConsent row created with optedOut: true after email.complained',
    consentRow?.optedOut === true && consentRow?.reason === 'complaint',
  );

  const deliveryAttempts = await prisma.deliveryAttempt.findMany({
    where: { messageId: outboundMessage.id },
  });
  check(
    'A DeliveryAttempt(outcome: COMPLAINED) row is created for the complained callback',
    deliveryAttempts.length === 1 &&
      deliveryAttempts[0].outcome === 'COMPLAINED',
  );

  // --- Bad-signature sanity check (mirrors the SMS suite's garbage-
  // signature scenario): a webhook with a bogus svix signature must be
  // rejected with 401 and never processed. ---
  const badSigRes = await fetch(inboundWebhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'svix-id': 'msg_badsig',
      'svix-timestamp': Math.floor(Date.now() / 1000).toString(),
      'svix-signature': 'v1,not-a-real-signature==',
    },
    body: JSON.stringify({
      type: 'email.received',
      data: {
        email_id: 'em_badsig',
        from: contactEmail,
        to: [`reply+${replyToken}@reply.demmmarketing.com`],
      },
    }),
  });
  check(
    'Inbound webhook with a garbage signature returns 401',
    badSigRes.status === 401,
  );
  const badSigMessage = await prisma.message.findUnique({
    where: { providerMessageId: 'em_badsig' },
  });
  check(
    'No Message row created for the garbage-signature delivery',
    badSigMessage === null,
  );

  await webhookApp.close();

  // --- Cleanup: respect RESTRICT/Cascade FKs -- delete children before
  // parents, same teardown discipline as test-communications-sms-api.ts. ---
  console.log('\n🧹 Cleaning up Email API test records...');
  await prisma.deliveryAttempt.deleteMany({
    where: { message: { conversation: { businessUnitId: bu.id } } },
  });
  await prisma.message.deleteMany({
    where: { conversation: { businessUnitId: bu.id } },
  });
  await prisma.communicationConsent.deleteMany({
    where: { workspaceId: ws.id },
  });
  await prisma.conversation.deleteMany({ where: { businessUnitId: bu.id } });
  await prisma.channelConnection.deleteMany({
    where: { businessUnitId: bu.id },
  });

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

  await prisma.memoryAuditEvent.deleteMany({
    where: { businessUnitId: bu.id },
  });
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
  await prisma.engramSource.deleteMany({
    where: { id: { in: ownedSourceIds } },
  });
  await prisma.relationshipProfile.deleteMany({
    where: { businessUnitId: bu.id },
  });
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
  await prisma.offerSnapshot.deleteMany({
    where: { offer: { businessUnitId: bu.id } },
  });
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

  console.log('===========================================');
  console.log(
    `📊 COMMUNICATIONS EMAIL API SUITE: ${pass} passed, ${fail} failed.`,
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
