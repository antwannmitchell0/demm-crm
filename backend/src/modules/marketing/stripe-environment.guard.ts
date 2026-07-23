import { Injectable, BadRequestException } from '@nestjs/common';
import { isLiveKey, currentEnvironment } from './stripe-config';

/**
 * Refuses any Stripe operation where the configured secret key's livemode
 * doesn't match the environment/livemode being requested. This is the
 * single choke point that makes "wrong Stripe environment" structurally
 * hard to ship -- every checkout/provisioning call runs this first.
 */
@Injectable()
export class StripeEnvironmentGuard {
  assertConsistent(target: { environment: string; livemode: boolean }): void {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new BadRequestException(
        'STRIPE_SECRET_KEY is not configured. Refusing to proceed (fail-closed).',
      );
    }
    const configuredLivemode = isLiveKey();

    if (configuredLivemode !== target.livemode) {
      throw new BadRequestException(
        `Stripe environment mismatch: configured key is ${configuredLivemode ? 'LIVE' : 'TEST'} mode, ` +
          `but the requested operation targets livemode=${target.livemode}. Refusing to proceed.`,
      );
    }

    const appEnv = currentEnvironment();
    if (appEnv !== 'production' && configuredLivemode) {
      throw new BadRequestException(
        `Stripe environment mismatch: a LIVE-mode key is configured while APP_ENVIRONMENT=${appEnv}. ` +
          'Live keys are only permitted when APP_ENVIRONMENT=production. Refusing to proceed.',
      );
    }
  }
}
