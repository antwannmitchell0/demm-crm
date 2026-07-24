import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma.service';
import { ConversationService } from './conversation.service';
import {
  ChannelType,
  ChannelProvider,
  ConversationChannel,
} from '@prisma/client';

describe('ConversationService', () => {
  let service: ConversationService;
  let prisma: PrismaService;
  let workspaceId: string;
  let businessUnitId: string;
  let orgId: string;
  let channelConnectionId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [ConversationService, PrismaService],
    }).compile();
    service = moduleRef.get(ConversationService);
    prisma = moduleRef.get(PrismaService);

    const org = await prisma.organization.create({
      data: { name: 'Conv Org' },
    });
    orgId = org.id;
    const bu = await prisma.businessUnit.create({
      data: { name: 'Conv BU', key: 'CONV', organizationId: org.id },
    });
    businessUnitId = bu.id;
    const ws = await prisma.workspace.create({
      data: {
        name: 'Conv WS',
        subdomain: `conv-${Date.now()}`,
        organizationId: org.id,
        businessUnitId: bu.id,
      },
    });
    workspaceId = ws.id;
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
    await prisma.conversation.deleteMany({ where: { workspaceId } });
    await prisma.channelConnection.deleteMany({ where: { businessUnitId } });
    await prisma.workspace.delete({ where: { id: workspaceId } });
    await prisma.businessUnit.delete({ where: { id: businessUnitId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  it('findOrCreate is idempotent per (channelConnection, counterpartyAddress)', async () => {
    const first = await service.findOrCreate({
      workspaceId,
      businessUnitId,
      channelConnectionId,
      channel: ConversationChannel.SMS,
      counterpartyAddress: '+15555550100',
    });
    const second = await service.findOrCreate({
      workspaceId,
      businessUnitId,
      channelConnectionId,
      channel: ConversationChannel.SMS,
      counterpartyAddress: '+15555550100',
    });
    expect(first.id).toBe(second.id);
  });

  it('EMAIL conversations get a unique replyToken resolvable via findByReplyToken', async () => {
    const emailConn = await prisma.channelConnection.create({
      data: { workspaceId, businessUnitId, type: 'EMAIL', provider: 'RESEND' },
    });
    const convo = await service.findOrCreate({
      workspaceId,
      businessUnitId,
      channelConnectionId: emailConn.id,
      channel: ConversationChannel.EMAIL,
      counterpartyAddress: 'lead@example.com',
    });
    expect(convo.replyToken).toBeTruthy();

    const resolved = await service.findByReplyToken(convo.replyToken as string);
    expect(resolved?.id).toBe(convo.id);
  });
});
