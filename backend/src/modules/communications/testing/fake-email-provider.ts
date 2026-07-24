import { EmailProvider } from '../interfaces/email-provider.interface';

// Deterministic, in-memory EmailProvider test double -- never touches a
// network. Bound in place of EMAIL_PROVIDER via Nest's overrideProvider so
// backend/test-communications-provider-neutral.ts (Task 16) can exercise
// the outbound-email pipeline without a real Resend account, and any
// future test needing predictable email send behavior can reuse it rather
// than mocking EmailProvider's methods ad hoc.
export class FakeEmailProvider implements EmailProvider {
  sentEmails: Array<{ to: string; from: string; subject: string; html: string }> =
    [];
  private counter = 0;

  async sendEmail(params: {
    to: string;
    from: string;
    replyTo?: string;
    subject: string;
    html: string;
  }): Promise<{ providerMessageId: string }> {
    this.sentEmails.push({
      to: params.to,
      from: params.from,
      subject: params.subject,
      html: params.html,
    });
    this.counter += 1;
    return { providerMessageId: `FAKE_EM_${this.counter}` };
  }

  verifyOutboundWebhookSignature(): boolean {
    return true;
  }
}
