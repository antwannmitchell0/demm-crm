import { DeliveryAttemptOutcome } from '@prisma/client';

export type ProviderName = 'TWILIO' | 'RESEND';

export interface DeliveryStatusProvider {
  normalizeStatus(
    providerName: ProviderName,
    rawEvent: Record<string, unknown>,
  ): DeliveryAttemptOutcome;
}

export const DELIVERY_STATUS_PROVIDER = Symbol('DELIVERY_STATUS_PROVIDER');
