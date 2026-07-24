import { Injectable } from '@nestjs/common';
import { EmailProvider } from '../interfaces/email-provider.interface';
import { ProviderNotConfiguredError } from '../errors/provider-not-configured.error';

@Injectable()
export class NullEmailProvider implements EmailProvider {
  async sendEmail(): Promise<{ providerMessageId: string }> {
    throw new ProviderNotConfiguredError('Resend Email');
  }

  verifyOutboundWebhookSignature(): boolean {
    return false;
  }
}
