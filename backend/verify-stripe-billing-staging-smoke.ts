import 'dotenv/config';
import * as https from 'https';
import { IncomingHttpHeaders } from 'http';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';
import { PrismaService } from './src/prisma.service';
import { StripeEnvironmentGuard } from './src/modules/marketing/stripe-environment.guard';
import { StripeProvisioningService } from './src/modules/marketing/stripe-provisioning.service';

/**
 * Staging smoke test for Sub-project 4 (Stripe Founder-Tier Billing), run
 * against the LIVE deployed Cloud Run backend over real HTTPS. Seeds its own
 * throwaway org/BU/workspace/offer directly via the staging Cloud SQL
 * connection, provisions a real Stripe test-mode Price for that offer
 * in-process (same mechanism as scripts/dev-sync-offer-prices.ts), exercises
 * checkout generation purely through the public HTTPS surface, then cleans
 * up all seeded rows (including the StripePriceMapping) regardless of
 * pass/fail.
 *
 * Does NOT attempt to construct a synthetic signed webhook against the real
 * staging STRIPE_WEBHOOK_SECRET -- that value was entered directly into GCP
 * Secret Manager by Antwann and is never read by any Claude-driven process,
 * so this script cannot forge a valid signature for it. Webhook delivery is
 * instead verified for real in the Task 20 Step 2 browser walkthrough, by
 * completing an actual Stripe test-mode Checkout Session with a test card --
 * a stronger proof than a self-signed synthetic event, since Stripe's own
 * infrastructure signs and delivers it.
 */

const baseUrl =
  'https://demm-crm-backend-staging-431876670120.us-east1.run.app';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    'DATABASE_URL must point at the staging DB (via Cloud SQL Auth Proxy).',
  );
  process.exit(1);
}
if (!process.env.STRIPE_SECRET_KEY) {
  console.error(
    'STRIPE_SECRET_KEY must be set (staging test-mode key) to provision the throwaway Offer.',
  );
  process.exit(1);
}
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

let pass = 0;
let fail = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    pass++;
    console.log(`✅ [PASS] ${message}`);
  } else {
    fail++;
    console.log(`❌ [FAIL] ${message}`);
  }
}

function request(
  method: string,
  path: string,
  body?: any,
  headers: Record<string, string> = {},
): Promise<{ statusCode: number; headers: IncomingHttpHeaders; body: any }> {
  return new Promise((resolve, reject) => {
    const payloadStr = body ? JSON.stringify(body) : '';
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };
    if (body)
      reqHeaders['Content-Length'] = Buffer.byteLength(payloadStr).toString();
    const urlObj = new URL(`${baseUrl}${path}`);
    const req = https.request(
      urlObj,
      { method, headers: reqHeaders },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsedBody: any = data;
          try {
            parsedBody = JSON.parse(data);
          } catch {
            /* leave as raw text */
          }
          resolve({
            statusCode: res.statusCode || 500,
            headers: res.headers,
            body: parsedBody,
          });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(payloadStr);
    req.end();
  });
}

async function main() {
  console.log(
    '🧪 STAGING SMOKE TEST — Stripe Founder-Tier Billing (live HTTPS)',
  );
  console.log(`Target: ${baseUrl}`);
  console.log(
    '=================================================================',
  );

  const suffix = Date.now();
  const org = await prisma.organization.create({
    data: { name: `Staging Smoke Org 4 ${suffix}` },
  });
  const buMktg = await prisma.businessUnit.create({
    data: { organizationId: org.id, key: 'MARKETING', name: 'DEMM Marketing' },
  });
  const wsMktg = await prisma.workspace.create({
    data: {
      organizationId: org.id,
      businessUnitId: buMktg.id,
      name: 'Marketing WS 4',
      subdomain: `smoke4-mktg-${suffix}`,
    },
  });
  const passwordHash = await bcrypt.hash('StagingSmoke123!', 10);
  const user = await prisma.user.create({
    data: {
      email: `staging-smoke4-${suffix}@example.com`,
      passwordHash,
      firstName: 'Staging',
      lastName: 'Smoke4',
    },
  });
  await prisma.membership.create({
    data: {
      userId: user.id,
      organizationId: org.id,
      workspaceId: wsMktg.id,
      role: 'ORG_ADMIN',
    },
  });
  const pipeline = await prisma.pipeline.create({
    data: { name: 'Smoke Pipeline 4', workspaceId: wsMktg.id },
  });
  const stage = await prisma.stage.create({
    data: { name: 'New', order: 1, pipelineId: pipeline.id },
  });
  const offer = await prisma.offer.create({
    data: {
      businessUnitId: buMktg.id,
      key: `smoke4-tier-${suffix}`,
      version: 1,
      name: 'Smoke Billing Tier 4',
      price: 99,
      includedServices: ['Smoke test service'],
      excludedServices: [],
      onboardingRequirements: [],
      supportBoundaries: 'N/A',
      reportingCadence: 'N/A',
      cancellationTerms: 'N/A',
      expectedLaunchTime: 'N/A',
      lifecycleState: 'ACTIVE',
      trialEligible: false,
      trialDays: 0,
    },
  });
  const contact = await prisma.contact.create({
    data: {
      workspaceId: wsMktg.id,
      firstName: 'Billing',
      lastName: 'Client',
      emails: [`staging-smoke4-client-${suffix}@example.com`],
      phones: [],
      status: 'CUSTOMER',
    },
  });

  // Provision a real Stripe test-mode Product+Price for the throwaway Offer
  // in-process -- same mechanism as scripts/dev-sync-offer-prices.ts. This
  // is required before checkout generation can succeed: the checkout path
  // fails closed with no StripePriceMapping present.
  const prismaService = new PrismaService();
  await prismaService.onModuleInit();
  const provisioning = new StripeProvisioningService(
    prismaService,
    new StripeEnvironmentGuard(),
  );
  const provisionResults = await provisioning.syncOfferPrices();
  const thisOfferResult = provisionResults.find((r) => r.offerId === offer.id);
  assert(
    !!thisOfferResult?.mappingId,
    'Throwaway Offer provisioned with a real Stripe test-mode Price mapping',
  );
  await prismaService.onModuleDestroy();

  try {
    const loginRes = await request('POST', '/api/auth/login', {
      email: user.email,
      passwordPlain: 'StagingSmoke123!',
    });
    assert(
      loginRes.statusCode < 300 && !!loginRes.body.preAuthToken,
      `Login: preAuthToken issued (status ${loginRes.statusCode})`,
    );
    const selectRes = await request(
      'POST',
      '/api/auth/select-workspace',
      { workspaceId: wsMktg.id },
      { Authorization: `Bearer ${loginRes.body.preAuthToken}` },
    );
    assert(
      selectRes.statusCode < 300 && !!selectRes.body.access_token,
      `Login: access token issued (status ${selectRes.statusCode})`,
    );
    const token = selectRes.body.access_token;
    const authHeaders = {
      Authorization: `Bearer ${token}`,
      'x-workspace-id': wsMktg.id,
    };

    const idemKey = `staging-smoke4-${suffix}`;
    const opportunity = await prisma.opportunity.create({
      data: {
        workspaceId: wsMktg.id,
        contactId: contact.id,
        pipelineId: pipeline.id,
        stageId: stage.id,
        name: 'Smoke Billing Acquisition',
        value: 99,
        status: 'OPEN',
      },
    });
    void opportunity;

    // 1. Conversion auto-generates a real Stripe Checkout Session
    const convertRes = await request(
      'POST',
      `/marketing/leads/${contact.id}/convert`,
      {
        offerId: offer.id,
        contractState: 'SIGNED_MANUAL',
        paymentState: 'DEPOSIT_PAID_MANUAL',
        paymentAmount: 99,
      },
      { ...authHeaders, 'Idempotency-Key': idemKey },
    );
    assert(
      convertRes.statusCode < 300 && !!convertRes.body.id,
      `Conversion succeeds to seed a real ClientAccount (status ${convertRes.statusCode})`,
    );
    const clientAccountId = convertRes.body.id;
    assert(
      typeof convertRes.body.checkoutUrl === 'string' &&
        convertRes.body.checkoutUrl.startsWith('https://checkout.stripe.com'),
      'Conversion response includes a real Stripe-hosted checkoutUrl',
    );

    // 2. Checkout session is retrievable and persisted correctly
    const checkoutRes = await request(
      'GET',
      `/marketing/clients/${clientAccountId}/billing/checkout`,
      undefined,
      authHeaders,
    );
    assert(
      checkoutRes.statusCode === 200 && checkoutRes.body.status === 'CREATED',
      `Billing checkout GET returns a CREATED session (status ${checkoutRes.statusCode})`,
    );
    assert(
      typeof checkoutRes.body.stripeCheckoutSessionId === 'string' &&
        checkoutRes.body.stripeCheckoutSessionId.startsWith('cs_'),
      'Persisted session has a real Stripe checkout session ID (cs_...)',
    );
    assert(
      checkoutRes.body.subscriptionStatus === null,
      'No subscription exists yet -- subscriptionStatus is null before any webhook delivery',
    );

    // 3. Regeneration works and is role-gated (ORG_ADMIN is allowed)
    const regenRes = await request(
      'POST',
      `/marketing/clients/${clientAccountId}/billing/checkout/regenerate`,
      undefined,
      authHeaders,
    );
    assert(
      regenRes.statusCode < 300 &&
        typeof regenRes.body.checkoutUrl === 'string',
      `Regenerate produces a new checkout session for an allowed role (status ${regenRes.statusCode})`,
    );

    // 4. Dashboard remains reachable and loads with classified KPIs
    const dashRes = await request(
      'GET',
      '/marketing/dashboard',
      undefined,
      authHeaders,
    );
    assert(
      dashRes.statusCode === 200 &&
        !!dashRes.body.revenueTrajectory?.collectedRevenue90d?.classification,
      `Marketing Dashboard loads with classified revenue KPIs (status ${dashRes.statusCode})`,
    );
  } finally {
    console.log('\n🧹 Cleaning up staging smoke test records...');
    await prisma.billingPaymentRecord.deleteMany({
      where: { clientAccount: { businessUnitId: buMktg.id } },
    });
    await prisma.billingSubscription.deleteMany({
      where: { clientAccount: { businessUnitId: buMktg.id } },
    });
    await prisma.billingCheckoutSession.deleteMany({
      where: { clientAccount: { businessUnitId: buMktg.id } },
    });
    await prisma.memoryAuditEvent.deleteMany({
      where: { businessUnitId: buMktg.id },
    });
    await prisma.task.deleteMany({ where: { workspaceId: wsMktg.id } });
    await prisma.relationshipSignal
      .deleteMany({
        where: { clientAccount: { businessUnitId: buMktg.id } },
      })
      .catch(() => {
        /* model name may differ; non-fatal for cleanup */
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
    await prisma.stripePriceMapping.deleteMany({
      where: { offerId: offer.id },
    });
    await prisma.offer.deleteMany({ where: { businessUnitId: buMktg.id } });
    await prisma.opportunity.deleteMany({ where: { workspaceId: wsMktg.id } });
    await prisma.stage.deleteMany({ where: { pipelineId: pipeline.id } });
    await prisma.pipeline.deleteMany({ where: { id: pipeline.id } });
    await prisma.contact.deleteMany({ where: { workspaceId: wsMktg.id } });
    await prisma.membership.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.workspace.deleteMany({ where: { id: wsMktg.id } });
    await prisma.businessUnit.deleteMany({ where: { id: buMktg.id } });
    await prisma.organization.delete({ where: { id: org.id } });
    console.log('✅ Cleanup complete.');
  }

  console.log(
    '=================================================================',
  );
  console.log(`📊 STAGING SMOKE TEST: ${pass} passed, ${fail} failed.`);
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('FATAL:', err);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
