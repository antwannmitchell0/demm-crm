import { Injectable } from '@nestjs/common';
import { VoiceProvider, VoiceStatusPayload } from '../interfaces/voice-provider.interface';
import { ProviderNotConfiguredError } from '../errors/provider-not-configured.error';

@Injectable()
export class NullVoiceProvider implements VoiceProvider {
  verifyInboundWebhookSignature(): boolean {
    return false;
  }

  parseVoiceStatusCallback(): VoiceStatusPayload {
    throw new ProviderNotConfiguredError('Twilio Voice');
  }
}
