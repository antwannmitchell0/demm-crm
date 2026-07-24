export interface InboundEmailPayload {
  providerMessageId: string;
  from: string;
  to: string;
  subject: string;
  html: string | null;
  text: string | null;
  replyToken: string | null; // extracted from the reply+{token}@... local-part, if present
}

export interface InboundEmailProvider {
  verifyInboundWebhookSignature(
    rawBody: string,
    signatureHeader: string,
  ): boolean;
  parseInboundEmail(rawBody: Record<string, unknown>): InboundEmailPayload;
}

export const INBOUND_EMAIL_PROVIDER = Symbol('INBOUND_EMAIL_PROVIDER');
