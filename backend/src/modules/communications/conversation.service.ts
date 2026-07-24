import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma.service';
import { Conversation, ConversationChannel } from '@prisma/client';

@Injectable()
export class ConversationService {
  constructor(private prisma: PrismaService) {}

  async findOrCreate(params: {
    workspaceId: string;
    businessUnitId: string;
    channelConnectionId: string;
    channel: ConversationChannel;
    counterpartyAddress: string;
    contactId?: string;
    clientAccountId?: string;
  }): Promise<Conversation> {
    const existing = await this.prisma.conversation.findUnique({
      where: {
        channelConnectionId_counterpartyAddress: {
          channelConnectionId: params.channelConnectionId,
          counterpartyAddress: params.counterpartyAddress,
        },
      },
    });
    if (existing) return existing;

    const replyToken =
      params.channel === ConversationChannel.EMAIL
        ? randomBytes(16).toString('hex')
        : null;

    return this.prisma.conversation.create({
      data: {
        workspaceId: params.workspaceId,
        businessUnitId: params.businessUnitId,
        channelConnectionId: params.channelConnectionId,
        channel: params.channel,
        counterpartyAddress: params.counterpartyAddress,
        contactId: params.contactId,
        clientAccountId: params.clientAccountId,
        replyToken,
      },
    });
  }

  async findByReplyToken(token: string): Promise<Conversation | null> {
    return this.prisma.conversation.findUnique({
      where: { replyToken: token },
    });
  }

  async touchLastMessageAt(conversationId: string, at: Date): Promise<void> {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: at },
    });
  }
}
