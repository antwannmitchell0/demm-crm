import { Injectable } from '@nestjs/common';
import {
  InboundEmailProvider,
  InboundEmailPayload,
} from '../interfaces/inbound-email-provider.interface';
import { ProviderNotConfiguredError } from '../errors/provider-not-configured.error';

@Injectable()
export class NullInboundEmailProvider implements InboundEmailProvider {
  verifyInboundWebhookSignature(
    _rawBody: string,
    _signatureHeader: string,
  ): boolean {
    return false;
  }

  parseInboundEmail(_rawBody: Record<string, unknown>): InboundEmailPayload {
    throw new ProviderNotConfiguredError('Resend Receiving');
  }
}
