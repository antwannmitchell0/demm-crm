import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './src/app.module';
import {
  PrismaClient,
  ContactStatus,
  OpportunityStatus,
  CandidateState,
  EngramState,
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as jwt from 'jsonwebtoken';

dotenv.config();

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
  console.log(
    '🧪 STARTING MARKETING LEAD-TO-CLIENT API SUITE (real HTTP, real guards)',
  );
  console.log(
    '=========================================================================',
  );

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

  const suffix = Date.now();
  const org = await prisma.organization.create({
    data: { name: `Marketing L2C Test Org ${suffix}` },
  });
  const buMktg = await prisma.businessUnit.create({
    data: { organizationId: org.id, key: 'MARKETING', name: 'DEMM Marketing' },
  });
  const buPhoto = await prisma.businessUnit.create({
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
      subdomain: `l2c-test-mktg-${suffix}`,
    },
  });
  const wsPhoto = await prisma.workspace.create({
    data: {
      organizationId: org.id,
      businessUnitId: buPhoto.id,
      name: 'Photo WS',
      subdomain: `l2c-test-photo-${suffix}`,
    },
  });

  const user = await prisma.user.create({
    data: {
      email: `l2c-api-test-${suffix}@example.com`,
      passwordHash: 'unused-in-this-test',
      firstName: 'API',
      lastName: 'Tester',
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
      workspaceId: wsPhoto.id,
      role: 'ORG_ADMIN',
    },
  });

  const pipeline = await prisma.pipeline.create({
    data: { name: 'Marketing Pipeline', workspaceId: wsMktg.id },
  });
  const stage = await prisma.stage.create({
    data: { name: 'New', order: 1, pipelineId: pipeline.id },
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

  const headersForIdempotent = (
    workspaceId: string,
    idempotencyKey: string,
  ) => ({
    ...headersFor(workspaceId),
    'Idempotency-Key': idempotencyKey,
  });

  // =========================================================================
  // Scenario: Offer CRUD + lifecycle transitions
  // =========================================================================
  const createOfferRes = await fetch(`${base}/marketing/offers`, {
    method: 'POST',
    headers: headersFor(wsMktg.id),
    body: JSON.stringify({
      key: `founder-tier-${suffix}`,
      name: 'Founder Tier',
      price: 299,
      setupFee: 0,
      includedServices: ['Weekly strategy call'],
      excludedServices: ['Paid ad spend'],
      onboardingRequirements: ['Brand assets'],
      supportBoundaries: 'Business hours only',
      reportingCadence: 'Weekly',
      cancellationTerms: '30 days notice',
      expectedLaunchTime: '2 weeks',
    }),
  });
  const draftOffer = await createOfferRes.json();
  check(
    'POST /marketing/offers creates offer in DRAFT',
    createOfferRes.status < 300 && draftOffer.lifecycleState === 'DRAFT',
  );

  const listOffersRes = await fetch(`${base}/marketing/offers`, {
    headers: headersFor(wsMktg.id),
  });
  const listedOffers = await listOffersRes.json();
  check(
    'GET /marketing/offers lists the created offer',
    listOffersRes.status === 200 &&
      listedOffers.some((o: any) => o.id === draftOffer.id),
  );

  const promoteRes = await fetch(
    `${base}/marketing/offers/${draftOffer.id}/lifecycle`,
    {
      method: 'POST',
      headers: headersFor(wsMktg.id),
      body: JSON.stringify({ state: 'ACTIVE' }),
    },
  );
  const activeOffer = await promoteRes.json();
  check(
    'POST /marketing/offers/:id/lifecycle DRAFT -> ACTIVE',
    activeOffer.lifecycleState === 'ACTIVE',
  );

  // A second offer, deliberately left in DRAFT, for the 422 rejection test.
  const draftOnlyOfferRes = await fetch(`${base}/marketing/offers`, {
    method: 'POST',
    headers: headersFor(wsMktg.id),
    body: JSON.stringify({
      key: `unreleased-tier-${suffix}`,
      name: 'Unreleased Tier',
      price: 999,
      includedServices: [],
      excludedServices: [],
      onboardingRequirements: [],
      supportBoundaries: 'N/A',
      reportingCadence: 'N/A',
      cancellationTerms: 'N/A',
      expectedLaunchTime: 'N/A',
    }),
  });
  const draftOnlyOffer = await draftOnlyOfferRes.json();

  // =========================================================================
  // Scenario: lead creation + duplicate detection by normalized email/phone
  // =========================================================================
  const leadRes = await fetch(`${base}/marketing/leads`, {
    method: 'POST',
    headers: headersFor(wsMktg.id),
    body: JSON.stringify({
      firstName: 'Company',
      lastName: 'Founder',
      emails: ['Founder@Example.com'],
      phones: ['+1 (555) 111-2222'],
      companyName: `Acme Co ${suffix}`,
      industryContext: 'Home Services',
      source: 'referral',
      pipelineId: pipeline.id,
      stageId: stage.id,
      expectedValue: 5000,
    }),
  });
  const companyLead = await leadRes.json();
  check(
    'POST /marketing/leads creates Contact + Opportunity + Company + Task',
    leadRes.status < 300 &&
      !!companyLead.contact?.id &&
      companyLead.contact.status === ContactStatus.LEAD &&
      !!companyLead.contact.companyId &&
      companyLead.opportunity.status === OpportunityStatus.OPEN,
  );

  const dupLeadRes = await fetch(`${base}/marketing/leads`, {
    method: 'POST',
    headers: headersFor(wsMktg.id),
    body: JSON.stringify({
      firstName: 'Company',
      lastName: 'Founder Again',
      emails: ['founder@example.com'],
      phones: ['5551112222'],
      pipelineId: pipeline.id,
      stageId: stage.id,
      expectedValue: 5000,
    }),
  });
  const dupLead = await dupLeadRes.json();
  check(
    'Duplicate-contact detection catches normalized email + phone match',
    typeof dupLead.duplicateWarning === 'string' &&
      dupLead.duplicateWarning.includes(companyLead.contact.id),
  );

  // A sole-proprietor lead with no Company at all, for the contact-only path.
  const soleProprietorLeadRes = await fetch(`${base}/marketing/leads`, {
    method: 'POST',
    headers: headersFor(wsMktg.id),
    body: JSON.stringify({
      firstName: 'Sole',
      lastName: 'Proprietor',
      emails: [`sole-${suffix}@example.com`],
      phones: [],
      source: 'organic',
      pipelineId: pipeline.id,
      stageId: stage.id,
      expectedValue: 1500,
    }),
  });
  const soleProprietorLead = await soleProprietorLeadRes.json();
  check(
    'Sole-proprietor lead created with no companyId',
    soleProprietorLeadRes.status < 300 && !soleProprietorLead.contact.companyId,
  );

  // =========================================================================
  // Scenario: inactive Offer rejection (422, not 403)
  // =========================================================================
  const draftOfferConvertRes = await fetch(
    `${base}/marketing/leads/${soleProprietorLead.contact.id}/convert`,
    {
      method: 'POST',
      headers: headersFor(wsMktg.id),
      body: JSON.stringify({ offerId: draftOnlyOffer.id }),
    },
  );
  check(
    'Converting against a DRAFT (non-ACTIVE) Offer is rejected with exactly 422',
    draftOfferConvertRes.status === 422,
  );

  // =========================================================================
  // Scenario: cross-BU denial (403) -- Photo Booths workspace cannot convert
  // a Marketing Contact, even though the caller has real membership there.
  // =========================================================================
  const crossBuConvertRes = await fetch(
    `${base}/marketing/leads/${soleProprietorLead.contact.id}/convert`,
    {
      method: 'POST',
      headers: headersFor(wsPhoto.id),
      body: JSON.stringify({ offerId: activeOffer.id }),
    },
  );
  check(
    'Converting a Marketing Contact via the Photo Booths workspace is rejected (403)',
    crossBuConvertRes.status === 403,
  );

  // =========================================================================
  // Scenario: Contact-only sole-proprietor conversion path
  // =========================================================================
  const soleConvertRes = await fetch(
    `${base}/marketing/leads/${soleProprietorLead.contact.id}/convert`,
    {
      method: 'POST',
      headers: headersForIdempotent(wsMktg.id, `sole-${suffix}`),
      body: JSON.stringify({
        offerId: activeOffer.id,
        contractState: 'SIGNED_MANUAL',
        paymentState: 'DEPOSIT_PAID_MANUAL',
      }),
    },
  );
  const soleClientAccount = await soleConvertRes.json();
  check(
    'Contact-only sole-proprietor conversion succeeds with no Company',
    soleConvertRes.status < 300 &&
      !soleClientAccount.companyId &&
      soleClientAccount.primaryContactId === soleProprietorLead.contact.id,
  );
  check(
    'ClientAccount begins at PENDING_ONBOARDING',
    soleClientAccount.serviceStatus === 'PENDING_ONBOARDING',
  );

  const soleContactAfter = await prisma.contact.findUnique({
    where: { id: soleProprietorLead.contact.id },
  });
  const soleOpportunityAfter = await prisma.opportunity.findUnique({
    where: { id: soleProprietorLead.opportunity.id },
  });
  check(
    'Converted Contact status transitions LEAD -> CUSTOMER',
    soleContactAfter?.status === ContactStatus.CUSTOMER,
  );
  check(
    'Acquisition Opportunity transitions to WON',
    soleOpportunityAfter?.status === OpportunityStatus.WON,
  );

  // =========================================================================
  // Scenario: converted lead disappears from GET /marketing/leads
  // =========================================================================
  const leadsAfterRes = await fetch(`${base}/marketing/leads`, {
    headers: headersFor(wsMktg.id),
  });
  const leadsAfter = await leadsAfterRes.json();
  check(
    'Converted lead disappears from GET /marketing/leads',
    !leadsAfter.some((c: any) => c.id === soleProprietorLead.contact.id),
  );
  check(
    'Un-converted lead (companyLead) still appears in GET /marketing/leads',
    leadsAfter.some((c: any) => c.id === companyLead.contact.id),
  );

  // =========================================================================
  // Scenario: duplicate-submit / idempotency -- same Idempotency-Key twice
  // =========================================================================
  const idemKey = `idem-${suffix}`;
  const idemLeadRes = await fetch(`${base}/marketing/leads`, {
    method: 'POST',
    headers: headersFor(wsMktg.id),
    body: JSON.stringify({
      firstName: 'Idempotency',
      lastName: 'Tester',
      emails: [`idem-${suffix}@example.com`],
      phones: [],
      pipelineId: pipeline.id,
      stageId: stage.id,
      expectedValue: 2000,
    }),
  });
  const idemLead = await idemLeadRes.json();

  const firstConvertRes = await fetch(
    `${base}/marketing/leads/${idemLead.contact.id}/convert`,
    {
      method: 'POST',
      headers: headersForIdempotent(wsMktg.id, idemKey),
      body: JSON.stringify({ offerId: activeOffer.id }),
    },
  );
  const firstConvert = await firstConvertRes.json();

  const secondConvertRes = await fetch(
    `${base}/marketing/leads/${idemLead.contact.id}/convert`,
    {
      method: 'POST',
      headers: headersForIdempotent(wsMktg.id, idemKey),
      body: JSON.stringify({ offerId: activeOffer.id }),
    },
  );
  const secondConvert = await secondConvertRes.json();

  check(
    'Same Idempotency-Key submitted twice returns the same ClientAccount id',
    firstConvertRes.status < 300 &&
      secondConvertRes.status < 300 &&
      firstConvert.id === secondConvert.id,
  );
  const clientAccountsForIdemContact = await prisma.clientAccount.count({
    where: { primaryContactId: idemLead.contact.id },
  });
  check(
    'Duplicate-submit with the same Idempotency-Key creates exactly one ClientAccount',
    clientAccountsForIdemContact === 1,
  );

  // =========================================================================
  // Scenario: conversion rollback under a real concurrent-duplicate race.
  //
  // The plan's step-4 duplicate-conversion guard is an ADVISORY read inside
  // the transaction, not a lock -- two concurrent conversions for the SAME
  // Contact (no idempotency key on either, so neither takes the pre-tx fast
  // path) can both pass it before either commits. The actual backstop is
  // ClientAccount's own BU-scoped @@unique([businessUnitId,
  // primaryContactId]) constraint: whichever transaction's INSERT loses
  // that race fails at Postgres's constraint-check level, and since a
  // failure ANYWHERE inside `prisma.$transaction`'s callback rolls back
  // EVERYTHING that transaction wrote, this proves rollback correctness --
  // the loser leaves zero trace (no orphan OfferSnapshot, no orphan
  // onboarding Task, no double-WON/double-CUSTOMER state) even though it
  // got past steps 1-4 and into step 5/6 before failing.
  // =========================================================================
  const raceLeadRes = await fetch(`${base}/marketing/leads`, {
    method: 'POST',
    headers: headersFor(wsMktg.id),
    body: JSON.stringify({
      firstName: 'Race',
      lastName: 'Condition',
      emails: [`race-${suffix}@example.com`],
      phones: [],
      pipelineId: pipeline.id,
      stageId: stage.id,
      expectedValue: 3000,
    }),
  });
  const raceLead = await raceLeadRes.json();

  const [raceRes1, raceRes2] = await Promise.all([
    fetch(`${base}/marketing/leads/${raceLead.contact.id}/convert`, {
      method: 'POST',
      headers: headersFor(wsMktg.id),
      body: JSON.stringify({ offerId: activeOffer.id }),
    }),
    fetch(`${base}/marketing/leads/${raceLead.contact.id}/convert`, {
      method: 'POST',
      headers: headersFor(wsMktg.id),
      body: JSON.stringify({ offerId: activeOffer.id }),
    }),
  ]);
  const raceStatuses = [raceRes1.status, raceRes2.status].sort();
  check(
    'Concurrent duplicate conversion: exactly one succeeds, the other is rejected (not silently duplicated)',
    raceStatuses.filter((s) => s < 300).length === 1 &&
      raceStatuses.some((s) => s === 409),
  );

  const raceClientAccounts = await prisma.clientAccount.count({
    where: { primaryContactId: raceLead.contact.id },
  });
  const raceOfferSnapshots = await prisma.offerSnapshot.count({
    where: { clientAccount: { primaryContactId: raceLead.contact.id } },
  });
  check(
    'Rollback: exactly one ClientAccount persisted for the race, no orphan from the loser',
    raceClientAccounts === 1,
  );
  check(
    'Rollback: exactly one OfferSnapshot persisted for the race, no orphan from the loser',
    raceOfferSnapshots === 1,
  );

  // =========================================================================
  // Scenario: immutable snapshot -- editing the canonical Offer after
  // conversion must NOT retroactively change what was already sold.
  // =========================================================================
  const preEditDetailRes = await fetch(
    `${base}/marketing/clients/${soleClientAccount.id}`,
    { headers: headersFor(wsMktg.id) },
  );
  const preEditDetail = await preEditDetailRes.json();
  const originalSnapshotPrice = preEditDetail.offerSnapshot.price;

  const editOfferRes = await fetch(
    `${base}/marketing/offers/${activeOffer.id}`,
    {
      method: 'PUT',
      headers: headersFor(wsMktg.id),
      body: JSON.stringify({ price: 349 }),
    },
  );
  const editedOffer = await editOfferRes.json();
  check(
    'Material edit on an ACTIVE Offer bumps to a new DRAFT version, leaves the old row untouched',
    editOfferRes.status < 300 &&
      editedOffer.id !== activeOffer.id &&
      editedOffer.lifecycleState === 'DRAFT' &&
      editedOffer.version === activeOffer.version + 1,
  );

  const postEditDetailRes = await fetch(
    `${base}/marketing/clients/${soleClientAccount.id}`,
    { headers: headersFor(wsMktg.id) },
  );
  const postEditDetail = await postEditDetailRes.json();
  check(
    "Editing the canonical Offer does not retroactively change the ClientAccount's already-sold snapshot",
    Number(postEditDetail.offerSnapshot.price) ===
      Number(originalSnapshotPrice) &&
      Number(postEditDetail.offerSnapshot.price) !== 349,
  );

  // =========================================================================
  // Scenario: derived current commercial state on the client detail endpoint
  // =========================================================================
  check(
    'Client detail derives current commercial state from ClientCommercialStateChange history',
    postEditDetail.currentCommercialState?.contractState === 'SIGNED_MANUAL' &&
      postEditDetail.currentCommercialState?.paymentState ===
        'DEPOSIT_PAID_MANUAL',
  );

  // =========================================================================
  // Scenario: DOM26-R candidate provenance -- controlled candidates
  // (PENDING, not auto-promoted), evidence chain present, conversion
  // milestone recorded as an ACTIVE engram (system-observed), not a
  // pending candidate.
  // =========================================================================
  const soleProfile = await prisma.relationshipProfile.findFirst({
    where: {
      businessUnitId: buMktg.id,
      subject: { contactId: soleProprietorLead.contact.id },
    },
  });
  const conversionCandidates = await prisma.memoryCandidate.findMany({
    where: { profileId: soleProfile?.id },
    include: { evidence: true },
  });
  check(
    'Conversion facts land as PENDING MemoryCandidates, not auto-promoted',
    conversionCandidates.length > 0 &&
      conversionCandidates.every((c) => c.status === CandidateState.PENDING),
  );
  check(
    'Every conversion-fact candidate carries at least one evidence source',
    conversionCandidates.every((c) => c.evidence.length > 0),
  );

  const conversionEngrams = await prisma.engram.findMany({
    where: { profileId: soleProfile?.id },
  });
  const milestoneEngram = conversionEngrams.find((e) =>
    e.summary.includes('Converted to client'),
  );
  check(
    'The conversion milestone itself is recorded as an ACTIVE, observed Engram (not a pending candidate)',
    !!milestoneEngram &&
      milestoneEngram.state === EngramState.ACTIVE &&
      milestoneEngram.truthClassification === 'OBSERVED',
  );

  // =========================================================================
  // Scenario: Relationship Brief visibility across all three tiers, on the
  // Marketing client's profile.
  // =========================================================================
  const marketingBriefRes = await fetch(`${base}/dom26r/relationship-briefs`, {
    method: 'POST',
    headers: headersFor(wsMktg.id),
    body: JSON.stringify({
      profileId: soleProfile!.id,
      briefText: 'Sole Proprietor converted on the Founder Tier offer.',
      generator: 'test-suite',
      version: 'v1',
      sensitivity: 'PUBLIC',
      engramIds: [milestoneEngram!.id],
    }),
  });
  const marketingBrief = await marketingBriefRes.json();
  check(
    'Marketing Relationship Brief generated for the converted client',
    !!marketingBrief.id,
  );

  const clientDetailWithBriefRes = await fetch(
    `${base}/marketing/clients/${soleClientAccount.id}`,
    { headers: headersFor(wsMktg.id) },
  );
  const clientDetailWithBrief = await clientDetailWithBriefRes.json();
  check(
    'GET /marketing/clients/:id surfaces the most recent brief at INTERNAL_HUMAN tier',
    clientDetailWithBrief.brief?.briefText === marketingBrief.briefText &&
      clientDetailWithBrief.brief?.relationshipStage !== undefined &&
      clientDetailWithBrief.brief?.generator === undefined,
  );

  const internalAgentBriefRes = await fetch(
    `${base}/dom26r/relationship-briefs/${marketingBrief.id}?view=INTERNAL_AGENT`,
    { headers: headersFor(wsMktg.id) },
  );
  const internalAgentBrief = await internalAgentBriefRes.json();
  check(
    'INTERNAL_AGENT view of the Marketing brief exposes full provenance',
    internalAgentBrief.generator === 'test-suite' &&
      internalAgentBrief.evidence?.length === 1,
  );

  const customerBriefRes = await fetch(
    `${base}/dom26r/relationship-briefs/${marketingBrief.id}?view=CUSTOMER_VISIBLE`,
    { headers: headersFor(wsMktg.id) },
  );
  const customerBrief = await customerBriefRes.json();
  check(
    'CUSTOMER_VISIBLE view of the Marketing brief strips everything but briefText',
    customerBrief.briefText === marketingBrief.briefText &&
      customerBrief.generator === undefined &&
      customerBrief.evidence === undefined,
  );

  await app.close();

  console.log('\n🧹 Cleaning up test database records...');
  // Respect RESTRICT FKs: delete the Offer/ClientAccount chain children
  // before their parents, before the Organization can be removed.
  await prisma.memoryAuditEvent.deleteMany({
    where: { businessUnitId: buMktg.id },
  });
  await prisma.briefEvidence.deleteMany({
    where: { brief: { profile: { businessUnitId: buMktg.id } } },
  });
  await prisma.relationshipBrief.deleteMany({
    where: { profile: { businessUnitId: buMktg.id } },
  });
  // EngramSource has no businessUnitId of its own -- collect exactly the
  // source ids THIS test created (via its evidence rows) before deleting
  // those evidence rows, so the final engramSource cleanup is scoped to
  // this run instead of a bare deleteMany({}) that would also delete any
  // other session's or worktree's still-in-use EngramSource rows sharing
  // this local DB.
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
    where: {
      OR: [
        { contact: { workspaceId: wsMktg.id } },
        { company: { workspaceId: wsMktg.id } },
      ],
    },
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
  await prisma.auditLog.deleteMany({
    where: { workspaceId: { in: [wsMktg.id, wsPhoto.id] } },
  });
  await prisma.task.deleteMany({
    where: { workspaceId: { in: [wsMktg.id, wsPhoto.id] } },
  });
  await prisma.opportunity.deleteMany({
    where: { workspaceId: { in: [wsMktg.id, wsPhoto.id] } },
  });
  await prisma.stage.deleteMany({ where: { pipelineId: pipeline.id } });
  await prisma.pipeline.deleteMany({ where: { id: pipeline.id } });
  await prisma.contact.deleteMany({
    where: { workspaceId: { in: [wsMktg.id, wsPhoto.id] } },
  });
  await prisma.company.deleteMany({
    where: { workspaceId: { in: [wsMktg.id, wsPhoto.id] } },
  });
  await prisma.membership.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.workspace.deleteMany({
    where: { id: { in: [wsMktg.id, wsPhoto.id] } },
  });
  await prisma.businessUnit.deleteMany({
    where: { id: { in: [buMktg.id, buPhoto.id] } },
  });
  await prisma.organization.delete({ where: { id: org.id } });
  console.log('✅ Cleanup complete.');

  console.log(
    '=========================================================================',
  );
  console.log(
    `📊 MARKETING LEAD-TO-CLIENT API SUITE: ${pass} passed, ${fail} failed.`,
  );
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
