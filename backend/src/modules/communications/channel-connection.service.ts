import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import {
  ChannelType,
  ChannelProvider,
  ChannelConnectionStatus,
  ChannelConnection,
} from '@prisma/client';

@Injectable()
export class ChannelConnectionService {
  constructor(private prisma: PrismaService) {}

  async getOrCreate(
    businessUnitId: string,
    workspaceId: string,
    type: ChannelType,
    provider: ChannelProvider,
  ): Promise<ChannelConnection> {
    const existing = await this.prisma.channelConnection.findUnique({
      where: {
        businessUnitId_type_provider: { businessUnitId, type, provider },
      },
    });
    if (existing) return existing;

    return this.prisma.channelConnection.create({
      data: { businessUnitId, workspaceId, type, provider },
    });
  }

  async updateStatus(
    id: string,
    status: ChannelConnectionStatus,
  ): Promise<ChannelConnection> {
    return this.prisma.channelConnection.update({
      where: { id },
      data: { status, lastVerifiedAt: new Date() },
    });
  }

  async findActiveForBusinessUnit(
    businessUnitId: string,
    type: ChannelType,
  ): Promise<ChannelConnection | null> {
    return this.prisma.channelConnection.findFirst({
      where: { businessUnitId, type, status: ChannelConnectionStatus.ACTIVE },
    });
  }
}
