import {
  SmsProvider,
  InboundSmsPayload,
} from '../interfaces/sms-provider.interface';

// Deterministic, in-memory SmsProvider test double -- never touches a
// network. Bound in place of SMS_PROVIDER via Nest's overrideProvider so
// backend/test-communications-provider-neutral.ts (Task 16) can exercise
// the full outbound-send / inbound-webhook / delivery-status pipeline
// without a real Twilio account, and any future test needing predictable
// SMS send behavior can reuse it rather than mocking SmsProvider's methods
// ad hoc.
export class FakeSmsProvider implements SmsProvider {
  sentMessages: Array<{ to: string; from: string; body: string }> = [];
  private counter = 0;

  async sendSms(params: {
    to: string;
    from: string;
    body: string;
    statusCallbackUrl?: string;
  }): Promise<{ providerMessageId: string }> {
    this.sentMessages.push({ to: params.to, from: params.from, body: params.body });
    this.counter += 1;
    return { providerMessageId: `FAKE_SM_${this.counter}` };
  }

  verifyInboundWebhookSignature(): boolean {
    return true; // fake provider -- Stage 1 tests aren't proving signature verification, Stage 2 does
  }

  parseInboundSms(rawBody: Record<string, unknown>): InboundSmsPayload {
    return {
      providerMessageId: rawBody.providerMessageId as string,
      from: rawBody.from as string,
      to: rawBody.to as string,
      body: rawBody.body as string,
    };
  }
}
