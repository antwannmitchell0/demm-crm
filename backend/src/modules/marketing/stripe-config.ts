import Stripe from 'stripe';

// Pinned Stripe API version -- every Stripe SDK instance in this app
// (checkout, provisioning, webhook verification, tests) must use this
// exact constant so the app's behavior can never silently drift when
// Stripe ships a new default API version. Confirm this is still the
// latest stable version at https://dashboard.stripe.com/settings/api
// before deploying; update here (and only here) if it changes.
export const STRIPE_API_VERSION = '2026-06-24.dahlia' as const;

export function createStripeClient(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      'STRIPE_SECRET_KEY is not configured. Billing features are fail-closed until it is set.',
    );
  }
  return new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION });
}

export function currentEnvironment(): 'local' | 'staging' | 'production' {
  const env = (process.env.APP_ENVIRONMENT || 'local').toLowerCase();
  if (env === 'staging' || env === 'production') return env;
  return 'local';
}

export function isLiveKey(): boolean {
  const key = process.env.STRIPE_SECRET_KEY || '';
  return key.startsWith('sk_live_');
}
