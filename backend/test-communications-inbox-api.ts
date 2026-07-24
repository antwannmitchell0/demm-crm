import 'dotenv/config';
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

async function runApiTests() {
  console.log('🧪 STARTING COMMUNICATIONS INBOX API SUITE');
  console.log('===========================================');

  const suffix = Date.now();

  // ---------------------------------------------------------------------
  // Fixtures: two independent Business Units (WS1/WS2) under one
  // Organization, each with its own Workspace/User/ChannelConnection --
  // needed so this suite can prove a Conversation belonging to WS2 403s
  // when fetched through WS1's Inbox thread endpoint (this task's required
  // cross-workspace scoping assertion). Same doubled-fixture pattern as
  // test-communications-provider-neutral.ts.
  // ---------------------------------------------------------------------
  const org = await prisma.organization.create({
    data: { name: `Inbox Test Org ${suffix}` },
  });

  async function createWsFixture(label: 'WS1' | 'WS2') {
    const bu = await prisma.businessUnit.create({
      data: {
        organizationId: org.id,
        key: `INBOX_${label}_${suffix}`,
        name: `Inbox ${label}`,
      },
    });
    const ws = await prisma.workspace.create({
      data: {
        organizationId: org.id,
        businessUnitId: bu.id,
        name: `Inbox WS ${label}`,
        subdomain: `inbox-${label.toLowerCase()}-${suffix}`,
      },
    });
    const bcrypt = await import('bcrypt');
    const passwordHash = await bcrypt.hash('InboxTest123!', 10);
    const user = await prisma.user.create({
      data: {
        email: `inbox-${label.toLowerCase()}-${suffix}@example.com`,
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
    const contact = await prisma.contact.create({
      data: {
        workspaceId: ws.id,
        firstName: label,
        lastName: 'Client',
        emails: [`inbox-${label.toLowerCase()}-contact-${suffix}@example.com`],
        phones: [],
        status: 'LEAD',
      },
    });
    const connection = await prisma.channelConnection.create({
      data: {
        workspaceId: ws.id,
        businessUnitId: bu.id,
        type: 'SMS',
        provider: 'TWILIO',
        status: 'ACTIVE',
        externalAddress: `+1555${label === 'WS1' ? '6' : '7'}${String(suffix).slice(-6)}`,
        lastVerifiedAt: new Date(),
      },
    });
    return { bu, ws, user, contact, connection };
  }

  // Declared here (function scope, not inside the try block below) so the
  // `finally` block can see whatever got created even if a throw happens
  // partway through fixture setup or the test body -- same discipline
  // Task 16's provider-neutral suite fix (commit 8856581) established
  // after a code review flagged that fixture cleanup only ran on the
  // happy path in an earlier suite.
  let ws1: Awaited<ReturnType<typeof createWsFixture>> | undefined;
  let ws2: Awaited<ReturnType<typeof createWsFixture>> | undefined;

  async function cleanupWs(fx: {
    bu: { id: string };
    ws: { id: string };
    user: { id: string };
  }) {
    await prisma.deliveryAttempt.deleteMany({
      where: { message: { conversation: { businessUnitId: fx.bu.id } } },
    });
    await prisma.message.deleteMany({
      where: { conversation: { businessUnitId: fx.bu.id } },
    });
    await prisma.conversation.deleteMany({
      where: { businessUnitId: fx.bu.id },
    });
    await prisma.channelConnection.deleteMany({
      where: { businessUnitId: fx.bu.id },
    });
    await prisma.contact.deleteMany({ where: { workspaceId: fx.ws.id } });
    await prisma.membership.deleteMany({ where: { userId: fx.user.id } });
    await prisma.user.delete({ where: { id: fx.user.id } });
    await prisma.workspace.delete({ where: { id: fx.ws.id } });
    await prisma.businessUnit.delete({ where: { id: fx.bu.id } });
  }

  // Everything below that touches the fixtures created above runs inside
  // this try block so the `finally` cleanup always fires even if an
  // assertion helper or fetch throws partway through.
  try {
    ws1 = await createWsFixture('WS1');
    ws2 = await createWsFixture('WS2');

    // --- Conversations + Messages + DeliveryAttempts created directly via
    // Prisma (this suite never needs a real outbound send -- same
    // discipline as the SMS/email suites, which record prior Message rows
    // directly rather than hitting a live provider). ---
    const now = Date.now();

    // WS1 conversation A: older lastMessageAt -- should sort AFTER conv B
    // in the list response (list is ordered lastMessageAt desc).
    const convA = await prisma.conversation.create({
      data: {
        workspaceId: ws1.ws.id,
        businessUnitId: ws1.bu.id,
        channelConnectionId: ws1.connection.id,
        channel: 'SMS',
        counterpartyAddress: '+15551110001',
        contactId: ws1.contact.id,
        lastMessageAt: new Date(now - 60_000),
      },
    });
    // WS1 conversation B: newer lastMessageAt -- should sort FIRST.
    const convB = await prisma.conversation.create({
      data: {
        workspaceId: ws1.ws.id,
        businessUnitId: ws1.bu.id,
        channelConnectionId: ws1.connection.id,
        channel: 'SMS',
        counterpartyAddress: '+15551110002',
        contactId: ws1.contact.id,
        lastMessageAt: new Date(now - 5_000),
      },
    });

    // Three messages on convB, explicit ascending createdAt timestamps so
    // ordering ("oldest-first") is unambiguous regardless of DB clock
    // resolution. Only the middle message gets a DeliveryAttempt, so the
    // suite also proves messages with none still return an empty array
    // rather than omitting the field.
    const msg1 = await prisma.message.create({
      data: {
        conversationId: convB.id,
        direction: 'INBOUND',
        status: 'RECEIVED',
        body: 'First message',
        createdAt: new Date(now - 30_000),
      },
    });
    const msg2 = await prisma.message.create({
      data: {
        conversationId: convB.id,
        direction: 'OUTBOUND',
        status: 'DELIVERED',
        body: 'Second message',
        createdAt: new Date(now - 20_000),
      },
    });
    await prisma.deliveryAttempt.create({
      data: {
        messageId: msg2.id,
        outcome: 'SUCCEEDED',
        occurredAt: new Date(now - 19_000),
      },
    });
    const msg3 = await prisma.message.create({
      data: {
        conversationId: convB.id,
        direction: 'INBOUND',
        status: 'RECEIVED',
        body: 'Third message',
        createdAt: new Date(now - 10_000),
      },
    });

    // WS2 conversation: exists purely to prove it's unreachable through
    // WS1's Inbox thread endpoint.
    const convOther = await prisma.conversation.create({
      data: {
        workspaceId: ws2.ws.id,
        businessUnitId: ws2.bu.id,
        channelConnectionId: ws2.connection.id,
        channel: 'SMS',
        counterpartyAddress: '+15552220001',
        contactId: ws2.contact.id,
        lastMessageAt: new Date(now - 1_000),
      },
    });

    // --- Boot the app and authenticate as WS1's user. ---
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
      body: JSON.stringify({
        email: ws1.user.email,
        passwordPlain: 'InboxTest123!',
      }),
    }).then((r) => r.json());
    const selectRes = await fetch(`${base}/api/auth/select-workspace`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginRes.preAuthToken}`,
      },
      body: JSON.stringify({ workspaceId: ws1.ws.id }),
    }).then((r) => r.json());
    const token = selectRes.access_token;
    const authHeaders = {
      Authorization: `Bearer ${token}`,
      'x-workspace-id': ws1.ws.id,
    };

    // --- Scenario 1: list returns WS1's conversations ordered by
    // lastMessageAt desc, with channelConnection.status included. ---
    const listRes = await fetch(`${base}/marketing/communications/inbox`, {
      headers: authHeaders,
    });
    check('List endpoint returns 200', listRes.status === 200);
    const listBody = (await listRes.json()) as Array<{
      id: string;
      lastMessageAt: string | null;
      channelConnection: { status: string; type: string };
      contact: { id: string; firstName: string; lastName: string } | null;
    }>;
    check(
      "List returns exactly WS1's 2 conversations (not WS2's)",
      listBody.length === 2 &&
        listBody.every((c) => c.id === convA.id || c.id === convB.id),
    );
    check(
      'List is ordered by lastMessageAt desc (convB before convA)',
      listBody[0]?.id === convB.id && listBody[1]?.id === convA.id,
    );
    check(
      'List rows include channelConnection.status for the provider-status banner',
      listBody.every(
        (c) =>
          c.channelConnection?.status === 'ACTIVE' &&
          c.channelConnection?.type === 'SMS',
      ),
    );
    check(
      'List rows include the contact summary',
      listBody.every((c) => c.contact?.id === ws1!.contact.id),
    );

    // --- Scenario 2: thread endpoint returns messages ordered oldest-first
    // with their deliveryAttempts. ---
    const threadRes = await fetch(
      `${base}/marketing/communications/inbox/${convB.id}`,
      { headers: authHeaders },
    );
    check(
      'Thread endpoint returns 200 for an in-scope conversation',
      threadRes.status === 200,
    );
    const threadBody = (await threadRes.json()) as {
      id: string;
      messages: Array<{
        id: string;
        body: string | null;
        deliveryAttempts: Array<{ outcome: string }>;
      }>;
      channelConnection: { status: string; type: string };
    };
    check(
      'Thread messages are ordered oldest-first',
      threadBody.messages.length === 3 &&
        threadBody.messages[0].id === msg1.id &&
        threadBody.messages[1].id === msg2.id &&
        threadBody.messages[2].id === msg3.id,
    );
    check(
      'Thread message with a DeliveryAttempt returns it nested',
      threadBody.messages[1].deliveryAttempts.length === 1 &&
        threadBody.messages[1].deliveryAttempts[0].outcome === 'SUCCEEDED',
    );
    check(
      'Thread message with no DeliveryAttempt returns an empty array (not omitted)',
      Array.isArray(threadBody.messages[0].deliveryAttempts) &&
        threadBody.messages[0].deliveryAttempts.length === 0,
    );
    check(
      'Thread response includes channelConnection.status',
      threadBody.channelConnection?.status === 'ACTIVE',
    );

    // --- Scenario 3: a conversation belonging to a different workspace
    // 403s rather than leaking its content or 404ing (which would let a
    // caller distinguish "wrong workspace" from "doesn't exist"). ---
    const crossWsRes = await fetch(
      `${base}/marketing/communications/inbox/${convOther.id}`,
      { headers: authHeaders },
    );
    check(
      'Thread endpoint returns 403 for a conversation in a different workspace',
      crossWsRes.status === 403,
    );

    // --- Bonus: a wholly nonexistent conversationId also 403s (same
    // fetch-then-verify branch, no existence leak either). ---
    const missingRes = await fetch(
      `${base}/marketing/communications/inbox/00000000-0000-0000-0000-000000000000`,
      { headers: authHeaders },
    );
    check(
      'Thread endpoint returns 403 for a nonexistent conversationId',
      missingRes.status === 403,
    );

    await app.close();
  } finally {
    // Safety net: always runs, whether the try block above completed
    // successfully or threw partway through -- same discipline as
    // test-communications-provider-neutral.ts's finally block (commit
    // 8856581). Cleanup failures are logged, never thrown, so they can't
    // mask the original error or exit code.
    console.log('\n🧹 Cleaning up Inbox API test records...');
    const cleanupErrors: unknown[] = [];
    if (ws1) {
      try {
        await cleanupWs(ws1);
      } catch (cleanupErr) {
        cleanupErrors.push(cleanupErr);
      }
    }
    if (ws2) {
      try {
        await cleanupWs(ws2);
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

  console.log('===========================================');
  console.log(
    `📊 COMMUNICATIONS INBOX API SUITE: ${pass} passed, ${fail} failed.`,
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
