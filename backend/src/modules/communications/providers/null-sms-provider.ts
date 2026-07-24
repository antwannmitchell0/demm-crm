import { Injectable } from '@nestjs/common';
import { SmsProvider, InboundSmsPayload } from '../interfaces/sms-provider.interface';
import { ProviderNotConfiguredError } from '../errors/provider-not-configured.error';

@Injectable()
export class NullSmsProvider implements SmsProvider {
  async sendSms(): Promise<{ providerMessageId: string }> {
    throw new ProviderNotConfiguredError('Twilio SMS');
  }

  verifyInboundWebhookSignature(): boolean {
    return false;
  }

  parseInboundSms(): InboundSmsPayload {
    throw new ProviderNotConfiguredError('Twilio SMS');
  }
}
