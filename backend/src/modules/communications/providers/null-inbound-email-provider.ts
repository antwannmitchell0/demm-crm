import { Injectable } from '@nestjs/common';
import {
  InboundEmailProvider,
  InboundEmailPayload,
} from '../interfaces/inbound-email-provider.interface';
import { ProviderNotConfiguredError } from '../errors/provider-not-configured.error';

@Injectable()
export class NullInboundEmailProvider implements InboundEmailProvider {
  verifyInboundWebhookSignature(): boolean {
    return false;
  }

  parseInboundEmail(): InboundEmailPayload {
    throw new ProviderNotConfiguredError('Resend Receiving');
  }
}
