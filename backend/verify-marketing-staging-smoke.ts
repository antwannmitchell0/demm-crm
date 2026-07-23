import 'dotenv/config';
import * as https from 'https';
import { IncomingHttpHeaders } from 'http';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';

/**
 * Focused staging smoke test for Phase 2 (Lead-to-Client Core), run against
 * the LIVE deployed Cloud Run backend over real HTTPS -- not a local Nest
 * app instance. Seeds its own throwaway org/BU/workspace/users directly via
 * the staging Cloud SQL connection (passed in via DATABASE_URL, expected to
 * point at the staging DB through the Cloud SQL Auth Proxy), then exercises
 * every item in the accepted staging smoke-test checklist purely through
 * the public HTTPS surface. Cleans up all seeded rows at the end regardless
 * of pass/fail.
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
    '🧪 STAGING SMOKE TEST — Phase 2 Lead-to-Client Core (live HTTPS)',
  );
  console.log(`Target: ${baseUrl}`);
  console.log(
    '=================================================================',
  );

  const suffix = Date.now();
  const org = await prisma.organization.create({
    data: { name: `Staging Smoke Org ${suffix}` },
  });
  const buMktg = await prisma.businessUnit.create({
    data: { organizationId: org.id, key: 'MARKETING', name: 'DEMM Marketing' },
  });
  const buOther = await prisma.businessUnit.create({
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
      subdomain: `smoke-mktg-${suffix}`,
    },
  });
  const wsOther = await prisma.workspace.create({
    data: {
      organizationId: org.id,
      businessUnitId: buOther.id,
      name: 'Other WS',
      subdomain: `smoke-other-${suffix}`,
    },
  });
  const passwordHash = await bcrypt.hash('StagingSmoke123!', 10);
  const user = await prisma.user.create({
    data: {
      email: `staging-smoke-${suffix}@example.com`,
      passwordHash,
      firstName: 'Staging',
      lastName: 'Smoke',
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
  await prisma.membership.create({
    data: {
      userId: user.id,
      organizationId: org.id,
      workspaceId: wsOther.id,
      role: 'ORG_ADMIN',
    },
  });
  const pipeline = await prisma.pipeline.create({
    data: { name: 'Smoke Pipeline', workspaceId: wsMktg.id },
  });
  const stage = await prisma.stage.create({
    data: { name: 'New', order: 1, pipelineId: pipeline.id },
  });
  const offer = await prisma.offer.create({
    data: {
      businessUnitId: buMktg.id,
      key: `smoke-tier-${suffix}`,
      version: 1,
      name: 'Smoke Tier',
      price: 199,
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

  try {
    // 1. Login works (real credential-verify + workspace-select round trip)
    const loginRes = await request('POST', '/api/auth/login', {
      email: user.email,
      passwordPlain: 'StagingSmoke123!',
    });
    assert(
      loginRes.statusCode < 300 && !!loginRes.body.preAuthToken,
      `Login: credentials verified, preAuthToken issued (status ${loginRes.statusCode})`,
    );

    const selectRes = await request(
      'POST',
      '/api/auth/select-workspace',
      { workspaceId: wsMktg.id },
      { Authorization: `Bearer ${loginRes.body.preAuthToken}` },
    );
    assert(
      selectRes.statusCode < 300 && !!selectRes.body.access_token,
      `Login: workspace selected, real access token issued (status ${selectRes.statusCode})`,
    );
    const token = selectRes.body.access_token;
    const authHeaders = (workspaceId: string) => ({
      Authorization: `Bearer ${token}`,
      'x-workspace-id': workspaceId,
    });

    // 2. Offers load
    const offersRes = await request(
      'GET',
      '/marketing/offers',
      undefined,
      authHeaders(wsMktg.id),
    );
    assert(
      offersRes.statusCode === 200 &&
        offersRes.body.some((o: any) => o.id === offer.id),
      'Offers load: GET /marketing/offers returns the seeded ACTIVE offer',
    );

    // 3/4. A lead can be added, and appears correctly
    const leadRes = await request(
      'POST',
      '/marketing/leads',
      {
        firstName: 'Staging',
        lastName: 'Lead',
        emails: [`staging-lead-${suffix}@example.com`],
        phones: [],
        source: 'staging-smoke',
        pipelineId: pipeline.id,
        stageId: stage.id,
        expectedValue: 1000,
      },
      authHeaders(wsMktg.id),
    );
    assert(
      leadRes.statusCode < 300 && leadRes.body.contact?.status === 'LEAD',
      'Add lead: Contact + Opportunity created',
    );
    const contactId = leadRes.body.contact.id;
    const opportunityId = leadRes.body.opportunity.id;

    const leadsListRes = await request(
      'GET',
      '/marketing/leads',
      undefined,
      authHeaders(wsMktg.id),
    );
    assert(
      leadsListRes.statusCode === 200 &&
        leadsListRes.body.some((c: any) => c.id === contactId),
      'New lead appears correctly in GET /marketing/leads',
    );

    // 5. Lead detail opens
    const contactDetailRes = await request(
      'GET',
      `/contacts/${contactId}`,
      undefined,
      authHeaders(wsMktg.id),
    );
    assert(
      contactDetailRes.statusCode === 200 &&
        contactDetailRes.body.id === contactId,
      'Lead detail opens: GET /contacts/:id returns the lead',
    );

    // 7. Lead-to-client conversion works
    const idemKey = `staging-smoke-${suffix}`;
    const convertRes = await request(
      'POST',
      `/marketing/leads/${contactId}/convert`,
      {
        offerId: offer.id,
        contractState: 'SIGNED_MANUAL',
        paymentState: 'DEPOSIT_PAID_MANUAL',
      },
      { ...authHeaders(wsMktg.id), 'Idempotency-Key': idemKey },
    );
    assert(
      convertRes.statusCode < 300 && !!convertRes.body.id,
      'Lead-to-client conversion succeeds',
    );
    const clientAccountId = convertRes.body.id;

    // 8. ClientAccount created as PENDING_ONBOARDING
    assert(
      convertRes.body.serviceStatus === 'PENDING_ONBOARDING',
      'ClientAccount created as PENDING_ONBOARDING',
    );

    // 9. Opportunity becomes WON
    const oppAfter = await prisma.opportunity.findUnique({
      where: { id: opportunityId },
    });
    assert(
      oppAfter?.status === 'WON',
      'Acquisition Opportunity transitions to WON',
    );

    // 10. Onboarding kickoff task created
    const kickoffTask = await prisma.task.findFirst({
      where: { contactId, title: { contains: 'Onboarding kickoff' } },
    });
    assert(!!kickoffTask, 'Onboarding kickoff Task created');

    // 11. Immutable OfferSnapshot exists
    const clientDetailRes = await request(
      'GET',
      `/marketing/clients/${clientAccountId}`,
      undefined,
      authHeaders(wsMktg.id),
    );
    assert(
      clientDetailRes.statusCode === 200 &&
        !!clientDetailRes.body.offerSnapshot?.id,
      'Immutable OfferSnapshot exists and is returned on client detail',
    );

    // 6. Relationship Brief loads (generate one, then fetch at INTERNAL_HUMAN tier)
    const profile = await prisma.relationshipProfile.findFirst({
      where: { businessUnitId: buMktg.id, subject: { contactId } },
    });
    const milestoneEngram = await prisma.engram.findFirst({
      where: { profileId: profile?.id },
      orderBy: { createdAt: 'desc' },
    });
    const briefGenRes = await request(
      'POST',
      '/dom26r/relationship-briefs',
      {
        profileId: profile!.id,
        briefText: 'Staging smoke test client.',
        generator: 'staging-smoke',
        version: 'v1',
        sensitivity: 'PUBLIC',
        engramIds: milestoneEngram ? [milestoneEngram.id] : [],
      },
      authHeaders(wsMktg.id),
    );
    assert(
      briefGenRes.statusCode < 300 && !!briefGenRes.body.id,
      'Relationship Brief generates successfully',
    );

    const clientDetailWithBriefRes = await request(
      'GET',
      `/marketing/clients/${clientAccountId}`,
      undefined,
      authHeaders(wsMktg.id),
    );
    assert(
      clientDetailWithBriefRes.statusCode === 200 &&
        !!clientDetailWithBriefRes.body.brief?.briefText,
      'Relationship Brief loads on client detail at INTERNAL_HUMAN tier',
    );

    // 12. Duplicate conversion is rejected
    const dupConvertRes = await request(
      'POST',
      `/marketing/leads/${contactId}/convert`,
      { offerId: offer.id },
      { ...authHeaders(wsMktg.id), 'Idempotency-Key': `${idemKey}-different` },
    );
    // A SEQUENTIAL duplicate (this test) arrives after the first conversion
    // already marked the Opportunity WON, so it correctly gets rejected at
    // the earlier "resolve open Opportunity" precondition (404) rather than
    // reaching the duplicate-ClientAccount check (409, which is what fires
    // for a CONCURRENT race -- see test-marketing-lead-to-client-api.ts).
    // Either way, no second ClientAccount is created.
    assert(
      dupConvertRes.statusCode === 404 || dupConvertRes.statusCode === 409,
      `Duplicate conversion rejected, not silently re-converted (status ${dupConvertRes.statusCode}: ${JSON.stringify(dupConvertRes.body)})`,
    );

    // 13. Cross-Business-Unit isolation remains enforced
    const crossBuRes = await request(
      'GET',
      `/contacts/${contactId}`,
      undefined,
      authHeaders(wsOther.id),
    );
    assert(
      crossBuRes.statusCode === 403 || crossBuRes.statusCode === 404,
      'Cross-BU access to the Marketing lead is denied',
    );

    const crossBuOffersRes = await request(
      'GET',
      '/marketing/offers',
      undefined,
      authHeaders(wsOther.id),
    );
    assert(
      crossBuOffersRes.statusCode === 200 &&
        !crossBuOffersRes.body.some((o: any) => o.id === offer.id),
      'Cross-BU: Photo Booths workspace cannot see the Marketing offer',
    );
  } finally {
    console.log('\n🧹 Cleaning up staging smoke test records...');
    await prisma.memoryAuditEvent.deleteMany({
      where: { businessUnitId: { in: [buMktg.id, buOther.id] } },
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
      where: { contact: { workspaceId: wsMktg.id } },
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
    await prisma.task.deleteMany({
      where: { workspaceId: { in: [wsMktg.id, wsOther.id] } },
    });
    await prisma.opportunity.deleteMany({ where: { workspaceId: wsMktg.id } });
    await prisma.stage.deleteMany({ where: { pipelineId: pipeline.id } });
    await prisma.pipeline.deleteMany({ where: { id: pipeline.id } });
    await prisma.contact.deleteMany({ where: { workspaceId: wsMktg.id } });
    await prisma.membership.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.workspace.deleteMany({
      where: { id: { in: [wsMktg.id, wsOther.id] } },
    });
    await prisma.businessUnit.deleteMany({
      where: { id: { in: [buMktg.id, buOther.id] } },
    });
    await prisma.organization.delete({ where: { id: org.id } });
    console.log('✅ Cleanup complete.');
  }

  console.log(
    '=================================================================',
  );
  console.log(`📊 STAGING SMOKE TEST: ${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
