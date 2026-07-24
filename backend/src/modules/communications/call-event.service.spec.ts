import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma.service';
import { CallEventService } from './call-event.service';
import { MessageService } from './message.service';
import { ConversationService } from './conversation.service';
import { CommunicationConsentService } from './communication-consent.service';
import { CommunicationRelationshipSignalService } from './communication-relationship-signal.service';
import { SMS_PROVIDER } from './interfaces/sms-provider.interface';
import { EMAIL_PROVIDER } from './interfaces/email-provider.interface';
import {
  ChannelType,
  ChannelProvider,
  ConsentChannelType,
} from '@prisma/client';

describe('CallEventService', () => {
  let service: CallEventService;
  let prisma: PrismaService;
  let consent: CommunicationConsentService;
  let workspaceId: string;
  let businessUnitId: string;
  let orgId: string;
  let channelConnectionId: string;
  const fakeSmsProvider = {
    sendSms: jest.fn().mockResolvedValue({ providerMessageId: 'SMtextback' }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CallEventService,
        MessageService,
        ConversationService,
        CommunicationConsentService,
        CommunicationRelationshipSignalService,
        PrismaService,
        { provide: SMS_PROVIDER, useValue: fakeSmsProvider },
        { provide: EMAIL_PROVIDER, useValue: { sendEmail: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(CallEventService);
    prisma = moduleRef.get(PrismaService);
    consent = moduleRef.get(CommunicationConsentService);

    const org = await prisma.organization.create({
      data: { name: 'Call Org' },
    });
    orgId = org.id;
    const bu = await prisma.businessUnit.create({
      data: { name: 'Call BU', key: 'CALL', organizationId: org.id },
    });
    businessUnitId = bu.id;
    const ws = await prisma.workspace.create({
      data: {
        name: 'Call WS',
        subdomain: `call-${Date.now()}`,
        organizationId: org.id,
        businessUnitId: bu.id,
      },
    });
    workspaceId = ws.id;
    const conn = await prisma.channelConnection.create({
      data: {
        workspaceId: ws.id,
        businessUnitId: bu.id,
        type: ChannelType.VOICE,
        provider: ChannelProvider.TWILIO,
        externalAddress: '+15555550100',
      },
    });
    channelConnectionId = conn.id;
    await prisma.channelConnection.update({
      where: { id: conn.id },
      data: { status: 'ACTIVE' },
    });
    // Also create the matching SMS connection the text-back send uses.
    await prisma.channelConnection.create({
      data: {
        workspaceId: ws.id,
        businessUnitId: bu.id,
        type: ChannelType.SMS,
        provider: ChannelProvider.TWILIO,
        externalAddress: '+15555550100',
        status: 'ACTIVE',
      },
    });
    await prisma.messageTemplate.create({
      data: {
        workspaceId: ws.id,
        businessUnitId: bu.id,
        channel: 'SMS',
        name: 'missed-call-textback',
        body: 'Sorry we missed your call! How can we help?',
      },
    });
  });

  afterAll(async () => {
    await prisma.message.deleteMany({
      where: { conversation: { workspaceId } },
    });
    await prisma.conversation.deleteMany({ where: { workspaceId } });
    await prisma.callEvent.deleteMany({ where: { workspaceId } });
    await prisma.messageTemplate.deleteMany({ where: { workspaceId } });
    await prisma.channelConnection.deleteMany({ where: { businessUnitId } });
    await prisma.workspace.delete({ where: { id: workspaceId } });
    await prisma.businessUnit.delete({ where: { id: businessUnitId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  it('a non-terminal status (ringing) does not set outcome or trigger text-back', async () => {
    await service.recordStatusCallback(
      {
        providerCallId: 'CAringing1',
        from: '+15555559999',
        to: '+15555550100',
        callStatus: 'ringing',
        timestamp: new Date(),
      },
      channelConnectionId,
    );
    const event = await prisma.callEvent.findUnique({
      where: { providerCallId: 'CAringing1' },
    });
    expect(event?.outcome).toBeNull();
    expect(fakeSmsProvider.sendSms).not.toHaveBeenCalled();
  });

  it('a terminal no-answer status sets outcome and fires exactly one text-back', async () => {
    await service.recordStatusCallback(
      {
        providerCallId: 'CAnoanswer1',
        from: '+15555558888',
        to: '+15555550100',
        callStatus: 'no-answer',
        timestamp: new Date(),
      },
      channelConnectionId,
    );
    const event = await prisma.callEvent.findUnique({
      where: { providerCallId: 'CAnoanswer1' },
    });
    expect(event?.outcome).toBe('NO_ANSWER');
    expect(event?.textBackSent).toBe(true);
    expect(fakeSmsProvider.sendSms).toHaveBeenCalledTimes(1);
  });

  it('a second missed call from the same number within the cooldown window does NOT re-fire text-back', async () => {
    fakeSmsProvider.sendSms.mockClear();
    await service.recordStatusCallback(
      {
        providerCallId: 'CAnoanswer2',
        from: '+15555558888',
        to: '+15555550100',
        callStatus: 'busy',
        timestamp: new Date(),
      },
      channelConnectionId,
    );
    expect(fakeSmsProvider.sendSms).not.toHaveBeenCalled();
    const event = await prisma.callEvent.findUnique({
      where: { providerCallId: 'CAnoanswer2' },
    });
    expect(event?.outcome).toBe('BUSY');
    expect(event?.textBackSent).toBe(false);
  });

  it('FAILED outcome never triggers a text-back', async () => {
    fakeSmsProvider.sendSms.mockClear();
    await service.recordStatusCallback(
      {
        providerCallId: 'CAfailed1',
        from: '+15555557777',
        to: '+15555550100',
        callStatus: 'failed',
        timestamp: new Date(),
      },
      channelConnectionId,
    );
    expect(fakeSmsProvider.sendSms).not.toHaveBeenCalled();
  });

  it('an out-of-order stale terminal callback does not revert a fresher outcome', async () => {
    const laterCallback = {
      providerCallId: 'CAordering1',
      from: '+15555556666',
      to: '+15555550100',
      callStatus: 'completed',
      timestamp: new Date(Date.now() + 10_000),
    };
    const earlierCallback = {
      providerCallId: 'CAordering1',
      from: '+15555556666',
      to: '+15555550100',
      callStatus: 'no-answer',
      timestamp: new Date(),
    };

    await service.recordStatusCallback(laterCallback, channelConnectionId);
    await service.recordStatusCallback(earlierCallback, channelConnectionId);

    const event = await prisma.callEvent.findUnique({
      where: { providerCallId: 'CAordering1' },
    });
    expect(event?.outcome).toBe('ANSWERED'); // completed with duration implies answered; the stale no-answer must not overwrite it
  });

  it('a missed call from a contact who has opted out of SMS resolves without throwing and does not send', async () => {
    fakeSmsProvider.sendSms.mockClear();
    const optedOutContact = await prisma.contact.create({
      data: {
        firstName: 'Opted',
        lastName: 'Out',
        emails: [],
        phones: ['+15555555555'],
        workspaceId,
      },
    });
    await consent.recordOptOut(
      optedOutContact.id,
      ConsentChannelType.SMS,
      'test opt-out',
    );

    await expect(
      service.recordStatusCallback(
        {
          providerCallId: 'CAoptedout1',
          from: '+15555555555',
          to: '+15555550100',
          callStatus: 'no-answer',
          timestamp: new Date(),
        },
        channelConnectionId,
      ),
    ).resolves.toBeUndefined();

    expect(fakeSmsProvider.sendSms).not.toHaveBeenCalled();
    const event = await prisma.callEvent.findUnique({
      where: { providerCallId: 'CAoptedout1' },
    });
    expect(event?.outcome).toBe('NO_ANSWER');
    expect(event?.textBackSent).toBe(true);
  });
});
