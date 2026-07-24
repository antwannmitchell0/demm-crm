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

// Each function is intentionally a plain factory (not a class) so
// CommunicationsModule's `useFactory` providers can call it directly --
// Tasks 9/14 extend the body of each function with a real-adapter branch,
// gated on the presence of that provider's required env var. Nothing here
// ever reads a secret value, only checks whether one is present.

export function bindSmsProvider(): SmsProvider {
  if (!process.env.TWILIO_ACCOUNT_SID) return new NullSmsProvider();
  throw new Error('Twilio adapter not yet wired -- see Task 9');
}

export function bindVoiceProvider(): VoiceProvider {
  if (!process.env.TWILIO_ACCOUNT_SID) return new NullVoiceProvider();
  throw new Error('Twilio adapter not yet wired -- see Task 9');
}

export function bindEmailProvider(): EmailProvider {
  if (!process.env.RESEND_API_KEY) return new NullEmailProvider();
  throw new Error('Resend adapter not yet wired -- see Task 14');
}

export function bindInboundEmailProvider(): InboundEmailProvider {
  if (!process.env.RESEND_API_KEY) return new NullInboundEmailProvider();
  throw new Error('Resend adapter not yet wired -- see Task 14');
}

export function bindDeliveryStatusProvider(): DeliveryStatusProvider {
  if (!process.env.TWILIO_ACCOUNT_SID && !process.env.RESEND_API_KEY) {
    return new NullDeliveryStatusProvider();
  }
  throw new Error('Delivery status adapter not yet wired -- see Tasks 9/14');
}
