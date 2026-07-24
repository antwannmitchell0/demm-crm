import { SmsProvider } from './interfaces/sms-provider.interface';
import { VoiceProvider } from './interfaces/voice-provider.interface';
import { EmailProvider } from './interfaces/email-provider.interface';
import { InboundEmailProvider } from './interfaces/inbound-email-provider.interface';
import { DeliveryStatusProvider } from './interfaces/delivery-status-provider.interface';
import { NullSmsProvider } from './providers/null-sms-provider';
import { NullVoiceProvider } from './providers/null-voice-provider';
import { NullEmailProvider } from './providers/null-email-provider';
import { NullInboundEmailProvider } from './providers/null-inbound-email-provider';
import { NullDeliveryStatusProvider } from './providers/null-delivery-status-provider';
import { TwilioAdapter } from './providers/twilio-adapter';
import { ResendAdapter } from './providers/resend-adapter';

// Each function is intentionally a plain factory (not a class) so
// CommunicationsModule's `useFactory` providers can call it directly --
// Tasks 9/14 extend the body of each function with a real-adapter branch,
// gated on the presence of that provider's required env var. Nothing here
// ever reads a secret value, only checks whether one is present.

function buildTwilioAdapter(): TwilioAdapter {
  return new TwilioAdapter({
    accountSid: process.env.TWILIO_ACCOUNT_SID!,
    authToken: process.env.TWILIO_AUTH_TOKEN!,
    fromNumber: process.env.TWILIO_FROM_NUMBER!,
  });
}

function buildResendAdapter(): ResendAdapter {
  return new ResendAdapter({
    apiKey: process.env.RESEND_API_KEY!,
    webhookSecret: process.env.RESEND_WEBHOOK_SECRET!,
    inboundDomain: process.env.RESEND_INBOUND_DOMAIN!,
  });
}

export function bindSmsProvider(): SmsProvider {
  if (!process.env.TWILIO_ACCOUNT_SID) return new NullSmsProvider();
  return buildTwilioAdapter();
}

export function bindVoiceProvider(): VoiceProvider {
  if (!process.env.TWILIO_ACCOUNT_SID) return new NullVoiceProvider();
  return buildTwilioAdapter();
}

export function bindEmailProvider(): EmailProvider {
  if (!process.env.RESEND_API_KEY) return new NullEmailProvider();
  return buildResendAdapter();
}

export function bindInboundEmailProvider(): InboundEmailProvider {
  if (!process.env.RESEND_API_KEY) return new NullInboundEmailProvider();
  return buildResendAdapter();
}

export function bindDeliveryStatusProvider(): DeliveryStatusProvider {
  if (process.env.TWILIO_ACCOUNT_SID) return buildTwilioAdapter();
  if (process.env.RESEND_API_KEY) return buildResendAdapter();
  return new NullDeliveryStatusProvider();
}
