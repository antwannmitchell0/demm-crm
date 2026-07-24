import { ResendAdapter } from './resend-adapter';
import { Webhook } from 'svix';

describe('ResendAdapter', () => {
  const webhookSecret = 'whsec_test1234567890abcdef1234567890abcdef1234==';
  let adapter: ResendAdapter;

  beforeAll(() => {
    adapter = new ResendAdapter({
      apiKey: 're_test_key',
      webhookSecret,
      inboundDomain: 'reply.demmmarketing.com',
    });
  });

  it('verifyOutboundWebhookSignature accepts a genuinely svix-signed payload', () => {
    const payload = JSON.stringify({
      type: 'email.delivered',
      data: { email_id: 'em_123' },
    });
    const wh = new Webhook(webhookSecret);
    const id = 'msg_test123';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = wh.sign(id, new Date(Number(timestamp) * 1000), payload);

    expect(
      adapter.verifyOutboundWebhookSignature(
        payload,
        JSON.stringify({
          'svix-id': id,
          'svix-timestamp': timestamp,
          'svix-signature': signature,
        }),
      ),
    ).toBe(true);
  });

  it('verifyOutboundWebhookSignature rejects a tampered payload', () => {
    expect(
      adapter.verifyOutboundWebhookSignature(
        '{"tampered":true}',
        JSON.stringify({
          'svix-id': 'x',
          'svix-timestamp': '0',
          'svix-signature': 'v1,bad==',
        }),
      ),
    ).toBe(false);
  });

  it('parseInboundEmail extracts the reply token from a reply+{token}@ local-part', () => {
    const parsed = adapter.parseInboundEmail({
      from: 'lead@example.com',
      to: 'reply+abc123token@reply.demmmarketing.com',
      subject: 'Re: Hello',
      html: '<p>reply body</p>',
      text: 'reply body',
      email_id: 'em_inbound_1',
    });
    expect(parsed.replyToken).toBe('abc123token');
    expect(parsed.providerMessageId).toBe('em_inbound_1');
  });

  it('parseInboundEmail returns null replyToken for a non-reply-pattern address', () => {
    const parsed = adapter.parseInboundEmail({
      from: 'lead@example.com',
      to: 'hello@reply.demmmarketing.com',
      subject: 'New inquiry',
      html: '<p>hi</p>',
      text: 'hi',
      email_id: 'em_inbound_2',
    });
    expect(parsed.replyToken).toBeNull();
  });

  it('parseInboundEmail handles the real Resend webhook envelope (data nested, to as array)', () => {
    const parsed = adapter.parseInboundEmail({
      type: 'email.received',
      created_at: '2026-02-22T23:41:12.126Z',
      data: {
        email_id: 'em_inbound_3',
        from: 'lead@example.com',
        to: ['reply+abc123token@reply.demmmarketing.com'],
        subject: 'Re: Hello',
      },
    });
    expect(parsed.replyToken).toBe('abc123token');
    expect(parsed.providerMessageId).toBe('em_inbound_3');
    expect(parsed.html).toBeNull();
    expect(parsed.text).toBeNull();
  });
});
