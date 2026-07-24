import { Injectable } from '@nestjs/common';
import {
  EmailProvider,
  SecureAttachmentRef,
} from '../interfaces/email-provider.interface';
import { ProviderNotConfiguredError } from '../errors/provider-not-configured.error';

@Injectable()
export class NullEmailProvider implements EmailProvider {
  sendEmail(_params: {
    to: string;
    from: string;
    replyTo?: string;
    subject: string;
    html: string;
    attachments?: SecureAttachmentRef[];
  }): Promise<{ providerMessageId: string }> {
    return Promise.reject(new ProviderNotConfiguredError('Resend Email'));
  }

  verifyOutboundWebhookSignature(
    _rawBody: string,
    _signatureHeader: string,
  ): boolean {
    return false;
  }
}
