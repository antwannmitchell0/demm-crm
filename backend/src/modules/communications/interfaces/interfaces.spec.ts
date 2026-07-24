import { SMS_PROVIDER } from './sms-provider.interface';
import { VOICE_PROVIDER } from './voice-provider.interface';
import { EMAIL_PROVIDER } from './email-provider.interface';
import { INBOUND_EMAIL_PROVIDER } from './inbound-email-provider.interface';
import { DELIVERY_STATUS_PROVIDER } from './delivery-status-provider.interface';

describe('communications provider DI tokens', () => {
  it('are five distinct symbols', () => {
    const tokens = [
      SMS_PROVIDER,
      VOICE_PROVIDER,
      EMAIL_PROVIDER,
      INBOUND_EMAIL_PROVIDER,
      DELIVERY_STATUS_PROVIDER,
    ];
    expect(new Set(tokens).size).toBe(5);
  });
});
