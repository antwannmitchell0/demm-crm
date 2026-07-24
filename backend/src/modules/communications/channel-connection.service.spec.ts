import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma.service';
import { ChannelConnectionService } from './channel-connection.service';
import {
  ChannelType,
  ChannelProvider,
  ChannelConnectionStatus,
} from '@prisma/client';

describe('ChannelConnectionService', () => {
  let service: ChannelConnectionService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [ChannelConnectionService, PrismaService],
    }).compile();
    service = moduleRef.get(ChannelConnectionService);
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('getOrCreate is idempotent -- second call returns the same row, NOT_CONFIGURED by default', async () => {
    const org = await prisma.organization.create({ data: { name: 'CCT Org' } });
    const bu = await prisma.businessUnit.create({
      data: { name: 'CCT BU', key: 'CCT', organizationId: org.id },
    });
    const ws = await prisma.workspace.create({
      data: {
        name: 'CCT WS',
        subdomain: `cct-${Date.now()}`,
        organizationId: org.id,
        businessUnitId: bu.id,
      },
    });

    const first = await service.getOrCreate(
      bu.id,
      ws.id,
      ChannelType.SMS,
      ChannelProvider.TWILIO,
    );
    const second = await service.getOrCreate(
      bu.id,
      ws.id,
      ChannelType.SMS,
      ChannelProvider.TWILIO,
    );

    expect(first.id).toBe(second.id);
    expect(first.status).toBe(ChannelConnectionStatus.NOT_CONFIGURED);

    await prisma.channelConnection.deleteMany({
      where: { businessUnitId: bu.id },
    });
    await prisma.workspace.delete({ where: { id: ws.id } });
    await prisma.businessUnit.delete({ where: { id: bu.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  });
});
