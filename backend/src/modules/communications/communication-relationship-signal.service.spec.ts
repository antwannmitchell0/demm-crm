import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma.service';
import { CommunicationRelationshipSignalService } from './communication-relationship-signal.service';
import { SubjectType } from '@prisma/client';

describe('CommunicationRelationshipSignalService', () => {
  let service: CommunicationRelationshipSignalService;
  let prisma: PrismaService;
  let orgId: string;
  let businessUnitId: string;
  let workspaceId: string;
  let contactId: string;
  let profileId: string;
  let contactWithoutProfileId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [CommunicationRelationshipSignalService, PrismaService],
    }).compile();
    service = moduleRef.get(CommunicationRelationshipSignalService);
    prisma = moduleRef.get(PrismaService);

    const org = await prisma.organization.create({
      data: { name: 'Signal Org' },
    });
    orgId = org.id;
    const bu = await prisma.businessUnit.create({
      data: { name: 'Signal BU', key: 'SIGNAL', organizationId: org.id },
    });
    businessUnitId = bu.id;
    const ws = await prisma.workspace.create({
      data: {
        name: 'Signal WS',
        subdomain: `signal-${Date.now()}`,
        organizationId: org.id,
        businessUnitId: bu.id,
      },
    });
    workspaceId = ws.id;

    // Fixture mirrors RelationshipProfileService.getOrCreateProfile's
    // underlying data shape (RelationshipSubject.contactId -> Contact,
    // RelationshipProfile scoped to a businessUnitId) -- the same
    // subject/profile chain billing-relationship-signal.service.ts's
    // findProfileForClient walks, just entered directly via a Contact
    // instead of via a ClientAccount.
    const contact = await prisma.contact.create({
      data: {
        firstName: 'Sig',
        lastName: 'Nal',
        workspaceId: ws.id,
        emails: [],
        phones: [],
      },
    });
    contactId = contact.id;
    const subject = await prisma.relationshipSubject.create({
      data: { type: SubjectType.CONTACT, contactId: contact.id },
    });
    const profile = await prisma.relationshipProfile.create({
      data: { subjectId: subject.id, businessUnitId },
    });
    profileId = profile.id;

    // A second contact with no RelationshipSubject/Profile at all -- the
    // "no profile found" skip path billing's findProfileForClient logs a
    // warning and no-ops for.
    const contactNoProfile = await prisma.contact.create({
      data: {
        firstName: 'No',
        lastName: 'Profile',
        workspaceId: ws.id,
        emails: [],
        phones: [],
      },
    });
    contactWithoutProfileId = contactNoProfile.id;
  });

  afterAll(async () => {
    await prisma.relationshipSignal.deleteMany({ where: { profileId } });
    await prisma.relationshipProfile.deleteMany({ where: { businessUnitId } });
    await prisma.relationshipSubject.deleteMany({ where: { contactId } });
    await prisma.contact.deleteMany({ where: { workspaceId } });
    await prisma.workspace.delete({ where: { id: workspaceId } });
    await prisma.businessUnit.delete({ where: { id: businessUnitId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  it('createSignal then hasActiveSignal returns true for that type', async () => {
    await service.createSignal(
      contactId,
      businessUnitId,
      'MISSED_CALL_DETECTED',
      'Missed call from +15555550100 (NO_ANSWER).',
    );

    expect(
      await service.hasActiveSignal(contactId, businessUnitId, [
        'MISSED_CALL_DETECTED',
      ]),
    ).toBe(true);

    const row = await prisma.relationshipSignal.findFirst({
      where: { profileId, type: 'MISSED_CALL_DETECTED' },
    });
    expect(row?.state).toBe('ACTIVE');
  });

  it('resolveSignals resolves the active signal and hasActiveSignal returns false', async () => {
    await service.resolveSignals(contactId, businessUnitId, [
      'MISSED_CALL_DETECTED',
    ]);

    expect(
      await service.hasActiveSignal(contactId, businessUnitId, [
        'MISSED_CALL_DETECTED',
      ]),
    ).toBe(false);
  });

  it('createSignal for a self-resolving type creates an already-RESOLVED row', async () => {
    await service.createSignal(
      contactId,
      businessUnitId,
      'MISSED_CALL_TEXTBACK_SENT',
      'Missed-call text-back sent to +15555550100.',
    );

    expect(
      await service.hasActiveSignal(contactId, businessUnitId, [
        'MISSED_CALL_TEXTBACK_SENT',
      ]),
    ).toBe(false);
    const row = await prisma.relationshipSignal.findFirst({
      where: { profileId, type: 'MISSED_CALL_TEXTBACK_SENT' },
    });
    expect(row?.state).toBe('RESOLVED');
    expect(row?.resolvedAt).not.toBeNull();
  });

  it('createSignal is a no-op (does not throw) when the contact has no RelationshipProfile', async () => {
    await expect(
      service.createSignal(
        contactWithoutProfileId,
        businessUnitId,
        'CONSENT_STOP',
        'Contact opted out of SMS communications (STOP).',
      ),
    ).resolves.toBeUndefined();

    expect(
      await service.hasActiveSignal(contactWithoutProfileId, businessUnitId, [
        'CONSENT_STOP',
      ]),
    ).toBe(false);
  });

  it('createSignal is a no-op when a profile exists for the subject but scoped to a different businessUnitId', async () => {
    const otherBu = await prisma.businessUnit.create({
      data: { name: 'Other BU', key: 'OTHERBU', organizationId: orgId },
    });
    try {
      await expect(
        service.createSignal(
          contactId,
          otherBu.id,
          'CONSENT_STOP',
          'Should not attach to the wrong business unit profile.',
        ),
      ).resolves.toBeUndefined();

      expect(
        await service.hasActiveSignal(contactId, otherBu.id, ['CONSENT_STOP']),
      ).toBe(false);

      // The original businessUnitId's profile must remain untouched too.
      const crossBuLeak = await prisma.relationshipSignal.findFirst({
        where: { profileId, type: 'CONSENT_STOP' },
      });
      expect(crossBuLeak).toBeNull();
    } finally {
      await prisma.businessUnit.delete({ where: { id: otherBu.id } });
    }
  });
});
