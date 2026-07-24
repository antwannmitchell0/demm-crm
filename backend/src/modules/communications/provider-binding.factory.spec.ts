import { bindSmsProvider } from './provider-binding.factory';
import { NullSmsProvider } from './providers/null-sms-provider';

describe('provider-binding.factory', () => {
  const originalEnv = process.env.TWILIO_ACCOUNT_SID;

  afterEach(() => {
    process.env.TWILIO_ACCOUNT_SID = originalEnv;
  });

  it('binds NullSmsProvider when TWILIO_ACCOUNT_SID is unset', () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    expect(bindSmsProvider()).toBeInstanceOf(NullSmsProvider);
  });
});
