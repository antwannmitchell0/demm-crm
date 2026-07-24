import { Injectable } from '@nestjs/common';
import {
  SmsProvider,
  InboundSmsPayload,
} from '../interfaces/sms-provider.interface';
import { ProviderNotConfiguredError } from '../errors/provider-not-configured.error';

@Injectable()
export class NullSmsProvider implements SmsProvider {
  sendSms(_params: {
    to: string;
    from: string;
    body: string;
    statusCallbackUrl?: string;
  }): Promise<{ providerMessageId: string }> {
    return Promise.reject(new ProviderNotConfiguredError('Twilio SMS'));
  }

  verifyInboundWebhookSignature(
    _rawBody: string,
    _signatureHeader: string,
    _url: string,
  ): boolean {
    return false;
  }

  parseInboundSms(_rawBody: Record<string, unknown>): InboundSmsPayload {
    throw new ProviderNotConfiguredError('Twilio SMS');
  }
}
