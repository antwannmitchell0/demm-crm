import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { MessageService } from './message.service';
import { VoiceStatusPayload } from './interfaces/voice-provider.interface';
import { CallOutcome, ChannelType } from '@prisma/client';
import { CommunicationRelationshipSignalService } from './communication-relationship-signal.service';

const TERMINAL_STATUSES = new Set([
  'completed',
  'no-answer',
  'busy',
  'failed',
  'canceled',
]);
const TEXTBACK_ELIGIBLE: CallOutcome[] = ['NO_ANSWER', 'BUSY', 'CANCELED'];
// Configurable per Antwann's spec ("add a configurable cooldown") -- an env
// var rather than a DB-per-workspace setting for v1 (YAGNI: no UI need yet
// to vary this per Business Unit; revisit if that becomes a real ask).
const COOLDOWN_MINUTES = Number(
  process.env.MISSED_CALL_TEXTBACK_COOLDOWN_MINUTES ?? 30,
);

function mapStatusToOutcome(
  callStatus: string,
  answeredByMachine?: boolean,
): CallOutcome {
  if (answeredByMachine) return 'VOICEMAIL';
  switch (callStatus) {
    case 'completed':
      return 'ANSWERED';
    case 'no-answer':
      return 'NO_ANSWER';
    case 'busy':
      return 'BUSY';
    case 'failed':
      return 'FAILED';
    case 'canceled':
      return 'CANCELED';
    default:
      return 'FAILED';
  }
}

@Injectable()
export class CallEventService {
  constructor(
    private prisma: PrismaService,
    private messages: MessageService,
    private relationshipSignals: CommunicationRelationshipSignalService,
  ) {}

  async recordStatusCallback(
    payload: VoiceStatusPayload,
    channelConnectionId: string,
  ): Promise<void> {
    const connection = await this.prisma.channelConnection.findUnique({
      where: { id: channelConnectionId },
    });
    if (!connection) return;

    const contact = await this.prisma.contact.findFirst({
      where: {
        workspaceId: connection.workspaceId,
        phones: { has: payload.from },
      },
    });

    const existing = await this.prisma.callEvent.findUnique({
      where: { providerCallId: payload.providerCallId },
    });

    if (!existing) {
      await this.prisma.callEvent.create({
        data: {
          workspaceId: connection.workspaceId,
          channelConnectionId,
          contactId: contact?.id,
          providerCallId: payload.providerCallId,
          fromAddress: payload.from,
          startedAt: payload.timestamp,
        },
      });
    }

    if (!TERMINAL_STATUSES.has(payload.callStatus)) return; // ringing/in-progress -- not a final outcome yet

    const current = await this.prisma.callEvent.findUnique({
      where: { providerCallId: payload.providerCallId },
    });
    if (!current) return;

    // Out-of-order guard: a stale terminal callback arriving after a
    // fresher one must never revert the already-resolved outcome.
    if (current.resolvedAt && payload.timestamp < current.resolvedAt) return;

    const outcome = mapStatusToOutcome(
      payload.callStatus,
      payload.answeredByMachine,
    );

    await this.prisma.callEvent.update({
      where: { providerCallId: payload.providerCallId },
      data: { outcome, resolvedAt: payload.timestamp },
    });

    if (!TEXTBACK_ELIGIBLE.includes(outcome)) return;

    // A missed call is now classified -- record the DOM26-R signal before
    // the cooldown/text-back logic below, which only decides whether a
    // text-back fires, not whether the missed call itself happened. No
    // contact match (unknown caller) means no RelationshipProfile is
    // possible, so this is skipped rather than guessed at.
    if (contact?.id) {
      await this.relationshipSignals.createSignal(
        contact.id,
        connection.businessUnitId,
        'MISSED_CALL_DETECTED',
        `Missed call from ${payload.from} (${outcome}).`,
      );
    }

    // Atomic check-and-set cooldown: a pg_advisory_xact_lock keyed on
    // fromAddress+connection is acquired FIRST, before the findFirst
    // cooldown check, exactly like StripeWebhookDedupService.claimAndProcess
    // does for concurrent webhook delivery (see that file's comment for the
    // full rationale). Read Committed isolation does NOT serialize a
    // findFirst-then-update against a concurrent transaction touching a
    // DIFFERENT CallEvent row for the same fromAddress -- two genuinely
    // simultaneous missed calls (two different providerCallId rows) could
    // otherwise both pass the findFirst check before either commits, and
    // both fire a text-back. The advisory lock forces a second concurrent
    // caller for the same fromAddress+channelConnectionId to block until
    // the first transaction fully commits, at which point it correctly
    // observes the first call's textBackSent: true row and skips.
    const sent = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        `${payload.from}:${channelConnectionId}`,
      );

      const cutoff = new Date(Date.now() - COOLDOWN_MINUTES * 60_000);
      const recentTextback = await tx.callEvent.findFirst({
        where: {
          fromAddress: payload.from,
          channelConnectionId,
          textBackSent: true,
          resolvedAt: { gte: cutoff },
        },
      });
      if (recentTextback) return false;

      await tx.callEvent.update({
        where: { providerCallId: payload.providerCallId },
        data: { textBackSent: true },
      });
      return true;
    });

    if (!sent) {
      if (contact?.id) {
        await this.relationshipSignals.createSignal(
          contact.id,
          connection.businessUnitId,
          'MISSED_CALL_TEXTBACK_SUPPRESSED_COOLDOWN',
          `Missed-call text-back suppressed for ${payload.from} -- another text-back was already sent within the cooldown window.`,
        );
      }
      return;
    }

    const smsConnection = await this.prisma.channelConnection.findFirst({
      where: {
        businessUnitId: connection.businessUnitId,
        type: ChannelType.SMS,
        status: 'ACTIVE',
      },
    });
    if (!smsConnection?.externalAddress) return; // SMS not connected yet -- outcome/textBackSent already recorded, nothing more to do

    const template = await this.prisma.messageTemplate.findFirst({
      where: {
        businessUnitId: connection.businessUnitId,
        channel: 'SMS',
        name: 'missed-call-textback',
        active: true,
      },
    });
    if (!template) return;

    try {
      await this.messages.sendSms({
        workspaceId: connection.workspaceId,
        businessUnitId: connection.businessUnitId,
        channelConnectionId: smsConnection.id,
        contactId: contact?.id,
        to: payload.from,
        from: smsConnection.externalAddress,
        body: template.body,
        templateId: template.id,
      });
      if (contact?.id) {
        await this.relationshipSignals.createSignal(
          contact.id,
          connection.businessUnitId,
          'MISSED_CALL_TEXTBACK_SENT',
          `Missed-call text-back sent to ${payload.from}.`,
        );
      }
    } catch (err) {
      // MessageService.sendSms throws ForbiddenException when the contact
      // has opted out of SMS -- that is correct, expected behavior there,
      // but here it is a legitimate "no send needed" business outcome, not
      // a failure of this webhook handler. Left uncaught it would propagate
      // through TwilioVoiceWebhookController.handleVoiceStatus and Nest's
      // default exception filter would return a 403 to Twilio, which
      // Twilio will likely retry -- a noisy retry storm for a non-error.
      // The CallEvent row's outcome/textBackSent state is already
      // correctly recorded regardless; only the SMS send is skipped. Any
      // other exception (a genuine send failure) must still propagate.
      if (!(err instanceof ForbiddenException)) throw err;
    }
  }
}
