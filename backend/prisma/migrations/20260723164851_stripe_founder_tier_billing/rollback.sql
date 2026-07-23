-- Rollback for stripe_founder_tier_billing
-- Reverses only what this migration added. Does NOT restore recordedById
-- to NOT NULL automatically -- if any StripeWebhook-sourced row with a
-- null recordedById exists, that DROP NOT NULL reversal would fail; this
-- is deliberate (forces a human decision rather than silently deleting
-- audit rows to make the constraint fit again).

DROP TABLE IF EXISTS "BillingPaymentRecord";
DROP TABLE IF EXISTS "BillingCheckoutSession";
DROP TABLE IF EXISTS "BillingSubscription";
DROP TABLE IF EXISTS "StripeWebhookEvent";
DROP TABLE IF EXISTS "StripePriceMapping";

ALTER TABLE "OfferSnapshot" DROP COLUMN IF EXISTS "trialEligible";
ALTER TABLE "OfferSnapshot" DROP COLUMN IF EXISTS "trialDays";
ALTER TABLE "OfferSnapshot" DROP COLUMN IF EXISTS "stripePriceMappingId";

ALTER TABLE "Offer" DROP COLUMN IF EXISTS "trialEligible";
ALTER TABLE "Offer" DROP COLUMN IF EXISTS "trialDays";

ALTER TABLE "ClientAccount" DROP COLUMN IF EXISTS "stripeCustomerId";

DROP TYPE IF EXISTS "BillingSubscriptionStatus";
DROP TYPE IF EXISTS "BillingCheckoutStatus";
DROP TYPE IF EXISTS "WebhookProcessingState";
DROP TYPE IF EXISTS "PaymentReversalState";

-- recordedById/recordedBy on ClientCommercialStateChange: left nullable
-- on rollback. See note above.
