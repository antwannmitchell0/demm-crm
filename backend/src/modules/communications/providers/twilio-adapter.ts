import { Injectable } from '@nestjs/common';
import Twilio, { validateRequest } from 'twilio';
import type {
  SmsProvider,
  InboundSmsPayload,
} from '../interfaces/sms-provider.interface';
import type {
  VoiceProvider,
  VoiceStatusPayload,
} from '../interfaces/voice-provider.interface';
import type {
  DeliveryStatusProvider,
  ProviderName,
} from '../interfaces/delivery-status-provider.interface';
import { DeliveryAttemptOutcome } from '@prisma/client';

// Twilio's own CallStatus/MessageStatus values that count as terminal --
// anything else (queued/ringing/in-progress) is not a final outcome yet
// and must never be written to CallEvent.outcome (see Task 12's out-of-
// order guard, which relies on only terminal statuses reaching it).
const TWILIO_MESSAGE_STATUS_TO_OUTCOME: Record<string, DeliveryAttemptOutcome> =
  {
    delivered: DeliveryAttemptOutcome.SUCCEEDED,
    sent: DeliveryAttemptOutcome.SUCCEEDED,
    failed: DeliveryAttemptOutcome.FAILED,
    undelivered: DeliveryAttemptOutcome.UNDELIVERED,
  };

export interface TwilioAdapterConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

@Injectable()
export class TwilioAdapter
  implements SmsProvider, VoiceProvider, DeliveryStatusProvider
{
  private client: ReturnType<typeof Twilio>;

  constructor(private config: TwilioAdapterConfig) {
    this.client = Twilio(config.accountSid, config.authToken);
  }

  async sendSms(params: {
    to: string;
    from: string;
    body: string;
    statusCallbackUrl?: string;
  }): Promise<{ providerMessageId: string }> {
    const result = await this.client.messages.create({
      to: params.to,
      from: params.from,
      body: params.body,
      ...(params.statusCallbackUrl
        ? { statusCallback: params.statusCallbackUrl }
        : {}),
    });
    return { providerMessageId: result.sid };
  }

  verifyInboundWebhookSignature(
    rawBody: string,
    signatureHeader: string,
    url: string,
  ): boolean {
    const params = Object.fromEntries(new URLSearchParams(rawBody));
    return validateRequest(this.config.authToken, signatureHeader, url, params);
  }

  parseInboundSms(rawBody: Record<string, unknown>): InboundSmsPayload {
    return {
      providerMessageId: rawBody.MessageSid as string,
      from: rawBody.From as string,
      to: rawBody.To as string,
      body: rawBody.Body as string,
    };
  }

  parseVoiceStatusCallback(
    rawBody: Record<string, unknown>,
  ): VoiceStatusPayload {
    return {
      providerCallId: rawBody.CallSid as string,
      from: rawBody.From as string,
      to: rawBody.To as string,
      callStatus: rawBody.CallStatus as string,
      timestamp: new Date(),
      answeredByMachine:
        rawBody.AnsweredBy === 'machine_start' ||
        rawBody.AnsweredBy === 'machine_end_beep',
    };
  }

  normalizeStatus(
    providerName: ProviderName,
    rawEvent: Record<string, unknown>,
  ): DeliveryAttemptOutcome {
    if (providerName !== 'TWILIO') {
      throw new Error(`TwilioAdapter cannot normalize ${providerName} events`);
    }
    const status = (rawEvent.MessageStatus as string) ?? '';
    return (
      TWILIO_MESSAGE_STATUS_TO_OUTCOME[status] ?? DeliveryAttemptOutcome.FAILED
    );
  }
}
