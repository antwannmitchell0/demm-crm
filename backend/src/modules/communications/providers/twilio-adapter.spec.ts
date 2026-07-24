import { createHmac } from 'crypto';
import { TwilioAdapter } from './twilio-adapter';

describe('TwilioAdapter', () => {
  const authToken = 'test_auth_token_1234567890';
  let adapter: TwilioAdapter;

  beforeAll(() => {
    adapter = new TwilioAdapter({
      accountSid: 'ACtest',
      authToken,
      fromNumber: '+15555550100',
    });
  });

  it('verifyInboundWebhookSignature accepts a genuinely-signed payload', () => {
    const url = 'https://staging.example.com/webhooks/twilio/sms';
    const params = { From: '+15555550199', To: '+15555550100', Body: 'hi' };
    // Twilio signs application/x-www-form-urlencoded params, not raw JSON --
    // build the same signature the real Twilio infrastructure would send.
    const data = Object.keys(params)
      .sort()
      .reduce((acc, key) => acc + key + (params as any)[key], url);
    const signature = createHmac('sha1', authToken)
      .update(Buffer.from(data, 'utf-8'))
      .digest('base64');

    expect(
      adapter.verifyInboundWebhookSignature(
        new URLSearchParams(params).toString(),
        signature,
        url,
      ),
    ).toBe(true);
  });

  it('verifyInboundWebhookSignature rejects a tampered payload', () => {
    const url = 'https://staging.example.com/webhooks/twilio/sms';
    expect(
      adapter.verifyInboundWebhookSignature(
        'From=%2B15555550199&Body=tampered',
        'not-a-real-signature==',
        url,
      ),
    ).toBe(false);
  });

  it('parseInboundSms extracts providerMessageId/from/to/body from Twilio form fields', () => {
    const parsed = adapter.parseInboundSms({
      MessageSid: 'SM123abc',
      From: '+15555550199',
      To: '+15555550100',
      Body: 'Hello',
    });
    expect(parsed).toEqual({
      providerMessageId: 'SM123abc',
      from: '+15555550199',
      to: '+15555550100',
      body: 'Hello',
    });
  });
});
