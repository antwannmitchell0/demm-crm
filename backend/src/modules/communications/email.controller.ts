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
  UnauthorizedException,
  NotFoundException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import { MessageService } from './message.service';
import { ChannelConnectionService } from './channel-connection.service';
import { ConversationService } from './conversation.service';
import { CommunicationConsentService } from './communication-consent.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { BusinessUnitGuard } from '../../common/guards/business-unit.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentBusinessUnitId } from '../../common/decorators/current-business-unit.decorator';
import {
  EMAIL_PROVIDER,
  type EmailProvider,
} from './interfaces/email-provider.interface';
import {
  INBOUND_EMAIL_PROVIDER,
  type InboundEmailProvider,
} from './interfaces/inbound-email-provider.interface';
import {
  DELIVERY_STATUS_PROVIDER,
  type DeliveryStatusProvider,
} from './interfaces/delivery-status-provider.interface';
import { PrismaService } from '../../prisma.service';
import { ChannelType, ConsentChannelType } from '@prisma/client';
import { SendEmailDto } from './dto/send-email.dto';

@Controller('marketing/clients/:id/communications')
@UseGuards(JwtAuthGuard, WorkspaceGuard, BusinessUnitGuard)
export class EmailOutboundController {
  constructor(
    private messages: MessageService,
    private channels: ChannelConnectionService,
    private conversations: ConversationService,
    private prisma: PrismaService,
  ) {}

  // clientAccountId is client-supplied (route param). Scope the lookup to
  // the guard-verified businessUnitId (from @CurrentBusinessUnitId(),
  // sourced from BusinessUnitGuard's DB-verified workspace lookup, never
  // from client input) -- an unscoped findUnique-by-id-alone here is a
  // cross-Business-Unit IDOR: an authenticated user from BU A could supply
  // BU B's clientAccountId and send email as/to BU B's client. Same bug
  // class found and fixed in Task 10's SMS controller (see
  // sms.controller.ts) -- identical @CurrentBusinessUnitId() + findFirst
  // pattern applied here.
  @Post('email')
  async sendEmail(
    @Param('id') clientAccountId: string,
    @Body() body: SendEmailDto,
    @CurrentUser() user: { id: string },
    @CurrentBusinessUnitId() businessUnitId: string,
  ) {
    const clientAccount = await this.prisma.clientAccount.findFirst({
      where: { id: clientAccountId, businessUnitId },
      include: { primaryContact: true },
    });
    if (!clientAccount) {
      throw new NotFoundException(
        'Client account not found in this Business Unit',
      );
    }

    const connection = await this.channels.findActiveForBusinessUnit(
      clientAccount.businessUnitId,
      ChannelType.EMAIL,
    );
    if (!connection?.externalAddress) {
      throw new ServiceUnavailableException(
        'Email channel is not connected for this Business Unit yet.',
      );
    }

    const toEmail = clientAccount.primaryContact.emails[0];
    if (!toEmail) {
      throw new BadRequestException(
        'This client has no email address on file to send email to.',
      );
    }

    // Reuse ConversationService's findOrCreate (same threading logic every
    // other channel goes through, see TwilioSmsWebhookController) rather
    // than duplicating the channelConnectionId+counterpartyAddress upsert
    // here -- for an EMAIL channel it already mints and persists a
    // replyToken, so a second, hand-rolled upsert would just be a second
    // code path that could drift from this one. MessageService.sendEmail
    // below will resolve to this exact same Conversation row (same unique
    // key), so no duplicate is created.
    const conversation = await this.conversations.findOrCreate({
      workspaceId: connection.workspaceId,
      businessUnitId: clientAccount.businessUnitId,
      channelConnectionId: connection.id,
      channel: 'EMAIL',
      counterpartyAddress: toEmail,
      contactId: clientAccount.primaryContactId,
      clientAccountId: clientAccount.id,
    });

    return this.messages.sendEmail({
      workspaceId: connection.workspaceId,
      businessUnitId: clientAccount.businessUnitId,
      channelConnectionId: connection.id,
      contactId: clientAccount.primaryContactId,
      to: toEmail,
      from: connection.externalAddress,
      replyTo: conversation.replyToken
        ? `reply+${conversation.replyToken}@${process.env.RESEND_INBOUND_DOMAIN ?? 'reply.demmmarketing.com'}`
        : undefined,
      subject: body.subject,
      html: body.html,
      sentByUserId: user.id,
    });
  }
}

@Controller('webhooks/resend')
export class ResendWebhookController {
  private readonly logger = new Logger(ResendWebhookController.name);

  constructor(
    private messages: MessageService,
    private conversations: ConversationService,
    private consent: CommunicationConsentService,
    private prisma: PrismaService,
    @Inject(INBOUND_EMAIL_PROVIDER)
    private inboundProvider: InboundEmailProvider,
    @Inject(EMAIL_PROVIDER) private emailProvider: EmailProvider,
    @Inject(DELIVERY_STATUS_PROVIDER)
    private deliveryStatus: DeliveryStatusProvider,
  ) {}

  // Because of Task 4.5's raw-body middleware mounted on /webhooks/resend,
  // `req.body` here is a Buffer, NOT a parsed object -- no `@Body()` DTO
  // decorator on any method in this controller. Parse the JSON ourselves,
  // AFTER signature verification has run against the untouched raw bytes.
  @Post('inbound')
  @HttpCode(200)
  async handleInbound(
    @Headers('svix-id') svixId: string,
    @Headers('svix-timestamp') svixTimestamp: string,
    @Headers('svix-signature') svixSignature: string,
    @Req() req: Request,
  ) {
    const rawBodyString = (req.body as Buffer).toString('utf-8');
    const headers = JSON.stringify({
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    });
    if (
      !this.inboundProvider.verifyInboundWebhookSignature(
        rawBodyString,
        headers,
      )
    ) {
      throw new UnauthorizedException('Invalid Resend webhook signature');
    }

    const parsedBody = JSON.parse(rawBodyString);
    // ResendAdapter.parseInboundEmail (Task 12) already unwraps the real
    // envelope's nested `data` key and its `to` array, returning a flat
    // `to: string` -- this controller only deals with the normalized
    // InboundEmailPayload shape, never the raw provider JSON.
    const payload = this.inboundProvider.parseInboundEmail(parsedBody);
    if (!payload.replyToken) {
      this.logger.warn(`Inbound email to unresolvable address: ${payload.to}`);
      return { received: true };
    }

    const conversation = await this.conversations.findByReplyToken(
      payload.replyToken,
    );
    if (!conversation) {
      this.logger.warn(
        `Inbound email replyToken did not resolve to a Conversation: ${payload.replyToken}`,
      );
      return { received: true };
    }

    await this.messages.recordInboundEmail({
      conversationId: conversation.id,
      providerMessageId: payload.providerMessageId,
      html: payload.html,
    });

    return { received: true };
  }

  // IMPORTANT: verified against the installed `resend` SDK's own type
  // definitions (node_modules/resend/dist/index.d.cts, WebhookEvent union)
  // and against https://resend.com/docs/dashboard/webhooks/event-types
  // (fetched live during this task) -- Resend's webhook catalog has NO
  // dedicated "unsubscribe" event type. The full email-event catalog is:
  // email.sent/.scheduled/.delivered/.delivery_delayed/.complained/
  // .bounced/.opened/.clicked/.received/.failed/.suppressed, plus
  // contact.*/domain.* events and (per the live docs page, not yet in the
  // installed SDK's types) suppression.added/suppression.removed. Because
  // there is no confirmed stable event name or payload shape for
  // unsubscribe today, and Resend's catalog can add/rename event types, we
  // handle it generically: any event type whose name contains "unsubscrib"
  // (case-insensitive) is treated as an opt-out signal alongside the exact
  // documented "email.complained" name, so a future naming addition doesn't
  // silently fail to honor opt-outs. This is a defensive no-op today (it
  // matches nothing in the current catalog) and a safety net going forward.
  @Post('events')
  @HttpCode(200)
  async handleEvents(
    @Headers('svix-id') svixId: string,
    @Headers('svix-timestamp') svixTimestamp: string,
    @Headers('svix-signature') svixSignature: string,
    @Req() req: Request,
  ) {
    const rawBodyString = (req.body as Buffer).toString('utf-8');
    const headers = JSON.stringify({
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    });
    if (
      !this.emailProvider.verifyOutboundWebhookSignature(rawBodyString, headers)
    ) {
      throw new UnauthorizedException('Invalid Resend webhook signature');
    }

    const rawBody = JSON.parse(rawBodyString);
    const eventType = ((rawBody.type as string) ?? '').toLowerCase();

    // Every documented email.* event nests its payload under `data.email_id`
    // (ResendAdapter.normalizeStatus and .parseInboundEmail both read the
    // same nested shape -- see Task 12). Guard against an absent/undefined
    // email_id explicitly: passing `undefined` to Prisma's findUnique on a
    // unique field throws a validation error rather than returning null, so
    // an unrecognized or non-email event landing on this endpoint would
    // otherwise 500 instead of cleanly ack'ing.
    const emailId = (rawBody.data as Record<string, unknown> | undefined)
      ?.email_id as string | undefined;
    if (!emailId) {
      this.logger.warn(
        `Resend event "${eventType}" had no data.email_id -- ack, no-op`,
      );
      return { received: true };
    }

    const message = await this.prisma.message.findUnique({
      where: { providerMessageId: emailId },
      include: { conversation: true },
    });
    if (!message) return { received: true };

    const outcome = this.deliveryStatus.normalizeStatus('RESEND', rawBody);
    await this.prisma.deliveryAttempt.create({
      data: {
        messageId: message.id,
        outcome,
        occurredAt: new Date(),
        providerRaw: rawBody,
      },
    });

    const isComplaint = eventType === 'email.complained';
    const isUnsubscribe = eventType.includes('unsubscrib');
    if ((isComplaint || isUnsubscribe) && message.conversation.contactId) {
      await this.consent.recordOptOut(
        message.conversation.contactId,
        ConsentChannelType.EMAIL,
        isComplaint ? 'complaint' : 'unsubscribe-link',
      );
    }

    return { received: true };
  }
}
