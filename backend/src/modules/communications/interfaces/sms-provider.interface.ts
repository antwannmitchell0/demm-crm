export interface InboundSmsPayload {
  providerMessageId: string;
  from: string;
  to: string;
  body: string;
}

export interface SmsProvider {
  sendSms(params: {
    to: string;
    from: string;
    body: string;
    statusCallbackUrl?: string; // registers Twilio's per-message delivery-status webhook (see Task 10's sms-status endpoint) -- omitted for providers/fakes that don't support it
  }): Promise<{ providerMessageId: string }>;
  verifyInboundWebhookSignature(
    rawBody: string,
    signatureHeader: string,
    url: string,
  ): boolean;
  parseInboundSms(rawBody: Record<string, unknown>): InboundSmsPayload;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
