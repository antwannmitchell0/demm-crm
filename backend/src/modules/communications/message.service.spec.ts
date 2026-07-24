import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma.service';
import { MessageService } from './message.service';
import { ConversationService } from './conversation.service';
import { CommunicationConsentService } from './communication-consent.service';
import { SMS_PROVIDER } from './interfaces/sms-provider.interface';
import { EMAIL_PROVIDER } from './interfaces/email-provider.interface';
import {
  ChannelType,
  ChannelProvider,
  ConsentChannelType,
} from '@prisma/client';

describe('MessageService', () => {
  let service: MessageService;
  let prisma: PrismaService;
  let consent: CommunicationConsentService;
  let workspaceId: string;
  let businessUnitId: string;
  let orgId: string;
  let contactId: string;
  let channelConnectionId: string;
  const fakeSmsProvider = {
    sendSms: jest.fn().mockResolvedValue({ providerMessageId: 'SMfake123' }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        MessageService,
        ConversationService,
        CommunicationConsentService,
        PrismaService,
        { provide: SMS_PROVIDER, useValue: fakeSmsProvider },
        { provide: EMAIL_PROVIDER, useValue: { sendEmail: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(MessageService);
    prisma = moduleRef.get(PrismaService);
    consent = moduleRef.get(CommunicationConsentService);

    const org = await prisma.organization.create({ data: { name: 'Msg Org' } });
    orgId = org.id;
    const bu = await prisma.businessUnit.create({
      data: { name: 'Msg BU', key: 'MSG', organizationId: org.id },
    });
    businessUnitId = bu.id;
    const ws = await prisma.workspace.create({
      data: {
        name: 'Msg WS',
        subdomain: `msg-${Date.now()}`,
        organizationId: org.id,
        businessUnitId: bu.id,
      },
    });
    workspaceId = ws.id;
    const contact = await prisma.contact.create({
      data: {
        firstName: 'M',
        lastName: 'Sg',
        workspaceId: ws.id,
        emails: [],
        phones: ['+15555550199'],
      },
    });
    contactId = contact.id;
    const conn = await prisma.channelConnection.create({
      data: {
        workspaceId: ws.id,
        businessUnitId: bu.id,
        type: ChannelType.SMS,
        provider: ChannelProvider.TWILIO,
      },
    });
    channelConnectionId = conn.id;
  });

  afterAll(async () => {
    await prisma.message.deleteMany({
      where: { conversation: { workspaceId } },
    });
    await prisma.conversation.deleteMany({ where: { workspaceId } });
    await prisma.communicationConsent.deleteMany({ where: { contactId } });
    await prisma.contact.delete({ where: { id: contactId } });
    await prisma.channelConnection.deleteMany({ where: { businessUnitId } });
    await prisma.workspace.delete({ where: { id: workspaceId } });
    await prisma.businessUnit.delete({ where: { id: businessUnitId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  it('sendSms creates a SENT Message with the provider message id when consent allows', async () => {
    const message = await service.sendSms({
      workspaceId,
      businessUnitId,
      channelConnectionId,
      contactId,
      to: '+15555550199',
      from: '+15555550100',
      body: 'Hello from DEMM',
    });
    expect(message.status).toBe('SENT');
    expect(message.providerMessageId).toBe('SMfake123');
    expect(fakeSmsProvider.sendSms).toHaveBeenCalled();
  });

  it('sendSms throws and does NOT call the provider when the contact opted out', async () => {
    await consent.recordOptOut(contactId, ConsentChannelType.SMS, 'STOP');
    fakeSmsProvider.sendSms.mockClear();

    await expect(
      service.sendSms({
        workspaceId,
        businessUnitId,
        channelConnectionId,
        contactId,
        to: '+15555550199',
        from: '+15555550100',
        body: 'Should be blocked',
      }),
    ).rejects.toThrow(/opted out/i);
    expect(fakeSmsProvider.sendSms).not.toHaveBeenCalled();
  });
});
