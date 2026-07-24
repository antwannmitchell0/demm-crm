import { Injectable, Inject, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { ConversationService } from './conversation.service';
import { CommunicationConsentService } from './communication-consent.service';
import {
  SMS_PROVIDER,
  type SmsProvider,
} from './interfaces/sms-provider.interface';
import {
  EMAIL_PROVIDER,
  type EmailProvider,
} from './interfaces/email-provider.interface';
import { Message, ConsentChannelType } from '@prisma/client';

@Injectable()
export class MessageService {
  constructor(
    private prisma: PrismaService,
    private conversations: ConversationService,
    private consent: CommunicationConsentService,
    @Inject(SMS_PROVIDER) private smsProvider: SmsProvider,
    @Inject(EMAIL_PROVIDER) private emailProvider: EmailProvider,
  ) {}

  async sendSms(params: {
    workspaceId: string;
    businessUnitId: string;
    channelConnectionId: string;
    contactId?: string;
    to: string;
    from: string;
    body: string;
    sentByUserId?: string;
    templateId?: string;
  }): Promise<Message> {
    if (params.contactId) {
      const optedOut = await this.consent.isOptedOut(
        params.contactId,
        ConsentChannelType.SMS,
      );
      if (optedOut) {
        throw new ForbiddenException(
          'Contact has opted out of SMS -- message not sent.',
        );
      }
    }

    const conversation = await this.conversations.findOrCreate({
      workspaceId: params.workspaceId,
      businessUnitId: params.businessUnitId,
      channelConnectionId: params.channelConnectionId,
      channel: 'SMS',
      counterpartyAddress: params.to,
      contactId: params.contactId,
    });

    const { providerMessageId } = await this.smsProvider.sendSms({
      to: params.to,
      from: params.from,
      body: params.body,
      statusCallbackUrl: process.env.BACKEND_PUBLIC_URL
        ? `${process.env.BACKEND_PUBLIC_URL}/webhooks/twilio/sms-status`
        : undefined,
    });

    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        status: 'SENT',
        body: params.body,
        providerMessageId,
        sentByUserId: params.sentByUserId,
        templateId: params.templateId,
      },
    });

    await this.conversations.touchLastMessageAt(
      conversation.id,
      message.createdAt,
    );
    return message;
  }

  async sendEmail(params: {
    workspaceId: string;
    businessUnitId: string;
    channelConnectionId: string;
    contactId?: string;
    to: string;
    from: string;
    replyTo?: string;
    subject: string;
    html: string;
    sentByUserId?: string;
    templateId?: string;
  }): Promise<Message> {
    if (params.contactId) {
      const optedOut = await this.consent.isOptedOut(
        params.contactId,
        ConsentChannelType.EMAIL,
      );
      if (optedOut) {
        throw new ForbiddenException(
          'Contact has opted out of email -- message not sent.',
        );
      }
    }

    const conversation = await this.conversations.findOrCreate({
      workspaceId: params.workspaceId,
      businessUnitId: params.businessUnitId,
      channelConnectionId: params.channelConnectionId,
      channel: 'EMAIL',
      counterpartyAddress: params.to,
      contactId: params.contactId,
    });

    const { providerMessageId } = await this.emailProvider.sendEmail({
      to: params.to,
      from: params.from,
      replyTo: params.replyTo,
      subject: params.subject,
      html: params.html,
    });

    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        status: 'SENT',
        body: params.html,
        providerMessageId,
        sentByUserId: params.sentByUserId,
        templateId: params.templateId,
      },
    });

    await this.conversations.touchLastMessageAt(
      conversation.id,
      message.createdAt,
    );
    return message;
  }

  async recordInboundSms(params: {
    conversationId: string;
    providerMessageId: string;
    body: string;
  }): Promise<Message | null> {
    const existing = await this.prisma.message.findUnique({
      where: { providerMessageId: params.providerMessageId },
    });
    if (existing) return null; // duplicate webhook delivery -- idempotent no-op

    const message = await this.prisma.message.create({
      data: {
        conversationId: params.conversationId,
        direction: 'INBOUND',
        status: 'RECEIVED',
        body: params.body,
        providerMessageId: params.providerMessageId,
      },
    });
    await this.conversations.touchLastMessageAt(
      params.conversationId,
      message.createdAt,
    );
    return message;
  }

  async recordInboundEmail(params: {
    conversationId: string;
    providerMessageId: string;
    html: string | null;
  }): Promise<Message | null> {
    const existing = await this.prisma.message.findUnique({
      where: { providerMessageId: params.providerMessageId },
    });
    if (existing) return null;

    const message = await this.prisma.message.create({
      data: {
        conversationId: params.conversationId,
        direction: 'INBOUND',
        status: 'RECEIVED',
        body: params.html,
        providerMessageId: params.providerMessageId,
      },
    });
    await this.conversations.touchLastMessageAt(
      params.conversationId,
      message.createdAt,
    );
    return message;
  }
}
