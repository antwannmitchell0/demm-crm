import { Injectable } from '@nestjs/common';
import {
  VoiceProvider,
  VoiceStatusPayload,
} from '../interfaces/voice-provider.interface';
import { ProviderNotConfiguredError } from '../errors/provider-not-configured.error';

@Injectable()
export class NullVoiceProvider implements VoiceProvider {
  verifyInboundWebhookSignature(
    _rawBody: string,
    _signatureHeader: string,
    _url: string,
  ): boolean {
    return false;
  }

  parseVoiceStatusCallback(
    _rawBody: Record<string, unknown>,
  ): VoiceStatusPayload {
    throw new ProviderNotConfiguredError('Twilio Voice');
  }
}
