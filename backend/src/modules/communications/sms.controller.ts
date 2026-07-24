import {
  Controller,
  Post,
  Body,
  Param,
  Headers,
  Req,
  Inject,
  UseGuards,
  HttpCode,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request } from 'express';
import { MessageService } from './message.service';
import { ChannelConnectionService } from './channel-connection.service';
import { CommunicationConsentService } from './communication-consent.service';
import { ConversationService } from './conversation.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { BusinessUnitGuard } from '../../common/guards/business-unit.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentWorkspaceId } from '../../common/decorators/current-workspace.decorator';
import { CurrentBusinessUnitId } from '../../common/decorators/current-business-unit.decorator';
import { SMS_PROVIDER, type SmsProvider } from './interfaces/sms-provider.interface';
import { PrismaService } from '../../prisma.service';
import {
  ChannelType,
  ConsentChannelType,
  DeliveryAttemptOutcome,
  MessageStatus,
} from '@prisma/client';
import { SendSmsDto } from './dto/send-sms.dto';

// Twilio's own terminal MessageStatus values mapped to our
// DeliveryAttemptOutcome enum. Non-terminal statuses (queued/sending/
// accepted) are intentionally absent -- the status callback handler below
// no-ops on anything not in this map rather than recording a premature
// outcome.
const TWILIO_STATUS_TO_OUTCOME: Record<string, DeliveryAttemptOutcome> = {
  delivered: DeliveryAttemptOutcome.SUCCEEDED,
  sent: DeliveryAttemptOutcome.SUCCEEDED,
  failed: DeliveryAttemptOutcome.FAILED,
  undelivered: DeliveryAttemptOutcome.UNDELIVERED,
};

const OUTCOME_TO_MESSAGE_STATUS: Partial<
  Record<DeliveryAttemptOutcome, MessageStatus>
> = {
  [DeliveryAttemptOutcome.SUCCEEDED]: MessageStatus.DELIVERED,
  [DeliveryAttemptOutcome.FAILED]: MessageStatus.FAILED,
  [DeliveryAttemptOutcome.UNDELIVERED]: MessageStatus.UNDELIVERED,
};

@Controller('marketing/clients/:id/communications')
@UseGuards(JwtAuthGuard, WorkspaceGuard, BusinessUnitGuard)
export class SmsOutboundController {
  constructor(
    private messages: MessageService,
    private channels: ChannelConnectionService,
    private prisma: PrismaService,
  ) {}

  @Post('sms')
  async sendSms(
    @Param('id') clientAccountId: string,
    @Body() dto: SendSmsDto,
    @CurrentWorkspaceId() workspaceId: string,
    @CurrentBusinessUnitId() businessUnitId: string,
    @CurrentUser() user: any,
  ) {
    // Scoped to the caller's Business Unit, same pattern as
    // ClientHealthService.getHealth / ClientAccountController -- a client
    // account id alone is never trusted across Business Unit boundaries.
    const clientAccount = await this.prisma.clientAccount.findFirst({
      where: { id: clientAccountId, businessUnitId },
      include: { primaryContact: true },
    });
    if (!clientAccount) {
      throw new NotFoundException('Client account not found in this Business Unit');
    }

    const connection = await this.channels.findActiveForBusinessUnit(
      businessUnitId,
      ChannelType.SMS,
    );
    if (!connection?.externalAddress) {
      throw new ServiceUnavailableException(
        'SMS channel is not connected for this Business Unit yet.',
      );
    }

    const toNumber = clientAccount.primaryContact.phones[0];
    if (!toNumber) {
      throw new BadRequestException(
        'This client has no phone number on file to send SMS to.',
      );
    }

    return this.messages.sendSms({
      workspaceId,
      businessUnitId,
      channelConnectionId: connection.id,
      contactId: clientAccount.primaryContactId,
      to: toNumber,
      from: connection.externalAddress,
      body: dto.body,
      sentByUserId: user.id,
    });
  }
}

@Controller('webhooks/twilio')
export class TwilioSmsWebhookController {
  constructor(
    private messages: MessageService,
    private consent: CommunicationConsentService,
    private conversations: ConversationService,
    private prisma: PrismaService,
    @Inject(SMS_PROVIDER) private smsProvider: SmsProvider,
  ) {}

  // NOTE: because of Task 4.5's raw-body middleware mounted on
  // /webhooks/twilio, `req.body` here is a Buffer, NOT a parsed object --
  // do not add a `@Body()` DTO decorator to any method in this controller.
  // Parse the form body yourself, AFTER signature verification has run
  // against the untouched raw bytes.
  @Post('sms')
  @HttpCode(200)
  async handleInboundSms(
    @Headers('x-twilio-signature') signature: string,
    @Req() req: Request,
  ) {
    const rawFormBody = (req.body as Buffer).toString('utf-8');
    const url = `${process.env.BACKEND_PUBLIC_URL ?? ''}${req.originalUrl}`;
    if (
      !this.smsProvider.verifyInboundWebhookSignature(rawFormBody, signature, url)
    ) {
      throw new UnauthorizedException('Invalid Twilio signature');
    }

    const parsedForm = Object.fromEntries(new URLSearchParams(rawFormBody));
    const payload = this.smsProvider.parseInboundSms(parsedForm);

    const connection = await this.prisma.channelConnection.findFirst({
      where: { externalAddress: payload.to, type: ChannelType.SMS },
    });
    if (!connection) {
      throw new UnauthorizedException('Unknown destination number');
    }

    const contact = await this.prisma.contact.findFirst({
      where: { workspaceId: connection.workspaceId, phones: { has: payload.from } },
    });

    // Reuse the same threading logic outbound sends go through (Task 7) --
    // duplicating the upsert here would risk drifting from
    // ConversationService's replyToken/contactId semantics.
    const conversation = await this.conversations.findOrCreate({
      workspaceId: connection.workspaceId,
      businessUnitId: connection.businessUnitId,
      channelConnectionId: connection.id,
      channel: 'SMS',
      counterpartyAddress: payload.from,
      contactId: contact?.id,
    });

    await this.messages.recordInboundSms({
      conversationId: conversation.id,
      providerMessageId: payload.providerMessageId,
      body: payload.body,
    });

    if (contact) {
      const keyword = this.consent.parseSmsKeyword(payload.body);
      if (keyword === 'STOP') {
        await this.consent.recordOptOut(contact.id, ConsentChannelType.SMS, 'STOP');
      } else if (keyword === 'START') {
        await this.consent.recordOptIn(contact.id, ConsentChannelType.SMS, 'START');
      }
    }

    return { received: true };
  }

  // Twilio's outbound SMS status callback (registered as the
  // StatusCallback URL on every message.create call, see
  // MessageService.sendSms) -- delivered/failed/undelivered. Appended as a
  // new DeliveryAttempt row per callback rather than mutating a single
  // field, so redelivery/reordering never needs a special guard
  // (append-only is inherently safe here, unlike CallEvent.outcome which
  // needs one -- see Task 11/12).
  @Post('sms-status')
  @HttpCode(200)
  async handleSmsStatus(
    @Headers('x-twilio-signature') signature: string,
    @Req() req: Request,
  ) {
    const rawFormBody = (req.body as Buffer).toString('utf-8');
    const url = `${process.env.BACKEND_PUBLIC_URL ?? ''}${req.originalUrl}`;
    if (
      !this.smsProvider.verifyInboundWebhookSignature(rawFormBody, signature, url)
    ) {
      throw new UnauthorizedException('Invalid Twilio signature');
    }

    const parsedForm = Object.fromEntries(new URLSearchParams(rawFormBody));
    const providerMessageId = parsedForm.MessageSid;

    const message = await this.prisma.message.findUnique({
      where: { providerMessageId },
    });
    if (!message) {
      // Status for a message we don't track (e.g. pre-integration) -- ack,
      // no-op. Never surfaced as an error to Twilio.
      return { received: true };
    }

    const status = parsedForm.MessageStatus;
    const outcome = TWILIO_STATUS_TO_OUTCOME[status];
    if (!outcome) {
      // queued/sending/accepted -- not terminal, nothing to record yet.
      return { received: true };
    }

    await this.prisma.deliveryAttempt.create({
      data: {
        messageId: message.id,
        outcome,
        providerCode: parsedForm.ErrorCode || null,
        providerRaw: parsedForm,
        occurredAt: new Date(),
      },
    });

    const nextStatus = OUTCOME_TO_MESSAGE_STATUS[outcome];
    if (nextStatus) {
      await this.prisma.message.update({
        where: { id: message.id },
        data: { status: nextStatus },
      });
    }

    return { received: true };
  }
}
