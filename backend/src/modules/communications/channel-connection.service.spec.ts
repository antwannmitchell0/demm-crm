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

  // Fixture IDs scoped to this describe block
  let orgId: string;
  let buId: string;
  let wsId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [ChannelConnectionService, PrismaService],
    }).compile();
    service = moduleRef.get(ChannelConnectionService);
    prisma = moduleRef.get(PrismaService);

    // Create fixtures once, before any tests run
    const org = await prisma.organization.create({ data: { name: 'CCT Org' } });
    orgId = org.id;

    const bu = await prisma.businessUnit.create({
      data: { name: 'CCT BU', key: 'CCT', organizationId: orgId },
    });
    buId = bu.id;

    const ws = await prisma.workspace.create({
      data: {
        name: 'CCT WS',
        subdomain: `cct-${Date.now()}`,
        organizationId: orgId,
        businessUnitId: buId,
      },
    });
    wsId = ws.id;
  });

  afterAll(async () => {
    // Always cleanup, regardless of test pass/fail
    await prisma.channelConnection.deleteMany({
      where: { businessUnitId: buId },
    });
    await prisma.workspace.delete({ where: { id: wsId } });
    await prisma.businessUnit.delete({ where: { id: buId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  it('getOrCreate is idempotent -- second call returns the same row, NOT_CONFIGURED by default', async () => {
    const first = await service.getOrCreate(
      buId,
      wsId,
      ChannelType.SMS,
      ChannelProvider.TWILIO,
    );
    const second = await service.getOrCreate(
      buId,
      wsId,
      ChannelType.SMS,
      ChannelProvider.TWILIO,
    );

    expect(first.id).toBe(second.id);
    expect(first.status).toBe(ChannelConnectionStatus.NOT_CONFIGURED);
  });
});
