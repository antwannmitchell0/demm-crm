import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma.service';
import { CommunicationConsentService } from './communication-consent.service';
import { ConsentChannelType } from '@prisma/client';

describe('CommunicationConsentService', () => {
  let service: CommunicationConsentService;
  let prisma: PrismaService;
  let contactId: string;
  let workspaceId: string;
  let orgId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [CommunicationConsentService, PrismaService],
    }).compile();
    service = moduleRef.get(CommunicationConsentService);
    prisma = moduleRef.get(PrismaService);

    const org = await prisma.organization.create({
      data: { name: 'Consent Org' },
    });
    orgId = org.id;
    const ws = await prisma.workspace.create({
      data: {
        name: 'Consent WS',
        subdomain: `consent-${Date.now()}`,
        organizationId: org.id,
      },
    });
    workspaceId = ws.id;
    const contact = await prisma.contact.create({
      data: {
        firstName: 'Con',
        lastName: 'Sent',
        workspaceId: ws.id,
        emails: [],
        phones: [],
      },
    });
    contactId = contact.id;
  });

  afterAll(async () => {
    await prisma.communicationConsent.deleteMany({ where: { contactId } });
    await prisma.contact.delete({ where: { id: contactId } });
    await prisma.workspace.delete({ where: { id: workspaceId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  it('is not opted out by default', async () => {
    expect(await service.isOptedOut(contactId, ConsentChannelType.SMS)).toBe(
      false,
    );
  });

  it('recordOptOut then isOptedOut returns true, recordOptIn reverses it', async () => {
    await service.recordOptOut(contactId, ConsentChannelType.SMS, 'STOP');
    expect(await service.isOptedOut(contactId, ConsentChannelType.SMS)).toBe(
      true,
    );

    await service.recordOptIn(contactId, ConsentChannelType.SMS, 'START');
    expect(await service.isOptedOut(contactId, ConsentChannelType.SMS)).toBe(
      false,
    );
  });

  it('parseSmsKeyword recognizes the standard TCPA keyword set case-insensitively', () => {
    expect(service.parseSmsKeyword('stop')).toBe('STOP');
    expect(service.parseSmsKeyword('STOPALL')).toBe('STOP');
    expect(service.parseSmsKeyword('Unsubscribe')).toBe('STOP');
    expect(service.parseSmsKeyword('start')).toBe('START');
    expect(service.parseSmsKeyword('unstop')).toBe('START');
    expect(service.parseSmsKeyword('help')).toBe('HELP');
    expect(service.parseSmsKeyword('hello there')).toBeNull();
  });
});
