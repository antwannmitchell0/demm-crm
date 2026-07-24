export interface SecureAttachmentRef {
  path: string;
  filename: string;
  contentType: string;
}

export interface EmailProvider {
  sendEmail(params: {
    to: string;
    from: string;
    replyTo?: string;
    subject: string;
    html: string;
    attachments?: SecureAttachmentRef[];
  }): Promise<{ providerMessageId: string }>;
  verifyOutboundWebhookSignature(
    rawBody: string,
    signatureHeader: string,
  ): boolean;
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
