export interface VoiceStatusPayload {
  providerCallId: string;
  from: string;
  to: string;
  callStatus: string; // raw provider status string, normalized by the caller
  timestamp: Date;
  answeredByMachine?: boolean;
}

export interface VoiceProvider {
  verifyInboundWebhookSignature(
    rawBody: string,
    signatureHeader: string,
    url: string,
  ): boolean;
  parseVoiceStatusCallback(
    rawBody: Record<string, unknown>,
  ): VoiceStatusPayload;
}

export const VOICE_PROVIDER = Symbol('VOICE_PROVIDER');
