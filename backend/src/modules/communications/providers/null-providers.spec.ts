import { NullSmsProvider } from './null-sms-provider';
import { NullEmailProvider } from './null-email-provider';
import { ProviderNotConfiguredError } from '../errors/provider-not-configured.error';

describe('Null providers', () => {
  it('NullSmsProvider throws ProviderNotConfiguredError on send', async () => {
    const provider = new NullSmsProvider();
    await expect(
      provider.sendSms({ to: '+15550001111', from: '+15550002222', body: 'hi' }),
    ).rejects.toThrow(ProviderNotConfiguredError);
  });

  it('NullSmsProvider rejects every webhook signature', () => {
    const provider = new NullSmsProvider();
    expect(
      provider.verifyInboundWebhookSignature('body', 'sig', 'https://x'),
    ).toBe(false);
  });

  it('NullEmailProvider throws ProviderNotConfiguredError on send', async () => {
    const provider = new NullEmailProvider();
    await expect(
      provider.sendEmail({
        to: 'a@example.com',
        from: 'b@example.com',
        subject: 'hi',
        html: '<p>hi</p>',
      }),
    ).rejects.toThrow(ProviderNotConfiguredError);
  });
});
