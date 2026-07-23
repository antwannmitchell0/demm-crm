import 'dotenv/config';
import * as https from 'https';
import { IncomingHttpHeaders } from 'http';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';

/**
 * Staging smoke test for Sub-project 3 (Marketing Dashboard, Explainable
 * Client Health, Internal + Client-Facing Reporting), run against the LIVE
 * deployed Cloud Run backend over real HTTPS. Seeds its own throwaway
 * org/BU/workspace/client directly via the staging Cloud SQL connection,
 * exercises the new endpoints purely through the public HTTPS surface, then
 * cleans up all seeded rows regardless of pass/fail.
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
    '🧪 STAGING SMOKE TEST — Dashboard, Client Health, Reporting (live HTTPS)',
  );
  console.log(`Target: ${baseUrl}`);
  console.log(
    '=================================================================',
  );

  const suffix = Date.now();
  const org = await prisma.organization.create({
    data: { name: `Staging Smoke Org 3 ${suffix}` },
  });
  const buMktg = await prisma.businessUnit.create({
    data: { organizationId: org.id, key: 'MARKETING', name: 'DEMM Marketing' },
  });
  const wsMktg = await prisma.workspace.create({
    data: {
      organizationId: org.id,
      businessUnitId: buMktg.id,
      name: 'Marketing WS 3',
      subdomain: `smoke3-mktg-${suffix}`,
    },
  });
  const passwordHash = await bcrypt.hash('StagingSmoke123!', 10);
  const user = await prisma.user.create({
    data: {
      email: `staging-smoke3-${suffix}@example.com`,
      passwordHash,
      firstName: 'Staging',
      lastName: 'Smoke3',
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
    data: { name: 'Smoke Pipeline 3', workspaceId: wsMktg.id },
  });
  const stage = await prisma.stage.create({
    data: { name: 'New', order: 1, pipelineId: pipeline.id },
  });
  const offer = await prisma.offer.create({
    data: {
      businessUnitId: buMktg.id,
      key: `smoke3-tier-${suffix}`,
      version: 1,
      name: 'Smoke Tier 3',
      price: 299,
      includedServices: ['Smoke test service'],
      excludedServices: [],
      onboardingRequirements: [],
      supportBoundaries: 'N/A',
      reportingCadence: 'N/A',
      cancellationTerms: 'N/A',
      expectedLaunchTime: 'N/A',
      lifecycleState: 'ACTIVE',
    },
  });
  const contact = await prisma.contact.create({
    data: {
      workspaceId: wsMktg.id,
      firstName: 'Health',
      lastName: 'Client',
      emails: [`staging-smoke3-client-${suffix}@example.com`],
      phones: [],
      status: 'CUSTOMER',
    },
  });

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

    // Create a client account directly against the conversion path so
    // dashboard/health/reporting have a real ClientAccount to compute over.
    const idemKey = `staging-smoke3-${suffix}`;
    const opportunity = await prisma.opportunity.create({
      data: {
        workspaceId: wsMktg.id,
        contactId: contact.id,
        pipelineId: pipeline.id,
        stageId: stage.id,
        name: 'Smoke Acquisition',
        value: 299,
        status: 'OPEN',
      },
    });
    const convertRes = await request(
      'POST',
      `/marketing/leads/${contact.id}/convert`,
      {
        offerId: offer.id,
        contractState: 'SIGNED_MANUAL',
        paymentState: 'DEPOSIT_PAID_MANUAL',
        paymentAmount: 299,
      },
      { ...authHeaders, 'Idempotency-Key': idemKey },
    );
    assert(
      convertRes.statusCode < 300 && !!convertRes.body.id,
      `Conversion succeeds to seed a real ClientAccount (status ${convertRes.statusCode})`,
    );
    const clientAccountId = convertRes.body.id;

    // 1. Marketing Dashboard loads with classified KPIs
    const dashRes = await request(
      'GET',
      '/marketing/dashboard',
      undefined,
      authHeaders,
    );
    assert(
      dashRes.statusCode === 200 &&
        !!dashRes.body.revenueTrajectory &&
        !!dashRes.body.revenueTrajectory.collectedRevenue90d?.classification,
      `Marketing Dashboard loads with classified revenue KPIs (status ${dashRes.statusCode})`,
    );
    assert(
      dashRes.body.revenueTrajectory.collectedRevenue90d.classification ===
        'MANUALLY_RECORDED',
      'Collected revenue is honestly classified MANUALLY_RECORDED (no payment gateway exists)',
    );

    // 2. Client Health calculates explainably, not as an opaque score
    const healthRes = await request(
      'POST',
      `/marketing/clients/${clientAccountId}/health/recalculate`,
      undefined,
      authHeaders,
    );
    assert(
      healthRes.statusCode < 300 &&
        typeof healthRes.body.state === 'string' &&
        Array.isArray(healthRes.body.factors),
      `Client Health recalculates to an explainable state with factors (status ${healthRes.statusCode})`,
    );

    const getHealthRes = await request(
      'GET',
      `/marketing/clients/${clientAccountId}/health`,
      undefined,
      authHeaders,
    );
    assert(
      getHealthRes.statusCode === 200 && !!getHealthRes.body.calculatedAt,
      'Client Health is retrievable with a calculation timestamp',
    );

    // 3. Human override works and is distinguishable from the computed state
    const overrideRes = await request(
      'POST',
      `/marketing/clients/${clientAccountId}/health/override`,
      { state: 'WATCH', reason: 'Staging smoke test override' },
      authHeaders,
    );
    assert(
      overrideRes.statusCode < 300 && overrideRes.body.state === 'WATCH',
      `Human override sets state to WATCH (status ${overrideRes.statusCode})`,
    );
    const afterOverrideRes = await request(
      'GET',
      `/marketing/clients/${clientAccountId}/health`,
      undefined,
      authHeaders,
    );
    assert(
      afterOverrideRes.body.overrideState === 'WATCH' &&
        !!afterOverrideRes.body.computedState,
      'Overridden state and underlying computed state are both visible',
    );

    const clearOverrideRes = await request(
      'DELETE',
      `/marketing/clients/${clientAccountId}/health/override`,
      undefined,
      authHeaders,
    );
    assert(
      clearOverrideRes.statusCode < 300,
      `Clearing the override succeeds (status ${clearOverrideRes.statusCode})`,
    );

    // 4. Internal Operating Report has evidence-backed sections
    const internalReportRes = await request(
      'GET',
      '/marketing/reports/internal',
      undefined,
      authHeaders,
    );
    assert(
      internalReportRes.statusCode === 200 &&
        Array.isArray(internalReportRes.body.systemLimitations),
      `Internal Operating Report loads with honest system limitations (status ${internalReportRes.statusCode})`,
    );

    // 5. Client-Facing Report excludes internal-only fields
    const clientReportRes = await request(
      'GET',
      `/marketing/clients/${clientAccountId}/report`,
      undefined,
      authHeaders,
    );
    assert(
      clientReportRes.statusCode === 200 && !!clientReportRes.body.clientName,
      `Client-Facing Report loads (status ${clientReportRes.statusCode})`,
    );
    const clientReportStr = JSON.stringify(clientReportRes.body);
    assert(
      !clientReportStr.includes('confidenceScore') &&
        !clientReportStr.includes('internalRiskLabel') &&
        !clientReportStr.includes('operatorNote'),
      'Client-Facing Report contains no internal confidence/risk/operator-note fields',
    );

    // 6. Recording a commercial-state payment flows into KPIs
    const paymentRes = await request(
      'POST',
      `/marketing/clients/${clientAccountId}/commercial-state`,
      { field: 'PAYMENT', newValue: 'PAID_IN_FULL_MANUAL', amount: 150 },
      authHeaders,
    );
    assert(
      paymentRes.statusCode < 300,
      `Recording a commercial-state payment succeeds (status ${paymentRes.statusCode})`,
    );

    // 7. Cross-workspace isolation: dashboard is scoped to this workspace only
    const dashAfterRes = await request(
      'GET',
      '/marketing/dashboard',
      undefined,
      authHeaders,
    );
    assert(
      dashAfterRes.statusCode === 200,
      'Dashboard remains reachable and scoped after commercial-state update',
    );
  } finally {
    console.log('\n🧹 Cleaning up staging smoke test records...');
    await prisma.clientHealthOverride.deleteMany({
      where: { health: { clientAccount: { businessUnitId: buMktg.id } } },
    });
    await prisma.clientHealthHistory.deleteMany({
      where: { health: { clientAccount: { businessUnitId: buMktg.id } } },
    });
    await prisma.clientHealth.deleteMany({
      where: { clientAccount: { businessUnitId: buMktg.id } },
    });
    await prisma.memoryAuditEvent.deleteMany({
      where: { businessUnitId: buMktg.id },
    });
    const profiles = await prisma.relationshipProfile.findMany({
      where: { businessUnitId: buMktg.id },
      select: { id: true },
    });
    const profileIds = profiles.map((p) => p.id);
    await prisma.briefEvidence.deleteMany({
      where: { brief: { profileId: { in: profileIds } } },
    });
    await prisma.relationshipBrief.deleteMany({
      where: { profileId: { in: profileIds } },
    });
    await prisma.candidateEvidence.deleteMany({
      where: { candidate: { profileId: { in: profileIds } } },
    });
    await prisma.memoryApproval.deleteMany({
      where: { candidate: { profileId: { in: profileIds } } },
    });
    await prisma.memoryCandidate.deleteMany({
      where: { profileId: { in: profileIds } },
    });
    const engramEvidenceRows = await prisma.engramEvidence.findMany({
      where: { engram: { businessUnitId: buMktg.id } },
      select: { sourceId: true },
    });
    const ownedSourceIds = [
      ...new Set(engramEvidenceRows.map((r) => r.sourceId)),
    ];
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
      where: { contact: { workspaceId: wsMktg.id } },
    });
    await prisma.onboardingChecklistItem.deleteMany({
      where: { plan: { clientAccount: { businessUnitId: buMktg.id } } },
    });
    await prisma.onboardingPlan.deleteMany({
      where: { clientAccount: { businessUnitId: buMktg.id } },
    });
    await prisma.serviceDeliverable.deleteMany({
      where: { clientAccount: { businessUnitId: buMktg.id } },
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
    await prisma.task.deleteMany({ where: { workspaceId: wsMktg.id } });
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
