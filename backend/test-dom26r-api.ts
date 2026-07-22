import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './src/app.module';
import { PrismaClient, SubjectType, MemoryForm, MemoryTopic, TruthClassification, SensitivityClassification, SourceType, ConsentChannel } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as jwt from 'jsonwebtoken';

dotenv.config();

const connectionString = process.env.DATABASE_URL || 'postgresql://antwannmitchellsr@localhost:5432/demm_crm';
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
  console.log('🧪 STARTING DOM26-R API LAYER SMOKE TEST (real HTTP, real guards)');
  console.log('===================================================================');

  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0);
  const server = app.getHttpServer();
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const suffix = Date.now();
  const org = await prisma.organization.create({ data: { name: `DOM26R API Test Org ${suffix}` } });
  const buMktg = await prisma.businessUnit.create({ data: { organizationId: org.id, key: 'MARKETING', name: 'DEMM Marketing' } });
  const buPhoto = await prisma.businessUnit.create({ data: { organizationId: org.id, key: 'PHOTO_BOOTHS', name: 'DEMM Photo Booths' } });

  const wsMktg = await prisma.workspace.create({
    data: { organizationId: org.id, businessUnitId: buMktg.id, name: 'Marketing WS', subdomain: `api-test-mktg-${suffix}` },
  });
  const wsPhoto = await prisma.workspace.create({
    data: { organizationId: org.id, businessUnitId: buPhoto.id, name: 'Photo WS', subdomain: `api-test-photo-${suffix}` },
  });

  const user = await prisma.user.create({
    data: {
      email: `dom26r-api-test-${suffix}@example.com`,
      passwordHash: 'unused-in-this-test',
      firstName: 'API',
      lastName: 'Tester',
    },
  });
  await prisma.membership.create({ data: { userId: user.id, organizationId: org.id, workspaceId: wsMktg.id, role: 'ORG_ADMIN' } });
  await prisma.membership.create({ data: { userId: user.id, organizationId: org.id, workspaceId: wsPhoto.id, role: 'ORG_ADMIN' } });

  const contact = await prisma.contact.create({
    data: { firstName: 'Bob', lastName: 'Miller', emails: ['bob@example.com'], workspaceId: wsMktg.id },
  });

  const token = jwt.sign(
    { sub: user.id, email: user.email, workspaceId: wsMktg.id },
    process.env.JWT_SECRET!,
    { expiresIn: '15m' },
  );

  const headersFor = (workspaceId: string) => ({
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'x-workspace-id': workspaceId,
  });

  // --- Create Engram via API (Marketing) ---
  const engramRes = await fetch(`${base}/dom26r/engrams`, {
    method: 'POST',
    headers: headersFor(wsMktg.id),
    body: JSON.stringify({
      subjectType: SubjectType.CONTACT,
      subjectRefId: contact.id,
      form: MemoryForm.SEMANTIC,
      topic: MemoryTopic.PREFERENCE,
      truthClassification: TruthClassification.CONFIRMED,
      sensitivity: SensitivityClassification.INTERNAL,
      summary: 'Prefers morning check-in calls.',
      sources: [{ type: SourceType.MANUAL, referenceId: 'test-note-1' }],
    }),
  });
  const engram = await engramRes.json();
  check('POST /dom26r/engrams creates engram (201/200)', engramRes.status < 300 && !!engram.id);
  check('Created engram has 1 evidence source', engram.evidence?.length === 1);

  // --- Cross-business isolation over HTTP: Photo Booths workspace must not see the Marketing engram ---
  const crossListRes = await fetch(`${base}/dom26r/engrams`, { headers: headersFor(wsPhoto.id) });
  const crossList = await crossListRes.json();
  check(
    'Photo Booths workspace cannot read Marketing engram via API',
    Array.isArray(crossList) && !crossList.some((e: any) => e.id === engram.id),
  );

  // --- Forget workflow via API ---
  const forgetRes = await fetch(`${base}/dom26r/engrams/${engram.id}/forget`, { method: 'POST', headers: headersFor(wsMktg.id) });
  const forgotten = await forgetRes.json();
  check('Forget endpoint redacts summary', forgotten.summary === 'REDACTED / FORGOTTEN' && forgotten.structuredContent === null);

  // --- Memory Candidate -> Approve -> Engram promotion via API ---
  const candidateRes = await fetch(`${base}/dom26r/memory-candidates`, {
    method: 'POST',
    headers: headersFor(wsMktg.id),
    body: JSON.stringify({
      subjectType: SubjectType.CONTACT,
      subjectRefId: contact.id,
      form: MemoryForm.EPISODIC,
      topic: MemoryTopic.MILESTONE,
      proposedTruth: TruthClassification.CONFIRMED,
      confidence: 0.9,
      sensitivity: SensitivityClassification.INTERNAL,
      consentBasis: 'CONTRACT',
      summary: 'Signed founder tier agreement.',
      sources: [
        { type: SourceType.AGENT, referenceId: 'agent-1' },
        { type: SourceType.MANUAL, referenceId: 'manual-1' },
      ],
    }),
  });
  const candidate = await candidateRes.json();
  check('POST /dom26r/memory-candidates creates candidate with 2 sources', candidate.status === 'PENDING' && candidate.evidence?.length === 2);

  const approveRes = await fetch(`${base}/dom26r/memory-candidates/${candidate.id}/approve`, { method: 'POST', headers: headersFor(wsMktg.id) });
  const promoted = await approveRes.json();
  check('Approve endpoint promotes candidate into an Engram carrying 2 sources', promoted.id && promoted.id !== candidate.id);

  const promotedFetchRes = await fetch(`${base}/dom26r/engrams/${promoted.id}`, { headers: headersFor(wsMktg.id) });
  const promotedFetched = await promotedFetchRes.json();
  check('Promoted engram carries forward both evidence sources', promotedFetched.evidence?.length === 2);

  // --- Consent Directive: grant then withdraw via API ---
  const consentRes = await fetch(`${base}/dom26r/consent-directives`, {
    method: 'POST',
    headers: headersFor(wsMktg.id),
    body: JSON.stringify({
      subjectId: (await prisma.relationshipSubject.findUnique({ where: { contactId: contact.id } }))!.id,
      dataCategory: MemoryTopic.PREFERENCE,
      purpose: 'MARKETING_PROMOTION',
      channel: ConsentChannel.WEB,
      noticeVersion: 'v1.0',
      effectiveDate: new Date().toISOString(),
    }),
  });
  const consent = await consentRes.json();
  check('POST /dom26r/consent-directives grants consent', consent.status === 'GRANTED');

  const withdrawRes = await fetch(`${base}/dom26r/consent-directives/${consent.id}/withdraw`, { method: 'POST', headers: headersFor(wsMktg.id) });
  const withdrawn = await withdrawRes.json();
  check('Withdraw endpoint sets status WITHDRAWN', withdrawn.status === 'WITHDRAWN' && withdrawn.withdrawn === true);

  // --- Relationship Brief: internal vs customer-visible formatting ---
  const profile = await prisma.relationshipProfile.findFirst({ where: { businessUnitId: buMktg.id } });
  const briefRes = await fetch(`${base}/dom26r/relationship-briefs`, {
    method: 'POST',
    headers: headersFor(wsMktg.id),
    body: JSON.stringify({
      profileId: profile!.id,
      briefText: 'Bob is an engaged founder-tier client.',
      generator: 'test-suite',
      version: 'v1',
      sensitivity: SensitivityClassification.PUBLIC,
      engramIds: [promoted.id],
    }),
  });
  const brief = await briefRes.json();
  check('POST /dom26r/relationship-briefs generates brief', !!brief.id);

  const internalViewRes = await fetch(`${base}/dom26r/relationship-briefs/${brief.id}?view=INTERNAL_AGENT`, { headers: headersFor(wsMktg.id) });
  const internalView = await internalViewRes.json();
  check('INTERNAL_AGENT view exposes generator/version metadata', internalView.generator === 'test-suite');

  const customerViewRes = await fetch(`${base}/dom26r/relationship-briefs/${brief.id}?view=CUSTOMER_VISIBLE`, { headers: headersFor(wsMktg.id) });
  const customerView = await customerViewRes.json();
  check(
    'CUSTOMER_VISIBLE view strips internal metadata, keeps only briefText',
    customerView.briefText === 'Bob is an engaged founder-tier client.' && customerView.generator === undefined,
  );

  // --- Audit trail: every write above must have left an append-only MemoryAuditEvent ---
  const auditEvents = await prisma.memoryAuditEvent.findMany({ where: { businessUnitId: buMktg.id } });
  const actions = auditEvents.map((e) => e.action);
  check(
    'Every write action logged a MemoryAuditEvent (create/forget/candidate/approve/consent/withdraw/brief)',
    ['ENGRAM_CREATE', 'SUPPRESSION_FORGET', 'CANDIDATE_CREATE', 'CANDIDATE_APPROVE_PROMOTE', 'CONSENT_GRANT', 'CONSENT_WITHDRAW', 'BRIEF_GENERATE'].every((a) =>
      actions.includes(a),
    ),
  );

  await app.close();

  console.log('\n🧹 Cleaning up test database records...');
  // ConsentDirective -> BusinessUnit is RESTRICT by design (consent records
  // must never be silently cascade-deleted), so it must go before Organization.
  await prisma.consentDirective.deleteMany({ where: { originatingBusinessId: { in: [buMktg.id, buPhoto.id] } } });
  await prisma.organization.delete({ where: { id: org.id } });
  console.log('✅ Cleanup complete.');

  console.log('===================================================================');
  console.log(`📊 DOM26-R API SMOKE TEST: ${pass} passed, ${fail} failed.`);
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
