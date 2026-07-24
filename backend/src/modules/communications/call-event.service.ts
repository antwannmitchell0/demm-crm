import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { MessageService } from './message.service';
import { VoiceStatusPayload } from './interfaces/voice-provider.interface';
import { CallOutcome, ChannelType } from '@prisma/client';

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

    // Atomic check-and-set cooldown: one transaction finds the most recent
    // text-back for this fromAddress+connection and, only if outside the
    // cooldown window, marks THIS row textBackSent before sending -- closes
    // the same rapid-re-dial double-fire race the Stripe webhook dedup
    // lock closes for concurrent webhook delivery.
    const sent = await this.prisma.$transaction(async (tx) => {
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

    if (!sent) return;

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
  }
}
